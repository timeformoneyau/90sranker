import { auth, db } from "./auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

async function loadUserStats() {
  if (!auth.currentUser) {
    document.getElementById("stats-container").innerHTML = "<p>Please log in to see your stats.</p>";
    return;
  }

  const ref = doc(db, "users", auth.currentUser.uid);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    document.getElementById("stats-container").innerHTML = "<p>No stats found.</p>";
    return;
  }

  const data = snapshot.data();
  const votes = data.votes || {};
  const seen = data.seen || [];

  const voteEntries = Object.entries(votes);
  const totalVotes = voteEntries.reduce((sum, [key, count]) => sum + count, 0);
  const uniqueMovies = voteEntries.length;

  const topMovies = voteEntries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => `<tr><td>${key}</td><td>${count}</td></tr>`) 
    .join("");

  const statsHTML = `
    <h2>Your Stats</h2>
    <p><strong>Total Votes:</strong> ${totalVotes}</p>
    <p><strong>Unique Movies Voted:</strong> ${uniqueMovies}</p>
    <p><strong>Unseen Movies:</strong> ${seen.length}</p>

    <h3>Top Voted Movies</h3>
    <table>
      <thead><tr><th>Movie</th><th>Votes</th></tr></thead>
      <tbody>${topMovies}</tbody>
    </table>
  `;

  document.getElementById("stats-container").innerHTML = statsHTML;
}

window.onload = loadUserStats;
