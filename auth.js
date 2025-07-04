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
const resetEmailInput   = document.getElementById('reset-email');
const userEmailDisplay  = document.getElementById('user-email');

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

// Immediate signup when clicking "Create one"
if (signupTrigger) {
  signupTrigger.addEventListener('click', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
      showStatus('Please enter your email and password first.', true);
      return;
    }

    if (password.length < 6) {
      showStatus('Password must be at least 6 characters long.', true);
      return;
    }

    try {
      await signUp(email, password);
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

// Normal login on form submit
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    try {
      await signIn(email, password);
      showStatus('Successfully logged in!');
    } catch (err) {
      console.error('Login failed', err);
      let errorMessage = 'Login failed: ';
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        errorMessage += 'Invalid email or password.';
      } else if (err.code === 'auth/invalid-email') {
        errorMessage += 'Please enter a valid email address.';
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
onAuth((user) => {
  if (loggedOutView && loggedInView) {
    if (user) {
      loggedOutView.classList.add("hidden");
      loggedInView.classList.remove("hidden");
      if (userEmailDisplay) {
        userEmailDisplay.textContent = `Logged in as ${user.email}`;
      }
    } else {
      loggedOutView.classList.remove("hidden");
      loggedInView.classList.add("hidden");
      // Make sure reset form is hidden when logged out
      if (resetPasswordForm) resetPasswordForm.classList.add('hidden');
      if (form) form.style.display = 'block';
    }
  }
});
