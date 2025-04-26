// auth.js
import { auth, db, doc, getDoc, setDoc, updateDoc, collection, addDoc, arrayUnion,
         signIn, signUp, signOut, onAuth } from "./firebase.js";

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
    await updateDoc(userRef, { votes: arrayUnion(winnerKey) });
    console.info("[vote-write] ✅ User vote saved:", winnerKey);

    const globalRef = collection(db, "votes");
    await addDoc(globalRef, {
      winner: winnerKey,
      loser: loserKey,
      user: user.uid,
      timestamp: Date.now()
    });
    console.info("[vote-write] ✅ Global vote saved:", { winnerKey, loserKey });
  } catch (err) {
    console.error("[vote-write] ❌ Firestore write failed", err);
  }
}

// Export auth utilities
export { auth, db, signIn, signUp, signOut, onAuth };
