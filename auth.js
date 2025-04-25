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
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// ——— Your Firebase config ———
const firebaseConfig = {
  apiKey: "AIzaSyApkVMpbaHkUEZU0H8tW3vzxaM2DYxPdwM",
  authDomain: "sranker-f2642.firebaseapp.com",
  projectId: "sranker-f2642",
  storageBucket: "sranker-f2642.appspot.com",
  messagingSenderId: "601665183803",
  appId: "1:601665183803:web:705a2ebeeb43b672ef3c1e",
  measurementId: "G-JTG8MVCW64"
};

// ——— Initialize Firebase ———
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ——— Auth UI & state handling ———
const loginForm      = document.getElementById("login-form");
const emailInput     = document.getElementById("email");
const passwordInput  = document.getElementById("password");
const loginButton    = document.getElementById("login-button");
const logoutButton   = document.getElementById("logout-button");
const signupTrigger  = document.getElementById("signup-trigger");
const indicator      = document.getElementById("user-indicator");

if (loginForm && emailInput && passwordInput && loginButton && signupTrigger && logoutButton) {
  // Log in
  loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
    } catch (err) {
      alert("Login failed: " + err.message);
    }
  });

  // Sign up
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

  // Log out
  logoutButton.addEventListener("click", async () => {
    await signOut(auth);
    location.reload();
  });
}

// Update indicator & inline logout
onAuthStateChanged(auth, user => {
  // Toggle form vs logout button
  if (logoutButton) {
    logoutButton.classList.toggle("hidden", !user);
    if (loginForm)  loginForm.style.display   = user ? "none" : "block";
    if (signupTrigger) signupTrigger.parentElement.style.display = user ? "none" : "block";
  }

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
async function recordVoteToFirestore(winnerKey) {
  if (!auth.currentUser) return;
  const userRef = doc(db, "users", auth.currentUser.uid);
  const snap    = await getDoc(userRef);

  if (!snap.exists()) {
    // First vote ever
    await setDoc(userRef, {
      votes: [winnerKey],
      seen: []
    });
  } else {
    const data = snap.data();
    // Normalize any existing votes into an array
    let existingVotes = [];
    if (Array.isArray(data.votes)) {
      existingVotes = data.votes;
    } else if (data.votes && typeof data.votes === "object") {
      existingVotes = Object.keys(data.votes);
    }
    // Dedupe and append
    const updated = Array.from(new Set([...existingVotes, winnerKey]));
    await updateDoc(userRef, { votes: updated });
  }
}

// ——— Exports ———
export { auth, db, recordVoteToFirestore };
