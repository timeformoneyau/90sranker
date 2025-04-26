// myStats.js
import { auth, db, doc, getDoc } from "./firebase.js";

async function loadUserStats() {
  const container = document.getElementById("stats-container");
  if(!container) return;

  let voteCounts = {};
  let totalVotes = 0;
  let uniqueMovies = 0;
  let unseenCount = 0;

  if(auth.currentUser){
    try{
      const ref = doc(db,"users",auth.currentUser.uid);
      const snap = await getDoc(ref);
      const data = snap.exists()?snap.data():{votes:[],seen:[]};
      const votesArray = Array.isArray(data.votes)?data.votes:[];
      voteCounts = votesArray.reduce((a,k)=>{a[k]=(a[k]||0)+1;return a;},{});
      unseenCount = Array.isArray(data.seen)?data.seen.length:0;
      totalVotes = votesArray.length;
      uniqueMovies = Object.keys(voteCounts).length;
    }catch(err){
      console.error("Stats load fail:",err);
    }
  } else {
    const statsMap = JSON.parse(localStorage.getItem("movieStats"))||{};
    voteCounts = Object.fromEntries(Object.entries(statsMap)
      .filter(([,v])=>v.wins>0).map(([k,v])=>[k,v.wins]));
    totalVotes = Object.values(voteCounts).reduce((a,b)=>a+b,0);
    uniqueMovies = Object.keys(voteCounts).length;
    unseenCount = JSON.parse(localStorage.getItem("unseenMovies"))?.length||0;
  }

  const topEntries = Object.entries(voteCounts)
    .sort(([,a],[,b])=>b-a)
    .slice(0,10);

  const rows = topEntries.map(([k,c])=>{const [t,y]=k.split("|");return`<tr><td>${t} (${y})</td><td>${c}</td></tr>`;}).join("");

  container.innerHTML = `
    <h2>Your Stats</h2>
    <p><strong>Total Votes:</strong> ${totalVotes}</p>
    <p><strong>Unique Movies Voted:</strong> ${uniqueMovies}</p>
    <p><strong>Unseen Movies:</strong> ${unseenCount}</p>
    <h3>Top Voted Movies</h3>
    <table><thead><tr><th>Movie</th><th>Votes</th></tr></thead><tbody>${rows||'<tr><td colspan="2">No votes.</td></tr>'}</tbody></table>
  `;
}

window.addEventListener("load", loadUserStats);
