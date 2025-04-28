// auth.js (COMPLETE and FINAL)

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

// Cache DOM elements
const form           = document.getElementById('login-form');
const loginButton    = document.getElementById('login-button');
const signupTrigger  = document.getElementById('signup-trigger');
const logoutButton   = document.getElementById('logout-button');
const loggedOutView  = document.getElementById('account-logged-out');
const loggedInView   = document.getElementById('account-logged-in');
const emailInput     = document.getElementById('email');
const passwordInput  = document.getElementById('password');

// Autofocus email field on page load
window.addEventListener('DOMContentLoaded', () => {
  emailInput.focus();
});

// Immediate signup when clicking "Create one"
signupTrigger.addEventListener('click', async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !password) {
    alert('Please enter your email and password first.');
    return;
  }

  try {
    await signUp(email, password);
    alert('Account created successfully! You are now logged in.');
  } catch (err) {
    console.error('Signup failed', err);
    alert('Signup failed: ' + err.message);
  }
});

// Normal login on form submit
if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    try {
      await signIn(email, password);
    } catch (err) {
      console.error('Login failed', err);
      alert('Login failed: ' + err.message);
    }
  });
}

// Logout handler
if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    try {
      await signOut();
      emailInput.value = "";
      passwordInput.value = "";
    } catch (err) {
      console.error('Logout failed', err);
      alert('Logout failed: ' + err.message);
    }
  });
}

// Auth state listener
onAuth((user) => {
  if (loggedOutView && loggedInView) {
    if (user) {
      loggedOutView.classList.add("hidden");
      loggedInView.classList.remove("hidden");
    } else {
      loggedOutView.classList.remove("hidden");
      loggedInView.classList.add("hidden");
    }
  }
});
