// === Firebase Setup ===
const firebaseConfig = {
  apiKey: "AIzaSyApkVMpbaHkUEZU0H8tW3vzxaM2DYxPdwM",
  authDomain: "sranker-f2642.firebaseapp.com",
  projectId: "sranker-f2642",
  storageBucket: "sranker-f2642.appspot.com",
  messagingSenderId: "601665183803",
  appId: "1:601665183803:web:705a2ebeeb43b672ef3c1e",
  measurementId: "G-JTG8MVCW64"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// === Local State ===
const ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
const unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
const tags = JSON.parse(localStorage.getItem("movieTags")) || {};
let movies = [];

// === Load Movies & Then Rankings ===
async function loadMovieList() {
  const res = await fetch('movie_list_cleaned.json');
  movies = await res.json();
  await renderRankings(); // Now async!
  await renderUnseen();
  renderTags();
}

// === Fetch and Render Global Rankings ===
async function renderRankings() {
  const rankingList = document.getElementById("ranking-list");
  rankingList.innerHTML = "";

  const snapshot = await db.collection("votes").get();

  const globalStats = {};

  snapshot.forEach(doc => {
    const { winner } = doc.data();
    if (!winner) return;

    if (!globalStats[winner]) {
      globalStats[winner] = { wins: 0 };
    }
    globalStats[winner].wins++;
  });

  const movieData = Object.keys(globalStats).map(title => ({
    title,
    wins: globalStats[title].wins
  }));

  movieData
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 20)
    .forEach(movie => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${movie.title}</td>
        <td>${movie.wins}</td>
      `;
      rankingList.appendChild(tr);
    });
}

// === Render Unseen List with TMDB Ratings ===
async function renderUnseen() {
  const unseenList = document.getElementById("unseen-list");
  unseenList.innerHTML = "";

  const unseenMovies = movies.filter(m => unseen.includes(m.title));

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
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${movie.title}</td>
        <td>${movie.year}</td>
        <td>${movie.tmdbRating ? movie.tmdbRating.toFixed(1) : "N/A"}</td>
        <td><button onclick="putBack('${movie.title}')">Put Back</button></td>
      `;
      unseenList.appendChild(tr);
    });
}

// === Fetch TMDB Rating ===
const TMDB_API_KEY = '825459de57821b3ab63446cce9046516';
async function fetchTMDBRating(title, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.results && data.results[0] && data.results[0].vote_average) {
      return data.results[0].vote_average;
    }
  } catch (err) {
    console.error(`Failed to fetch TMDB rating for ${title}`, err);
  }
  return null;
}

// === Restore Movie from Unseen List ===
function putBack(title) {
  const index = unseen.indexOf(title);
  if (index > -1) {
    unseen.splice(index, 1);
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    renderUnseen();
  }
}

// === Tags Viewer ===
function renderTags() {
  const tagList = document.getElementById("tagged-list");
  tagList.innerHTML = "";

  const taggedTitles = Object.keys(tags);
  if (taggedTitles.length === 0) {
    tagList.innerHTML = "<li>No tagged movies yet.</li>";
    return;
  }

  taggedTitles.forEach(title => {
    const li = document.createElement("li");
    li.textContent = `${title} — ${tags[title].join(", ")}`;
    tagList.appendChild(li);
  });
}

// === Start ===
window.onload = loadMovieList;
