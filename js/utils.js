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
