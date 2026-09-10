/*
  ============================================================
  POWER RANKINGS UPDATE
  ============================================================
  Computes the Power Rankings + Playoff Odds table and saves it to
  data/power-rankings-snapshot.json — the file js/power-rankings.js
  actually reads. The page itself does NOT calculate anything live;
  it just displays whatever this script last wrote. That's
  deliberate, for two reasons:

  1. The ROS (rest-of-season) component of the ranking comes from
     FantasyPros' League Analyzer, which has no public API — it has
     to be typed into data/team-strength.json by hand (see that
     file's own instructions). There's no "live" version of that
     number to calculate against.
  2. Recalculating on every page load meant Power Rankings and
     Playoff Odds could be computed mid-week, using a week that's
     only partially played (e.g. Thursday night's score in but
     Sunday's games not yet kicked off) — misleading, since most
     teams would show a partial score as if it were their whole
     week. This script only ever uses a week Sleeper itself reports
     as no longer current (see WEEK COMPLETION below), and only
     runs when a person decides to run it — never automatically.

  WORKFLOW (do this once a week, after that week's games are done):
    1. Update data/team-strength.json with this week's FantasyPros
       ROS ranks (open FantasyPros' League Analyzer, copy each
       team's rank/score across — see that file's own instructions
       for the exact steps).
    2. Run:  node scripts/update-power-rankings.js
    3. Commit + push/deploy data/power-rankings-snapshot.json and
       data/power-rank-history.json (both get overwritten by this
       script — no other manual step needed, this replaces the old
       "copy this JSON snippet into power-rank-history.json by
       hand" step that used to live on the Power Rankings page).

  WEEK COMPLETION: this script fetches Sleeper's own /state/nfl,
  which reports the CURRENT week league-wide (Sleeper advances this
  itself, generally early Tuesday morning once Monday Night
  Football wraps). Only weeks strictly BEFORE that current week are
  ever used as the ranking basis — the in-progress week is always
  excluded, however far along it is. That means this script is safe
  to run at any time; running it mid-week just recomputes the same
  result as the last completed week, harmlessly.

  If no week is complete yet (preseason, or Week 1 still in
  progress), the script prints a message and exits without touching
  either output file — the hand-entered preseason rankings already
  in power-rankings-snapshot.json stay in effect until there's a
  real week to replace them with.

  Node 18+ required (built-in global fetch — no dependencies).
*/

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REPO_ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(REPO_ROOT, "js");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "data", "power-rankings-snapshot.json");
const HISTORY_PATH = path.join(REPO_ROOT, "data", "power-rank-history.json");
const TEAM_STRENGTH_PATH = path.join(REPO_ROOT, "data", "team-strength.json");
const PLAYOFF_SIM_ITERATIONS = 1000;

/*
  js/sleeper-api.js and js/deep-history.js are written as browser
  <script>-tag files (top-level `const SleeperAPI = {...}`, no
  module.exports), sharing a page's global scope the same way the
  test suite's tests/helpers/site-env.js loads them for unit tests.
  This does the same thing for a real run: a sandboxed context with
  Node's real fetch (so live Sleeper calls actually go out) instead
  of the test harness's deliberately-offline stubs. Reuses the exact
  same production ranking/simulation code the site itself runs —
  not a reimplementation that could quietly drift from it.
*/
// Same underlying reason as tests/helpers/site-env.js's identical
// promotion step: a top-level `const`/`let` in a vm-executed script
// creates a binding in that script's own scope, not an enumerable
// property on the context object -- so reading e.g. ctx.LEAGUE_ID from
// outside the sandbox silently comes back undefined unless explicitly
// re-assigned onto globalThis from inside a script running in that
// same context. Plain `function` declarations don't have this problem
// (they attach to the global object directly), which is why DeepHistory
// and SleeperAPI's own *internal* cross-references to each other work
// with no promotion needed -- this is only for names THIS script reads
// from the outside, after loading.
const EXPORTS_TO_PROMOTE = {
  "config.js": ["LEAGUE_ID", "LAST_FANTASY_WEEK"],
  "sleeper-api.js": ["SleeperAPI"],
  "deep-history.js": ["DeepHistory"],
};

function loadBrowserModules(filenames) {
  const sandbox = {
    console,
    fetch: (...args) => fetch(...args),
    // In-memory, one-shot-script-safe stub. fetchSeasonDeep (unused
    // by this script, but defined in the same file) wraps its own
    // localStorage calls in try/catch, so even a missing method here
    // would just be treated as a cache miss -- this is only here so
    // the file has something to reference, not because this script
    // depends on caching behaving any particular way.
    localStorage: {
      _store: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
      setItem(k, v) { this._store[k] = String(v); },
      removeItem(k) { delete this._store[k]; },
    },
  };
  vm.createContext(sandbox);
  filenames.forEach((filename) => {
    const code = fs.readFileSync(path.join(JS_DIR, filename), "utf8");
    vm.runInContext(code, sandbox, { filename: path.join("js", filename) });
    (EXPORTS_TO_PROMOTE[filename] || []).forEach((exportName) => {
      vm.runInContext(`globalThis.${exportName} = ${exportName};`, sandbox, { filename: `js/${filename} (export promotion)` });
    });
  });
  return sandbox;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

/*
  Walks weeks 1..LAST_FANTASY_WEEK live from Sleeper, same shape
  DeepHistory.fetchSeasonDeep produces (so DeepHistory.computePowerRankings
  can consume it directly) -- but, critically, excludes any week that
  isn't strictly before Sleeper's own current week (see the WEEK
  COMPLETION note at the top of this file). scheduleWeeks keeps every
  week fetched (played or not) since the Monte Carlo simulator needs
  the full remaining schedule; weeks is the safely-complete subset
  everything else gets computed from.
*/
async function buildSafeDeep(SleeperAPI, leagueId, lastFantasyWeek, safeBeforeWeek) {
  const scheduleWeeks = [];
  for (let week = 1; week <= lastFantasyWeek; week++) {
    let matchups;
    try {
      matchups = await SleeperAPI.getMatchups(leagueId, week);
    } catch (err) {
      break;
    }
    if (!matchups || matchups.length === 0) break;
    scheduleWeeks.push({ week, matchups });
  }
  const weeks = scheduleWeeks.filter(({ week, matchups }) => week < safeBeforeWeek && matchups.some((m) => (m.points || 0) > 0));
  return { weeks, scheduleWeeks };
}

async function main() {
  const ctx = loadBrowserModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
  const { SleeperAPI, DeepHistory, LEAGUE_ID, LAST_FANTASY_WEEK } = ctx;

  console.log("Fetching current season from Sleeper…");
  const seasonChain = await SleeperAPI.getSeasonChain(LEAGUE_ID);
  if (!seasonChain.length) {
    console.error("Couldn't load any seasons — double-check LEAGUE_ID in js/config.js.");
    process.exitCode = 1;
    return;
  }
  const currentSeasonEntry = seasonChain[seasonChain.length - 1];
  const season = currentSeasonEntry.league.season;

  const nflState = await SleeperAPI.getNflState();
  const safeBeforeWeek = nflState && nflState.week != null ? nflState.week : 1;
  console.log(`Sleeper reports the current week is ${safeBeforeWeek} — using weeks 1-${safeBeforeWeek - 1} as the safely-complete basis.`);

  const deep = await buildSafeDeep(SleeperAPI, currentSeasonEntry.league.league_id, LAST_FANTASY_WEEK, safeBeforeWeek);

  if (!deep.weeks.length) {
    console.log("No week is fully complete yet (preseason, or Week 1 still in progress). Nothing to update —");
    console.log("the hand-entered preseason rankings in data/power-rankings-snapshot.json stay as they are.");
    return;
  }

  const lastCompleteWeek = Math.max(...deep.weeks.map((w) => w.week));
  console.log(`Computing Power Rankings through Week ${lastCompleteWeek}…`);

  const teamStrengthFile = readJson(TEAM_STRENGTH_PATH, { teams: {} });
  const teamStrengthTeams = teamStrengthFile.teams || {};
  if (!Object.keys(teamStrengthTeams).length) {
    console.warn("Warning: data/team-strength.json has no teams in it — ROS rank will fall back to a neutral");
    console.warn("mid-pack value for everyone. Update that file with this week's FantasyPros ranks first.");
  }

  console.log("Fetching player directory (for Boom/Bust)…");
  const playerDirectory = await SleeperAPI.getPlayerDirectory();

  const pr = DeepHistory.computePowerRankings(currentSeasonEntry, deep, playerDirectory, teamStrengthTeams, PLAYOFF_SIM_ITERATIONS);

  const snapshot = {
    _instructions:
      "The Power Rankings page reads directly from this file -- it does NOT calculate anything live. Regenerate it with `node scripts/update-power-rankings.js` (see that script's own comments); never edit 'rows' by hand once the season has real data.",
    generatedAt: new Date().toISOString(),
    season,
    week: pr.week,
    preseason: false,
    playoffTeams: pr.playoffTeams,
    byeTeams: pr.byeTeams,
    rows: pr.rows,
  };
  writeJson(SNAPSHOT_PATH, snapshot);
  console.log(`Wrote ${path.relative(REPO_ROOT, SNAPSHOT_PATH)}`);

  // Automates what used to be a manual copy-the-JSON-snippet step on
  // the Power Rankings page itself -- keeps the week-over-week
  // up/down arrows (the Δ column) working without anyone needing to
  // paste anything by hand.
  const history = readJson(HISTORY_PATH, { seasons: {} });
  if (!history.seasons) history.seasons = {};
  if (!history.seasons[season]) history.seasons[season] = {};
  const weekRanks = {};
  pr.rows.forEach((row) => {
    weekRanks[row.teamName] = row.powerRank;
  });
  history.seasons[season][String(pr.week)] = weekRanks;
  writeJson(HISTORY_PATH, history);
  console.log(`Wrote ${path.relative(REPO_ROOT, HISTORY_PATH)} (Week ${pr.week} ranks)`);

  console.log("\nTop 3:");
  pr.rows.slice(0, 3).forEach((row) => {
    console.log(`  #${row.powerRank}  ${row.teamName}  (PR Score ${row.prScore.toFixed(2)}, ${row.record})`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Power Rankings update failed:", err);
    process.exitCode = 1;
  });
}

module.exports = { buildSafeDeep };
