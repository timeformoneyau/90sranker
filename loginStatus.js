import { auth, signOut } from "./firebase.js";

function setupLoginStatus() {
  const loginStatusDiv = document.getElementById("login-status");
  if (!loginStatusDiv) {
    console.warn("[loginStatus] No login-status div found on this page.");
    return;
  }

  auth.onAuthStateChanged((user) => {
    if (user) {
      loginStatusDiv.innerHTML = `
        <button id="logout-btn" style="margin-left: 1em;">Log Out</button>
      `;
      const logoutButton = document.getElementById("logout-btn");
      logoutButton.addEventListener("click", async () => {
        try {
          await signOut(auth);
          location.reload(); // Refresh to reflect logout status
        } catch (err) {
          console.error("[loginStatus] Logout failed:", err);
          alert("Logout failed: " + err.message);
        }
      });
    } else {
      loginStatusDiv.innerHTML = `
        <a href="account.html" style="margin-left: 1em;">Sign In</a>
      `;
    }
  });
}

// Immediately run it
setupLoginStatus();
