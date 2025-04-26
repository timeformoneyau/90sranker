// unseen.js
import { auth, db, doc, getDoc, updateDoc } from "./firebase.js";

let unseen = [];
let movies = [];

export async function fetchTMDBRating(title, year) {
  const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
  try {
    const url =
      `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}` +
      `&query=${encodeURIComponent(title)}&year=${year}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.results?.[0]?.vote_average || null;
  } catch (err) {
    console.error(`Failed to fetch TMDB rating for ${title}`, err);
    return null;
  }
}

// Load unseen list
async function loadUnseenList() {
  if (auth.currentUser) {
    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      const snap = await getDoc(userRef);
      unseen = snap.exists() ? snap.data().seen || [] : [];
      localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    } catch (err) {
      console.error("Error loading unseen from Firestore:", err);
      unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
    }
  } else {
    unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
  }

  try {
    const res = await fetch("movie_list_cleaned.json");
    movies = await res.json();
  } catch (err) {
    console.error("Error fetching movie list:", err);
    return;
  }

  const unseenMovies = unseen
    .map((key) => {
      const [title, year] = key.split("|");
      return movies.find((m) => m.title === title && String(m.year) === year);
    })
    .filter(Boolean);

  const scoredUnseen = await Promise.all(
    unseenMovies.map(async (movie) => ({
      ...movie,
      tmdbRating: (await fetchTMDBRating(movie.title, movie.year)) || 0
    }))
  );

  scoredUnseen
    .sort((a, b) => b.tmdbRating - a.tmdbRating)
    .slice(0, 20)
    .forEach((movie) => {
      const key = `${movie.title}|${movie.year}`;
      const tr = document.createElement("tr");
      tr.setAttribute("data-key", key);
      tr.innerHTML = `
        <td>${movie.title}</td>
        <td>${movie.year}</td>
        <td>${movie.tmdbRating.toFixed(1)}</td>
        <td><button onclick="putBack('${key}')">Put Back</button></td>
      `;
      document.getElementById("unseen-list").appendChild(tr);
    });
}

// Put back handler
async function putBack(key) {
  const idx = unseen.indexOf(key);
  if (idx === -1) return; 
  unseen.splice(idx, 1);
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
  const row = document.querySelector(`tr[data-key="${key}"]`);
  if (row) row.remove();
}

window.addEventListener("load", loadUnseenList);
window.putBack = putBack;
