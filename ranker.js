import { auth, recordVoteToFirestore, db } from "./auth.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

let movies = [];
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats = JSON.parse(localStorage.getItem("movieStats")) || {};
let unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];

let movieA, movieB;

async function loadMovies() {
  try {
    const res = await fetch("movie_list_cleaned.json");
    movies = await res.json();
    chooseTwoMovies();
  } catch (error) {
    console.error("Error loading movies:", error);
  }
}

function chooseTwoMovies() {
  const available = movies.filter(m => {
    const key = `${m.title}|${m.year}`;
    return !unseen.includes(key);
  });

  if (available.length < 2) {
    alert("Not enough movies to compare.");
    return;
  }

  let attempts = 0;
  let matchupKey = "";

  do {
    [movieA, movieB] = available.sort(() => Math.random() - 0.5).slice(0, 2);
    matchupKey = [movieA.title, movieB.title].sort().join("|");
    attempts++;
    if (attempts > 50) break;
  } while (seenMatchups.includes(matchupKey));

  displayMovies();
}

async function displayMovies() {
  document.getElementById("movieA").textContent = movieA.title;
  document.getElementById("movieA-year").textContent = `(${movieA.year})`;
  document.getElementById("movieB").textContent = movieB.title;
  document.getElementById("movieB-year").textContent = `(${movieB.year})`;

  const imgA = document.getElementById("posterA");
  const imgB = document.getElementById("posterB");

  imgA.src = await fetchPosterUrl(movieA.title, movieA.year);
  imgB.src = await fetchPosterUrl(movieB.title, movieB.year);

  document.querySelectorAll(".confetti-container").forEach(e => e.innerHTML = '');
}

const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

async function fetchPosterUrl(title, year) {
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
    const res = await fetch(url);
    const data = await res.json();
    return (data.results?.[0]?.poster_path)
      ? `${TMDB_IMAGE_BASE}${data.results[0].poster_path}`
      : "fallback.jpg";
  } catch (error) {
    console.error("Error fetching poster:", error);
    return "fallback.jpg";
  }
}

function vote(winner) {
  const winnerTitle = winner === "A" ? movieA.title : movieB.title;
  const loserTitle = winner === "A" ? movieB.title : movieA.title;
  const matchupKey = [movieA.title, movieB.title].sort().join("|");

  if (auth.currentUser) {
    recordVoteToFirestore(`${winnerTitle}|${movieA.year}`);
  } else {
    stats[winnerTitle] = stats[winnerTitle] || { wins: 0, losses: 0 };
    stats[loserTitle] = stats[loserTitle] || { wins: 0, losses: 0 };
    stats[winnerTitle].wins++;
    stats[loserTitle].losses++;
    localStorage.setItem("movieStats", JSON.stringify(stats));
  }

  const votedPoster = document.getElementById(`poster${winner}`);
  votedPoster.classList.add("shake");
  createConfettiBurst(winner);
  setTimeout(() => votedPoster.classList.remove("shake"), 800);

  seenMatchups.push(matchupKey);
  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));

  setTimeout(chooseTwoMovies, 1500);
}

function createConfettiBurst(winner) {
  const container = document.getElementById(`confetti-container-${winner.toLowerCase()}`);
  if (!container) return;

  container.innerHTML = "";
  const colors = ['#1fd2ea', '#8b5cf6', '#d946ef', '#fcd34d', '#ef4444', '#10b981'];
  const TOTAL_CONFETTI = 200;

  for (let i = 0; i < TOTAL_CONFETTI; i++) {
    const dot = document.createElement("div");
    dot.className = "confetti-dot";
    dot.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    dot.style.left = "50%";
    dot.style.top = "50%";
    dot.style.transform = "translate(-50%, -50%)";
    dot.style.position = "absolute";
    dot.style.width = "8px";
    dot.style.height = "8px";
    dot.style.borderRadius = "50%";

    container.appendChild(dot);

    const angle = Math.random() * 2 * Math.PI;
    const distance = 120 + Math.random() * 200;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    const rotation = Math.random() * 720;
    const delay = Math.random() * 0.2;

    dot.animate([
      {
        transform: 'translate(-50%, -50%) rotate(0deg)',
        opacity: 1
      },
      {
        transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${rotation}deg)`,
        opacity: 0
      }
    ], {
      duration: 1200 + Math.random() * 500,
      easing: 'ease-out',
      fill: 'forwards',
      delay: delay * 1000
    });
  }
}

function markUnseen(slot) {
  const movie = slot === 'A' ? movieA : movieB;
  const key = `${movie.title}|${movie.year}`;

  if (!unseen.includes(key)) {
    unseen.push(key);
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));

    if (auth.currentUser) {
      const ref = doc(db, "users", auth.currentUser.uid);
      getDoc(ref).then(snapshot => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const merged = Array.from(new Set([...(data.seen || []), key]));
          updateDoc(ref, { seen: merged });
        }
      });
    }

    replaceMovie(movie);
  }
}

async function replaceMovie(movieToReplace) {
  const available = movies.filter(m => {
    const key = `${m.title}|${m.year}`;
    return (
      !unseen.includes(key) &&
      m.title !== movieA.title &&
      m.title !== movieB.title
    );
  });

  if (available.length === 0) {
    alert("No more unseen movies to replace with.");
    return;
  }

  const replacement = available[Math.floor(Math.random() * available.length)];

  if (movieToReplace.title === movieA.title) {
    movieA = replacement;
  } else {
    movieB = replacement;
  }

  await displayMovies();
}

window.onload = loadMovies;
