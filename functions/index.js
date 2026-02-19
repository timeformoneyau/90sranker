// functions/index.js — The Rewind Room Cloud Functions
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions }   = require("firebase-functions/v2");
const { defineSecret }       = require("firebase-functions/params");
const admin                  = require("firebase-admin");
const nodemailer             = require("nodemailer");

admin.initializeApp();
setGlobalOptions({ region: "us-central1" });

// ─────────────────────────────────────────────────────────────
// Secrets (set via: firebase functions:secrets:set SECRET_NAME)
// ─────────────────────────────────────────────────────────────
// Required before first deploy:
//   firebase functions:secrets:set SMTP_HOST      # e.g. smtp.gmail.com
//   firebase functions:secrets:set SMTP_PORT      # e.g. 587
//   firebase functions:secrets:set SMTP_USER      # sender address
//   firebase functions:secrets:set SMTP_PASS      # app password / SMTP password
//
// For Gmail, generate an App Password at:
//   https://myaccount.google.com/apppasswords
// ─────────────────────────────────────────────────────────────

const SMTP_HOST = defineSecret("SMTP_HOST");
const SMTP_PORT = defineSecret("SMTP_PORT");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");

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

exports.createUserInvite = onCall(
  { secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS] },
  async (request) => {

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
        throw new HttpsError(
          "already-exists",
          "An account with this email already exists."
        );
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

    // 5. Send invite email
    try {
      const host = SMTP_HOST.value();
      const port = parseInt(SMTP_PORT.value() || "587", 10);
      const user = SMTP_USER.value();
      const pass = SMTP_PASS.value();

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from:    `"The Rewind Room" <${user}>`,
        to:      email,
        subject: "You've been invited to The Rewind Room",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1a2e">
            <h2 style="color:#1a1a2e">Welcome to The Rewind Room 🎬</h2>
            <p>You've been invited to join The Rewind Room — a community ranking the greatest 90s movies.</p>
            <p>Click the button below to set your password and activate your account:</p>
            <p style="text-align:center;margin:2em 0">
              <a href="${resetLink}"
                 style="background:#8b7a5e;color:#fff;padding:0.75em 1.5em;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">
                Set Your Password
              </a>
            </p>
            <p style="font-size:0.85em;color:#555">
              This link expires after 1 hour. If you weren't expecting this invitation, you can safely ignore this email.
            </p>
            <p style="font-size:0.75em;color:#999">
              Or copy this link into your browser:<br>${resetLink}
            </p>
          </div>
        `,
        text: [
          "Welcome to The Rewind Room!",
          "",
          "You've been invited to join. Click the link below to set your password:",
          resetLink,
          "",
          "This link expires after 1 hour.",
        ].join("\n"),
      });
    } catch (err) {
      // The user was created and the auth link was generated — don't delete the user.
      // The admin can trigger a manual password reset from the User Management panel.
      console.error("Email send failed:", err);
      throw new HttpsError(
        "internal",
        "User created but invite email failed to send. " +
        "Use 'Reset Password' in User Management to resend. Error: " + err.message
      );
    }

    // 6. Audit log
    try {
      await admin.firestore().collection("adminActions").add({
        action:          "userInvite",
        createdAt:       admin.firestore.FieldValue.serverTimestamp(),
        createdBy:       request.auth.uid,
        createdByEmail:  request.auth.token.email,
        targetEmail:     email,
        targetUid:       userRecord.uid,
        displayName:     (displayName || "").trim() || null,
        status:          "invited",
      });
    } catch (err) {
      // Audit log failure is non-fatal — the invite was already sent
      console.warn("Audit log write failed (non-fatal):", err);
    }

    return { success: true, uid: userRecord.uid };
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
