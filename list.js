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
    ratingCell.textContent = rating;

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
