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

// ——— Record a vote to Firestore ———
//  • Writes one document per vote into "votes"
//  • Also keeps your per-user vote list for personal stats
async function recordVoteToFirestore(winnerKey) {
  if (!auth.currentUser) return;

  const userRef = doc(db, "users", auth.currentUser.uid);
  const snap    = await getDoc(userRef);

  // 1️⃣ Ensure the user's doc has a votes array
  if (!snap.exists()) {
    await setDoc(userRef, { votes: [winnerKey], seen: [] });
  } else {
    const data = snap.data();
    let existing = Array.isArray(data.votes) ? data.votes : [];
    // add only if new to per-user list
    if (!existing.includes(winnerKey)) {
      existing.push(winnerKey);
      await updateDoc(userRef, { votes: existing });
    }
  }

  // 2️⃣ Write an independent vote record for global history
  await addDoc(collection(db, "votes"), {
    user: auth.currentUser.uid,
    winner: winnerKey,
    timestamp: Date.now()
  });
}

// ——— Exports (rest of auth.js unchanged) ———
export { auth, db, recordVoteToFirestore };
// …plus your existing auth UI & onAuthStateChanged logic…
