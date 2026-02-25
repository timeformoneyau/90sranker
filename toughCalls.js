// toughCalls.js — The Crowd community voting page
import {
  db,
  auth,
  onAuth,
  callFunction,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit
} from "./firebase.js";

// ==========================================
// CONSTANTS
// ==========================================

const PAGE_SIZE = 10;

// ==========================================
// STATE
// ==========================================

let currentUid = null;
let faceoffs = [];     // 10 most recent faceoffs
let userVotes = {};    // { faceoffId: "A" | "B" }
const posterCache = {};
const userCache = {};  // { uid: username | null }

const tmdbProxy           = callFunction("tmdbProxy");
const recordToughCallVote = callFunction("recordToughCallVote");

// ==========================================
// TMDB (via server-side proxy)
// ==========================================

async function fetchPosterUrl(title, year) {
  const cacheKey = `${title}|${year}`;
  if (posterCache[cacheKey]) return posterCache[cacheKey];
  try {
    const result = await tmdbProxy({ title, year, mode: "search" });
    const url = result.data?.posterUrl || "./fallback.jpg";
    posterCache[cacheKey] = url;
    return url;
  } catch {
    return "./fallback.jpg";
  }
}

// ==========================================
// USERNAME LOOKUP
// ==========================================

async function fetchUsernames(uids) {
  const toFetch = uids.filter(uid => uid && !(uid in userCache));
  if (!toFetch.length) return;
  const snaps = await Promise.all(toFetch.map(uid => getDoc(doc(db, "users", uid))));
  snaps.forEach((snap, i) => {
    userCache[toFetch[i]] = snap.exists() ? (snap.data().username || null) : null;
  });
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

  statusEl.textContent = "Loading matchups...";
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

    // Prefetch usernames for all card creators
    const creatorUids = [...new Set(faceoffs.map(f => f.createdByUid).filter(Boolean))];
    await fetchUsernames(creatorUids);

    // Load current user's votes for these faceoffs
    if (currentUid) {
      await loadUserVotes(currentUid, faceoffs.map(f => f.id));
    }

    statusEl.textContent = "";
    await renderGrid();
  } catch (err) {
    console.error("Failed to load The Crowd matchups:", err);
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

  // Compact meta: date · couldn't-decide count · nominated by @username
  const undecidedCount = tc.flagCount || 1;
  const nominatorUsername = tc.createdByUid ? userCache[tc.createdByUid] : null;
  const nominatorText = nominatorUsername ? ` · nominated by @${escapeHtml(nominatorUsername)}` : "";
  const metaInfo = dateStr
    ? `${dateStr} · ${undecidedCount} couldn't decide${nominatorText}`
    : `${undecidedCount} couldn't decide${nominatorText}`;

  // Status badge — lives in the meta bar instead of floating below the card
  let metaBadge = "";
  if (!currentUid) {
    metaBadge = `<span class="tc-meta-badge tc-meta-badge--neutral">Log in to vote</span>`;
  } else if (isSender && !showResults) {
    metaBadge = `<span class="tc-meta-badge tc-meta-badge--waiting">Waiting for votes</span>`;
  } else if (isSender) {
    metaBadge = `<span class="tc-meta-badge tc-meta-badge--yours">Your submission</span>`;
  } else if (hasVoted && userChoice) {
    metaBadge = `<span class="tc-meta-badge tc-meta-badge--voted">Picked: ${escapeHtml(userChoice === "A" ? movieA.title : movieB.title)}</span>`;
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

  card.innerHTML = `
    <div class="tc-card-matchup">
      ${movieCol(movieA, posterA, "A")}
      <div class="tc-card-vs">VS</div>
      ${movieCol(movieB, posterB, "B")}
    </div>
    <div class="tc-card-meta">
      <span class="tc-card-meta-info">${metaInfo}</span>
      ${metaBadge}
    </div>
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

  // Client-side guardrails (also enforced server-side in the Cloud Function)
  if (tc.createdByUid === currentUid || (tc.flaggedBy && tc.flaggedBy[currentUid])) return;
  if (userVotes[tcId]) return;

  card.querySelectorAll(".tc-card-vote").forEach(btn => btn.disabled = true);

  try {
    const result = await recordToughCallVote({ tcId, choice });
    const { votesA, votesB, totalVotes } = result.data;
    userVotes[tcId] = choice;
    tc.votesA      = votesA;
    tc.votesB      = votesB;
    tc.totalVotes  = totalVotes;
  } catch (err) {
    console.error("Failed to save vote:", err);
    card.querySelectorAll(".tc-card-vote").forEach(btn => btn.disabled = false);
    return;
  }

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
