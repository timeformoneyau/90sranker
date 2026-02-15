// loginStatus.js — Populates the account indicator with auth info + username overlay
import { auth, db, doc, getDoc, setDoc, signOut } from "./firebase.js";

const ADMIN_EMAIL = "mjreardon62@gmail.com";

function showUsernameOverlay(user) {
  // Don't show overlay if already present
  if (document.getElementById("username-overlay")) return;

  const backdrop = document.createElement("div");
  backdrop.id = "username-overlay";
  backdrop.className = "username-overlay-backdrop";
  backdrop.innerHTML = `
    <div class="username-overlay-modal">
      <h2 style="margin:0 0 0.5rem; color:var(--color-text-0); font-size:1.3rem;">Choose a Username</h2>
      <p style="color:var(--color-text-2); font-size:0.85rem; margin-bottom:1.25rem;">
        You need a username to continue. Pick something memorable!
      </p>
      <input type="text" id="overlay-username-input" placeholder="Username (3-20 chars, letters/numbers/_)" maxlength="20"
        style="width:100%; padding:0.75em; margin-bottom:0.75rem; border:2px solid var(--color-border);
        border-radius:6px; background:var(--color-bg-2); color:var(--color-text-0);
        font-family:'Space Grotesk',sans-serif; box-sizing:border-box;">
      <button id="overlay-username-submit"
        style="width:100%; padding:0.75em; font-weight:bold; background:var(--color-primary);
        color:#fff; border:none; border-radius:6px; cursor:pointer;
        font-family:'Space Grotesk',sans-serif; font-size:1rem;">
        Set Username
      </button>
      <div id="overlay-username-error" style="color:var(--color-error); font-size:0.85rem; margin-top:0.75rem; display:none;"></div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const input = document.getElementById("overlay-username-input");
  const submitBtn = document.getElementById("overlay-username-submit");
  const errorDiv = document.getElementById("overlay-username-error");

  input.focus();

  async function submitUsername() {
    const username = input.value.trim();

    // Validate
    if (!username) {
      errorDiv.textContent = "Please enter a username.";
      errorDiv.style.display = "block";
      return;
    }
    if (username.length < 3 || username.length > 20) {
      errorDiv.textContent = "Username must be 3-20 characters.";
      errorDiv.style.display = "block";
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      errorDiv.textContent = "Only letters, numbers, and underscores allowed.";
      errorDiv.style.display = "block";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Checking...";

    try {
      // Check uniqueness
      const usernameDoc = await getDoc(doc(db, "usernames", username.toLowerCase()));
      if (usernameDoc.exists()) {
        errorDiv.textContent = "That username is already taken. Try another.";
        errorDiv.style.display = "block";
        submitBtn.disabled = false;
        submitBtn.textContent = "Set Username";
        return;
      }

      // Save to both collections
      await setDoc(doc(db, "usernames", username.toLowerCase()), {
        uid: user.uid,
        email: user.email
      });
      await setDoc(doc(db, "users", user.uid), { username: username }, { merge: true });

      // Update account indicator
      updateAccountIndicator(username, user);

      // Remove overlay
      backdrop.remove();
    } catch (err) {
      console.error("Username save failed", err);
      errorDiv.textContent = "Failed to save username. Please try again.";
      errorDiv.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "Set Username";
    }
  }

  submitBtn.addEventListener("click", submitUsername);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitUsername();
  });
}

function removeUsernameOverlay() {
  const overlay = document.getElementById("username-overlay");
  if (overlay) overlay.remove();
}

function updateAccountIndicator(displayName, user) {
  const indicator = document.getElementById("account-indicator");
  if (!indicator) return;

  if (!user) {
    indicator.innerHTML = '';
    return;
  }

  // Determine member since year from metadata
  const createdAt = user.metadata?.creationTime;
  const memberYear = createdAt ? new Date(createdAt).getFullYear() : '';
  const metaText = memberYear ? `Member since ${memberYear}` : '';

  indicator.innerHTML = `
    <div class="account-indicator-name">${displayName}</div>
    <div class="account-indicator-meta">${metaText}</div>
    <button class="account-indicator-logout" id="indicator-logout">Log out</button>
  `;

  const logoutBtn = document.getElementById("indicator-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut();
      } catch (err) {
        console.error("[loginStatus] Logout failed:", err);
      }
    });
  }
}

export function updateLoginStatus() {
  const accountNavLink = document.querySelector('nav a[href="account.html"]');
  const adminNavLink = document.getElementById("admin-nav-link");

  auth.onAuthStateChanged(async (user) => {
    // Update the navigation link text
    if (accountNavLink) {
      accountNavLink.textContent = user ? "Your Account" : "Log In";
    }

    // Show admin link only for admin email
    if (adminNavLink) {
      adminNavLink.style.display = (user && user.email === ADMIN_EMAIL) ? "" : "none";
    }

    if (user) {
      // Fetch username from Firestore
      let username = null;
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        username = userDoc.exists() ? userDoc.data().username : null;
      } catch (err) {
        console.error("[loginStatus] Failed to fetch username:", err);
      }

      const displayName = username || user.email.split("@")[0];
      updateAccountIndicator(displayName, user);

      // If no username, show blocking overlay (except on account page)
      if (!username && !window.location.pathname.includes("account.html")) {
        showUsernameOverlay(user);
      }
    } else {
      updateAccountIndicator(null, null);
      removeUsernameOverlay();
    }
  });
}

// Immediately run it
updateLoginStatus();
