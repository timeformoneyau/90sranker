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

// ✅ Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyApkVMpbaHkUEZU0H8tW3vzxaM2DYxPdwM",
  authDomain: "sranker-f2642.firebaseapp.com",
  projectId: "sranker-f2642",
  storageBucket: "sranker-f2642.appspot.com",
  messagingSenderId: "601665183803",
  appId: "1:601665183803:web:705a2ebeeb43b672ef3c1e",
  measurementId: "G-JTG8MVCW64"
};

// ✅ Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ✅ Optional login form logic (only runs if login page is loaded)
const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const signupTrigger = document.getElementById("signup-trigger");

if (loginForm && emailInput && passwordInput && loginButton && signupTrigger && logoutButton) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    const password = passwordInput.value;

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      alert("Login failed: " + err.message);
    }
  });

  signupTrigger.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = emailInput.value;
    const password = passwordInput.value;

    if (!email || !password) {
      alert("Please enter an email and password first.");
      return;
    }

    try {
      await createUserWithEmailAndPassword(auth, email, password);
      alert("Account created and logged in!");
    } catch (err) {
      alert("Sign up failed: " + err.message);
    }
  });

  logoutButton.addEventListener("click", async () => {
    await signOut(auth);
    location.reload();
  });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      logoutButton.classList.remove("hidden");
      loginForm.style.display = "none";
      signupTrigger.parentElement.style.display = "none";
    } else {
      logoutButton.classList.add("hidden");
      loginForm.style.display = "block";
      signupTrigger.parentElement.style.display = "block";
    }
  });
}

// ✅ Used by ranker.js to save votes
async function recordVoteToFirestore(winnerKey) {
  if (!auth.currentUser) return;

  const ref = doc(db, "users", auth.currentUser.uid);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    await setDoc(ref, {
      votes: [winnerKey],
      seen: []
    });
  } else {
    const data = snapshot.data();
    const currentVotes = Array.from(new Set([...(data.votes || []), winnerKey]));
    await updateDoc(ref, { votes: currentVotes });
  }
}

export { auth, db, recordVoteToFirestore };
