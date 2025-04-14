let movies = [];
let scores = JSON.parse(localStorage.getItem("movieScores")) || {};
let unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let seenMatchups = JSON.parse(localStorage.getItem("seenMatchups")) || [];

let movieA, movieB;

async function loadMovies() {
  const response = await fetch("movie_list_cleaned.json");
  movies = await response.json();
  updateRanking();
  updateUnseenList();
  chooseTwoMovies();
}

function getAvailableMovies() {
  return movies.filter(m => m.title && !unseen.includes(m.title));
}

function chooseTwoMovies() {
  const available = getAvailableMovies();

  // Filter out any combinations we've already seen
  let unseenPairs = [];
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const pairKey = [available[i].title, available[j].title].sort().join("|");
      if (!seenMatchups.includes(pairKey)) {
        unseenPairs.push([available[i], available[j]]);
      }
    }
  }

  if (unseenPairs.length === 0) {
    alert("You've completed all possible comparisons with the current list!");
    return;
  }

  const [m1, m2] = unseenPairs[Math.floor(Math.random() * unseenPairs.length)];
  movieA = m1;
  movieB = m2;

  document.getElementById("movieA").textContent = `${movieA.title} (${movieA.year})`;
  document.getElementById("movieB").textContent = `${movieB.title} (${movieB.year})`;
}

function vote(winner) {
  const winnerTitle = winner === 'A' ? movieA.title : movieB.title;
  const loserTitle = winner === 'A' ? movieB.title : movieA.title;

  scores[winnerTitle] = (scores[winnerTitle] || 0) + 1;
  scores[loserTitle] = scores[loserTitle] || 0;

  const pairKey = [movieA.title, movieB.title].sort().join("|");
  seenMatchups.push(pairKey);

  localStorage.setItem("movieScores", JSON.stringify(scores));
  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));

  updateRanking();
  chooseTwoMovies();
}

function markUnseen() {
  if (!unseen.includes(movieA.title)) unseen.push(movieA.title);
  if (!unseen.includes(movieB.title)) unseen.push(movieB.title);

  const pairKey = [movieA.title, movieB.title].sort().join("|");
  seenMatchups.push(pairKey);

  localStorage.setItem("unseenMovies", JSON.stringify(unseen));
  localStorage.setItem("seenMatchups", JSON.stringify(seenMatchups));

  updateUnseenList();
  chooseTwoMovies();
}

function updateRanking() {
