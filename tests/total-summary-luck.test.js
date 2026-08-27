const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
}

// A minimal extra-luck entry, matching exactly the shape
// ManualHistory.computeAllSeasonLuck() produces.
function luckEntry(teamName, season, luckPct, overrides) {
  return {
    teamName,
    season,
    luckPct,
    wins: 8,
    losses: 5,
    ties: 0,
    overallWins: 65,
    overallLosses: 52,
    overallTies: 0,
    ...overrides,
  };
}

test("computeTotalSummary: with no Sleeper seasons at all, the Luckiest/Unluckiest lists are built entirely from extraSeasonLuck", () => {
  const ctx = setup();
  const extra = [luckEntry("A", 2017, 12), luckEntry("B", 2018, -7)];
  const summary = ctx.DeepHistory.computeTotalSummary([], [], {}, {}, extra);

  assert.strictEqual(summary.top5Luckiest.length, 2);
  assert.strictEqual(summary.top5Luckiest[0].teamName, "A", "the luckier of the two (higher luckPct) should rank first");
  assert.strictEqual(summary.top5Unluckiest[0].teamName, "B", "the unluckier of the two (lower luckPct) should rank first");
});

test("computeTotalSummary: Luckiest/Unluckiest lists are now capped at 10 entries, not 5", () => {
  const ctx = setup();
  // 15 synthetic ESPN-era seasons with strictly increasing luck, so sort order is unambiguous.
  const extra = Array.from({ length: 15 }, (_, i) => luckEntry(`team${i}`, 2000 + i, i - 7));
  const summary = ctx.DeepHistory.computeTotalSummary([], [], {}, {}, extra);

  assert.strictEqual(summary.top5Luckiest.length, 10, "Luckiest list should hold up to 10 entries now, not 5");
  assert.strictEqual(summary.top5Unluckiest.length, 10, "Unluckiest list should hold up to 10 entries now, not 5");
  assert.strictEqual(summary.top5Luckiest[0].teamName, "team14", "highest luckPct (7) should be luckiest");
  assert.strictEqual(summary.top5Unluckiest[0].teamName, "team0", "lowest luckPct (-7) should be unluckiest");
});

test("computeTotalSummary: works fine (no crash, empty lists) when extraSeasonLuck is omitted entirely", () => {
  const ctx = setup();
  let summary;
  assert.doesNotThrow(() => {
    summary = ctx.DeepHistory.computeTotalSummary([], [], {}, {});
  });
  assert.strictEqual(summary.top5Luckiest.length, 0);
  assert.strictEqual(summary.top5Unluckiest.length, 0);
});

test("computeTotalSummary: an ESPN-era extra-luck entry can outrank every Sleeper-era season if its luckPct is more extreme", () => {
  const ctx = setup();
  // No live Sleeper seasons in this test, so the "Sleeper-era" pool is
  // empty — the point here is just that a supplied extra entry surfaces
  // in the final ranked list at all, proving the merge actually happens
  // rather than the parameter being silently ignored.
  const extra = [luckEntry("EspnTeam", 2017, 99)];
  const summary = ctx.DeepHistory.computeTotalSummary([], [], {}, {}, extra);
  assert.strictEqual(summary.top5Luckiest[0].teamName, "EspnTeam");
  assert.strictEqual(summary.top5Luckiest[0].season, 2017);
});
