const unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let movies = [];

const TMDB_API_KEY = '825459de57821b3ab63446cce9046516';

async function loadUnseenList() {
  const res = await fetch("movie_list_cleaned.json");
  movies = await res.json();

  const unseenMovies = unseen
    .map(key => {
      const [title, year] = key.split("|");
      return movies.find(m => m.title === title && String(m.year) === year);
    })
    .filter(Boolean); // remove nulls

  const scoredUnseen = await Promise.all(
    unseenMovies.map(async (movie) => {
      const tmdbRating = await fetchTMDBRating(movie.title, movie.year);
      return {
        ...movie,
        tmdbRating: tmdbRating || 0
      };
    })
  );

  scoredUnseen
    .sort((a, b) => b.tmdbRating - a.tmdbRating)
    .slice(0, 20)
    .forEach(movie => {
      const key = `${movie.title}|${movie.year}`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${movie.title}</td>
        <td>${movie.year}</td>
        <td>${movie.tmdbRating ? movie.tmdbRating.toFixed(1) : "N/A"}</td>
        <td><button onclick="putBack('${key}')">Put Back</button></td>
      `;
      document.getElementById("unseen-list").appendChild(tr);
    });
}

async function fetchTMDBRating(title, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.results?.[0]?.vote_average) {
      return data.results[0].vote_average;
    }
  } catch (err) {
    console.error(`Failed to fetch TMDB rating for ${title}`, err);
  }
  return null;
}

function putBack(key) {
  const index = unseen.indexOf(key);
  if (index > -1) {
    unseen.splice(index, 1);
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    location.reload();
  }
}

window.onload = loadUnseenList;
