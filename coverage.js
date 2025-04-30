const movieStats = JSON.parse(localStorage.getItem("movieStats")) || {};
const unseen     = JSON.parse(localStorage.getItem("unseenMovies")) || [];

let allMovies = [];
let currentFilter = null;

window.onload = async () => {
  const res = await fetch("movie_list_cleaned.json");
  allMovies = await res.json();

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

  renderCoverage();
};

function getMovieKey(m) {
  return `${m.title.trim()}|${m.year}`;
}

function renderCoverage() {
  const tbody = document.querySelector("#coverage-table tbody");
  tbody.innerHTML = "";

  const rows = allMovies.map(movie => {
    const key = getMovieKey(movie);
    const count = movieStats[key] || 0;
    return {
      ...movie,
      key,
      count,
      unseen: unseen.includes(key),
    };
  });

  // Apply filter if set
  const filtered = currentFilter ? rows.filter(currentFilter) : rows;

  // Sort by most seen
  filtered.sort((a, b) => b.count - a.count);

  for (const movie of filtered) {
    const row = document.createElement("tr");

    if (movie.count === 0) row.classList.add("faded");
    if (movie.unseen) row.classList.add("unseen");

    row.innerHTML = `
      <td>${movie.title}</td>
      <td>${movie.year}</td>
      <td>${movie.count}</td>
    `;
    tbody.appendChild(row);
  }
}
