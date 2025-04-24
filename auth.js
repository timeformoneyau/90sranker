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
  const email = document.getElementById("email").value.toLowerCase();
  const password = document.getElementById("password").value;

  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Signed up:", userCred.user.email);
    await syncLocalToCloud(userCred.user.uid);
    await loadVotesFromCloud(userCred.user.uid);
    window.location.reload();
  } catch (err) {
    console.error("Signup error:", err.message);
  }
};

window.logIn = async function () {
  const email = document.getElementById("email").value.toLowerCase();
  const password = document.getElementById("password").value;

  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    console.log("Logged in:", userCred.user.email);
    await syncLocalToCloud(userCred.user.uid);
    await loadVotesFromCloud(userCred.user.uid);
    window.location.reload();
  } catch (err) {
    console.error("Login error:", err.message);
  }
};

window.logOut = async function () {
  await signOut(auth);
  console.log("Logged out.");
  window.location.reload();
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

// === Load Firestore into localStorage ===

async function loadVotesFromCloud(uid) {
  const ref = doc(db, "users", uid);
  const snapshot = await getDoc(ref);

  if (snapshot.exists()) {
    const data = snapshot.data();

    localStorage.setItem("movieStats", JSON.stringify(data.votes || {}));
    localStorage.setItem("movieTags", JSON.stringify(data.tags || {}));
    localStorage.setItem("unseenMovies", JSON.stringify(data.seen || []));
  }
}

// === Record a Vote to Firestore (exported for use in ranker.js) ===

async function recordVoteToFirestore(movieKey) {
  const user = auth.currentUser;
  if (!user) return;

  const ref = doc(db, "users", user.uid);
  const snapshot = await getDoc(ref);

  if (snapshot.exists()) {
    const data = snapshot.data();
    const currentVotes = data.votes || {};
    currentVotes[movieKey] = (currentVotes[movieKey] || 0) + 1;

    await updateDoc(ref, { votes: currentVotes });
  }
}

// === Auth State Change Hook ===

onAuthStateChanged(auth, async user => {
  const authBox = document.querySelector(".auth-box");
  const userInfo = document.querySelector(".user-info");

  if (user) {
    console.log("User is signed in:", user.email);
    await loadVotesFromCloud(user.uid);
    if (authBox) authBox.style.display = "none";
    if (userInfo) {
      userInfo.innerHTML = `
        <p style="margin-bottom: 0.5rem;">Welcome, <strong>${user.email}</strong></p>
        <button onclick="logOut()">Log Out</button>
      `;
      userInfo.style.display = "block";
    }
  } else {
    console.log("No user logged in.");
    if (authBox) authBox.style.display = "block";
    if (userInfo) userInfo.style.display = "none";
  }
});

export { auth, db, recordVoteToFirestore };
