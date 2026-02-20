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

  // Clear previous content — safe, no user data involved
  while (indicator.firstChild) indicator.removeChild(indicator.firstChild);

  if (!user) return;

  // Determine member since year from metadata
  const createdAt = user.metadata?.creationTime;
  const memberYear = createdAt ? new Date(createdAt).getFullYear() : '';

  // Build DOM nodes — textContent prevents any HTML injection from displayName
  const nameEl = document.createElement("div");
  nameEl.className = "account-indicator-name";
  nameEl.textContent = displayName;

  const metaEl = document.createElement("div");
  metaEl.className = "account-indicator-meta";
  metaEl.textContent = memberYear ? `Member since ${memberYear}` : '';

  const logoutBtn = document.createElement("button");
  logoutBtn.className = "account-indicator-logout";
  logoutBtn.id = "indicator-logout";
  logoutBtn.textContent = "Log out";
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut();
    } catch (err) {
      console.error("[loginStatus] Logout failed:", err);
    }
  });

  indicator.appendChild(nameEl);
  indicator.appendChild(metaEl);
  indicator.appendChild(logoutBtn);
}

// ─────────────────────────────────────────────────────────────
// GUEST CONVERSION BANNER
//
// Passive (< 5 votes): slim bottom banner, session-dismissible.
// Urgent (≥ 5 votes): same banner with personalised copy + CTA,
//   permanently dismissible via localStorage.
//
// The banner links directly to account.html#signup (handled by
// auth.js's DOMContentLoaded hash check).
// ─────────────────────────────────────────────────────────────

const GUEST_VOTE_THRESHOLD = 5;

function showGuestBanner() {
  // Never show on the account page — user is already there to sign up
  if (window.location.pathname.includes("account.html")) return;
  // Don't mount twice
  if (document.getElementById("guest-banner")) return;

  const count = parseInt(localStorage.getItem("guestVoteCount") || "0", 10);
  const isUrgent = count >= GUEST_VOTE_THRESHOLD;

  // Respect dismiss state
  if (isUrgent  && localStorage.getItem("guestBannerDismissed") === "1") return;
  if (!isUrgent && sessionStorage.getItem("guestBannerDismissed") === "1") return;

  const banner = document.createElement("div");
  banner.id = "guest-banner";
  banner.className = "guest-banner" + (isUrgent ? " guest-banner--urgent" : "");

  if (isUrgent) {
    banner.innerHTML = `
      <span class="guest-banner-text">
        <a href="account.html#signup" class="guest-banner-link">Create a free account</a>
        to save your voting history and unlock personalized recommendations.
      </span>
      <a href="account.html#signup" class="guest-banner-cta">Save My Rankings</a>
      <button class="guest-banner-dismiss" aria-label="Dismiss">Maybe Later</button>
    `;
  } else {
    banner.innerHTML = `
      <span class="guest-banner-text">
        <a href="account.html#signup" class="guest-banner-link">Create a free account</a>
        to save your voting history and unlock personalized recommendations.
      </span>
      <button class="guest-banner-dismiss" aria-label="Dismiss">&#x2715;</button>
    `;
  }

  const nav = document.querySelector("nav");
  if (nav) {
    nav.insertAdjacentElement("afterend", banner);
  } else {
    document.body.insertAdjacentElement("afterbegin", banner);
  }

  banner.querySelector(".guest-banner-dismiss").addEventListener("click", () => {
    banner.remove();
    if (isUrgent) {
      localStorage.setItem("guestBannerDismissed", "1");
    } else {
      sessionStorage.setItem("guestBannerDismissed", "1");
    }
  });
}

// When the guest crosses the vote threshold mid-session, upgrade the banner live.
window.addEventListener("guestVoteThresholdReached", () => {
  const existing = document.getElementById("guest-banner");
  if (existing) existing.remove();
  // Clear session dismiss so the urgent version can mount
  sessionStorage.removeItem("guestBannerDismissed");
  showGuestBanner();
});

export function updateLoginStatus() {
  const accountNavLink = document.querySelector('nav a[href="account.html"]');
  const adminNavLink = document.getElementById("admin-nav-link");

  auth.onAuthStateChanged(async (user) => {
    // Update the navigation link text
    if (accountNavLink) {
      accountNavLink.textContent = user ? "Your Account" : "Log In";
    }

    // Show admin link for super-admin email; also check custom claims for granted admins
    if (adminNavLink) {
      if (user && user.email === ADMIN_EMAIL) {
        adminNavLink.style.display = "";
      } else if (user) {
        try {
          const tokenResult = await user.getIdTokenResult();
          adminNavLink.style.display = tokenResult.claims.admin === true ? "" : "none";
        } catch {
          adminNavLink.style.display = "none";
        }
      } else {
        adminNavLink.style.display = "none";
      }
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
      showGuestBanner();
    }
  });
}

// Immediately run it
updateLoginStatus();
