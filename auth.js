// auth.js
// ------------------------------------------------------------
//  Firebase initialisation + auth / Firestore helpers
// ------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// ----- Firebase config (for sranker-f2642) -------------------
const firebaseConfig = {
  apiKey:            "AIzaSyApkVMpbaHkUEZU0H8tW3vzxaM2DYxPdwM",
  authDomain:        "sranker-f2642.firebaseapp.com",
  projectId:         "sranker-f2642",
  storageBucket:     "sranker-f2642.appspot.com",
  messagingSenderId: "601665183803",
  appId:             "1:601665183803:web:705a2ebeeb43b672ef3c1e",
  measurementId:     "G-JTG8MVCW64"
};

// ----- Initialise Firebase services --------------------------
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// ------------------------------------------------------------
//  Helper – save a vote for the signed-in user
//  * Updates votes array on /users/{uid}
//  * Creates a new document under /votes
//  * Logs success/failure in the console
// ------------------------------------------------------------
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
      await setDoc(userRef, { votes: [] });
    }

    // Update user's personal votes
    await updateDoc(userRef, {
      votes: arrayUnion(winnerKey)
    });

    console.info("[vote-write] ✅ User vote saved:", winnerKey);

    // ===== Push vote to global /votes collection =====
    const globalVotesRef = collection(db, "votes");

    await addDoc(globalVotesRef, {
      winner: winnerKey,
      loser:  loserKey,
      user:   user.uid,
      timestamp: Date.now()
    });

    console.info("[vote-write] ✅ Global vote saved:", {
      winner: winnerKey,
      loser:  loserKey,
      user:   user.uid
    });

  } catch (err) {
    console.error("[vote-write] ❌ Firestore write failed", {
      code:    err.code,
      message: err.message,
      winnerKey
    });
  }
}

// ------------------------------------------------------------
//  Convenience auth wrappers
// ------------------------------------------------------------
export const signIn  = (e, p) => signInWithEmailAndPassword(auth, e, p);
export const signUp  = (e, p) => createUserWithEmailAndPassword(auth, e, p);
export const signOut = ()     => firebaseSignOut(auth);

// Hook other modules into auth-state changes
export const onAuth = (cb) => onAuthStateChanged(auth, cb);
