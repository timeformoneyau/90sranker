// myStats.js
import { auth, db } from "./auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

async function loadUserStats() {
  const container = document.getElementById("stats-container");
  if (!container) return;

  let voteCounts = {};
  let totalVotes = 0;
  let uniqueMovies = 0;
  let unseenCount = 0;

  if (auth.currentUser) {
    try {
      const userRef = doc(db, "users", auth.currentUser.uid);
      const snap = await getDoc(userRef);
      const data = snap.exists() ? snap.data() : { votes: [], seen: [] };

      // Firestore votes array
      const votesArray = Array.isArray(data.votes) ? data.votes : [];
      voteCounts = votesArray.reduce((acc, key) => {
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      unseenCount = Array.isArray(data.seen) ? data.seen.length : 0;

      totalVotes = votesArray.length;
      uniqueMovies = Object.keys(voteCounts).length;
    } catch (err) {
      console.error("Error loading stats from Firestore:", err);
      // Fallback to localStorage
      const statsMap = JSON.parse(localStorage.getItem("movieStats")) || {};
      voteCounts = Object.fromEntries(
        Object.entries(statsMap)
          .filter(([, val]) => val.wins > 0)
          .map(([key, val]) => [key, val.wins])
      );
      totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);
      uniqueMovies = Object.keys(voteCounts).length;
      unseenCount = JSON.parse(localStorage.getItem("unseenMovies"))?.length || 0;
    }
  } else {
    // LocalStorage fallback
    const statsMap = JSON.parse(localStorage.getItem("movieStats")) || {};
    voteCounts = Object.fromEntries(
      Object.entries(statsMap)
        .filter(([, val]) => val.wins > 0)
        .map(([key, val]) => [key, val.wins])
    );
    totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0);
    uniqueMovies = Object.keys(voteCounts).length;
    unseenCount = JSON.parse(localStorage.getItem("unseenMovies"))?.length || 0;
  }

  // Build top-10 table rows
  const topEntries = Object.entries(voteCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  const topRows = topEntries.map(([key, count]) => {
    const [title, year] = key.split("|");
    return `<tr><td>${title} (${year})</td><td>${count}</td></tr>`;
  }).join("");

  // Render
  container.innerHTML = `
    <h2>Your Stats</h2>
    <p><strong>Total Votes:</strong> ${totalVotes}</p>
    <p><strong>Unique Movies Voted:</strong> ${uniqueMovies}</p>
    <p><strong>Unseen Movies:</strong> ${unseenCount}</p>

    <h3>Top Voted Movies</h3>
    <table>
      <thead><tr><th>Movie</th><th>Votes</th></tr></thead>
      <tbody>${topRows || '<tr><td colspan="2">No votes yet.</td></tr>'}</tbody>
    </table>
  `;
}

window.addEventListener('load', loadUserStats);
