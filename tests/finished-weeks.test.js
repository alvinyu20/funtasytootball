/*
  "A matchup that isn't finished doesn't count anywhere."

  Sleeper's weekly matchup data holds partial scores for the week in
  progress. Every page and build script that counts RESULTS (Seasons,
  Teams, Head to Head, Rivalries, Records, Draft grades, the player and
  raw-stat files, the Records replay) goes through one rule,
  DeepHistory.completedThroughWeek, so a half-played week can't leak into
  a record, a streak or a head-to-head line. These tests pin that rule and
  every place it is applied.
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const finished = require("../scripts/lib/finished-weeks");
const replayLib = require("../scripts/lib/records-replay");

const ROOT = path.join(__dirname, "..");
const SLEEPER = "https://api.sleeper.app/v1";
const ctxFor = () => loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
const through = (ctx, o) => runInLoadedContext(ctx, `DeepHistory.completedThroughWeek(${JSON.stringify(o)})`);
const rosterGames = (games) => [{ roster_id: 1, settings: { wins: games, losses: 0, ties: 0 } }, { roster_id: 2, settings: { wins: 0, losses: games, ties: 0 } }];

test("completedThroughWeek: Sleeper's clock says which week is in progress, everything before it is final", () => {
  const ctx = ctxFor();
  const league = { status: "in_season", settings: { playoff_week_start: 15 } };
  assert.strictEqual(through(ctx, { league, rosters: rosterGames(5), nflWeek: 6 }), 5);
  assert.strictEqual(through(ctx, { league, rosters: rosterGames(0), nflWeek: 1 }), 0, "Week 1 under way: nothing is final yet");
});

test("completedThroughWeek: in the regular season a roster record that hasn't caught up hides the week a little longer, never shows it early", () => {
  const ctx = ctxFor();
  const league = { status: "in_season", settings: { playoff_week_start: 15 } };
  assert.strictEqual(through(ctx, { league, rosters: rosterGames(4), nflWeek: 6 }), 4, "the clock moved on but the records haven't");
  assert.strictEqual(through(ctx, { league, rosters: rosterGames(6), nflWeek: 6 }), 5, "a record can't outrun the clock either");
  // A tie counts as a game played.
  const tied = [{ roster_id: 1, settings: { wins: 2, losses: 1, ties: 1 } }];
  assert.strictEqual(through(ctx, { league, rosters: tied, nflWeek: 9 }), 4);
});

test("completedThroughWeek: the playoffs run on the clock alone, because records stop moving after the regular season", () => {
  const ctx = ctxFor();
  const league = { status: "in_season", settings: { playoff_week_start: 15 } };
  assert.strictEqual(through(ctx, { league, rosters: rosterGames(14), nflWeek: 16 }), 15);
  assert.strictEqual(through(ctx, { league, rosters: rosterGames(14), nflWeek: 15 }), 14, "the first playoff week is still being played");
});

test("completedThroughWeek: finished seasons count everything; unstarted ones nothing; missing info falls back sensibly", () => {
  const ctx = ctxFor();
  assert.strictEqual(runInLoadedContext(ctx, `DeepHistory.completedThroughWeek({ league: { status: "complete" }, rosters: [], nflWeek: 3 }) === Infinity`), true);
  assert.strictEqual(through(ctx, { league: { status: "pre_draft" }, rosters: rosterGames(3), nflWeek: 5 }), 0, "records and clock can't make an undrafted season count");
  assert.strictEqual(through(ctx, { league: { status: "drafting" }, rosters: rosterGames(3), nflWeek: 5 }), 0);
  const live = { status: "in_season", settings: { playoff_week_start: 15 } };
  assert.strictEqual(through(ctx, { league: live, rosters: rosterGames(3), nflWeek: null }), 3, "no clock: the rosters' records stand in");
  assert.strictEqual(through(ctx, { league: live, rosters: [{ roster_id: 1, settings: {} }], nflWeek: 5 }), 4, "rosters with no record at all: the clock alone");
  assert.strictEqual(through(ctx, { league: live, rosters: [], nflWeek: null }), 0, "no information: nothing counts rather than something half-played");
});

test("finishedWeeksOnly: keeps weeks up to and including the cut-off", () => {
  const ctx = ctxFor();
  const kept = runInLoadedContext(ctx, `DeepHistory.finishedWeeksOnly([{ week: 1 }, { week: 2 }, { week: 3 }], 2).map((w) => w.week).join(",")`);
  assert.strictEqual(kept, "1,2");
  assert.strictEqual(runInLoadedContext(ctx, `DeepHistory.finishedWeeksOnly(null, 2).length`), 0);
});

// ---- the live fetch -------------------------------------------------------------------------------------
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const missing = { ok: false, status: 404, json: async () => null };
function matchupRows(a, b) {
  return [
    { roster_id: 1, matchup_id: 1, points: a },
    { roster_id: 2, matchup_id: 1, points: b },
  ];
}
function liveRoutes(scores, nflWeek) {
  const routes = { [`${SLEEPER}/state/nfl`]: { season: "2026", week: nflWeek } };
  for (let w = 1; w <= 17; w++) routes[`${SLEEPER}/league/L9/matchups/${w}`] = scores[w] ? matchupRows(...scores[w]) : [];
  return routes;
}

test("fetchSeasonDeep: the week in progress (partial scores and all) is not a result, but it stays on the schedule", async () => {
  const ctx = ctxFor();
  const routes = liveRoutes({ 1: [100, 90], 2: [80, 120], 3: [40, 30] }, 3); // week 3 is being played
  ctx.fetch = async (url) => (routes[url] === undefined ? missing : ok(routes[url]));
  const entry = { league: { league_id: "L9", season: "2026", status: "in_season", settings: { playoff_week_start: 15 } }, rosters: rosterGames(2) };
  const deep = await ctx.DeepHistory.fetchSeasonDeep(entry, () => {});
  assert.strictEqual(Array.from(deep.weeks, (w) => w.week).join(","), "1,2");
  assert.strictEqual(Array.from(deep.scheduleWeeks, (w) => w.week).join(","), "1,2,3", "the simulator still needs it as a remaining game");
});

test("Head to Head and Records: a game still being played is in nobody's record", async () => {
  const ctx = ctxFor();
  const routes = liveRoutes({ 1: [100, 90], 2: [80, 120], 3: [400, 10] }, 3);
  ctx.fetch = async (url) => (routes[url] === undefined ? missing : ok(routes[url]));
  const entry = {
    league: { league_id: "L9", season: "2026", status: "in_season", settings: { playoff_week_start: 15 } },
    rosters: [
      { roster_id: 1, owner_id: "u1", settings: { wins: 1, losses: 1, ties: 0, fpts: 180 } },
      { roster_id: 2, owner_id: "u2", settings: { wins: 1, losses: 1, ties: 0, fpts: 210 } },
    ],
    users: [
      { user_id: "u1", display_name: "alvin", metadata: {} },
      { user_id: "u2", display_name: "teddy", metadata: {} },
    ],
    bracket: [],
  };
  const deep = await ctx.DeepHistory.fetchSeasonDeep(entry, () => {});
  ctx.__chain = [entry];
  ctx.__deep = [deep];
  const out = JSON.parse(
    runInLoadedContext(
      ctx,
      `JSON.stringify((function () {
        const stats = DeepHistory.computeStats(__chain, __deep, {});
        const a = stats.managers.find((m) => m.userId === "u1");
        const h2h = a.headToHead.find((h) => h.opponentUserId === "u2");
        return { h2h: [h2h.wins, h2h.losses], highest: stats.records.highestWeekScore.points, blowout: stats.records.biggestBlowout.margin };
      })())`
    )
  );
  assert.deepStrictEqual(out.h2h, [1, 1], "weeks 1 and 2 only: one win each, not a third game");
  assert.strictEqual(out.highest, 120, "the 400-point week in progress is not the high score");
  assert.strictEqual(out.blowout, 40, "and the 390-point gap is not the biggest blowout");
});

// ---- the archive-reading build scripts ------------------------------------------------------------------
const archive2026 = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sleeper-archive", "2026.json"), "utf8"));
const withPartialWeek = (extra = {}) => {
  const copy = JSON.parse(JSON.stringify(archive2026));
  const wk = copy.weeks.find((w) => w.week === 6);
  wk.matchups.forEach((m, i) => (m.points = 40 + i)); // week 6 under way, partial scores
  return { ...copy, ...extra };
};

test("the Records replay never replays a week that is still being played", () => {
  const points = replayLib.timePoints([withPartialWeek({ nflWeek: 6 })]);
  assert.strictEqual(points[points.length - 1].week, 5, "week 6 has scores but is the week in progress");
  assert.ok(points[points.length - 1].isLastWeek);
  // Without the backup's recorded clock, the rosters' records say the same thing.
  const noClock = withPartialWeek();
  delete noClock.nflWeek;
  assert.strictEqual(replayLib.timePoints([noClock]).pop().week, 5);
  // Once Sleeper has moved on, week 6 is a result.
  assert.strictEqual(replayLib.timePoints([withPartialWeek({ nflWeek: 7, rosters: archive2026.rosters.map((r) => ({ ...r, settings: { ...r.settings, wins: (r.settings.wins || 0) + 0, losses: (r.settings.losses || 0) + 1 } })) })]).pop().week, 6);
});

test("the build scripts' helper runs the site's own rule", () => {
  assert.strictEqual(finished.finishedThrough(archive2026), 5, "the committed 2026 archive: five games each");
  assert.strictEqual(finished.finishedWeeksOf(withPartialWeek({ nflWeek: 6 }), withPartialWeek().weeks).filter((w) => w.matchups.some((m) => m.points > 0)).length, 5);
  assert.strictEqual(finished.finishedThrough({ league: { status: "complete" }, rosters: [] }), Infinity);
});

test("the backup records Sleeper's week in progress, so readers know where the final weeks end", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "backup-sleeper-data.js"), "utf8");
  assert.match(src, /\/state\/nfl/);
  assert.match(src, /saved\.nflWeek = nflWeek/);
});

test("every script that reads weekly scores from the archive applies the finished-weeks rule", () => {
  ["build-player-index.js", "build-team-raw-stats.js"].forEach((file) => {
    const src = fs.readFileSync(path.join(ROOT, "scripts", file), "utf8");
    assert.match(src, /finishedWeeksOf/, file);
  });
  assert.match(fs.readFileSync(path.join(ROOT, "scripts", "lib", "records-replay.js"), "utf8"), /finishedWeeksOf/);
  assert.match(fs.readFileSync(path.join(ROOT, "scripts", "update-power-rankings.js"), "utf8"), /week < safeBeforeWeek/);
});
