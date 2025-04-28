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

// — Personal Top 20 —
async function renderPersonalStats(uid) {
  if (!personalTbody) return;
  personalCountEl.textContent = "Total Votes: Loading…";
  personalTbody.innerHTML = "<tr><td colspan='4'>Loading…</td></tr>";

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
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 20);

    personalTbody.innerHTML = "";
    if (!rows.length) {
      personalTbody.innerHTML = "<tr><td colspan='4'>No votes yet.</td></tr>";
      return;
    }
    rows.forEach(m => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.title}</td>
        <td>${m.wins}</td>
        <td>${m.losses}</td>
        <td>${m.winPct}%</td>
      `;
      personalTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("renderPersonalStats error:", err);
    personalTbody.innerHTML = "<tr><td colspan='4'>Failed to load personal stats.</td></tr>";
    personalCountEl.textContent = "Total Votes: 0";
  }
}

// — Global Top 20 —
async function renderGlobalStats() {
  if (!globalTbody) return;
  globalCountEl.textContent = "Total Votes: Loading…";
  globalTbody.innerHTML = "<tr><td colspan='4'>Loading…</td></tr>";

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
      .sort((a,b) => b.wins - a.wins)
      .slice(0, 20);

    globalTbody.innerHTML = "";
    if (!rows.length) {
      globalTbody.innerHTML = "<tr><td colspan='4'>No votes yet.</td></tr>";
      return;
    }
    rows.forEach(m => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.title}</td>
        <td>${m.wins}</td>
        <td>${m.losses}</td>
        <td>${m.winPct}%</td>
      `;
      globalTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("renderGlobalStats error:", err);
    globalTbody.innerHTML = "<tr><td colspan='4'>Failed to load global stats.</td></tr>";
    globalCountEl.textContent = "Total Votes: 0";
  }
}

// — Recent Votes —
async function renderRecentVotes(uid) {
  if (!recentTbody) return;
  recentTbody.innerHTML = "<tr><td colspan='3'>Loading…</td></tr>";

  try {
    const snap = await getDocs(query(
      collection(db, "votes"),
      where("user","==",uid),
      orderBy("timestamp","desc"),
      limit(10)
    ));
    recentTbody.innerHTML = "";
    if (snap.empty) {
      recentTbody.innerHTML = "<tr><td colspan='3'>No recent votes.</td></tr>";
      return;
    }
    snap.forEach(doc => {
      const { winner, loser, timestamp } = doc.data();
      const date = timestamp?.toDate().toLocaleString() || "";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${date}</td>
        <td>${winner.split("|")[0]}</td>
        <td>${loser.split("|")[0]}</td>
      `;
      recentTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("renderRecentVotes error:", err);
    recentTbody.innerHTML = "<tr><td colspan='3'>Failed to load recent votes.</td></tr>";
  }
}

// Initialize on load & auth
window.addEventListener("load", () => {
  onAuth(async user => {
    if (user) {
      await renderPersonalStats(user.uid);
      await renderRecentVotes(user.uid);
    } else {
      personalTbody.innerHTML = `<tr><td colspan="4">Log in to see your stats.</td></tr>`;
      personalCountEl.textContent = "Total Votes: 0";
      recentTbody.innerHTML  = `<tr><td colspan="3">Log in to see recent votes.</td></tr>`;
    }
    await renderGlobalStats();
  });
});
