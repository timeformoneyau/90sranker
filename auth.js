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

// ——— Firebase config & init ———
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

// ——— Record a vote ———
//
//  • Always adds one doc to /votes for the global tally.
//  • If signed in, also upserts the user’s own votes array.
//
export async function recordVoteToFirestore(winnerKey, loserKey) {
  // 1️⃣ Per-user array (only if logged in)
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
  //    We include loserKey (if supplied) so you can fully backfill Elo later.
  const payload = {
    winner:    winnerKey,
    timestamp: Date.now()
  };
  if (loserKey)  payload.loser = loserKey;
  if (auth.currentUser) payload.user = auth.currentUser.uid;

  await addDoc(collection(db, "votes"), payload);
}

// ——— Exports for the rest of your app ———
export { auth, db };

// ——— (the rest of your auth UI & onAuthStateChanged code) ———
// … unchanged from what you already had …
