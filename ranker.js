// ranker.js
import {
  db,
  collection,
  addDoc,
  writeBatch,
  increment,
  serverTimestamp,
  doc
} from "./firebase.js";
import { createConfettiBurst } from "./confetti.js";

let movies = [];
let movieA, movieB;
const ratings      = JSON.parse(localStorage.getItem("movieRatings")) || {};
const stats        = JSON.parse(localStorage.getItem("movieStats"))   || {};
const unseen       = JSON.parse(localStorage.getItem("unseenMovies"))  || [];
const seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];

window.onload     = loadMovies;
window.vote       = vote;
window.markUnseen = markUnseen;

async function loadMovies() {
  const res = await fetch("movie_list_cleaned.json");
  movies = await res.json();
  chooseTwoMovies();
}

function getMovieKey(m) {
  return `${m.title.trim()}|${m.year}`;
}

function getAvailableMovies(exclude = []) {
  return movies.filter(
    (m) =>
      !unseen.includes(getMovieKey(m)) &&
      !exclude.includes(m.title)
  );
}

function chooseTwoMovies() {
  const avail = getAvailableMovies();
  if (avail.length < 2) return alert("Not enough unseen movies.");
  [movieA, movieB] = avail.sort(() => 0.5 - Math.random()).slice(0, 2);
  displayMovies();
}

async function fetchPosterUrl(title, year) {
  const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
  const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
  const url =
    `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}` +
    `&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const d = await (await fetch(url)).json();
    return d.results?.[0]?.poster_path
      ? TMDB_IMAGE_BASE + d.results[0].poster_path
      : "fallback.jpg";
  } catch {
    return "fallback.jpg";
  }
}

async function displayMovies() {
  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;
  document.getElementById("posterA").src = await fetchPosterUrl(
    movieA.title,
    movieA.year
  );
  document.getElementById("posterB").src = await fetchPosterUrl(
    movieB.title,
    movieB.year
  );
}

async function vote(winnerKey) {
  const winner = winnerKey === "A" ? movieA : movieB;
  const loser = winnerKey === "A" ? movieB : movieA;

  console.log("📨 Vote recorded:", winner.title, "beats", loser.title);

  // 1) Record raw vote globally
  await addDoc(collection(db, "votes"), {
    winner: winner.title,
    loser: loser.title,
    timestamp: serverTimestamp(),
    userAgent: navigator.userAgent
  });

  // 2) Atomic update of aggregated stats
  const batch = writeBatch(db);
  const globalRef = doc(db, "stats", "global");
  batch.set(
    globalRef,
    {
      [`stats.${winner.title}.wins`]: increment(1),
      [`stats.${loser.title}.losses`]: increment(1)
    },
    { merge: true }
  );
  await batch.commit();

  // 3) Confetti celebration
  createConfettiBurst();

  // 4) Local Elo & stats adjustments
  updateElo(winner.title, loser.title);
  updateStats(winner.title, loser.title);
  seenMatchups.push([movieA.title, movieB.title].sort().join("|"));

  localStorage.setItem("movieRatings", JSON.stringify(ratings));
  localStorage.setItem("movieStats", JSON.stringify(stats));
  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));

  setTimeout(chooseTwoMovies, 1200);
}

function updateElo(winner, loser) {
  const Ra = ratings[winner] || 1000;
  const Rb = ratings[loser] || 1000;
  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
  ratings[winner] = Math.round(Ra + 32 * (1 - Ea));
  ratings[loser] = Math.round(Rb + 32 * (0 - (1 - Ea)));
}

function updateStats(winner, loser) {
  stats[winner] = stats[winner] || { wins: 0, losses: 0 };
  stats[loser] = stats[loser] || { wins: 0, losses: 0 };
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
  if (!avail.length) return alert("No more movies.");
  const replacement = avail[Math.floor(Math.random() * avail.length)];
  if (oldMovie.title === movieA.title) movieA = replacement;
  else movieB = replacement;
  await displayMovies();
}
