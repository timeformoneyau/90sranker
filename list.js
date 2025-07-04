import {
  db,
  onAuth,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from "./firebase.js";

// DOM references
const personalCountEl = document.getElementById("personal-count");
const globalCountEl   = document.getElementById("global-count");
const personalTbody   = document.getElementById("personal-list");
const globalTbody     = document.getElementById("global-list");
const recentTbody     = document.getElementById("recent-votes");

// Helper function to get win percentage color class
function getWinPctClass(winPct) {
  const pct = parseFloat(winPct);
  if (pct >= 80) return 'win-pct-high';
  if (pct >= 60) return 'win-pct-medium';
  return 'win-pct-low';
}

// Helper function to format date
function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (err) {
    console.warn('Date formatting error:', err);
    return 'Unknown';
  }
}

// — Personal Top 20 —
async function renderPersonalStats(uid) {
  if (!personalTbody) return;
  personalCountEl.textContent = "Total Votes: Loading…";
  personalTbody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading your rankings...</td></tr>';

  try {
    const snap = await getDocs(query(
      collection(db, "votes"),
      where("user", "==", uid)
    ));
    personalCountEl.textContent = `Total Votes: ${snap.size}`;

    const stats = {};
    snap.forEach(doc => {
      const { winner, loser } = doc.data();
      stats[winner] = stats[winner] || { wins: 0, losses: 0 };
      stats[loser]  = stats[loser]  || { wins: 0, losses: 0 };
      stats[winner].wins++;
      stats[loser].losses++;
    });

    const rows = Object.entries(stats)
      .map(([key, r]) => {
        const total = r.wins + r.losses;
        return {
          title:  key.split("|")[0],
          wins:    r.wins,
          losses:  r.losses,
          winPct: total ? ((r.wins / total) * 100).toFixed(1) : "0.0"
        };
      })
      .sort((a, b) => {
        // Sort by wins first, then by win percentage
        if (b.wins !== a.wins) return b.wins - a.wins;
        return parseFloat(b.winPct) - parseFloat(a.winPct);
      })
      .slice(0, 20);

    personalTbody.innerHTML = "";
    if (!rows.length) {
      personalTbody.innerHTML = '<tr class="empty-row"><td colspan="4">No votes yet. Start ranking movies!</td></tr>';
      return;
    }
    
    rows.forEach((m, index) => {
      const tr = document.createElement("tr");
      const winPctClass = getWinPctClass(m.winPct);
      tr.innerHTML = `
        <td><strong>#${index + 1}</strong> ${m.title}</td>
        <td>${m.wins}</td>
        <td>${m.losses}</td>
        <td class="${winPctClass}">${m.winPct}%</td>
      `;
      personalTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("renderPersonalStats error:", err);
    personalTbody.innerHTML = '<tr class="error-row"><td colspan="4">Failed to load personal stats.</td></tr>';
    personalCountEl.textContent = "Total Votes: 0";
  }
}

// — Global Top 20 —
async function renderGlobalStats() {
  if (!globalTbody) return;
  globalCountEl.textContent = "Total Votes: Loading…";
  globalTbody.innerHTML = '<tr class="loading-row"><td colspan="4">Loading global rankings...</td></tr>';

  try {
    const snap = await getDocs(collection(db, "votes"));
    globalCountEl.textContent = `Total Votes: ${snap.size}`;

    const wins = {}, losses = {};
    snap.forEach(doc => {
      const { winner, loser } = doc.data();
      wins[winner]    = (wins[winner]    || 0) + 1;
      losses[loser]   = (losses[loser]   || 0) + 1;
      wins[loser]     = wins[loser]     || 0;
      losses[winner]  = losses[winner]  || 0;
    });

    const rows = Object.keys(wins)
      .map(key => {
        const w = wins[key], l = losses[key];
        const total = w + l;
        return {
          title:  key.split("|")[0],
          wins:    w,
          losses:  l,
          winPct: total ? ((w / total) * 100).toFixed(1) : "0.0"
        };
      })
      .sort((a, b) => {
        // Sort by wins first, then by win percentage
        if (b.wins !== a.wins) return b.wins - a.wins;
        return parseFloat(b.winPct) - parseFloat(a.winPct);
      })
      .slice(0, 20);

    globalTbody.innerHTML = "";
    if (!rows.length) {
      globalTbody.innerHTML = '<tr class="empty-row"><td colspan="4">No global votes yet.</td></tr>';
      return;
    }
    
    rows.forEach((m, index) => {
      const tr = document.createElement("tr");
      const winPctClass = getWinPctClass(m.winPct);
      tr.innerHTML = `
        <td><strong>#${index + 1}</strong> ${m.title}</td>
        <td>${m.wins}</td>
        <td>${m.losses}</td>
        <td class="${winPctClass}">${m.winPct}%</td>
      `;
      globalTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("renderGlobalStats error:", err);
    globalTbody.innerHTML = '<tr class="error-row"><td colspan="4">Failed to load global stats.</td></tr>';
    globalCountEl.textContent = "Total Votes: 0";
  }
}

// — Recent Votes (Fixed) —
async function renderRecentVotes(uid) {
  if (!recentTbody) return;
  recentTbody.innerHTML = '<tr class="loading-row"><td colspan="3">Loading recent votes...</td></tr>';

  try {
    console.log("Attempting to load recent votes for user:", uid);
    
    // Simplified query - just get user's votes without ordering first
    const votesQuery = query(
      collection(db, "votes"),
      where("user", "==", uid),
      limit(50) // Get more to account for sorting and filtering
    );

    const snap = await getDocs(votesQuery);
    console.log("Retrieved votes:", snap.size);
    
    recentTbody.innerHTML = "";
    if (snap.empty) {
      recentTbody.innerHTML = '<tr class="empty-row"><td colspan="3">No votes found. Start voting to see your history!</td></tr>';
      return;
    }

    // Convert to array and filter valid votes
    let votes = [];
    snap.forEach(doc => {
      const data = doc.data();
      // Only include votes with valid winner/loser data
      if (data.winner && data.loser) {
        votes.push({
          ...data,
          id: doc.id
        });
      }
    });

    console.log("Valid votes found:", votes.length);

    if (votes.length === 0) {
      recentTbody.innerHTML = '<tr class="empty-row"><td colspan="3">No valid votes found.</td></tr>';
      return;
    }

    // Sort by timestamp (most recent first), handle missing timestamps
    votes.sort((a, b) => {
      const timeA = a.timestamp ? (a.timestamp.toDate ? a.timestamp.toDate() : new Date(a.timestamp)) : new Date(0);
      const timeB = b.timestamp ? (b.timestamp.toDate ? b.timestamp.toDate() : new Date(b.timestamp)) : new Date(0);
      return timeB - timeA;
    });

    // Take top 10
    votes = votes.slice(0, 10);

    votes.forEach(({ winner, loser, timestamp }) => {
      const tr = document.createElement("tr");
      const formattedDate = formatDate(timestamp);
      
      // Extract movie titles, handle different formats
      const winnerTitle = typeof winner === 'string' ? winner.split("|")[0] : (winner.title || 'Unknown Movie');
      const loserTitle = typeof loser === 'string' ? loser.split("|")[0] : (loser.title || 'Unknown Movie');
      
      tr.innerHTML = `
        <td>${formattedDate}</td>
        <td>${winnerTitle}</td>
        <td>${loserTitle}</td>
      `;
      recentTbody.appendChild(tr);
    });

  } catch (err) {
    console.error("renderRecentVotes error:", err);
    console.error("Error details:", {
      code: err.code,
      message: err.message
    });
    
    let errorMessage = "Unable to load recent votes.";
    
    if (err.code === 'permission-denied') {
      errorMessage = "Authentication required to view recent votes.";
    } else if (err.code === 'failed-precondition') {
      errorMessage = "Database index required. Recent votes temporarily unavailable.";
    }
    
    recentTbody.innerHTML = `<tr class="error-row"><td colspan="3">${errorMessage}</td></tr>`;
  }
}

// Initialize on load & auth
window.addEventListener("load", () => {
  onAuth(async user => {
    if (user) {
      await renderPersonalStats(user.uid);
      await renderRecentVotes(user.uid);
    } else {
      personalTbody.innerHTML = '<tr class="empty-row"><td colspan="4">Log in to see your personal rankings.</td></tr>';
      personalCountEl.textContent = "Total Votes: 0";
      recentTbody.innerHTML = '<tr class="empty-row"><td colspan="3">Log in to see your recent votes.</td></tr>';
    }
    await renderGlobalStats();
  });
});
