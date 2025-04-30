const movieStats = JSON.parse(localStorage.getItem("movieStats")) || {};
const unseen     = JSON.parse(localStorage.getItem("unseenMovies")) || [];

let allMovies = [];

window.onload = async () => {
  const res = await fetch("movie_list_cleaned.json");
  allMovies = await res.json();
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
      unseen: unseen.includes(key)
    };
  });

  // Sort: most seen first
  rows.sort((a, b) => b.count - a.count);

  for (const movie of rows) {
    const row = document.createElement("tr");
    if (movie.count === 0) row.style.opacity = 0.4;
    row.innerHTML = `
      <td>${movie.title}</td>
      <td>${movie.year}</td>
      <td>${movie.count}</td>
    `;
    tbody.appendChild(row);
  }
}
