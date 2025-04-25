// auth.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// ——— Firebase config & initialization ———
const firebaseConfig = {
  apiKey: "AIzaSyApkVMpbaHkUEZU0H8tW3vzxaM2DYxPdwM",
  authDomain: "sranker-f2642.firebaseapp.com",
  projectId: "sranker-f2642",
  storageBucket: "sranker-f2642.appspot.com",
  messagingSenderId: "601665183803",
  appId: "1:601665183803:web:705a2ebeeb43b672ef3c1e",
  measurementId: "G-JTG8MVCW64"
};
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ——— DOM elements for login/logout UI ———
const loginForm     = document.getElementById("login-form");
const emailInput    = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton   = document.getElementById("login-button");
const logoutButton  = document.getElementById("logout-button");
const signupTrigger = document.getElementById("signup-trigger");
const indicator     = document.getElementById("user-indicator");

// ——— Login form submission ———
if (loginForm) {
  loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
    } catch (err) {
      alert("Login failed: " + err.message);
    }
  });
}

// ——— Sign-up click handler ———
if (signupTrigger) {
  signupTrigger.addEventListener("click", async e => {
    e.preventDefault();
    if (!emailInput.value || !passwordInput.value) {
      return alert("Please enter an email and password first.");
    }
    try {
      await createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
      alert("Account created and logged in!");
    } catch (err) {
      alert("Sign up failed: " + err.message);
    }
  });
}

// ——— Logout button ———
if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    await signOut(auth);
    location.reload();
  });
}

// ——— Update UI on auth state change ———
onAuthStateChanged(auth, user => {
  // Toggle login form vs logout button
  if (loginForm)     loginForm.style.display    = user ? "none" : "block";
  if (signupTrigger) signupTrigger.parentElement.style.display = user ? "none" : "block";
  if (logoutButton)  logoutButton.classList.toggle("hidden", !user);

  // Upper-right indicator
  if (!indicator) return;
  if (user) {
    indicator.innerHTML = `
      <span style="font-size:0.8rem;color:#ccc;">${user.email}</span>
      <button id="logout-inline" style="margin-left:0.5em;font-size:0.75rem;">Log Out</button>
    `;
    document.getElementById("logout-inline")
            ?.addEventListener("click", () => signOut(auth).then(() => location.reload()));
  } else {
    indicator.innerHTML = `<a href="account.html" style="font-size:0.8rem;color:#1fd2ea;">Log In</a>`;
  }
});

// ——— Record a vote to Firestore ———
//  • Always writes a doc into /votes for the global tally
//  • If logged in, also updates users/{uid}.votes array
export async function recordVoteToFirestore(winnerKey, loserKey) {
  // 1️⃣ Per-user array (only when signed in)
  if (auth.currentUser) {
    const userRef = doc(db, "users", auth.currentUser.uid);
    const snap    = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, { votes: [winnerKey], seen: [] });
    } else {
      const data     = snap.data();
      const existing = Array.isArray(data.votes) ? data.votes : [];
      if (!existing.includes(winnerKey)) {
        existing.push(winnerKey);
        await updateDoc(userRef, { votes: existing });
      }
    }
  }

  // 2️⃣ Global per-vote record
  const payload = { winner: winnerKey, timestamp: Date.now() };
  if (loserKey) payload.loser = loserKey;
  if (auth.currentUser) payload.user = auth.currentUser.uid;
  await addDoc(collection(db, "votes"), payload);
}

// ——— Exports for other modules ———
export { auth, db };
