let movies = [];
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats = JSON.parse(localStorage.getItem("movieStats")) || {};
let unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];
let tags = JSON.parse(localStorage.getItem("movieTags")) || {};

let movieA, movieB;
const TAG_OPTIONS = ["Nostalgic Favorite", "Dumb Awesome", "Top 50"];
const DEFAULT_RATING = 1000;
const K = 32;

const TMDB_API_KEY = '825459de57821b3ab63446cce9046516';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

async function loadMovies() {
  const response = await fetch("movie_list_cleaned.json");
  movies = await response.json();

  if (document.getElementById("ranking-list")) updateRanking();
  if (document.getElementById("unseen-list")) updateUnseenList();
  if (document.getElementById("tagged-list")) updateTaggedList();

  chooseTwoMovies();
}

function getAvailableMovies(exclude = []) {
  return movies.filter(
    m => m.title && !unseen.includes(m.title) && !exclude.includes(m.title)
  );
}

function chooseTwoMovies() {
  const available = getAvailableMovies();
  if (available.length < 2) {
    alert("Not enough unseen movies to compare.");
    return;
  }

  const shuffled = available.sort(() => 0.5 - Math.random());
  const anchor = shuffled[0];
  const anchorTier = getTier(anchor);

  const pairOptions = available.filter(m => {
    const pairKey = [anchor.title, m.title].sort().join("|");
    if (anchor.title === m.title) return false;
    if (seenMatchups.includes(pairKey)) return false;

    const tier = getTier(m);
    return anchorTier === "uncertain" || tier === "uncertain" || anchorTier === tier;
  });

  if (!pairOptions.length) {
    alert("No fresh pairings available. Try resetting.");
    return;
  }

  const opponent = pairOptions[Math.floor(Math.random() * pairOptions.length)];
  movieA = Math.random() < 0.5 ? anchor : opponent;
  movieB = movieA === anchor ? opponent : anchor;

  displayMovies();
}

function getTier(movie) {
  const rating = ratings[movie.title] || DEFAULT_RATING;
  const record = stats[movie.title] || { wins: 0, losses: 0 };
  const total = record.wins + record.losses;
  if (total < 3) return "uncertain";
  if (rating >= 1100 && record.wins >= 3) return "high";
  if (rating <= 950 && record.losses >= 3) return "low";
  return "mid";
}

async function fetchPosterUrl(title, year) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.results && data.results[0] && data.results[0].poster_path) {
      return TMDB_IMAGE_BASE + data.results[0].poster_path;
    }
  } catch (err) {
    console.error(`Failed to fetch poster for ${title}`, err);
  }
  return "fallback.jpg";
}

async function displayMovies() {
  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;

  const imgA = document.getElementById("posterA");
  const imgB = document.getElementById("posterB");

  imgA.src = await fetchPosterUrl(movieA.title, movieA.year);
  imgB.src = await fetchPosterUrl(movieB.title, movieB.year);

  document.querySelectorAll('.confetti-container').forEach(e => e.remove());
}

function vote(winner) {
  const winnerTitle = winner === "A" ? movieA.title : movieB.title;
  const loserTitle = winner === "A" ? movieB.title : movieA.title;

  const votedPoster = document.getElementById(`poster${winner}`);
  votedPoster.classList.add("popcorn-shake");

  const parent = votedPoster.parentElement;
  parent.querySelectorAll('.confetti-container').forEach(e => e.remove());
  createConfettiBurst(parent);

  setTimeout(() => votedPoster.classList.remove("popcorn-shake"), 700);

  updateElo(winnerTitle, loserTitle);
  updateStats(winnerTitle, loserTitle);
  seenMatchups.push([movieA.title, movieB.title].sort().join("|"));

  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));
  localStorage.setItem("movieRatings", JSON.stringify(ratings));
  localStorage.setItem("movieStats", JSON.stringify(stats));
  if (document.getElementById("ranking-list")) updateRanking();

  setTimeout(() => chooseTwoMovies(), 1500);
}

function createConfettiBurst(element) {
  const container = document.createElement("div");
  container.className = "confetti-container";
  container.style.cssText = "position:absolute;top:50%;left:50%;width:0;height:0;pointer-events:none;z-index:200;";
  const colors = ['#ff3b3b', '#ffc107', '#4caf50', '#03a9f4', '#e91e63', '#9c27b0'];

  for (let i = 0; i < 100; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.cssText = `
      position:absolute;
      width:12px;height:16px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      opacity:0;
      border-radius:2px;
      transform-origin:center;
    `;
    const angle = Math.random() * Math.PI * 2;
    const distance = 150 + Math.random() * 300;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const r = Math.random() * 1440 - 720;
    const delay = Math.random() * 0.2;

    piece.style.setProperty('--x', `${x}px`);
    piece.style.setProperty('--y', `${y}px`);
    piece.style.setProperty('--r', `${r}deg`);
    piece.style.animation = `confettiBurst 1.3s ease-out forwards`;
    piece.style.animationDelay = `${delay}s`;

    container.appendChild(piece);
  }

  element.appendChild(container);
  setTimeout(() => container.remove(), 1600);
}

function updateElo(winner, loser) {
  const Ra = ratings[winner] || DEFAULT_RATING;
  const Rb = ratings[loser] || DEFAULT_RATING;
  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
  ratings[winner] = Math.round(Ra + K * (1 - Ea));
  ratings[loser] = Math.round(Rb + K * (0 - (1 - Ea)));
}

function updateStats(winner, loser) {
  stats[winner] = stats[winner] || { wins: 0, losses: 0 };
  stats[loser] = stats[loser] || { wins: 0, losses: 0 };
  stats[winner].wins++;
  stats[loser].losses++;
}

// rest of the code (markUnseen, updateRanking, etc.) remains the same
