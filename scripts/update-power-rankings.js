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

  The snapshot rows also carry titlePct, each team's chance to win the
  championship: the playoff-odds simulation played on through the real
  playoff bracket (ROS-based team strength, like the playoff odds).

  data/power-rankings-extras.json feeds the Strength of Schedule, Weekly
  Scores and Lineup Slot sections under the Power Rankings table, and the
  MVP Race (the five players most likely to win the league MVP, from
  js/metrics.js). It is
  built from the same finished weeks as the snapshot (see
  scripts/lib/pr-extras.js for what each number means) and carries the
  snapshot's week, so the page can tell if the two ever disagree.

  This also keeps the CURRENT season's entry in
  data/power-rank-csv-history.json up to date — the same file that powers
  the "Power Rank History" tabbed charts (Rank / Score / Playoff Odds by
  week) on past seasons' Season pages. EVERY RUN ADDS ONE WEEK AND NEVER
  TOUCHES THE EARLIER ONES: a week that is already in the file is final,
  because it is what the Power Rankings page showed when that week was
  current (that is what the chart should say). Only the newest week is
  written from this run — it is exactly the snapshot just built, and
  re-running in the same week simply refreshes it.

  Why it works this way (learned the hard way, 2026-10-28): this script used
  to rebuild the whole season on every run by re-running the engine for each
  past week. The ROS (rest-of-season) ranks have no dated history — only the
  CURRENT data/team-strength.json exists — so every past week was re-scored
  with this week's ROS (and a fresh random playoff simulation), and running
  Week 7 silently rewrote Weeks 1-6 (up to 4 ranks and 28 playoff-odds points
  off). Recomputing the past is only used as a FALLBACK now, for a week that
  is missing from the file (first run of a season, or a week nobody ran); the
  script says so loudly, because such a week is an approximation, not what
  the page really showed. Fix a week by hand in the file if you have the real
  numbers; it will be kept.

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
const INJURIES_PATH = path.join(REPO_ROOT, "data", "injuries.json");
const ARCHIVE_DIR = path.join(REPO_ROOT, "data", "sleeper-archive");
// Random seasons played out for the playoff odds. 10,000 keeps each team's odds steady to within
// about half a point from one run to the next, and is fine enough to show the rare finishes
// (a 0.3% shot at the bye) instead of rounding them to nothing.
const PLAYOFF_SIM_ITERATIONS = 10000;

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
  "metrics.js": ["Metrics"],
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
  Builds the in-progress season's "Power Rank History" time series -- Rank,
  raw PR Score, and Playoff Odds, one value per team per completed week -- in
  the exact shape js/season.js's renderPowerRankHistorySection already knows
  how to chart (see data/power-rank-csv-history.json's own _instructions).
  Every other season in that file is a static import of data recovered from
  before this site existed; this is the live equivalent for the current season.

  PAST WEEKS ARE FROZEN. `options.saved` is the season's entry as it is
  already on file ({ ranks, scores, playoffOdds }). For each week 1..N-1:
    - if the file has a complete set of numbers for that week (every team has
      a rank, a score and playoff odds), they are copied over untouched;
    - otherwise the week is reconstructed by re-running computePowerRankings
      with `weeks` cut to "through that week" and each team's record rolled
      back to that week (scheduleWeeks is passed in full every time, since the
      Monte Carlo simulator needs the REAL remaining schedule). That uses
      TODAY's team-strength file for the ROS part, so it is only an
      approximation of what the page showed -- `options.log` is told.
  The newest week (N) is always `finalWeekResult` -- exactly what the snapshot
  was just built from, so the chart's last point equals the Power Rankings
  page (the playoff-odds simulation is random) -- or is computed when none is
  given.

  Keyed by row.teamName, which (per deep-history.js's own convention) is
  already the Sleeper username, not the custom team name -- matching how
  every other season in this file is keyed. Teams keep the order they have in
  `saved`, so the chart's line colors do not shuffle from run to run.
*/
function buildCsvHistoryForCurrentSeason(DeepHistory, currentSeasonEntry, fullDeep, playerDirectory, teamStrengthTeams, iterations, lastCompleteWeek, finalWeekResult, options = {}) {
  const saved = options.saved && options.saved.ranks && options.saved.scores && options.saved.playoffOdds ? options.saved : null;
  const log = typeof options.log === "function" ? options.log : () => {};
  const ranks = {};
  const scores = {};
  const playoffOdds = {};
  const playoffStart = currentSeasonEntry.league && currentSeasonEntry.league.settings ? currentSeasonEntry.league.settings.playoff_week_start : null;
  const finite = (v) => typeof v === "number" && Number.isFinite(v);

  // Keep the saved teams' order (and their "pre" values) so nothing reshuffles.
  if (saved) {
    Object.keys(saved.ranks).forEach((key) => {
      ranks[key] = { pre: finite(saved.ranks[key].pre) ? saved.ranks[key].pre : null, weekly: [] };
      scores[key] = { pre: finite(saved.scores[key] && saved.scores[key].pre) ? saved.scores[key].pre : null, weekly: [] };
      playoffOdds[key] = [];
    });
  }

  const finalTeams = finalWeekResult ? finalWeekResult.rows.map((row) => row.teamName) : null;
  // The week as it is on file, or null when anything about it is missing: a team with no value, a
  // team that is not on file at all, or a file that holds teams this league no longer has.
  const savedWeek = (week) => {
    if (!saved) return null;
    const keys = Object.keys(saved.ranks);
    if (finalTeams && (keys.length !== finalTeams.length || !finalTeams.every((t) => keys.includes(t)))) return null;
    const out = [];
    for (const key of keys) {
      const r = saved.ranks[key] && saved.ranks[key].weekly ? saved.ranks[key].weekly[week - 1] : undefined;
      const sc = saved.scores[key] && saved.scores[key].weekly ? saved.scores[key].weekly[week - 1] : undefined;
      const po = Array.isArray(saved.playoffOdds[key]) ? saved.playoffOdds[key][week - 1] : undefined;
      if (!finite(r) || !finite(sc) || !finite(po)) return null;
      out.push({ teamName: key, powerRank: r, prScore: sc, playoffPct: po });
    }
    return out;
  };

  const kept = [];
  const rebuilt = [];
  for (let week = 1; week <= lastCompleteWeek; week++) {
    let rows;
    if (week === lastCompleteWeek && finalWeekResult) {
      rows = finalWeekResult.rows;
    } else if (week < lastCompleteWeek && savedWeek(week)) {
      rows = savedWeek(week);
      kept.push(week);
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
      rows = DeepHistory.computePowerRankings(asOfEntry, asOfWeekDeep, playerDirectory, teamStrengthTeams, iterations).rows;
      if (week < lastCompleteWeek) rebuilt.push(week);
    }
    rows.forEach((row) => {
      const key = row.teamName;
      if (!ranks[key]) ranks[key] = { pre: null, weekly: [] };
      if (!scores[key]) scores[key] = { pre: null, weekly: [] };
      if (!playoffOdds[key]) playoffOdds[key] = [];
      ranks[key].weekly[week - 1] = row.powerRank;
      scores[key].weekly[week - 1] = row.prScore;
      playoffOdds[key][week - 1] = row.playoffPct;
    });
  }

  if (kept.length) log(`Power Rank History: Week${kept.length > 1 ? "s" : ""} ${kept.join(", ")} already on file — kept exactly as saved (past weeks are never recomputed).`);
  if (rebuilt.length) {
    log(
      `Power Rank History: Week${rebuilt.length > 1 ? "s" : ""} ${rebuilt.join(", ")} ${rebuilt.length > 1 ? "were" : "was"} missing from the file, so ${rebuilt.length > 1 ? "they were" : "it was"} RECONSTRUCTED from the games played, using today's ROS ranks. ` +
        `That is an approximation of what the page showed back then; if you have the real numbers, edit data/power-rank-csv-history.json and the script will keep them.`
    );
  }
  return { ranks, scores, playoffOdds };
}

/*
  The extras file for one run: the snapshot's own week and rows, the same finished
  weeks the ranking was computed from, and DeepHistory's slot table. Kept apart
  from main() so a test can run it against the saved season.
*/
function buildExtrasForRun(DeepHistory, { season, pr, generatedAt, currentSeasonEntry, deep, playerDirectory, teamStrengthTeams }) {
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
    teamStrength: teamStrengthTeams,
  });
}

// Season points per win in this league, measured from the finished seasons saved in
// data/sleeper-archive (it turns "points above replacement" into wins).
function pointsPerWinFromArchive(Metrics) {
  let files = [];
  try {
    files = fs.readdirSync(ARCHIVE_DIR).filter((f) => /^\d{4}\.json$/.test(f));
  } catch (err) {
    return 85.8;
  }
  const seasons = [];
  files.forEach((f) => {
    const a = readJson(path.join(ARCHIVE_DIR, f), null);
    if (a && a.league && a.league.status === "complete") seasons.push({ complete: true, rosters: a.rosters || [] });
  });
  return seasons.length ? Metrics.pointsPerWin(seasons) : 85.8;
}

// The league MVP race for the current season: the players with the most points above
// replacement so far, projected to the end of the regular season (see Metrics.mvpRace).
function buildMvpRaceForRun(Metrics, { currentSeasonEntry, deep, playerDirectory, injuriesData, pointsPerWin, sims = 40000 }) {
  const ctx = Metrics.prepareSeason(currentSeasonEntry, deep, playerDirectory, injuriesData);
  const playoffStart = currentSeasonEntry.league.settings && currentSeasonEntry.league.settings.playoff_week_start;
  const regularWeeks = playoffStart ? playoffStart - 1 : 14;
  const race = Metrics.mvpRace(ctx, regularWeeks, { pointsPerWin, sims });
  return { ...race, pointsPerWin };
}

async function main() {
  const ctx = loadBrowserModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "metrics.js"]);
  const { SleeperAPI, DeepHistory, Metrics, LEAGUE_ID, LAST_FANTASY_WEEK } = ctx;

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
    simRuns: pr.simRuns,
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

  // Adds this week to the Season page's "Power Rank History" charts (Rank /
  // Score / Playoff Odds by week) for the current, in-progress season. Weeks
  // already in the file are kept exactly as they are (see
  // buildCsvHistoryForCurrentSeason); only a week missing from the file is
  // re-simulated, which is the slow part and happens at most on a first run.
  const csvHistory = readJson(CSV_HISTORY_PATH, { seasons: {} });
  if (!csvHistory.seasons) csvHistory.seasons = {};
  console.log(`Updating Power Rank History for ${season} (adding Week ${lastCompleteWeek}; earlier weeks stay as saved)…`);
  const csvHistoryData = buildCsvHistoryForCurrentSeason(DeepHistory, currentSeasonEntry, deep, playerDirectory, teamStrengthTeams, PLAYOFF_SIM_ITERATIONS, lastCompleteWeek, pr, {
    saved: csvHistory.seasons[season],
    log: (message) => console.log(message),
  });
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
    teamStrengthTeams,
  });
  console.log("Simulating the league MVP race…");
  extras.mvpRace = buildMvpRaceForRun(Metrics, {
    currentSeasonEntry,
    deep,
    playerDirectory,
    injuriesData: readJson(INJURIES_PATH, { players: {} }),
    pointsPerWin: pointsPerWinFromArchive(Metrics),
  });
  writeJson(EXTRAS_PATH, extras);
  console.log(`Wrote ${path.relative(REPO_ROOT, EXTRAS_PATH)} (Strength of Schedule, Weekly Scores, Lineup Slots, MVP Race through Week ${pr.week})`);

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

module.exports = { buildSafeDeep, buildCsvHistoryForCurrentSeason, rostersAsOfWeek, buildExtrasForRun, buildMvpRaceForRun, pointsPerWinFromArchive };
