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
  return "fallback.jpg"; // Optional local placeholder
}

async function displayMovies() {
  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;

  const posterA = await fetchPosterUrl(movieA.title, movieA.year);
  const posterB = await fetchPosterUrl(movieB.title, movieB.year);

  const imgA = document.getElementById("posterA");
  const imgB = document.getElementById("posterB");

  if (imgA) imgA.src = posterA;
  if (imgB) imgB.src = posterB;

  // Ensure popcorn containers are removed from previous movies
  const existingContainers = document.querySelectorAll('.popcorn-container');
  existingContainers.forEach(container => container.remove());
}

function createPopcornBurst(element) {
  // Clean up any existing popcorn containers first
  const existingContainer = element.querySelector('.popcorn-container');
  if (existingContainer) {
    existingContainer.remove();
  }
  
  // Create popcorn container
  const container = document.createElement('div');
  container.className = 'popcorn-container';
  
  // Create 30 popcorn kernels with different variations
  for (let i = 0; i < 30; i++) {
    const kernel = document.createElement('div');
    kernel.className = 'popcorn-kernel k' + (Math.floor(Math.random() * 3) + 1);
    
    // Random position for burst direction
    const angle = Math.random() * Math.PI * 2;
    const distance = 50 + Math.random() * 150;
    const xPos = Math.cos(angle) * distance;
    const yPos = Math.sin(angle) * distance;
    const rotation = Math.random() * 720 - 360; // Random rotation -360 to 360
    
    // Random delay for more natural effect
    const delay = Math.random() * 0.3;
    
    kernel.style.setProperty('--x', `${xPos}px`);
    kernel.style.setProperty('--y', `${yPos}px`);
    kernel.style.setProperty('--r', `${rotation}deg`);
    kernel.style.animationDelay = `${delay}s`;
    
    container.appendChild(kernel);
  }
  
  // Add container to the element
  element.appendChild(container);
  
  // Trigger animation after a small delay to ensure DOM is updated
  setTimeout(() => {
    container.classList.add('popcorn-burst-active');
  }, 10);
  
  // Remove animation class after completion
  setTimeout(() => {
    if (container && container.parentNode) {
      container.classList.remove('popcorn-burst-active');
    }
  }, 1500);
}

function vote(winner) {
  const winnerTitle = winner === "A" ? movieA.title : movieB.title;
  const loserTitle = winner === "A" ? movieB.title : movieA.title;

  const votedPoster = document.getElementById(`poster${winner}`);
  if (votedPoster) {
    // Add shake effect
    votedPoster.classList.add("popcorn-shake");
    
    // Create new popcorn burst animation
    createPopcornBurst(votedPoster.parentElement);
    
    // Keep the old popcorn animation for compatibility
    const popcorn = document.getElementById("popcorn-burst");
    if (popcorn) {
      const pops = popcorn.querySelectorAll(".pop");
      
      const rect = votedPoster.getBoundingClientRect();
      popcorn.style.left = `${rect.left + window.scrollX + rect.width / 2 - 50}px`;
      popcorn.style.top = `${rect.top + window.scrollY - 30}px`;
      
      pops.forEach((pop, i) => {
        pop.style.animation = `pop${i + 1} 0.8s ease-out forwards`;
      });
    }

    // Remove shake class after animation completes
    setTimeout(() => {
      votedPoster.classList.remove("popcorn-shake");
      if (popcorn) {
        const pops = popcorn.querySelectorAll(".pop");
        pops.forEach(pop => {
          pop.style.animation = "none";
        });
      }
    }, 800);
  }

  updateElo(winnerTitle, loserTitle);
  updateStats(winnerTitle, loserTitle);

  const pairKey = [movieA.title, movieB.title].sort().join("|");
  seenMatchups.push(pairKey);

  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));
  localStorage.setItem("movieRatings", JSON.stringify(ratings));
  localStorage.setItem("movieStats", JSON.stringify(stats));

  if (document.getElementById("ranking-list")) updateRanking();
  
  // Delay choosing new movies to allow animation to complete
  setTimeout(() => {
    chooseTwoMovies();
  }, 1200);
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
