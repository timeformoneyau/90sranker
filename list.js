import {
  db,
  onAuth,
  collection,
  query,
  where,
  limit,
  getDocs
} from "./firebase.js";

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

function confidenceLabel(level) {
  if (level === "low") return "Low";
  if (level === "med") return "Med";
  return "High";
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
// RENDERING
// ==========================================

function renderTable(tbody, rows) {
  tbody.innerHTML = "";
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="results-empty">No results to display.</td></tr>';
    return;
  }
  rows.forEach((m, i) => {
    const tr = document.createElement("tr");
    const pctClass = m.winPct >= 70 ? "win-pct-high" : m.winPct >= 50 ? "win-pct-medium" : "win-pct-low";
    tr.innerHTML = `
      <td class="col-rank">${i + 1}</td>
      <td class="col-movie"><span class="movie-name">${m.title}</span>${m.year ? ` <span class="movie-yr">${m.year}</span>` : ""}</td>
      <td class="col-num">${m.n}</td>
      <td class="col-num">${m.wins}</td>
      <td class="col-num">${m.losses}</td>
      <td class="col-num ${pctClass}">${m.winPct.toFixed(1)}%</td>
      <td class="col-num col-score">${m.n === 0 ? "—" : m.displayScore.toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderCards(container, rows) {
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="results-empty">No results to display.</div>';
    return;
  }
  rows.forEach((m, i) => {
    const pctClass = m.winPct >= 70 ? "win-pct-high" : m.winPct >= 50 ? "win-pct-medium" : "win-pct-low";
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-card-rank">${i + 1}</div>
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
  if (showVal !== "all") sorted = sorted.slice(0, parseInt(showVal));

  renderTable(document.getElementById("global-list"), sorted);
  renderCards(document.getElementById("global-cards"), sorted);
}

document.getElementById("global-sort").addEventListener("change", applyGlobalFilters);
document.getElementById("global-show").addEventListener("change", applyGlobalFilters);
document.getElementById("global-search").addEventListener("input", applyGlobalFilters);
document.getElementById("global-hide-low").addEventListener("change", applyGlobalFilters);

async function loadGlobalStats() {
  const countEl = document.getElementById("global-count");
  const tbody = document.getElementById("global-list");
  const cards = document.getElementById("global-cards");
  tbody.innerHTML = '<tr><td colspan="7" class="results-empty">Loading global rankings...</td></tr>';
  cards.innerHTML = '<div class="results-empty">Loading...</div>';

  try {
    const snap = await getDocs(collection(db, "votes"));
    countEl.textContent = `${snap.size.toLocaleString()} total votes across all users`;

    const stats = {};
    snap.forEach(doc => {
      const { winner, loser } = doc.data();
      if (!winner || !loser) return;
      stats[winner] = stats[winner] || { wins: 0, losses: 0 };
      stats[loser] = stats[loser] || { wins: 0, losses: 0 };
      stats[winner].wins++;
      stats[loser].losses++;
    });

    // Debug: check specific movie stats
    const debugKey = "Armageddon|1998";
    if (stats[debugKey]) {
      console.log(`[DEBUG] ${debugKey}:`, JSON.stringify(stats[debugKey]), `from ${snap.size} total vote docs`);
    }

    globalAllRows = buildRankedData(stats);
    applyGlobalFilters();
  } catch (err) {
    console.error("loadGlobalStats error:", err);
    tbody.innerHTML = '<tr><td colspan="7" class="results-empty results-error">Failed to load global rankings.</td></tr>';
    cards.innerHTML = '<div class="results-empty results-error">Failed to load global rankings.</div>';
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
  if (showVal !== "all") sorted = sorted.slice(0, parseInt(showVal));

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
    const snap = await getDocs(query(
      collection(db, "votes"),
      where("user", "==", uid)
    ));
    countEl.textContent = `${snap.size.toLocaleString()} votes`;

    const stats = {};
    snap.forEach(doc => {
      const { winner, loser } = doc.data();
      if (!winner || !loser) return;
      stats[winner] = stats[winner] || { wins: 0, losses: 0 };
      stats[loser] = stats[loser] || { wins: 0, losses: 0 };
      stats[winner].wins++;
      stats[loser].losses++;
    });

    personalAllRows = buildRankedData(stats);
    applyPersonalFilters();
  } catch (err) {
    console.error("loadPersonalStats error:", err);
    tbody.innerHTML = '<tr><td colspan="7" class="results-empty results-error">Failed to load personal rankings.</td></tr>';
    cards.innerHTML = '<div class="results-empty results-error">Failed to load.</div>';
    countEl.textContent = "Error";
  }
}

// ==========================================
// WIRING: RECENT VOTES
// ==========================================

function formatDate(timestamp) {
  if (!timestamp) return "Unknown";
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return "Unknown"; }
}

async function loadRecentVotes(uid) {
  const tbody = document.getElementById("recent-votes");
  const cards = document.getElementById("recent-cards");
  tbody.innerHTML = '<tr><td colspan="3" class="results-empty">Loading recent votes...</td></tr>';
  cards.innerHTML = '<div class="results-empty">Loading...</div>';

  try {
    const snap = await getDocs(query(
      collection(db, "votes"),
      where("user", "==", uid),
      limit(50)
    ));

    let votes = [];
    snap.forEach(doc => {
      const data = doc.data();
      if (data.winner && data.loser) votes.push(data);
    });

    votes.sort((a, b) => {
      const tA = a.timestamp ? (a.timestamp.toDate ? a.timestamp.toDate() : new Date(a.timestamp)) : new Date(0);
      const tB = b.timestamp ? (b.timestamp.toDate ? b.timestamp.toDate() : new Date(b.timestamp)) : new Date(0);
      return tB - tA;
    });
    votes = votes.slice(0, 10);

    tbody.innerHTML = "";
    cards.innerHTML = "";
    if (!votes.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="results-empty">No votes found. Start voting!</td></tr>';
      cards.innerHTML = '<div class="results-empty">No votes found.</div>';
      return;
    }

    votes.forEach(({ winner, loser, timestamp }) => {
      const w = typeof winner === "string" ? winner.split("|")[0] : winner.title || "Unknown";
      const l = typeof loser === "string" ? loser.split("|")[0] : loser.title || "Unknown";
      const d = formatDate(timestamp);

      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${d}</td><td>${w}</td><td>${l}</td>`;
      tbody.appendChild(tr);

      const card = document.createElement("div");
      card.className = "result-card result-card--recent";
      card.innerHTML = `
        <div class="result-card-body">
          <div class="result-card-title">${w} <span class="movie-yr">beat</span> ${l}</div>
          <div class="result-card-stats"><span>${d}</span></div>
        </div>
      `;
      cards.appendChild(card);
    });
  } catch (err) {
    console.error("loadRecentVotes error:", err);
    tbody.innerHTML = '<tr><td colspan="3" class="results-empty results-error">Unable to load recent votes.</td></tr>';
    cards.innerHTML = '<div class="results-empty results-error">Unable to load.</div>';
  }
}

// ==========================================
// INIT
// ==========================================

window.addEventListener("load", () => {
  onAuth(async user => {
    if (user) {
      await loadPersonalStats(user.uid);
      await loadRecentVotes(user.uid);
    } else {
      document.getElementById("personal-list").innerHTML = '<tr><td colspan="7" class="results-empty">Log in to see your personal rankings.</td></tr>';
      document.getElementById("personal-cards").innerHTML = '<div class="results-empty">Log in to see your rankings.</div>';
      document.getElementById("personal-count").textContent = "Log in to view";
      document.getElementById("recent-votes").innerHTML = '<tr><td colspan="3" class="results-empty">Log in to see your recent votes.</td></tr>';
      document.getElementById("recent-cards").innerHTML = '<div class="results-empty">Log in to see votes.</div>';
    }
    await loadGlobalStats();
  });
});
