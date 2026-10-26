/*
  ============================================================
  TEAM RAW STATS PIPELINE
  ============================================================
  Builds data/team-raw-stats.json, the data behind the "Team Raw Stats"
  records on the Records page (Most Passing Yards in a Week, Career
  Receptions, and so on).

  Those records need real box-score numbers (yards, TDs, receptions)
  summed across each manager's STARTING lineup every regular-season
  week. Sleeper's matchup data only carries fantasy POINTS per player,
  so the raw numbers come from Sleeper's per-week NFL stats endpoint:

    https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}

  which returns { playerId: { pass_yd, rec, rush_td, ... } } for every
  NFL player that week. For each matchup in data/sleeper-archive we add
  up the stats of the starters that roster actually submitted, then key
  the totals by the manager's Sleeper user_id (so a manager who changed
  teams or usernames is still one person).

  Output shape (compact on purpose — it's ~100 weeks x 10 managers):
    {
      "generatedAt": "2026-10-20T09:00:00.000Z",
      "stats": ["pass_yd", "pass_td", ...],     // column order of every array below
      "seasons": {
        "2024": { "1": { "<userId>": [yards, tds, ...], ... }, "2": { ... } }
      }
    }

  Only REGULAR-season weeks are included (the Records page labels these
  records that way). Weeks of finished seasons are never re-downloaded
  once stored; the in-progress season is refreshed each run.

  Run manually:
    node scripts/build-team-raw-stats.js

  Also available as the "Build Team Raw Stats" workflow in GitHub
  Actions (.github/workflows/build-team-raw-stats.yml) — run it once
  after deploying and the Team Raw Stats records fill in.

  Node 18+ required (built-in global fetch — no dependencies).
*/

const fs = require("fs");
const path = require("path");
const { finishedWeeksOf } = require("./lib/finished-weeks");

const REPO_ROOT = path.join(__dirname, "..");
const ARCHIVE_DIR = path.join(REPO_ROOT, "data", "sleeper-archive");
const OUTPUT_PATH = path.join(REPO_ROOT, "data", "team-raw-stats.json");
const SLEEPER_BASE = "https://api.sleeper.app/v1";

// The order here IS the file format, and must match RecordBook.RAW_STATS
// in js/record-book.js (a unit test enforces it). Append, never reorder.
const STAT_KEYS = ["pass_yd", "pass_td", "pass_int", "rush_yd", "rush_td", "rec", "rec_yd", "rec_td", "def_td", "fgm", "fum"];

// Adds up the listed stats over every starter on every roster for one
// week. `matchups` are Sleeper matchup rows (roster_id + starters),
// `rosters` supplies roster_id -> owner_id, and `playerStats` is the
// stats endpoint's response for that week. Returns { userId: [values] }.
function sumStarterStats(matchups, rosters, playerStats, statKeys = STAT_KEYS) {
  const ownerByRoster = new Map();
  (rosters || []).forEach((r) => {
    if (r && r.owner_id) ownerByRoster.set(r.roster_id, String(r.owner_id));
  });
  const out = {};
  (matchups || []).forEach((m) => {
    const userId = m && ownerByRoster.get(m.roster_id);
    if (!userId) return;
    const totals = out[userId] || (out[userId] = statKeys.map(() => 0));
    (m.starters || []).forEach((pid) => {
      if (!pid || pid === "0") return;
      const line = playerStats && playerStats[pid];
      if (!line) return;
      statKeys.forEach((key, i) => {
        const v = Number(line[key]);
        if (Number.isFinite(v)) totals[i] += v;
      });
    });
    // Whole numbers only: stat lines are integers, so this just trims
    // floating-point noise should Sleeper ever send a fractional value.
    for (let i = 0; i < totals.length; i++) totals[i] = Math.round(totals[i] * 100) / 100;
  });
  return out;
}

// The regular-season weeks of an archived season that actually have a
// score. Mirrors how the site separates the regular season from the
// playoffs: anything before settings.playoff_week_start.
function regularWeeksOf(archive) {
  const playoffStart = Number(archive && archive.league && archive.league.settings && archive.league.settings.playoff_week_start) || null;
  // Only finished weeks: a week in progress has partial box scores.
  return finishedWeeksOf(
    archive,
    ((archive && archive.weeks) || []).filter((w) => w && Array.isArray(w.matchups) && w.matchups.some((m) => (m.points || 0) > 0)),
    archive && archive.nflWeek
  )
    .map((w) => Number(w.week))
    .filter((week) => playoffStart == null || week < playoffStart);
}

// Which weeks of a season still need downloading. A finished season's
// stored weeks never change, so only missing weeks are fetched; the
// in-progress season is re-fetched in full so stat corrections land.
function weeksToFetch(archive, existingWeeks) {
  const weeks = regularWeeksOf(archive);
  const complete = archive && archive.league && archive.league.status === "complete";
  if (!complete) return weeks;
  const have = existingWeeks || {};
  return weeks.filter((week) => !have[String(week)]);
}

async function sleeperGet(pathSuffix) {
  const res = await fetch(`${SLEEPER_BASE}${pathSuffix}`);
  if (!res.ok) throw new Error(`Sleeper API error ${res.status} on ${pathSuffix}`);
  return res.json();
}

function readExisting() {
  try {
    const parsed = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
    // A file written with a different column layout can't be merged into.
    if (parsed && JSON.stringify(parsed.stats) === JSON.stringify(STAT_KEYS) && parsed.seasons) return parsed;
  } catch (err) {
    /* first run, or unreadable — start fresh */
  }
  return { stats: STAT_KEYS, seasons: {} };
}

async function main() {
  const files = fs.readdirSync(ARCHIVE_DIR).filter((f) => /^\d{4}\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`No season files found in ${ARCHIVE_DIR}`);

  const output = readExisting();
  let fetched = 0;
  let failed = 0;

  for (const file of files) {
    const season = file.replace(".json", "");
    const archive = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, file), "utf8"));
    const existing = output.seasons[season] || {};
    const weeks = weeksToFetch(archive, existing);
    if (!weeks.length) {
      console.log(`${season}: up to date.`);
      continue;
    }
    const bucket = (output.seasons[season] = { ...existing });
    for (const week of weeks) {
      const entry = archive.weeks.find((w) => Number(w.week) === week);
      try {
        const playerStats = await sleeperGet(`/stats/nfl/regular/${season}/${week}`);
        bucket[String(week)] = sumStarterStats(entry.matchups, archive.rosters, playerStats);
        fetched++;
      } catch (err) {
        failed++;
        console.warn(`${season} week ${week}: skipped (${err.message})`);
      }
    }
    console.log(`${season}: ${Object.keys(bucket).length} weeks stored.`);
  }

  // Keep seasons and weeks in numeric order so re-runs diff cleanly.
  const sortedSeasons = {};
  Object.keys(output.seasons).sort().forEach((season) => {
    const weeks = output.seasons[season];
    sortedSeasons[season] = {};
    Object.keys(weeks).sort((a, b) => Number(a) - Number(b)).forEach((w) => (sortedSeasons[season][w] = weeks[w]));
  });

  const result = { generatedAt: new Date().toISOString(), stats: STAT_KEYS, seasons: sortedSeasons };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result) + "\n");
  console.log(`Wrote ${path.relative(REPO_ROOT, OUTPUT_PATH)} (${fetched} weeks fetched, ${failed} failed).`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { STAT_KEYS, sumStarterStats, regularWeeksOf, weeksToFetch };
