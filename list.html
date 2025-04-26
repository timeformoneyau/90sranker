// list.js
import { db, doc, onSnapshot } from "./firebase.js";
import { fetchTMDBRating } from "./unseen.js";

let moviesList = [];
const statsList   = JSON.parse(localStorage.getItem("movieStats")) || {};
const ratingsList = JSON.parse(localStorage.getItem("movieRatings")) || {};
const unseenList  = JSON.parse(localStorage.getItem("unseenMovies")) || [];
const tagsList    = JSON.parse(localStorage.getItem("movieTags")) || {};

window.onload = loadMovieList;

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

function renderRankings() {
  const tbl = document.getElementById("ranking-list");
  if (!tbl) return;
  tbl.innerHTML = "";
  Object.entries(statsList)
    .map(([t, r]) => {
      const rt = ratingsList[t] || 1000;
      const tot = r.wins + r.losses;
      return {
        title: t,
        year: (moviesList.find((m) => m.title === t) || {}).year || "",
        wins: r.wins,
        losses: r.losses,
        rating: rt,
        winPct: tot ? ((r.wins / tot) * 100).toFixed(1) : "0.0"
      };
    })
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 20)
    .forEach((m) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${m.title}</td><td>${m.year}</td><td>${m.rating}</td><td>${m.wins}</td><td>${m.losses}</td><td>${m.winPct}%</td>`;
      tbl.appendChild(tr);
    });
}

function renderGlobalRankings() {
  const gt = document.getElementById("global-list");
  if (!gt) return;
  gt.innerHTML = "<tr><td colspan='5'>Loading global rankings...</td></tr>";
  const globalRef = doc(db, "stats", "global");
  onSnapshot(
    globalRef,
    (docSnap) => {
      const data = docSnap.data()?.stats || {};
      gt.innerHTML = "";
      const entries = Object.entries(data).map(([t, r]) => {
        const tot = r.wins + r.losses;
        return {
          title: t,
          year: (moviesList.find((m) => m.title === t) || {}).year || "",
          wins: r.wins,
          losses: r.losses,
          winPct: tot ? ((r.wins / tot) * 100).toFixed(1) : "0.0"
        };
      });
      if (!entries.length)
        return (gt.innerHTML = "<tr><td colspan='5'>No global data</td></tr>");
      entries
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 20)
        .forEach((m) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${m.title}</td><td>${m.year}</td><td>${m.wins}</td><td>${m.losses}</td><td>${m.winPct}%</td>`;
          gt.appendChild(tr);
        });
    },
    (err) => {
      console.error(err);
      gt.innerHTML = `<tr><td colspan='5'>Error loading: ${err.message}</td></tr>`;
    }
  );
}

async function renderUnseen() {
  const ut = document.getElementById("unseen-list");
  if (!ut) return;
  ut.innerHTML = "";
  const uMovies = moviesList.filter((m) =>
    unseenList.includes(`${m.title}|${m.year}`)
  );
  if (!uMovies.length)
    return (ut.innerHTML = "<tr><td colspan='4'>No unseen movies.</td></tr>");
  const scored = await Promise.all(
    uMovies.map(async (m) => ({
      ...m,
      tmdbRating: (await fetchTMDBRating(m.title, m.year)) || 0
    }))
  );
  scored
    .sort((a, b) => b.tmdbRating - a.tmdbRating)
    .slice(0, 20)
    .forEach((m) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${m.title}</td><td>${m.year}</td><td>${m.tmdbRating.toFixed(
        1
      )}</td><td><button onclick="putBack('${m.title}|${m.year}')">Put Back</button></td>`;
      ut.appendChild(tr);
    });
}

function renderTags() {
  const tl = document.getElementById("tagged-list");
  if (!tl) return;
  tl.innerHTML = "";
  const keys = Object.keys(tagsList);
  if (!keys.length) return (tl.innerHTML = "<li>No tagged movies yet.</li>");
  keys.forEach((t) => {
    const li = document.createElement("li");
    li.textContent = `${t} — ${tagsList[t].join(", ")}`;
    tl.appendChild(li);
  });
}

function putBack(key) {
  const idx = unseenList.indexOf(key);
  if (idx > -1) unseenList.splice(idx, 1);
  localStorage.setItem("unseenMovies", JSON.stringify(unseenList));
  renderUnseen();
}
