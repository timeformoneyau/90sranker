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
    // Try to get recent votes with proper ordering
    let votesQuery;
    try {
      // First try with orderBy (requires composite index)
      votesQuery = query(
        collection(db, "votes"),
        where("user", "==", uid),
        orderBy("timestamp", "desc"),
        limit(10)
      );
    } catch (indexError) {
      // Fallback: get votes without ordering if index doesn't exist
      console.info("Using fallback query (no composite index)");
      votesQuery = query(
        collection(db, "votes"),
        where("user", "==", uid),
        limit(20) // Get more to account for potential missing timestamps
      );
    }

    const snap = await getDocs(votesQuery);
    
    recentTbody.innerHTML = "";
    if (snap.empty) {
      recentTbody.innerHTML = '<tr class="empty-row"><td colspan="3">No recent votes found.</td></tr>';
      return;
    }

    // Convert to array and sort by timestamp if we used fallback query
    let votes = [];
    snap.forEach(doc => {
      const data = doc.data();
      votes.push(data);
    });

    // Sort by timestamp (most recent first) and take top 10
    votes.sort((a, b) => {
      const timeA = a.timestamp?.toDate?.() || new Date(0);
      const timeB = b.timestamp?.toDate?.() || new Date(0);
      return timeB - timeA;
    });
    votes = votes.slice(0, 10);

    if (votes.length === 0) {
      recentTbody.innerHTML = '<tr class="empty-row"><td colspan="3">No recent votes found.</td></tr>';
      return;
    }

    votes.forEach(({ winner, loser, timestamp }) => {
      const tr = document.createElement("tr");
      const formattedDate = formatDate(timestamp);
      tr.innerHTML = `
        <td>${formattedDate}</td>
        <td>${winner.split("|")[0]}</td>
        <td>${loser.split("|")[0]}</td>
      `;
      recentTbody.appendChild(tr);
    });

  } catch (err) {
    console.error("renderRecentVotes error:", err);
    recentTbody.innerHTML = '<tr class="error-row"><td colspan="3">Unable to load recent votes.</td></tr>';
    
    // If it's a permissions error, show a helpful message
    if (err.code === 'permission-denied') {
      recentTbody.innerHTML = '<tr class="empty-row"><td colspan="3">Recent votes require proper authentication.</td></tr>';
    }
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
