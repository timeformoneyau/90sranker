const stats = JSON.parse(localStorage.getItem("movieStats")) || {};
const ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
const unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
const tags = JSON.parse(localStorage.getItem("movieTags")) || {};
let movies = [];

const TMDB_API_KEY = '825459de57821b3ab63446cce9046516';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

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

async function loadMovieList() {
  const res = await fetch('movie_list_cleaned.json');
  movies = await res.json();
  renderRankings();
  await renderGlobalRankings();
  await renderUnseen();
  renderTags();
}

function renderRankings() {
  const rankingList = document.getElementById("ranking-list");
  rankingList.innerHTML = "";

  const movieData = Object.keys(stats).map(title => {
    const record = stats[title];
    const rating = ratings[title] || 1000;
    const total = record.wins + record.losses;
    const winPct = total > 0 ? ((record.wins / total) * 100).toFixed(1) : "0.0";
    const year = (movies.find(m => m.title === title) || {}).year || "";
    return { title, year, rating, ...record, winPct };
  });

  movieData
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 20)
    .forEach(movie => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${movie.title}</td>
        <td>${movie.year}</td>
        <td>${movie.rating}</td>
        <td>${movie.wins}</td>
        <td>${movie.losses}</td>
        <td>${movie.winPct}%</td>
      `;
      rankingList.appendChild(tr);
    });
}

async function renderGlobalRankings() {
  const globalList = document.getElementById("global-list");
  if (!globalList) return;

  const allVotes = await db.collection("votes").get();
  const globalStats = {};

  allVotes.forEach(doc => {
    const { winner, loser } = doc.data();
    if (!globalStats[winner]) globalStats[winner] = { wins: 0, losses: 0 };
    if (!globalStats[loser]) globalStats[loser] = { wins: 0, losses: 0 };
    globalStats[winner].wins++;
    globalStats[loser].losses++;
  });

  const data = Object.entries(globalStats).map(([title, record]) => {
    const total = record.wins + record.losses;
    const winPct = total > 0 ? ((record.wins / total) * 100).toFixed(1) : "0.0";
    const year = (movies.find(m => m.title === title) || {}).year || "";
    return { title, year, ...record, winPct };
  });

  data
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 20)
    .forEach(movie => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${movie.title}</td>
        <td>${movie.year}</td>
        <td>${movie.wins}</td>
        <td>${movie.losses}</td>
        <td>${movie.winPct}%</td>
      `;
      globalList.appendChild(tr);
    });
}

async function renderUnseen() {
  const unseenList = document.getElementById("unseen-list");
  if (!unseenList) return;

  unseenList.innerHTML = "";

  const unseenMovies = movies.filter(m => unseen.includes(`${m.title}|${m.year}`));

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
        <td><button onclick="putBack('${movie.title}|${movie.year}')">Put Back</button></td>
      `;
      unseenList.appendChild(tr);
    });
}

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

function putBack(key) {
  const index = unseen.indexOf(key);
  if (index > -1) {
    unseen.splice(index, 1);
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    renderUnseen();
  }
}

function renderTags() {
  const tagList = document.getElementById("tagged-list");
  if (!tagList) return;

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

function exportToCSV() {
  let csv = "Movie,Rating,Wins,Losses,Win%\n";
  Object.keys(stats).forEach(title => {
    const record = stats[title];
    const rating = ratings[title] || 1000;
    const total = record.wins + record.losses;
    const winPct = total > 0 ? ((record.wins / total) * 100).toFixed(1) : "0.0";
    csv += `"${title}",${rating},${record.wins},${record.losses},${winPct}%\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "movie_rankings.csv");
  link.click();
}

window.onload = loadMovieList;
