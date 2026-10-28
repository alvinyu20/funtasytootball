/*
  Shared set-up for the Home page tests: the real 2026 archive and Power Rankings
  snapshot, a Home context with the page scripts loaded, and Home drawn in its
  two passes (Sleeper's own table first, then the season's weekly data).
*/
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./site-env.js");

const ROOT = path.join(__dirname, "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const archive = JSON.parse(read("data", "sleeper-archive", "2026.json"));
const snapshotFile = JSON.parse(read("data", "power-rankings-snapshot.json"));
const playedWeeks = archive.weeks.filter((w) => w.matchups.some((m) => m.points > 0)).map((w) => ({ week: w.week, matchups: w.matchups }));
const FINISHED = playedWeeks.length;
const TEAMS = archive.rosters.length;

const homeCtx = () => loadSiteModules(["config.js", "utils.js", "my-team.js", "sleeper-api.js", "deep-history.js", "dashboard.js"]);
const json = (ctx, code) => JSON.parse(runInLoadedContext(ctx, `JSON.stringify(${code})`));
const run = (ctx, code) => runInLoadedContext(ctx, code);
const html = (ctx, id) => ctx.document.getElementById(id).innerHTML;

// Home with the first pass drawn: Sleeper's own table only.
function firstPass(completed = FINISHED) {
  const ctx = homeCtx();
  ctx.__arch = archive;
  run(
    ctx,
    `HOME.league = __arch.league; HOME.week = ${completed + 1}; HOME.completed = ${completed}; HOME.playoffTeams = 6;
     HOME.standings = SleeperAPI.buildStandings(__arch.rosters, __arch.users); renderStandings();`
  );
  return ctx;
}

// Home after the season's weekly data and the Power Rankings snapshot have landed.
async function secondPass({ completed = FINISHED, snapshot = snapshotFile } = {}) {
  const ctx = homeCtx();
  ctx.__arch = archive;
  ctx.__weeks = playedWeeks;
  ctx.fetch = async (url) => {
    if (String(url).includes("power-rankings-snapshot")) return snapshot ? { ok: true, json: async () => snapshot } : { ok: false, json: async () => null };
    return { ok: false, json: async () => null };
  };
  run(
    ctx,
    `HOME.league = __arch.league; HOME.week = ${completed + 1}; HOME.completed = ${completed}; HOME.playoffTeams = 6;
     HOME.standings = SleeperAPI.buildStandings(__arch.rosters, __arch.users);
     DeepHistory.fetchSeasonDeep = async () => ({ weeks: __weeks });`
  );
  await run(ctx, `renderSeasonDetail(__arch.league, __arch.rosters, __arch.users, ${completed + 1}, {}, { teams: {} })`);
  return ctx;
}


module.exports = { read, archive, snapshotFile, playedWeeks, FINISHED, TEAMS, homeCtx, json, run, html, firstPass, secondPass };
