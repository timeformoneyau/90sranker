// ranker.js - Modernized and cleaned up
import {
  db,
  auth,
  collection,
  addDoc,
  writeBatch,
  increment,
  serverTimestamp,
  doc
} from "./firebase.js";

import confetti from "https://cdn.skypack.dev/canvas-confetti";

// ==========================================
// STATE MANAGEMENT
// ==========================================

const state = {
  movies: [],
  currentMovies: {
    A: null,
    B: null
  },
  ratings: JSON.parse(localStorage.getItem("movieRatings")) || {},
  stats: JSON.parse(localStorage.getItem("movieStats")) || {},
  unseenMovies: JSON.parse(localStorage.getItem("unseenMovies")) || [],
  seenMatchups: JSON.parse(localStorage.getItem("seenMatchups")) || []
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

/**
 * Save state to localStorage
 */
function saveState() {
  localStorage.setItem("movieRatings", JSON.stringify(state.ratings));
  localStorage.setItem("movieStats", JSON.stringify(state.stats));
  localStorage.setItem("unseenMovies", JSON.stringify(state.unseenMovies));
  localStorage.setItem("seenMatchups", JSON.stringify(state.seenMatchups));
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
 * Select two random movies for comparison
 */
function chooseTwoMovies() {
  const available = getAvailableMovies();
  
  if (available.length < 2) {
    alert("Not enough movies available. Please un-mark some movies from 'Haven't Seen'.");
    return;
  }
  
  // Shuffle and pick first two
  const shuffled = available.sort(() => 0.5 - Math.random());
  state.currentMovies.A = shuffled[0];
  state.currentMovies.B = shuffled[1];
  
  displayMovies();
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
  
  // 2. Update local stats
  updateEloRatings(winner.title, loser.title);
  updateWinLossStats(winner.title, loser.title);
  
  // 3. Track matchup
  const matchupKey = [state.currentMovies.A.title, state.currentMovies.B.title].sort().join("|");
  state.seenMatchups.push(matchupKey);
  
  // 4. Save state
  saveState();
  
  // 5. Celebrate!
  triggerConfetti();
  
  // 6. Load next matchup
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
 * Update ELO ratings
 */
function updateEloRatings(winnerTitle, loserTitle) {
  const ratingA = state.ratings[winnerTitle] || 1000;
  const ratingB = state.ratings[loserTitle] || 1000;
  
  // Expected score for winner
  const expectedScore = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  
  // K-factor of 32 (standard)
  const K = 32;
  
  // Update ratings
  state.ratings[winnerTitle] = Math.round(ratingA + K * (1 - expectedScore));
  state.ratings[loserTitle] = Math.round(ratingB + K * (0 - (1 - expectedScore)));
}

/**
 * Update win/loss statistics
 */
function updateWinLossStats(winnerTitle, loserTitle) {
  // Initialize if needed
  if (!state.stats[winnerTitle]) {
    state.stats[winnerTitle] = { wins: 0, losses: 0 };
  }
  if (!state.stats[loserTitle]) {
    state.stats[loserTitle] = { wins: 0, losses: 0 };
  }
  
  // Update counts
  state.stats[winnerTitle].wins++;
  state.stats[loserTitle].losses++;
}

/**
 * Trigger confetti celebration
 */
function triggerConfetti() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 }
  });
}

// ==========================================
// UNSEEN MOVIE HANDLING
// ==========================================

/**
 * Mark a movie as unseen
 */
function handleMarkUnseen(movie) {
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
  
  // Add to unseen list
  state.unseenMovies.push(movieKey);
  saveState();
  
  console.log(`Marked as unseen: ${movie.title}`);
  
  // Replace with new movie
  replaceMovie(movie);
}

// ==========================================
// INITIALIZATION
// ==========================================

/**
 * Load movie database and start
 */
async function initializeApp() {
  try {
    const response = await fetch("movie_list_cleaned.json");
    state.movies = await response.json();
    
    console.log(`Loaded ${state.movies.length} movies`);
    
    chooseTwoMovies();
  } catch (error) {
    console.error("Failed to load movies:", error);
    alert("Failed to load movie database. Please refresh the page.");
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