// auth.js - Authentication for The Rewind Room

import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  arrayUnion,
  signIn,
  signUp,
  signOut,
  onAuth,
  resetPassword,
  serverTimestamp
} from "./firebase.js";

// ─────────────────────────────────────────────────────────────
// Vote helper (used by ranker.js via import)
// ─────────────────────────────────────────────────────────────

export async function recordVoteToFirestore(winnerKey, loserKey) {
  const user = auth.currentUser;
  if (!user) {
    console.warn("[vote-write] aborted – user not authenticated");
    return;
  }
  const userRef = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, { votes: [] }, { merge: true });
    }
    await updateDoc(userRef, { votes: arrayUnion(winnerKey) });

    const globalRef = collection(db, "votes");
    await addDoc(globalRef, {
      winner:    winnerKey,
      loser:     loserKey,
      user:      user.uid,
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.error("[vote-write] ❌ Firestore write failed", { code: err.code, message: err.message });
  }
}

// ─────────────────────────────────────────────────────────────
// Status messages
// ─────────────────────────────────────────────────────────────

function showStatus(message, isError = false) {
  const el = document.getElementById("status-message");
  if (!el) return;
  el.textContent = message;
  el.className = `status-message ${isError ? "status-error" : "status-success"}`;
  el.classList.remove("hidden");
  if (!isError) {
    setTimeout(() => el.classList.add("hidden"), 5000);
  }
}

function clearStatus() {
  const el = document.getElementById("status-message");
  if (el) el.classList.add("hidden");
}

// ─────────────────────────────────────────────────────────────
// DOM references
// ─────────────────────────────────────────────────────────────

const loginPanel          = document.getElementById("login-panel");
const signupPanel         = document.getElementById("signup-panel");
const resetPwPanel        = document.getElementById("reset-password-form");

const loginForm           = document.getElementById("login-form");
const signupForm          = document.getElementById("signup-form");
const resetForm           = document.getElementById("reset-form");

// Login panel inputs
const emailInput          = document.getElementById("email");
const passwordInput       = document.getElementById("password");
const loginButton         = document.getElementById("login-button");

// Signup panel inputs
const signupEmailInput    = document.getElementById("signup-email");
const signupPasswordInput = document.getElementById("signup-password");
const signupUsernameInput = document.getElementById("signup-username");

// Nav links
const signupTrigger       = document.getElementById("signup-trigger");
const backToLoginLink     = document.getElementById("back-to-login");
const forgotPasswordLink  = document.getElementById("forgot-password-link");
const backFromResetLink   = document.getElementById("back-to-login-from-reset");

// Reset panel input
const resetEmailInput     = document.getElementById("reset-email");

// Logged-in view
const logoutButton        = document.getElementById("logout-button");
const loggedOutView       = document.getElementById("account-logged-out");
const loggedInView        = document.getElementById("account-logged-in");
const userEmailDisplay    = document.getElementById("user-email");
const userUsernameDisplay = document.getElementById("user-username");

// ─────────────────────────────────────────────────────────────
// Panel navigation
// ─────────────────────────────────────────────────────────────

function showLoginPanel() {
  loginPanel?.classList.remove("hidden");
  signupPanel?.classList.add("hidden");
  resetPwPanel?.classList.add("hidden");
  clearStatus();
  emailInput?.focus();
}

function showSignupPanel() {
  loginPanel?.classList.add("hidden");
  signupPanel?.classList.remove("hidden");
  resetPwPanel?.classList.add("hidden");
  clearStatus();
  // Pre-fill email if the user already typed a valid address on the login panel
  if (signupEmailInput) {
    if (emailInput?.value.includes("@")) {
      signupEmailInput.value = emailInput.value;
      signupPasswordInput?.focus();
    } else {
      signupEmailInput.focus();
    }
  }
}

function showResetPanel() {
  loginPanel?.classList.add("hidden");
  signupPanel?.classList.add("hidden");
  resetPwPanel?.classList.remove("hidden");
  clearStatus();
  if (resetEmailInput) {
    if (emailInput?.value.includes("@")) resetEmailInput.value = emailInput.value;
    resetEmailInput.focus();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  emailInput?.focus();
  // Deep-link: account.html#signup opens the signup panel directly
  if (window.location.hash === "#signup") showSignupPanel();
});

if (signupTrigger)      signupTrigger.addEventListener("click",      (e) => { e.preventDefault(); showSignupPanel(); });
if (backToLoginLink)    backToLoginLink.addEventListener("click",    (e) => { e.preventDefault(); showLoginPanel(); });
if (forgotPasswordLink) forgotPasswordLink.addEventListener("click", (e) => { e.preventDefault(); showResetPanel(); });
if (backFromResetLink)  backFromResetLink.addEventListener("click",  (e) => { e.preventDefault(); showLoginPanel(); });

// ─────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateUsername(username) {
  if (!username)                                 return "Please enter a username.";
  if (username.length < 3 || username.length > 20) return "Username must be 3–20 characters.";
  if (!/^[a-zA-Z0-9_]+$/.test(username))        return "Username can only contain letters, numbers, and underscores.";
  return null;
}

function mapAuthError(err) {
  switch (err.code) {
    case "auth/email-already-in-use":  return "An account with this email already exists. Try logging in instead.";
    case "auth/invalid-email":         return "Please enter a valid email address.";
    case "auth/weak-password":         return "Password is too weak. Please use at least 6 characters.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":    return "Invalid email/username or password.";
    case "auth/too-many-requests":     return "Too many failed attempts. Please try again later or reset your password.";
    case "auth/network-request-failed": return "Network error. Please check your connection and try again.";
    default:                            return err.message || "An unexpected error occurred. Please try again.";
  }
}

// ─────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const emailOrUsername = emailInput.value.trim();
    const password        = passwordInput.value.trim();

    if (!emailOrUsername) { showStatus("Please enter your email or username.", true); return; }
    if (!password)         { showStatus("Please enter your password.", true); return; }

    let loginEmail = emailOrUsername;

    // Username login: look up the stored email
    if (!emailOrUsername.includes("@")) {
      try {
        const snap = await getDoc(doc(db, "usernames", emailOrUsername.toLowerCase()));
        if (!snap.exists()) { showStatus("Invalid username or password.", true); return; }
        loginEmail = snap.data().email;
      } catch (err) {
        console.error("Username lookup failed", err);
        showStatus("Login failed. Please try again.", true);
        return;
      }
    }

    if (loginButton) loginButton.disabled = true;
    try {
      await signIn(loginEmail, password);
      // onAuth listener handles the UI transition to logged-in state
    } catch (err) {
      console.error("Login failed", err);
      showStatus(mapAuthError(err), true);
    } finally {
      if (loginButton) loginButton.disabled = false;
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Signup
// ─────────────────────────────────────────────────────────────

if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email    = signupEmailInput?.value.trim() ?? "";
    const password = signupPasswordInput?.value.trim() ?? "";
    const username = signupUsernameInput?.value.trim() ?? "";

    // Client-side validation — catch the obvious problems before any network call
    if (!email)               { showStatus("Please enter your email address.", true); return; }
    if (!isValidEmail(email)) { showStatus("Please enter a valid email address.", true); return; }
    if (!password)            { showStatus("Please enter a password.", true); return; }
    if (password.length < 6)  { showStatus("Password must be at least 6 characters.", true); return; }
    const usernameError = validateUsername(username);
    if (usernameError)        { showStatus(usernameError, true); return; }

    const submitBtn = document.getElementById("signup-button");
    if (submitBtn) submitBtn.disabled = true;

    try {
      // Check username availability (unauthenticated read, before creating the account)
      const usernameDoc = await getDoc(doc(db, "usernames", username.toLowerCase()));
      if (usernameDoc.exists()) {
        showStatus("That username is already taken. Please choose another.", true);
        return;
      }

      // Create Firebase Auth user
      const cred = await signUp(email, password);

      // Write username to Firestore immediately after auth user is created.
      // The onAuth listener fires as soon as signUp resolves, but these awaited
      // writes complete before we yield back to the event loop, so the username
      // is in Firestore by the time any subsequent Firestore reads occur.
      await setDoc(doc(db, "usernames", username.toLowerCase()), {
        uid: cred.user.uid,
        email
      });
      await setDoc(doc(db, "users", cred.user.uid), { username }, { merge: true });

      // Proactively update the username display — the onAuth callback may have
      // already run and shown "No username set" before the writes above finished.
      if (userUsernameDisplay) userUsernameDisplay.textContent = `Username: ${username}`;
      showStatus("Account created! Welcome to The Rewind Room.");

    } catch (err) {
      console.error("Signup failed", err);
      showStatus(mapAuthError(err), true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Password reset
// ─────────────────────────────────────────────────────────────

if (resetForm) {
  resetForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = resetEmailInput.value.trim();
    if (!email)               { showStatus("Please enter your email address.", true); return; }
    if (!isValidEmail(email)) { showStatus("Please enter a valid email address.", true); return; }

    try {
      await resetPassword(email);
      showStatus("Password reset email sent! Check your inbox.");
      setTimeout(() => showLoginPanel(), 3000);
    } catch (err) {
      console.error("Password reset failed", err);
      let msg = "Failed to send reset email. ";
      if (err.code === "auth/user-not-found") msg += "No account found with this email.";
      else if (err.code === "auth/invalid-email") msg += "Please enter a valid email address.";
      else msg += err.message;
      showStatus(msg, true);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────────────────────

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await signOut();
    } catch (err) {
      console.error("Logout failed", err);
      showStatus("Logout failed: " + err.message, true);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Auth state listener
// ─────────────────────────────────────────────────────────────

onAuth(async (user) => {
  if (!loggedOutView || !loggedInView) return;

  if (user) {
    loggedOutView.classList.add("hidden");
    loggedInView.classList.remove("hidden");

    if (userEmailDisplay) userEmailDisplay.textContent = `Logged in as ${user.email}`;

    if (userUsernameDisplay) {
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const username = userDoc.exists() ? userDoc.data().username : null;
        userUsernameDisplay.textContent = username ? `Username: ${username}` : "No username set";
      } catch (err) {
        console.error("Failed to fetch username", err);
      }
    }
  } else {
    loggedOutView.classList.remove("hidden");
    loggedInView.classList.add("hidden");
    showLoginPanel();
    if (emailInput) emailInput.value = "";
    if (passwordInput) passwordInput.value = "";
  }
});
