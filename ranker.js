// ===== Firebase Setup =====
const firebaseConfig = {
  apiKey: "AIzaSyApkVMpbaHkUEZU0H8tW3vzxaM2DYxPdwM",
  authDomain: "sranker-f2642.firebaseapp.com",
  projectId: "sranker-f2642",
  storageBucket: "sranker-f2642.appspot.com",
  messagingSenderId: "601665183803",
  appId: "1:601665183803:web:705a2ebeeb43b672ef3c1e",
  measurementId: "G-JTG8MVCW64"
};

// Initialize Firebase (must match script version in index.html)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ===== App Logic (unchanged except displayMovies and vote) =====

let movies = [];
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats   = JSON.parse(localStorage.getItem("movieStats"))   || {};
let unseen  = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];
let tags    = JSON.parse(localStorage.getItem("movieTags"))    || {};

let movieA, movieB;
const TAG_OPTIONS   = ["Nostalgic Favorite", "Dumb Awesome", "Top 50"];
const DEFAULT_RATING = 1000;
const K = 32;

const TMDB_API_KEY      = '825459de57821b3ab63446cce9046516';
const TMDB_IMAGE_BASE   = 'https://image.tmdb.org/t/p/w500';
const TMDB_MOVIE_URL    = 'https://www.themoviedb.org/movie/';

// … loadMovies, getAvailableMovies, chooseTwoMovies, getTier, fetchPosterUrl stay the same …

async function displayMovies() {
  // set titles
  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;

  // fetch & set poster images
  const imgA = document.getElementById("posterA");
  const imgB = document.getElementById("posterB");
  imgA.src = await fetchPosterUrl(movieA.title, movieA.year);
  imgB.src = await fetchPosterUrl(movieB.title, movieB.year);

  // ── NEW: Populate the link hrefs ──
  // Requires <a id="linkA"> and <a id="linkB"> wrapping each poster/title
  const linkA = document.getElementById("linkA");
  const linkB = document.getElementById("linkB");
  if (linkA && movieA.id) {
    linkA.href = `${TMDB_MOVIE_URL}${movieA.id}`;
  }
  if (linkB && movieB.id) {
    linkB.href = `${TMDB_MOVIE_URL}${movieB.id}`;
  }
  // ────────────────────────────────────

  // remove any old confetti containers
  document.querySelectorAll('.confetti-container').forEach(e => e.remove());
}

// … vote, createConfettiBurst, updateElo, updateStats, markUnseen, replaceMovie stay the same …

window.onload = loadMovies;

// … alignScreen code for the vr-screen overlay (unchanged) …
