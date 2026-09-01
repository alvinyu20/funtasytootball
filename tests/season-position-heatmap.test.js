const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "season.js"]);
}

function fakePositionTable() {
  return {
    columns: [{ key: "QB", label: "QB" }],
    rows: [
      { teamName: "yulovesyou", cells: { QB: 25.5 } },
      { teamName: "hmart92", cells: { QB: 12.0 } },
    ],
  };
}

test("renderPositionTable: uses the same muted, semi-transparent heatColor() everywhere else on the site now uses, not a hard opaque color", () => {
  const ctx = setup();
  const html = ctx.renderPositionTable(fakePositionTable());
  const cells = [...html.matchAll(/style="background:(rgba\([^)]+\))"/g)].map((m) => m[1]);
  assert.strictEqual(cells.length, 2);
  cells.forEach((c) => assert.match(c, /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/, "should be a muted rgba color, not an opaque rgb one"));
});

test("renderPositionTable: the higher value in a column is green-dominant, the lower is red-dominant, matching the standard (non-inverted) direction", () => {
  const ctx = setup();
  const html = ctx.renderPositionTable(fakePositionTable());
  const cells = [...html.matchAll(/style="background:(rgba\([^)]+\))">([\d.]+)</g)].map((m) => ({ color: m[1], value: m[2] }));
  const best = cells.find((c) => c.value === "25.5");
  const worst = cells.find((c) => c.value === "12.0");
  assert.ok(best && worst);
  const [br, bg] = best.color.match(/[\d.]+/g).map(Number);
  const [wr, wg] = worst.color.match(/[\d.]+/g).map(Number);
  assert.ok(bg > br, "the higher value should be green-dominant");
  assert.ok(wr > wg, "the lower value should be red-dominant");
});

test("renderPositionTable: the note accurately describes green=best, red=worst, not the stale gold/rust wording", () => {
  const ctx = setup();
  const html = ctx.renderPositionTable(fakePositionTable());
  assert.ok(html.includes("green is that column's best, red is its worst"));
  assert.ok(!html.includes("gold"));
  assert.ok(!html.includes("rust"));
});

test("renderPositionTable: an empty table still shows the informative empty state, not a broken heatmap", () => {
  const ctx = setup();
  const html = ctx.renderPositionTable({ columns: [], rows: [] });
  assert.ok(html.includes("No lineup data available for this season."));
});
