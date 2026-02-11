// loginStatus.js — Populates the membership card with auth info
import { auth, signOut } from "./firebase.js";

const ADMIN_EMAIL = "mjreardon62@gmail.com";

export function updateLoginStatus() {
  const memberName = document.getElementById("member-name");
  const memberLogout = document.getElementById("member-logout");
  const accountNavLink = document.querySelector('nav a[href="account.html"]');
  const adminNavLink = document.getElementById("admin-nav-link");

  auth.onAuthStateChanged((user) => {
    // Update the navigation link text
    if (accountNavLink) {
      accountNavLink.textContent = user ? "Your Account" : "Log In";
    }

    // Update the membership card
    if (memberName) {
      memberName.textContent = user ? user.email.split("@")[0].toUpperCase() : "GUEST";
    }

    if (memberLogout) {
      memberLogout.style.display = user ? "inline-block" : "none";
    }

    // Show admin link only for admin email
    if (adminNavLink) {
      adminNavLink.style.display = (user && user.email === ADMIN_EMAIL) ? "" : "none";
    }
  });

  // Wire the logout button on the card
  if (memberLogout) {
    memberLogout.addEventListener("click", async () => {
      try {
        await signOut();
      } catch (err) {
        console.error("[loginStatus] Logout failed:", err);
        alert("Logout failed: " + err.message);
      }
    });
  }
}

// Immediately run it
updateLoginStatus();
