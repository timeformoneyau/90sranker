// list.js
import { db, doc, onSnapshot } from "./firebase.js";
import { fetchTMDBRating } from "./unseen.js";

let moviesList = [];
const statsList   = JSON.parse(localStorage.getItem("movieStats")) || {};
const ratingsList = JSON.parse(localStorage.getItem("movieRatings")) || {};
const unseenList  = JSON.parse(localStorage.getItem("unseenMovies")) || [];
const tagsList    = JSON.parse(localStorage.getItem("movieTags")) || {};

window.addEventListener("load", loadMovieList);

async function loadMovieList() {
  try {
    const res = await fetch("movie_list_cleaned.json");
    moviesList = await res.json();
    renderGlobalRankings();
    renderRankings();
    renderUnseen();
    renderTags();
  } catch (e) {
    console.error(e);
  }
}

// ... rest of list.js unchanged but using addEventListener for load
