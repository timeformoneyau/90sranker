import { db, auth, onAuth, collection, getDocs, doc, getDoc, setDoc, deleteDoc, resetPassword } from "./firebase.js";
import { makeMovieKey } from "./movieKeys.js";

// ==========================================
// ADMIN GATE
// ==========================================

const ADMIN_EMAIL = "mjreardon62@gmail.com";

// ==========================================
// STATE
// ==========================================

let allMovies = [];
let fullData = [];   // { title, year, key, appearances, wins, losses, winPct, ratio }
let avgAppearances = 0;
let currentFilter = "all";
let currentSort = { key: "appearances", dir: -1 };

function getMovieKey(m) {
  return makeMovieKey(m.title, m.year);
}

// ==========================================
// LOAD DATA
// ==========================================

window.onload = () => {
  const statusEl = document.getElementById("diag-status");
  const pageEl = document.querySelector(".diag-page");

  onAuth(user => {
    // Show admin nav link if admin
    const adminNav = document.getElementById("admin-nav-link");
    if (adminNav) adminNav.style.display = (user && user.email === ADMIN_EMAIL) ? "" : "none";

    if (!user || user.email !== ADMIN_EMAIL) {
      statusEl.textContent = "";
      pageEl.innerHTML = '<h1>Access Denied</h1><p style="color:var(--color-text-2)">This page is restricted to admin users. <a href="index.html">Back to Home</a></p>';
      return;
    }
    const toolsEl = document.getElementById("admin-tools");
    if (toolsEl) toolsEl.style.display = "";
    const usersEl = document.getElementById("admin-users");
    if (usersEl) usersEl.style.display = "";
    loadDiagnostics();
    loadUserManagement();
  });
};

async function loadDiagnostics() {
  const statusEl = document.getElementById("diag-status");

  try {
    // Load movie list + all votes in parallel
    const [moviesRes, votesSnap] = await Promise.all([
      fetch("movie_list_cleaned.json"),
      getDocs(collection(db, "votes"))
    ]);

    const rawMovies = await moviesRes.json();
    allMovies = rawMovies.filter(m => m.title && m.year && !/^title$/i.test(m.title.trim()));

    statusEl.textContent = `Loaded ${votesSnap.size.toLocaleString()} votes across ${allMovies.length} movies. Analyzing...`;

    // Count appearances (each vote = 1 appearance for winner + 1 for loser)
    const appearances = {};
    const wins = {};
    const losses = {};

    votesSnap.forEach(d => {
      const data = d.data();
      if (!data.winner || !data.loser) return;
      appearances[data.winner] = (appearances[data.winner] || 0) + 1;
      appearances[data.loser] = (appearances[data.loser] || 0) + 1;
      wins[data.winner] = (wins[data.winner] || 0) + 1;
      losses[data.loser] = (losses[data.loser] || 0) + 1;
    });

    // Build full data array
    fullData = allMovies.map(movie => {
      const key = getMovieKey(movie);
      const a = appearances[key] || 0;
      const w = wins[key] || 0;
      const l = losses[key] || 0;
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
    renderSummary(votesSnap.size, withAppearances.length);
    renderFairness();
    renderOverexposed();
    renderNeverShown();
    renderTable();
    setupControls();

    statusEl.textContent = `Analysis complete: ${votesSnap.size.toLocaleString()} votes, ${allMovies.length} movies, avg ${avgAppearances.toFixed(1)} appearances per movie.`;
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
// USER MANAGEMENT
// ==========================================

async function loadUserManagement() {
  const statusEl = document.getElementById("users-status");
  const tbody = document.getElementById("users-tbody");

  if (!tbody) return;
  statusEl.textContent = "Loading users...";

  try {
    const [usersSnap, usernamesSnap, votesSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "usernames")),
      getDocs(collection(db, "votes"))
    ]);

    // Count votes per user
    const voteCounts = {};
    votesSnap.forEach(d => {
      const uid = d.data().user;
      if (uid) voteCounts[uid] = (voteCounts[uid] || 0) + 1;
    });

    // Build username lookup (lowercase -> doc data)
    const usernamesByUid = {};
    usernamesSnap.forEach(d => {
      const data = d.data();
      usernamesByUid[data.uid] = { docId: d.id, email: data.email };
    });

    // Build user rows
    const users = [];
    usersSnap.forEach(d => {
      const data = d.data();
      users.push({
        uid: d.id,
        username: data.username || null,
        email: usernamesByUid[d.id]?.email || data.email || "unknown",
        votes: voteCounts[d.id] || 0,
        usernameDocId: usernamesByUid[d.id]?.docId || null
      });
    });

    // Sort by vote count descending
    users.sort((a, b) => b.votes - a.votes);

    statusEl.textContent = `${users.length} registered user${users.length !== 1 ? 's' : ''}`;

    tbody.innerHTML = "";
    for (const u of users) {
      const tr = document.createElement("tr");
      const usernameDisplay = u.username
        ? `<span class="admin-username-text">${escapeHtml(u.username)}</span>`
        : `<span style="color:var(--color-error); font-style:italic;">(none)</span>`;

      tr.innerHTML = `
        <td class="admin-username-cell" data-uid="${u.uid}" data-current="${escapeHtml(u.username || '')}" data-doc-id="${u.usernameDocId || ''}">${usernameDisplay}
          <button class="admin-btn admin-btn-edit" title="${u.username ? 'Edit' : 'Assign'} username">${u.username ? 'Edit' : 'Assign'}</button>
        </td>
        <td>${escapeHtml(u.email)}</td>
        <td class="num">${u.votes}</td>
        <td>
          <button class="admin-btn admin-btn-reset" data-email="${escapeHtml(u.email)}">Reset Password</button>
          <span class="admin-action-status"></span>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Wire up edit buttons
    tbody.querySelectorAll(".admin-btn-edit").forEach(btn => {
      btn.addEventListener("click", handleEditUsername);
    });

    // Wire up reset buttons
    tbody.querySelectorAll(".admin-btn-reset").forEach(btn => {
      btn.addEventListener("click", handleResetPassword);
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
      const email = row.children[1].textContent;

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
