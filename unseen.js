// unseen.js — Haven't Seen management page
// Shows movies the user marked as unseen, sorted by vote count.
// Allows reversing the designation to put movies back into voting rotation.

import {
  auth, db, doc, getDoc, setDoc,
  onAuth, arrayRemove
} from "./firebase.js";

import { makeMovieKey } from "./movieKeys.js";

// ==========================================
// STATE
// ==========================================

let unseenKeys = [];       // raw "seen" array from Firestore (haven't-seen keys)
let movieMap = {};         // key → movie object from movie_list_cleaned.json
let userStats = {};        // key → { wins, losses } from user's aggregate stats
let currentSort = "votes";
let currentGenre = "all";
let currentSearch = "";

// ==========================================
// LOAD DATA
// ==========================================

async function loadUnseenPage() {
  const statusEl = document.getElementById("unseen-status");
  const controlsEl = document.getElementById("unseen-controls");
  const tableWrap = document.getElementById("unseen-table-wrap");
  const emptyEl = document.getElementById("unseen-empty");

  statusEl.textContent = "Loading...";

  if (!auth.currentUser) {
    statusEl.textContent = "";
    controlsEl.style.display = "none";
    tableWrap.style.display = "none";
    emptyEl.style.display = "";
    emptyEl.textContent = "Log in to see your Haven't Seen list.";
    document.getElementById("unseen-cards").innerHTML = "";
    return;
  }

  const uid = auth.currentUser.uid;

  try {
    // 3 reads: user doc, user stats, movie list (local JSON)
    const [userSnap, statsSnap, moviesRes] = await Promise.all([
      getDoc(doc(db, "users", uid)),
      getDoc(doc(db, "stats", `user_${uid}`)),
      fetch("movie_list_cleaned.json")
    ]);

    // Parse user doc
    const userData = userSnap.exists() ? userSnap.data() : {};
    unseenKeys = Array.isArray(userData.seen) ? [...userData.seen] : [];
    const inferredSeen = new Set(Array.isArray(userData.inferredSeen) ? userData.inferredSeen : []);

    // Filter out movies that have since been inferred as seen (voted on)
    unseenKeys = unseenKeys.filter(k => !inferredSeen.has(k));

    // Parse user stats
    userStats = statsSnap.exists() ? (statsSnap.data().stats || {}) : {};

    // Build movie map
    const allMovies = await moviesRes.json();
    const movies = allMovies.filter(m => m.title && m.year && !/^title$/i.test(m.title.trim()));
    movieMap = {};
    for (const m of movies) {
      movieMap[makeMovieKey(m.title, m.year)] = m;
    }

    if (unseenKeys.length === 0) {
      statusEl.textContent = "";
      controlsEl.style.display = "none";
      tableWrap.style.display = "none";
      emptyEl.style.display = "";
      document.getElementById("unseen-cards").innerHTML = "";
      return;
    }

    // Populate genre filter
    populateGenreFilter();

    statusEl.textContent = `${unseenKeys.length} movie${unseenKeys.length !== 1 ? "s" : ""} marked as Haven't Seen`;
    controlsEl.style.display = "";
    tableWrap.style.display = "";
    emptyEl.style.display = "none";

    renderList();
  } catch (err) {
    console.error("Failed to load unseen page:", err);
    statusEl.textContent = "Failed to load. Please refresh.";
  }
}

// ==========================================
// GENRE FILTER
// ==========================================

function populateGenreFilter() {
  const genres = new Set();
  for (const key of unseenKeys) {
    const movie = movieMap[key];
    if (movie?.genre) genres.add(movie.genre);
  }

  const select = document.getElementById("unseen-genre-filter");
  // Keep "All Genres" option, clear the rest
  select.innerHTML = '<option value="all">All Genres</option>';
  [...genres].sort().forEach(g => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    select.appendChild(opt);
  });
}

// ==========================================
// SORTING + FILTERING
// ==========================================

function getFilteredSorted() {
  // Build enriched list
  let items = unseenKeys.map(key => {
    const movie = movieMap[key];
    const stats = userStats[key] || {};
    const wins = stats.wins || 0;
    const losses = stats.losses || 0;
    return {
      key,
      title: movie?.title || key.split("|")[0],
      year: movie?.year || key.split("|")[1] || "",
      genre: movie?.genre || "",
      tone: movie?.tone || "",
      voteCount: wins + losses,
      wins,
      losses
    };
  });

  // Filter by genre
  if (currentGenre !== "all") {
    items = items.filter(m => m.genre === currentGenre);
  }

  // Filter by search
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    items = items.filter(m => m.title.toLowerCase().includes(q));
  }

  // Sort
  switch (currentSort) {
    case "votes":
      items.sort((a, b) => b.voteCount - a.voteCount || a.title.localeCompare(b.title));
      break;
    case "genre":
      items.sort((a, b) => a.genre.localeCompare(b.genre) || a.title.localeCompare(b.title));
      break;
    case "title":
      items.sort((a, b) => a.title.localeCompare(b.title));
      break;
    case "year":
      items.sort((a, b) => parseInt(b.year) - parseInt(a.year) || a.title.localeCompare(b.title));
      break;
  }

  return items;
}

// ==========================================
// RENDERING
// ==========================================

function renderList() {
  const items = getFilteredSorted();
  renderTable(items);
  renderCards(items);
}

function renderTable(items) {
  const tbody = document.getElementById("unseen-list");
  tbody.innerHTML = "";

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="results-empty">No movies match your filters.</td></tr>';
    return;
  }

  items.forEach((m, i) => {
    const tr = document.createElement("tr");
    tr.id = `unseen-row-${m.key.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const votesDisplay = m.voteCount > 0
      ? `${m.voteCount} (${m.wins}W\u2013${m.losses}L)`
      : "\u2014";
    tr.innerHTML = `
      <td class="col-rank">${i + 1}</td>
      <td class="col-movie"><span class="movie-name">${m.title}</span> <span class="movie-yr">${m.year}</span></td>
      <td class="col-num">${m.genre || "\u2014"}</td>
      <td class="col-num">${votesDisplay}</td>
      <td class="col-num"><button class="unseen-put-back-btn" data-key="${m.key}">Put Back</button></td>
    `;
    tbody.appendChild(tr);
  });

  // Wire put-back buttons
  tbody.querySelectorAll(".unseen-put-back-btn").forEach(btn => {
    btn.addEventListener("click", () => handlePutBack(btn.dataset.key, btn));
  });
}

function renderCards(items) {
  const container = document.getElementById("unseen-cards");
  container.innerHTML = "";

  if (items.length === 0) return;

  items.forEach((m, i) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.id = `unseen-card-${m.key.replace(/[^a-zA-Z0-9]/g, "_")}`;
    const votesDisplay = m.voteCount > 0
      ? `${m.voteCount} votes (${m.wins}W\u2013${m.losses}L)`
      : "No votes yet";
    card.innerHTML = `
      <div class="result-card-rank">${i + 1}</div>
      <div class="result-card-body">
        <div class="result-card-title">${m.title} <span class="movie-yr">${m.year}</span></div>
        <div class="result-card-stats">
          <span>${m.genre || "Unknown"}</span>
          <span>${votesDisplay}</span>
        </div>
      </div>
      <div class="result-card-action">
        <button class="unseen-put-back-btn" data-key="${m.key}">Put Back</button>
      </div>
    `;
    container.appendChild(card);
  });

  // Wire put-back buttons
  container.querySelectorAll(".unseen-put-back-btn").forEach(btn => {
    btn.addEventListener("click", () => handlePutBack(btn.dataset.key, btn));
  });
}

// ==========================================
// PUT BACK (reverse designation)
// ==========================================

async function handlePutBack(key, btn) {
  // Disable button to prevent double-clicks
  btn.disabled = true;
  btn.textContent = "Removing...";

  // Remove from local state
  unseenKeys = unseenKeys.filter(k => k !== key);

  // Persist to Firestore (atomic arrayRemove — no full array overwrite)
  if (auth.currentUser) {
    try {
      await setDoc(doc(db, "users", auth.currentUser.uid), {
        seen: arrayRemove(key)
      }, { merge: true });
    } catch (err) {
      console.error("Failed to put back:", err);
      // Re-add on failure
      unseenKeys.push(key);
      btn.disabled = false;
      btn.textContent = "Put Back";
      return;
    }
  } else {
    const stored = JSON.parse(localStorage.getItem("unseenMovies")) || [];
    localStorage.setItem("unseenMovies", JSON.stringify(stored.filter(k => k !== key)));
  }

  // Animate out and re-render
  const rowId = `unseen-row-${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const cardId = `unseen-card-${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
  const row = document.getElementById(rowId);
  const card = document.getElementById(cardId);

  if (row) {
    row.style.transition = "opacity 300ms ease, transform 300ms ease";
    row.style.opacity = "0";
    row.style.transform = "translateX(20px)";
  }
  if (card) {
    card.style.transition = "opacity 300ms ease, transform 300ms ease";
    card.style.opacity = "0";
    card.style.transform = "translateX(20px)";
  }

  setTimeout(() => {
    renderList();
    // Update count
    const statusEl = document.getElementById("unseen-status");
    if (unseenKeys.length === 0) {
      statusEl.textContent = "";
      document.getElementById("unseen-controls").style.display = "none";
      document.getElementById("unseen-table-wrap").style.display = "none";
      document.getElementById("unseen-empty").style.display = "";
    } else {
      statusEl.textContent = `${unseenKeys.length} movie${unseenKeys.length !== 1 ? "s" : ""} marked as Haven't Seen`;
    }
  }, 300);
}

// ==========================================
// EVENT LISTENERS
// ==========================================

function wireControls() {
  document.getElementById("unseen-sort-select").addEventListener("change", (e) => {
    currentSort = e.target.value;
    renderList();
  });

  document.getElementById("unseen-genre-filter").addEventListener("change", (e) => {
    currentGenre = e.target.value;
    renderList();
  });

  document.getElementById("unseen-search-input").addEventListener("input", (e) => {
    currentSearch = e.target.value.trim();
    renderList();
  });
}

// ==========================================
// INIT
// ==========================================

window.addEventListener("load", () => {
  wireControls();
  onAuth(() => loadUnseenPage());
});
