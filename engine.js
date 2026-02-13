// engine.js — Recommendation Engine
// Rule-based, explainable, no ML. Feels like a video store clerk who knows your taste.
//
// Phase 1: Build a preference vector from the user's vote history (genre, decade, tone, vibes, category)
// Phase 2: Score candidate movies against that vector, excluding already-voted and "haven't seen"
// Phase 3: Lightweight collaborative filtering — find similar voters, boost their favorites
// Fallback: If sparse data (<10 votes), show popular titles with a nudge to vote more.

import {
  db,
  auth,
  onAuth,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  arrayUnion,
  arrayRemove,
  query,
  where
} from "./firebase.js";

import { makeMovieKey } from "./movieKeys.js";

// ==========================================
// CONSTANTS
// ==========================================

const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w300";

const ATTR_WEIGHTS = {
  genre: 1.0,
  vibe: 0.8,
  tone: 0.75,
  decade: 0.5,
  category: 0.5
};

const MIN_VOTES_FOR_PERSONALIZATION = 10;
const DISPLAY_COUNT = 10;

// ==========================================
// STATE
// ==========================================

// Cache the full engine output so we can pull replacements without re-fetching
let cache = { uid: null, results: null };

// The full ranked overflow list (everything beyond the visible 10)
let overflowQueue = [];

// The currently displayed 10 items
let displayedItems = [];

// Set of movie keys the user has marked "seen" this session (avoids re-showing before cache clears)
let sessionSeenKeys = new Set();

// Current user id
let currentUid = null;

// Set of movie keys the user marked "haven't seen" — used for badge display + removal
let unseenMovieKeys = new Set();

// Set of movie keys the user marked "not interested" — permanently hidden from recommendations
let notInterestedKeys = new Set();

// ==========================================
// UTILITY
// ==========================================

function getMovieKey(movie) {
  return makeMovieKey(movie.title, movie.year);
}

function keyToTitle(key) {
  return key.split("|")[0];
}

function getDecade(year) {
  const y = parseInt(year);
  if (y >= 1990 && y <= 1994) return "1990\u20131994";
  if (y >= 1995 && y <= 1999) return "1995\u20131999";
  return null;
}

function getMovieAttributes(movie) {
  const attrs = {};
  if (movie.genre) attrs[`genre:${movie.genre}`] = ATTR_WEIGHTS.genre;
  if (movie.tone) attrs[`tone:${movie.tone}`] = ATTR_WEIGHTS.tone;
  if (movie.category) attrs[`category:${movie.category}`] = ATTR_WEIGHTS.category;
  const decade = getDecade(movie.year);
  if (decade) attrs[`decade:${decade}`] = ATTR_WEIGHTS.decade;
  if (movie.vibes) {
    movie.vibes.split(",").map(v => v.trim().toLowerCase()).filter(Boolean).forEach(v => {
      attrs[`vibe:${v}`] = ATTR_WEIGHTS.vibe;
    });
  }
  return attrs;
}

async function fetchPosterUrl(title, year) {
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

// ==========================================
// PHASE 1 — PERSONAL PREFERENCE SCORING
// ==========================================

function buildPreferenceVector(userVotes, movieMap) {
  const prefs = {};
  const votedKeys = new Set();

  for (const vote of userVotes) {
    votedKeys.add(vote.winner);
    votedKeys.add(vote.loser);

    const winnerMovie = movieMap[vote.winner];
    const loserMovie = movieMap[vote.loser];
    if (!winnerMovie || !loserMovie) continue;

    const winnerAttrs = getMovieAttributes(winnerMovie);
    const loserAttrs = getMovieAttributes(loserMovie);
    const allKeys = new Set([...Object.keys(winnerAttrs), ...Object.keys(loserAttrs)]);

    for (const key of allKeys) {
      const winVal = key in winnerAttrs ? 1 : 0;
      const loseVal = key in loserAttrs ? 1 : 0;
      const weight = winnerAttrs[key] || loserAttrs[key] || 1;
      prefs[key] = (prefs[key] || 0) + weight * (winVal - loseVal);
    }
  }

  return { prefs, votedKeys };
}

// ==========================================
// PHASE 2 — CANDIDATE SCORING
// ==========================================

function scoreCandidates(candidates, prefs) {
  return candidates.map(movie => {
    const attrs = getMovieAttributes(movie);
    const attrKeys = Object.keys(attrs);
    if (attrKeys.length === 0) return { movie, score: 0, contributions: [] };

    let score = 0;
    const contributions = [];

    for (const key of attrKeys) {
      const prefScore = prefs[key] || 0;
      const contribution = prefScore * attrs[key];
      score += contribution;
      if (Math.abs(prefScore) > 0) {
        contributions.push({ key, value: contribution });
      }
    }

    score /= Math.sqrt(attrKeys.length);
    contributions.sort((a, b) => b.value - a.value);

    return { movie, score, contributions: contributions.slice(0, 3), communityBoost: 0, similarMovies: [] };
  });
}

// ==========================================
// PHASE 3 — COMMUNITY BOOST
// ==========================================

function applyCommunityBoost(scored, currentUserWinners, votesByUser, currentUid) {
  const userWinnerSets = {};
  for (const [uid, votes] of Object.entries(votesByUser)) {
    if (uid === currentUid) continue;
    userWinnerSets[uid] = new Set(votes.map(v => v.winner));
  }

  const similarities = [];
  for (const [uid, winners] of Object.entries(userWinnerSets)) {
    let intersection = 0;
    for (const w of currentUserWinners) {
      if (winners.has(w)) intersection++;
    }
    if (intersection === 0) continue;
    const union = currentUserWinners.size + winners.size - intersection;
    const sim = intersection / union;
    if (sim > 0.05) {
      const shared = [...currentUserWinners].filter(w => winners.has(w));
      similarities.push({ uid, sim, winners, shared });
    }
  }

  similarities.sort((a, b) => b.sim - a.sim);
  const topSimilar = similarities.slice(0, 5);

  if (topSimilar.length === 0) return scored;

  const boostMap = {};
  for (const { sim, winners, shared } of topSimilar) {
    for (const key of winners) {
      if (!currentUserWinners.has(key)) {
        if (!boostMap[key]) boostMap[key] = { boost: 0, sharedMovies: new Set() };
        boostMap[key].boost += sim;
        shared.slice(0, 2).forEach(s => boostMap[key].sharedMovies.add(s));
      }
    }
  }

  for (const item of scored) {
    const key = getMovieKey(item.movie);
    const entry = boostMap[key];
    if (entry && entry.boost > 0) {
      item.communityBoost = entry.boost;
      item.score += entry.boost * 2;
      item.similarMovies = [...entry.sharedMovies].slice(0, 2).map(keyToTitle);
    }
  }

  return scored;
}

// ==========================================
// REASON GENERATION
// ==========================================

function generateReason(item) {
  if (item.communityBoost > 0.3 && item.similarMovies.length > 0) {
    const movieNames = item.similarMovies.join(" and ");
    return `Popular with voters who also liked ${movieNames}`;
  }

  const top = (item.contributions || [])[0];
  if (!top || top.value <= 0) return "A 90s classic worth checking out";

  const [type, value] = top.key.split(":");
  switch (type) {
    case "genre":    return `Because you tend to prefer ${value.toLowerCase()} films`;
    case "decade":   return `Matches your taste for ${value} era movies`;
    case "tone":     return `Fits your preference for ${value} movies`;
    case "category": return value === "cult"
                       ? "Right up your alley \u2014 a cult favorite"
                       : "A crowd-pleasing pick based on your votes";
    case "vibe":     return `Matches the ${value} vibe you gravitate toward`;
    default:         return "Based on your voting history";
  }
}

// ==========================================
// MAIN — getRecommendationsForUser
// ==========================================

async function getRecommendationsForUser(userId) {
  if (cache.uid === userId && cache.results) return cache.results;

  const moviesRes = await fetch("movie_list_cleaned.json");
  const allMovies = await moviesRes.json();
  const movies = allMovies.filter(m => m.title && m.year && !/^title$/i.test(m.title.trim()));
  const movieMap = {};
  for (const m of movies) movieMap[getMovieKey(m)] = m;

  // Load user's "haven't seen" list, "seen it" list, and inferred-seen list
  let unseenKeys = new Set();
  let seenKeys = new Set();
  let inferredSeenKeys = new Set();
  try {
    const userSnap = await getDoc(doc(db, "users", userId));
    if (userSnap.exists()) {
      const data = userSnap.data();
      (data.seen || []).forEach(k => unseenKeys.add(k));
      (data.seenMovies || []).forEach(k => seenKeys.add(k));
      (data.inferredSeen || []).forEach(k => inferredSeenKeys.add(k));
      (data.notInterested || []).forEach(k => notInterestedKeys.add(k));
    }
  } catch (err) {
    console.warn("Could not load user data:", err);
  }

  // Merge session-seen keys
  seenKeys.forEach(k => sessionSeenKeys.add(k));

  // Store unseen keys at module level so cards can show badges
  unseenMovieKeys = unseenKeys;

  const votesSnap = await getDocs(collection(db, "votes"));
  const votesByUser = {};
  const allVotes = [];

  votesSnap.forEach(d => {
    const data = d.data();
    if (!data.winner || !data.loser) return;
    allVotes.push(data);
    if (data.user) {
      if (!votesByUser[data.user]) votesByUser[data.user] = [];
      votesByUser[data.user].push(data);
    }
  });

  const userVotes = votesByUser[userId] || [];
  const isSparse = userVotes.length < MIN_VOTES_FOR_PERSONALIZATION;
  const { prefs, votedKeys } = buildPreferenceVector(userVotes, movieMap);

  // Apply mild negative signal from notInterested movies
  for (const niKey of notInterestedKeys) {
    const niMovie = movieMap[niKey];
    if (niMovie?.genre) {
      const genreKey = `genre:${niMovie.genre}`;
      prefs[genreKey] = (prefs[genreKey] || 0) - 0.3;
    }
  }

  // Exclude: voted + seen-it + inferred-seen (but NOT haven't-seen — those get a badge instead)
  const candidates = movies.filter(m => {
    const key = getMovieKey(m);
    return !votedKeys.has(key) && !seenKeys.has(key) && !sessionSeenKeys.has(key) && !inferredSeenKeys.has(key) && !notInterestedKeys.has(key);
  });

  let allScored;

  if (isSparse) {
    const globalWins = {};
    for (const v of allVotes) {
      globalWins[v.winner] = (globalWins[v.winner] || 0) + 1;
    }

    let prefPicks = [];
    if (userVotes.length > 0) {
      const scored = scoreCandidates(candidates, prefs);
      scored.sort((a, b) => b.score - a.score);
      prefPicks = scored.slice(0, Math.floor(DISPLAY_COUNT / 2));
      prefPicks.forEach(r => { r.reason = generateReason(r); });
    }

    const prefKeys = new Set(prefPicks.map(p => getMovieKey(p.movie)));
    const popular = candidates
      .filter(m => !prefKeys.has(getMovieKey(m)))
      .map(m => ({
        movie: m,
        score: globalWins[getMovieKey(m)] || 0,
        contributions: [],
        communityBoost: 0,
        similarMovies: [],
        reason: "A popular pick \u2014 vote more to personalize"
      }))
      .sort((a, b) => b.score - a.score);

    allScored = [...prefPicks, ...popular];
    // Assign reasons to popular picks that don't have one yet
    allScored.forEach(r => { if (!r.reason) r.reason = generateReason(r); });
  } else {
    let scored = scoreCandidates(candidates, prefs);
    const currentUserWinners = new Set(userVotes.map(v => v.winner));
    scored = applyCommunityBoost(scored, currentUserWinners, votesByUser, userId);
    scored.sort((a, b) => b.score - a.score);
    scored.forEach(r => { r.reason = generateReason(r); });
    allScored = scored;
  }

  const tasteProfile = buildTasteProfile(prefs);

  // Compute genre stats, movie stats, and confidence for profile sections
  const genreStats = computeGenreStats(userVotes, movieMap);
  const movieStats = computeMovieStats(userVotes);
  const distinctMovies = new Set();
  for (const v of userVotes) { distinctMovies.add(v.winner); distinctMovies.add(v.loser); }
  const confidence = computeConfidence(userVotes.length);

  const output = {
    allScored, tasteProfile, voteCount: userVotes.length, isSparse,
    genreStats, movieStats, confidence, distinctMovieCount: distinctMovies.size
  };

  cache = { uid: userId, results: output };
  return output;
}

// ==========================================
// TASTE PROFILE
// ==========================================

function buildTasteProfile(prefs) {
  const entries = Object.entries(prefs)
    .map(([key, score]) => {
      const [type, value] = key.split(":");
      return { key, type, value, score };
    })
    .filter(e => Math.abs(e.score) > 1);

  entries.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const liked = entries.filter(e => e.score > 0).slice(0, 6).map(e => ({
    label: e.value, type: e.type, score: Math.round(e.score * 10) / 10
  }));

  const disliked = entries.filter(e => e.score < 0).slice(0, 4).map(e => ({
    label: e.value, type: e.type, score: Math.round(e.score * 10) / 10
  }));

  return { liked, disliked };
}

// ==========================================
// PROFILE — GENRE STATS
// ==========================================

function computeGenreStats(userVotes, movieMap) {
  const stats = {}; // genre → { wins, losses }
  for (const vote of userVotes) {
    const winner = movieMap[vote.winner];
    const loser = movieMap[vote.loser];
    if (winner?.genre) {
      if (!stats[winner.genre]) stats[winner.genre] = { wins: 0, losses: 0 };
      stats[winner.genre].wins++;
    }
    if (loser?.genre) {
      if (!stats[loser.genre]) stats[loser.genre] = { wins: 0, losses: 0 };
      stats[loser.genre].losses++;
    }
  }
  return Object.entries(stats)
    .map(([genre, s]) => ({
      genre,
      wins: s.wins,
      losses: s.losses,
      total: s.wins + s.losses,
      winRate: Math.round(100 * s.wins / (s.wins + s.losses))
    }))
    .filter(g => g.total >= 3)
    .sort((a, b) => b.winRate - a.winRate);
}

// ==========================================
// PROFILE — MOVIE STATS (LOVED / REJECTED)
// ==========================================

function computeMovieStats(userVotes) {
  const stats = {}; // movieKey → { wins, losses }
  for (const vote of userVotes) {
    if (!stats[vote.winner]) stats[vote.winner] = { wins: 0, losses: 0 };
    stats[vote.winner].wins++;
    if (!stats[vote.loser]) stats[vote.loser] = { wins: 0, losses: 0 };
    stats[vote.loser].losses++;
  }
  const all = Object.entries(stats).map(([key, s]) => ({
    key, title: keyToTitle(key), year: key.split("|")[1],
    wins: s.wins, losses: s.losses, diff: s.wins - s.losses
  }));
  const loved = [...all].sort((a, b) => b.diff - a.diff || b.wins - a.wins).slice(0, 5);
  const rejected = [...all].sort((a, b) => a.diff - b.diff || b.losses - a.losses).slice(0, 5);
  return { loved, rejected };
}

// ==========================================
// PROFILE — CONFIDENCE SCORE
// ==========================================

function computeConfidence(n) {
  return Math.round(100 * (1 - Math.exp(-n / 50)));
}

// ==========================================
// FIREBASE — MARK SEEN
// ==========================================

async function markMovieSeen(movieKey) {
  if (!currentUid) return;
  sessionSeenKeys.add(movieKey);
  try {
    await setDoc(doc(db, "users", currentUid), {
      seenMovies: arrayUnion(movieKey)
    }, { merge: true });
    console.log(`Marked as seen: ${movieKey}`);
  } catch (err) {
    console.error("Failed to save seen status:", err);
  }
}

async function saveNotInterested(movieKey) {
  notInterestedKeys.add(movieKey);
  if (currentUid) {
    try {
      await setDoc(doc(db, "users", currentUid), {
        notInterested: arrayUnion(movieKey)
      }, { merge: true });
    } catch (err) {
      console.error("Failed to save not-interested:", err);
    }
  } else {
    const stored = JSON.parse(localStorage.getItem("notInterestedMovies")) || [];
    if (!stored.includes(movieKey)) stored.push(movieKey);
    localStorage.setItem("notInterestedMovies", JSON.stringify(stored));
  }
}

async function removeUnseenDesignation(movieKey) {
  if (!currentUid) return;
  unseenMovieKeys.delete(movieKey);
  try {
    await setDoc(doc(db, "users", currentUid), {
      seen: arrayRemove(movieKey)
    }, { merge: true });
    console.log(`Removed "haven't seen" designation: ${movieKey}`);
  } catch (err) {
    console.error("Failed to remove unseen designation:", err);
  }
}

// ==========================================
// UI — RENDER SINGLE CARD
// ==========================================

function buildCardHTML(item, index) {
  const m = item.movie;
  const key = getMovieKey(m);
  const isUnseen = unseenMovieKeys.has(key);
  const vibeChips = m.vibes
    ? m.vibes.split(",").slice(0, 2).map(v => `<span class="engine-tag">${v.trim()}</span>`).join("")
    : "";

  const unseenBadge = isUnseen
    ? `<div class="engine-card-unseen-badge">Haven't Seen</div>`
    : "";

  return `
    <div class="engine-card-poster-wrap">
      <img class="engine-card-poster" id="engine-poster-${index}" src="" alt="${m.title}" />
      <div class="engine-card-rank">${index + 1}</div>
      ${unseenBadge}
    </div>
    <div class="engine-card-body">
      <div class="engine-card-title">${m.title}</div>
      <div class="engine-card-year">${m.year}</div>
      <div class="engine-card-tags">
        <span class="engine-tag engine-tag--genre">${m.genre || ""}</span>
        ${m.tone ? `<span class="engine-tag">${m.tone}</span>` : ""}
        ${vibeChips}
      </div>
      <div class="engine-card-reason">\u201c${item.reason}\u201d</div>
      ${m.blurb ? `<div class="engine-card-blurb">${m.blurb}</div>` : ""}
      <button class="engine-btn-seen" onclick="handleSeenIt(${index})" title="Remove from recommendations">Seen it</button>
      <button class="engine-btn-not-interested" onclick="handleNotInterested(${index})" title="Not interested">Not interested</button>
    </div>`;
}

// ==========================================
// UI — HANDLE "SEEN IT"
// ==========================================

async function handleSeenIt(index) {
  const item = displayedItems[index];
  if (!item) return;

  const card = document.getElementById(`engine-card-${index}`);
  if (!card) return;

  // Prevent double-clicks
  const btn = card.querySelector(".engine-btn-seen");
  if (btn) btn.disabled = true;

  const movieKey = getMovieKey(item.movie);
  const wasUnseen = unseenMovieKeys.has(movieKey);

  // Save to Firebase (non-blocking — animate immediately)
  markMovieSeen(movieKey);

  // If this movie was marked "haven't seen", remove that designation so it goes back into voting
  if (wasUnseen) {
    removeUnseenDesignation(movieKey);
  }

  // Animate the card out
  card.classList.add("engine-card-exit");

  // Wait for exit animation
  await new Promise(resolve => setTimeout(resolve, 400));

  // Find replacement from overflow queue
  const replacement = overflowQueue.shift();

  if (replacement) {
    // Swap content
    displayedItems[index] = replacement;
    card.classList.remove("engine-card-exit");
    card.innerHTML = buildCardHTML(replacement, index);
    card.classList.add("engine-card-enter");

    // Fetch poster for replacement
    fetchPosterUrl(replacement.movie.title, replacement.movie.year).then(url => {
      const img = document.getElementById(`engine-poster-${index}`);
      if (img && url) img.src = url;
    });

    // Clean up animation class
    card.addEventListener("animationend", () => {
      card.classList.remove("engine-card-enter");
    }, { once: true });
  } else {
    // No replacement available — shrink the card away
    card.classList.remove("engine-card-exit");
    card.style.display = "none";
    displayedItems[index] = null;
  }
}

// ==========================================
// UI — HANDLE "NOT INTERESTED"
// ==========================================

async function handleNotInterested(index) {
  const item = displayedItems[index];
  if (!item) return;

  const card = document.getElementById(`engine-card-${index}`);
  if (!card) return;

  // Prevent double-clicks
  const btnSeen = card.querySelector(".engine-btn-seen");
  const btnNI = card.querySelector(".engine-btn-not-interested");
  if (btnSeen) btnSeen.disabled = true;
  if (btnNI) btnNI.disabled = true;

  const movieKey = getMovieKey(item.movie);

  // Save to Firebase/localStorage (non-blocking — animate immediately)
  saveNotInterested(movieKey);

  // Animate the card out
  card.classList.add("engine-card-exit");

  // Wait for exit animation
  await new Promise(resolve => setTimeout(resolve, 400));

  // Filter notInterested from overflow queue
  overflowQueue = overflowQueue.filter(r => !notInterestedKeys.has(getMovieKey(r.movie)));

  // Find replacement from overflow queue
  const replacement = overflowQueue.shift();

  if (replacement) {
    displayedItems[index] = replacement;
    card.classList.remove("engine-card-exit");
    card.innerHTML = buildCardHTML(replacement, index);
    card.classList.add("engine-card-enter");

    fetchPosterUrl(replacement.movie.title, replacement.movie.year).then(url => {
      const img = document.getElementById(`engine-poster-${index}`);
      if (img && url) img.src = url;
    });

    card.addEventListener("animationend", () => {
      card.classList.remove("engine-card-enter");
    }, { once: true });
  } else {
    card.classList.remove("engine-card-exit");
    card.style.display = "none";
    displayedItems[index] = null;
  }
}

// ==========================================
// UI — FULL RENDER
// ==========================================

function renderStatus(message, isWarning = false) {
  const el = document.getElementById("engine-status");
  if (!el) return;
  el.textContent = message;
  el.className = "engine-status" + (isWarning ? " engine-status--warn" : "");
}

function renderTasteProfile(profile, voteCount) {
  const el = document.getElementById("engine-profile");
  if (!el) return;

  if (!profile || (profile.liked.length === 0 && profile.disliked.length === 0)) {
    el.innerHTML = "";
    return;
  }

  let html = `<div class="engine-profile-header">Your Taste Profile <span class="engine-profile-votes">(${voteCount} votes)</span></div>`;
  html += '<div class="engine-profile-chips">';

  for (const item of profile.liked) {
    html += `<span class="engine-chip engine-chip--pos" title="${item.type}">+${item.score} ${item.label}</span>`;
  }
  for (const item of profile.disliked) {
    html += `<span class="engine-chip engine-chip--neg" title="${item.type}">${item.score} ${item.label}</span>`;
  }

  html += "</div>";
  el.innerHTML = html;
}

function renderRecommendations(allScored) {
  const grid = document.getElementById("engine-grid");
  if (!grid) return;

  if (!allScored || allScored.length === 0) {
    grid.innerHTML = '<div class="engine-empty">No recommendations available yet.</div>';
    return;
  }

  // Split into displayed (first 10) and overflow (the rest, for replacements)
  displayedItems = allScored.slice(0, DISPLAY_COUNT);
  overflowQueue = allScored.slice(DISPLAY_COUNT);

  grid.innerHTML = displayedItems.map((item, i) => {
    return `<div class="engine-card" id="engine-card-${i}">${buildCardHTML(item, i)}</div>`;
  }).join("");

  // Fetch posters in parallel
  displayedItems.forEach((r, i) => {
    fetchPosterUrl(r.movie.title, r.movie.year).then(url => {
      const img = document.getElementById(`engine-poster-${i}`);
      if (img && url) img.src = url;
    });
  });
}

// ==========================================
// UI — RENDER PREFERENCES SECTION
// ==========================================

let activeGenreFilter = null;

function renderPreferences(genreStats, movieStats, allScored) {
  const el = document.getElementById("profile-prefs-content");
  if (!el) return;

  if (!genreStats || genreStats.length === 0) {
    el.innerHTML = '<div class="engine-empty">Vote more to reveal your preferences.</div>';
    return;
  }

  // Genre cards
  let html = '<h3 class="profile-sub-heading">Top Genres (by win-rate)</h3>';
  html += '<div class="profile-genre-cards">';
  for (const g of genreStats.slice(0, 8)) {
    html += `<button class="profile-genre-card" data-genre="${g.genre}">
      <span class="profile-genre-name">${g.genre}</span>
      <span class="profile-genre-rate">${g.winRate}%</span>
      <span class="profile-genre-sample">${g.wins}&ndash;${g.losses}</span>
    </button>`;
  }
  html += '</div>';

  // Genre filter results area
  html += '<div id="profile-genre-filtered" class="profile-genre-filtered"></div>';

  // Loved / Rejected
  html += '<div class="profile-loved-rejected">';
  html += '<div class="profile-lr-col">';
  html += '<h3 class="profile-sub-heading">Most Loved</h3>';
  for (const m of movieStats.loved) {
    html += `<div class="profile-movie-row profile-movie-loved">
      <span class="profile-movie-title">${m.title}</span>
      <span class="profile-movie-year">${m.year}</span>
      <span class="profile-movie-record">${m.wins}W&ndash;${m.losses}L</span>
    </div>`;
  }
  html += '</div><div class="profile-lr-col">';
  html += '<h3 class="profile-sub-heading">Most Rejected</h3>';
  for (const m of movieStats.rejected) {
    html += `<div class="profile-movie-row profile-movie-rejected">
      <span class="profile-movie-title">${m.title}</span>
      <span class="profile-movie-year">${m.year}</span>
      <span class="profile-movie-record">${m.wins}W&ndash;${m.losses}L</span>
    </div>`;
  }
  html += '</div></div>';

  el.innerHTML = html;

  // Attach genre card click handlers
  const cards = el.querySelectorAll(".profile-genre-card");
  cards.forEach(card => {
    card.addEventListener("click", () => {
      const genre = card.dataset.genre;
      // Toggle active state
      cards.forEach(c => c.classList.remove("active"));
      if (activeGenreFilter === genre) {
        activeGenreFilter = null;
        document.getElementById("profile-genre-filtered").innerHTML = "";
        return;
      }
      activeGenreFilter = genre;
      card.classList.add("active");
      renderGenreFiltered(genre, allScored);
    });
  });
}

function renderGenreFiltered(genre, allScored) {
  const el = document.getElementById("profile-genre-filtered");
  if (!el) return;

  const matches = (allScored || [])
    .filter(r => r.movie.genre === genre)
    .slice(0, 6);

  if (matches.length === 0) {
    el.innerHTML = `<div class="profile-genre-filtered-empty">No recommended ${genre.toLowerCase()} movies right now.</div>`;
    return;
  }

  let html = `<div class="profile-genre-filtered-label">Recommended ${genre} movies:</div>`;
  html += '<div class="profile-genre-filtered-list">';
  for (const r of matches) {
    html += `<div class="profile-genre-filtered-item">
      <span class="profile-movie-title">${r.movie.title}</span>
      <span class="profile-movie-year">${r.movie.year}</span>
    </div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

// ==========================================
// UI — RENDER CONFIDENCE SECTION
// ==========================================

function renderConfidence(confidence, voteCount, distinctMovieCount) {
  const el = document.getElementById("profile-confidence-content");
  if (!el) return;

  const circumference = 2 * Math.PI * 54;
  const offset = circumference * (1 - confidence / 100);

  let html = '<div class="profile-confidence-wrap">';

  // Circular gauge
  html += `<div class="profile-confidence-gauge">
    <svg viewBox="0 0 120 120" class="profile-confidence-ring">
      <circle cx="60" cy="60" r="54" fill="none" stroke="var(--color-bg-2)" stroke-width="8"/>
      <circle cx="60" cy="60" r="54" fill="none" stroke="var(--color-accent)" stroke-width="8"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
        stroke-linecap="round" transform="rotate(-90 60 60)"
        style="transition: stroke-dashoffset 1s ease"/>
    </svg>
    <div class="profile-confidence-value">${confidence}</div>
  </div>`;

  // Stats
  html += '<div class="profile-confidence-stats">';
  html += `<div class="profile-stat">
    <span class="profile-stat-val">${voteCount}</span>
    <span class="profile-stat-label">Total Votes</span>
  </div>`;
  html += `<div class="profile-stat">
    <span class="profile-stat-val">${distinctMovieCount}</span>
    <span class="profile-stat-label">Movies Compared</span>
  </div>`;
  html += `<div class="profile-stat">
    <span class="profile-stat-val">${confidence}%</span>
    <span class="profile-stat-label">Confidence</span>
  </div>`;
  html += '</div></div>';

  // Contextual message
  let msg;
  if (confidence < 20) msg = "Just getting started. Keep voting to teach the engine your taste.";
  else if (confidence < 50) msg = "Building a picture. Your recommendations are starting to personalize.";
  else if (confidence < 75) msg = "Solid profile. The engine has a good read on your taste.";
  else msg = "Expert level. The engine knows your taste inside and out.";
  html += `<div class="profile-confidence-msg">${msg}</div>`;

  el.innerHTML = html;
}

// ==========================================
// INIT
// ==========================================

async function loadEngine(user) {
  currentUid = user.uid;

  // Load notInterested from localStorage as fallback/supplement
  const stored = JSON.parse(localStorage.getItem("notInterestedMovies")) || [];
  stored.forEach(k => notInterestedKeys.add(k));

  renderStatus("Analyzing your votes...");

  try {
    const data = await getRecommendationsForUser(user.uid);

    if (data.isSparse) {
      renderStatus(`You\u2019ve cast ${data.voteCount} vote${data.voteCount !== 1 ? "s" : ""}. Vote more to sharpen these picks.`, true);
    } else {
      renderStatus(`Based on ${data.voteCount} votes. The more you vote, the smarter this gets.`);
    }

    renderTasteProfile(data.tasteProfile, data.voteCount);
    renderRecommendations(data.allScored);
    renderPreferences(data.genreStats, data.movieStats, data.allScored);
    renderConfidence(data.confidence, data.voteCount, data.distinctMovieCount);
  } catch (err) {
    console.error("Engine error:", err);
    renderStatus("Something went wrong loading recommendations.", true);
  }
}

window.addEventListener("load", () => {
  onAuth(user => {
    if (user) {
      loadEngine(user);
    } else {
      currentUid = null;
      renderStatus("Log in to get personalized recommendations.", true);
      renderTasteProfile(null, 0);
      const grid = document.getElementById("engine-grid");
      if (grid) grid.innerHTML = '<div class="engine-empty">Your picks will appear here once you log in and start voting.</div>';
      const prefsEl = document.getElementById("profile-prefs-content");
      if (prefsEl) prefsEl.innerHTML = '<div class="engine-empty">Log in to build your Movie Profile (preferences + confidence).</div>';
      const confEl = document.getElementById("profile-confidence-content");
      if (confEl) confEl.innerHTML = '<div class="engine-empty">Log in to build your Movie Profile (preferences + confidence).</div>';
    }
  });
});

// Expose for inline onclick handlers
window.handleSeenIt = handleSeenIt;
window.handleNotInterested = handleNotInterested;
