// unseen.js
import { auth, db } from "./auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

let unseen = [];
let movies = [];
const TMDB_API_KEY = '825459de57821b3ab63446cce9046516';

// ——— Load unseen list on page load ———
async function loadUnseenList() {
  // Determine source of unseen list
  if (auth.currentUser) {
    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      const snap    = await getDoc(userRef);
      unseen = snap.exists() ? (snap.data().seen || []) : [];
      // Mirror to localStorage
      localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    } catch (err) {
      console.error("Error loading unseen from Firestore:", err);
      unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
    }
  } else {
    unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
  }

  // Fetch movie list
  try {
    const res = await fetch("movie_list_cleaned.json");
    movies = await res.json();
  } catch (err) {
    console.error("Error fetching movie list:", err);
    return;
  }

  // Filter unseen movies
  const unseenMovies = unseen
    .map(key => {
      const [title, year] = key.split("|");
      return movies.find(m => m.title === title && String(m.year) === year);
    })
    .filter(Boolean);

  // Fetch TMDB ratings and sort
  const scoredUnseen = await Promise.all(
    unseenMovies.map(async movie => {
      const tmdbRating = await fetchTMDBRating(movie.title, movie.year);
      return { ...movie, tmdbRating: tmdbRating || 0 };
    })
  );

  scoredUnseen
    .sort((a, b) => b.tmdbRating - a.tmdbRating)
    .slice(0, 20)
    .forEach(movie => {
      const key = `${movie.title}|${movie.year}`;
      const tr  = document.createElement("tr");
      tr.setAttribute("data-key", key);
      tr.innerHTML = `
        <td>${movie.title}</td>
        <td>${movie.year}</td>
        <td>${movie.tmdbRating ? movie.tmdbRating.toFixed(1) : "N/A"}</td>
        <td><button onclick="putBack('${key}')">Put Back</button></td>
      `;
      document.getElementById("unseen-list").appendChild(tr);
    });
}

// ——— Put back an unseen movie ———
async function putBack(key) {
  const idx = unseen.indexOf(key);
  if (idx === -1) return;

  // Remove from array
  unseen.splice(idx, 1);

  // Persist change
  if (auth.currentUser) {
    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      await updateDoc(userRef, { seen: unseen });
    } catch (err) {
      console.error("Error updating Firestore seen list:", err);
    }
  } else {
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  }

  // Remove row from table
  const row = document.querySelector(`tr[data-key="${key}"]`);
  if (row) row.remove();
}

window.addEventListener('load', loadUnseenList);
window.putBack = putBack;

// ——— Helper: fetch TMDB rating ———
async function fetchTMDBRating(title, year) {
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}` +
                `&query=${encodeURIComponent(title)}&year=${year}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.results?.[0]?.vote_average || null;
  } catch (err) {
    console.error(`Failed to fetch TMDB rating for ${title}`, err);
    return null;
  }
}
