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

// Loads one of this site's own data files (data/*.json). `cache: "no-cache"`
// makes the browser ask the server "has this changed?" on every load
// instead of trusting whatever it kept for the last ten minutes (GitHub
// Pages' default max-age) — an unchanged file comes back as a tiny 304 and
// is reused, a changed one (say, after the weekly power-rankings workflow
// commits new numbers) is downloaded immediately.
async function fetchJsonSafe(path, fallback) {
  try {
    const res = await fetch(path, { cache: "no-cache" });
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

// The site's one heat scale: blue for the weak end, yellow for the strong end,
// and a dark neutral in the middle that melts into the panel so only the
// extremes pull the eye. Same three hexes as --heat-low / --heat-mid /
// --heat-high in styles.css (sampled from the lineup-slot mockup).
const HEAT_LOW = "#336B7A";
const HEAT_MID = "#1C4036";
const HEAT_HIGH = "#7C5D31";

// Maps a value to a color scaled to that value's own min/max range — used
// so each heatmap column is standardized independently rather than
// against a single shared scale. Three-stop gradient: blue (low) through
// the dark neutral (middle) to yellow (high); pass the hexes in the other order
// for a metric where lower is better (rank). Returns rgba, opaque by
// default: the scale's colors are already the muted, dark shades that sit
// on the site's panels (pass a lower alpha for a see-through tint). alpha
// only affects the fill, never the cell's own text.
function heatColor(value, min, max, lowHex = HEAT_LOW, midHex = HEAT_MID, highHex = HEAT_HIGH, alpha = 1) {
  const toRgba = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };
  if (max === min) return toRgba(midHex);
  const t = (value - min) / (max - min);
  const rgb = t <= 0.5 ? interpolateColor(lowHex, midHex, t / 0.5) : interpolateColor(midHex, highHex, (t - 0.5) / 0.5);
  return rgb.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
}

// The same scale around a fixed zero instead of a column's own range: 0 is the
// neutral middle, +limit (and anything beyond) the full yellow, -limit the full
// blue. For "points above or below the league average" views where one color
// has to mean the same thing in every cell.
function divergingHeatColor(value, limit) {
  const t = Math.max(-1, Math.min(1, value / limit));
  return t >= 0 ? interpolateColor(HEAT_MID, HEAT_HIGH, t) : interpolateColor(HEAT_MID, HEAT_LOW, -t);
}

// Formats a "Luck" percentage (actual win% minus overall/all-play win%)
// with a leading sign and yellow (lucky) / blue (unlucky) coloring.
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

// Wraps arbitrary already-built HTML (a name, a photo, a photo+name
// pair, ...) in a link to that player's page, wherever a player is
// named across the site. Falls back to returning innerHtml completely
// unwrapped when there's no playerId to link to — e.g. an ESPN-era
// award whose player name couldn't be matched back to a Sleeper ID —
// rather than ever producing a link to nowhere.
function playerLinkHtml(playerId, innerHtml) {
  if (!playerId) return innerHtml;
  return `<a href="player.html#${encodeURIComponent(playerId)}" class="subtle-link">${innerHtml}</a>`;
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

// Small colored pill for a draft pick grade (S through F). Grades come
// from DeepHistory.gradeDraftPick — a null/missing grade renders nothing,
// since not every pick can be graded (e.g. a player who never scored).
// Color is a smooth yellow -> pale neutral -> blue gradient across the 6
// possible grades (computed, not discrete bands), so a B and a C genuinely
// look different rather than sharing one color. Brighter than the heatmap
// fills because the pill carries dark text instead of sitting behind light text.
const GRADE_ORDER = ["S", "A", "B", "C", "D", "F"];
const GRADE_BEST = "#F0A340";
const GRADE_MID = "#BCC9C6";
const GRADE_WORST = "#4EA8DD";
function gradeBadgeHtml(grade) {
  if (!grade) return "";
  const idx = GRADE_ORDER.indexOf(grade);
  if (idx === -1) return "";
  const t = idx / (GRADE_ORDER.length - 1); // 0 = best grade, 1 = worst
  const bg = t <= 0.5 ? interpolateColor(GRADE_BEST, GRADE_MID, t / 0.5) : interpolateColor(GRADE_MID, GRADE_WORST, (t - 0.5) / 0.5);
  return `<span class="grade-badge" style="background:${bg};">${escapeHtml(grade)}</span>`;
}

// A minimal inline sparkline — no axes, no labels, just the shape of a
// short numeric series. Shared by the Career Records grid (history.js)
// and the Teams page manager picker (teams.js), which both show the
// same kind of small-multiples "shape of a career" card.
function sparklinePoints(values, width, height, pad) {
  if (!values.length) return "";
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = pad + (height - pad * 2) * (1 - (v - minV) / range);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

// What happened to the old mark when a record changed hands, in a few words
// (used by the Home page's Latest Records and the Records page's timelines).
// `e` is an event from data/records-feed.json / records-history.json.
function recordChangeNote(e) {
  const p = e.previous;
  if (!p) return "New on the books";
  if (e.kind === "broke-own") return `Topped their own ${p.value}`;
  if (e.kind === "took-over") return `Took the lead from ${p.holder}`;
  return `Broke ${p.holder}\u2019s ${p.value}`;
}

// ---------------------------------------------------------------
// Freshness chips: the small "Through Week 6 · updates Tuesdays" tag on
// every panel whose numbers come from a weekly snapshot instead of live
// from Sleeper, so nobody has to wonder which week they're looking at.
//   label    short kind of data ("Snapshot", "Live", "ROS ranks")
//   through  last COMPLETED week the numbers include
//   current  the NFL week Sleeper says it is now (optional); a snapshot
//            more than one completed week behind turns blue
//   date     "2026-10-07" style date to show as "Oct 7"
//   note     the update rhythm ("updates Tuesdays")
//   tone     force "live" | "snap" | "behind"
//   title    hover text
// ---------------------------------------------------------------
const FRESH_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-10-07" (or a full ISO stamp) -> "Oct 7". Reads the date part
// as written, so it never shifts a day with the viewer's time zone.
function shortDateLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return `${FRESH_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

// Whole days between a "2026-10-07"-style date and `now` (ms); null if unreadable.
function daysSinceDate(iso, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  const then = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const base = now == null ? Date.now() : now;
  return Math.floor((base - then) / 86400000);
}

function freshnessChipHtml(o) {
  const opts = o || {};
  const parts = [];
  if (opts.label) parts.push(opts.label);
  if (opts.through != null && opts.through !== "") parts.push(Number(opts.through) > 0 ? `Through Week ${opts.through}` : "Season starts Week 1");
  else if (opts.week != null && opts.week !== "") parts.push(`Week ${opts.week}`);
  const dateText = opts.date ? shortDateLabel(opts.date) : "";
  if (dateText) parts.push(dateText);
  if (opts.note) parts.push(opts.note);
  if (!parts.length) return "";
  let tone = opts.tone;
  if (!tone) {
    tone = "snap";
    const behindByWeeks = opts.through != null && opts.current != null && Number(opts.through) < Number(opts.current) - 1;
    if (behindByWeeks) tone = "behind";
  }
  const title = opts.title ? ` title="${escapeHtml(opts.title)}"` : "";
  return `<span class="fresh-chip fresh-${escapeHtml(tone)}"${title}>${escapeHtml(parts.join(" · "))}</span>`;
}

// The matchup worth featuring: the pair with the best combined record on the slate
// (first one wins a tie). rawMatchups are Sleeper's matchup rows for one week;
// standings carry { rosterId, wins }. Returns { a, b, sa, sb } with the higher
// scorer as `a`, or null when no pair is posted. Home's Featured Matchup and the
// Rivalries page's opening pair both read this, so they always agree.
function featuredMatchupPair(rawMatchups, standings) {
  const byRoster = new Map((standings || []).map((t) => [t.rosterId, t]));
  const groups = new Map();
  (rawMatchups || []).forEach((m) => {
    if (m.matchup_id == null) return;
    if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
    groups.get(m.matchup_id).push(m);
  });
  let best = null;
  let bestWins = -1;
  groups.forEach((pair) => {
    if (pair.length < 2) return;
    const [a, b] = pair.slice().sort((x, y) => (y.points || 0) - (x.points || 0));
    const sa = byRoster.get(a.roster_id) || null;
    const sb = byRoster.get(b.roster_id) || null;
    const combined = (sa ? sa.wins : 0) + (sb ? sb.wins : 0);
    if (combined > bestWins) {
      bestWins = combined;
      best = { a, b, sa, sb };
    }
  });
  return best;
}


// ---------------------------------------------------------------
// Small number and bar helpers shared by Home and the Power Rankings page
// ---------------------------------------------------------------
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// One decimal place, or a dash for anything that is not a number.
function num1(v) {
  return Number.isFinite(v) ? v.toFixed(1) : "\u2014";
}

// "+8.1" / "-3.0" / "0.0": the sign always shows except on zero (and on a
// -0.04 that rounds to zero, which would otherwise print "-0.0").
function signed1(n) {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return "0.0";
  return (r > 0 ? "+" : "") + r.toFixed(1);
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// "6-1-1" -> { w: 6, l: 1, t: 1 }; null for anything else.
function parseRecordString(text) {
  const m = String(text == null ? "" : text).match(/^(\d+)-(\d+)(?:-(\d+))?$/);
  return m ? { w: Number(m[1]), l: Number(m[2]), t: Number(m[3] || 0) } : null;
}

// A won-lost(-tied) record as the site writes it: "6-1", "6-1-1".
function recordText(wins, losses, ties) {
  return `${wins || 0}-${losses || 0}${ties ? "-" + ties : ""}`;
}

// One team's chances split three ways: first-round bye, playoffs without one,
// and missing out. Always adds up to 100.
function playoffSplit(row, byeTeams) {
  const playoffs = clamp(Number.isFinite(row.playoffPct) ? row.playoffPct : 0, 0, 100);
  const bye = byeTeams ? clamp(Number.isFinite(row.byePct) ? row.byePct : 0, 0, playoffs) : 0;
  return { bye, playoffs: playoffs - bye, miss: 100 - playoffs };
}

// The three-part bar (bye / playoffs / miss) used by the Power Rankings table and Home.
function playoffBarHtml(row, byeTeams) {
  const s = playoffSplit(row, byeTeams);
  const seg = (cls, v) => (v > 0 ? `<i class="pr-seg ${cls}" style="flex-basis:${round2(v)}%"></i>` : "");
  const label = `${byeTeams ? `Bye ${s.bye.toFixed(1)}%, playoffs without a bye ${s.playoffs.toFixed(1)}%` : `Playoffs ${s.playoffs.toFixed(1)}%`}, miss ${s.miss.toFixed(1)}%`;
  return `<span class="pr-bar" role="img" aria-label="${label}" title="${label}">${seg("bye", s.bye)}${seg("playoffs", s.playoffs)}${seg("miss", s.miss)}</span>`;
}
