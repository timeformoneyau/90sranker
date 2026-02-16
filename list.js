import {
  db,
  onAuth,
  collection,
  query,
  where,
  limit,
  getDocs
} from "./firebase.js";

import { makeMovieKey, buildKeyNormalizer } from "./movieKeys.js";

// ==========================================
// KEY NORMALIZATION
// ==========================================

let normalizeKey = (k) => k; // identity until movie list loads

// ==========================================
// POSTER CACHE + LOOKUP
// ==========================================

const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w300";
const posterMap = {};      // movieKey -> poster URL (from JSON)
const posterCache = {};    // movieKey -> poster URL (runtime TMDB lookups)
const FALLBACK_POSTER = "./fallback.jpg";

async function initNormalizer() {
  try {
    const res = await fetch("movie_list_cleaned.json");
    const allMovies = await res.json();
    const movies = allMovies.filter(m => m.title && m.year && !/^title$/i.test(m.title.trim()));
    normalizeKey = buildKeyNormalizer(movies);

    // Build poster map from JSON data
    movies.forEach(m => {
      const key = makeMovieKey(m.title, m.year);
      if (m.poster) {
        posterMap[key] = m.poster;
      }
    });
  } catch (err) {
    console.warn("Could not load movie list for key normalization:", err);
  }
}

function getPosterUrl(movieKey) {
  // 1. Check JSON-provided poster
  if (posterMap[movieKey]) return posterMap[movieKey];
  // 2. Check runtime cache
  if (posterCache[movieKey]) return posterCache[movieKey];
  // 3. Return null — will be fetched lazily
  return null;
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

// Lazy-load posters for cards that don't have one from JSON.
// Batches fetches and updates images in-place.
async function lazyLoadPosters(container) {
  const imgs = container.querySelectorAll("img[data-needs-poster]");
  const fetches = [];

  for (const img of imgs) {
    const key = img.dataset.needsPoster;
    if (!key) continue;

    const title = key.split("|")[0];
    const year = key.split("|")[1] || "";

    fetches.push(
      fetchPosterFromTMDB(title, year).then(url => {
        if (url) {
          posterCache[key] = url;
          img.src = url;
        } else {
          posterCache[key] = FALLBACK_POSTER;
          img.src = FALLBACK_POSTER;
        }
        img.removeAttribute("data-needs-poster");
      })
    );
  }

  await Promise.all(fetches);
}

// ==========================================
// RAW VOTE STORAGE (for matchup modal)
// ==========================================

let globalVoteDocs = [];
let personalVoteDocs = [];

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
// BUILD RANKED DATA
// ==========================================

function buildRankedData(statsMap) {
  return Object.entries(statsMap).map(([key, r]) => {
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
// POSTER CARD GRID RENDERER
// ==========================================

function renderPosterGrid(container, rows, options = {}) {
  container.innerHTML = "";

  if (!rows.length) {
    container.innerHTML = '<div class="results-empty">No results to display.</div>';
    return;
  }

  rows.forEach((m, i) => {
    const pctClass = m.winPct >= 70 ? "win-pct-high" : m.winPct >= 50 ? "win-pct-medium" : "win-pct-low";
    const poster = getPosterUrl(m.key);
    const needsFetch = !poster;

    const card = document.createElement("div");
    card.className = "rk-card";
    card.style.cursor = "pointer";
    card.addEventListener("click", () => showMatchupModal(m.key));

    // Extra columns for Michael's tab
    let extraStats = "";
    if (options.showGlobalRank) {
      const globalDisplay = m.globalRank != null ? `#${m.globalRank}` : "—";
      const ratingDisplay = m.tmdbRating != null ? m.tmdbRating.toFixed(1) : "—";
      extraStats = `<span class="rk-card-extra">Global ${globalDisplay}</span><span class="rk-card-extra">TMDB ${ratingDisplay}</span>`;
    }

    card.innerHTML = `
      <div class="rk-card-poster-wrap">
        <img class="rk-card-poster"
             src="${poster || FALLBACK_POSTER}"
             alt="${m.title}"
             loading="lazy"
             ${needsFetch ? `data-needs-poster="${m.key}"` : ""} />
        <div class="rk-card-rank">${i + 1}</div>
      </div>
      <div class="rk-card-body">
        <div class="rk-card-title">${m.title}</div>
        <div class="rk-card-year">${m.year || ""}</div>
        <div class="rk-card-stats">
          <span>${m.n} matchups</span>
          <span>${m.wins}W–${m.losses}L</span>
          <span class="${pctClass}">${m.winPct.toFixed(0)}%</span>
          <span class="rk-card-score">${m.n === 0 ? "—" : m.displayScore.toFixed(1)}</span>
          ${extraStats}
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // Lazy-load any posters not found in JSON
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
// WIRING: GLOBAL
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

  // In search mode: show up to 50 results, ignore "Show" dropdown
  if (search) {
    sorted = sorted.slice(0, 50);
  } else {
    sorted = sorted.slice(0, parseInt(showVal));
  }

  renderPosterGrid(document.getElementById("global-grid"), sorted);
}

document.getElementById("global-sort").addEventListener("change", applyGlobalFilters);
document.getElementById("global-show").addEventListener("change", applyGlobalFilters);
document.getElementById("global-search").addEventListener("input", applyGlobalFilters);
document.getElementById("global-hide-low").addEventListener("change", applyGlobalFilters);

async function loadGlobalStats() {
  const countEl = document.getElementById("global-count");
  const grid = document.getElementById("global-grid");
  grid.innerHTML = '<div class="results-empty">Loading global rankings...</div>';

  try {
    const snap = await getDocs(collection(db, "votes"));
    countEl.textContent = `${snap.size.toLocaleString()} total votes across all users`;

    const stats = {};
    globalVoteDocs = [];
    snap.forEach(doc => {
      const d = doc.data();
      const { winner, loser } = d;
      if (!winner || !loser) return;
      globalVoteDocs.push(d);
      const w = normalizeKey(winner);
      const l = normalizeKey(loser);
      stats[w] = stats[w] || { wins: 0, losses: 0 };
      stats[l] = stats[l] || { wins: 0, losses: 0 };
      stats[w].wins++;
      stats[l].losses++;
    });

    globalAllRows = buildRankedData(stats);
    applyGlobalFilters();
  } catch (err) {
    console.error("loadGlobalStats error:", err);
    grid.innerHTML = '<div class="results-empty results-error">Failed to load global rankings.</div>';
    countEl.textContent = "Unable to load";
  }
}

// ==========================================
// WIRING: PERSONAL
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

  renderPosterGrid(document.getElementById("personal-grid"), sorted);
}

document.getElementById("personal-sort").addEventListener("change", applyPersonalFilters);
document.getElementById("personal-show").addEventListener("change", applyPersonalFilters);
document.getElementById("personal-search").addEventListener("input", applyPersonalFilters);

async function loadPersonalStats(uid) {
  const countEl = document.getElementById("personal-count");
  const grid = document.getElementById("personal-grid");
  grid.innerHTML = '<div class="results-empty">Loading your rankings...</div>';

  try {
    const snap = await getDocs(query(
      collection(db, "votes"),
      where("user", "==", uid)
    ));
    countEl.textContent = `${snap.size.toLocaleString()} votes`;

    const stats = {};
    personalVoteDocs = [];
    snap.forEach(doc => {
      const d = doc.data();
      const { winner, loser } = d;
      if (!winner || !loser) return;
      personalVoteDocs.push(d);
      const w = normalizeKey(winner);
      const l = normalizeKey(loser);
      stats[w] = stats[w] || { wins: 0, losses: 0 };
      stats[l] = stats[l] || { wins: 0, losses: 0 };
      stats[w].wins++;
      stats[l].losses++;
    });

    personalAllRows = buildRankedData(stats);
    applyPersonalFilters();
  } catch (err) {
    console.error("loadPersonalStats error:", err);
    grid.innerHTML = '<div class="results-empty results-error">Failed to load personal rankings.</div>';
    countEl.textContent = "Error";
  }
}

// ==========================================
// WIRING: TOUGH CALLS TAB
// ==========================================

async function loadToughCallsTab() {
  const countEl = document.getElementById("toughcalls-count");
  const gridEl = document.getElementById("toughcalls-grid");
  const cardsEl = document.getElementById("toughcalls-cards");
  if (!gridEl) return;

  gridEl.innerHTML = '<div class="results-empty">Loading tough calls...</div>';
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

    // Sort by total votes desc
    toughCalls.sort((a, b) => (b.totalVotes || 0) - (a.totalVotes || 0));
    const top10 = toughCalls.slice(0, 10);

    countEl.textContent = `${toughCalls.length} tough call${toughCalls.length !== 1 ? "s" : ""} with votes`;

    if (top10.length === 0) {
      gridEl.innerHTML = '<div class="results-empty">No tough call votes yet. Flag a matchup from the home page!</div>';
      cardsEl.innerHTML = '<div class="results-empty">No tough call votes yet.</div>';
      return;
    }

    // Desktop: table-style rendering
    let tableHTML = `<div class="results-table-wrap"><table class="results-table">
      <thead><tr>
        <th class="col-rank">#</th>
        <th class="col-movie">Matchup</th>
        <th class="col-num">Total Votes</th>
        <th class="col-num">Breakdown</th>
      </tr></thead><tbody>`;

    top10.forEach((tc, i) => {
      const mA = tc.movieAKey.split("|")[0];
      const mB = tc.movieBKey.split("|")[0];
      const vA = tc.votesA || 0;
      const vB = tc.votesB || 0;
      const total = tc.totalVotes || 0;
      const pctA = total ? Math.round((vA / total) * 100) : 0;
      const pctB = total ? Math.round((vB / total) * 100) : 0;

      tableHTML += `<tr>
        <td class="col-rank">${i + 1}</td>
        <td class="col-movie"><span class="movie-name">${mA}</span> <span class="tc-vs-label">vs</span> <span class="movie-name">${mB}</span></td>
        <td class="col-num">${total}</td>
        <td class="col-num"><span class="${pctA > pctB ? 'win-pct-high' : pctA < pctB ? 'win-pct-low' : ''}">${mA}: ${vA}</span> / <span class="${pctB > pctA ? 'win-pct-high' : pctB < pctA ? 'win-pct-low' : ''}">${mB}: ${vB}</span></td>
      </tr>`;
    });

    tableHTML += "</tbody></table></div>";
    gridEl.innerHTML = tableHTML;

    // Mobile cards
    cardsEl.innerHTML = "";
    top10.forEach((tc, i) => {
      const mA = tc.movieAKey.split("|")[0];
      const mB = tc.movieBKey.split("|")[0];
      const vA = tc.votesA || 0;
      const vB = tc.votesB || 0;
      const total = tc.totalVotes || 0;

      const card = document.createElement("div");
      card.className = "result-card";
      card.innerHTML = `
        <div class="result-card-rank">${i + 1}</div>
        <div class="result-card-body">
          <div class="result-card-title">${mA} <span class="tc-vs-label">vs</span> ${mB}</div>
          <div class="result-card-stats">
            <span>${total} votes</span>
            <span>${mA}: ${vA}</span>
            <span>${mB}: ${vB}</span>
          </div>
        </div>
      `;
      cardsEl.appendChild(card);
    });
  } catch (err) {
    console.error("loadToughCallsTab error:", err);
    gridEl.innerHTML = '<div class="results-empty results-error">Failed to load tough calls.</div>';
    cardsEl.innerHTML = '<div class="results-empty results-error">Failed to load.</div>';
    countEl.textContent = "Error";
  }
}

// ==========================================
// MICHAEL'S RANKINGS TAB
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

async function loadMichaelsRankings() {
  const statusEl = document.getElementById("michaels-status");
  const grid = document.getElementById("michaels-grid");
  if (!grid) return;

  grid.innerHTML = '<div class="results-empty">Loading Michael\'s rankings...</div>';

  try {
    const snap = await getDocs(collection(db, "votes"));

    const votesByUser = {};
    const globalStats = {};

    snap.forEach(doc => {
      const { winner, loser, user } = doc.data();
      if (!winner || !loser) return;
      const w = normalizeKey(winner);
      const l = normalizeKey(loser);

      globalStats[w] = globalStats[w] || { wins: 0, losses: 0 };
      globalStats[l] = globalStats[l] || { wins: 0, losses: 0 };
      globalStats[w].wins++;
      globalStats[l].losses++;

      if (user) {
        votesByUser[user] = votesByUser[user] || { votes: 0, stats: {} };
        votesByUser[user].votes++;
        const s = votesByUser[user].stats;
        s[w] = s[w] || { wins: 0, losses: 0 };
        s[l] = s[l] || { wins: 0, losses: 0 };
        s[w].wins++;
        s[l].losses++;
      }
    });

    let mikeUid = null;
    let maxVotes = 0;
    for (const [uid, data] of Object.entries(votesByUser)) {
      if (data.votes > maxVotes) {
        maxVotes = data.votes;
        mikeUid = uid;
      }
    }

    if (!mikeUid) {
      statusEl.textContent = "No votes found.";
      grid.innerHTML = '<div class="results-empty">No votes found.</div>';
      return;
    }

    const globalRows = buildRankedData(globalStats);
    globalRows.sort((a, b) => b.wilsonScore - a.wilsonScore || b.n - a.n);
    const globalRankMap = {};
    globalRows.forEach((r, i) => { globalRankMap[r.key] = i + 1; });

    const mikeStats = votesByUser[mikeUid].stats;
    let mikeRows = buildRankedData(mikeStats);
    mikeRows.sort((a, b) => b.wilsonScore - a.wilsonScore || b.n - a.n || b.wins - a.wins);
    mikeRows = mikeRows.slice(0, 15);

    mikeRows.forEach(r => {
      r.globalRank = globalRankMap[r.key] || null;
    });

    statusEl.textContent = `${maxVotes.toLocaleString()} total votes by Michael`;

    // Render immediately without ratings
    mikeRows.forEach(r => { r.tmdbRating = null; });
    renderPosterGrid(grid, mikeRows, { showGlobalRank: true });

    // Fetch TMDB ratings in background and re-render
    const ratingPromises = mikeRows.map(async r => {
      r.tmdbRating = await fetchTmdbRating(r.title, r.year);
    });
    await Promise.all(ratingPromises);
    renderPosterGrid(grid, mikeRows, { showGlobalRank: true });

  } catch (err) {
    console.error("loadMichaelsRankings error:", err);
    statusEl.textContent = "Unable to load";
    grid.innerHTML = '<div class="results-empty results-error">Failed to load Michael\'s rankings.</div>';
  }
}

// ==========================================
// MATCHUP MODAL
// ==========================================

function getActiveVoteDocs() {
  const activeTab = document.querySelector(".results-tab.active");
  const tab = activeTab ? activeTab.dataset.tab : "global";
  return tab === "personal" ? personalVoteDocs : globalVoteDocs;
}

function showMatchupModal(key) {
  const votes = getActiveVoteDocs();
  const title = key.split("|")[0];
  const year = key.split("|")[1] || "";

  const matchups = votes
    .filter(v => normalizeKey(v.winner) === key || normalizeKey(v.loser) === key)
    .map(v => {
      const won = normalizeKey(v.winner) === key;
      const opponentKey = normalizeKey(won ? v.loser : v.winner);
      const opponentTitle = opponentKey.split("|")[0];
      const ts = v.timestamp ? (v.timestamp.toDate ? v.timestamp.toDate() : new Date(v.timestamp)) : null;
      return { won, opponentKey, opponentTitle, ts };
    })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const wins = matchups.filter(m => m.won).length;
  const losses = matchups.length - wins;
  const winPct = matchups.length ? ((wins / matchups.length) * 100).toFixed(1) : "0.0";

  let streak = 0;
  for (const m of matchups) {
    if (m.won) streak++;
    else break;
  }

  const oppCounts = {};
  matchups.forEach(m => {
    oppCounts[m.opponentTitle] = (oppCounts[m.opponentTitle] || 0) + 1;
  });
  const rival = Object.entries(oppCounts).sort((a, b) => b[1] - a[1])[0];

  document.getElementById("matchup-modal-title").textContent = title + (year ? ` (${year})` : "");

  document.getElementById("matchup-modal-stats").innerHTML = `
    <div class="matchup-stat"><span class="matchup-stat-val">${wins}W - ${losses}L</span><span class="matchup-stat-label">Record</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${winPct}%</span><span class="matchup-stat-label">Win Rate</span></div>
    <div class="matchup-stat"><span class="matchup-stat-val">${streak}</span><span class="matchup-stat-label">Win Streak</span></div>
    ${rival ? `<div class="matchup-stat"><span class="matchup-stat-val">${rival[0]}</span><span class="matchup-stat-label">Rival (${rival[1]}x)</span></div>` : ""}
  `;

  const listEl = document.getElementById("matchup-modal-list");
  if (!matchups.length) {
    listEl.innerHTML = '<div class="results-empty">No matchups found.</div>';
  } else {
    listEl.innerHTML = matchups.map(m => {
      const dateStr = m.ts ? m.ts.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Unknown";
      return `<div class="matchup-row ${m.won ? "matchup-row--win" : "matchup-row--loss"}">
        <span class="matchup-row-result">${m.won ? "W" : "L"}</span>
        <span class="matchup-row-opponent">${m.opponentTitle}</span>
        <span class="matchup-row-date">${dateStr}</span>
      </div>`;
    }).join("");
  }

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
      document.getElementById("personal-grid").innerHTML = '<div class="results-empty">Log in to see your personal rankings.</div>';
      document.getElementById("personal-count").textContent = "Log in to view";
    }
    await loadGlobalStats();
    await loadToughCallsTab();
    await loadMichaelsRankings();
  });
});
