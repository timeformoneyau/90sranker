import { db, doc, getDoc } from "./firebase.js";

let movieStats = {};
let allMovies = [];
let currentFilter = null;
let fullData = [];

window.onload = async () => {
  try {
    // Load all movies from JSON
    const res = await fetch("movie_list_cleaned.json");
    allMovies = await res.json();

    // Load global usage counts from Firestore
    const statsSnap = await getDoc(doc(db, "global_stats", "movie_stats"));
    if (!statsSnap.exists()) {
      console.error("No movie_stats doc found in global_stats");
      return;
    }
    movieStats = statsSnap.data();

    // Setup filter and export buttons
    document.getElementById("filter-unseen").addEventListener("click", () => {
      currentFilter = m => m.count === 0;
      renderCoverage();
    });

    document.getElementById("filter-gt5").addEventListener("click", () => {
      currentFilter = m => m.count > 5;
      renderCoverage();
    });

    document.getElementById("reset-filter").addEventListener("click", () => {
      currentFilter = null;
      renderCoverage();
    });

    document.getElementById("export-csv").addEventListener("click", exportToCSV);

    // Initial render
    renderCoverage();
  } catch (err) {
    console.error("Error loading data:", err);
  }
};

function getMovieKey(m) {
  return `${m.title.trim()}|${m.year}`;
}

function renderCoverage() {
  const tbody = document.querySelector("#coverage-table tbody");
  tbody.innerHTML = "";

  fullData = allMovies.map(movie => {
    const key = getMovieKey(movie);
    const count = movieStats[key] || 0;
    return {
      ...movie,
      key,
      count
    };
  });

  const filtered = currentFilter ? fullData.filter(currentFilter) : fullData;
  filtered.sort((a, b) => b.count - a.count);

  for (const movie of filtered) {
    const row = document.createElement("tr");
    if (movie.count === 0) row.classList.add("faded");

    row.innerHTML = `
      <td>${movie.title}</td>
      <td>${movie.year}</td>
      <td>${movie.count}</td>
    `;
    tbody.appendChild(row);
  }
}

function exportToCSV() {
  let csv = "Title,Year,Times Shown\n";
  for (const m of fullData) {
    csv += `"${m.title}","${m.year}",${m.count}\n`;
  }
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "movie_coverage.csv";
  link.click();
}
