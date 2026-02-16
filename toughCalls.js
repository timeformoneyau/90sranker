// toughCalls.js — Tough Calls voting page
import {
  db,
  auth,
  onAuth,
  collection,
  doc,
  getDocs,
  query,
  where,
  serverTimestamp,
  increment,
  writeBatch
} from "./firebase.js";

// ==========================================
// CONSTANTS
// ==========================================

const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const VISIBLE_COUNT = 10;

// ==========================================
// STATE
// ==========================================

let currentUid = null;
let allToughCalls = [];       // all fetched tough call docs (filtered for this user)
let displayedItems = [];      // currently visible on screen (up to 10)
let overflowQueue = [];       // extras waiting to fill in
let votedTcIds = new Set();   // tough call IDs this user has already voted on
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
// LOAD TOUGH CALLS
// ==========================================

async function loadVotedToughCalls(uid) {
  try {
    const snap = await getDocs(query(
      collection(db, "toughCallVotes"),
      where("uid", "==", uid)
    ));
    snap.forEach(d => votedTcIds.add(d.data().toughCallId));
  } catch (err) {
    console.error("Failed to load voted tough calls:", err);
  }
}

async function loadToughCalls() {
  const statusEl = document.getElementById("tc-status");
  const gridEl = document.getElementById("tc-grid");
  const emptyEl = document.getElementById("tc-empty");

  if (!currentUid) {
    statusEl.textContent = "";
    gridEl.innerHTML = '<div class="tc-login-prompt">Log in to vote on Face / Off matchups.</div>';
    return;
  }

  statusEl.textContent = "Loading Face / Off matchups...";

  try {
    // Load user's previously voted tough calls
    await loadVotedToughCalls(currentUid);

    // Fetch all tough calls
    const snap = await getDocs(collection(db, "toughCalls"));
    const candidates = [];

    snap.forEach(d => {
      const data = d.data();
      const tcId = d.id;

      // Exclude: created by this user
      if (data.createdByUid === currentUid) return;
      // Exclude: already voted on
      if (votedTcIds.has(tcId)) return;

      candidates.push({ id: tcId, ...data });
    });

    // Shuffle for variety
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    allToughCalls = candidates;
    displayedItems = candidates.slice(0, VISIBLE_COUNT);
    overflowQueue = candidates.slice(VISIBLE_COUNT);

    statusEl.textContent = "";

    if (displayedItems.length === 0) {
      emptyEl.style.display = "";
      return;
    }

    renderGrid();
  } catch (err) {
    console.error("Failed to load Face / Off matchups:", err);
    statusEl.textContent = "Failed to load Face / Off matchups. Please refresh.";
  }
}

// ==========================================
// RENDERING
// ==========================================

function parseKey(key) {
  const parts = key.split("|");
  return { title: parts[0] || "Unknown", year: parts[1] || "" };
}

async function renderGrid() {
  const gridEl = document.getElementById("tc-grid");
  gridEl.innerHTML = "";

  for (let i = 0; i < displayedItems.length; i++) {
    const tc = displayedItems[i];
    const card = await buildCard(tc, i);
    gridEl.appendChild(card);
  }
}

async function buildCard(tc, index) {
  const movieA = parseKey(tc.movieAKey);
  const movieB = parseKey(tc.movieBKey);

  const card = document.createElement("div");
  card.className = "tc-card";
  card.dataset.index = index;

  // Fetch posters in parallel
  const [posterA, posterB] = await Promise.all([
    fetchPosterUrl(movieA.title, movieA.year),
    fetchPosterUrl(movieB.title, movieB.year)
  ]);

  card.innerHTML = `
    <div class="tc-card-matchup">
      <div class="tc-card-movie">
        <img src="${posterA}" alt="${movieA.title}" class="tc-card-poster" />
        <div class="tc-card-title">${movieA.title}</div>
        <div class="tc-card-year">${movieA.year}</div>
        <button class="tc-card-vote" data-index="${index}" data-choice="A">Pick</button>
      </div>
      <div class="tc-card-vs">vs</div>
      <div class="tc-card-movie">
        <img src="${posterB}" alt="${movieB.title}" class="tc-card-poster" />
        <div class="tc-card-title">${movieB.title}</div>
        <div class="tc-card-year">${movieB.year}</div>
        <button class="tc-card-vote" data-index="${index}" data-choice="B">Pick</button>
      </div>
    </div>
    <div class="tc-card-flag-count">${tc.flagCount > 1 ? `Flagged by ${tc.flagCount} users` : "Flagged by 1 user"}</div>
  `;

  // Wire vote buttons
  card.querySelectorAll(".tc-card-vote").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      const choice = btn.dataset.choice;
      handleToughCallVote(idx, choice);
    });
  });

  return card;
}

// ==========================================
// VOTING
// ==========================================

async function handleToughCallVote(index, choice) {
  const tc = displayedItems[index];
  if (!tc || !currentUid) return;

  // Disable buttons on this card to prevent double-clicks
  const gridEl = document.getElementById("tc-grid");
  const card = gridEl.children[index];
  if (!card) return;
  card.querySelectorAll(".tc-card-vote").forEach(btn => btn.disabled = true);

  const winnerKey = choice === "A" ? tc.movieAKey : tc.movieBKey;
  const loserKey = choice === "A" ? tc.movieBKey : tc.movieAKey;
  const voteField = choice === "A" ? "votesA" : "votesB";

  // 1. Write normal vote (with source="tough_call")
  // 2. Write toughCallVotes record
  // 3. Update aggregate counts on toughCalls doc
  try {
    const batch = writeBatch(db);

    // Normal vote
    const voteRef = doc(collection(db, "votes"));
    batch.set(voteRef, {
      winner: winnerKey,
      loser: loserKey,
      user: currentUid,
      timestamp: serverTimestamp(),
      source: "tough_call",
      toughCallId: tc.id
    });

    // ToughCallVotes record (user-specific, prevents re-showing)
    const tcvId = `${tc.id}__${currentUid}`;
    const tcvRef = doc(db, "toughCallVotes", tcvId);
    batch.set(tcvRef, {
      toughCallId: tc.id,
      uid: currentUid,
      votedAt: serverTimestamp()
    });

    // Update aggregate stats on the toughCalls doc
    const tcRef = doc(db, "toughCalls", tc.id);
    batch.update(tcRef, {
      [voteField]: increment(1),
      totalVotes: increment(1),
      lastVotedAt: serverTimestamp()
    });

    // Update global stats (same as normal vote)
    const statsRef = doc(db, "stats", "global");
    batch.set(statsRef, {
      [`stats.${winnerKey}.wins`]: increment(1),
      [`stats.${loserKey}.losses`]: increment(1)
    }, { merge: true });

    // Update user stats (so tough call votes appear in "Your Rankings")
    const userStatsRef = doc(db, "stats", `user_${currentUid}`);
    batch.set(userStatsRef, {
      [`stats.${winnerKey}.wins`]: increment(1),
      [`stats.${loserKey}.losses`]: increment(1)
    }, { merge: true });

    // Update meta (total vote count)
    const metaRef = doc(db, "stats", "meta");
    batch.set(metaRef, { totalVotes: increment(1) }, { merge: true });

    await batch.commit();
  } catch (err) {
    console.error("Failed to save tough call vote:", err);
    // Re-enable buttons on failure
    card.querySelectorAll(".tc-card-vote").forEach(btn => btn.disabled = false);
    return;
  }

  // Mark as voted locally
  votedTcIds.add(tc.id);

  // Animate card out
  card.classList.add("tc-card-exit");

  // After animation, remove and replace
  setTimeout(async () => {
    // Get replacement from overflow
    const replacement = overflowQueue.shift() || null;

    if (replacement) {
      // Update displayedItems
      displayedItems[index] = replacement;

      // Build new card
      const newCard = await buildCard(replacement, index);
      newCard.classList.add("tc-card-enter");

      // Replace in DOM
      if (gridEl.children[index]) {
        gridEl.replaceChild(newCard, gridEl.children[index]);
      }

      // Remove enter class after animation
      setTimeout(() => newCard.classList.remove("tc-card-enter"), 450);
    } else {
      // No replacement — remove card
      displayedItems.splice(index, 1);
      card.remove();

      // Re-index remaining cards
      reindexCards();

      // Show empty message if none left
      if (displayedItems.length === 0) {
        document.getElementById("tc-empty").style.display = "";
      }
    }
  }, 400);
}

function reindexCards() {
  const gridEl = document.getElementById("tc-grid");
  Array.from(gridEl.children).forEach((card, i) => {
    card.dataset.index = i;
    card.querySelectorAll(".tc-card-vote").forEach(btn => {
      btn.dataset.index = i;
      // Re-wire event listener
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);
      newBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleToughCallVote(i, newBtn.dataset.choice);
      });
    });
  });
}

// ==========================================
// INIT
// ==========================================

window.addEventListener("load", () => {
  onAuth(async (user) => {
    if (user) {
      currentUid = user.uid;
    } else {
      currentUid = null;
    }
    await loadToughCalls();
  });
});
