import { auth, signOut } from "./firebase.js";

export function updateLoginStatus() {
  const statusDiv = document.getElementById("login-status");
  if (!statusDiv) return;
  
  auth.onAuthStateChanged(user => {
    if (user) {
      statusDiv.innerHTML = `
        <button id="logout-btn" style="margin-left: 1em;">Log Out</button>
      `;
      document.getElementById("logout-btn").addEventListener("click", async () => {
        await signOut(auth);
        location.reload(); // Reload to refresh visible state
      });
    } else {
      statusDiv.innerHTML = `
        <a href="account.html" style="margin-left: 1em;">Sign In</a>
      `;
    }
  });
}
