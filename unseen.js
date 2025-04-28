import { auth, db, doc, getDoc, updateDoc, onAuth } from "./firebase.js";

let unseen = [];
let movies = [];

export async function fetchTMDBRating(title, year) {
  const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}` +
                `&query=${encodeURIComponent(title)}&year=${year}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.results?.[0]?.vote_average || null;
  } catch (err) {
    console.error("TMDB fetch fail:", err);
    return null;
  }
}

async function loadUnseenList() {
  const unseenListEl = document.getElementById("unseen-list");
  if (!unseenListEl) return;
  unseenListEl.innerHTML = "";

  // Load unseen keys from Firestore or localStorage
  if (auth.currentUser) {
    try {
      const ref = doc(db, "users", auth.currentUser.uid);
      const snap = await getDoc(ref);
      unseen = snap.exists() && Array.isArray(snap.data().seen)
        ? snap.data().seen
        : [];
    } catch (err) {
      console.error("Load unseen fail:", err);
      unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
    }
  } else {
    unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
  }

  // Load full movie list
  try {
    const res = await fetch("movie_list_cleaned.json");
    movies = await res.json();
  } catch (err) {
    console.error("Movie list fetch fail:", err);
    return;
  }

  // Map keys to movie objects and fetch ratings
  const unseenMovies = unseen
    .map(k => {
      const [t, y] = k.split("|");
      return movies.find(m => m.title === t && String(m.year) === y);
    })
    .filter(Boolean);

  const scored = await Promise.all(
    unseenMovies.map(async m => ({
      ...m,
      tmdbRating: (await fetchTMDBRating(m.title, m.year)) || 0
    }))
  );

  // Render top 20 by rating
  scored
    .sort((a, b) => b.tmdbRating - a.tmdbRating)
    .slice(0, 20)
    .forEach(m => {
      const key = `${m.title}|${m.year}`;
      const tr = document.createElement("tr");
      tr.setAttribute("data-key", key);
      tr.innerHTML = `
        <td>${m.title}</td>
        <td>${m.year}</td>
        <td>${m.tmdbRating.toFixed(1)}</td>
        <td><button onclick="putBack('${key}')">Put Back</button></td>
      `;
      unseenListEl.appendChild(tr);
    });
}

async function putBack(key) {
  const idx = unseen.indexOf(key);
  if (idx === -1) return;
  unseen.splice(idx, 1);

  if (auth.currentUser) {
    try {
      const ref = doc(db, "users", auth.currentUser.uid);
      await updateDoc(ref, { seen: unseen });
    } catch (err) {
      console.error("Put back fail:", err);
    }
  } else {
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  }

  const row = document.querySelector(`tr[data-key="${key}"]`);
  if (row) row.remove();
}

// Load list on initial auth or page load
window.addEventListener("load", loadUnseenList);
onAuth(() => loadUnseenList());
window.putBack = putBack;
