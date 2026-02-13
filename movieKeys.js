// movieKeys.js — Centralized movie key helpers
// Canonical key format: "Title|Year" (trimmed)

/**
 * Build a canonical movie key from title and year.
 */
export function makeMovieKey(title, year) {
  return `${String(title).trim()}|${String(year).trim()}`;
}

/**
 * Normalize a string for fuzzy matching:
 * lowercase, collapse whitespace, strip non-alphanumeric (keep spaces).
 */
function normalize(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Build a key normalizer from the canonical movie list.
 * Returns a function: normalizeKey(rawKey) → canonicalKey
 *
 * Handles:
 *  - Exact match (already canonical)
 *  - Whitespace/trim differences
 *  - "Title Year" format (no pipe, year appended to title)
 *  - Bare title with no year (matched against movie list)
 *  - Spelling variants via fuzzy matching
 */
export function buildKeyNormalizer(movieList) {
  // Canonical key set
  const canonicalKeys = new Set();
  // Fuzzy lookup: normalize(title) + "|" + year → canonical key
  const fuzzyMap = new Map();
  // Exact title lookup: exact title → canonical key (first match wins)
  const titleExactMap = new Map();
  // Fuzzy title lookup: normalize(title) → canonical key (first match wins)
  const titleFuzzyMap = new Map();

  for (const m of movieList) {
    if (!m.title || !m.year) continue;
    const key = makeMovieKey(m.title, m.year);
    canonicalKeys.add(key);

    const fuzzy = normalize(m.title) + "|" + String(m.year).trim();
    fuzzyMap.set(fuzzy, key);

    // For bare-title lookups, store exact and fuzzy title → key
    // Only store first occurrence (in case of duplicates in list)
    const trimmedTitle = m.title.trim();
    if (!titleExactMap.has(trimmedTitle)) {
      titleExactMap.set(trimmedTitle, key);
    }
    const fuzzyTitle = normalize(m.title);
    if (!titleFuzzyMap.has(fuzzyTitle)) {
      titleFuzzyMap.set(fuzzyTitle, key);
    }
  }

  // Cache resolved keys so we only resolve each raw key once
  const resolved = new Map();

  return function normalizeKey(rawKey) {
    if (resolved.has(rawKey)) return resolved.get(rawKey);

    let result = rawKey;

    // 1. Exact canonical match
    if (canonicalKeys.has(rawKey)) {
      resolved.set(rawKey, rawKey);
      return rawKey;
    }

    // 2. Has pipe — try splitting and normalizing
    if (rawKey.includes("|")) {
      const [t, y] = rawKey.split("|");
      const trimmed = makeMovieKey(t, y);
      if (canonicalKeys.has(trimmed)) {
        resolved.set(rawKey, trimmed);
        return trimmed;
      }
      // Fuzzy match with pipe
      const fuzzy = normalize(t) + "|" + String(y).trim();
      if (fuzzyMap.has(fuzzy)) {
        result = fuzzyMap.get(fuzzy);
        resolved.set(rawKey, result);
        return result;
      }
    }

    // 3. No pipe — try extracting 4-digit year from end of string
    const yearMatch = rawKey.match(/^(.+?)\s+((?:19|20)\d{2})$/);
    if (yearMatch) {
      const [, titlePart, yearPart] = yearMatch;
      const withPipe = makeMovieKey(titlePart, yearPart);
      if (canonicalKeys.has(withPipe)) {
        resolved.set(rawKey, withPipe);
        return withPipe;
      }
      // Fuzzy match
      const fuzzy = normalize(titlePart) + "|" + yearPart;
      if (fuzzyMap.has(fuzzy)) {
        result = fuzzyMap.get(fuzzy);
        resolved.set(rawKey, result);
        return result;
      }
    }

    // 4. Bare title (no pipe, no trailing year) — match by title alone
    const trimmedRaw = rawKey.trim();
    if (titleExactMap.has(trimmedRaw)) {
      result = titleExactMap.get(trimmedRaw);
      resolved.set(rawKey, result);
      return result;
    }
    // Fuzzy bare title
    const fuzzyRaw = normalize(rawKey);
    if (titleFuzzyMap.has(fuzzyRaw)) {
      result = titleFuzzyMap.get(fuzzyRaw);
      resolved.set(rawKey, result);
      return result;
    }

    // 5. No match — return as-is
    resolved.set(rawKey, result);
    return result;
  };
}
