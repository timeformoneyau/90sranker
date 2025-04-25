// ranker.js
import { auth, recordVoteToFirestore, db } from "./auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

let movies = [];
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats   = JSON.parse(localStorage.getItem("movieStats"))   || {};
let unseen  = [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];
let movieA, movieB;

// ——— Sync existing user votes into localStorage ———
async function syncVotesFromFirestore() {
  if (!auth.currentUser) return;
  const ref  = doc(db, "users", auth.currentUser.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data  = snap.data();
  const votes = Array.isArray(data.votes) ? data.votes : [];
  votes.forEach(voteKey => {
    stats[voteKey] = stats[voteKey] || { wins: 0, losses: 0 };
    stats[voteKey].wins++;
  });
  localStorage.setItem("movieStats", JSON.stringify(stats));
}

// ——— Load movie list and initialize ———
async function loadMovies() {
  // Fetch movies
  const res = await fetch("movie_list_cleaned.json");
  movies = await res.json();

  // Load "unseen" from Firestore or local
  if (auth.currentUser) {
    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      const snap    = await getDoc(userRef);
      if (snap.exists()) {
        unseen = snap.data().seen || [];
      } else {
        await updateDoc(userRef, { seen: [] });
        unseen = [];
      }
      localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    } catch (err) {
      console.error("Error loading unseen from Firestore:", err);
      unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
    }
  } else {
    unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
  }

  chooseTwoMovies();
}

// ——— Pick two random unseen movies ———
function chooseTwoMovies() {
  const available = movies.filter(m => !unseen.includes(`${m.title}|${m.year}`));
  if (available.length < 2) {
    alert("Not enough movies to compare.");
    return;
  }

  let attempts = 0;
  let matchupKey = "";
  do {
    [movieA, movieB] = available.sort(() => Math.random() - 0.5).slice(0, 2);
    matchupKey = [movieA.title, movieB.title].sort().join("|");
    attempts++;
    if (attempts > 50) break;
  } while (seenMatchups.includes(matchupKey));

  displayMovies();
}

// ——— Render posters & titles ———
async function displayMovies() {
  document.getElementById("movieA").textContent      = movieA.title;
  document.getElementById("movieA-year").textContent = `(${movieA.year})`;
  document.getElementById("movieB").textContent      = movieB.title;
  document.getElementById("movieB-year").textContent = `(${movieB.year})`;

  document.getElementById("posterA").src =
    await fetchPosterUrl(movieA.title, movieA.year);
  document.getElementById("posterB").src =
    await fetchPosterUrl(movieB.title, movieB.year);

  document.querySelectorAll(".confetti-container").forEach(e => e.innerHTML = "");
}

// ——— TMDB poster lookup ———
const TMDB_API_KEY      = "825459de57821b3ab63446cce9046516";
const TMDB_IMAGE_BASE   = "https://image.tmdb.org/t/p/w500";
async function fetchPosterUrl(title, year) {
  try {
    const url =
      `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}` +
      `&query=${encodeURIComponent(title)}&year=${year}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data.results?.[0]?.poster_path) {
      return `${TMDB_IMAGE_BASE}${data.results[0].poster_path}`;
    }
  } catch (err) {
    console.error(`Poster fetch failed for ${title}`, err);
  }
  return "fallback.jpg";
}

// ——— Handle a vote click ———
export function vote(winner) {
  const winnerMovie = winner === "A" ? movieA : movieB;
  const loserMovie  = winner === "A" ? movieB : movieA;
  const winnerKey   = `${winnerMovie.title}|${winnerMovie.year}`;
  const loserKey    = `${loserMovie.title}|${loserMovie.year}`;
  const matchupKey  = [movieA.title, movieB.title].sort().join("|");

  // Persist globally & per-user
  recordVoteToFirestore(winnerKey, loserKey)
    .catch(err => console.error("Write failed:", err));

  // Update local stats
  stats[winnerKey] = stats[winnerKey] || { wins: 0, losses: 0 };
  stats[loserKey]  = stats[loserKey]  || { wins: 0, losses: 0 };
  stats[winnerKey].wins++;
  stats[loserKey].losses++;
  localStorage.setItem("movieStats", JSON.stringify(stats));

  // Visual feedback
  const el = document.getElementById(`poster${winner}`);
  el.classList.add("shake");
  createConfettiBurst(winner);
  setTimeout(() => el.classList.remove("shake"), 800);

  // Mark matchup seen and pick next
  seenMatchups.push(matchupKey);
  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));
  setTimeout(chooseTwoMovies, 1500);
}

// ——— Confetti animation ———
export function createConfettiBurst(winner) {
  const container = document.getElementById(
    `confetti-container-${winner.toLowerCase()}`
  );
  if (!container) return;
  container.innerHTML = "";

  for (let i = 0; i < 200; i++) {
    const dot = document.createElement("div");
    dot.className = "confetti-dot";
    container.appendChild(dot);
    const angle = Math.random() * 2 * Math.PI;
    const dist  = 120 + Math.random() * 200;
    const x     = Math.cos(angle) * dist;
    const y     = Math.sin(angle) * dist;
    dot.animate([
      { transform: 'translate(-50%,-50%)', opacity: 1 },
      { transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`, opacity: 0 }
    ], { duration: 1200 + Math.random() * 500, easing: 'ease-out', fill: 'forwards' });
  }
}

// ——— Mark unseen & replacement logic ———
export function markUnseen(slot) {
  const movie = slot === 'A' ? movieA : movieB;
  const key   = `${movie.title}|${movie.year}`;
  if (!unseen.includes(key)) {
    unseen.push(key);
    if (auth.currentUser) {
      const userRef = doc(db, "users", auth.currentUser.uid);
      updateDoc(userRef, { seen: unseen }).catch(err =>
        console.error("Error updating unseen in Firestore:", err)
      );
    } else {
      localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    }
    setTimeout(() => replaceMovie(movie), 100);
  }
}

async function replaceMovie(movieToReplace) {
  const available = movies.filter(m =>
    !unseen.includes(`${m.title}|${m.year}`) &&
    m.title !== movieA.title &&
    m.title !== movieB.title
  );
  if (!available.length) {
    alert("No more unseen movies.");
    return;
  }
  const replacement = available[Math.floor(Math.random() * available.length)];
  if (movieToReplace === movieA) movieA = replacement;
  else movieB = replacement;
  await displayMovies();
}

// ——— Initialization on load ———
window.addEventListener('load', async () => {
  await syncVotesFromFirestore();
  await loadMovies();
});

// ——— Expose for inline onclicks ———
window.vote       = vote;
window.markUnseen = markUnseen;
