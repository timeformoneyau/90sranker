let movies = [];
let ratings = JSON.parse(localStorage.getItem("movieRatings")) || {};
let stats = JSON.parse(localStorage.getItem("movieStats")) || {};
let unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
let tags = JSON.parse(localStorage.getItem("movieTags")) || {};

async function loadLists() {
  const response = await fetch("movie_list_cleaned.json");
  movies = await response.json();
  updateRanking();
  updateUnseenList();
  updateTaggedList();
}

function updateRanking() {
  const listEl = document.getElementById("ranking-list");
  listEl.innerHTML = "";

  const ranked = [...movies]
    .filter(m => ratings[m.title] !== undefined && !unseen.includes(m.title))
    .sort((a, b) => (ratings[b.title] || 1000) - (ratings[a.title] || 1000));

  ranked.forEach(movie => {
    const title = movie.title;
    const rating = ratings[title] || 1000;
    const record = stats[title] || { wins: 0, losses: 0 };
    const total = record.wins + record.losses;
    const winRate = total > 0 ? ((record.wins / total) * 100).toFixed(1) + "%" : "–";

    const row = document.createElement("tr");

    const titleCell = document.createElement("td");
    titleCell.textContent = `${title} (${movie.year})`;
    titleCell.className = "movie-title-cell";

    const ratingCell = document.createElement("td");
    ratingCell.textContent = `${rating}`;

    const winsCell = document.createElement("td");
    winsCell.textContent = record.wins;

    const lossesCell = document.createElement("td");
    lossesCell.textContent = record.losses;

    const winRateCell = document.createElement("td");
    winRateCell.textContent = winRate;

    row.appendChild(titleCell);
    row.appendChild(ratingCell);
    row.appendChild(winsCell);
    row.appendChild(lossesCell);
    row.appendChild(winRateCell);

    listEl.appendChild(row);
  });
}

function updateUnseenList() {
  const unseenList = document.getElementById("unseen-list");
  unseenList.innerHTML = "";

  unseen.forEach(title => {
    const row = document.createElement("tr");

    const titleCell = document.createElement("td");
    titleCell.textContent = title;

    const buttonCell = document.createElement("td");
    const button = document.createElement("button");
    button.textContent = "Put Back";
    button.onclick = () => {
      unseen = unseen.filter(t => t !== title);
      localStorage.setItem("unseenMovies", JSON.stringify(unseen));
      updateUnseenList();
      updateRanking();
    };
    buttonCell.appendChild(button);

    row.appendChild(titleCell);
    row.appendChild(buttonCell);
    unseenList.appendChild(row);
  });
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

function exportToCSV() {
  const rows = [["Title", "Year", "Rating", "Wins", "Losses", "Win %", "Tags"]];

  movies.forEach(movie => {
    const title = movie.title;
    if (ratings[title] === undefined || unseen.includes(title)) return;

    const rating = ratings[title] || 1000;
    const record = stats[title] || { wins: 0, losses: 0 };
    const total = record.wins + record.losses;
    const winRate = total > 0 ? ((record.wins / total) * 100).toFixed(1) + "%" : "–";
    const tagList = tags[title] ? tags[title].join("; ") : "";

    rows.push([
      title,
      movie.year,
      rating,
      record.wins,
      record.losses,
      winRate,
      tagList
    ]);
  });

  const csvContent = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "movie_rankings.csv");
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

window.onload = loadLists;
