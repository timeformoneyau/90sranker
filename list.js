import {
  db,
  onAuth,
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  limit,
  onSnapshot
} from "./firebase.js";

import { makeMovieKey, buildKeyNormalizer } from "./movieKeys.js";

// ==========================================
// ADMIN
// ==========================================

const ADMIN_EMAIL = "mjreardon62@gmail.com";
let currentIsAdmin = false;
let adminSelectedUid = null;
let adminSelectedUsername = null;

// ==========================================
// KEY NORMALIZATION
// ==========================================

let normalizeKey = (k) => k; // identity until movie list loads

// ==========================================
// POSTER LOOKUP (TMDB API)
// ==========================================

const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w185";
const posterCache = {};

async function initNormalizer() {
  try {
    const res = await fetch("movie_list_cleaned.json");
    const allMovies = await res.json();
    const movies = allMovies.filter(m => m.title && m.year && !/^title$/i.test(m.title.trim()));
    normalizeKey = buildKeyNormalizer(movies);
  } catch (err) {
    console.warn("Could not load movie list for key normalization:", err);
  }
}

function getPosterUrl(movieKey) {
  return posterCache[movieKey] || "";
}

async function fetchPosterFromTMDB(title, year) {
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
    const res = await fetch(url);
    const data = await res.json();
    const posterPath = data.results?.[0]?.poster_path;
    return posterPath ? TMDB_IMAGE_BASE + posterPath : null;
  } catch {
    return null;
  }
}

async function lazyLoadPosters(container) {
  const imgs = container.querySelectorAll("img[data-needs-poster]");
  for (const img of imgs) {
    const key = img.dataset.needsPoster;
    if (!key) continue;
    const title = key.split("|")[0];
    const year = key.split("|")[1] || "";
    fetchPosterFromTMDB(title, year).then(url => {
      if (url) {
        posterCache[key] = url;
        img.src = url;
        img.style.opacity = "1";
      } else {
        img.closest(".poster-thumb-wrap")?.classList.add("poster-thumb--empty");
        img.remove();
      }
      img.removeAttribute("data-needs-poster");
    });
  }
}

// ==========================================
// WILSON SCORE
// ==========================================

const Z = 1.96; // 95% confidence
const MIN_MATCHUPS = 5;

function wilsonScore(wins, losses) {
  const n = wins + losses;
  if (n === 0) return 0;
  const p = wins / n;
  const z2 = Z * Z;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - spread) / denominator;
}

function confidenceLevel(n) {
  if (n < MIN_MATCHUPS) return "low";
  if (n < 15) return "med";
  return "high";
}

// ==========================================
// BUILD RANKED DATA FROM AGGREGATE STATS
// ==========================================

function buildRankedData(statsObj) {
  // statsObj shape: { "Title|Year": { wins: N, losses: N }, ... }
  return Object.entries(statsObj).map(([key, r]) => {
    const title = key.split("|")[0];
    const year = key.split("|")[1] || "";
    const wins = r.wins || 0;
    const losses = r.losses || 0;
    const n = wins + losses;
    const winPct = n ? (wins / n) * 100 : 0;
    const ws = wilsonScore(wins, losses);
    const conf = confidenceLevel(n);
    return { key, title, year, wins, losses, n, winPct, wilsonScore: ws, displayScore: Math.round(ws * 1000) / 10, confidence: conf };
  });
}

// Normalize all keys in statsObj via the movie-list normalizer, then merge any
// duplicates (e.g. "Independence Day 1996" + "Independence Day|1996" become one entry).
function buildNormalizedRankedData(statsObj) {
  const merged = {};
  for (const [rawKey, r] of Object.entries(statsObj)) {
    const key = normalizeKey(rawKey);
    if (!merged[key]) merged[key] = { wins: 0, losses: 0 };
    merged[key].wins  += r.wins  || 0;
    merged[key].losses += r.losses || 0;
  }
  return buildRankedData(merged);
}

// ==========================================
// SORT FUNCTIONS
// ==========================================

function sortRows(rows, mode) {
  const cmp = (a, b) => a.title.localeCompare(b.title);
  switch (mode) {
    case "wins":
      return rows.slice().sort((a, b) => b.wins - a.wins || b.n - a.n || cmp(a, b));
    case "winpct":
      return rows.slice().sort((a, b) => {
        const aElig = a.n >= 10 ? 1 : 0;
        const bElig = b.n >= 10 ? 1 : 0;
        if (bElig !== aElig) return bElig - aElig;
        return b.winPct - a.winPct || b.n - a.n || cmp(a, b);
      });
    case "played":
      return rows.slice().sort((a, b) => b.n - a.n || b.wins - a.wins || cmp(a, b));
    case "controversial":
      return rows.slice().sort((a, b) => {
        const aScore = a.n * (1 - Math.abs(0.5 - a.winPct / 100) * 2);
        const bScore = b.n * (1 - Math.abs(0.5 - b.winPct / 100) * 2);
        return bScore - aScore || cmp(a, b);
      });
    default: // adjusted
      return rows.slice().sort((a, b) => b.wilsonScore - a.wilsonScore || b.n - a.n || b.wins - a.wins || cmp(a, b));
  }
}

// ==========================================
// RENDERING — poster thumbnail in Movie cell
// ==========================================

function movieCellHTML(title, year, movieKey) {
  const cached = getPosterUrl(movieKey);
  const posterHTML = cached
    ? `<div class="poster-thumb-wrap"><img class="poster-thumb" src="${cached}" alt="" loading="lazy" /></div>`
    : `<div class="poster-thumb-wrap"><img class="poster-thumb" src="" alt="" loading="lazy" style="opacity:0" data-needs-poster="${movieKey}" /></div>`;
  return `
    <div class="movie-row">
      ${posterHTML}
      <div class="movie-meta">
        <span class="movie-name">${title}</span>
        ${year ? `<span class="movie-yr">${year}</span>` : ""}
      </div>
    </div>
  `;
}

function renderTable(tbody, rows) {
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="results-empty">No results to display.</td></tr>';
    return;
  }
  rows.forEach((m, i) => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => showMatchupModal(m));
    const pctClass = m.winPct >= 70 ? "win-pct-high" : m.winPct >= 50 ? "win-pct-medium" : "win-pct-low";
    tr.innerHTML = `
      <td class="col-rank">${i + 1}</td>
      <td class="col-movie">${movieCellHTML(m.title, m.year, m.key)}</td>
      <td class="col-num">${m.n}</td>
      <td class="col-num">${m.wins}</td>
      <td class="col-num">${m.losses}</td>
      <td class="col-num ${pctClass}">${m.winPct.toFixed(1)}%</td>
      <td class="col-num col-score">${m.n === 0 ? "—" : m.displayScore.toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });
  lazyLoadPosters(tbody);
}

function renderCards(container, rows) {
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="results-empty">No results to display.</div>';
    return;
  }
  rows.forEach((m, i) => {
    const pctClass = m.winPct >= 70 ? "win-pct-high" : m.winPct >= 50 ? "win-pct-medium" : "win-pct-low";
    const cached = getPosterUrl(m.key);
    const posterHTML = cached
      ? `<img class="poster-thumb poster-thumb--card" src="${cached}" alt="" loading="lazy" />`
      : `<img class="poster-thumb poster-thumb--card" src="" alt="" loading="lazy" style="opacity:0" data-needs-poster="${m.key}" />`;
    const card = document.createElement("div");
    card.className = "result-card";
    card.style.cursor = "pointer";
    card.addEventListener("click", () => showMatchupModal(m));
    card.innerHTML = `
      <div class="result-card-rank">${i + 1}</div>
      ${posterHTML}
      <div class="result-card-body">
        <div class="result-card-title">${m.title} ${m.year ? `<span class="movie-yr">${m.year}</span>` : ""}</div>
        <div class="result-card-stats">
          <span>${m.n} matchups</span>
          <span>${m.wins}W / ${m.losses}L</span>
          <span class="${pctClass}">${m.winPct.toFixed(1)}%</span>
        </div>
      </div>
      <div class="result-card-score" title="Win rate adjusted for how many matchups the movie has played.">${m.n === 0 ? "—" : m.displayScore.toFixed(1)}</div>
    `;
    container.appendChild(card);
  });
  lazyLoadPosters(container);
}

// ==========================================
// TAB SWITCHING
// ==========================================

document.querySelectorAll(".results-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".results-tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".results-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
  });
});

// ==========================================
// WIRING: GLOBAL (reads stats/global — 1 doc)
// ==========================================

let globalAllRows = [];

function applyGlobalFilters() {
  const sort = document.getElementById("global-sort").value;
  const showVal = document.getElementById("global-show").value;
  const search = document.getElementById("global-search").value.toLowerCase().trim();
  const hideLow = document.getElementById("global-hide-low").checked;

  let filtered = globalAllRows;
  if (hideLow) filtered = filtered.filter(r => r.n >= MIN_MATCHUPS);
  if (search) filtered = filtered.filter(r => r.title.toLowerCase().includes(search));
  let sorted = sortRows(filtered, sort);

  if (search) {
    sorted = sorted.slice(0, 50);
  } else {
    sorted = sorted.slice(0, parseInt(showVal));
  }

  renderTable(document.getElementById("global-list"), sorted);
  renderCards(document.getElementById("global-cards"), sorted);
}

document.getElementById("global-sort").addEventListener("change", applyGlobalFilters);
document.getElementById("global-show").addEventListener("change", applyGlobalFilters);
document.getElementById("global-search").addEventListener("input", applyGlobalFilters);
document.getElementById("global-hide-low").addEventListener("change", applyGlobalFilters);

// Cached global stats for cross-tab use (e.g. Michael's global rank)
let cachedGlobalStats = {};
let unsubGlobal = null;

async function loadGlobalStats() {
  const countEl = document.getElementById("global-count");
  const tbody = document.getElementById("global-list");
  const cards = document.getElementById("global-cards");
  tbody.innerHTML = '<tr><td colspan="7" class="results-empty">Loading global rankings...</td></tr>';
  cards.innerHTML = '<div class="results-empty">Loading...</div>';

  // Fetch total vote count once (stats/meta is not per-vote, so a one-time read is fine)
  try {
    const metaSnap = await getDoc(doc(db, "stats", "meta"));
    const totalVotes = metaSnap.exists() ? (metaSnap.data().totalVotes || 0) : 0;
    const globalCountText = `${totalVotes.toLocaleString()} total votes across all users`;
    countEl.textContent = globalCountText;
    countEl.dataset.globalCount = globalCountText;
  } catch {
    countEl.textContent = "";
    countEl.dataset.globalCount = "";
  }

  // Live listener — re-fires automatically whenever a vote is cast (1 read per update).
  // Returns a Promise that resolves after the first snapshot so callers can await
  // globalAllRows being populated before rendering dependent UI (e.g. worst movies).
  if (unsubGlobal) unsubGlobal();
  return new Promise((resolve) => {
    let settled = false;
    unsubGlobal = onSnapshot(
      doc(db, "stats", "global"),
      (snap) => {
        cachedGlobalStats = snap.exists() ? (snap.data().stats || {}) : {};
        globalAllRows = buildNormalizedRankedData(cachedGlobalStats);
        applyGlobalFilters();
        if (!settled) { settled = true; resolve(); }
      },
      (err) => {
        console.error("loadGlobalStats onSnapshot error:", err);
        tbody.innerHTML = '<tr><td colspan="7" class="results-empty results-error">Failed to load global rankings.</td></tr>';
        cards.innerHTML = '<div class="results-empty results-error">Failed to load global rankings.</div>';
        countEl.textContent = "Unable to load";
        if (!settled) { settled = true; resolve(); }
      }
    );
  });
}

// ==========================================
// ADMIN — USER LIST + FILTER
// ==========================================

async function loadAdminUserList() {
  const group = document.getElementById("admin-user-filter-group");
  const select = document.getElementById("admin-user-select");
  if (!group || !select) return;

  try {
    const snap = await getDocs(collection(db, "usernames"));
    const users = [];
    snap.forEach(d => users.push({ username: d.id, uid: d.data().uid }));
    users.sort((a, b) => a.username.localeCompare(b.username));

    users.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.uid;
      opt.textContent = u.username;
      select.appendChild(opt);
    });

    group.style.display = "";
    select.addEventListener("change", onAdminUserFilterChange);
  } catch (err) {
    console.error("Failed to load user list:", err);
  }
}

async function onAdminUserFilterChange() {
  const select = document.getElementById("admin-user-select");
  const uid = select.value;
  const username = uid ? select.options[select.selectedIndex].textContent : null;
  adminSelectedUid = uid || null;
  adminSelectedUsername = username || null;

  const countEl = document.getElementById("global-count");

  if (!uid) {
    // Restore real global data
    globalAllRows = buildNormalizedRankedData(cachedGlobalStats);
    if (countEl) countEl.textContent = countEl.dataset.globalCount || "";
    applyGlobalFilters();
    return;
  }

  const tbody = document.getElementById("global-list");
  const cards = document.getElementById("global-cards");
  tbody.innerHTML = '<tr><td colspan="7" class="results-empty">Loading...</td></tr>';
  cards.innerHTML = '<div class="results-empty">Loading...</div>';

  try {
    const snap = await getDoc(doc(db, "stats", `user_${uid}`));
    const userStats = snap.exists() ? (snap.data().stats || {}) : {};
    globalAllRows = buildNormalizedRankedData(userStats);

    // Update the vote count label for this user
    let totalVotes = 0;
    for (const s of Object.values(userStats)) {
      totalVotes += (s.wins || 0) + (s.losses || 0);
    }
    if (countEl) countEl.textContent = `${Math.round(totalVotes / 2).toLocaleString()} votes by @${username}`;

    applyGlobalFilters();
  } catch (err) {
    console.error("Failed to load user stats:", err);
    tbody.innerHTML = '<tr><td colspan="7" class="results-empty results-error">Failed to load user rankings.</td></tr>';
    cards.innerHTML = '<div class="results-empty results-error">Failed to load.</div>';
  }
}

// ==========================================
// PERSONAL PROGRESS STATS
// ==========================================

function renderPersonalProgress(matchups, comparedCount) {
  const el = document.getElementById("personal-progress");
  if (!el) return;
  el.innerHTML = `
    <div class="progress-stats" style="grid-template-columns: repeat(2, 1fr); max-width: 360px; margin-bottom: var(--s-4);">
      <div class="progress-stat">
        <div class="progress-stat-val">${matchups.toLocaleString()}</div>
        <div class="progress-stat-label">Votes Cast</div>
      </div>
      <div class="progress-stat">
        <div class="progress-stat-val">${comparedCount.toLocaleString()}</div>
        <div class="progress-stat-label">Movies Compared</div>
      </div>
    </div>
  `;
}

// ==========================================
// WIRING: PERSONAL (reads stats/user_{uid} — 1 doc)
// ==========================================

let personalAllRows = [];

function applyPersonalFilters() {
  const sort = document.getElementById("personal-sort").value;
  const showVal = document.getElementById("personal-show").value;
  const search = document.getElementById("personal-search").value.toLowerCase().trim();

  let filtered = personalAllRows;
  if (search) filtered = filtered.filter(r => r.title.toLowerCase().includes(search));
  let sorted = sortRows(filtered, sort);

  if (search) {
    sorted = sorted.slice(0, 50);
  } else {
    sorted = sorted.slice(0, parseInt(showVal));
  }

  renderTable(document.getElementById("personal-list"), sorted);
  renderCards(document.getElementById("personal-cards"), sorted);
}

document.getElementById("personal-sort").addEventListener("change", applyPersonalFilters);
document.getElementById("personal-show").addEventListener("change", applyPersonalFilters);
document.getElementById("personal-search").addEventListener("input", applyPersonalFilters);

async function loadPersonalStats(uid) {
  const countEl = document.getElementById("personal-count");
  const tbody = document.getElementById("personal-list");
  const cards = document.getElementById("personal-cards");
  tbody.innerHTML = '<tr><td colspan="7" class="results-empty">Loading your rankings...</td></tr>';
  cards.innerHTML = '<div class="results-empty">Loading...</div>';

  try {
    // Read stats/user_{uid} (1 Firestore read)
    const snap = await getDoc(doc(db, "stats", `user_${uid}`));
    const userStats = snap.exists() ? (snap.data().stats || {}) : {};

    // Count total votes from the aggregate
    let totalVotes = 0;
    for (const s of Object.values(userStats)) {
      totalVotes += (s.wins || 0) + (s.losses || 0);
    }
    // Each vote creates one win + one loss entry, so total matchups = totalVotes / 2
    const matchups = Math.round(totalVotes / 2);
    countEl.textContent = `${matchups.toLocaleString()} votes`;

    // Movies with at least one appearance in any matchup
    const comparedCount = Object.values(userStats).filter(s => (s.wins || 0) + (s.losses || 0) > 0).length;
    renderPersonalProgress(matchups, comparedCount);

    personalAllRows = buildNormalizedRankedData(userStats);
    applyPersonalFilters();
  } catch (err) {
    console.error("loadPersonalStats error:", err);
    tbody.innerHTML = '<tr><td colspan="7" class="results-empty results-error">Failed to load personal rankings.</td></tr>';
    cards.innerHTML = '<div class="results-empty results-error">Failed to load.</div>';
    countEl.textContent = "Error";
  }
}

// ==========================================
// WORST MOVIES (within Personal tab, reuses personalAllRows + cachedGlobalStats)
// ==========================================

const WORST_MIN_MATCHUPS = 5;
const WORST_LIMIT = 10;
const WORST_GLOBAL_MIN = 20;

function renderWorstMovies(allRows) {
  const section = document.getElementById("worst-movies-section");
  const tbody = document.getElementById("worst-list");
  const cards = document.getElementById("worst-cards");
  if (!section || !tbody || !cards) return;

  // Filter: minimum matchups threshold
  const eligible = allRows.filter(r => r.n >= WORST_MIN_MATCHUPS);

  if (eligible.length === 0) {
    section.style.display = "";
    tbody.innerHTML = '<tr><td colspan="5" class="results-empty">Vote more to reveal your worst movies (min 5 matchups each).</td></tr>';
    cards.innerHTML = '<div class="results-empty">Vote more to reveal your worst movies.</div>';
    return;
  }

  // Sort ascending by win rate, then by more matchups first, then more losses first
  const sorted = eligible.slice().sort((a, b) =>
    a.winPct - b.winPct || b.n - a.n || b.losses - a.losses
  );

  const worst = sorted.slice(0, WORST_LIMIT);

  // Build global win-rate lookup from normalized globalAllRows (already in memory, 0 reads)
  const globalWinRates = {};
  for (const r of globalAllRows) {
    if (r.n >= WORST_GLOBAL_MIN) {
      globalWinRates[r.key] = r.winPct.toFixed(1);
    }
  }

  section.style.display = "";

  // Render table
  tbody.innerHTML = "";
  worst.forEach((m, i) => {
    const tr = document.createElement("tr");
    const pctClass = m.winPct <= 30 ? "win-pct-low" : m.winPct <= 50 ? "win-pct-medium" : "";
    const communityPct = globalWinRates[m.key];
    const communityHTML = communityPct != null
      ? `<span class="${parseFloat(communityPct) >= 50 ? 'win-pct-high' : parseFloat(communityPct) >= 30 ? 'win-pct-medium' : 'win-pct-low'}">${communityPct}%</span>`
      : "—";
    tr.innerHTML = `
      <td class="col-rank">${i + 1}</td>
      <td class="col-movie">${movieCellHTML(m.title, m.year, m.key)}</td>
      <td class="col-num">${m.wins}W – ${m.losses}L</td>
      <td class="col-num ${pctClass}">${m.winPct.toFixed(1)}%</td>
      <td class="col-num">${communityHTML}</td>
    `;
    tbody.appendChild(tr);
  });
  lazyLoadPosters(tbody);

  // Render mobile cards
  cards.innerHTML = "";
  worst.forEach((m, i) => {
    const pctClass = m.winPct <= 30 ? "win-pct-low" : m.winPct <= 50 ? "win-pct-medium" : "";
    const communityPct = globalWinRates[m.key];
    const communityText = communityPct != null ? `Community: ${communityPct}%` : "";
    const cached = getPosterUrl(m.key);
    const posterHTML = cached
      ? `<img class="poster-thumb poster-thumb--card" src="${cached}" alt="" loading="lazy" />`
      : `<img class="poster-thumb poster-thumb--card" src="" alt="" loading="lazy" style="opacity:0" data-needs-poster="${m.key}" />`;
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-card-rank">${i + 1}</div>
      ${posterHTML}
      <div class="result-card-body">
        <div class="result-card-title">${m.title} ${m.year ? `<span class="movie-yr">${m.year}</span>` : ""}</div>
        <div class="result-card-stats">
          <span>${m.wins}W – ${m.losses}L</span>
          <span class="${pctClass}">${m.winPct.toFixed(1)}%</span>
          ${communityText ? `<span>${communityText}</span>` : ""}
        </div>
      </div>
    `;
    cards.appendChild(card);
  });
  lazyLoadPosters(cards);

  // Show note if fewer than 10 eligible
  if (eligible.length < WORST_LIMIT) {
    const note = document.createElement("div");
    note.className = "results-empty";
    note.style.paddingTop = "var(--s-2)";
    note.style.paddingBottom = "0";
    note.textContent = "Vote more to reveal more worst movies.";
    cards.after(note);
  }
}

// ==========================================
// MICHAEL'S RANKINGS TAB (reads stats/meta + stats/user_{mikeUid} — 2 docs)
// ==========================================

async function fetchTmdbRating(title, year) {
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
    const res = await fetch(url);
    const data = await res.json();
    const movie = data.results?.[0];
    return movie ? movie.vote_average : null;
  } catch {
    return null;
  }
}

function renderMichaelsTable(tbody, rows) {
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="results-empty">No results to display.</td></tr>';
    return;
  }
  rows.forEach((m, i) => {
    const pctClass = m.winPct >= 70 ? "win-pct-high" : m.winPct >= 50 ? "win-pct-medium" : "win-pct-low";
    const ratingDisplay = m.tmdbRating != null ? m.tmdbRating.toFixed(1) : "—";
    const globalDisplay = m.globalRank != null ? m.globalRank : "—";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-rank">${i + 1}</td>
      <td class="col-movie">${movieCellHTML(m.title, m.year, m.key)}</td>
      <td class="col-num">${m.n}</td>
      <td class="col-num">${m.wins}</td>
      <td class="col-num">${m.losses}</td>
      <td class="col-num ${pctClass}">${m.winPct.toFixed(1)}%</td>
      <td class="col-num col-score">${m.n === 0 ? "—" : m.displayScore.toFixed(1)}</td>
      <td class="col-num">${globalDisplay}</td>
      <td class="col-num">${ratingDisplay}</td>
    `;
    tbody.appendChild(tr);
  });
  lazyLoadPosters(tbody);
}

function renderMichaelsCards(container, rows) {
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="results-empty">No results to display.</div>';
    return;
  }
  rows.forEach((m, i) => {
    const pctClass = m.winPct >= 70 ? "win-pct-high" : m.winPct >= 50 ? "win-pct-medium" : "win-pct-low";
    const ratingDisplay = m.tmdbRating != null ? m.tmdbRating.toFixed(1) : "—";
    const globalDisplay = m.globalRank != null ? `#${m.globalRank}` : "—";
    const cached = getPosterUrl(m.key);
    const posterHTML = cached
      ? `<img class="poster-thumb poster-thumb--card" src="${cached}" alt="" loading="lazy" />`
      : `<img class="poster-thumb poster-thumb--card" src="" alt="" loading="lazy" style="opacity:0" data-needs-poster="${m.key}" />`;
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-card-rank">${i + 1}</div>
      ${posterHTML}
      <div class="result-card-body">
        <div class="result-card-title">${m.title} ${m.year ? `<span class="movie-yr">${m.year}</span>` : ""}</div>
        <div class="result-card-stats">
          <span>${m.n} matchups</span>
          <span>${m.wins}W / ${m.losses}L</span>
          <span class="${pctClass}">${m.winPct.toFixed(1)}%</span>
          <span>Global: ${globalDisplay}</span>
          <span>Rating: ${ratingDisplay}</span>
        </div>
      </div>
      <div class="result-card-score" title="Adjusted score">${m.n === 0 ? "—" : m.displayScore.toFixed(1)}</div>
    `;
    container.appendChild(card);
  });
  lazyLoadPosters(container);
}

async function loadMichaelsRankings() {
  const statusEl = document.getElementById("michaels-status");
  const tbody = document.getElementById("michaels-list");
  const cards = document.getElementById("michaels-cards");
  if (!tbody || !cards) return;

  tbody.innerHTML = '<tr><td colspan="9" class="results-empty">Loading Michael\'s rankings...</td></tr>';
  cards.innerHTML = '<div class="results-empty">Loading...</div>';

  try {
    // Read stats/meta for Mike's UID (1 read)
    const metaSnap = await getDoc(doc(db, "stats", "meta"));
    const meta = metaSnap.exists() ? metaSnap.data() : {};
    const mikeUid = meta.mikeUid;

    if (!mikeUid) {
      statusEl.textContent = "Michael's UID not configured.";
      tbody.innerHTML = '<tr><td colspan="9" class="results-empty">Michael\'s rankings not available.</td></tr>';
      cards.innerHTML = '<div class="results-empty">Not available.</div>';
      return;
    }

    // Read Mike's per-user stats (1 read)
    const mikeSnap = await getDoc(doc(db, "stats", `user_${mikeUid}`));
    const mikeStats = mikeSnap.exists() ? (mikeSnap.data().stats || {}) : {};

    if (Object.keys(mikeStats).length === 0) {
      statusEl.textContent = "No votes found for Michael.";
      tbody.innerHTML = '<tr><td colspan="9" class="results-empty">No votes found.</td></tr>';
      cards.innerHTML = '<div class="results-empty">No votes found.</div>';
      return;
    }

    // Build global rank map from cached global stats (already loaded, 0 extra reads)
    const globalRows = buildRankedData(cachedGlobalStats);
    globalRows.sort((a, b) => b.wilsonScore - a.wilsonScore || b.n - a.n);
    const globalRankMap = {};
    globalRows.forEach((r, i) => { globalRankMap[r.key] = i + 1; });

    // Build Mike's rankings
    let mikeRows = buildRankedData(mikeStats);
    mikeRows.sort((a, b) => b.wilsonScore - a.wilsonScore || b.n - a.n || b.wins - a.wins);
    mikeRows = mikeRows.slice(0, 15);

    mikeRows.forEach(r => {
      r.globalRank = globalRankMap[r.key] || null;
    });

    // Count Mike's total votes
    let totalMikeVotes = 0;
    for (const s of Object.values(mikeStats)) {
      totalMikeVotes += (s.wins || 0) + (s.losses || 0);
    }
    statusEl.textContent = `${Math.round(totalMikeVotes / 2).toLocaleString()} total votes by Michael`;

    // Render immediately without TMDB ratings
    mikeRows.forEach(r => { r.tmdbRating = null; });
    renderMichaelsTable(tbody, mikeRows);
    renderMichaelsCards(cards, mikeRows);

    // Fetch TMDB ratings in background and re-render
    const ratingPromises = mikeRows.map(async r => {
      r.tmdbRating = await fetchTmdbRating(r.title, r.year);
    });
    await Promise.all(ratingPromises);
    renderMichaelsTable(tbody, mikeRows);
    renderMichaelsCards(cards, mikeRows);

  } catch (err) {
    console.error("loadMichaelsRankings error:", err);
    statusEl.textContent = "Unable to load";
    tbody.innerHTML = '<tr><td colspan="9" class="results-empty results-error">Failed to load Michael\'s rankings.</td></tr>';
    cards.innerHTML = '<div class="results-empty results-error">Failed to load.</div>';
  }
}

// ==========================================
// MATCHUP MODAL — with matchup history
// ==========================================

let cachedUserVotes = null;
let cachedUserUid = null;

function getActiveTab() {
  const active = document.querySelector(".results-tab.active");
  return active ? active.dataset.tab : "global";
}

async function fetchUserVotes(uid) {
  if (cachedUserVotes && cachedUserUid === uid) return cachedUserVotes;
  const q = query(collection(db, "votes"), where("user", "==", uid));
  const snap = await getDocs(q);
  const votes = [];
  snap.forEach(d => votes.push(d.data()));
  cachedUserVotes = votes;
  cachedUserUid = uid;
  return votes;
}

async function fetchGlobalMovieVotes(movieKey) {
  // Also query the legacy "Title Year" format (no pipe) to pick up votes written
  // before the canonical "Title|Year" format was introduced.
  const altKey = movieKey.includes("|") ? movieKey.replace("|", " ") : null;

  const queryPromises = [
    getDocs(query(collection(db, "votes"), where("winner", "==", movieKey))),
    getDocs(query(collection(db, "votes"), where("loser",   "==", movieKey)))
  ];
  if (altKey && altKey !== movieKey) {
    queryPromises.push(getDocs(query(collection(db, "votes"), where("winner", "==", altKey))));
    queryPromises.push(getDocs(query(collection(db, "votes"), where("loser",   "==", altKey))));
  }

  const snaps = await Promise.all(queryPromises);
  const seen  = new Set();
  const votes = [];
  snaps.forEach(snap => {
    snap.forEach(d => {
      if (!seen.has(d.id)) {
        seen.add(d.id);
        votes.push(d.data());
      }
    });
  });
  return votes;
}

function renderMatchupHistory(votes, movieKey) {
  if (!votes.length) {
    return '<div class="results-empty" style="font-style:normal; color:var(--color-text-2);">No matchups recorded yet for this title.</div>';
  }

  // Sort by timestamp descending (votes without timestamp go last)
  votes.sort((a, b) => {
    const ta = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
    const tb = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
    return tb - ta;
  });

  return votes.map(v => {
    const isWin = normalizeKey(v.winner) === movieKey;
    const opponentKey = normalizeKey(isWin ? v.loser : v.winner);
    const opponentTitle = opponentKey.split("|")[0];
    const opponentYear = opponentKey.split("|")[1] || "";
    const resultClass = isWin ? "matchup-row--win" : "matchup-row--loss";
    const resultLabel = isWin ? "W" : "L";

    let dateStr = "";
    const ts = v.timestamp?.toMillis?.() || (v.timestamp?.seconds ? v.timestamp.seconds * 1000 : 0);
    if (ts) {
      const d = new Date(ts);
      dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }

    return `<div class="matchup-row ${resultClass}">
      <span class="matchup-row-result">${resultLabel}</span>
      <span class="matchup-row-opponent">${opponentTitle}${opponentYear ? ` (${opponentYear})` : ""}</span>
      <span class="matchup-row-date">${dateStr}</span>
    </div>`;
  }).join("");
}

// Recompute wins/losses from raw vote documents and update the modal header.
// This keeps the header consistent with the history list when the stats/global
// aggregate has drifted out of sync with the votes collection.
function updateModalStatsFromVotes(votes, movieKey) {
  if (!votes.length) return;
  const actualWins   = votes.filter(v => normalizeKey(v.winner) === movieKey).length;
  const actualLosses = votes.filter(v => normalizeKey(v.loser)  === movieKey).length;
  const actualN = actualWins + actualLosses;
  if (actualN === 0) return;
  const actualWinPct = (actualWins / actualN) * 100;
  const actualWs = Math.round(wilsonScore(actualWins, actualLosses) * 1000) / 10;
  document.getElementById("matchup-modal-stats").innerHTML = `
    <div class="matchup-stat"><span class="matchup-stat-val">${actualWins}W - ${actualLosses}L</span><span class="matchup-stat-label">Record</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${actualWinPct.toFixed(1)}%</span><span class="matchup-stat-label">Win Rate</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${actualN}</span><span class="matchup-stat-label">Matchups</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${actualN === 0 ? "—" : actualWs.toFixed(1)}</span><span class="matchup-stat-label">Adj. Score</span></div>
  `;
}

async function showMatchupModal(movie) {
  const { key, title, year, wins, losses, n, winPct, displayScore } = movie;

  document.getElementById("matchup-modal-title").textContent = title + (year ? ` (${year})` : "");

  document.getElementById("matchup-modal-stats").innerHTML = `
    <div class="matchup-stat"><span class="matchup-stat-val">${wins}W - ${losses}L</span><span class="matchup-stat-label">Record</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${winPct.toFixed(1)}%</span><span class="matchup-stat-label">Win Rate</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${n}</span><span class="matchup-stat-label">Matchups</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${displayScore.toFixed(1)}</span><span class="matchup-stat-label">Adj. Score</span></div>
  `;

  const listEl = document.getElementById("matchup-modal-list");
  document.getElementById("matchup-modal").classList.remove("hidden");

  const activeTab = getActiveTab();

  if (activeTab === "personal") {
    listEl.innerHTML = '<div class="results-empty" style="color:var(--color-text-2);">Loading matchup history...</div>';
    try {
      const uid = cachedUserUid || (await new Promise(resolve => onAuth(u => resolve(u?.uid))));
      if (!uid) {
        listEl.innerHTML = '<div class="results-empty" style="color:var(--color-text-2);">Log in to see your matchup history.</div>';
        return;
      }
      const votes = await fetchUserVotes(uid);
      const movieVotes = votes.filter(v => normalizeKey(v.winner) === key || normalizeKey(v.loser) === key);

      // Recompute stats from raw votes — overrides potentially stale aggregate
      updateModalStatsFromVotes(movieVotes, key);

      listEl.innerHTML = renderMatchupHistory(movieVotes, key);
    } catch (err) {
      console.error("Matchup history error:", err);
      listEl.innerHTML = '<div class="results-empty results-error">Failed to load matchup history.</div>';
    }
  } else if (activeTab === "global") {
    listEl.innerHTML = '<div class="results-empty" style="color:var(--color-text-2);">Loading matchup history...</div>';
    try {
      if (adminSelectedUid) {
        // Admin is viewing a specific user's results — show that user's votes for this movie
        const allVotes = await fetchUserVotes(adminSelectedUid);
        const votes = allVotes.filter(v => normalizeKey(v.winner) === key || normalizeKey(v.loser) === key);
        updateModalStatsFromVotes(votes, key);
        listEl.innerHTML = renderMatchupHistory(votes, key);
      } else if (currentIsAdmin) {
        // Admin global view — show all community votes for this movie
        const votes = await fetchGlobalMovieVotes(key);
        updateModalStatsFromVotes(votes, key);
        listEl.innerHTML = renderMatchupHistory(votes, key);
      } else {
        // Non-admin: show their own votes for this movie (uses updated Firestore rule)
        const uid = cachedUserUid || (await new Promise(resolve => onAuth(u => resolve(u?.uid))));
        if (!uid) {
          listEl.innerHTML = '<div class="results-empty" style="color:var(--color-text-2);">Log in to see your matchup history for this film.</div>';
          return;
        }
        const allVotes = await fetchUserVotes(uid);
        const votes = allVotes.filter(v => normalizeKey(v.winner) === key || normalizeKey(v.loser) === key);
        updateModalStatsFromVotes(votes, key);
        listEl.innerHTML = votes.length
          ? renderMatchupHistory(votes, key)
          : '<div class="results-empty" style="font-style:normal; color:var(--color-text-2);">You haven\'t voted on this film yet.</div>';
      }
    } catch (err) {
      console.error("Matchup history error:", err);
      listEl.innerHTML = '<div class="results-empty results-error">Failed to load matchup history.</div>';
    }
  } else {
    listEl.innerHTML = '<div class="results-empty" style="font-style:normal; color:var(--color-text-2);">Matchup history is available in Your Results and Community Results.</div>';
  }
}

function closeMatchupModal() {
  document.getElementById("matchup-modal").classList.add("hidden");
}

document.getElementById("matchup-modal").addEventListener("click", (e) => {
  if (e.target.id === "matchup-modal") closeMatchupModal();
});
document.getElementById("matchup-modal-close").addEventListener("click", closeMatchupModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMatchupModal();
});

// ==========================================
// INIT
// ==========================================

window.addEventListener("beforeunload", () => {
  if (unsubGlobal) unsubGlobal();
});

window.addEventListener("load", async () => {
  await initNormalizer();
  onAuth(async user => {
    if (user) {
      // Detect admin status
      const isAdminEmail = user.email === ADMIN_EMAIL;
      let isAdmin = isAdminEmail;
      if (!isAdminEmail) {
        try {
          const tokenResult = await user.getIdTokenResult();
          isAdmin = tokenResult.claims.admin === true;
        } catch { isAdmin = false; }
      }
      currentIsAdmin = isAdmin;

      await loadPersonalStats(user.uid);
      if (isAdmin) await loadAdminUserList();
    } else {
      document.getElementById("personal-list").innerHTML = '<tr><td colspan="7" class="results-empty">Log in to see your personal rankings.</td></tr>';
      document.getElementById("personal-cards").innerHTML = '<div class="results-empty">Log in to see your rankings.</div>';
      document.getElementById("personal-count").textContent = "Log in to view";
    }
    await loadGlobalStats();
    // Render worst movies after global stats are loaded (for community comparison)
    if (user && personalAllRows.length > 0) {
      renderWorstMovies(personalAllRows);
    }
    await loadMichaelsRankings();
  });
});
