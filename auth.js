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
      await setDoc(userRef, { votes: [] }, { merge: true });
    }

    await updateDoc(userRef, {
      votes: arrayUnion(winnerKey)
    });
    console.info("[vote-write] ✅ User vote saved:", winnerKey);

    const globalRef = collection(db, "votes");
    await addDoc(globalRef, {
      winner:    winnerKey,
      loser:     loserKey,
      user:      user.uid,
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

// Grab DOM elements
const loginForm          = document.getElementById("login-form");
const logoutButton       = document.getElementById("logout-button");
const accountLoggedOut   = document.getElementById("account-logged-out");
const accountLoggedIn    = document.getElementById("account-logged-in");
const welcomeMessage     = document.getElementById("welcome-message");
const memberSince        = document.getElementById("member-since");
const viewStatsButton    = document.getElementById("view-stats");

// Login handler
eventListenerLogic: if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value.trim();
    try {
      await signIn(email, password);
      console.log("[auth] ✅ Login successful");
      accountLoggedOut.classList.add("hidden");
      accountLoggedIn.classList.remove("hidden");
      welcomeMessage.textContent = `Welcome, ${email}!`;
      memberSince.textContent = "";
    } catch (err) {
      console.error("[auth] ❌ Login failed:", err.message);
      alert("Login failed: " + err.message);
    }
  });
}

// Logout handler
if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    try {
      await signOut();
      console.log("[auth] ✅ Logged out");
      accountLoggedOut.classList.remove("hidden");
      accountLoggedIn.classList.add("hidden");
    } catch (err) {
      console.error("[auth] ❌ Logout failed:", err.message);
      alert("Logout failed: " + err.message);
    }
  });
}

// Auth state listener
onAuth((user) => {
  if (user) {
    accountLoggedOut.classList.add("hidden");
    accountLoggedIn.classList.remove("hidden");
    welcomeMessage.textContent = `Welcome, ${user.email}!`;
    memberSince.textContent = "";
    if (viewStatsButton) {
      viewStatsButton.addEventListener("click", () => {
        window.location.href = "my-stats.html";
      });
    }
  } else {
    accountLoggedOut.classList.remove("hidden");
    accountLoggedIn.classList.add("hidden");
  }
});
