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

// ——— Init ———
const firebaseConfig = { /* your config here */ };
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ——— Record a vote (always writes to /votes) ———
export async function recordVoteToFirestore(winnerKey, loserKey) {
  // 1) Per-user array (only when signed in)
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

  // 2) **Global** single-vote record
  const payload = { winner: winnerKey, timestamp: Date.now() };
  if (loserKey)    payload.loser = loserKey;
  if (auth.currentUser) payload.user = auth.currentUser.uid;

  // this must run every time
  try {
    await addDoc(collection(db, "votes"), payload);
  } catch (err) {
    console.error("Failed to write vote:", err);
    alert("Could not record your vote: " + err.message);
  }
}

// ——— Exports & UI wiring below (login/signup/logout) ———
// … your existing auth state–change handlers …
export { auth, db };
