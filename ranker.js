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

// ===== App State =====
let movies = [];
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats   = JSON.parse(localStorage.getItem("movieStats"))   || {};
let unseen  = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];
let movieA, movieB;

const DEFAULT_RATING   = 1000;
const K                = 32;
const TMDB_API_KEY     = '825459de57821b3ab63446cce9046516';
const TMDB_IMAGE_BASE  = 'https://image.tmdb.org/t/p/w500';
const TMDB_SEARCH_BASE = 'https://www.themoviedb.org/search?query=';

// ===== Load & Kickoff =====
async function loadMovies() {
  try {
    const res = await fetch("movie_list_cleaned.json");
    if (!res.ok) throw new Error("Could not load movie_list_cleaned.json");
    movies = await res.json();
    if (!movies.length) return alert("Movie list empty!");

    // If you have other pages:
    if (document.getElementById("ranking-list"))   updateRanking();
    if (document.getElementById("unseen-list"))    updateUnseenList();
    if (document.getElementById("tagged-list"))    updateTaggedList();

    chooseTwoMovies();
  } catch (err) {
    console.error(err);
    alert("Error loading movies, see console.");
  }
}

// ===== Movie Selection =====
function getAvailableMovies(exclude = []) {
  return movies.filter(
    m => m.title && !unseen.includes(m.title) && !exclude.includes(m.title)
  );
}

function chooseTwoMovies() {
  const avail = getAvailableMovies();
  if (avail.length < 2) return alert("Not enough movies!");

  // pick two random unseen, non‑repeated
  let [a, b] = avail.sort(() => 0.5 - Math.random()).slice(0, 2);
  movieA = a;
  movieB = b;

  displayMovies();
}

// ===== Poster Fetch =====
async function fetchPosterUrl(title, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}`
            + `&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.results && data.results[0] && data.results[0].poster_path) {
      return TMDB_IMAGE_BASE + data.results[0].poster_path;
    }
  } catch (e) {
    console.warn("TMDB lookup failed for", title, year, e);
  }
  // fallback placeholder if lookup fails
  return "https://via.placeholder.com/300x450?text=No+Poster";
}

// ===== Display =====
async function displayMovies() {
  // titles
  document.getElementById("movieA").textContent =
    `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent =
    `${movieB.title} (${movieB.year})`;

  // posters
  const imgA = document.getElementById("posterA");
  const imgB = document.getElementById("posterB");
  imgA.src = await fetchPosterUrl(movieA.title, movieA.year);
  imgB.src = await fetchPosterUrl(movieB.title, movieB.year);

  // links → TMDB search
  const linkA = document.getElementById("linkA");
  const linkB = document.getElementById("linkB");
  linkA.href = TMDB_SEARCH_BASE +
    encodeURIComponent(`${movieA.title} ${movieA.year}`);
  linkB.href = TMDB_SEARCH_BASE +
    encodeURIComponent(`${movieB.title} ${movieB.year}`);

  // clear old confetti
  document.querySelectorAll('.confetti-container').forEach(e => e.innerHTML = '');
}

// ===== Voting =====
function vote(which) {
  const winner = which === "A" ? movieA : movieB;
  const loser  = which === "A" ? movieB : movieA;

  // Firebase log
  db.collection("votes").add({
    winner: winner.title,
    loser: loser.title,
    timestamp: new Date().toISOString()
  }).catch(console.error);

  // Poster shake
  const img = document.getElementById("poster" + which);
  img.classList.add("popcorn-shake");

  // Confetti burst
  // Fixed: use lowercase in ID to match HTML structure
  const container = document.getElementById(`movie${which.toLowerCase()}-block`)
                  .querySelector('.confetti-container');
  createConfettiBurst(container);

  // Remove shake
  setTimeout(() => img.classList.remove("popcorn-shake"), 700);

  // Update Elo & stats
  updateElo(winner.title, loser.title);
  updateStats(winner.title, loser.title);

  // Mark matchup seen
  seenMatchups.push([movieA.title, movieB.title].sort().join("|"));
  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));
  localStorage.setItem("movieRatings", JSON.stringify(ratings));
  localStorage.setItem("movieStats",   JSON.stringify(stats));

  // Refresh ranking view if open
  if (document.getElementById("ranking-list")) updateRanking();

  // Next matchup after a pause
  setTimeout(chooseTwoMovies, 1200);
}

// ===== Elo & Stats =====
function updateElo(winner, loser) {
  const Ra = ratings[winner] || DEFAULT_RATING;
  const Rb = ratings[loser]  || DEFAULT_RATING;
  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra)/400 ));
  ratings[winner] = Math.round(Ra + K * (1 - Ea));
  ratings[loser]  = Math.round(Rb + K * (0 - (1 - Ea)));
}

function updateStats(winner, loser) {
  stats[winner] = stats[winner] || { wins: 0, losses: 0 };
  stats[loser]  = stats[loser]  || { wins: 0, losses: 0 };
  stats[winner].wins++;
  stats[loser].losses++;
}

// ===== Confetti =====
function createConfettiBurst(container) {
  const colors = ['#ff3b3b','#ffc107','#4caf50','#03a9f4','#e91e63','#9c27b0'];
  container.innerHTML = ''; // Clear any previous confetti
  
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    
    // Set random CSS variables for animation
    const randomX = (-100 + Math.random() * 200) + 'px';
    const randomY = (-100 + Math.random() * 200) + 'px';
    const randomRotate = (Math.random() * 720) + 'deg';
    
    piece.style.setProperty('--random-x', randomX);
    piece.style.setProperty('--random-y', randomY);
    piece.style.setProperty('--random-rotate', randomRotate);
    
    Object.assign(piece.style, {
      position: 'absolute',
      width: '8px', 
      height: '12px',
      background: colors[Math.floor(Math.random()*colors.length)],
      borderRadius: '2px',
      top: '50%', 
      left: '50%',
      transform: 'translate(-50%,-50%) rotate(0deg)',
      animation: 'confettiBurst 1s ease-out forwards',
      animationDelay: `${Math.random()*0.3}s`,
      opacity: '0'
    });
    
    container.appendChild(piece);
  }
  
  // Remove after animation completes
  setTimeout(() => container.innerHTML = "", 1400);
}

// ===== Haven't Seen =====
function markUnseen(movieObj) {
  if (!movieObj || !movieObj.title) return;
  unseen.push(movieObj.title);
  localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  chooseTwoMovies();
}

function replaceMovie(movieToReplace) {
  // optional: implement if you still need replacement logic
}

// Placeholder functions for other pages
function updateRanking() {
  // Implement this if you have a ranking page
  console.log("updateRanking called");
}

function updateUnseenList() {
  // Implement this if you have an unseen movies page
  console.log("updateUnseenList called");
}

function updateTaggedList() {
  // Implement this if you have a tagged movies page
  console.log("updateTaggedList called");
}

// Kick things off!
window.onload = loadMovies;
