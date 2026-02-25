// functions/index.js — The Rewind Room Cloud Functions
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions }   = require("firebase-functions/v2");
const admin                  = require("firebase-admin");
const nodemailer             = require("nodemailer");

admin.initializeApp();
setGlobalOptions({ region: "us-central1" });

// ─────────────────────────────────────────────────────────────
// SMTP config — read from environment variables at runtime.
// Set via Firebase Functions config or process.env before deploying.
//
// To restore email invite sending, enable Secret Manager API and run:
//   firebase functions:secrets:set SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS
// then restore the defineSecret() pattern and update createUserInvite.
// ─────────────────────────────────────────────────────────────

// TMDB key lives server-side only — never sent to the browser.
// To rotate: update this constant and redeploy functions.
const TMDB_KEY = "825459de57821b3ab63446cce9046516";

const SUPER_ADMIN_EMAIL = "mjreardon62@gmail.com";

// ─────────────────────────────────────────────────────────────
// verifyAdmin — shared helper
//
// Throws HttpsError if the caller is not authenticated or not admin.
// Admins = super-admin email OR custom claim { admin: true }.
// ─────────────────────────────────────────────────────────────
function verifyAdmin(request) {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "You must be signed in to perform this action."
    );
  }
  const { email, admin: isAdminClaim } = request.auth.token;
  if (email !== SUPER_ADMIN_EMAIL && isAdminClaim !== true) {
    throw new HttpsError(
      "permission-denied",
      "Only admins can perform this action."
    );
  }
}

// ─────────────────────────────────────────────────────────────
// createUserInvite
//
// Admin-only callable function.
// 1. Creates a Firebase Auth user for the given email.
// 2. Generates a "set password" link via generatePasswordResetLink.
// 3. Sends an invite email with the link via SMTP.
// 4. Writes an audit log doc to adminActions.
// ─────────────────────────────────────────────────────────────

exports.createUserInvite = onCall(async (request) => {
    // 1. Must be admin (super-admin or granted admin claim)
    verifyAdmin(request);

    // 2. Validate input
    const { email, displayName } = request.data ?? {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError("invalid-argument", "A valid email address is required.");
    }

    // 3. Create Firebase Auth user (no password — they will set it via the link)
    let userRecord;
    try {
      const createParams = { email };
      if (displayName && String(displayName).trim()) {
        createParams.displayName = String(displayName).trim();
      }
      userRecord = await admin.auth().createUser(createParams);
    } catch (err) {
      if (err.code === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "An account with this email already exists.");
      }
      console.error("createUser failed:", err);
      throw new HttpsError("internal", "Failed to create user: " + err.message);
    }

    // 4. Generate a "set your password" link
    let resetLink;
    try {
      resetLink = await admin.auth().generatePasswordResetLink(email);
    } catch (err) {
      await admin.auth().deleteUser(userRecord.uid).catch(() => {});
      console.error("generatePasswordResetLink failed:", err);
      throw new HttpsError("internal", "Failed to generate activation link: " + err.message);
    }

    // 5. Send invite email via SMTP if env vars are configured
    const smtpHost = process.env.SMTP_HOST;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);

    if (smtpHost && smtpUser && smtpPass) {
      try {
        const transporter = nodemailer.createTransport({
          host: smtpHost, port: smtpPort, secure: smtpPort === 465,
          auth: { user: smtpUser, pass: smtpPass }
        });
        await transporter.sendMail({
          from:    `"The Rewind Room" <${smtpUser}>`,
          to:      email,
          subject: "You've been invited to The Rewind Room",
          text:    `Welcome! Set your password here: ${resetLink}\n\nThis link expires after 1 hour.`,
          html:    `<p>Welcome to The Rewind Room!</p><p><a href="${resetLink}">Set your password</a></p><p style="font-size:0.8em">This link expires after 1 hour.</p>`
        });
      } catch (err) {
        console.error("Email send failed (non-fatal):", err);
        // Don't throw — user was created and link is returned below
      }
    } else {
      console.warn("SMTP not configured — invite link not emailed. Returning link in response.");
    }

    // 6. Audit log
    try {
      await admin.firestore().collection("adminActions").add({
        action:         "userInvite",
        createdAt:      admin.firestore.FieldValue.serverTimestamp(),
        createdBy:      request.auth.uid,
        createdByEmail: request.auth.token.email,
        targetEmail:    email,
        targetUid:      userRecord.uid,
        displayName:    (displayName || "").trim() || null,
        status:         "invited",
      });
    } catch (err) {
      console.warn("Audit log write failed (non-fatal):", err);
    }

    // Return resetLink so admin can share it manually if SMTP isn't configured
    return { success: true, uid: userRecord.uid, resetLink };
  }
);

// ─────────────────────────────────────────────────────────────
// deleteUser
//
// Admin-only. Removes user from Firebase Auth + Firestore cleanup.
// Cannot delete self.
// ─────────────────────────────────────────────────────────────
exports.deleteUser = onCall(async (request) => {
  verifyAdmin(request);

  const { uid } = request.data ?? {};
  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "A valid uid is required.");
  }
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You cannot delete your own account.");
  }

  // Get username so we can delete the usernames doc
  let username = null;
  try {
    const userDoc = await admin.firestore().doc(`users/${uid}`).get();
    if (userDoc.exists) {
      username = userDoc.data().username || null;
    }
  } catch (err) {
    console.warn("Could not fetch user doc (non-fatal):", err);
  }

  // Firestore batch delete
  try {
    const batch = admin.firestore().batch();
    batch.delete(admin.firestore().doc(`users/${uid}`));
    if (username) {
      batch.delete(admin.firestore().doc(`usernames/${username.toLowerCase()}`));
    }
    batch.delete(admin.firestore().doc(`stats/user_${uid}`));
    await batch.commit();
  } catch (err) {
    console.error("Firestore batch delete failed:", err);
    throw new HttpsError("internal", "Failed to clean up user data: " + err.message);
  }

  // Delete from Firebase Auth
  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    if (err.code !== "auth/user-not-found") {
      console.error("Auth deleteUser failed:", err);
      throw new HttpsError("internal", "Failed to delete Auth user: " + err.message);
    }
  }

  // Audit log
  try {
    await admin.firestore().collection("adminActions").add({
      action:          "deleteUser",
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
      createdBy:       request.auth.uid,
      createdByEmail:  request.auth.token.email,
      targetUid:       uid,
      targetUsername:  username || null,
    });
  } catch (err) {
    console.warn("Audit log write failed (non-fatal):", err);
  }

  return { success: true };
});

// ─────────────────────────────────────────────────────────────
// setAdminRole
//
// Super-admin only (not delegated to other admins).
// Grants or revokes the { admin: true } custom claim.
// Mirrors the change to Firestore users/{uid}.isAdmin for display.
// The affected user must reload their session for the claim to take effect.
// ─────────────────────────────────────────────────────────────
exports.setAdminRole = onCall(async (request) => {
  // Super-admin only — not delegated
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to perform this action.");
  }
  if (request.auth.token.email !== SUPER_ADMIN_EMAIL) {
    throw new HttpsError(
      "permission-denied",
      "Only the super-admin can grant or revoke admin roles."
    );
  }

  const { uid, isAdmin } = request.data ?? {};
  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "A valid uid is required.");
  }
  if (typeof isAdmin !== "boolean") {
    throw new HttpsError("invalid-argument", "isAdmin must be a boolean.");
  }
  if (uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You cannot change your own admin role.");
  }

  // Set custom claim
  try {
    await admin.auth().setCustomUserClaims(uid, isAdmin ? { admin: true } : {});
  } catch (err) {
    console.error("setCustomUserClaims failed:", err);
    throw new HttpsError("internal", "Failed to update admin role: " + err.message);
  }

  // Mirror in Firestore for display (no extra token fetch needed client-side)
  try {
    await admin.firestore().doc(`users/${uid}`).set({ isAdmin }, { merge: true });
  } catch (err) {
    console.warn("Firestore isAdmin mirror failed (non-fatal):", err);
  }

  // Audit log
  try {
    await admin.firestore().collection("adminActions").add({
      action:          "setAdminRole",
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
      createdBy:       request.auth.uid,
      createdByEmail:  request.auth.token.email,
      targetUid:       uid,
      isAdmin,
    });
  } catch (err) {
    console.warn("Audit log write failed (non-fatal):", err);
  }

  return { success: true };
});

// ─────────────────────────────────────────────────────────────
// updateUserEmail
//
// Admin-only. Updates email in Firebase Auth and the usernames
// collection (which stores email for login lookups).
// ─────────────────────────────────────────────────────────────
exports.updateUserEmail = onCall(async (request) => {
  verifyAdmin(request);

  const { uid, newEmail } = request.data ?? {};
  if (!uid || typeof uid !== "string") {
    throw new HttpsError("invalid-argument", "A valid uid is required.");
  }
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw new HttpsError("invalid-argument", "A valid email address is required.");
  }

  // Get username so we can update the usernames doc
  let username = null;
  try {
    const userDoc = await admin.firestore().doc(`users/${uid}`).get();
    if (userDoc.exists) {
      username = userDoc.data().username || null;
    }
  } catch (err) {
    console.warn("Could not fetch user doc:", err);
  }

  // Update Firebase Auth email
  try {
    await admin.auth().updateUser(uid, { email: newEmail });
  } catch (err) {
    if (err.code === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "This email is already in use by another account.");
    }
    console.error("updateUser email failed:", err);
    throw new HttpsError("internal", "Failed to update email: " + err.message);
  }

  // Update email field in usernames doc (used for login lookups)
  if (username) {
    try {
      await admin.firestore().doc(`usernames/${username.toLowerCase()}`).set(
        { email: newEmail },
        { merge: true }
      );
    } catch (err) {
      console.warn("Usernames doc email update failed (non-fatal):", err);
    }
  }

  // Audit log
  try {
    await admin.firestore().collection("adminActions").add({
      action:          "updateUserEmail",
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
      createdBy:       request.auth.uid,
      createdByEmail:  request.auth.token.email,
      targetUid:       uid,
      newEmail,
    });
  } catch (err) {
    console.warn("Audit log write failed (non-fatal):", err);
  }

  return { success: true };
});

// ─────────────────────────────────────────────────────────────
// tmdbProxy
//
// Callable by any client (no auth required — public movie data).
// Proxies TMDB API calls so the API key never reaches the browser.
//
// Required secret (set once):
//   firebase functions:secrets:set TMDB_API_KEY
//
// Request: { title: string, year: string|number, mode: "search"|"info" }
//   "search" → { posterUrl, posterUrlSm, overview, vote_average }
//   "info"   → { posterUrl, overview, genres, runtime, rating, trailerUrl, cast }
// ─────────────────────────────────────────────────────────────

const TMDB_BASE   = "https://api.themoviedb.org/3";
const TMDB_IMG_W5 = "https://image.tmdb.org/t/p/w500";
const TMDB_IMG_W3 = "https://image.tmdb.org/t/p/w300";

exports.tmdbProxy = onCall(async (request) => {
    const { title, year, mode } = request.data ?? {};
    if (!title || typeof title !== "string") {
      throw new HttpsError("invalid-argument", "title is required");
    }
    const yearParam = year ? `&year=${encodeURIComponent(year)}` : "";
    const apiKey    = TMDB_KEY;

    // Step 1: search for the movie
    const searchRes = await fetch(
      `${TMDB_BASE}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(title)}${yearParam}`
    );
    if (!searchRes.ok) throw new HttpsError("unavailable", "TMDB search failed");
    const searchData = await searchRes.json();
    const hit = searchData.results?.[0];

    if (!hit) {
      return { posterUrl: null, posterUrlSm: null, overview: null, vote_average: null };
    }

    const posterUrl   = hit.poster_path ? TMDB_IMG_W5 + hit.poster_path : null;
    const posterUrlSm = hit.poster_path ? TMDB_IMG_W3 + hit.poster_path : null;

    if (mode === "info") {
      // Full details: genres, runtime, rating, trailer, cast
      const movieId = hit.id;
      const [detailRes, videosRes, creditsRes] = await Promise.all([
        fetch(`${TMDB_BASE}/movie/${movieId}?api_key=${apiKey}`),
        fetch(`${TMDB_BASE}/movie/${movieId}/videos?api_key=${apiKey}`),
        fetch(`${TMDB_BASE}/movie/${movieId}/credits?api_key=${apiKey}`)
      ]);
      const detail  = await detailRes.json();
      const videos  = await videosRes.json();
      const credits = await creditsRes.json();

      const trailer = videos.results?.find(
        v => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")
      );

      return {
        posterUrl,
        overview:   detail.overview || null,
        genres:     (detail.genres || []).map(g => g.name),
        runtime:    detail.runtime || null,
        rating:     detail.vote_average || null,
        trailerUrl: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
        cast:       (credits.cast || []).slice(0, 5).map(c => c.name)
      };
    }

    // Default: "search" — poster + overview + rating
    return {
      posterUrl,
      posterUrlSm,
      overview:     hit.overview || null,
      vote_average: hit.vote_average || null
    };
  }
);

// ─────────────────────────────────────────────────────────────
// recordVote
//
// Records a regular (home-page) vote atomically on the server.
// Replaces the client-side writeBatch that wrote to stats/global
// and stats/meta directly.
//
// Request: { winnerKey: string, loserKey: string }
// Returns: { success: true }
// ─────────────────────────────────────────────────────────────

exports.recordVote = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to vote.");
  }

  const { winnerKey, loserKey } = request.data ?? {};
  if (!winnerKey || typeof winnerKey !== "string" ||
      !loserKey  || typeof loserKey  !== "string") {
    throw new HttpsError("invalid-argument", "winnerKey and loserKey are required strings.");
  }
  if (winnerKey === loserKey) {
    throw new HttpsError("invalid-argument", "winnerKey and loserKey must differ.");
  }

  const uid = request.auth.uid;
  const db  = admin.firestore();

  // 1. Atomic batch: vote record + global stats + meta counter
  const batch = db.batch();

  batch.set(db.collection("votes").doc(), {
    winner:    winnerKey,
    loser:     loserKey,
    user:      uid,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  batch.set(db.doc("stats/global"), {
    [`stats.${winnerKey}.wins`]:  admin.firestore.FieldValue.increment(1),
    [`stats.${loserKey}.losses`]: admin.firestore.FieldValue.increment(1)
  }, { merge: true });

  batch.set(db.doc("stats/meta"), {
    totalVotes: admin.firestore.FieldValue.increment(1)
  }, { merge: true });

  await batch.commit();

  // 2. Per-user stats — updateDoc handles dot-notation as nested paths
  const userStatsRef = db.doc(`stats/user_${uid}`);
  try {
    await userStatsRef.update({
      [`stats.${winnerKey}.wins`]:  admin.firestore.FieldValue.increment(1),
      [`stats.${loserKey}.losses`]: admin.firestore.FieldValue.increment(1)
    });
  } catch (err) {
    if (err.code === 5 /* NOT_FOUND */) {
      await userStatsRef.set({
        stats: {
          [winnerKey]: { wins: 1, losses: 0 },
          [loserKey]:  { wins: 0, losses: 1 }
        }
      });
    }
    // Other errors are non-critical; the vote is recorded
  }

  return { success: true };
});

// ─────────────────────────────────────────────────────────────
// recordToughCallVote
//
// Records a community (The Crowd) vote for a tough-call matchup.
// Validates server-side: user hasn't voted, user isn't the creator.
//
// Request: { tcId: string, choice: "A"|"B" }
// Returns: { success: true, votesA: number, votesB: number, totalVotes: number }
// ─────────────────────────────────────────────────────────────

exports.recordToughCallVote = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to vote.");
  }

  const { tcId, choice } = request.data ?? {};
  if (!tcId || typeof tcId !== "string") {
    throw new HttpsError("invalid-argument", "tcId is required.");
  }
  if (choice !== "A" && choice !== "B") {
    throw new HttpsError("invalid-argument", "choice must be 'A' or 'B'.");
  }

  const uid = request.auth.uid;
  const db  = admin.firestore();

  // Load the toughCall doc
  const tcRef  = db.doc(`toughCalls/${tcId}`);
  const tcSnap = await tcRef.get();
  if (!tcSnap.exists) {
    throw new HttpsError("not-found", "Matchup not found.");
  }
  const tc = tcSnap.data();

  // Server-side: block creator/flagger from voting on their own submission
  if (tc.createdByUid === uid || (tc.flaggedBy && tc.flaggedBy[uid])) {
    throw new HttpsError("failed-precondition", "You cannot vote on your own submission.");
  }

  // Server-side: prevent double-voting
  const tcvId   = `${tcId}__${uid}`;
  const tcvSnap = await db.doc(`toughCallVotes/${tcvId}`).get();
  if (tcvSnap.exists) {
    throw new HttpsError("already-exists", "You have already voted on this matchup.");
  }

  const winnerKey = choice === "A" ? tc.movieAKey : tc.movieBKey;
  const loserKey  = choice === "A" ? tc.movieBKey : tc.movieAKey;
  const voteField = choice === "A" ? "votesA" : "votesB";

  // Atomic batch
  const batch = db.batch();

  batch.set(db.collection("votes").doc(), {
    winner:      winnerKey,
    loser:       loserKey,
    user:        uid,
    timestamp:   admin.firestore.FieldValue.serverTimestamp(),
    source:      "tough_call",
    toughCallId: tcId
  });

  batch.set(db.doc(`toughCallVotes/${tcvId}`), {
    toughCallId: tcId,
    uid,
    vote:    choice,
    votedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  batch.update(tcRef, {
    [voteField]: admin.firestore.FieldValue.increment(1),
    totalVotes:  admin.firestore.FieldValue.increment(1),
    lastVotedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  batch.set(db.doc("stats/global"), {
    [`stats.${winnerKey}.wins`]:  admin.firestore.FieldValue.increment(1),
    [`stats.${loserKey}.losses`]: admin.firestore.FieldValue.increment(1)
  }, { merge: true });

  batch.set(db.doc("stats/meta"), {
    totalVotes: admin.firestore.FieldValue.increment(1)
  }, { merge: true });

  await batch.commit();

  // Per-user stats
  const userStatsRef = db.doc(`stats/user_${uid}`);
  try {
    await userStatsRef.update({
      [`stats.${winnerKey}.wins`]:  admin.firestore.FieldValue.increment(1),
      [`stats.${loserKey}.losses`]: admin.firestore.FieldValue.increment(1)
    });
  } catch (err) {
    if (err.code === 5 /* NOT_FOUND */) {
      await userStatsRef.set({
        stats: {
          [winnerKey]: { wins: 1, losses: 0 },
          [loserKey]:  { wins: 0, losses: 1 }
        }
      });
    }
  }

  // Return updated counts so client can re-render without a re-fetch
  return {
    success:    true,
    votesA:     (tc.votesA    || 0) + (choice === "A" ? 1 : 0),
    votesB:     (tc.votesB    || 0) + (choice === "B" ? 1 : 0),
    totalVotes: (tc.totalVotes || 0) + 1
  };
});
