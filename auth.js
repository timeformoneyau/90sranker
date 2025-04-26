// === auth.js ===
import { auth, db, doc, getDoc, setDoc, updateDoc } from './firebase.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

window.signUp = async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Signed up:", user.email);
    await syncLocalToCloud(user.uid);
  } catch (err) {
    console.error("Signup error:", err.message);
  }
};

window.logIn = async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    console.log("Logged in:", user.email);
    await syncLocalToCloud(user.uid);
  } catch (err) {
    console.error("Login error:", err.message);
  }
};

window.logOut = async () => {
  await signOut(auth);
  console.log("Logged out.");
};

async function syncLocalToCloud(uid) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  const localVotes = JSON.parse(localStorage.getItem("movieStats")) || {};
  const localTags  = JSON.parse(localStorage.getItem("movieTags")) || {};
  const localSeen  = JSON.parse(localStorage.getItem("unseenMovies")) || [];

  if (!snap.exists()) {
    await setDoc(userRef, { votes: localVotes, tags: localTags, seen: localSeen });
  } else {
    const data = snap.data();
    await updateDoc(userRef, {
      votes: { ...data.votes, ...localVotes },
      tags:  { ...data.tags,  ...localTags  },
      seen:  Array.from(new Set([...(data.seen || []), ...localSeen]))
    });
  }
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    console.log("User signed in:", user.email);
    // Pull cloud state into localStorage then reload UI
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      const currentVotes = JSON.parse(localStorage.getItem("movieStats")) || {};
      const currentTags  = JSON.parse(localStorage.getItem("movieTags")) || {};
      const currentSeen  = JSON.parse(localStorage.getItem("unseenMovies")) || [];
      localStorage.setItem("movieStats", JSON.stringify({ ...data.votes, ...currentVotes }));
      localStorage.setItem("movieTags",  JSON.stringify({ ...data.tags,  ...currentTags  }));
      localStorage.setItem("unseenMovies", JSON.stringify(Array.from(new Set([...(data.seen||[]), ...currentSeen]))));
      window.location.reload();
    }
  }
});
