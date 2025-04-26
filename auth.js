// auth.js
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

// Helper – save a vote for the signed-in user
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
      // Create the doc if it doesn't exist
      await setDoc(userRef, { votes: [] }, { merge: true });
    }

    // Update user's personal votes
    await updateDoc(userRef, {
      votes: arrayUnion(winnerKey)
    });
    console.info("[vote-write] ✅ User vote saved:", winnerKey);

    // Push vote to global /votes collection with server-side timestamp
    const globalRef = collection(db, "votes");
    await addDoc(globalRef, {
      winner:   winnerKey,
      loser:    loserKey,
      user:     user.uid,
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

// Export auth utilities
export { auth, db, signIn, signUp, signOut, onAuth };
