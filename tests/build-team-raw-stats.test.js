const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const { STAT_KEYS, sumStarterStats, regularWeeksOf, weeksToFetch } = require("../scripts/build-team-raw-stats.js");

const rosters = [
  { roster_id: 1, owner_id: "u1" },
  { roster_id: 2, owner_id: "u2" },
  { roster_id: 3, owner_id: null }, // an orphaned roster has no manager to credit
];

test("column order matches the Records page's RAW_STATS exactly, since the order IS the file format", () => {
  const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "record-book.js"]);
  const pageKeys = JSON.parse(runInLoadedContext(ctx, "JSON.stringify(RecordBook.RAW_STATS.map((s) => s.key))"));
  assert.deepStrictEqual(STAT_KEYS, pageKeys);
});

test("sumStarterStats adds up only the players a roster actually started, per manager", () => {
  const stats = {
    p1: { pass_yd: 300, pass_td: 2, pass_int: 1 },
    p2: { rec: 8, rec_yd: 110, rec_td: 1 },
    benched: { pass_yd: 999, rec: 99 },
    DEN: { def_td: 1 },
  };
  const matchups = [
    { roster_id: 1, starters: ["p1", "p2", "DEN"] },
    { roster_id: 2, starters: ["p2", "0", null] },
  ];
  const out = sumStarterStats(matchups, rosters, stats);
  assert.deepStrictEqual(out.u1, [300, 2, 1, 0, 0, 8, 110, 1, 1, 0, 0]);
  assert.deepStrictEqual(out.u2, [0, 0, 0, 0, 0, 8, 110, 1, 0, 0, 0]);
  assert.strictEqual(out.u3, undefined);
});

test("sumStarterStats tolerates players missing from the stats feed and non-numeric values", () => {
  const out = sumStarterStats([{ roster_id: 1, starters: ["ghost", "p1"] }], rosters, { p1: { pass_yd: "bad", rush_yd: 12 } });
  assert.deepStrictEqual(out.u1, [0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0]);
});

// `nflWeek` is the week Sleeper had in progress when the archive was saved (a season in
// progress only counts the weeks before it).
const archive = (status, weeks, playoffStart = 15, nflWeek = 99) => ({
  league: { status, settings: { playoff_week_start: playoffStart } },
  rosters: [],
  nflWeek,
  weeks: weeks.map((w) => ({ week: w, matchups: [{ roster_id: 1, points: w === 17 ? 0 : 100 }] })),
});

test("regularWeeksOf keeps scored weeks before the playoffs and drops playoff and unscored weeks", () => {
  assert.deepStrictEqual(regularWeeksOf(archive("complete", [1, 2, 14, 15, 16, 17])), [1, 2, 14]);
  // week 3 has no scores yet (a future week the archive already lists)
  const a = archive("in_season", [1, 2, 3]);
  a.weeks[2].matchups[0].points = 0;
  assert.deepStrictEqual(regularWeeksOf(a), [1, 2]);
});

test("regularWeeksOf leaves out the week still in progress, partial box scores and all", () => {
  // Sleeper says week 3 is under way: it already has scores, but it is not a result yet.
  assert.deepStrictEqual(regularWeeksOf(archive("in_season", [1, 2, 3], 15, 3)), [1, 2]);
  assert.deepStrictEqual(regularWeeksOf(archive("in_season", [1, 2, 3], 15, 4)), [1, 2, 3]);
  // A finished season is never trimmed.
  assert.deepStrictEqual(regularWeeksOf(archive("complete", [1, 2, 3], 15, 3)), [1, 2, 3]);
});

test("weeksToFetch never re-downloads stored weeks of a finished season but refreshes a season in progress", () => {
  const stored = { 1: {}, 2: {} };
  assert.deepStrictEqual(weeksToFetch(archive("complete", [1, 2, 3, 4]), stored), [3, 4]);
  assert.deepStrictEqual(weeksToFetch(archive("complete", [1, 2]), stored), []);
  assert.deepStrictEqual(weeksToFetch(archive("in_season", [1, 2, 3]), stored), [1, 2, 3]);
});
