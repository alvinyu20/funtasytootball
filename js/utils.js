function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Runs `worker` over `items` with at most `limit` in flight at once.
// Used when pulling many weeks/seasons of history so we don't fire 100+
// requests at Sleeper simultaneously.
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runNext() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(runners);
  return results;
}

async function fetchJsonSafe(path, fallback) {
  try {
    const res = await fetch(path);
    if (!res.ok) return fallback;
    return await res.json();
  } catch (err) {
    console.warn(`Couldn't load ${path}, using fallback.`, err);
    return fallback;
  }
}

// Linear-interpolates between two "#rrggbb" hex colors. t is clamped to [0,1].
function interpolateColor(hexLow, hexHigh, t) {
  const clamp = Math.max(0, Math.min(1, t));
  const a = [1, 3, 5].map((i) => parseInt(hexLow.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexHigh.slice(i, i + 2), 16));
  const rgb = a.map((v, i) => Math.round(v + (b[i] - v) * clamp));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

// Maps a value to a color scaled to that value's own min/max range — used
// so each heatmap column is standardized independently rather than
// against a single shared scale. Three-stop gradient: red (low) through
// yellow (middle) to green (high).
function heatColor(value, min, max, lowHex = "#D9534F", midHex = "#E8C13D", highHex = "#5CB85C") {
  if (max === min) return midHex;
  const t = (value - min) / (max - min);
  if (t <= 0.5) return interpolateColor(lowHex, midHex, t / 0.5);
  return interpolateColor(midHex, highHex, (t - 0.5) / 0.5);
}

// Formats a "Luck" percentage (actual win% minus overall/all-play win%)
// with a leading sign and red/green coloring.
function luckBadge(pct) {
  const cls = pct > 0 ? "luck-positive" : pct < 0 ? "luck-negative" : "luck-neutral";
  const text = pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
  return `<span class="${cls}">${text}</span>`;
}

// A round manager/team avatar with the same graceful initial-letter
// fallback as playerPhotoHtml. avatarId should already be a full CDN
// URL (from SleeperAPI.avatarUrl) or null/undefined for no avatar.
// A round player headshot with a graceful fallback (an initial-letter
// tile) if the image 404s — Sleeper's headshot CDN is undocumented and
// doesn't have a photo for every player (notably team defenses).
// sizeClass: "player-photo-lg" or "player-photo-sm" (see styles.css).
function playerPhotoHtml(playerId, playerName, sizeClass) {
  const initial = playerName ? playerName.trim().charAt(0).toUpperCase() : "?";
  if (!playerId) {
    return `<div class="player-photo-wrap ${sizeClass || ""}"><div class="player-photo-fallback" style="display:flex;">${escapeHtml(initial)}</div></div>`;
  }
  const url = SleeperAPI.playerImageUrl(playerId);
  return `
    <div class="player-photo-wrap ${sizeClass || ""}">
      <img src="${url}" alt="${escapeHtml(playerName || "")}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
      <div class="player-photo-fallback">${escapeHtml(initial)}</div>
    </div>`;
}

// A round manager/team avatar with the same graceful initial-letter
// fallback as playerPhotoHtml. avatarUrl should already be a full CDN
// URL (from SleeperAPI.avatarUrl) or null/undefined for no avatar.
function userAvatarHtml(avatarUrl, name, sizeClass) {
  const initial = name ? name.trim().charAt(0).toUpperCase() : "?";
  if (!avatarUrl) {
    return `<div class="player-photo-wrap ${sizeClass || ""}"><div class="player-photo-fallback" style="display:flex;">${escapeHtml(initial)}</div></div>`;
  }
  return `
    <div class="player-photo-wrap ${sizeClass || ""}">
      <img src="${avatarUrl}" alt="${escapeHtml(name || "")}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
      <div class="player-photo-fallback">${escapeHtml(initial)}</div>
    </div>`;
}

// Box-Muller transform — draws one sample from a normal distribution.
// Used by the Monte Carlo playoff-odds simulator.
function gaussianRandom(mean = 0, stdev = 1) {
  const u = 1 - Math.random(); // (0,1]
  const v = Math.random();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return z * stdev + mean;
}

// Normalizes a player name for matching (lowercase, strips everything but
// letters/numbers) so "Jaxon Smith-Njigba" and "Jaxon Smith Njigba" match.
function normalizePlayerName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Builds a normalized-name -> player_id lookup from the player directory,
// for matching free-text names (e.g. from data/season-awards.json, which
// only stores names, not IDs) back to a real player for a photo.
function buildPlayerNameIndex(playerDirectory) {
  const index = new Map();
  Object.entries(playerDirectory || {}).forEach(([pid, p]) => {
    if (p && p.full_name) {
      const key = normalizePlayerName(p.full_name);
      if (key && !index.has(key)) index.set(key, pid); // first match wins on a rare collision
    }
  });
  return index;
}

// Looks up a player_id from free text like "Todd Gurley, 16th" — strips a
// trailing draft-pick suffix if present, then matches by normalized name.
// Returns null (not a guess) if there's no confident match, since a wrong
// photo is worse than no photo.
function findPlayerIdByName(rawName, nameIndex) {
  if (!rawName || !nameIndex) return null;
  const cleaned = rawName.replace(/,\s*\d+(st|nd|rd|th)\.?$/i, "").trim();
  const key = normalizePlayerName(cleaned);
  return nameIndex.get(key) || null;
}

// Small colored pill for a draft pick grade (A+ through F). Grades come
// from DeepHistory.gradeDraftPick — a null/missing grade renders nothing,
// since not every pick can be graded (e.g. a player who never scored).
// Small colored pill for a draft pick grade (A+ through F). Grades come
// from DeepHistory.gradeDraftPick — a null/missing grade renders nothing,
// since not every pick can be graded (e.g. a player who never scored).
// Color is a smooth green -> yellow -> red gradient across the 7 possible
// grades (computed, not 5 discrete bands), so a B+ and a B genuinely look
// different rather than sharing one color.
const GRADE_ORDER = ["A+", "A", "B+", "B", "C", "D", "F"];
function gradeBadgeHtml(grade) {
  if (!grade) return "";
  const idx = GRADE_ORDER.indexOf(grade);
  if (idx === -1) return "";
  const hue = 120 - (idx / (GRADE_ORDER.length - 1)) * 120; // 120 = green, 60 = yellow, 0 = red
  return `<span class="grade-badge" style="background:hsl(${hue.toFixed(0)}, 68%, 45%);">${escapeHtml(grade)}</span>`;
}
