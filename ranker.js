// ===== Firebase Setup =====
// … (unchanged) …

// ===== App Logic =====
let movies = [];
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats   = JSON.parse(localStorage.getItem("movieStats"))   || {};
let unseen  = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seen    = JSON.parse(localStorage.getItem("seenMatchups"))|| [];
let movieA, movieB;

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// 1) loadMovies MUST call chooseTwoMovies
async function loadMovies() {
  const res = await fetch("movie_list_cleaned.json");
  movies = await res.json();
  if (!movies.length) return alert("No movies loaded");
  chooseTwoMovies();  // ← make absolutely sure this is here
}

// 2) pick two and display them
function chooseTwoMovies() {
  const avail = movies.filter(m=>!unseen.includes(m.title));
  if (avail.length < 2) return alert("Not enough movies");
  [movieA, movieB] = avail.sort(()=>.5-Math.random()).slice(0,2);
  displayMovies();
}

// 3) inject posters + titles + links
async function displayMovies() {
  // Titles
  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;

  // Posters
  const [imgA, imgB] = [
    document.getElementById("posterA"),
    document.getElementById("posterB")
  ];
  imgA.src = `${TMDB_IMAGE_BASE}${movieA.poster_path}`;
  imgB.src = `${TMDB_IMAGE_BASE}${movieB.poster_path}`;

  // LINKS → wrap your poster+title in <a id="linkA"> and <a id="linkB">
  document.getElementById("linkA").href =
    `https://www.themoviedb.org/search?query=${encodeURIComponent(movieA.title+' '+movieA.year)}`;
  document.getElementById("linkB").href =
    `https://www.themoviedb.org/search?query=${encodeURIComponent(movieB.title+' '+movieB.year)}`;

  // remove old confetti so createConfettiBurst() is fresh
  document.querySelectorAll('.confetti-container').forEach(el=>el.remove());
}

// 4) vote handler (unchanged except ensure markUnseen param)
function vote(which) {
  /* … your existing vote logic … */
}

// 5) RESTORE markUnseen signature to accept the movie object
function markUnseen(movieObj) {
  if (!movieObj || !movieObj.title) return;
  unseen.push(movieObj.title);
  localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  chooseTwoMovies();
}

// no more alignScreen(), no leftover listeners
window.onload = loadMovies;
