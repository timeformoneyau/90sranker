import {
  db,
  onAuth,
  doc,
  getDoc,
  collection,
  getDocs
} from "./firebase.js";

import { makeMovieKey, buildKeyNormalizer } from "./movieKeys.js";

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

async function loadGlobalStats() {
  const countEl = document.getElementById("global-count");
  const tbody = document.getElementById("global-list");
  const cards = document.getElementById("global-cards");
  tbody.innerHTML = '<tr><td colspan="7" class="results-empty">Loading global rankings...</td></tr>';
  cards.innerHTML = '<div class="results-empty">Loading...</div>';

  try {
    // Read stats/global (1 Firestore read) + stats/meta (1 read)
    const [globalSnap, metaSnap] = await Promise.all([
      getDoc(doc(db, "stats", "global")),
      getDoc(doc(db, "stats", "meta"))
    ]);

    const totalVotes = metaSnap.exists() ? (metaSnap.data().totalVotes || 0) : 0;
    countEl.textContent = `${totalVotes.toLocaleString()} total votes across all users`;

    cachedGlobalStats = globalSnap.exists() ? (globalSnap.data().stats || {}) : {};
    globalAllRows = buildRankedData(cachedGlobalStats);
    applyGlobalFilters();
  } catch (err) {
    console.error("loadGlobalStats error:", err);
    tbody.innerHTML = '<tr><td colspan="7" class="results-empty results-error">Failed to load global rankings.</td></tr>';
    cards.innerHTML = '<div class="results-empty results-error">Failed to load global rankings.</div>';
    countEl.textContent = "Unable to load";
  }
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

    personalAllRows = buildRankedData(userStats);
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

  // Build global win-rate lookup from cached stats (already in memory, 0 reads)
  const globalWinRates = {};
  if (cachedGlobalStats) {
    for (const [key, s] of Object.entries(cachedGlobalStats)) {
      const gw = s.wins || 0;
      const gl = s.losses || 0;
      const gn = gw + gl;
      if (gn >= WORST_GLOBAL_MIN) {
        globalWinRates[key] = ((gw / gn) * 100).toFixed(1);
      }
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
// WIRING: TOUGH CALLS TAB (reads toughCalls — small collection)
// ==========================================

async function loadToughCallsTab() {
  const countEl = document.getElementById("toughcalls-count");
  const gridEl = document.getElementById("toughcalls-grid");
  const cardsEl = document.getElementById("toughcalls-cards");
  if (!gridEl) return;

  gridEl.innerHTML = '<div class="results-empty">Loading Face / Off matchups...</div>';
  cardsEl.innerHTML = '<div class="results-empty">Loading...</div>';

  try {
    const snap = await getDocs(collection(db, "toughCalls"));
    const toughCalls = [];

    snap.forEach(d => {
      const data = d.data();
      if (data.totalVotes > 0) {
        toughCalls.push({ id: d.id, ...data });
      }
    });

    toughCalls.sort((a, b) => (b.totalVotes || 0) - (a.totalVotes || 0));
    const top10 = toughCalls.slice(0, 10);

    countEl.textContent = `${toughCalls.length} Face / Off matchup${toughCalls.length !== 1 ? "s" : ""} with votes`;

    if (top10.length === 0) {
      gridEl.innerHTML = '<div class="results-empty">No Face / Off votes yet. Flag a matchup from the home page!</div>';
      cardsEl.innerHTML = '<div class="results-empty">No Face / Off votes yet.</div>';
      return;
    }

    let tableHTML = `<div class="results-table-wrap"><table class="results-table">
      <thead><tr>
        <th class="col-rank">#</th>
        <th class="col-movie">Matchup</th>
        <th class="col-num">Total Votes</th>
        <th class="col-num">Split</th>
      </tr></thead><tbody>`;

    top10.forEach((tc, i) => {
      const mA = tc.movieAKey.split("|")[0];
      const yA = tc.movieAKey.split("|")[1] || "";
      const mB = tc.movieBKey.split("|")[0];
      const yB = tc.movieBKey.split("|")[1] || "";
      const vA = tc.votesA || 0;
      const vB = tc.votesB || 0;
      const total = tc.totalVotes || 0;
      const pctA = total ? Math.round((vA / total) * 100) : 50;
      const pctB = total ? 100 - pctA : 50;

      tableHTML += `<tr>
        <td class="col-rank">${i + 1}</td>
        <td class="col-movie">${movieCellHTML(mA, yA, tc.movieAKey)} <span class="tc-vs-label">vs</span> ${movieCellHTML(mB, yB, tc.movieBKey)}</td>
        <td class="col-num">${total}</td>
        <td class="col-num"><span class="${pctA >= pctB ? 'win-pct-high' : 'win-pct-low'}">${pctA}%</span> <span class="tc-vs-label">vs</span> <span class="${pctB >= pctA ? 'win-pct-high' : 'win-pct-low'}">${pctB}%</span></td>
      </tr>`;
    });

    tableHTML += "</tbody></table></div>";
    gridEl.innerHTML = tableHTML;
    lazyLoadPosters(gridEl);

    cardsEl.innerHTML = "";
    top10.forEach((tc, i) => {
      const mA = tc.movieAKey.split("|")[0];
      const mB = tc.movieBKey.split("|")[0];
      const vA = tc.votesA || 0;
      const vB = tc.votesB || 0;
      const total = tc.totalVotes || 0;
      const pctA = total ? Math.round((vA / total) * 100) : 50;
      const pctB = total ? 100 - pctA : 50;

      const card = document.createElement("div");
      card.className = "result-card";
      card.innerHTML = `
        <div class="result-card-rank">${i + 1}</div>
        <div class="result-card-body">
          <div class="result-card-title">${mA} <span class="tc-vs-label">vs</span> ${mB}</div>
          <div class="result-card-stats">
            <span>${total} votes</span>
            <span class="${pctA >= pctB ? 'win-pct-high' : 'win-pct-low'}">${pctA}%</span> vs <span class="${pctB >= pctA ? 'win-pct-high' : 'win-pct-low'}">${pctB}%</span>
          </div>
        </div>
      `;
      cardsEl.appendChild(card);
    });
  } catch (err) {
    console.error("loadToughCallsTab error:", err);
    gridEl.innerHTML = '<div class="results-empty results-error">Failed to load Face / Off matchups.</div>';
    cardsEl.innerHTML = '<div class="results-empty results-error">Failed to load.</div>';
    countEl.textContent = "Error";
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
// MATCHUP MODAL (aggregate-based, no vote scan)
// ==========================================

function showMatchupModal(movie) {
  const { key, title, year, wins, losses, n, winPct, displayScore } = movie;

  document.getElementById("matchup-modal-title").textContent = title + (year ? ` (${year})` : "");

  document.getElementById("matchup-modal-stats").innerHTML = `
    <div class="matchup-stat"><span class="matchup-stat-val">${wins}W - ${losses}L</span><span class="matchup-stat-label">Record</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${winPct.toFixed(1)}%</span><span class="matchup-stat-label">Win Rate</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${n}</span><span class="matchup-stat-label">Matchups</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${displayScore.toFixed(1)}</span><span class="matchup-stat-label">Adj. Score</span></div>
  `;

  document.getElementById("matchup-modal-list").innerHTML =
    '<div class="results-empty" style="font-style:normal; color:var(--color-text-2);">Detailed matchup history is not available in this view.</div>';

  document.getElementById("matchup-modal").classList.remove("hidden");
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

window.addEventListener("load", async () => {
  await initNormalizer();
  onAuth(async user => {
    if (user) {
      await loadPersonalStats(user.uid);
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
    await loadToughCallsTab();
    await loadMichaelsRankings();
  });
});
