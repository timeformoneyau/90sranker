let movies = [];
let scores = JSON.parse(localStorage.getItem("movieScores")) || {};
let movieA, movieB;

async function loadMovies() {
  const response = await fetch("movie_list_cleaned.json");
  movies = await response.json();
  chooseTwoMovies();
  updateRanking();
}

function chooseTwoMovies() {
  const available = movies.filter(m => m.title && m.year);
  const shuffled = available.sort(() => 0.5 - Math.random());
  [movieA, movieB] = shuffled.slice(0, 2);

  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;
}

function vote(winner) {
  const winnerId = winner === 'A' ? movieA.title : movieB.title;
  const loserId = winner === 'A' ? movieB.title : movieA.title;

  scores[winnerId] = (scores[winnerId] || 0) + 1;
  scores[loserId] = scores[loserId] || 0;

  localStorage.setItem("movieScores", JSON.stringify(scores));

  updateRanking();
  chooseTwoMovies();
}

function updateRanking() {
  const listEl = document.getElementById("ranking-list");
  listEl.innerHTML = "";

  const ranked = [...movies]
    .filter(m => scores[m.title] !== undefined)
    .sort((a, b) => (scores[b.title] || 0) - (scores[a.title] || 0));

  ranked.forEach(movie => {
    const li = document.createElement("li");
    li.textContent = `${movie.title} (${movie.year}) — ${scores[movie.title]} pts`;
    listEl.appendChild(li);
  });
}

window.onload = loadMovies;
