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

let movies = [];
let movieA, movieB;
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats = JSON.parse(localStorage.getItem("movieStats")) || {};
let unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];

const TMDB_API_KEY = '825459de57821b3ab63446cce9046516';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const DEFAULT_RATING = 1000;
const K = 32;

window.onload = loadMovies;
window.vote = vote;
window.markUnseen = markUnseen;

async function loadMovies() {
  const res = await fetch("movie_list_cleaned.json");
  movies = await res.json();
  chooseTwoMovies();
}

function getAvailableMovies(exclude = []) {
  return movies.filter(
    m => m.title && !unseen.includes(m.title) && !exclude.includes(m.title)
  );
}

function chooseTwoMovies() {
  const available = getAvailableMovies();
  if (available.length < 2) return alert("Not enough unseen movies to compare.");

  const shuffled = available.sort(() => 0.5 - Math.random());
  [movieA, movieB] = shuffled.slice(0, 2);
  displayMovies();
}

async function fetchPosterUrl(title, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data?.results?.[0]?.poster_path
      ? TMDB_IMAGE_BASE + data.results[0].poster_path
      : "fallback.jpg";
  } catch {
    return "fallback.jpg";
  }
}

async function displayMovies() {
  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;

  document.getElementById("posterA").src = await fetchPosterUrl(movieA.title, movieA.year);
  document.getElementById("posterB").src = await fetchPosterUrl(movieB.title, movieB.year);
}

function vote(winnerKey) {
  const winner = winnerKey === "A" ? movieA : movieB;
  const loser = winnerKey === "A" ? movieB : movieA;

  console.log("📨 Sending vote:", { winner: winner.title, loser: loser.title });

  db.collection("votes").add({
    winner: winner.title,
    loser: loser.title,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    userAgent: navigator.userAgent
  })
  .then(() => console.log("✅ Vote recorded in Firebase"))
  .catch(err => console.error("❌ Firebase vote error:", err));

  updateElo(winner.title, loser.title);
  updateStats(winner.title, loser.title);
  seenMatchups.push([movieA.title, movieB.title].sort().join("|"));

  localStorage.setItem("movieRatings", JSON.stringify(ratings));
  localStorage.setItem("movieStats", JSON.stringify(stats));
  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));

  setTimeout(chooseTwoMovies, 1200);
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

function markUnseen(movie) {
  if (!movie || !movie.title || unseen.includes(movie.title)) return;
  unseen.push(movie.title);
  localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  replaceMovie(movie);
}

async function replaceMovie(movieToReplace) {
  const available = getAvailableMovies([movieA.title, movieB.title]);
  if (!available.length) return alert("No more movies available.");

  const replacement = available[Math.floor(Math.random() * available.length)];
  if (movieToReplace.title === movieA.title) {
    movieA = replacement;
  } else {
    movieB = replacement;
  }
  await displayMovies();
}
