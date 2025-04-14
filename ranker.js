let movies = [];
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];
let tags = JSON.parse(localStorage.getItem("movieTags")) || {};

let movieA, movieB;
const TAG_OPTIONS = ["Nostalgic Favorite", "Dumb Awesome", "Top 50"];
const DEFAULT_RATING = 1000;
const K = 32;

async function loadMovies() {
  const response = await fetch("movie_list_cleaned.json");
  movies = await response.json();
  updateRanking();
  updateUnseenList();
  updateTaggedList();
  chooseTwoMovies();
}

function getAvailableMovies(exclude = []) {
  return movies.filter(m => m.title && !unseen.includes(m.title) && !exclude.includes(m.title));
}

function chooseTwoMovies(preserveSide = null) {
  const available = getAvailableMovies();

  let newA = movieA;
  let newB = movieB;

  if (preserveSide === 'B') {
    const candidates = available.filter(m => m.title !== movieB?.title);
    newA = candidates[Math.floor(Math.random() * candidates.length)];
    newB = movieB;
  } else if (preserveSide === 'A') {
    const candidates = available.filter(m => m.title !== movieA?.title);
    newA = movieA;
    newB = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    const shuffled = available.sort(() => 0.5 - Math.random());
    [newA, newB] = shuffled.slice(0, 2);
  }

  if (!newA || !newB) {
    alert("Not enough unseen movies to compare.");
    return;
  }

  movieA = newA;
  movieB = newB;

  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;
}

function vote(winner) {
  const winnerTitle = winner === 'A' ? movieA.title : movieB.title;
  const loserTitle = winner === 'A' ? movieB.title : movieA.title;

  updateElo(winnerTitle, loserTitle);

  const pairKey = [movieA.title, movieB.title].sort().join("|");
  seenMatchups.push(pairKey);

  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));
  localStorage.setItem("movieRatings", JSON.stringify(ratings));

  updateRanking();
  chooseTwoMovies();
}

function updateElo(winnerTitle, loserTitle) {
  const Ra = ratings[winnerTitle] || DEFAULT_RATING;
  const Rb = ratings[loserTitle] || DEFAULT_RATING;

  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
  const Eb = 1 - Ea;

  const newRa = Ra + K * (1 - Ea);
  const newRb = Rb + K * (0 - Eb);

  ratings[winnerTitle] = Math.round(newRa);
  ratings[loserTitle] = Math.round(newRb);
}

function markUnseen(side) {
  const unseenTitle = side === 'A' ? movieA.title : movieB.title;

  if (!unseen.includes(unseenTitle)) {
    unseen.push(unseenTitle);
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  }

  updateUnseenList();

  if (side === 'A') {
    chooseTwoMovies('B');
  } else {
    chooseTwoMovies('A');
  }
}

function updateRanking() {
  const listEl = document.getElementById("ranking-list");
  listEl.innerHTML = "";

  const ranked = [...movies]
    .filter(m => ratings[m.title] !== undefined && !unseen.includes(m.title))
    .sort((a, b) => (ratings[b.title] || DEFAULT_RATING) - (ratings[a.title] || DEFAULT_RATING));

  ranked.forEach(movie => {
    const rating = ratings[movie.title] || DEFAULT_RATING;
    const li = document.createElement("li");
    li.innerHTML = `<strong>${movie.title}</strong> (${movie.year}) — ${rating} pts ${renderTags(movie.title)}`;
    li.appendChild(buildTagUI(movie.title));
    listEl.appendChild(li);
  });
}

function updateUnseenList() {
  const unseenList = document.getElementById("unseen-list");
  unseenList.innerHTML = "";

  unseen.forEach(title => {
    const li = document.createElement("li");
    li.textContent = title + " ";
    const button = document.createElement("button");
    button.textContent = "Put Back";
    button.onclick = () => {
      unseen = unseen.filter(t => t !== title);
      localStorage.setItem("unseenMovies", JSON.stringify(unseen));
      updateUnseenList();
      chooseTwoMovies();
    };
    li.appendChild(button);
    unseenList.appendChild(li);
  });
}

function renderTags(title) {
  return tags[title] ? `— Tags: ${tags[title].join(", ")}` : "";
}

function buildTagUI(title) {
  const wrapper = document.createElement("div");
  TAG_OPTIONS.forEach(tag => {
    const btn = document.createElement("button");
    btn.className = "tag-button";
    btn.textContent = tags[title]?.includes(tag) ? `✓ ${tag}` : tag;
    btn.onclick = () => {
      tags[title] = tags[title] || [];
      if (tags[title].includes(tag)) {
        tags[title] = tags[title].filter(t => t !== tag);
      } else {
        tags[title].push(tag);
      }
      localStorage.setItem("movieTags", JSON.stringify(tags));
      updateRanking();
      updateTaggedList();
    };
    wrapper.appendChild(btn);
  });
  return wrapper;
}

function updateTaggedList() {
  const taggedList = document.getElementById("tagged-list");
  taggedList.innerHTML = "";

  Object.keys(tags).forEach(title => {
    const movie = movies.find(m => m.title === title);
    if (!movie || !tags[title].length) return;

    const li = document.createElement("li");
    li.innerHTML = `<strong>${movie.title}</strong> (${movie.year}) — ${tags[title].join(", ")}`;
    taggedList.appendChild(li);
  });
}

window.onload = loadMovies;
