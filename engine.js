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

  // Compute profile data: genre preferences (with global consensus), break-from-crowd
  const genrePreferences = computeGenrePreferenceScores(userVotes, allVotes, movieMap);
  const breakFromCrowd = computeBreakFromCrowd(userVotes, allVotes, movieMap);

  const output = {
    allScored, tasteProfile, voteCount: userVotes.length, isSparse,
    genrePreferences, breakFromCrowd
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
// PROFILE — GENRE PREFERENCE SCORES
// ==========================================

function computeGenrePreferenceScores(userVotes, allVotes, movieMap) {
  // User per-genre stats
  const userStats = {};
  for (const vote of userVotes) {
    const winner = movieMap[vote.winner];
    const loser = movieMap[vote.loser];
    if (winner?.genre) {
      if (!userStats[winner.genre]) userStats[winner.genre] = { wins: 0, losses: 0 };
      userStats[winner.genre].wins++;
    }
    if (loser?.genre) {
      if (!userStats[loser.genre]) userStats[loser.genre] = { wins: 0, losses: 0 };
      userStats[loser.genre].losses++;
    }
  }

  // Global per-genre stats (for consensus baseline)
  const globalStats = {};
  for (const vote of allVotes) {
    const winner = movieMap[vote.winner];
    const loser = movieMap[vote.loser];
    if (winner?.genre) {
      if (!globalStats[winner.genre]) globalStats[winner.genre] = { wins: 0, losses: 0 };
      globalStats[winner.genre].wins++;
    }
    if (loser?.genre) {
      if (!globalStats[loser.genre]) globalStats[loser.genre] = { wins: 0, losses: 0 };
      globalStats[loser.genre].losses++;
    }
  }

  return Object.entries(userStats)
    .map(([genre, s]) => {
      const total = s.wins + s.losses;
      const userRate = s.wins / total;
      const gs = globalStats[genre];
      let globalRate = 0.5;
      let globalTotal = 0;
      if (gs) {
        globalTotal = gs.wins + gs.losses;
        if (globalTotal >= 10) globalRate = gs.wins / globalTotal;
      }
      const delta = userRate - globalRate;
      return {
        genre,
        wins: s.wins,
        losses: s.losses,
        total,
        userRate: Math.round(userRate * 100),
        globalRate: Math.round(globalRate * 100),
        globalTotal,
        delta,
        value: Math.max(0, Math.min(1, 0.5 + delta))  // clamped for chart
      };
    })
    .filter(g => g.total >= 6)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 12);
}

// ==========================================
// PROFILE — BREAK FROM THE CROWD
// ==========================================

function computeBreakFromCrowd(userVotes, allVotes, movieMap) {
  // Global per-movie stats
  const globalStats = {};
  for (const v of allVotes) {
    if (!globalStats[v.winner]) globalStats[v.winner] = { wins: 0, losses: 0 };
    globalStats[v.winner].wins++;
    if (!globalStats[v.loser]) globalStats[v.loser] = { wins: 0, losses: 0 };
    globalStats[v.loser].losses++;
  }

  // User per-movie stats
  const userStats = {};
  for (const v of userVotes) {
    if (!userStats[v.winner]) userStats[v.winner] = { wins: 0, losses: 0 };
    userStats[v.winner].wins++;
    if (!userStats[v.loser]) userStats[v.loser] = { wins: 0, losses: 0 };
    userStats[v.loser].losses++;
  }

  const rows = [];
  for (const [key, us] of Object.entries(userStats)) {
    const userTotal = us.wins + us.losses;
    if (userTotal < 5) continue;
    const gs = globalStats[key];
    if (!gs) continue;
    const globalTotal = gs.wins + gs.losses;
    if (globalTotal < 20) continue;

    const userWinRate = Math.round(100 * us.wins / userTotal);
    const globalWinRate = Math.round(100 * gs.wins / globalTotal);
    const delta = userWinRate - globalWinRate;
    if (delta === 0) continue;

    rows.push({
      key,
      title: keyToTitle(key),
      year: key.split("|")[1],
      userRecord: `${us.wins}W\u2013${us.losses}L`,
      globalRecord: `${gs.wins}W\u2013${gs.losses}L`,
      userWinRate,
      globalWinRate,
      delta
    });
  }

  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const higher = rows.filter(r => r.delta > 0).slice(0, 5);
  const lower = rows.filter(r => r.delta < 0).slice(0, 5);
  return { higher, lower, hasData: higher.length > 0 || lower.length > 0 };
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
// UI — RENDER TASTE PROFILE (RADAR / SPIDERWEB CANVAS)
// ==========================================

function renderTasteProfileChart(genrePreferences) {
  const el = document.getElementById("taste-profile-content");
  if (!el) return;

  if (!genrePreferences || genrePreferences.length === 0) {
    el.innerHTML = '<div class="engine-empty">Vote a bit more to reveal your taste profile. Genres appear after at least 6 matchups each.</div>';
    return;
  }

  const data = genrePreferences;
  const n = data.length;

  el.innerHTML = '<div class="radar-wrap"><canvas id="radar-canvas" width="360" height="360"></canvas></div>'
    + '<div class="radar-detail" id="radar-detail"></div>';

  const canvas = document.getElementById("radar-canvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssSize = 360;
  canvas.width = cssSize * dpr;
  canvas.height = cssSize * dpr;
  canvas.style.width = cssSize + "px";
  canvas.style.height = cssSize + "px";
  ctx.scale(dpr, dpr);

  const cx = cssSize / 2;
  const cy = cssSize / 2;
  const maxR = cssSize / 2 - 40;
  const rings = 4;

  function angleFor(i) {
    return (Math.PI * 2 * i) / n - Math.PI / 2;
  }

  function pointAt(i, val) {
    const a = angleFor(i);
    const r = val * maxR;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function draw(highlightIdx) {
    ctx.clearRect(0, 0, cssSize, cssSize);

    // Web rings
    for (let r = 1; r <= rings; r++) {
      const frac = r / rings;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const p = pointAt(i, frac);
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Spokes
    for (let i = 0; i < n; i++) {
      const p = pointAt(i, 1);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Neutral ring (0.5 = baseline)
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = pointAt(i, 0.5);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // Data polygon
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p = pointAt(i, data[i].value);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(232, 163, 23, 0.15)";
    ctx.fill();
    ctx.strokeStyle = "rgba(232, 163, 23, 0.8)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Data points + Labels
    for (let i = 0; i < n; i++) {
      const dp = pointAt(i, data[i].value);
      const isHighlight = highlightIdx === i;

      // Point
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, isHighlight ? 5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = isHighlight ? "#e8a317" : "rgba(232, 163, 23, 0.9)";
      ctx.fill();

      // Label
      const lp = pointAt(i, 1.15);
      ctx.font = `${isHighlight ? "bold " : ""}${isHighlight ? "12" : "10"}px 'Space Grotesk', sans-serif`;
      ctx.fillStyle = isHighlight ? "#e8a317" : "rgba(229,229,229,0.7)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(data[i].genre, lp.x, lp.y);
    }
  }

  draw(-1);

  // Interaction: find nearest axis on mouse/touch
  function getNearest(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    let minDist = Infinity, nearest = -1;
    for (let i = 0; i < n; i++) {
      const p = pointAt(i, data[i].value);
      const d = Math.hypot(mx - p.x, my - p.y);
      if (d < minDist) { minDist = d; nearest = i; }
    }
    return minDist < 40 ? nearest : -1;
  }

  function showDetail(idx) {
    const detail = document.getElementById("radar-detail");
    if (!detail) return;
    if (idx < 0) {
      detail.textContent = "";
      return;
    }
    const g = data[idx];
    const deltaSign = g.delta >= 0 ? "+" : "";
    const deltaStr = `${deltaSign}${Math.round(g.delta * 100)}%`;
    detail.textContent = `${g.genre}: You ${g.userRate}% (${g.wins}\u2013${g.losses}) | Crowd ${g.globalRate}% | Delta ${deltaStr}`;
  }

  let activeIdx = -1;

  canvas.addEventListener("mousemove", e => {
    const idx = getNearest(e.clientX, e.clientY);
    if (idx !== activeIdx) {
      activeIdx = idx;
      draw(idx);
      showDetail(idx);
    }
  });

  canvas.addEventListener("mouseleave", () => {
    activeIdx = -1;
    draw(-1);
    showDetail(-1);
  });

  canvas.addEventListener("click", e => {
    const idx = getNearest(e.clientX, e.clientY);
    activeIdx = idx;
    draw(idx);
    showDetail(idx);
  });
}

// ==========================================
// UI — RENDER BREAK FROM THE CROWD
// ==========================================

function renderBreakFromCrowd(breakData) {
  const el = document.getElementById("break-crowd-content");
  if (!el) return;

  if (!breakData || !breakData.hasData) {
    el.innerHTML = '<div class="engine-empty">Not enough data yet. Keep voting to see how your taste differs from the crowd.</div>';
    return;
  }

  function buildColumn(title, items, deltaClass) {
    let html = `<div class="crowd-col"><h3 class="profile-sub-heading">${title}</h3>`;
    if (items.length === 0) {
      html += '<div class="crowd-empty">Not enough data yet.</div>';
    } else {
      html += '<div class="crowd-table">';
      html += `<div class="crowd-header-row">
        <span class="crowd-cell crowd-cell--title">Movie</span>
        <span class="crowd-cell crowd-cell--stat">You</span>
        <span class="crowd-cell crowd-cell--stat">Crowd</span>
        <span class="crowd-cell crowd-cell--delta">Delta</span>
      </div>`;
      for (const r of items) {
        html += `<div class="crowd-row">
          <span class="crowd-cell crowd-cell--title">
            <span class="profile-movie-title">${r.title}</span>
            <span class="profile-movie-year">${r.year}</span>
          </span>
          <span class="crowd-cell crowd-cell--stat">${r.userWinRate}%</span>
          <span class="crowd-cell crowd-cell--stat">${r.globalWinRate}%</span>
          <span class="crowd-cell crowd-cell--delta ${deltaClass}">${r.delta > 0 ? "+" : ""}${r.delta}%</span>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  let html = '<div class="crowd-columns">';
  html += buildColumn("You rate higher than the crowd", breakData.higher, "crowd-delta--pos");
  html += buildColumn("You rate lower than the crowd", breakData.lower, "crowd-delta--neg");
  html += '</div>';

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
    renderTasteProfileChart(data.genrePreferences);
    renderBreakFromCrowd(data.breakFromCrowd);
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
      const tasteEl = document.getElementById("taste-profile-content");
      if (tasteEl) tasteEl.innerHTML = '<div class="engine-empty">Log in and vote to build your taste profile.</div>';
      const crowdEl = document.getElementById("break-crowd-content");
      if (crowdEl) crowdEl.innerHTML = '<div class="engine-empty">Log in and vote to see how your taste differs.</div>';
    }
  });
});

// Expose for inline onclick handlers
window.handleSeenIt = handleSeenIt;
window.handleNotInterested = handleNotInterested;
