// list.js
import {
  db,
  auth,
  onAuth,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs
} from "./firebase.js";
import { fetchTMDBRating } from "./unseen.js";

let moviesList = [];

// DOM references
const personalTbody = document.getElementById("personal-list");
const globalTbody   = document.getElementById("global-list");
const recentTbody   = document.getElementById("recent-votes");

window.addEventListener("load", async () => {
  try {
    const res = await fetch("movie_list_cleaned.json");
    moviesList = await res.json();
  } catch (e) {
    console.error("Movie list load failed:", e);
    return;
  }

  onAuth(async (user) => {
    if (user) {
      await renderPersonalStats(user.uid);
      await renderRecentVotes(user.uid);
    } else {
      personalTbody.innerHTML = `<tr><td colspan="4">Log in to see your stats.</td></tr>`;
      recentTbody.innerHTML  = `<tr><td colspan="3">Log in to see recent votes.</td></tr>`;
    }
    await renderGlobalStats();
  });
});

// … rest of renderPersonalStats, renderGlobalStats, renderRecentVotes as before …
