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
  doc,
  getDoc,
  setDoc,
  arrayUnion,
  arrayRemove,
  collection,
  getDocs
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

// Cache collaborative filtering data for the session (avoids re-fetching other users' stats)
let collabCache = { uid: null, similarUsers: null };

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

function buildPreferenceVector(userStats, movieMap) {
  const prefs = {};
  const votedKeys = new Set();

  for (const [key, stats] of Object.entries(userStats)) {
    const w = stats.wins || 0;
    const l = stats.losses || 0;
    if (w === 0 && l === 0) continue;
    votedKeys.add(key);

    const movie = movieMap[key];
    if (!movie) continue;

    const attrs = getMovieAttributes(movie);
    // Net signal: wins push attributes positive, losses push negative
    for (const [attrKey, weight] of Object.entries(attrs)) {
      prefs[attrKey] = (prefs[attrKey] || 0) + weight * (w - l);
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
// PHASE 3 — COLLABORATIVE FILTERING
// ==========================================

function computeSimilarity(userStatsA, userStatsB) {
  // Find shared movies both users have voted on
  const shared = [];
  for (const key of Object.keys(userStatsA)) {
    if (userStatsB[key]) {
      const a = userStatsA[key];
      const b = userStatsB[key];
      const aTotal = (a.wins || 0) + (a.losses || 0);
      const bTotal = (b.wins || 0) + (b.losses || 0);
      if (aTotal >= 2 && bTotal >= 2) {
        shared.push({
          aRate: (a.wins || 0) / aTotal,
          bRate: (b.wins || 0) / bTotal
        });
      }
    }
  }

  // Require minimum 10 shared movies for a meaningful comparison
  if (shared.length < 10) return 0;

  // Pearson-like correlation on win rates
  const n = shared.length;
  let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
  for (const { aRate, bRate } of shared) {
    sumA += aRate;
    sumB += bRate;
    sumAB += aRate * bRate;
    sumA2 += aRate * aRate;
    sumB2 += bRate * bRate;
  }

  const numerator = n * sumAB - sumA * sumB;
  const denominator = Math.sqrt((n * sumA2 - sumA * sumA) * (n * sumB2 - sumB * sumB));

  if (denominator === 0) return 0;
  return Math.max(0, numerator / denominator); // Only positive correlations are useful
}

async function applyCollaborativeBoost(scoredCandidates, userStats, currentUid, movieMap) {
  try {
    let similarUsers;

    // Use cached collab data if available for this user
    if (collabCache.uid === currentUid && collabCache.similarUsers) {
      similarUsers = collabCache.similarUsers;
    } else {
      // Fetch all user UIDs
      const usersSnap = await getDocs(collection(db, "users"));
      const otherUids = [];
      usersSnap.forEach(d => {
        if (d.id !== currentUid) otherUids.push(d.id);
      });

      // Cap at 20 other users
      const uidsToCheck = otherUids.slice(0, 20);

      // Fetch stats for each other user
      const statsSnaps = await Promise.all(
        uidsToCheck.map(uid => getDoc(doc(db, "stats", `user_${uid}`)))
      );

      // Compute similarity for each
      const candidates = [];
      for (let i = 0; i < uidsToCheck.length; i++) {
        const snap = statsSnaps[i];
        if (!snap.exists()) continue;
        const otherStats = snap.data().stats || {};
        const similarity = computeSimilarity(userStats, otherStats);
        if (similarity > 0.1) {
          candidates.push({ uid: uidsToCheck[i], similarity, stats: otherStats });
        }
      }

      // Take top 5 most similar
      candidates.sort((a, b) => b.similarity - a.similarity);
      similarUsers = candidates.slice(0, 5);

      // Cache for session
      collabCache = { uid: currentUid, similarUsers };
    }

    console.log(`Collab filtering: found ${similarUsers.length} similar users`);

    if (similarUsers.length === 0) return;

    // Build set of movies the current user has voted on
    const userVotedKeys = new Set(Object.keys(userStats));

    // For each candidate movie, check if similar users love it
    for (const item of scoredCandidates) {
      const key = getMovieKey(item.movie);
      if (userVotedKeys.has(key)) continue;

      let boost = 0;
      for (const { similarity, stats } of similarUsers) {
        const movieStats = stats[key];
        if (!movieStats) continue;
        const w = movieStats.wins || 0;
        const l = movieStats.losses || 0;
        const total = w + l;
        if (total < 3) continue;
        const winRate = w / total;
        if (winRate > 0.6) {
          boost += similarity * winRate * 0.5;
        }
      }

      item.communityBoost = boost;
    }

    // Re-sort by score + communityBoost
    scoredCandidates.sort((a, b) => (b.score + b.communityBoost) - (a.score + a.communityBoost));
  } catch (err) {
    console.warn("Collaborative filtering failed (non-fatal):", err);
  }
}

// ==========================================
// PHASE 4 — DIVERSITY SELECTION
// ==========================================

function applyDiversitySelection(scoredItems, count) {
  if (scoredItems.length <= count) return scoredItems;

  // Sort by final score (score + communityBoost) descending
  const pool = scoredItems.map(item => ({
    ...item,
    finalScore: item.score + (item.communityBoost || 0)
  }));
  pool.sort((a, b) => b.finalScore - a.finalScore);

  const selected = [];
  const selectedGenres = [];

  // Always pick the #1 scored movie
  selected.push(pool[0]);
  if (pool[0].movie.genre) selectedGenres.push(pool[0].movie.genre);
  pool.splice(0, 1);

  // Greedily pick remaining slots with genre-diversity penalty
  while (selected.length < count && pool.length > 0) {
    let bestIdx = 0;
    let bestPenalizedScore = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      let penalized = pool[i].finalScore;
      if (pool[i].movie.genre) {
        const genreCount = selectedGenres.filter(g => g === pool[i].movie.genre).length;
        penalized *= Math.pow(0.7, genreCount);
      }
      if (penalized > bestPenalizedScore) {
        bestPenalizedScore = penalized;
        bestIdx = i;
      }
    }

    const pick = pool[bestIdx];
    selected.push(pick);
    if (pick.movie.genre) selectedGenres.push(pick.movie.genre);
    pool.splice(bestIdx, 1);
  }

  return selected;
}

// ==========================================
// REASON GENERATION
// ==========================================

function generateReason(item) {
  const hasCollabBoost = (item.communityBoost || 0) > 0.1;
  const top = (item.contributions || [])[0];

  // Pure collaborative signal — no strong attribute match
  if (hasCollabBoost && (!top || top.value <= 0)) {
    return "Loved by voters with similar taste to yours";
  }

  if (!top || top.value <= 0) return "A 90s classic worth checking out";

  const [type, value] = top.key.split(":");

  // Build the attribute reason
  let attrReason;
  switch (type) {
    case "genre":    attrReason = `Because you tend to prefer ${value.toLowerCase()} films`; break;
    case "decade":   attrReason = `Matches your taste for ${value} era movies`; break;
    case "tone":     attrReason = `Fits your preference for ${value} movies`; break;
    case "category": attrReason = value === "cult"
                       ? "Right up your alley \u2014 a cult favorite"
                       : "A crowd-pleasing pick based on your votes"; break;
    case "vibe":     attrReason = `Matches the ${value} vibe you gravitate toward`; break;
    default:         attrReason = "Based on your voting history";
  }

  // Combine attribute reason with collaborative signal
  if (hasCollabBoost) {
    return `${attrReason} \u2014 and similar voters love it`;
  }

  return attrReason;
}

// ==========================================
// MAIN — getRecommendationsForUser
// ==========================================

async function getRecommendationsForUser(userId) {
  if (cache.uid === userId && cache.results) return cache.results;

  // Load movie list + user stats + global stats + user doc (4 reads, no votes scan)
  const [moviesRes, userStatsSnap, globalStatsSnap, userDocSnap] = await Promise.all([
    fetch("movie_list_cleaned.json"),
    getDoc(doc(db, "stats", `user_${userId}`)),
    getDoc(doc(db, "stats", "global")),
    getDoc(doc(db, "users", userId))
  ]);

  const allMovies = await moviesRes.json();
  const movies = allMovies.filter(m => m.title && m.year && !/^title$/i.test(m.title.trim()));
  const movieMap = {};
  for (const m of movies) movieMap[getMovieKey(m)] = m;

  const userStats = userStatsSnap.exists() ? (userStatsSnap.data().stats || {}) : {};
  const globalStats = globalStatsSnap.exists() ? (globalStatsSnap.data().stats || {}) : {};

  // Count user's total votes (each vote = 1 win for one movie)
  let voteCount = 0;
  for (const key in userStats) {
    voteCount += (userStats[key].wins || 0);
  }

  // Load user's "haven't seen" list, "seen it" list, and inferred-seen list
  let unseenKeys = new Set();
  let seenKeys = new Set();
  let inferredSeenKeys = new Set();
  if (userDocSnap.exists()) {
    const data = userDocSnap.data();
    (data.seen || []).forEach(k => unseenKeys.add(k));
    (data.seenMovies || []).forEach(k => seenKeys.add(k));
    (data.inferredSeen || []).forEach(k => inferredSeenKeys.add(k));
    (data.notInterested || []).forEach(k => notInterestedKeys.add(k));
  }

  // Merge session-seen keys
  seenKeys.forEach(k => sessionSeenKeys.add(k));

  // Store unseen keys at module level so cards can show badges
  unseenMovieKeys = unseenKeys;

  const isSparse = voteCount < MIN_VOTES_FOR_PERSONALIZATION;
  const { prefs, votedKeys } = buildPreferenceVector(userStats, movieMap);

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
    // For sparse users, mix preference-based picks with globally popular movies
    let prefPicks = [];
    if (voteCount > 0) {
      const scored = scoreCandidates(candidates, prefs);
      scored.sort((a, b) => b.score - a.score);
      prefPicks = scored.slice(0, Math.floor(DISPLAY_COUNT / 2));
      prefPicks.forEach(r => { r.reason = generateReason(r); });
    }

    const prefKeys = new Set(prefPicks.map(p => getMovieKey(p.movie)));
    const popular = candidates
      .filter(m => !prefKeys.has(getMovieKey(m)))
      .map(m => {
        const gs = globalStats[getMovieKey(m)] || {};
        return {
          movie: m,
          score: gs.wins || 0,
          contributions: [],
          communityBoost: 0,
          similarMovies: [],
          reason: "A popular pick \u2014 vote more to personalize"
        };
      })
      .sort((a, b) => b.score - a.score);

    const combined = [...prefPicks, ...popular];
    combined.forEach(r => { if (!r.reason) r.reason = generateReason(r); });

    // Apply diversity even for sparse users
    allScored = applyDiversitySelection(combined, DISPLAY_COUNT * 3);
  } else {
    let scored = scoreCandidates(candidates, prefs);

    // Phase 3 — Collaborative filtering
    await applyCollaborativeBoost(scored, userStats, userId, movieMap);

    // Phase 4 — Diversity selection
    const diverse = applyDiversitySelection(scored, DISPLAY_COUNT * 3);

    // Update reasons with collab signals
    diverse.forEach(r => { r.reason = generateReason(r); });

    allScored = diverse;
  }

  const tasteProfile = buildTasteProfile(prefs);

  // Compute profile data: genre preferences (with global consensus), break-from-crowd
  const genrePreferences = computeGenrePreferenceScores(userStats, globalStats, movieMap);
  const breakFromCrowd = computeBreakFromCrowd(userStats, globalStats, movieMap);

  const output = {
    allScored, tasteProfile, voteCount, isSparse,
    genrePreferences, breakFromCrowd,
    totalMovies: movies.length,
    comparedCount: votedKeys.size,
    unseenCount: unseenKeys.size,
    notInterestedCount: notInterestedKeys.size
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

function computeGenrePreferenceScores(userStats, globalStats, movieMap) {
  // Aggregate per-genre stats from per-movie stats
  const userGenre = {};
  const globalGenre = {};

  for (const [key, s] of Object.entries(userStats)) {
    const movie = movieMap[key];
    if (!movie?.genre) continue;
    if (!userGenre[movie.genre]) userGenre[movie.genre] = { wins: 0, losses: 0 };
    userGenre[movie.genre].wins += (s.wins || 0);
    userGenre[movie.genre].losses += (s.losses || 0);
  }

  for (const [key, s] of Object.entries(globalStats)) {
    const movie = movieMap[key];
    if (!movie?.genre) continue;
    if (!globalGenre[movie.genre]) globalGenre[movie.genre] = { wins: 0, losses: 0 };
    globalGenre[movie.genre].wins += (s.wins || 0);
    globalGenre[movie.genre].losses += (s.losses || 0);
  }

  return Object.entries(userGenre)
    .map(([genre, s]) => {
      const total = s.wins + s.losses;
      const userRate = s.wins / total;
      const gs = globalGenre[genre];
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
        value: Math.max(0, Math.min(1, 0.5 + delta))
      };
    })
    .filter(g => g.total >= 6)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 12);
}

// ==========================================
// PROFILE — BREAK FROM THE CROWD
// ==========================================

function computeBreakFromCrowd(userStats, globalStats, movieMap) {
  const rows = [];
  for (const [key, us] of Object.entries(userStats)) {
    const uw = us.wins || 0;
    const ul = us.losses || 0;
    const userTotal = uw + ul;
    if (userTotal < 5) continue;
    const gs = globalStats[key];
    if (!gs) continue;
    const gw = gs.wins || 0;
    const gl = gs.losses || 0;
    const globalTotal = gw + gl;
    if (globalTotal < 20) continue;

    const userWinRate = Math.round(100 * uw / userTotal);
    const globalWinRate = Math.round(100 * gw / globalTotal);
    const delta = userWinRate - globalWinRate;
    if (delta === 0) continue;

    rows.push({
      key,
      title: keyToTitle(key),
      year: key.split("|")[1],
      userRecord: `${uw}W\u2013${ul}L`,
      globalRecord: `${gw}W\u2013${gl}L`,
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
// UI — RENDER PROGRESS CARD
// ==========================================

function renderProgressCard({ totalMovies, comparedCount, voteCount, unseenCount, notInterestedCount }) {
  const el = document.getElementById("progress-card");
  if (!el) return;

  const total = totalMovies || 1; // avoid divide by zero
  const coveragePct = Math.round((comparedCount / total) * 100);
  const unseenPct = Math.round((unseenCount / total) * 100);
  const niPct = Math.round((notInterestedCount / total) * 100);

  el.innerHTML = `
    <h2 class="profile-section-heading">Your Progress</h2>
    <div class="progress-bar-wrap">
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width:${coveragePct}%"></div>
      </div>
      <div class="progress-bar-label">${comparedCount} / ${totalMovies} movies compared (${coveragePct}%)</div>
    </div>
    <div class="progress-stats">
      <div class="progress-stat">
        <div class="progress-stat-val">${voteCount.toLocaleString()}</div>
        <div class="progress-stat-label">Votes Cast</div>
      </div>
      <div class="progress-stat">
        <div class="progress-stat-val">${comparedCount.toLocaleString()}</div>
        <div class="progress-stat-label">Movies Compared</div>
      </div>
      <div class="progress-stat">
        <div class="progress-stat-val">${unseenCount.toLocaleString()}</div>
        <div class="progress-stat-label">Haven't Seen (${unseenPct}%)</div>
      </div>
      <div class="progress-stat">
        <div class="progress-stat-val">${notInterestedCount.toLocaleString()}</div>
        <div class="progress-stat-label">Not Interested (${niPct}%)</div>
      </div>
    </div>
  `;
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

    renderProgressCard(data);
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

      // Show minimal progress for logged-out users
      const progressEl = document.getElementById("progress-card");
      if (progressEl) {
        progressEl.innerHTML = `
          <h2 class="profile-section-heading">Your Progress</h2>
          <div class="engine-empty">Log in to track your catalogue coverage and voting progress.</div>
        `;
      }
    }
  });
});

// Expose for inline onclick handlers
window.handleSeenIt = handleSeenIt;
window.handleNotInterested = handleNotInterested;
