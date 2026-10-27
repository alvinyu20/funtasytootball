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
    3. Commit + push/deploy data/power-rankings-snapshot.json,
       data/power-rank-history.json, data/power-rank-csv-history.json
       and data/power-rankings-extras.json (all four get overwritten by
       this script — no other manual step needed, this replaces the old
       "copy this JSON snippet into power-rank-history.json by hand" step
       that used to live on the Power Rankings page).

  data/power-rankings-extras.json feeds the Strength of Schedule, Weekly
  Scores and Lineup Slot sections under the Power Rankings table. It is
  built from the same finished weeks as the snapshot (see
  scripts/lib/pr-extras.js for what each number means) and carries the
  snapshot's week, so the page can tell if the two ever disagree.

  This also rebuilds the CURRENT season's entry in
  data/power-rank-csv-history.json — the same file that powers the
  "Power Rank History" tabbed charts (Rank / Score / Playoff Odds by
  week) on past seasons' Season pages. It does this by re-running
  DeepHistory.computePowerRankings once per completed week, each time
  with `deep.weeks` truncated to "through that week only" (see
  buildCsvHistoryForCurrentSeason below), so the in-progress season
  gets the exact same chart as a season already in the history books.
  One approximation worth knowing: the ROS component of every
  reconstructed past week uses TODAY's data/team-strength.json, since
  there's no dated history of that file — so a past week's rank/score
  here isn't necessarily byte-identical to what the live page showed
  that week at the time, only to what it would show if recomputed now
  with this week's ROS inputs applied retroactively.

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
const { buildPowerRankingsExtras } = require("./lib/pr-extras");

const REPO_ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(REPO_ROOT, "js");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "data", "power-rankings-snapshot.json");
const HISTORY_PATH = path.join(REPO_ROOT, "data", "power-rank-history.json");
const CSV_HISTORY_PATH = path.join(REPO_ROOT, "data", "power-rank-csv-history.json");
const EXTRAS_PATH = path.join(REPO_ROOT, "data", "power-rankings-extras.json");
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

/*
  Each roster's record and points through `throughWeek`, written into the same
  `settings` fields Sleeper keeps them in (wins, losses, ties, fpts + fpts_decimal,
  fpts_against + fpts_against_decimal), so anything that reads a roster's record
  (SleeperAPI.buildStandings) sees the season as it stood after that week.
  Regular-season weeks only, same as Sleeper's own record. `weeks` are
  [{ week, matchups: [{ roster_id, matchup_id, points }] }]; a row with no
  matchup_id (a bye) or no partner counts for nothing.
*/
function rostersAsOfWeek(rosters, weeks, throughWeek, playoffStart) {
  const totals = new Map(rosters.map((r) => [r.roster_id, { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 }]));
  weeks
    .filter((w) => w.week <= throughWeek && (playoffStart == null || w.week < playoffStart))
    .forEach(({ matchups }) => {
      const byMatchupId = new Map();
      matchups.forEach((m) => {
        if (m.matchup_id == null) return;
        if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
        byMatchupId.get(m.matchup_id).push(m);
      });
      byMatchupId.forEach((pair) => {
        if (pair.length !== 2) return;
        const [a, b] = pair;
        const ta = totals.get(a.roster_id);
        const tb = totals.get(b.roster_id);
        if (!ta || !tb) return;
        const pa = a.points || 0;
        const pb = b.points || 0;
        ta.pf += pa;
        ta.pa += pb;
        tb.pf += pb;
        tb.pa += pa;
        if (pa > pb) {
          ta.wins += 1;
          tb.losses += 1;
        } else if (pb > pa) {
          tb.wins += 1;
          ta.losses += 1;
        } else {
          ta.ties += 1;
          tb.ties += 1;
        }
      });
    });
  return rosters.map((r) => {
    const t = totals.get(r.roster_id);
    const pfCents = Math.round(t.pf * 100);
    const paCents = Math.round(t.pa * 100);
    return {
      ...r,
      settings: {
        ...(r.settings || {}),
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        fpts: Math.floor(pfCents / 100),
        fpts_decimal: pfCents % 100,
        fpts_against: Math.floor(paCents / 100),
        fpts_against_decimal: paCents % 100,
      },
    };
  });
}

/*
  Rebuilds the in-progress season's "Power Rank History" time series --
  Rank, raw PR Score, and Playoff Odds, one value per team per completed
  week -- in the exact shape js/season.js's renderPowerRankHistorySection
  already knows how to chart (see data/power-rank-csv-history.json's own
  _instructions). Every other season in that file is a static import of
  data recovered from before this site existed; this is the live
  equivalent for the current season, since we DO have the real weekly
  data to reconstruct it from.

  Re-runs computePowerRankings once per completed week (1..lastCompleteWeek),
  each time with `weeks` truncated to "as of that week" -- scheduleWeeks is
  passed through in full every time, since the Monte Carlo simulator needs
  the REAL remaining schedule from that point forward, not a truncated one.
  Keyed by row.teamName, which (per deep-history.js's own convention) is
  already the Sleeper username, not the custom team name -- matching how
  every other season in this file is keyed.
*/
function buildCsvHistoryForCurrentSeason(DeepHistory, currentSeasonEntry, fullDeep, playerDirectory, teamStrengthTeams, iterations, lastCompleteWeek, finalWeekResult) {
  const ranks = {};
  const scores = {};
  const playoffOdds = {};
  const playoffStart = currentSeasonEntry.league && currentSeasonEntry.league.settings ? currentSeasonEntry.league.settings.playoff_week_start : null;

  for (let week = 1; week <= lastCompleteWeek; week++) {
    let pr;
    if (week === lastCompleteWeek && finalWeekResult) {
      // The newest week is exactly what the snapshot was just built from. Reusing it
      // (instead of simulating again) keeps the chart's last point identical to the
      // Power Rankings page, since the playoff-odds simulation is random.
      pr = finalWeekResult;
    } else {
      const asOfWeekDeep = {
        weeks: fullDeep.weeks.filter((w) => w.week <= week),
        scheduleWeeks: fullDeep.scheduleWeeks,
      };
      // computePowerRankings reads each team's record from the rosters, and the rosters
      // hold TODAY's record. For an earlier week, give it that week's record instead,
      // otherwise every past week is ranked on the latest record and the simulation
      // counts the weeks after it a second time.
      const asOfEntry =
        week === lastCompleteWeek
          ? currentSeasonEntry
          : { ...currentSeasonEntry, rosters: rostersAsOfWeek(currentSeasonEntry.rosters, fullDeep.weeks, week, playoffStart) };
      pr = DeepHistory.computePowerRankings(asOfEntry, asOfWeekDeep, playerDirectory, teamStrengthTeams, iterations);
    }
    pr.rows.forEach((row) => {
      const key = row.teamName;
      if (!ranks[key]) ranks[key] = { pre: null, weekly: [] };
      if (!scores[key]) scores[key] = { pre: null, weekly: [] };
      if (!playoffOdds[key]) playoffOdds[key] = [];
      ranks[key].weekly[week - 1] = row.powerRank;
      scores[key].weekly[week - 1] = row.prScore;
      playoffOdds[key][week - 1] = row.playoffPct;
    });
  }

  return { ranks, scores, playoffOdds };
}

/*
  The extras file for one run: the snapshot's own week and rows, the same finished
  weeks the ranking was computed from, and DeepHistory's slot table. Kept apart
  from main() so a test can run it against the saved season.
*/
function buildExtrasForRun(DeepHistory, { season, pr, generatedAt, currentSeasonEntry, deep, playerDirectory }) {
  return buildPowerRankingsExtras({
    season,
    week: pr.week,
    generatedAt,
    teams: pr.rows,
    league: currentSeasonEntry.league,
    weeks: deep.weeks,
    scheduleWeeks: deep.scheduleWeeks,
    playerDirectory,
    buildPositionTable: (...args) => DeepHistory.buildPositionTable(...args),
  });
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

  // Rebuilds the Season page's "Power Rank History" charts (Rank / Score /
  // Playoff Odds by week) for the current, in-progress season -- re-runs
  // the simulation once per completed week, so this is the slowest part
  // of the script, but still a background job, not something on a live
  // page load.
  console.log(`Rebuilding ${lastCompleteWeek}-week Power Rank History for ${season} (re-simulating each past week)…`);
  const csvHistoryData = buildCsvHistoryForCurrentSeason(DeepHistory, currentSeasonEntry, deep, playerDirectory, teamStrengthTeams, PLAYOFF_SIM_ITERATIONS, lastCompleteWeek, pr);
  const csvHistory = readJson(CSV_HISTORY_PATH, { seasons: {} });
  if (!csvHistory.seasons) csvHistory.seasons = {};
  csvHistory.seasons[season] = csvHistoryData;
  writeJson(CSV_HISTORY_PATH, csvHistory);
  console.log(`Wrote ${path.relative(REPO_ROOT, CSV_HISTORY_PATH)} (${season} Rank/Score/Playoff Odds through Week ${lastCompleteWeek})`);

  // Strength of Schedule / Weekly Scores / Lineup Slot views. Cheap (no
  // simulation), and built from the very same finished weeks as the snapshot.
  const extras = buildExtrasForRun(DeepHistory, {
    season,
    pr,
    generatedAt: snapshot.generatedAt,
    currentSeasonEntry,
    deep,
    playerDirectory,
  });
  writeJson(EXTRAS_PATH, extras);
  console.log(`Wrote ${path.relative(REPO_ROOT, EXTRAS_PATH)} (Strength of Schedule, Weekly Scores, Lineup Slots through Week ${pr.week})`);

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

module.exports = { buildSafeDeep, buildCsvHistoryForCurrentSeason, rostersAsOfWeek, buildExtrasForRun };
