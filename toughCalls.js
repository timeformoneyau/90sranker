// toughCalls.js — Face / Off community voting page
import {
  db,
  auth,
  onAuth,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  increment,
  writeBatch
} from "./firebase.js";

// ==========================================
// CONSTANTS
// ==========================================

const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const PAGE_SIZE = 10;

// ==========================================
// STATE
// ==========================================

let currentUid = null;
let faceoffs = [];          // 10 most recent faceoffs
let userVotes = {};         // { faceoffId: "A" | "B" }
const posterCache = {};

// ==========================================
// TMDB
// ==========================================

async function fetchPosterUrl(title, year) {
  const cacheKey = `${title}|${year}`;
  if (posterCache[cacheKey]) return posterCache[cacheKey];

  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const posterPath = data.results?.[0]?.poster_path;
    const result = posterPath ? TMDB_IMAGE_BASE + posterPath : "./fallback.jpg";
    posterCache[cacheKey] = result;
    return result;
  } catch {
    return "./fallback.jpg";
  }
}

// ==========================================
// LOAD FACE/OFFS
// ==========================================

async function loadUserVotes(uid, faceoffIds) {
  userVotes = {};
  if (!uid || !faceoffIds.length) return;

  // Read each deterministic vote doc: {faceoffId}__{uid}
  const reads = faceoffIds.map(id => getDoc(doc(db, "toughCallVotes", `${id}__${uid}`)));
  const snaps = await Promise.all(reads);
  snaps.forEach((snap, i) => {
    if (snap.exists()) {
      userVotes[faceoffIds[i]] = snap.data().vote || true; // true = voted but no choice stored (legacy)
    }
  });
}

async function loadFaceoffs() {
  const statusEl = document.getElementById("tc-status");
  const gridEl = document.getElementById("tc-grid");
  const emptyEl = document.getElementById("tc-empty");

  statusEl.textContent = "Loading Face / Off matchups...";
  gridEl.innerHTML = "";
  emptyEl.style.display = "none";

  try {
    // Get 10 most recent faceoffs, globally
    const q = query(
      collection(db, "toughCalls"),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE)
    );
    const snap = await getDocs(q);
    faceoffs = [];
    snap.forEach(d => faceoffs.push({ id: d.id, ...d.data() }));

    if (faceoffs.length === 0) {
      statusEl.textContent = "";
      emptyEl.style.display = "";
      return;
    }

    // Load current user's votes for these faceoffs
    if (currentUid) {
      await loadUserVotes(currentUid, faceoffs.map(f => f.id));
    }

    statusEl.textContent = "";
    await renderGrid();
  } catch (err) {
    console.error("Failed to load Face / Off matchups:", err);
    statusEl.textContent = "Failed to load matchups. Please refresh.";
  }
}

// ==========================================
// RENDERING
// ==========================================

function parseKey(key) {
  const parts = key.split("|");
  return { title: parts[0] || "Unknown", year: parts[1] || "" };
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

async function renderGrid() {
  const gridEl = document.getElementById("tc-grid");
  gridEl.innerHTML = "";

  // Build all cards in parallel for poster fetching
  const cards = await Promise.all(faceoffs.map((tc, i) => buildCard(tc, i)));
  cards.forEach(c => gridEl.appendChild(c));
}

async function buildCard(tc, index) {
  const movieA = parseKey(tc.movieAKey);
  const movieB = parseKey(tc.movieBKey);
  const isSender = currentUid && (tc.createdByUid === currentUid || (tc.flaggedBy && tc.flaggedBy[currentUid]));
  const hasVoted = !!userVotes[tc.id];
  const userChoice = typeof userVotes[tc.id] === "string" ? userVotes[tc.id] : null;
  const totalVotes = (tc.votesA || 0) + (tc.votesB || 0);

  // Show results if: sender with at least 1 vote, or non-sender who has voted
  const showResults = (isSender && totalVotes > 0) || (!isSender && hasVoted);
  // Show vote buttons if: not sender, not voted, and logged in
  const showVoteButtons = currentUid && !isSender && !hasVoted;

  const card = document.createElement("div");
  card.className = "tc-card";
  card.dataset.tcId = tc.id;

  const [posterA, posterB] = await Promise.all([
    fetchPosterUrl(movieA.title, movieA.year),
    fetchPosterUrl(movieB.title, movieB.year)
  ]);

  // Date
  let dateStr = "";
  if (tc.createdAt) {
    const d = tc.createdAt.toDate ? tc.createdAt.toDate() : new Date(tc.createdAt);
    dateStr = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // Results bar percentages
  const pctA = totalVotes > 0 ? Math.round(((tc.votesA || 0) / totalVotes) * 100) : 0;
  const pctB = totalVotes > 0 ? 100 - pctA : 0;

  // Status line
  let statusLine = "";
  if (!currentUid) {
    statusLine = `<div class="tc-card-status">Log in to vote</div>`;
  } else if (isSender && !showResults) {
    statusLine = `<div class="tc-card-status">Your submission &mdash; waiting for votes</div>`;
  } else if (isSender && showResults) {
    statusLine = `<div class="tc-card-status">Your submission</div>`;
  }

  // Build movie column HTML
  function movieCol(movie, poster, side) {
    let bottom = "";
    if (showVoteButtons) {
      bottom = `<button class="tc-card-vote" data-tc-id="${tc.id}" data-choice="${side}">Select</button>`;
    } else if (showResults) {
      const pct = side === "A" ? pctA : pctB;
      const votes = side === "A" ? (tc.votesA || 0) : (tc.votesB || 0);
      const isWinner = (side === "A" ? (tc.votesA || 0) : (tc.votesB || 0)) >= (side === "A" ? (tc.votesB || 0) : (tc.votesA || 0)) && totalVotes > 0;
      const highlight = userChoice === side ? " tc-result-yours" : "";
      bottom = `
        <div class="tc-result${highlight}">
          <div class="tc-result-bar-track">
            <div class="tc-result-bar-fill${isWinner ? " tc-result-bar-lead" : ""}" style="width:${pct}%"></div>
          </div>
          <div class="tc-result-numbers">
            <span class="tc-result-pct">${pct}%</span>
            <span class="tc-result-count">${votes} vote${votes !== 1 ? "s" : ""}</span>
          </div>
        </div>`;
    }

    return `
      <div class="tc-card-movie">
        <img src="${poster}" alt="${escapeHtml(movie.title)}" class="tc-card-poster" />
        <div class="tc-card-title">${escapeHtml(movie.title)}</div>
        <div class="tc-card-year">${movie.year}</div>
        ${bottom}
      </div>`;
  }

  const votedNote = hasVoted && userChoice
    ? `<div class="tc-card-voted-note">You voted for ${escapeHtml(userChoice === "A" ? movieA.title : movieB.title)}</div>`
    : "";

  card.innerHTML = `
    <div class="tc-card-matchup">
      ${movieCol(movieA, posterA, "A")}
      <div class="tc-card-vs">vs</div>
      ${movieCol(movieB, posterB, "B")}
    </div>
    <div class="tc-card-meta">
      <span class="tc-card-date">${dateStr}</span>
      <span class="tc-card-flag-count">${tc.flagCount > 1 ? `${tc.flagCount} users couldn't decide` : "1 user couldn't decide"}</span>
    </div>
    ${statusLine}
    ${votedNote}
  `;

  // Wire vote buttons
  card.querySelectorAll(".tc-card-vote").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      handleVote(tc.id, btn.dataset.choice, card);
    });
  });

  return card;
}

// ==========================================
// VOTING
// ==========================================

async function handleVote(tcId, choice, card) {
  if (!currentUid) return;

  const tc = faceoffs.find(f => f.id === tcId);
  if (!tc) return;

  // Prevent sender from voting (client-side guardrail)
  if (tc.createdByUid === currentUid || (tc.flaggedBy && tc.flaggedBy[currentUid])) return;

  // Prevent double-voting (client-side)
  if (userVotes[tcId]) return;

  // Disable buttons immediately
  card.querySelectorAll(".tc-card-vote").forEach(btn => btn.disabled = true);

  const winnerKey = choice === "A" ? tc.movieAKey : tc.movieBKey;
  const loserKey = choice === "A" ? tc.movieBKey : tc.movieAKey;
  const voteField = choice === "A" ? "votesA" : "votesB";

  try {
    const batch = writeBatch(db);

    // Normal vote record
    const voteRef = doc(collection(db, "votes"));
    batch.set(voteRef, {
      winner: winnerKey,
      loser: loserKey,
      user: currentUid,
      timestamp: serverTimestamp(),
      source: "tough_call",
      toughCallId: tcId
    });

    // ToughCallVotes record (deterministic ID prevents double-voting)
    const tcvId = `${tcId}__${currentUid}`;
    const tcvRef = doc(db, "toughCallVotes", tcvId);
    batch.set(tcvRef, {
      toughCallId: tcId,
      uid: currentUid,
      vote: choice,
      votedAt: serverTimestamp()
    });

    // Update aggregate on toughCalls doc
    const tcRef = doc(db, "toughCalls", tcId);
    batch.update(tcRef, {
      [voteField]: increment(1),
      totalVotes: increment(1),
      lastVotedAt: serverTimestamp()
    });

    // Global stats
    const statsRef = doc(db, "stats", "global");
    batch.set(statsRef, {
      [`stats.${winnerKey}.wins`]: increment(1),
      [`stats.${loserKey}.losses`]: increment(1)
    }, { merge: true });

    // User stats
    const userStatsRef = doc(db, "stats", `user_${currentUid}`);
    batch.set(userStatsRef, {
      [`stats.${winnerKey}.wins`]: increment(1),
      [`stats.${loserKey}.losses`]: increment(1)
    }, { merge: true });

    // Meta total
    const metaRef = doc(db, "stats", "meta");
    batch.set(metaRef, { totalVotes: increment(1) }, { merge: true });

    await batch.commit();
  } catch (err) {
    console.error("Failed to save vote:", err);
    card.querySelectorAll(".tc-card-vote").forEach(btn => btn.disabled = false);
    return;
  }

  // Update local state and re-render just this card
  userVotes[tcId] = choice;
  if (choice === "A") {
    tc.votesA = (tc.votesA || 0) + 1;
  } else {
    tc.votesB = (tc.votesB || 0) + 1;
  }
  tc.totalVotes = (tc.totalVotes || 0) + 1;

  const idx = faceoffs.findIndex(f => f.id === tcId);
  if (idx !== -1) {
    const newCard = await buildCard(tc, idx);
    newCard.classList.add("tc-card-enter");
    card.replaceWith(newCard);
    setTimeout(() => newCard.classList.remove("tc-card-enter"), 450);
  }
}

// ==========================================
// INIT
// ==========================================

window.addEventListener("load", () => {
  onAuth(async (user) => {
    currentUid = user ? user.uid : null;
    await loadFaceoffs();
  });
});
