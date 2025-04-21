// === Firebase Setup ===
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

// === Global Variables ===
let movies = [];
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats = JSON.parse(localStorage.getItem("movieStats")) || {};
let unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];

let movieA, movieB;

// === Load Movies ===
async function loadMovies() {
  const res = await fetch("movie_list_cleaned.json");
  movies = await res.json();
  chooseTwoMovies();
}

// === Choose Movies ===
function chooseTwoMovies() {
  const available = movies.filter(m => !unseen.includes(m.title));
  if (available.length < 2) return alert("Not enough movies to compare.");

  [movieA, movieB] = available.sort(() => Math.random() - 0.5).slice(0, 2);
  displayMovies();
}

// === Display Movies ===
async function displayMovies() {
  document.getElementById("movieA").textContent = `${movieA.title}`;
  document.getElementById("movieA-year").textContent = `(${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title}`;
  document.getElementById("movieB-year").textContent = `(${movieB.year})`;

  const imgA = document.getElementById("posterA");
  const imgB = document.getElementById("posterB");

  imgA.src = await fetchPosterUrl(movieA.title, movieA.year);
  imgB.src = await fetchPosterUrl(movieB.title, movieB.year);

  document.querySelectorAll('.confetti-container').forEach(e => e.innerHTML = '');
}

// === Fetch Poster from TMDB ===
const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

async function fetchPosterUrl(title, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.results?.[0]?.poster_path)
    ? `${TMDB_IMAGE_BASE}${data.results[0].poster_path}`
    : "fallback.jpg";
}

// === Vote Logic ===
function vote(winner) {
  const winnerTitle = winner === "A" ? movieA.title : movieB.title;
  const loserTitle = winner === "A" ? movieB.title : movieA.title;

  // Firebase log
  db.collection("votes").add({ winner: winnerTitle, loser: loserTitle, timestamp: new Date().toISOString() });

  const votedPoster = document.getElementById(`poster${winner}`);
  votedPoster.classList.add("shake");

  // Confetti burst
  createConfettiBurst(votedPoster.closest(".movie-block"));

  setTimeout(() => votedPoster.classList.remove("shake"), 800);

  // Update stats
  updateStats(winnerTitle, loserTitle);
  seenMatchups.push([movieA.title, movieB.title].sort().join("|"));
  localStorage.setItem("movieStats", JSON.stringify(stats));
  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));

  setTimeout(chooseTwoMovies, 1500);
}

// === Confetti Effect ===
function createConfettiBurst(target) {
  const container = target.querySelector(".confetti-container");
  container.innerHTML = "";
  const colors = ['#1fd2ea', '#8b5cf6', '#d946ef'];

  for (let i = 0; i < 50; i++) {
    const dot = document.createElement("div");
    dot.className = "confetti-dot";
    dot.style.position = "absolute";
    dot.style.width = "8px";
    dot.style.height = "8px";
    dot.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    dot.style.left = "50%";
    dot.style.top = "50%";
    dot.style.borderRadius = "50%";
    dot.style.transform = `translate(-50%, -50%) rotate(${Math.random() * 360}deg)`;
    dot.style.animation = `confettiFall 0.9s ease-out forwards`;
    container.appendChild(dot);
  }
}

// === Stats ===
function updateStats(winner, loser) {
  stats[winner] = stats[winner] || { wins: 0, losses: 0 };
  stats[loser] = stats[loser] || { wins: 0, losses: 0 };
  stats[winner].wins++;
  stats[loser].losses++;
}

// === Haven't Seen ===
function markUnseen(movie) {
  if (!unseen.includes(movie.title)) {
    unseen.push(movie.title);
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    replaceMovie(movie);
  }
}
async function replaceMovie(movieToReplace) {
  const available = movies.filter(m =>
    !unseen.includes(m.title) &&
    m.title !== movieA.title &&
    m.title !== movieB.title
  );

  if (available.length === 0) {
    alert("No more unseen movies to replace with.");
    return;
  }

  const replacement = available[Math.floor(Math.random() * available.length)];

  if (movieToReplace.title === movieA.title) {
    movieA = replacement;
  } else {
    movieB = replacement;
  }

  await displayMovies();
}
// === Start App ===
window.onload = loadMovies;
