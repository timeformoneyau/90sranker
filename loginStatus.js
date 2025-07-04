// loginStatus.js - Updated to fix navigation
import { auth, signOut } from "./firebase.js";

export function updateLoginStatus() {
  const loginStatusDiv = document.getElementById("login-status");
  const accountNavLink = document.querySelector('nav a[href="account.html"]');
  
  if (!loginStatusDiv && !accountNavLink) {
    console.warn("[loginStatus] No login-status div or account nav link found on this page.");
    return;
  }

  auth.onAuthStateChanged((user) => {
    // Update the navigation link text
    if (accountNavLink) {
      if (user) {
        accountNavLink.textContent = "Your Account";
      } else {
        accountNavLink.textContent = "Log In";
      }
    }

    // Update the login status area (keep existing logout button functionality)
    if (loginStatusDiv) {
      if (user) {
        loginStatusDiv.innerHTML = `
          <span style="color: #1fd2ea; margin-left: 1em;">Welcome, ${user.email.split('@')[0]}</span>
          <button id="logout-btn" style="margin-left: 0.5em; padding: 0.3em 0.8em; background-color: #8b5cf6; color: white; border: none; border-radius: 4px; cursor: pointer;">Log Out</button>
        `;
        const logoutButton = document.getElementById("logout-btn");
        logoutButton.addEventListener("click", async () => {
          try {
            await signOut();
            // Don't reload - let the auth state change handle the UI update
          } catch (err) {
            console.error("[loginStatus] Logout failed:", err);
            alert("Logout failed: " + err.message);
          }
        });
      } else {
        loginStatusDiv.innerHTML = "";
      }
    }
  });
}

// Immediately run it
updateLoginStatus();
