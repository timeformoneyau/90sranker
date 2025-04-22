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

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Optional: Enable offline persistence
firebase.firestore().enablePersistence()
  .then(() => console.log("✅ Offline persistence enabled"))
  .catch(err => console.warn("⚠️ Offline persistence not available:", err.code));

// ===== Global App State =====
let movies = [];
let movieA, movieB;
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats = JSON.parse(localStorage.getItem("movieStats")) || {};
let unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];
let tags = JSON.parse(localStorage.getItem("movieTags")) || {};

const K = 32;
const DEFAULT_RATING = 1000;
const TMDB_API_KEY = '825459de57821b3ab63446cce9046516';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// ===== Load Movies =====
async function loadMovies() {
  try {
    const res = await fetch("movie_list_cleaned.json");
    if (!res.ok) throw new Error("Failed to load movie list.");
    movies = await res.json();
    chooseTwoMovies();
  } catch (err) {
    console.error("Movie load error:", err);
    alert("Movie list could not be loaded.");
  }
}

function getAvailableMovies(exclude = []) {
  return movies.filter(m => m.title && !unseen.includes(m.title) && !exclude.includes(m.title));
}

function chooseTwoMovies() {
  const available = getAvailableMovies();
  if (available.length < 2) return alert("Not enough unseen movies.");

  [movieA, movieB] = available.sort(() => 0.5 - Math.random()).slice(0, 2);
  displayMovies();
}

// ===== Display =====
async function fetchPosterUrl(title, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.results?.[0]?.poster_path ? TMDB_IMAGE_BASE + data.results[0].poster_path : "fallback.jpg";
  } catch {
    return "fallback.jpg";
  }
}

async function displayMovies() {
  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;

  document.getElementById("posterA").src = await fetchPosterUrl(movieA.title, movieA.year);
  document.getElementById("posterB").src = await fetchPosterUrl(movieB.title, movieB.year);

  document.querySelectorAll('.confetti-container').forEach(e => e.remove());
}

// ===== Voting =====
function vote(winnerKey) {
  const winner = winnerKey === "A" ? movieA : movieB;
  const loser = winnerKey === "A" ? movieB : movieA;

  console.log("📨 Voting:", winner.title, "over", loser.title);

  db.collection("votes").add({
    winner: winner.title,
    loser: loser.title,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    userAgent: navigator.userAgent,
    clientTime: new Date().toISOString()
  }).then(() => {
    console.log("✅ Vote logged to Firebase");
  }).catch(err => {
    console.error("❌ Firebase vote error:", err);
  });

  const votedPoster = document.getElementById(`poster${winnerKey}`);
  votedPoster.classList.add("popcorn-shake");
  createConfettiBurst(votedPoster.parentElement);
  setTimeout(() => votedPoster.classList.remove("popcorn-shake"), 700);

  updateElo(winner.title, loser.title);
  updateStats(winner.title, loser.title);
  seenMatchups.push([movieA.title, movieB.title].sort().join("|"));

  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));
  localStorage.setItem("movieRatings", JSON.stringify(ratings));
  localStorage.setItem("movieStats", JSON.stringify(stats));

  setTimeout(chooseTwoMovies, 1500);
}

function updateElo(winner, loser) {
  const Ra = ratings[winner] || DEFAULT_RATING;
  const Rb = ratings[loser] || DEFAULT_RATING;
  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
  ratings[winner] = Math.round(Ra + K * (1 - Ea));
  ratings[loser] = Math.round(Rb + K * (0 - (1 - Ea)));
}

function updateStats(winner, loser) {
  stats[winner] = stats[winner] || { wins: 0, losses: 0 };
  stats[loser] = stats[loser] || { wins: 0, losses: 0 };
  stats[winner].wins++;
  stats[loser].losses++;
}

// ===== Confetti Animation =====
function createConfettiBurst(element) {
  const container = document.createElement("div");
  container.className = "confetti-container";
  container.style.cssText = "position:absolute;top:50%;left:50%;width:0;height:0;pointer-events:none;z-index:200;";
  const colors = ['#ff3b3b', '#ffc107', '#4caf50', '#03a9f4', '#e91e63', '#9c27b0'];

  for (let i = 0; i < 100; i++) {
    const dot = document.createElement("div");
    dot.className = "confetti-piece";
    dot.style.cssText = `
      position:absolute;
      width:12px;height:16px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      opacity:0;
      border-radius:2px;
      transform-origin:center;
    `;
    const angle = Math.random() * Math.PI * 2;
    const distance = 150 + Math.random() * 300;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const rotation = Math.random() * 1440 - 720;
    const delay = Math.random() * 0.2;

    dot.style.animation = `confettiBurst 1.3s ease-out forwards`;
    dot.style.animationDelay = `${delay}s`;
    dot.style.setProperty('--x', `${x}px`);
    dot.style.setProperty('--y', `${y}px`);
    dot.style.setProperty('--r', `${rotation}deg`);

    container.appendChild(dot);
  }

  element.appendChild(container);
  setTimeout(() => container.remove(), 1600);
}

// ===== Unseen =====
function markUnseen(movie) {
  if (!movie || !movie.title || unseen.includes(movie.title)) return;
  unseen.push(movie.title);
  localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  replaceMovie(movie);
}

async function replaceMovie(movieToReplace) {
  const available = getAvailableMovies([movieA.title, movieB.title]);
  if (!available.length) return alert("No more movies to replace with.");
  const replacement = available[Math.floor(Math.random() * available.length)];
  if (movieToReplace.title === movieA.title) movieA = replacement;
  else movieB = replacement;
  await displayMovies();
}

// ===== Health Check =====
function checkFirebaseHealth() {
  console.log("⏳ Checking Firebase...");
  db.collection("health").add({
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => console.log("✅ Firebase is connected"))
    .catch(err => console.error("❌ Firebase health check failed:", err));
}

// ===== Start =====
window.onload = loadMovies;
window.vote = vote;
window.markUnseen = markUnseen;
window.checkFirebaseHealth = checkFirebaseHealth;
