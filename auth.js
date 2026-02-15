// auth.js - Updated with password reset functionality

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

// ✅ Helper – save a vote for the signed-in user
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
    console.info("[vote-write] ✅ User vote saved:", winnerKey);

    const globalRef = collection(db, "votes");
    await addDoc(globalRef, {
      winner:    winnerKey,
      loser:     loserKey,
      user:      user.uid,
      timestamp: serverTimestamp()
    });
    console.info("[vote-write] ✅ Global vote saved:", { winnerKey, loserKey });
  } catch (err) {
    console.error("[vote-write] ❌ Firestore write failed", {
      code:    err.code,
      message: err.message
    });
  }
}

// Helper function to show status messages
function showStatus(message, isError = false) {
  const statusDiv = document.getElementById('status-message');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.className = `status-message ${isError ? 'status-error' : 'status-success'}`;
    statusDiv.classList.remove('hidden');
    
    // Auto-hide success messages after 5 seconds
    if (!isError) {
      setTimeout(() => {
        statusDiv.classList.add('hidden');
      }, 5000);
    }
  }
}

// Cache DOM elements
const form              = document.getElementById('login-form');
const resetForm         = document.getElementById('reset-form');
const loginButton       = document.getElementById('login-button');
const signupTrigger     = document.getElementById('signup-trigger');
const logoutButton      = document.getElementById('logout-button');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const backToLoginLink   = document.getElementById('back-to-login');
const loggedOutView     = document.getElementById('account-logged-out');
const loggedInView      = document.getElementById('account-logged-in');
const resetPasswordForm = document.getElementById('reset-password-form');
const emailInput        = document.getElementById('email');
const passwordInput     = document.getElementById('password');
const usernameInput     = document.getElementById('username');
const resetEmailInput   = document.getElementById('reset-email');
const userEmailDisplay  = document.getElementById('user-email');
const userUsernameDisplay = document.getElementById('user-username');
const signupFields      = document.getElementById('signup-fields');

// Autofocus email field on page load
window.addEventListener('DOMContentLoaded', () => {
  if (emailInput) emailInput.focus();
});

// Show/hide password reset form
if (forgotPasswordLink) {
  forgotPasswordLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (form) form.style.display = 'none';
    if (resetPasswordForm) resetPasswordForm.classList.remove('hidden');
    if (resetEmailInput) {
      resetEmailInput.value = emailInput ? emailInput.value : '';
      resetEmailInput.focus();
    }
  });
}

if (backToLoginLink) {
  backToLoginLink.addEventListener('click', (e) => {
    e.preventDefault();
    if (form) form.style.display = 'block';
    if (resetPasswordForm) resetPasswordForm.classList.add('hidden');
    if (emailInput) emailInput.focus();
  });
}

// Password reset form handler
if (resetForm) {
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = resetEmailInput.value.trim();

    if (!email) {
      showStatus('Please enter your email address.', true);
      return;
    }

    try {
      await resetPassword(email);
      showStatus('Password reset email sent! Check your inbox and follow the instructions to reset your password.');
      // Go back to login form after successful reset email
      setTimeout(() => {
        if (form) form.style.display = 'block';
        if (resetPasswordForm) resetPasswordForm.classList.add('hidden');
      }, 2000);
    } catch (err) {
      console.error('Password reset failed', err);
      let errorMessage = 'Failed to send reset email. ';
      if (err.code === 'auth/user-not-found') {
        errorMessage += 'No account found with this email address.';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage += 'Please enter a valid email address.';
      } else {
        errorMessage += err.message;
      }
      showStatus(errorMessage, true);
    }
  });
}

// Username validation helper
function validateUsername(username) {
  if (!username) return 'Please enter a username.';
  if (username.length < 3 || username.length > 20) return 'Username must be 3-20 characters.';
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return 'Username can only contain letters, numbers, and underscores.';
  return null;
}

// Signup flow: first click shows username field, second click creates account
let signupMode = false;

if (signupTrigger) {
  signupTrigger.addEventListener('click', async (e) => {
    e.preventDefault();

    // First click: reveal the username field and switch to signup mode
    if (!signupMode) {
      signupMode = true;
      if (signupFields) signupFields.classList.remove('hidden');
      if (usernameInput) usernameInput.focus();
      signupTrigger.textContent = 'Create Account';
      if (loginButton) loginButton.textContent = 'Back to Log In';
      return;
    }

    // Second click: perform signup
    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();
    const username = usernameInput ? usernameInput.value.trim() : '';

    if (!email || !password) {
      showStatus('Please enter your email and password.', true);
      return;
    }

    if (password.length < 6) {
      showStatus('Password must be at least 6 characters long.', true);
      return;
    }

    const usernameError = validateUsername(username);
    if (usernameError) {
      showStatus(usernameError, true);
      return;
    }

    // Check username uniqueness
    try {
      const usernameDoc = await getDoc(doc(db, "usernames", username.toLowerCase()));
      if (usernameDoc.exists()) {
        showStatus('That username is already taken. Please choose another.', true);
        return;
      }
    } catch (err) {
      console.error('Username check failed', err);
      showStatus('Error checking username availability. Please try again.', true);
      return;
    }

    try {
      const cred = await signUp(email, password);
      // Save username to both collections
      await setDoc(doc(db, "usernames", username.toLowerCase()), {
        uid: cred.user.uid,
        email: email
      });
      await setDoc(doc(db, "users", cred.user.uid), { username: username }, { merge: true });
      showStatus('Account created successfully! You are now logged in.');
    } catch (err) {
      console.error('Signup failed', err);
      let errorMessage = 'Account creation failed: ';
      if (err.code === 'auth/email-already-in-use') {
        errorMessage += 'An account with this email already exists. Try logging in instead.';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage += 'Please enter a valid email address.';
      } else if (err.code === 'auth/weak-password') {
        errorMessage += 'Password is too weak. Please choose a stronger password.';
      } else {
        errorMessage += err.message;
      }
      showStatus(errorMessage, true);
    }
  });
}

// Normal login on form submit (supports email or username)
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // If in signup mode, clicking "Back to Log In" resets to login mode
    if (signupMode) {
      signupMode = false;
      if (signupFields) signupFields.classList.add('hidden');
      if (usernameInput) usernameInput.value = '';
      signupTrigger.textContent = 'Create one';
      if (loginButton) loginButton.textContent = 'Log In';
      return;
    }

    const emailOrUsername = emailInput.value.trim();
    const password = passwordInput.value.trim();

    let loginEmail = emailOrUsername;

    // If no @ sign, treat as username and look up the email
    if (!emailOrUsername.includes('@')) {
      try {
        const usernameDoc = await getDoc(doc(db, "usernames", emailOrUsername.toLowerCase()));
        if (!usernameDoc.exists()) {
          showStatus('Invalid username or password.', true);
          return;
        }
        loginEmail = usernameDoc.data().email;
      } catch (err) {
        console.error('Username lookup failed', err);
        showStatus('Login failed. Please try again.', true);
        return;
      }
    }

    try {
      await signIn(loginEmail, password);
      showStatus('Successfully logged in!');
    } catch (err) {
      console.error('Login failed', err);
      let errorMessage = 'Login failed: ';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        errorMessage += 'Invalid email/username or password.';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage += 'Please enter a valid email address or username.';
      } else if (err.code === 'auth/too-many-requests') {
        errorMessage += 'Too many failed attempts. Please try again later.';
      } else {
        errorMessage += err.message;
      }
      showStatus(errorMessage, true);
    }
  });
}

// Logout handler
if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    try {
      await signOut();
      if (emailInput) emailInput.value = "";
      if (passwordInput) passwordInput.value = "";
      showStatus('Successfully logged out.');
    } catch (err) {
      console.error('Logout failed', err);
      showStatus('Logout failed: ' + err.message, true);
    }
  });
}

// Auth state listener
onAuth(async (user) => {
  if (loggedOutView && loggedInView) {
    if (user) {
      loggedOutView.classList.add("hidden");
      loggedInView.classList.remove("hidden");
      if (userEmailDisplay) {
        userEmailDisplay.textContent = `Logged in as ${user.email}`;
      }
      // Fetch and display username
      if (userUsernameDisplay) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          const username = userDoc.exists() ? userDoc.data().username : null;
          userUsernameDisplay.textContent = username ? `Username: ${username}` : 'No username set';
        } catch (err) {
          console.error('Failed to fetch username', err);
        }
      }
    } else {
      loggedOutView.classList.remove("hidden");
      loggedInView.classList.add("hidden");
      // Reset signup mode when logged out
      signupMode = false;
      if (signupFields) signupFields.classList.add('hidden');
      if (signupTrigger) signupTrigger.textContent = 'Create one';
      if (loginButton) loginButton.textContent = 'Log In';
      // Make sure reset form is hidden when logged out
      if (resetPasswordForm) resetPasswordForm.classList.add('hidden');
      if (form) form.style.display = 'block';
    }
  }
});
