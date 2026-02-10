// ranker.js - Modernized and cleaned up
import {
  db,
  auth,
  onAuth,
  collection,
  addDoc,
  writeBatch,
  increment,
  serverTimestamp,
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  getDocs
} from "./firebase.js";

import confetti from "https://esm.sh/canvas-confetti";

// ==========================================
// STATE MANAGEMENT
// ==========================================

const state = {
  movies: [],
  currentMovies: {
    A: null,
    B: null
  },
  unseenMovies: [],
  seenMatchups: [],
  uid: null,
  globalStats: null // { "Title|Year": { wins, losses }, ... }
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Build consistent movie key for tracking
 */
function getMovieKey(movie) {
  return `${movie.title.trim()}|${movie.year}`;
}

/**
 * Get movies that haven't been marked as unseen
 */
function getAvailableMovies(exclude = []) {
  return state.movies.filter(movie =>
    !state.unseenMovies.includes(getMovieKey(movie)) &&
    !exclude.includes(movie.title)
  );
}

// ==========================================
// FIRESTORE USER DATA
// ==========================================

/**
 * Load user-specific data (unseenMovies, seenMatchups) from Firestore
 */
async function loadUserData(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const data = snap.data();
      state.unseenMovies = data.seen || [];
      state.seenMatchups = data.seenMatchups || [];
    }
    console.log(`Loaded user data: ${state.unseenMovies.length} unseen, ${state.seenMatchups.length} matchups`);
  } catch (error) {
    console.error("Failed to load user data from Firestore:", error);
  }
}

/**
 * Save unseen movie to Firestore (or localStorage for guests)
 */
async function saveUnseenToFirestore(movieKey) {
  if (state.uid) {
    try {
      await updateDoc(doc(db, "users", state.uid), {
        seen: arrayUnion(movieKey)
      });
    } catch (error) {
      console.error("Failed to save unseen movie to Firestore:", error);
    }
  } else {
    localStorage.setItem("unseenMovies", JSON.stringify(state.unseenMovies));
  }
}

/**
 * Save seen matchup to Firestore (or localStorage for guests)
 */
async function saveMatchupToFirestore(matchupKey) {
  if (state.uid) {
    try {
      await updateDoc(doc(db, "users", state.uid), {
        seenMatchups: arrayUnion(matchupKey)
      });
    } catch (error) {
      console.error("Failed to save matchup to Firestore:", error);
    }
  } else {
    localStorage.setItem("seenMatchups", JSON.stringify(state.seenMatchups));
  }
}

// ==========================================
// TMDB API
// ==========================================

const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

/**
 * Fetch poster URL from TMDB
 */
async function fetchPosterUrl(title, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    const posterPath = data.results?.[0]?.poster_path;
    return posterPath ? TMDB_IMAGE_BASE + posterPath : "./fallback.jpg";
  } catch (error) {
    console.warn("Failed to fetch poster:", error);
    return "./fallback.jpg";
  }
}

// ==========================================
// MOVIE SELECTION & DISPLAY
// ==========================================

/**
 * Pick two distinct random items from an array
 */
function pickTwoRandom(arr) {
  const i = Math.floor(Math.random() * arr.length);
  let j = Math.floor(Math.random() * (arr.length - 1));
  if (j >= i) j++;
  return [arr[i], arr[j]];
}

/**
 * Select two movies for comparison.
 * ~30% of the time: competitive match (strong vs strong)
 * ~70% of the time: pure random
 */
function chooseTwoMovies() {
  const available = getAvailableMovies();

  if (available.length < 2) {
    alert("Not enough movies available. Please un-mark some movies from 'Haven't Seen'.");
    return;
  }

  // Try competitive match ~30% of the time
  if (state.globalStats && Math.random() < 0.3) {
    const pair = pickCompetitiveMatch(available);
    if (pair) {
      [state.currentMovies.A, state.currentMovies.B] = pair;
      displayMovies();
      return;
    }
  }

  // Default: pure random
  [state.currentMovies.A, state.currentMovies.B] = pickTwoRandom(available);
  displayMovies();
}

/**
 * Pick two movies from the stronger tier so top contenders face each other.
 * Returns [movieA, movieB] or null if not enough data.
 */
function pickCompetitiveMatch(available) {
  const MIN_MATCHUPS = 3;

  // Score available movies using global stats
  const scored = [];
  for (const m of available) {
    const s = state.globalStats[getMovieKey(m)];
    if (!s) continue;
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const n = wins + losses;
    if (n < MIN_MATCHUPS) continue;
    scored.push({ movie: m, wins, n, winRate: wins / n });
  }

  if (scored.length < 2) return null;

  // Sort by win count descending, then win rate
  scored.sort((a, b) => b.wins - a.wins || b.winRate - a.winRate);

  // Pick two from the top third
  const topCount = Math.max(2, Math.ceil(scored.length / 3));
  const top = scored.slice(0, topCount);
  const [a, b] = pickTwoRandom(top);
  return [a.movie, b.movie];
}

/**
 * Display current movies in the UI
 */
async function displayMovies() {
  const { A, B } = state.currentMovies;

  if (!A || !B) {
    console.error("No movies to display");
    return;
  }

  try {
    // Update titles and years
    document.getElementById("movieA").textContent = A.title;
    document.getElementById("movieA-year").textContent = A.year;
    document.getElementById("movieB").textContent = B.title;
    document.getElementById("movieB-year").textContent = B.year;

    // Fetch and update posters
    const [posterA, posterB] = await Promise.all([
      fetchPosterUrl(A.title, A.year),
      fetchPosterUrl(B.title, B.year)
    ]);

    document.getElementById("posterA").src = posterA;
    document.getElementById("posterB").src = posterB;
  } catch (error) {
    console.error("Error displaying movies:", error);
  }
}

/**
 * Replace a movie that was marked unseen
 */
async function replaceMovie(oldMovie) {
  const available = getAvailableMovies([
    state.currentMovies.A.title,
    state.currentMovies.B.title
  ]);

  if (available.length === 0) {
    alert("No more movies available!");
    return;
  }

  // Pick random replacement
  const replacement = available[Math.floor(Math.random() * available.length)];

  // Update state
  if (oldMovie.title === state.currentMovies.A.title) {
    state.currentMovies.A = replacement;
  } else {
    state.currentMovies.B = replacement;
  }

  await displayMovies();
}

// ==========================================
// VOTING LOGIC
// ==========================================

/**
 * Handle vote for a movie
 */
async function handleVote(choice) {
  const winner = choice === "A" ? state.currentMovies.A : state.currentMovies.B;
  const loser = choice === "A" ? state.currentMovies.B : state.currentMovies.A;

  console.log(`Vote: ${winner.title} beats ${loser.title}`);

  // 1. Save to Firestore (global votes)
  await saveVoteToFirestore(winner, loser);

  // 2. Track matchup
  const matchupKey = [state.currentMovies.A.title, state.currentMovies.B.title].sort().join("|");
  state.seenMatchups.push(matchupKey);
  await saveMatchupToFirestore(matchupKey);

  // 3. Update vote counter
  updateVoteCounter();

  // 4. Celebrate!
  triggerConfetti(choice);

  // 5. Load next matchup
  setTimeout(() => chooseTwoMovies(), 1200);
}

/**
 * Save vote to Firestore
 */
async function saveVoteToFirestore(winner, loser) {
  try {
    // Save to votes collection
    await addDoc(collection(db, "votes"), {
      winner: getMovieKey(winner),
      loser: getMovieKey(loser),
      user: auth.currentUser?.uid || null,
      timestamp: serverTimestamp()
    });

    // Update aggregate stats
    const batch = writeBatch(db);
    const statsRef = doc(db, "stats", "global");

    batch.set(statsRef, {
      [`stats.${getMovieKey(winner)}.wins`]: increment(1),
      [`stats.${getMovieKey(loser)}.losses`]: increment(1)
    }, { merge: true });

    await batch.commit();

    console.log("Vote saved to Firestore");
  } catch (error) {
    console.error("Failed to save vote to Firestore:", error);
  }
}

/**
 * Trigger confetti from winning poster + dance animation
 */
function triggerConfetti(choice) {
  const poster = document.getElementById(choice === "A" ? "posterA" : "posterB");
  const rect = poster.getBoundingClientRect();
  const x = (rect.left + rect.width / 2) / window.innerWidth;
  const y = (rect.top + rect.height / 2) / window.innerHeight;

  confetti({
    particleCount: 100,
    spread: 70,
    origin: { x, y }
  });

  poster.classList.add("poster-dance");
  poster.addEventListener("animationend", () => {
    poster.classList.remove("poster-dance");
  }, { once: true });
}

// ==========================================
// UNSEEN MOVIE HANDLING
// ==========================================

/**
 * Spawn smoke particles around an element
 */
function spawnSmokeParticles(block) {
  const rect = block.getBoundingClientRect();
  const centerX = rect.width / 2;
  const centerY = rect.height / 3; // bias toward poster area

  const count = 12;
  const particles = [];

  for (let i = 0; i < count; i++) {
    const el = document.createElement("div");
    el.className = "smoke-particle";

    // Random drift direction
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8;
    const dist = 40 + Math.random() * 80;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 30; // bias upward
    const scale = 1.5 + Math.random() * 2;
    const duration = 500 + Math.random() * 400;
    const size = 20 + Math.random() * 25;

    el.style.cssText = `
      left: ${centerX - size / 2}px;
      top: ${centerY - size / 2}px;
      width: ${size}px;
      height: ${size}px;
      --smoke-x: ${dx}px;
      --smoke-y: ${dy}px;
      --smoke-scale: ${scale};
      --smoke-duration: ${duration}ms;
    `;

    block.appendChild(el);
    particles.push(el);
  }

  // Clean up after longest particle finishes
  setTimeout(() => {
    particles.forEach(p => p.remove());
  }, 1000);
}

/**
 * Mark a movie as unseen with poof animation
 */
async function handleMarkUnseen(movie) {
  if (!movie) {
    console.error("No movie provided to mark as unseen");
    return;
  }

  const movieKey = getMovieKey(movie);

  // Check if already marked
  if (state.unseenMovies.includes(movieKey)) {
    console.log("Movie already marked as unseen");
    return;
  }

  // Determine which block to animate
  const side = movie.title === state.currentMovies.A?.title ? "A" : "B";
  const block = document.getElementById(`movie${side}-block`);

  // Add to unseen list + save
  state.unseenMovies.push(movieKey);
  await saveUnseenToFirestore(movieKey);
  console.log(`Marked as unseen: ${movie.title}`);

  // Animate: smoke particles + poof out, then swap + fade in
  if (block) {
    block.style.position = "relative";
    block.style.overflow = "visible";
    spawnSmokeParticles(block);
    block.classList.add("poof-out");

    // Wait for poof-out to finish
    await new Promise(resolve => setTimeout(resolve, 500));

    // Hold invisible while we swap content (prevent flash-back)
    block.style.opacity = "0";
    block.classList.remove("poof-out");

    await replaceMovie(movie);

    // Fade the new movie in
    block.style.opacity = "";
    block.classList.add("poof-in");
    block.addEventListener("animationend", () => {
      block.classList.remove("poof-in");
    }, { once: true });
  } else {
    replaceMovie(movie);
  }
}

// ==========================================
// INITIALIZATION
// ==========================================

/**
 * Load global movie stats from the stats/global doc (single read).
 * This powers competitive matchmaking.
 */
async function loadGlobalMovieStats() {
  try {
    const snap = await getDoc(doc(db, "stats", "global"));
    state.globalStats = snap.exists() ? (snap.data().stats || {}) : {};
    const count = Object.keys(state.globalStats).length;
    console.log(`Loaded global stats for ${count} movies`);
  } catch (error) {
    console.warn("Could not load global movie stats:", error);
    state.globalStats = {};
  }
}

/**
 * Load movie database and start
 */
async function initializeApp() {
  try {
    // Load movie list + global stats in parallel (no auth needed)
    const [moviesRes] = await Promise.all([
      fetch("movie_list_cleaned.json"),
      loadGlobalMovieStats()
    ]);
    state.movies = await moviesRes.json();
    console.log(`Loaded ${state.movies.length} movies`);

    // Wait for auth state, then load user data
    onAuth(async (user) => {
      if (user) {
        state.uid = user.uid;
        await loadUserData(user.uid);
      } else {
        state.uid = null;
        // Guest fallback: load from localStorage
        state.unseenMovies = JSON.parse(localStorage.getItem("unseenMovies")) || [];
        state.seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];
      }

      updateVoteCounter();
      chooseTwoMovies();
    });
  } catch (error) {
    console.error("Failed to load movies:", error);
    alert("Failed to load movie database. Please refresh the page.");
  }
}

/**
 * Update the vote counter on the home page with global Firebase count
 */
async function updateVoteCounter() {
  const el = document.getElementById("home-vote-count");
  if (!el) return;

  try {
    const snap = await getDocs(collection(db, "votes"));
    el.textContent = snap.size.toLocaleString();
  } catch (error) {
    console.warn("Could not fetch global vote count:", error);
    el.textContent = state.seenMatchups.length.toLocaleString();
  }
}

// ==========================================
// GLOBAL EXPORTS (for inline HTML handlers)
// ==========================================

window.vote = handleVote;
window.markUnseen = handleMarkUnseen;

// Expose movie objects for backwards compatibility
Object.defineProperty(window, 'movieA', {
  get: () => state.currentMovies.A
});

Object.defineProperty(window, 'movieB', {
  get: () => state.currentMovies.B
});

// ==========================================
// START THE APP
// ==========================================

window.addEventListener("load", initializeApp);
