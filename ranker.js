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

function getTier(movie) {
  const title = movie.title;
  const rating = ratings[title] || DEFAULT_RATING;
  const record = stats[title] || { wins: 0, losses: 0 };
  const total = record.wins + record.losses;

  if (total < 3) return "uncertain";
  if (rating >= 1100 && record.wins >= 3) return "high";
  if (rating <= 950 && record.losses >= 3) return "low";
  return "mid";
}

function chooseTwoMovies() {
  const available = getAvailableMovies();
  if (available.length < 2) {
    alert("Not enough unseen movies to compare.");
    return;
  }

  const shuffled = available.sort(() => 0.5 - Math.random());
  const anchor = shuffled.find(m => true);
  const anchorTier = getTier(anchor);

  const pairOptions = available.filter(m => {
    const pairKey = [anchor.title, m.title].sort().join("|");
    if (anchor.title === m.title) return false;
    if (seenMatchups.includes(pairKey)) return false;

    const tier = getTier(m);
    if (anchorTier === "uncertain" || tier === "uncertain") return true;
    if (anchorTier === tier) return true;
    return false;
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

function displayMovies() {
  if (document.getElementById("movieA")) {
    document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  }
  if (document.getElementById("movieB")) {
    document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;
  }
}

function vote(winner) {
  const winnerTitle = winner === "A" ? movieA.title : movieB.title;
  const loserTitle = winner === "A" ? movieB.title : movieA.title;

  updateElo(winnerTitle, loserTitle);
  updateStats(winnerTitle, loserTitle);

  const pairKey = [movieA.title, movieB.title].sort().join("|");
  seenMatchups.push(pairKey);

  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));
  localStorage.setItem("movieRatings", JSON.stringify(ratings));
  localStorage.setItem("movieStats", JSON.stringify(stats));

  if (document.getElementById("ranking-list")) updateRanking();
  chooseTwoMovies();
}

function updateElo(winnerTitle, loserTitle) {
  const Ra = ratings[winnerTitle] || DEFAULT_RATING;
  const Rb = ratings[loserTitle] || DEFAULT_RATING;

  const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));

  ratings[winnerTitle] = Math.round(Ra + K * (1 - Ea));
  ratings[loserTitle] = Math.round(Rb + K * (0 - (1 - Ea)));
}

function updateStats(winnerTitle, loserTitle) {
  stats[winnerTitle] = stats[winnerTitle] || { wins: 0, losses: 0 };
  stats[loserTitle] = stats[loserTitle] || { wins: 0, losses: 0 };
  stats[winnerTitle].wins += 1;
  stats[loserTitle].losses += 1;
}

function markUnseen(side) {
  const skippedTitle = side === "A" ? movieA.title : movieB.title;
  const preservedTitle = side === "A" ? movieB.title : movieA.title;

  if (!unseen.includes(skippedTitle)) {
    unseen.push(skippedTitle);
    localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    if (document.getElementById("unseen-list")) updateUnseenList();
  }

  const replacementOptions = getAvailableMovies([preservedTitle]);
  if (!replacementOptions.length) {
    alert("No movies left to compare against.");
    return;
  }

  const replacement = replacementOptions[Math.floor(Math.random() * replacementOptions.length)];
  if (side === "A") {
    movieA = replacement;
  } else {
    movieB = replacement;
  }

  displayMovies();
}

function updateRanking() {
  const listEl = document.getElementById("ranking-list");
  listEl.innerHTML = "";

  const ranked = [...movies]
    .filter(m => ratings[m.title] !== undefined && !unseen.includes(m.title))
    .sort((a, b) => (ratings[b.title] || DEFAULT_RATING) - (ratings[a.title] || DEFAULT_RATING));

  ranked.forEach(movie => {
    const title = movie.title;
    const rating = ratings[title] || DEFAULT_RATING;
    const record = stats[title] || { wins: 0, losses: 0 };
    const total = record.wins + record.losses;
    const winRate = total > 0 ? ((record.wins / total) * 100).toFixed(1) + "%" : "–";

    const li = document.createElement("li");
    li.innerHTML = `<strong>${title}</strong> (${movie.year}) — ${rating} pts (W:${record.wins}, L:${record.losses}, Win%: ${winRate}) ${renderTags(title)}`;
    li.appendChild(buildTagUI(title));
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
