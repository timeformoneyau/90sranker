// enrich-directors.js
// One-time script: adds a "director" field to every entry in movie_list_cleaned.json
// Uses the TMDB API (same key as the app). Run with: node enrich-directors.js

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(__dirname, "movie_list_cleaned.json");
const API_KEY   = "825459de57821b3ab63446cce9046516";
const BASE      = "https://api.themoviedb.org/3";
const CONCURRENCY = 5;   // parallel requests at a time
const DELAY_MS    = 150; // ms between batches (well under TMDB's 40 req/10s limit)

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function tmdb(endpoint, params = {}) {
  const url = new URL(`${BASE}${endpoint}`);
  url.searchParams.set("api_key", API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${endpoint}`);
  return res.json();
}

async function fetchDirector(title, year) {
  // 1. Search with year
  let data = await tmdb("/search/movie", { query: title, year, include_adult: false });

  // 2. Fallback: search without year (catches off-by-one year issues)
  if (!data.results?.length) {
    data = await tmdb("/search/movie", { query: title, include_adult: false });
  }

  const movieId = data.results?.[0]?.id;
  if (!movieId) return null;

  // 3. Fetch credits for this movie
  const credits = await tmdb(`/movie/${movieId}/credits`);
  const directorEntry = credits.crew?.find(c => c.job === "Director");
  return directorEntry?.name ?? null;
}

// ── main ─────────────────────────────────────────────────────────────────────

const movies = JSON.parse(await fs.readFile(JSON_PATH, "utf8"));
const total   = movies.length;
const todo    = movies.filter(m => m.director === undefined);

console.log(`Total movies: ${total}`);
console.log(`Already enriched: ${total - todo.length}`);
console.log(`To process: ${todo.length}\n`);

if (todo.length === 0) {
  console.log("Nothing to do — all movies already have a director field.");
  process.exit(0);
}

let done = 0;
let found = 0;
let notFound = 0;

// Process in batches of CONCURRENCY
for (let i = 0; i < todo.length; i += CONCURRENCY) {
  const batch = todo.slice(i, i + CONCURRENCY);

  await Promise.all(batch.map(async movie => {
    try {
      const director = await fetchDirector(movie.title, movie.year);
      movie.director = director;
      if (director) { found++; } else { notFound++; }
    } catch (err) {
      movie.director = null;
      notFound++;
      console.warn(`  ⚠ Error for "${movie.title}" (${movie.year}): ${err.message}`);
    }
    done++;
  }));

  // Progress line (overwrites previous)
  const pct = Math.round((done / todo.length) * 100);
  process.stdout.write(`\r  ${done}/${todo.length} (${pct}%)  found: ${found}  missing: ${notFound}   `);

  // Save progress to disk every 50 movies so a crash doesn't lose work
  if (done % 50 === 0 || done === todo.length) {
    await fs.writeFile(JSON_PATH, JSON.stringify(movies, null, 2));
  }

  await sleep(DELAY_MS);
}

// Final save
await fs.writeFile(JSON_PATH, JSON.stringify(movies, null, 2));

console.log(`\n\nDone!`);
console.log(`  Directors found:   ${found}`);
console.log(`  Not found (null):  ${notFound}`);
console.log(`\n  movie_list_cleaned.json updated.`);
console.log(`  Commit it when happy: git add movie_list_cleaned.json && git commit -m "Enrich: add director field"`);
