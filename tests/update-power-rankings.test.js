const test = require("node:test");
const assert = require("node:assert");
const { buildSafeDeep } = require("../scripts/update-power-rankings.js");

function fakeMatchups(points) {
  // points: array of per-roster point totals, roster_id = index + 1
  return points.map((pts, i) => ({ roster_id: i + 1, matchup_id: Math.floor(i / 2) + 1, points: pts }));
}

function fakeSleeperAPI(weeklyMatchups) {
  // weeklyMatchups: array indexed by week-1, each an array of matchup objects (or null/[] to stop the walk)
  return {
    async getMatchups(leagueId, week) {
      const m = weeklyMatchups[week - 1];
      return m === undefined ? [] : m;
    },
  };
}

test("buildSafeDeep: a week still in progress (Sleeper's own current week) is excluded from `weeks`, even if some scores are already in", async () => {
  const weekly = [
    fakeMatchups([100, 95, 110, 88]), // week 1 - fully scored
    fakeMatchups([12, 0, 0, 0]), // week 2 - only one game in so far, clearly in progress
  ];
  const api = fakeSleeperAPI(weekly);
  // Sleeper reports week 2 as current -> only week 1 is "safe"
  const deep = await buildSafeDeep(api, "league1", 17, /* safeBeforeWeek */ 2);
  assert.deepStrictEqual(deep.weeks.map((w) => w.week), [1], "week 2 should be excluded even though it has a nonzero score already");
});

test("buildSafeDeep: `scheduleWeeks` still includes the in-progress week (needed for the playoff simulator's remaining schedule), only `weeks` excludes it", async () => {
  const weekly = [fakeMatchups([100, 95, 110, 88]), fakeMatchups([12, 0, 0, 0])];
  const api = fakeSleeperAPI(weekly);
  const deep = await buildSafeDeep(api, "league1", 17, 2);
  assert.deepStrictEqual(deep.scheduleWeeks.map((w) => w.week), [1, 2], "scheduleWeeks keeps every week fetched, played or not");
});

test("buildSafeDeep: once a week is genuinely done (Sleeper has moved on), it's included normally", async () => {
  const weekly = [fakeMatchups([100, 95, 110, 88]), fakeMatchups([102, 97, 88, 91])];
  const api = fakeSleeperAPI(weekly);
  // Sleeper reports week 3 as current -> weeks 1 AND 2 are both safe
  const deep = await buildSafeDeep(api, "league1", 17, 3);
  assert.deepStrictEqual(deep.weeks.map((w) => w.week), [1, 2]);
});

test("buildSafeDeep: preseason — Sleeper's current week is 1, so there is no safe/complete week at all yet", async () => {
  const weekly = [fakeMatchups([0, 0, 0, 0])]; // Sleeper generates the matchup pairing before any score exists
  const api = fakeSleeperAPI(weekly);
  const deep = await buildSafeDeep(api, "league1", 17, 1);
  assert.deepStrictEqual(deep.weeks, [], "no week should be considered safe before Sleeper's current week has even reached 2");
});

test("buildSafeDeep: a week with a pairing but literally all-zero scores (bye week artifact, or the week hasn't started) doesn't count as played, independent of the week-safety check", async () => {
  const weekly = [fakeMatchups([0, 0, 0, 0]), fakeMatchups([100, 95, 110, 88])];
  const api = fakeSleeperAPI(weekly);
  const deep = await buildSafeDeep(api, "league1", 17, 3); // both weeks would be "safe" by the week-number check alone
  assert.deepStrictEqual(deep.weeks.map((w) => w.week), [2], "week 1's all-zero scores mean it never actually happened, regardless of week safety");
});

test("buildSafeDeep: stops walking once Sleeper returns no matchups at all for a week (end of the generated schedule)", async () => {
  const weekly = [fakeMatchups([100, 95, 110, 88])]; // only week 1 exists; week 2 onward returns []
  const api = fakeSleeperAPI(weekly);
  const deep = await buildSafeDeep(api, "league1", 17, 10);
  assert.deepStrictEqual(deep.scheduleWeeks.map((w) => w.week), [1]);
});
