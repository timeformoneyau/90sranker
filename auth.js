// auth.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// === Firebase Config ===
const firebaseConfig = {
  apiKey: "AIzaSyApkVMpbaHkUEZU0H8tW3vzxaM2DYxPdwM",
  authDomain: "sranker-f2642.firebaseapp.com",
  projectId: "sranker-f2642",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// === Auth Functions ===

window.signUp = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Signed up:", userCred.user.email);
    await syncLocalToCloud(userCred.user.uid);
  } catch (err) {
    console.error("Signup error:", err.message);
  }
};

window.logIn = async function () {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    console.log("Logged in:", userCred.user.email);
    await syncLocalToCloud(userCred.user.uid);
  } catch (err) {
    console.error("Login error:", err.message);
  }
};

window.logOut = async function () {
  await signOut(auth);
  console.log("Logged out.");
};

// === Sync LocalStorage to Firestore ===

async function syncLocalToCloud(uid) {
  const ref = doc(db, "users", uid);
  const snapshot = await getDoc(ref);

  const localVotes = JSON.parse(localStorage.getItem("movieStats")) || {};
  const localTags = JSON.parse(localStorage.getItem("movieTags")) || {};
  const localSeen = JSON.parse(localStorage.getItem("unseenMovies")) || [];

  if (!snapshot.exists()) {
    await setDoc(ref, {
      votes: localVotes,
      tags: localTags,
      seen: localSeen
    });
  } else {
    const data = snapshot.data();
    await updateDoc(ref, {
      votes: { ...data.votes, ...localVotes },
      tags: { ...data.tags, ...localTags },
      seen: Array.from(new Set([...(data.seen || []), ...localSeen]))
    });
  }
}

// === On Auth State Change ===
onAuthStateChanged(auth, async user => {
  if (user) {
    console.log("User is signed in:", user.email);
    // Optional: Load their data into localStorage or UI
  } else {
    console.log("No user logged in.");
  }
});

export { auth, db };
