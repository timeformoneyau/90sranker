// ranker.js
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

// import confetti from your own file or a CDN:
import confetti from "https://cdn.skypack.dev/canvas-confetti";

let movies = [];
let movieA, movieB;

const ratings      = JSON.parse(localStorage.getItem("movieRatings"))  || {};
const stats        = JSON.parse(localStorage.getItem("movieStats"))    || {};
const unseen       = JSON.parse(localStorage.getItem("unseenMovies"))  || [];
const seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];

// Utility to build the consistent key format
function getMovieKey(m) {
  return `${m.title.trim()}|${m.year}`;
}

window.addEventListener("load", loadMovies);
window.vote       = vote;
window.markUnseen = markUnseen;

async function loadMovies() {
  try {
    const res = await fetch("movie_list_cleaned.json");
    movies = await res.json();
    chooseTwoMovies();
  } catch (err) {
    console.error("Error loading movies:", err);
  }
}

function getAvailableMovies(exclude = []) {
  return movies.filter(m =>
    !unseen.includes(getMovieKey(m)) &&
    !exclude.includes(m.title)
  );
}

function chooseTwoMovies() {
  const avail = getAvailableMovies();
  if (avail.length < 2) {
    alert("Not enough unseen movies.");
    return;
  }
  [movieA, movieB] = avail.sort(() => 0.5 - Math.random()).slice(0, 2);
  displayMovies();
}

async function fetchPosterUrl(title, year) {
  const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
  const TMDB_API_KEY    = "825459de57821b3ab63446cce9046516";
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}` +
              `&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const res  = await fetch(url);
    const data = await res.json();
    const p    = data.results?.[0]?.poster_path;
    return p ? TMDB_IMAGE_BASE + p : "./fallback.jpg";
  } catch (err) {
    console.warn("fetchPosterUrl failed:", err);
    return "./fallback.jpg";
  }
}

async function displayMovies() {
  try {
    document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
    document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;
    document.getElementById("posterA").src = await fetchPosterUrl(movieA.title, movieA.year);
    document.getElementById("posterB").src = await fetchPosterUrl(movieB.title, movieB.year);
  } catch (err) {
    console.error("Error displaying movies:", err);
  }
}

async function vote(winnerKey) {
  const winner = winnerKey === "A" ? movieA : movieB;
  const loser  = winnerKey === "A" ? movieB : movieA;

  console.log("Vote:", winner.title, "beats", loser.title);

  // 1) Write to Firestore votes collection with user and consistent key
  try {
    await addDoc(collection(db, "votes"), {
      winner:    getMovieKey(winner),
      loser:     getMovieKey(loser),
      user:      auth.currentUser?.uid,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.error("Global vote write failed:", err);
  }

  // 2) (Optional) Update your aggregate stats document if you still use it
  try {
    const batch = writeBatch(db);
    const ref   = doc(db, "stats", "global");
    batch.set(ref, {
      [`stats.${getMovieKey(winner)}.wins`]:   increment(1),
      [`stats.${getMovieKey(loser)}.losses`]:  increment(1)
    }, { merge: true });
    await batch.commit();
  } catch (err) {
    console.error("Stats update failed:", err);
  }

  // 3) Confetti celebration
  confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });

  // 4) Update local Elo & win/loss stats
  updateElo(winner.title, loser.title);
  updateStats(winner.title, loser.title);
  seenMatchups.push([movieA.title, movieB.title].sort().join("|"));

  localStorage.setItem("movieRatings", JSON.stringify(ratings));
  localStorage.setItem("movieStats",   JSON.stringify(stats));
  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));

  // Next matchup
  setTimeout(chooseTwoMovies, 1200);
}

function updateElo(winner, loser) {
  const Ra = ratings[winner] || 1000;
  const Rb = ratings[loser]  || 1000;
  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
  ratings[winner] = Math.round(Ra + 32 * (1 - Ea));
  ratings[loser]  = Math.round(Rb + 32 * (0 - (1 - Ea)));
}

function updateStats(winner, loser) {
  stats[winner] = stats[winner] || { wins: 0, losses: 0 };
  stats[loser]  = stats[loser]  || { wins: 0, losses: 0 };
  stats[winner].wins++;
  stats[loser].losses++;
}

function markUnseen(m) {
  const key = getMovieKey(m);
  if (!m || unseen.includes(key)) return;
  unseen.push(key);
  localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  replaceMovie(m);
}

async function replaceMovie(oldMovie) {
  const avail = getAvailableMovies([movieA.title, movieB.title]);
  if (!avail.length) {
    alert("No more movies."); return;
  }
  const repl = avail[Math.floor(Math.random() * avail.length)];
  if (oldMovie.title === movieA.title) movieA = repl;
  else movieB = repl;
  await displayMovies();
}

export {}; // module context
