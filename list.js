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
import { fetchTMDBRating } from "./unseen.js";

let moviesList = [];

// DOM references (may be null on pages without these tables)
const personalTbody = document.getElementById("personal-list");
const globalTbody   = document.getElementById("global-list");
const recentTbody   = document.getElementById("recent-votes");

// — Personal Top 20 —
async function renderPersonalStats(uid) {
  if (!personalTbody) return;
  personalTbody.innerHTML = "<tr><td colspan='4'>Loading…</td></tr>";

  try {
    const q = query(
      collection(db, "votes"),
      where("user", "==", uid)
    );
    const snap = await getDocs(q);

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
          title: key.split("|")[0],
          wins:  r.wins,
          losses: r.losses,
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
  }
}

// — Global Top 20 —
async function renderGlobalStats() {
  if (!globalTbody) return;
  globalTbody.innerHTML = "<tr><td colspan='2'>Loading…</td></tr>";

  try {
    const snap = await getDocs(collection(db, "votes"));
    const tally = {};
    snap.forEach(doc => {
      const { winner } = doc.data();
      tally[winner] = (tally[winner] || 0) + 1;
    });

    const rows = Object.entries(tally)
      .map(([key, wins]) => ({ title: key.split("|")[0], wins }))
      .sort((a, b) => b.wins - a.wins)
      .slice(0, 20);

    globalTbody.innerHTML = "";
    if (!rows.length) {
      globalTbody.innerHTML = "<tr><td colspan='2'>No votes yet.</td></tr>";
      return;
    }
    rows.forEach(m => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${m.title}</td><td>${m.wins}</td>`;
      globalTbody.appendChild(tr);
    });
  } catch (err) {
    console.error("renderGlobalStats error:", err);
    globalTbody.innerHTML = "<tr><td colspan='2'>Failed to load global stats.</td></tr>";
  }
}

// — Recent Votes —
async function renderRecentVotes(uid) {
  if (!recentTbody) return;
  recentTbody.innerHTML = "<tr><td colspan='3'>Loading…</td></tr>";

  try {
    const q = query(
      collection(db, "votes"),
      where("user", "==", uid),
      orderBy("timestamp", "desc"),
      limit(10)
    );
    const snap = await getDocs(q);

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

// Initialize after DOM and auth state are ready
window.addEventListener("load", async () => {
  try {
    const res = await fetch("movie_list_cleaned.json");
    moviesList = await res.json();
  } catch (e) {
    console.error("Movie list load failed:", e);
  }

  onAuth(async (user) => {
    // Only run if tables exist and renderer functions are defined
    if (!personalTbody && !globalTbody && !recentTbody) return;

    if (user) {
      await renderPersonalStats(user.uid);
      await renderRecentVotes(user.uid);
    } else {
      if (personalTbody) personalTbody.innerHTML = `<tr><td colspan="4">Log in to see your stats.</td></tr>`;
      if (recentTbody)  recentTbody.innerHTML  = `<tr><td colspan="3">Log in to see recent votes.</td></tr>`;
    }

    await renderGlobalStats();
  });
});
