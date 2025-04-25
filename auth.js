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
  addDoc,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// ——— Firebase Config ———
const firebaseConfig = {
  apiKey: "AIzaSyApkVMpbaHkUEZU0H8tW3vzxaM2DYxPdwM",
  authDomain: "sranker-f2642.firebaseapp.com",
  projectId: "sranker-f2642",
  storageBucket: "sranker-f2642.appspot.com",
  messagingSenderId: "601665183803",
  appId: "1:601665183803:web:705a2ebeeb43b672ef3c1e",
  measurementId: "G-JTG8MVCW64"
};

// ——— Init ———
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ——— Record a vote (always writes to /votes) ———
export async function recordVoteToFirestore(winnerKey, loserKey) {
  console.log("🎯 recordVoteToFirestore() called", { winnerKey, loserKey, user: auth.currentUser?.uid });

  // 1) Per-user array (only when signed in)
  if (auth.currentUser) {
    console.log(" → User signed in, updating user document");
    const userRef = doc(db, "users", auth.currentUser.uid);
    const snap    = await getDoc(userRef);
    if (!snap.exists()) {
      console.log(" → No user doc, creating new with votes array");
      await setDoc(userRef, { votes: [winnerKey], seen: [] });
    } else {
      console.log(" → Appending to user.votes array");
      await updateDoc(userRef, {
        votes: arrayUnion(winnerKey)
      });
    }
  } else {
    console.log(" → No user signed in, skipping user doc update");
  }

  // 2) Global vote record
  const payload = { winner: winnerKey, timestamp: Date.now() };
  if (loserKey)    payload.loser = loserKey;
  if (auth.currentUser) payload.user  = auth.currentUser.uid;

  console.log(" → Adding global vote document with payload:", payload);
  try {
    await addDoc(collection(db, "votes"), payload);
    console.log(" ✅ Global vote write succeeded");
  } catch (err) {
    console.error(" ❌ Global vote write failed:", err);
    alert("Could not record your vote: " + err.message);
  }
}

// ——— Auth UI functions ———
window.signUp = async function () {
  const email    = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCred = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Signed up:", userCred.user.email);
  } catch (err) {
    console.error("Signup error:", err.message);
  }
};

window.logIn = async function () {
  const email    = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    console.log("Logged in:", userCred.user.email);
  } catch (err) {
    console.error("Login error:", err.message);
  }
};

window.logOut = async function () {
  await signOut(auth);
  console.log("Logged out.");
};

// ——— Auth state listener ———
onAuthStateChanged(auth, user => {
  if (user) {
    console.log("User is signed in:", user.email);
  } else {
    console.log("No user logged in.");
  }
});

export { auth, db };

