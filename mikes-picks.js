import {
  db,
  collection,
  getDocs
} from "./firebase.js";

// ==========================================
// WILSON SCORE (same as list.js)
// ==========================================

const Z = 1.96; // 95% confidence

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

// ==========================================
// TMDB RATINGS
// ==========================================

const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";

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
    return { key, title, year, wins, losses, n, winPct, wilsonScore: ws, displayScore: Math.round(ws * 1000) / 10 };
  });
}

// ==========================================
// RENDERING
// ==========================================

function renderTable(tbody, rows) {
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
      <td class="col-movie"><span class="movie-name">${m.title}</span>${m.year ? ` <span class="movie-yr">${m.year}</span>` : ""}</td>
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
}

function renderCards(container, rows) {
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="results-empty">No results to display.</div>';
    return;
  }
  rows.forEach((m, i) => {
    const pctClass = m.winPct >= 70 ? "win-pct-high" : m.winPct >= 50 ? "win-pct-medium" : "win-pct-low";
    const ratingDisplay = m.tmdbRating != null ? m.tmdbRating.toFixed(1) : "—";
    const globalDisplay = m.globalRank != null ? `#${m.globalRank}` : "—";
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
          <span>Global: ${globalDisplay}</span>
          <span>Rating: ${ratingDisplay}</span>
        </div>
      </div>
      <div class="result-card-score" title="Adjusted score">${m.n === 0 ? "—" : m.displayScore.toFixed(1)}</div>
    `;
    container.appendChild(card);
  });
}

// ==========================================
// MAIN LOGIC
// ==========================================

async function loadMikesPicks() {
  const statusEl = document.getElementById("picks-status");
  const tbody = document.getElementById("picks-list");
  const cards = document.getElementById("picks-cards");
  tbody.innerHTML = '<tr><td colspan="9" class="results-empty">Loading Mike\'s picks...</td></tr>';
  cards.innerHTML = '<div class="results-empty">Loading...</div>';

  try {
    const snap = await getDocs(collection(db, "votes"));

    // Group votes by user to find Mike (most active voter)
    const votesByUser = {};
    const globalStats = {};

    snap.forEach(doc => {
      const { winner, loser, user } = doc.data();
      if (!winner || !loser) return;

      // Build global stats
      globalStats[winner] = globalStats[winner] || { wins: 0, losses: 0 };
      globalStats[loser] = globalStats[loser] || { wins: 0, losses: 0 };
      globalStats[winner].wins++;
      globalStats[loser].losses++;

      // Group by user
      if (user) {
        votesByUser[user] = votesByUser[user] || { votes: 0, stats: {} };
        votesByUser[user].votes++;
        const s = votesByUser[user].stats;
        s[winner] = s[winner] || { wins: 0, losses: 0 };
        s[loser] = s[loser] || { wins: 0, losses: 0 };
        s[winner].wins++;
        s[loser].losses++;
      }
    });

    // Find Mike — the user with the most votes
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
      tbody.innerHTML = '<tr><td colspan="9" class="results-empty">No votes found.</td></tr>';
      cards.innerHTML = '<div class="results-empty">No votes found.</div>';
      return;
    }

    // Build global rankings
    const globalRows = buildRankedData(globalStats);
    globalRows.sort((a, b) => b.wilsonScore - a.wilsonScore || b.n - a.n);
    const globalRankMap = {};
    globalRows.forEach((r, i) => { globalRankMap[r.key] = i + 1; });

    // Build Mike's rankings
    const mikeStats = votesByUser[mikeUid].stats;
    let mikeRows = buildRankedData(mikeStats);
    mikeRows.sort((a, b) => b.wilsonScore - a.wilsonScore || b.n - a.n || b.wins - a.wins);
    mikeRows = mikeRows.slice(0, 15);

    // Add global rank
    mikeRows.forEach(r => {
      r.globalRank = globalRankMap[r.key] || null;
    });

    statusEl.textContent = `${maxVotes.toLocaleString()} total votes by Mike`;

    // Render immediately without ratings
    mikeRows.forEach(r => { r.tmdbRating = null; });
    renderTable(tbody, mikeRows);
    renderCards(cards, mikeRows);

    // Fetch TMDB ratings in background and re-render
    const ratingPromises = mikeRows.map(async r => {
      r.tmdbRating = await fetchTmdbRating(r.title, r.year);
    });
    await Promise.all(ratingPromises);
    renderTable(tbody, mikeRows);
    renderCards(cards, mikeRows);

  } catch (err) {
    console.error("loadMikesPicks error:", err);
    statusEl.textContent = "Unable to load";
    tbody.innerHTML = '<tr><td colspan="9" class="results-empty results-error">Failed to load Mike\'s picks.</td></tr>';
    cards.innerHTML = '<div class="results-empty results-error">Failed to load.</div>';
  }
}

// ==========================================
// INIT
// ==========================================

window.addEventListener("load", loadMikesPicks);
