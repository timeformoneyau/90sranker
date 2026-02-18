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
  runTransaction,
  doc,
  getDoc,
  updateDoc,
  setDoc,
  arrayUnion,
  arrayRemove,
  getDocs,
  query,
  where
} from "./firebase.js";

import { makeMovieKey } from "./movieKeys.js";

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
  return makeMovieKey(movie.title, movie.year);
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
const movieInfoCache = {}; // keyed by "Title|Year"

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
// MOVIE INFO (TMDB Details)
// ==========================================

/**
 * Fetch detailed movie info from TMDB (with caching)
 */
async function fetchMovieInfo(title, year) {
  const cacheKey = `${title.trim()}|${year}`;
  if (movieInfoCache[cacheKey]) return movieInfoCache[cacheKey];

  // Search for movie ID
  const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  const searchRes = await fetch(searchUrl);
  const searchData = await searchRes.json();
  const movieId = searchData.results?.[0]?.id;
  if (!movieId) throw new Error("Movie not found on TMDB");

  // Fetch details, videos, and credits in parallel
  const [detailRes, videosRes, creditsRes] = await Promise.all([
    fetch(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}`),
    fetch(`https://api.themoviedb.org/3/movie/${movieId}/videos?api_key=${TMDB_API_KEY}`),
    fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${TMDB_API_KEY}`)
  ]);

  const detail = await detailRes.json();
  const videos = await videosRes.json();
  const credits = await creditsRes.json();

  // Find YouTube trailer
  const trailer = videos.results?.find(
    v => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
  );

  const info = {
    overview: detail.overview || null,
    genres: (detail.genres || []).map(g => g.name),
    runtime: detail.runtime || null,
    rating: detail.vote_average || null,
    trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
    cast: (credits.cast || []).slice(0, 5).map(c => c.name)
  };

  movieInfoCache[cacheKey] = info;
  return info;
}

/**
 * Show movie info modal
 */
async function showMovieInfo(choice) {
  const movie = state.currentMovies[choice];
  if (!movie) return;

  const modal = document.getElementById("movie-info-modal");
  const titleEl = document.getElementById("info-modal-title");
  const bodyEl = document.getElementById("info-modal-body");

  titleEl.textContent = `${movie.title} (${movie.year})`;
  bodyEl.innerHTML = '<div class="info-modal-loading">Loading...</div>';
  modal.classList.remove("hidden");

  try {
    const info = await fetchMovieInfo(movie.title, movie.year);

    let html = '';

    // Overview
    html += `<p class="info-modal-overview">${info.overview || "No summary available."}</p>`;

    // Meta row: genres, runtime, rating
    html += '<div class="info-modal-meta">';
    if (info.genres.length > 0) {
      html += '<div class="info-modal-genres">';
      info.genres.forEach(g => {
        html += `<span class="info-genre-tag">${g}</span>`;
      });
      html += '</div>';
    }
    if (info.runtime) {
      html += `<span class="info-modal-runtime">${info.runtime} min</span>`;
    }
    if (info.rating) {
      html += `<span class="info-modal-rating">★ ${info.rating.toFixed(1)}</span>`;
    }
    html += '</div>';

    // Cast
    if (info.cast && info.cast.length > 0) {
      html += `<div class="info-modal-cast">Cast: ${info.cast.join(', ')}</div>`;
    }

    // Trailer button
    if (info.trailerUrl) {
      html += `<a href="${info.trailerUrl}" target="_blank" rel="noopener noreferrer" class="info-modal-trailer-btn">▶ Watch Trailer</a>`;
    }

    bodyEl.innerHTML = html;
  } catch (error) {
    console.error("Failed to fetch movie info:", error);
    bodyEl.innerHTML = '<p class="info-modal-error">Could not load movie info. Please try again.</p>';
  }
}

/**
 * Close movie info modal
 */
function closeMovieInfo() {
  document.getElementById("movie-info-modal").classList.add("hidden");
}

// Close modal on backdrop click
document.addEventListener("click", (e) => {
  if (e.target.id === "movie-info-modal") closeMovieInfo();
});

// Close modal on Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMovieInfo();
});

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
let initialLoadDone = false;

async function chooseTwoMovies() {
  const available = getAvailableMovies();

  if (available.length < 2) {
    alert("Not enough movies available. Please un-mark some movies from your Unwatched List.");
    return;
  }

  // On first call only (page load), restore last matchup from sessionStorage
  if (!initialLoadDone) {
    initialLoadDone = true;
    try {
      const saved = sessionStorage.getItem("currentMatchup");
      if (saved) {
        const { a, b } = JSON.parse(saved);
        const movieA = available.find(m => getMovieKey(m) === a);
        const movieB = available.find(m => getMovieKey(m) === b);
        if (movieA && movieB) {
          [state.currentMovies.A, state.currentMovies.B] = [movieA, movieB];
          await displayMovies();
          return;
        }
      }
    } catch { /* ignore parse errors */ }
  }

  // Try competitive match ~30% of the time
  if (state.globalStats && Math.random() < 0.3) {
    const pair = pickCompetitiveMatch(available);
    if (pair) {
      [state.currentMovies.A, state.currentMovies.B] = pair;
      await displayMovies();
      return;
    }
  }

  // Default: pure random
  [state.currentMovies.A, state.currentMovies.B] = pickTwoRandom(available);
  await displayMovies();
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
/**
 * Preload an image and resolve when it's decoded (ready to paint).
 * Falls back after 4s to avoid blocking forever on slow networks.
 */
function preloadImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    const timeout = setTimeout(() => resolve(url), 4000);
    img.onload = () => { clearTimeout(timeout); resolve(url); };
    img.onerror = () => { clearTimeout(timeout); resolve(url); };
    img.src = url;
  });
}

async function displayMovies() {
  const { A, B } = state.currentMovies;

  if (!A || !B) {
    console.error("No movies to display");
    return;
  }

  try {
    // Fetch poster URLs and preload images in parallel — wait for both
    // to be fully decoded before touching the DOM at all
    const [posterA, posterB] = await Promise.all([
      fetchPosterUrl(A.title, A.year),
      fetchPosterUrl(B.title, B.year)
    ]);
    await Promise.all([preloadImage(posterA), preloadImage(posterB)]);

    // All assets ready — update DOM in one synchronous batch
    document.getElementById("movieA").textContent = A.title;
    document.getElementById("movieA-year").textContent = A.year;
    document.getElementById("movieB").textContent = B.title;
    document.getElementById("movieB-year").textContent = B.year;

    document.getElementById("posterA").src = posterA;
    document.getElementById("posterB").src = posterB;

    const btnA = document.getElementById("posterBtnA");
    const btnB = document.getElementById("posterBtnB");
    if (btnA) btnA.setAttribute("aria-label", `Select ${A.title}`);
    if (btnB) btnB.setAttribute("aria-label", `Select ${B.title}`);

    // Persist current matchup so it survives page refresh
    try {
      sessionStorage.setItem("currentMatchup", JSON.stringify({
        a: getMovieKey(A),
        b: getMovieKey(B)
      }));
    } catch { /* sessionStorage may be unavailable */ }
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
// CONFETTI — lightweight DOM-based burst
// ==========================================

function spawnConfetti(originEl) {
  // Respect prefers-reduced-motion
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const rect = originEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height * 0.3;

  const container = document.createElement("div");
  container.className = "confetti-container";
  document.body.appendChild(container);

  const colors = ["#e8a317", "#d4543a", "#4ea8de", "#5ebd72", "#c084fc", "#f472b6"];
  const count = 55;

  for (let i = 0; i < count; i++) {
    const dot = document.createElement("div");
    dot.className = "confetti-dot";
    dot.style.background = colors[i % colors.length];
    dot.style.left = cx + "px";
    dot.style.top = cy + "px";

    // Mixed shapes and sizes
    const size = 5 + Math.random() * 5;
    const isRect = Math.random() > 0.5;
    dot.style.width = size + "px";
    dot.style.height = (isRect ? size * 1.6 : size) + "px";
    dot.style.borderRadius = isRect ? "2px" : "50%";

    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const dist = 80 + Math.random() * 160;
    const endX = Math.cos(angle) * dist;
    const endY = Math.sin(angle) * dist - 50;

    dot.style.setProperty("--end-x", endX + "px");
    dot.style.setProperty("--end-y", endY + "px");
    dot.style.setProperty("--spin", (Math.random() * 360 - 180) + "deg");
    const delay = Math.random() * 150;
    dot.style.animation = `confettiFall ${500 + Math.random() * 400}ms ease-in ${delay}ms forwards`;
    dot.style.opacity = "0";
    dot.style.animationFillMode = "forwards";

    container.appendChild(dot);
  }

  setTimeout(() => container.remove(), 1200);
}

// ==========================================
// VOTING LOGIC
// ==========================================

/**
 * Disable/enable matchup buttons during transition to prevent double-clicks
 */
function setMatchupButtonsDisabled(disabled) {
  const section = document.getElementById("compare-section");
  if (!section) return;
  section.querySelectorAll(".btn-select, .btn-undecided, .btn-unseen, .btn-remind, .poster-btn").forEach(btn => {
    btn.disabled = disabled;
  });
}

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

  // 3. Record both movies as inferred-seen
  const movieAKey = getMovieKey(state.currentMovies.A);
  const movieBKey = getMovieKey(state.currentMovies.B);
  recordInferredSeen(movieAKey, movieBKey);

  // 4. Update vote counter
  updateVoteCounter();

  // 5. Disable buttons to prevent double-clicks
  setMatchupButtonsDisabled(true);

  // 6. Brief highlight on chosen poster, winner dance, confetti burst, then cinematic fade transition
  const chosenPoster = document.getElementById(choice === "A" ? "posterA" : "posterB");
  if (chosenPoster) {
    chosenPoster.classList.add("poster-selected", "poster-winner-dance");
    spawnConfetti(chosenPoster);
  }

  const section = document.getElementById("compare-section");

  // Wait for the highlight moment (350ms), then fade out
  await new Promise(r => setTimeout(r, 350));

  if (section) {
    section.classList.add("matchup-fade-out");
    await new Promise(r => setTimeout(r, 450));
    if (chosenPoster) chosenPoster.classList.remove("poster-selected", "poster-winner-dance");
    await chooseTwoMovies();
    section.classList.remove("matchup-fade-out");
    section.classList.add("matchup-fade-in");
    section.addEventListener("animationend", () => {
      section.classList.remove("matchup-fade-in");
      setMatchupButtonsDisabled(false);
    }, { once: true });
  } else {
    if (chosenPoster) chosenPoster.classList.remove("poster-selected", "poster-winner-dance");
    await chooseTwoMovies();
    setMatchupButtonsDisabled(false);
  }
}

/**
 * Save vote to Firestore
 */
async function saveVoteToFirestore(winner, loser) {
  try {
    const winnerKey = getMovieKey(winner);
    const loserKey = getMovieKey(loser);
    const uid = auth.currentUser?.uid || null;

    // 1. Audit log — individual vote doc (append-only, never scanned by UI)
    await addDoc(collection(db, "votes"), {
      winner: winnerKey,
      loser: loserKey,
      user: uid,
      timestamp: serverTimestamp()
    });

    // 2. Update aggregate stats atomically
    const batch = writeBatch(db);

    // Global per-movie stats
    const globalRef = doc(db, "stats", "global");
    batch.set(globalRef, {
      [`stats.${winnerKey}.wins`]: increment(1),
      [`stats.${loserKey}.losses`]: increment(1)
    }, { merge: true });

    // Per-user per-movie stats
    if (uid) {
      const userStatsRef = doc(db, "stats", `user_${uid}`);
      batch.set(userStatsRef, {
        [`stats.${winnerKey}.wins`]: increment(1),
        [`stats.${loserKey}.losses`]: increment(1)
      }, { merge: true });
    }

    // Meta counters
    const metaRef = doc(db, "stats", "meta");
    batch.set(metaRef, {
      totalVotes: increment(1)
    }, { merge: true });

    await batch.commit();

    console.log("Vote saved to Firestore");
  } catch (error) {
    console.error("Failed to save vote to Firestore:", error);
  }
}


// ==========================================
// UNSEEN MOVIE HANDLING
// ==========================================

/**
 * Mark a movie as unseen with cinematic fade animation
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

  // Animate: cinematic fade out, then swap + fade in
  if (block) {
    block.classList.add("matchup-fade-out");

    // Wait for fade-out to finish
    await new Promise(resolve => setTimeout(resolve, 450));

    block.style.opacity = "0";
    block.classList.remove("matchup-fade-out");

    await replaceMovie(movie);

    // Fade the new movie in
    block.style.opacity = "";
    block.classList.add("matchup-fade-in");
    block.addEventListener("animationend", () => {
      block.classList.remove("matchup-fade-in");
    }, { once: true });
  } else {
    replaceMovie(movie);
  }
}

// ==========================================
// INFERRED SEEN TRACKING
// ==========================================

/**
 * After every vote, mark both movies as inferred-seen.
 * Also prune them from the unseen list if present.
 */
async function recordInferredSeen(movieAKey, movieBKey) {
  const keys = [movieAKey, movieBKey];

  if (state.uid) {
    // Logged in: update Firestore user doc
    try {
      const updates = {
        inferredSeen: arrayUnion(...keys)
      };
      // If either key is in the unseen list, remove it
      const unseenToRemove = keys.filter(k => state.unseenMovies.includes(k));
      if (unseenToRemove.length > 0) {
        updates.seen = arrayRemove(...unseenToRemove);
      }
      await setDoc(doc(db, "users", state.uid), updates, { merge: true });
    } catch (error) {
      console.error("Failed to record inferred seen:", error);
    }
  } else {
    // Guest: update localStorage
    const inferredSeen = JSON.parse(localStorage.getItem("inferredSeenMovies")) || [];
    for (const k of keys) {
      if (!inferredSeen.includes(k)) inferredSeen.push(k);
    }
    localStorage.setItem("inferredSeenMovies", JSON.stringify(inferredSeen));

    // Prune from unseen localStorage
    const unseenMovies = JSON.parse(localStorage.getItem("unseenMovies")) || [];
    const pruned = unseenMovies.filter(k => !keys.includes(k));
    if (pruned.length !== unseenMovies.length) {
      localStorage.setItem("unseenMovies", JSON.stringify(pruned));
    }
  }

  // Also prune local state
  state.unseenMovies = state.unseenMovies.filter(k => !keys.includes(k));
}

/**
 * One-time backfill: populate inferredSeen from all historical votes.
 * Skips if already done (checks inferredSeenBackfilled flag).
 */
async function backfillInferredSeen(uid) {
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists() && userSnap.data().inferredSeenBackfilled) return;

    const snap = await getDocs(query(
      collection(db, "votes"),
      where("user", "==", uid)
    ));

    const seenKeys = new Set();
    snap.forEach(d => {
      const { winner, loser } = d.data();
      if (winner) seenKeys.add(winner);
      if (loser) seenKeys.add(loser);
    });

    if (seenKeys.size === 0) return;

    const keysArray = [...seenKeys];

    // Firestore arrayUnion has a limit of ~30 per call, batch in chunks
    const CHUNK = 20;
    for (let i = 0; i < keysArray.length; i += CHUNK) {
      const chunk = keysArray.slice(i, i + CHUNK);
      const updates = { inferredSeen: arrayUnion(...chunk) };

      // On first chunk, also prune unseen list
      if (i === 0) {
        const unseenToRemove = chunk.filter(k => state.unseenMovies.includes(k));
        if (unseenToRemove.length > 0) {
          updates.seen = arrayRemove(...unseenToRemove);
        }
      } else {
        const unseenToRemove = chunk.filter(k => state.unseenMovies.includes(k));
        if (unseenToRemove.length > 0) {
          updates.seen = arrayRemove(...unseenToRemove);
        }
      }

      await setDoc(userRef, updates, { merge: true });
    }

    // Set flag so this doesn't run again
    await setDoc(userRef, { inferredSeenBackfilled: true }, { merge: true });

    // Prune local state
    state.unseenMovies = state.unseenMovies.filter(k => !seenKeys.has(k));

    console.log(`Backfilled inferredSeen with ${seenKeys.size} movies from ${snap.size} votes`);
  } catch (error) {
    console.error("Failed to backfill inferredSeen:", error);
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
    const allMovies = await moviesRes.json();
    state.movies = allMovies.filter(m => m.title && m.year && !/^title$/i.test(m.title.trim()));
    console.log(`Loaded ${state.movies.length} movies (filtered ${allMovies.length - state.movies.length} junk)`);

    // Wait for auth state, then load user data
    onAuth(async (user) => {
      if (user) {
        state.uid = user.uid;
        await loadUserData(user.uid);
        backfillInferredSeen(user.uid);
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

// ==========================================
// FLIP COUNTER (Analog Alarm Clock)
// ==========================================

const flipCounter = {
  el: null,
  currentValue: 0,
  currentDigits: [],
  animating: false,
  queued: null,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,

  init(containerEl, value) {
    this.el = containerEl;
    this.currentValue = value;
    this.currentDigits = this._toDigits(value);
    this._render(this.currentDigits);
  },

  update(newValue) {
    if (newValue === this.currentValue) return;
    if (this.animating) {
      this.queued = newValue;
      return;
    }
    this._animate(newValue);
  },

  _toDigits(n) {
    const str = String(n);
    return str.split("").map(ch => ch);
  },

  _render(digits) {
    if (!this.el) return;
    this.el.innerHTML = "";
    // Insert commas for thousands grouping
    const formatted = Number(digits.join("")).toLocaleString();
    for (const ch of formatted) {
      if (ch === ",") {
        const sep = document.createElement("div");
        sep.className = "flip-separator";
        sep.textContent = ",";
        this.el.appendChild(sep);
      } else {
        this.el.appendChild(this._createDigitEl(ch));
      }
    }
  },

  _createDigitEl(digit) {
    const el = document.createElement("div");
    el.className = "flip-digit";
    el.dataset.digit = digit;
    el.innerHTML = `
      <div class="panel top"><span>${digit}</span></div>
      <div class="panel bottom"><span>${digit}</span></div>
      <div class="flip top-flip"><span>${digit}</span></div>
      <div class="flip bottom-flip"><span>${digit}</span></div>
    `;
    return el;
  },

  _animate(newValue) {
    this.animating = true;
    const newDigits = this._toDigits(newValue);
    const oldDigits = this.currentDigits;

    // If digit count changed, re-render entirely then flip changed digits
    const oldFormatted = Number(oldDigits.join("")).toLocaleString();
    const newFormatted = Number(newDigits.join("")).toLocaleString();

    if (oldFormatted.length !== newFormatted.length) {
      // Re-render with new structure, then flip all digits
      this._render(newDigits);
      this.currentValue = newValue;
      this.currentDigits = newDigits;
      this.animating = false;
      this._processQueue();
      return;
    }

    // Same structure: flip only changed digit positions
    const digitEls = this.el.querySelectorAll(".flip-digit");
    const oldChars = oldFormatted.replace(/,/g, "");
    const newChars = newFormatted.replace(/,/g, "");
    let flipCount = 0;
    let flipsCompleted = 0;

    digitEls.forEach((el, i) => {
      const oldD = oldChars[i];
      const newD = newChars[i];
      if (oldD === newD) return;

      flipCount++;

      if (this.reducedMotion) {
        // Instant update, no animation
        el.querySelector(".panel.top span").textContent = newD;
        el.querySelector(".panel.bottom span").textContent = newD;
        el.dataset.digit = newD;
        flipsCompleted++;
        if (flipsCompleted === flipCount) this._finishAnimate(newValue, newDigits);
        return;
      }

      // Set up flip overlays
      el.querySelector(".top-flip span").textContent = oldD; // old digit folds away
      el.querySelector(".bottom-flip span").textContent = newD; // new digit unfolds

      // Trigger animation
      el.classList.add("flipping");

      const onEnd = () => {
        el.classList.remove("flipping");
        // Update static panels to new digit
        el.querySelector(".panel.top span").textContent = newD;
        el.querySelector(".panel.bottom span").textContent = newD;
        // Reset flip overlays
        el.querySelector(".top-flip").style.opacity = "0";
        el.querySelector(".bottom-flip").style.opacity = "0";
        el.dataset.digit = newD;

        // Momentum overshoot
        el.classList.add("momentum");
        setTimeout(() => el.classList.remove("momentum"), 320);

        flipsCompleted++;
        if (flipsCompleted === flipCount) {
          this._finishAnimate(newValue, newDigits);
        }
      };

      // Listen for the bottom-flip animation end (it finishes last)
      const bottomFlip = el.querySelector(".bottom-flip");
      bottomFlip.addEventListener("animationend", onEnd, { once: true });

      // Fallback timeout in case animationend doesn't fire
      setTimeout(() => {
        if (flipsCompleted < flipCount && el.classList.contains("flipping")) {
          onEnd();
        }
      }, 700);
    });

    // If no digits changed (shouldn't happen), finish immediately
    if (flipCount === 0) {
      this._finishAnimate(newValue, newDigits);
    }
  },

  _finishAnimate(newValue, newDigits) {
    this.currentValue = newValue;
    this.currentDigits = newDigits;
    this.animating = false;
    this._processQueue();
  },

  _processQueue() {
    if (this.queued !== null) {
      const next = this.queued;
      this.queued = null;
      this.update(next);
    }
  }
};

/**
 * Update the vote counter on the home page from stats/meta (1 read)
 */
async function updateVoteCounter() {
  const el = document.getElementById("home-vote-count");
  if (!el) return;

  try {
    const snap = await getDoc(doc(db, "stats", "meta"));
    const total = snap.exists() ? (snap.data().totalVotes || 0) : 0;

    if (!flipCounter.el) {
      flipCounter.init(el, total);
    } else {
      flipCounter.update(total);
    }
  } catch (error) {
    console.warn("Could not fetch global vote count:", error);
    const fallback = state.seenMatchups.length;
    if (!flipCounter.el) {
      flipCounter.init(el, fallback);
    } else {
      flipCounter.update(fallback);
    }
  }
}

// ==========================================
// TOUGH CALL FLAGGING
// ==========================================

/**
 * Build a canonical stable ID for a matchup of two movies.
 * Sorts the two keys lexicographically to avoid duplicates.
 */
function makeToughCallId(keyA, keyB) {
  return keyA < keyB ? `${keyA}__${keyB}` : `${keyB}__${keyA}`;
}

/**
 * Mark the current matchup as "Undecided" — sends it to the community queue.
 * Does NOT count as a vote. Advances to next matchup with cinematic fade.
 */
async function handleUndecided() {
  const { A, B } = state.currentMovies;
  if (!A || !B) return;

  const keyA = getMovieKey(A);
  const keyB = getMovieKey(B);
  const tcId = makeToughCallId(keyA, keyB);
  const minKey = keyA < keyB ? keyA : keyB;
  const maxKey = keyA < keyB ? keyB : keyA;
  const uid = state.uid;

  // Record both movies as inferred-seen (user saw the matchup)
  recordInferredSeen(keyA, keyB);

  // Track matchup so user doesn't see it again immediately
  const matchupKey = [A.title, B.title].sort().join("|");
  state.seenMatchups.push(matchupKey);
  saveMatchupToFirestore(matchupKey);

  // Upsert to toughCalls collection
  if (uid) {
    console.log(`Face / Off: writing tough call ${tcId} for user ${uid}`);
    const tcRef = doc(db, "toughCalls", tcId);
    try {
      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(tcRef);
        const now = new Date();
        if (snap.exists()) {
          const data = snap.data();
          transaction.update(tcRef, {
            flagCount: (data.flagCount || 0) + 1,
            lastFlaggedAt: now,
            [`flaggedBy.${uid}`]: true
          });
        } else {
          transaction.set(tcRef, {
            movieAKey: minKey,
            movieBKey: maxKey,
            createdAt: now,
            createdByUid: uid,
            createdByName: auth.currentUser?.displayName || auth.currentUser?.email || "",
            flagCount: 1,
            lastFlaggedAt: now,
            flaggedBy: { [uid]: true },
            votesA: 0,
            votesB: 0,
            totalVotes: 0
          });
        }
      });
      console.log(`Face / Off: successfully wrote tough call ${tcId}`);
    } catch (err) {
      console.error("Failed to flag tough call:", err);
    }
  } else {
    console.warn("Face / Off: skipped write — no uid (user not logged in)");
  }

  // Disable buttons to prevent double-clicks
  setMatchupButtonsDisabled(true);

  // VHS eject + static sweep animation, then advance
  await triggerFaceOffAnimation();

  // Fade out → load next matchup → fade in
  const section = document.getElementById("compare-section");
  if (section) {
    section.classList.add("matchup-fade-out");
    await new Promise(r => setTimeout(r, 200));
    await chooseTwoMovies();
    section.classList.remove("matchup-fade-out");
    section.classList.add("matchup-fade-in");
    section.addEventListener("animationend", () => {
      section.classList.remove("matchup-fade-in");
      setMatchupButtonsDisabled(false);
    }, { once: true });
  } else {
    await chooseTwoMovies();
    setMatchupButtonsDisabled(false);
  }
}

/**
 * VHS eject + static sweep animation for Face / Off.
 * Resolves when the animation is complete (~350ms total).
 */
function triggerFaceOffAnimation() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    // 1. Poster eject — apply to both poster buttons
    const posterA = document.getElementById("posterBtnA");
    const posterB = document.getElementById("posterBtnB");
    [posterA, posterB].forEach(el => {
      if (!el) return;
      el.classList.remove("vhs-eject");
      void el.offsetWidth;
      el.classList.add("vhs-eject");
    });

    // 2. Static sweep overlay
    const flash = document.getElementById("faceoff-flash");
    if (flash) {
      flash.classList.remove("active");
      void flash.offsetWidth;
      flash.classList.add("active");
    }

    // 3. Resolve after animation completes (~350ms)
    setTimeout(() => {
      [posterA, posterB].forEach(el => el?.classList.remove("vhs-eject"));
      if (flash) flash.classList.remove("active");
      resolve();
    }, 350);
  });
}

// ==========================================
// GLOBAL EXPORTS (for inline HTML handlers)
// ==========================================

window.vote = handleVote;
window.markUnseen = handleMarkUnseen;
window.showMovieInfo = showMovieInfo;
window.closeMovieInfo = closeMovieInfo;
window.handleUndecided = handleUndecided;

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
