import { db, auth, onAuth, collection, getDocs, doc, getDoc, setDoc, deleteDoc, resetPassword, updateDoc, query, where, orderBy, serverTimestamp, callFunction } from "./firebase.js";
import { makeMovieKey, buildKeyNormalizer } from "./movieKeys.js";

// ==========================================
// ADMIN GATE
// ==========================================

const SUPER_ADMIN_EMAIL = "mjreardon62@gmail.com";

// ==========================================
// STATE
// ==========================================

let allMovies = [];
let fullData = [];   // { title, year, key, appearances, wins, losses, winPct, ratio }
let avgAppearances = 0;
let currentFilter = "all";
let currentSort = { key: "appearances", dir: -1 };
let currentUserIsSuperAdmin = false;
let currentUserUid = null;

function getMovieKey(m) {
  return makeMovieKey(m.title, m.year);
}

// ==========================================
// LOAD DATA
// ==========================================

window.onload = () => {
  const statusEl = document.getElementById("diag-status");
  const pageEl = document.querySelector(".diag-page");

  onAuth(async user => {
    const adminNav = document.getElementById("admin-nav-link");

    if (!user) {
      if (adminNav) adminNav.style.display = "none";
      statusEl.textContent = "";
      pageEl.innerHTML = '<h1>Access Denied</h1><p style="color:var(--color-text-2)">This page is restricted to admin users. <a href="index.html">Back to Home</a></p>';
      return;
    }

    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
    let isAdmin = isSuperAdmin;
    if (!isSuperAdmin) {
      try {
        const tokenResult = await user.getIdTokenResult();
        isAdmin = tokenResult.claims.admin === true;
      } catch (err) {
        console.error("Token check failed:", err);
        isAdmin = false;
      }
    }

    if (adminNav) adminNav.style.display = isAdmin ? "" : "none";

    if (!isAdmin) {
      statusEl.textContent = "";
      pageEl.innerHTML = '<h1>Access Denied</h1><p style="color:var(--color-text-2)">This page is restricted to admin users. <a href="index.html">Back to Home</a></p>';
      return;
    }

    currentUserIsSuperAdmin = isSuperAdmin;
    currentUserUid = user.uid;

    const toolsEl = document.getElementById("admin-tools");
    if (toolsEl) toolsEl.style.display = "";
    const inviteEl = document.getElementById("admin-invite");
    if (inviteEl) inviteEl.style.display = "";
    const usersEl = document.getElementById("admin-users");
    if (usersEl) usersEl.style.display = "";
    const requestsEl = document.getElementById("admin-requests");
    if (requestsEl) requestsEl.style.display = "";
    initInviteUser();
    loadDiagnostics();
    loadUserManagement();
    loadMovieRequests();
    const rebuildBtn = document.getElementById("rebuild-stats-btn");
    if (rebuildBtn) rebuildBtn.addEventListener("click", rebuildGlobalStats);
  });
};

async function loadDiagnostics() {
  const statusEl = document.getElementById("diag-status");

  try {
    // Load movie list + aggregate stats (2 doc reads instead of full votes scan)
    const [moviesRes, globalSnap, metaSnap] = await Promise.all([
      fetch("movie_list_cleaned.json"),
      getDoc(doc(db, "stats", "global")),
      getDoc(doc(db, "stats", "meta"))
    ]);

    const rawMovies = await moviesRes.json();
    allMovies = rawMovies.filter(m => m.title && m.year && !/^title$/i.test(m.title.trim()));

    const globalStats = globalSnap.exists() ? (globalSnap.data().stats || {}) : {};
    const totalVotes = metaSnap.exists() ? (metaSnap.data().totalVotes || 0) : 0;

    statusEl.textContent = `Loaded ${totalVotes.toLocaleString()} votes across ${allMovies.length} movies. Analyzing...`;

    // Build full data array from aggregate stats
    fullData = allMovies.map(movie => {
      const key = getMovieKey(movie);
      const s = globalStats[key] || {};
      const w = s.wins || 0;
      const l = s.losses || 0;
      const a = w + l; // appearances = wins + losses
      const wp = a > 0 ? (w / a) * 100 : 0;
      return {
        title: movie.title,
        year: movie.year,
        key,
        appearances: a,
        wins: w,
        losses: l,
        winPct: wp,
        ratio: 0 // filled below
      };
    });

    // Compute average appearances (only counting movies with >0)
    const withAppearances = fullData.filter(m => m.appearances > 0);
    const totalAppearances = fullData.reduce((s, m) => s + m.appearances, 0);
    avgAppearances = allMovies.length > 0 ? totalAppearances / allMovies.length : 0;

    fullData.forEach(m => {
      m.ratio = avgAppearances > 0 ? m.appearances / avgAppearances : 0;
    });

    // Render everything
    renderSummary(totalVotes, withAppearances.length);
    renderFairness();
    renderOverexposed();
    renderNeverShown();
    renderTable();
    setupControls();

    statusEl.textContent = `Analysis complete: ${totalVotes.toLocaleString()} votes, ${allMovies.length} movies, avg ${avgAppearances.toFixed(1)} appearances per movie.`;
  } catch (err) {
    console.error("Diagnostics error:", err);
    statusEl.textContent = "Error loading data: " + err.message;
  }
}

// ==========================================
// SUMMARY CARDS
// ==========================================

function renderSummary(totalVotes, moviesWithVotes) {
  const neverShown = fullData.filter(m => m.appearances === 0).length;
  const overexposed = fullData.filter(m => m.ratio > 2).length;
  const underexposed = fullData.filter(m => m.appearances > 0 && m.ratio < 0.5).length;
  const maxApp = Math.max(...fullData.map(m => m.appearances));
  const maxMovie = fullData.find(m => m.appearances === maxApp);
  const minNonZero = fullData.filter(m => m.appearances > 0);
  const minApp = minNonZero.length ? Math.min(...minNonZero.map(m => m.appearances)) : 0;

  // Gini coefficient for fairness
  const sorted = fullData.map(m => m.appearances).sort((a, b) => a - b);
  const n = sorted.length;
  let giniNum = 0;
  sorted.forEach((val, i) => { giniNum += (2 * (i + 1) - n - 1) * val; });
  const gini = n > 0 && totalVotes > 0 ? giniNum / (n * totalVotes) : 0;

  const el = document.getElementById("diag-summary");
  el.innerHTML = [
    card(totalVotes.toLocaleString(), "Total Votes"),
    card(allMovies.length, "Movies in Pool"),
    card(avgAppearances.toFixed(1), "Avg Appearances"),
    card(neverShown, "Never Shown"),
    card(overexposed, "Overexposed (>2x)"),
    card(underexposed, "Underexposed (<0.5x)"),
    card(maxMovie ? `${maxApp} (${maxMovie.title})` : "N/A", "Most Shown"),
    card(minApp, "Least Shown (non-zero)"),
    card((gini * 100).toFixed(1) + "%", "Gini Index (0=fair, 100=unfair)")
  ].join("");
}

function card(val, label) {
  return `<div class="diag-card"><div class="diag-card-val">${val}</div><div class="diag-card-label">${label}</div></div>`;
}

// ==========================================
// FAIRNESS GAUGE
// ==========================================

function renderFairness() {
  const el = document.getElementById("diag-fairness");
  const neverPct = allMovies.length > 0 ? (fullData.filter(m => m.appearances === 0).length / allMovies.length) * 100 : 0;
  const overPct = allMovies.length > 0 ? (fullData.filter(m => m.ratio > 2).length / allMovies.length) * 100 : 0;
  const coveragePct = allMovies.length > 0 ? (fullData.filter(m => m.appearances > 0).length / allMovies.length) * 100 : 0;

  // Coefficient of variation
  const mean = avgAppearances;
  const variance = fullData.reduce((s, m) => s + Math.pow(m.appearances - mean, 2), 0) / (fullData.length || 1);
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0;

  let verdict, verdictClass;
  if (neverPct > 20) {
    verdict = `${neverPct.toFixed(0)}% of movies have never been shown. The selection algorithm has significant blind spots.`;
    verdictClass = "bad";
  } else if (overPct > 15 || cv > 80) {
    verdict = `Distribution is skewed. ${overPct.toFixed(0)}% of movies appear more than 2x the average. The competitive match bias (top-third selection) is likely the cause.`;
    verdictClass = "warn";
  } else if (neverPct > 5) {
    verdict = `Mostly fair, but ${neverPct.toFixed(0)}% of movies still haven't appeared. More votes will help.`;
    verdictClass = "warn";
  } else {
    verdict = "Distribution looks healthy. All movies are getting exposure.";
    verdictClass = "good";
  }

  el.innerHTML = `
    <h3>Distribution Fairness</h3>
    ${bar("Coverage", coveragePct, 100, "#22c55e")}
    ${bar("Never Shown", neverPct, 100, "#ef4444")}
    ${bar("Overexposed", overPct, 100, "#eab308")}
    ${bar("CV (spread)", Math.min(cv, 200), 200, "#0044ee")}
    <div class="diag-verdict diag-verdict--${verdictClass}">${verdict}</div>
  `;
}

function bar(label, value, max, color) {
  const pct = Math.min((value / max) * 100, 100);
  return `
    <div class="diag-bar-wrap">
      <div class="diag-bar-label">${label}</div>
      <div class="diag-bar-track"><div class="diag-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="diag-bar-val">${value.toFixed(1)}%</div>
    </div>`;
}

// ==========================================
// OVEREXPOSED / NEVER SHOWN LISTS
// ==========================================

function renderOverexposed() {
  const over = fullData.filter(m => m.ratio > 2).sort((a, b) => b.ratio - a.ratio).slice(0, 15);
  const el = document.getElementById("over-list");
  if (!over.length) {
    el.innerHTML = '<div style="color:var(--color-text-2);font-style:italic">No overexposed movies found.</div>';
    return;
  }
  el.innerHTML = `<div class="diag-table-wrap"><table class="diag-table">
    <thead><tr><th>Title</th><th>Year</th><th class="num">Appearances</th><th class="num">vs Avg</th></tr></thead>
    <tbody>${over.map(m => `<tr><td>${m.title}</td><td>${m.year}</td><td class="num hot">${m.appearances}</td><td class="num hot">${m.ratio.toFixed(1)}x</td></tr>`).join("")}</tbody>
  </table></div>`;
}

function renderNeverShown() {
  const never = fullData.filter(m => m.appearances === 0).sort((a, b) => a.title.localeCompare(b.title));
  const el = document.getElementById("never-list");
  if (!never.length) {
    el.innerHTML = '<div style="color:var(--color-success)">All movies have been shown at least once.</div>';
    return;
  }
  el.innerHTML = `<div class="diag-table-wrap"><table class="diag-table">
    <thead><tr><th>Title</th><th>Year</th></tr></thead>
    <tbody>${never.map(m => `<tr class="faded"><td>${m.title}</td><td>${m.year}</td></tr>`).join("")}</tbody>
  </table></div>`;
}

// ==========================================
// FULL TABLE
// ==========================================

function renderTable() {
  const tbody = document.querySelector("#coverage-table tbody");
  tbody.innerHTML = "";

  let filtered = fullData;
  switch (currentFilter) {
    case "zero": filtered = fullData.filter(m => m.appearances === 0); break;
    case "hot": filtered = fullData.filter(m => m.ratio > 2); break;
    case "cold": filtered = fullData.filter(m => m.appearances > 0 && m.ratio < 0.5); break;
  }

  const { key, dir } = currentSort;
  filtered = filtered.slice().sort((a, b) => {
    let av = a[key], bv = b[key];
    if (typeof av === "string") return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });

  for (const m of filtered) {
    const tr = document.createElement("tr");
    if (m.appearances === 0) tr.classList.add("faded");

    const ratioClass = m.ratio > 2 ? "hot" : m.ratio < 0.5 && m.appearances > 0 ? "cold" : "";
    tr.innerHTML = `
      <td>${m.title}</td>
      <td>${m.year}</td>
      <td class="num">${m.appearances}</td>
      <td class="num">${m.wins}</td>
      <td class="num">${m.losses}</td>
      <td class="num">${m.appearances > 0 ? m.winPct.toFixed(1) + "%" : "--"}</td>
      <td class="num ${ratioClass}">${m.appearances > 0 ? m.ratio.toFixed(2) + "x" : "--"}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ==========================================
// CONTROLS
// ==========================================

function setupControls() {
  // Filter buttons
  const filters = { "filter-all": "all", "filter-zero": "zero", "filter-hot": "hot", "filter-cold": "cold" };
  for (const [id, val] of Object.entries(filters)) {
    document.getElementById(id).addEventListener("click", () => {
      currentFilter = val;
      document.querySelectorAll(".diag-controls button").forEach(b => b.classList.remove("active"));
      document.getElementById(id).classList.add("active");
      renderTable();
    });
  }

  // Sort by clicking column headers
  document.querySelectorAll("#coverage-table th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (currentSort.key === key) {
        currentSort.dir *= -1;
      } else {
        currentSort = { key, dir: key === "title" || key === "year" ? 1 : -1 };
      }
      renderTable();
    });
  });

  // Export CSV
  document.getElementById("export-csv").addEventListener("click", () => {
    let csv = "Title,Year,Appearances,Wins,Losses,Win%,vsAvg\n";
    for (const m of fullData) {
      csv += `"${m.title}","${m.year}",${m.appearances},${m.wins},${m.losses},${m.winPct.toFixed(1)},${m.ratio.toFixed(2)}\n`;
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "movie_coverage_diagnostics.csv";
    link.click();
  });
}

// ==========================================
// INVITE USER
// ==========================================

function initInviteUser() {
  const btn      = document.getElementById("invite-send-btn");
  const statusEl = document.getElementById("invite-status");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const email       = (document.getElementById("invite-email")?.value ?? "").trim();
    const displayName = (document.getElementById("invite-display-name")?.value ?? "").trim();

    if (!email) {
      statusEl.textContent = "Please enter an email address.";
      statusEl.style.color = "var(--color-error)";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      statusEl.textContent = "Please enter a valid email address.";
      statusEl.style.color = "var(--color-error)";
      return;
    }

    btn.disabled    = true;
    btn.textContent = "Sending…";
    statusEl.textContent = "";

    try {
      const createUserInvite = callFunction("createUserInvite");
      await createUserInvite({ email, displayName });
      statusEl.textContent = `✓ Invite sent to ${email}`;
      statusEl.style.color = "var(--color-success)";
      document.getElementById("invite-email").value        = "";
      document.getElementById("invite-display-name").value = "";
      // Refresh user list so the new account appears
      loadUserManagement();
    } catch (err) {
      console.error("Invite failed:", err);
      // err.message from an HttpsError includes the developer message
      statusEl.textContent = "Error: " + (err.message || "Failed to send invite.");
      statusEl.style.color = "var(--color-error)";
    } finally {
      btn.disabled    = false;
      btn.textContent = "Send Invite";
    }
  });
}

// ==========================================
// USER MANAGEMENT
// ==========================================

async function loadUserManagement() {
  const statusEl = document.getElementById("users-status");
  const tbody = document.getElementById("users-tbody");

  if (!tbody) return;
  statusEl.textContent = "Loading users...";

  try {
    const [usersSnap, usernamesSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "usernames"))
    ]);

    // Build username lookup (uid -> { docId, email })
    const usernamesByUid = {};
    usernamesSnap.forEach(d => {
      const data = d.data();
      usernamesByUid[data.uid] = { docId: d.id, email: data.email };
    });

    // Build user rows
    const userEntries = [];
    usersSnap.forEach(d => {
      const data = d.data();
      userEntries.push({ uid: d.id, data, usernameInfo: usernamesByUid[d.id] });
    });

    // Fetch all user stats docs in parallel (1 read per registered user)
    const statsSnaps = await Promise.all(
      userEntries.map(u => getDoc(doc(db, "stats", `user_${u.uid}`)))
    );

    const users = userEntries.map((u, i) => {
      const statsData = statsSnaps[i].exists() ? (statsSnaps[i].data().stats || {}) : {};
      let votes = 0;
      for (const key in statsData) {
        votes += (statsData[key].wins || 0);
      }
      return {
        uid: u.uid,
        username: u.data.username || null,
        email: u.usernameInfo?.email || u.data.email || "unknown",
        votes,
        usernameDocId: u.usernameInfo?.docId || null,
        isAdmin: u.data.isAdmin === true
      };
    });

    users.sort((a, b) => b.votes - a.votes);

    statusEl.textContent = `${users.length} registered user${users.length !== 1 ? 's' : ''}`;

    tbody.innerHTML = "";
    for (const u of users) {
      const tr = document.createElement("tr");
      const usernameDisplay = u.username
        ? `<span class="admin-username-text">${escapeHtml(u.username)}</span>`
        : `<span style="color:var(--color-error); font-style:italic;">(none)</span>`;

      const isSelf = u.uid === currentUserUid;

      // Admin column: badge + toggle button (super-admin only, not for self)
      let adminCellHtml = "";
      if (u.isAdmin) {
        adminCellHtml += `<span class="admin-badge">★ Admin</span>`;
      }
      if (currentUserIsSuperAdmin && !isSelf) {
        adminCellHtml += u.isAdmin
          ? `<button class="admin-btn admin-btn-remove-admin" data-uid="${u.uid}" data-is-admin="true">Remove</button>`
          : `<button class="admin-btn admin-btn-make-admin" data-uid="${u.uid}" data-is-admin="false">Make Admin</button>`;
      }

      tr.innerHTML = `
        <td class="admin-username-cell" data-uid="${u.uid}" data-current="${escapeHtml(u.username || '')}" data-doc-id="${u.usernameDocId || ''}">${usernameDisplay}
          <button class="admin-btn admin-btn-edit" title="${u.username ? 'Edit' : 'Assign'} username">${u.username ? 'Edit' : 'Assign'}</button>
        </td>
        <td class="admin-email-cell" data-uid="${u.uid}" data-current="${escapeHtml(u.email)}">
          <span class="admin-email-text">${escapeHtml(u.email)}</span>
          <button class="admin-btn admin-btn-edit-email" title="Edit email">Edit</button>
        </td>
        <td class="num">${u.votes}</td>
        <td class="admin-role-cell">${adminCellHtml}</td>
        <td>
          <button class="admin-btn admin-btn-reset" data-email="${escapeHtml(u.email)}">Reset Pw</button>
          <button class="admin-btn admin-btn-danger" data-uid="${u.uid}"${isSelf ? ' disabled title="Cannot delete yourself"' : ""}>Delete</button>
          <span class="admin-action-status"></span>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Wire up username edit buttons
    tbody.querySelectorAll(".admin-btn-edit").forEach(btn => {
      btn.addEventListener("click", handleEditUsername);
    });

    // Wire up email edit buttons
    tbody.querySelectorAll(".admin-btn-edit-email").forEach(btn => {
      btn.addEventListener("click", handleEditEmail);
    });

    // Wire up reset password buttons
    tbody.querySelectorAll(".admin-btn-reset").forEach(btn => {
      btn.addEventListener("click", handleResetPassword);
    });

    // Wire up delete buttons
    tbody.querySelectorAll(".admin-btn-danger").forEach(btn => {
      btn.addEventListener("click", handleDeleteUser);
    });

    // Wire up admin toggle buttons
    tbody.querySelectorAll(".admin-btn-make-admin, .admin-btn-remove-admin").forEach(btn => {
      btn.addEventListener("click", handleToggleAdmin);
    });

  } catch (err) {
    console.error("User management error:", err);
    statusEl.textContent = "Error loading users: " + err.message;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function handleEditUsername(e) {
  const cell = e.target.closest(".admin-username-cell");
  const uid = cell.dataset.uid;
  const currentUsername = cell.dataset.current;
  const currentDocId = cell.dataset.docId;

  // Replace cell content with input
  const input = document.createElement("input");
  input.type = "text";
  input.value = currentUsername;
  input.placeholder = "Enter username";
  input.maxLength = 20;
  input.style.cssText = "width:120px; padding:4px 6px; font-size:0.8rem; background:var(--color-bg-2); border:1px solid var(--color-accent); border-radius:4px; color:var(--color-text-0); font-family:inherit;";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.className = "admin-btn admin-btn-save";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "admin-btn admin-btn-cancel";

  const errorSpan = document.createElement("span");
  errorSpan.style.cssText = "color:var(--color-error); font-size:0.75rem; display:block; margin-top:4px;";

  cell.innerHTML = "";
  cell.appendChild(input);
  cell.appendChild(saveBtn);
  cell.appendChild(cancelBtn);
  cell.appendChild(errorSpan);
  input.focus();

  cancelBtn.addEventListener("click", () => {
    restoreUsernameCell(cell, currentUsername, currentDocId);
  });

  saveBtn.addEventListener("click", async () => {
    const newUsername = input.value.trim();

    // Validate
    if (!newUsername) {
      errorSpan.textContent = "Username cannot be empty.";
      return;
    }
    if (newUsername.length < 3 || newUsername.length > 20) {
      errorSpan.textContent = "Must be 3-20 characters.";
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(newUsername)) {
      errorSpan.textContent = "Letters, numbers, underscores only.";
      return;
    }

    // Skip if unchanged
    if (newUsername.toLowerCase() === currentUsername.toLowerCase() && newUsername === currentUsername) {
      restoreUsernameCell(cell, currentUsername, currentDocId);
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      // Check uniqueness (unless same lowercase)
      if (newUsername.toLowerCase() !== currentUsername.toLowerCase()) {
        const existingDoc = await getDoc(doc(db, "usernames", newUsername.toLowerCase()));
        if (existingDoc.exists()) {
          errorSpan.textContent = "Username already taken.";
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
          return;
        }
      }

      // Get email for the new username doc
      const row = cell.closest("tr");
      const emailCell = row.querySelector(".admin-email-cell");
      const email = emailCell ? emailCell.dataset.current : "";

      // Update users/{uid}.username
      await setDoc(doc(db, "users", uid), { username: newUsername }, { merge: true });

      // Delete old username doc if it exists
      if (currentDocId) {
        await deleteDoc(doc(db, "usernames", currentDocId));
      }

      // Create new username doc
      await setDoc(doc(db, "usernames", newUsername.toLowerCase()), {
        uid: uid,
        email: email
      });

      // Update cell state
      cell.dataset.current = newUsername;
      cell.dataset.docId = newUsername.toLowerCase();
      restoreUsernameCell(cell, newUsername, newUsername.toLowerCase());
    } catch (err) {
      console.error("Username update failed:", err);
      errorSpan.textContent = "Save failed: " + err.message;
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });
}

function restoreUsernameCell(cell, username, docId) {
  const usernameDisplay = username
    ? `<span class="admin-username-text">${escapeHtml(username)}</span>`
    : `<span style="color:var(--color-error); font-style:italic;">(none)</span>`;

  cell.innerHTML = `${usernameDisplay}
    <button class="admin-btn admin-btn-edit" title="${username ? 'Edit' : 'Assign'} username">${username ? 'Edit' : 'Assign'}</button>`;
  cell.dataset.current = username || '';
  cell.dataset.docId = docId || '';

  cell.querySelector(".admin-btn-edit").addEventListener("click", handleEditUsername);
}

function handleEditEmail(e) {
  const cell = e.target.closest(".admin-email-cell");
  const uid = cell.dataset.uid;
  const currentEmail = cell.dataset.current;

  const input = document.createElement("input");
  input.type = "email";
  input.value = currentEmail;
  input.placeholder = "Enter email";
  input.style.cssText = "width:160px; padding:4px 6px; font-size:0.8rem; background:var(--color-bg-2); border:1px solid var(--color-accent); border-radius:4px; color:var(--color-text-0); font-family:inherit;";

  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.className = "admin-btn admin-btn-save";

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "admin-btn admin-btn-cancel";

  const errorSpan = document.createElement("span");
  errorSpan.style.cssText = "color:var(--color-error); font-size:0.75rem; display:block; margin-top:4px;";

  cell.innerHTML = "";
  cell.appendChild(input);
  cell.appendChild(saveBtn);
  cell.appendChild(cancelBtn);
  cell.appendChild(errorSpan);
  input.focus();

  cancelBtn.addEventListener("click", () => {
    restoreEmailCell(cell, currentEmail);
  });

  saveBtn.addEventListener("click", async () => {
    const newEmail = input.value.trim();
    if (!newEmail) {
      errorSpan.textContent = "Email cannot be empty.";
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      errorSpan.textContent = "Please enter a valid email address.";
      return;
    }
    if (newEmail === currentEmail) {
      restoreEmailCell(cell, currentEmail);
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      const updateUserEmailFn = callFunction("updateUserEmail");
      await updateUserEmailFn({ uid, newEmail });

      // Also update the Reset Password button's data-email in this row
      const row = cell.closest("tr");
      const resetBtn = row.querySelector(".admin-btn-reset");
      if (resetBtn) resetBtn.dataset.email = newEmail;

      cell.dataset.current = newEmail;
      restoreEmailCell(cell, newEmail);
    } catch (err) {
      console.error("Email update failed:", err);
      errorSpan.textContent = "Save failed: " + (err.message || "Unknown error");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });
}

function restoreEmailCell(cell, email) {
  cell.innerHTML = `<span class="admin-email-text">${escapeHtml(email)}</span>
    <button class="admin-btn admin-btn-edit-email" title="Edit email">Edit</button>`;
  cell.dataset.current = email;
  cell.querySelector(".admin-btn-edit-email").addEventListener("click", handleEditEmail);
}

async function handleDeleteUser(e) {
  const btn = e.target;
  const uid = btn.dataset.uid;
  const row = btn.closest("tr");
  const usernameCell = row.querySelector(".admin-username-cell");
  const username = usernameCell ? usernameCell.dataset.current : "";

  if (!window.confirm(`Delete user "${username || uid}"? This cannot be undone.`)) return;

  btn.disabled = true;
  btn.textContent = "Deleting...";

  try {
    const deleteUserFn = callFunction("deleteUser");
    await deleteUserFn({ uid });
    row.remove();
  } catch (err) {
    console.error("Delete user failed:", err);
    const statusSpan = row.querySelector(".admin-action-status");
    if (statusSpan) {
      statusSpan.textContent = "Delete failed: " + (err.message || "Unknown error");
      statusSpan.style.color = "var(--color-error)";
      setTimeout(() => { statusSpan.textContent = ""; }, 4000);
    }
    btn.disabled = false;
    btn.textContent = "Delete";
  }
}

async function handleToggleAdmin(e) {
  const btn = e.target;
  const uid = btn.dataset.uid;
  const currentIsAdmin = btn.dataset.isAdmin === "true";
  const newIsAdmin = !currentIsAdmin;

  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const setAdminRoleFn = callFunction("setAdminRole");
    await setAdminRoleFn({ uid, isAdmin: newIsAdmin });

    // Update the role cell in-place
    const row = btn.closest("tr");
    const roleCell = row.querySelector(".admin-role-cell");
    if (roleCell) {
      roleCell.innerHTML = newIsAdmin
        ? `<span class="admin-badge">★ Admin</span><button class="admin-btn admin-btn-remove-admin" data-uid="${uid}" data-is-admin="true">Remove</button>`
        : `<button class="admin-btn admin-btn-make-admin" data-uid="${uid}" data-is-admin="false">Make Admin</button>`;
      roleCell.querySelectorAll(".admin-btn-make-admin, .admin-btn-remove-admin").forEach(b => {
        b.addEventListener("click", handleToggleAdmin);
      });
    }

    showToast(
      newIsAdmin
        ? "Admin role granted — user must re-login to take effect."
        : "Admin role revoked — user must re-login to take effect."
    );
  } catch (err) {
    console.error("Toggle admin failed:", err);
    btn.disabled = false;
    btn.textContent = currentIsAdmin ? "Remove" : "Make Admin";
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "admin-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.classList.add("admin-toast--visible"); });
  setTimeout(() => {
    toast.classList.remove("admin-toast--visible");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

async function handleResetPassword(e) {
  const btn = e.target;
  const email = btn.dataset.email;
  const statusSpan = btn.parentElement.querySelector(".admin-action-status");

  btn.disabled = true;
  btn.textContent = "Sending...";

  try {
    await resetPassword(email);
    statusSpan.textContent = "Sent!";
    statusSpan.style.color = "var(--color-success)";
    btn.textContent = "Reset Password";
    btn.disabled = false;
    setTimeout(() => { statusSpan.textContent = ""; }, 3000);
  } catch (err) {
    console.error("Password reset failed:", err);
    statusSpan.textContent = "Failed";
    statusSpan.style.color = "var(--color-error)";
    btn.textContent = "Reset Password";
    btn.disabled = false;
    setTimeout(() => { statusSpan.textContent = ""; }, 3000);
  }
}

// ==========================================
// REBUILD GLOBAL STATS (ADMIN)
// ==========================================

async function rebuildGlobalStats() {
  const statusEl = document.getElementById("rebuild-status");
  if (!statusEl) return;

  if (!window.confirm(
    "Rebuild stats/global from all votes?\n\n" +
    "This scans every vote document and recomputes wins/losses from scratch, " +
    "normalizing old-format keys (e.g. 'Title Year') to canonical 'Title|Year'. " +
    "Use this when rankings look wrong. It may take a few seconds."
  )) return;

  statusEl.textContent = "Loading movie list for key normalization…";
  statusEl.style.color = "var(--color-accent)";

  // Build key normalizer from the canonical movie list so old-format keys
  // ("Title Year") get merged into canonical "Title|Year" entries.
  let normalizeKey = (k) => k; // identity fallback if list fails to load
  try {
    const res = await fetch("movie_list_cleaned.json");
    const movieList = await res.json();
    const filtered = movieList.filter(m => m.title && m.year && !/^title$/i.test(m.title.trim()));
    normalizeKey = buildKeyNormalizer(filtered);
  } catch (err) {
    console.warn("Could not load movie list (keys will not be normalized):", err);
  }

  statusEl.textContent = "Reading all votes…";

  try {
    const votesSnap = await getDocs(collection(db, "votes"));

    // Tally wins/losses per normalized movie key (merges old + new key formats)
    const stats = {};
    votesSnap.forEach(d => {
      const { winner, loser } = d.data();
      const w = winner ? normalizeKey(winner) : null;
      const l = loser  ? normalizeKey(loser)  : null;
      if (w) {
        if (!stats[w]) stats[w] = { wins: 0, losses: 0 };
        stats[w].wins++;
      }
      if (l) {
        if (!stats[l]) stats[l] = { wins: 0, losses: 0 };
        stats[l].losses++;
      }
    });

    // Overwrite stats/global with rebuilt data (merge:true preserves other doc fields)
    await setDoc(doc(db, "stats", "global"), { stats }, { merge: true });

    const movieCount = Object.keys(stats).length;
    statusEl.textContent = `✓ Rebuilt from ${votesSnap.size} votes across ${movieCount} movies. Reload the Voting Results page to see updated rankings.`;
    statusEl.style.color = "var(--color-success)";
  } catch (err) {
    console.error("Rebuild failed:", err);
    statusEl.textContent = "Error: " + err.message;
    statusEl.style.color = "var(--color-error)";
  }
}

// ==========================================
// MOVIE REQUESTS (ADMIN)
// ==========================================

let allRequests = [];
let requestFilter = "new";

async function loadMovieRequests() {
  const statusEl = document.getElementById("requests-status");
  const tbody = document.getElementById("requests-tbody");
  if (!tbody) return;

  statusEl.textContent = "Loading requests...";

  try {
    const q = query(collection(db, "movieRequests"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    allRequests = [];
    snap.forEach(d => {
      allRequests.push({ id: d.id, ...d.data() });
    });

    statusEl.textContent = `${allRequests.length} request${allRequests.length !== 1 ? "s" : ""} total`;
    renderRequests();
    setupRequestFilters();
  } catch (err) {
    console.error("Movie requests error:", err);
    statusEl.textContent = "Error loading requests: " + err.message;
  }
}

function renderRequests() {
  const tbody = document.getElementById("requests-tbody");
  tbody.innerHTML = "";

  const filtered = requestFilter === "all"
    ? allRequests
    : allRequests.filter(r => r.status === requestFilter);

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--color-text-2); font-style:italic;">No ${requestFilter === "all" ? "" : requestFilter + " "}requests.</td></tr>`;
    return;
  }

  for (const r of filtered) {
    const tr = document.createElement("tr");
    const date = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleDateString() : "—";
    const badgeColor = {
      new: "var(--color-accent)",
      reviewing: "var(--color-warning)",
      accepted: "var(--color-success)",
      rejected: "var(--color-error)"
    }[r.status] || "var(--color-text-2)";

    tr.innerHTML = `
      <td>${escapeHtml(r.requestText)}</td>
      <td>${escapeHtml(r.userDisplayName || "unknown")}</td>
      <td>${date}</td>
      <td><span style="color:${badgeColor}; font-weight:700; text-transform:uppercase; font-size:0.7rem;">${escapeHtml(r.status)}</span></td>
      <td class="req-actions" data-id="${r.id}">
        ${r.status !== "accepted" ? `<button class="admin-btn req-btn" data-action="accepted">Accept</button>` : ""}
        ${r.status !== "rejected" ? `<button class="admin-btn req-btn" data-action="rejected">Reject</button>` : ""}
        ${r.status !== "reviewing" ? `<button class="admin-btn req-btn" data-action="reviewing">Reviewing</button>` : ""}
      </td>
    `;
    tbody.appendChild(tr);
  }

  // Wire up action buttons
  tbody.querySelectorAll(".req-btn").forEach(btn => {
    btn.addEventListener("click", handleRequestAction);
  });
}

async function handleRequestAction(e) {
  const btn = e.target;
  const newStatus = btn.dataset.action;
  const cell = btn.closest(".req-actions");
  const reqId = cell.dataset.id;

  btn.disabled = true;
  btn.textContent = "...";

  try {
    await updateDoc(doc(db, "movieRequests", reqId), {
      status: newStatus,
      updatedAt: serverTimestamp()
    });

    // Update local data
    const req = allRequests.find(r => r.id === reqId);
    if (req) req.status = newStatus;
    renderRequests();
  } catch (err) {
    console.error("Request update failed:", err);
    btn.disabled = false;
    btn.textContent = btn.dataset.action === "accepted" ? "Accept" : btn.dataset.action === "rejected" ? "Reject" : "Reviewing";
  }
}

function setupRequestFilters() {
  const filterMap = {
    "req-filter-new": "new",
    "req-filter-reviewing": "reviewing",
    "req-filter-accepted": "accepted",
    "req-filter-rejected": "rejected",
    "req-filter-all": "all"
  };

  for (const [id, val] of Object.entries(filterMap)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.addEventListener("click", () => {
      requestFilter = val;
      document.querySelectorAll("#req-filters button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderRequests();
    });
  }
}
