// list.js
import { auth, db } from "./auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

let movies = [];
let unseen = [];
const tags = JSON.parse(localStorage.getItem("movieTags")) || {};
const stats = JSON.parse(localStorage.getItem("movieStats")) || {};

// ——— Load movies and initialize lists ———
async function loadMovieList() {
  // Fetch movie list
  const res = await fetch("movie_list_cleaned.json");
  movies = await res.json();

  // Load unseen from Firestore or localStorage
  if (auth.currentUser) {
    try {
      const ref = doc(db, "users", auth.currentUser.uid);
      const snap = await getDoc(ref);
      unseen = snap.exists() ? (snap.data().seen || []) : [];
      // Mirror to localStorage for consistency
      localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    } catch (err) {
      console.error("Error loading unseen from Firestore:", err);
      unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
    }
  } else {
    unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
  }

  await renderRankings();
  await renderUnseen();
  renderTags();
}

// ——— Render global top-20 rankings ———
async function renderRankings() {
  const rankingList = document.getElementById("ranking-list");
  rankingList.innerHTML = "";

  let movieData = [];
  try {
    const snapshot = await getDocs(collection(db, "votes"));
    const globalStats = {};

    snapshot.forEach(doc => {
      const { winner } = doc.data();
      if (!winner) return;
      if (!globalStats[winner]) globalStats[winner] = { wins: 0 };
      globalStats[winner].wins++;
    });

    movieData = Object.keys(globalStats).map(key => {
      const [title, year] = key.split("|");
      return { title: `${title} (${year})`, wins: globalStats[key].wins };
    });
  } catch (error) {
    movieData = Object.entries(stats).map(([key, result]) => {
      const [title, year] = key.split("|");
      return { title: `${title} (${year})`, wins: result.wins || 0 };
    });
  }

  movieData.sort((a, b) => b.wins - a.wins)
           .slice(0, 20)
           .forEach(movie => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${movie.title}</td><td>${movie.wins}</td>`;
    rankingList.appendChild(tr);
  });
}

// ——— Render unseen movies list ———
async function renderUnseen() {
  const unseenList = document.getElementById("unseen-list");
  if (!unseenList) return;
  unseenList.innerHTML = "";

  const unseenMovies = movies.filter(m => unseen.includes(`${m.title}|${m.year}`));

  const scoredUnseen = await Promise.all(
    unseenMovies.map(async movie => {
      const tmdbRating = await fetchTMDBRating(movie.title, movie.year);
      return { ...movie, tmdbRating: tmdbRating || 0 };
    })
  );

  scoredUnseen.sort((a, b) => b.tmdbRating - a.tmdbRating)
              .slice(0, 20)
              .forEach(movie => {
    const key = `${movie.title}|${movie.year}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${movie.title}</td>
      <td>${movie.year}</td>
      <td>${movie.tmdbRating ? movie.tmdbRating.toFixed(1) : "N/A"}</td>
      <td><button onclick="putBack('${key}')">Put Back</button></td>
    `;
    unseenList.appendChild(tr);
  });
}

// ——— Remove movie from unseen ———
async function putBack(key) {
  const index = unseen.indexOf(key);
  if (index === -1) return;

  unseen.splice(index, 1);
  if (auth.currentUser) {
    const ref = doc(db, "users", auth.currentUser.uid);
    try {
      await updateDoc(ref, { seen: unseen });
    } catch (err) {
      console.error("Error updating unseen in Firestore:", err);
    }
  } else {
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  }
  await renderUnseen();
}
window.putBack = putBack;

// ——— TMDB rating helper ———
const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
async function fetchTMDBRating(title, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.results?.[0]?.vote_average || null;
  } catch (err) {
    console.error(`Failed to fetch TMDB rating for ${title}`, err);
    return null;
  }
}

// ——— Render tags ———
function renderTags() {
  const tagList = document.getElementById("tagged-list");
  if (!tagList) return;
  tagList.innerHTML = "";

  const taggedTitles = Object.keys(tags);
  if (!taggedTitles.length) {
    tagList.innerHTML = "<li>No tagged movies yet.</li>";
    return;
  }

  taggedTitles.forEach(key => {
    const [title, year] = key.split("|");
    const li = document.createElement("li");
    li.textContent = `${title} (${year}) — ${tags[key].join(", ")}`;
    tagList.appendChild(li);
  });
}

// ——— Initialize on load ———
window.addEventListener('load', loadMovieList);
