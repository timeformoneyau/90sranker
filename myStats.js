import { auth, db } from "./auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

async function loadUserStats() {
  const container = document.getElementById("stats-container");

  // Prompt to log in if needed
  if (!auth.currentUser) {
    container.innerHTML = "<p>Please log in to see your stats.</p>";
    return;
  }

  // Fetch this user's document
  const ref = doc(db, "users", auth.currentUser.uid);
  const snapshot = await getDoc(ref);

  if (!snapshot.exists()) {
    container.innerHTML = "<p>No stats found.</p>";
    return;
  }

  const data = snapshot.data();
  const votesArray = data.votes || [];       // Firestore stores this as an array
  const seen = data.seen || [];

  // Tally up vote counts per movie key
  const voteCounts = {};
  votesArray.forEach(key => {
    voteCounts[key] = (voteCounts[key] || 0) + 1;
  });

  const totalVotes = votesArray.length;
  const uniqueMovies = Object.keys(voteCounts).length;

  // Build the top-10 rows
  const topEntries = Object.entries(voteCounts)
    .sort(([, aCount], [, bCount]) => bCount - aCount)
    .slice(0, 10);

  const topRows = topEntries.map(([key, count]) => {
    const [title, year] = key.split("|");
    return `<tr><td>${title} (${year})</td><td>${count}</td></tr>`;
  }).join("");

  // Render the HTML
  container.innerHTML = `
    <h2>Your Stats</h2>
    <p><strong>Total Votes:</strong> ${totalVotes}</p>
    <p><strong>Unique Movies Voted:</strong> ${uniqueMovies}</p>
    <p><strong>Unseen Movies:</strong> ${seen.length}</p>

    <h3>Top Voted Movies</h3>
    <table>
      <thead>
        <tr><th>Movie</th><th>Votes</th></tr>
      </thead>
      <tbody>
        ${topRows || '<tr><td colspan="2">No votes yet.</td></tr>'}
      </tbody>
    </table>
  `;
}

window.onload = loadUserStats;
