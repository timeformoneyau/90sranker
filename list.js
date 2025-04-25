// list.js
import { auth, db } from "./auth.js";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

let movies = [];
let unseen = [];
const tags = JSON.parse(localStorage.getItem("movieTags")) || {};
const stats = JSON.parse(localStorage.getItem("movieStats")) || {};

// ——— Load movies and initial data ———
async function loadMovieList() {
  // Fetch movie list
  const res = await fetch("movie_list_cleaned.json"); movies = await res.json();

  // Load unseen
  if (auth.currentUser) {
    try {
      const ref = doc(db, "users", auth.currentUser.uid);
      const snap = await getDoc(ref);
      unseen = snap.exists() ? (snap.data().seen || []) : [];
      localStorage.setItem("unseenMovies", JSON.stringify(unseen));
    } catch {
      unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
    }
  } else {
    unseen = JSON.parse(localStorage.getItem("unseenMovies")) || [];
  }

  renderPersonal();
  renderRankings();
  renderUnseen();
  renderTags();
  renderRecentVotes();
}

// ——— Render personal top 20 ———
function renderPersonal() {
  const tbody = document.getElementById("personal-list"); tbody.innerHTML = "";
  const personal = Object.entries(stats)
    .map(([key,val]) => ({ key, wins: val.wins, losses: val.losses }))
    .sort((a,b) => b.wins - a.wins)
    .slice(0,20);

  personal.forEach(({key,wins,losses}) => {
    const [title,year] = key.split("|");
    const percent = wins+losses ? Math.round(100*wins/(wins+losses)) : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${title} (${year})</td>
      <td>${wins}</td>
      <td>${losses}</td>
      <td>${percent}%</td>
    `;
    tbody.appendChild(tr);
  });
}

// ——— Render global top 20 ———
async function renderRankings() {
  const tbody = document.getElementById("ranking-list"); tbody.innerHTML = "";
  try {
    const snap = await getDocs(collection(db,"votes"));
    const globalStats = {};
    snap.forEach(d => {
      const w = d.data().winner;
      globalStats[w] = (globalStats[w]||0)+1;
    });
    Object.entries(globalStats)
      .map(([key,wins]) => ({key,wins}))
      .sort((a,b)=>b.wins-a.wins)
      .slice(0,20)
      .forEach(({key,wins})=>{
        const [title,year]=key.split("|");
        const tr=document.createElement("tr");
        tr.innerHTML=`<td>${title} (${year})</td><td>${wins}</td>`;
        tbody.appendChild(tr);
      });
  } catch {
    // fallback
  }
}

// ——— Render unseen list ———
async function renderUnseen() {
  const tbody = document.getElementById("unseen-list"); if (!tbody) return; tbody.innerHTML="";
  const list = movies.filter(m=>unseen.includes(`${m.title}|${m.year}`));
  for (const movie of list) {
    const rating = await fetchTMDBRating(movie.title,movie.year)||"N/A";
    const key = `${movie.title}|${movie.year}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${movie.title}</td>
      <td>${movie.year}</td>
      <td>${typeof rating==="number"?rating.toFixed(1):rating}</td>
      <td><button onclick="putBack('${key}')">Put Back</button></td>
    `;
    tbody.appendChild(tr);
  }
}

// ——— Put back unseen ———
async function putBack(key) {
  const idx = unseen.indexOf(key); if (idx<0) return;
  unseen.splice(idx,1);
  if (auth.currentUser) {
    await updateDoc(doc(db,"users",auth.currentUser.uid),{seen:unseen});
  } else {
    localStorage.setItem("unseenMovies",JSON.stringify(unseen));
  }
  renderUnseen();
}
window.putBack = putBack;

// ——— Render tags ———
function renderTags() {
  const ul = document.getElementById("tagged-list"); if(!ul) return; ul.innerHTML="";
  const keys=Object.keys(tags);
  if (!keys.length) { ul.innerHTML="<li>No tagged movies yet.</li>"; return; }
  for (const k of keys) {
    const [title,year]=k.split("|");
    const li=document.createElement("li");
    li.textContent=`${title} (${year}) — ${tags[k].join(",")}`;
    ul.appendChild(li);
  }
}

// ——— Fetch recent votes ———
async function renderRecentVotes() {
  const tbody = document.getElementById("recent-votes"); if(!tbody) return; tbody.innerHTML="";
  try {
    const q = query(collection(db,"votes"), orderBy("timestamp","desc"), limit(10));
    const snap = await getDocs(q);
    snap.forEach(docSnap => {
      const data = docSnap.data();
      const dt = new Date(data.timestamp);
      const formatted = dt.toLocaleString('en-US',{
        year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit'
      });
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${formatted}</td><td>${data.winner}</td><td>${data.loser||''}</td>`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load recent votes:", err);
  }
}

// ——— TMDB rating helper ———
const TMDB_API_KEY = "825459de57821b3ab63446cce9046516";
async function fetchTMDBRating(title, year) {
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&year=${year}`;
    const res = await fetch(url); const json = await res.json();
    return json.results?.[0]?.vote_average || null;
  } catch { return null; }
}

// ——— Initialize on load ———
window.addEventListener('load', loadMovieList);

