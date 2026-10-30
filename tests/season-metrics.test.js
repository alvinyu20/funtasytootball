const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "metrics.js", "charts.js", "manual-history.js", "season.js"]);

const mvp = (over) => ({
  playerId: "1",
  player: "Josh Allen",
  position: "QB",
  par: 195,
  wins: 2.3,
  ppg: 23.8,
  gamesPlayed: 13,
  owner: "evangonnerman",
  swung: 2,
  ...over,
});

const pick = (over) => ({
  playerId: "9",
  player: "Matthew Stafford",
  position: "QB",
  round: 12,
  pickInRound: 5,
  pickNo: 113,
  username: "sofarrsogood",
  season: "2025",
  value: 136,
  typical: 12,
  valueOverSlot: 124,
  grade: "S+",
  injuredWeeks: 0,
  ...over,
});

test("metricPillsHtml: one pill per position with the active one marked, so the list is a filter and not a second table", () => {
  const html = ctx.metricPillsHtml("mvp", "WR");
  ["All", "QB", "RB", "WR", "TE", "K", "DEF"].forEach((p) => assert.ok(html.includes(`data-metric-value="${p}"`), p));
  assert.ok(html.includes('data-metric-value="WR" aria-pressed="true"'));
  assert.ok(html.includes('data-metric-value="QB" aria-pressed="false"'));
  assert.ok(html.includes('data-metric-group="mvp"'));
});

test("filterByPosition: All keeps the order, a position keeps only that position, both stop at five", () => {
  const list = [
    { position: "QB", n: 1 }, { position: "RB", n: 2 }, { position: "RB", n: 3 }, { position: "WR", n: 4 },
    { position: "RB", n: 5 }, { position: "RB", n: 6 }, { position: "RB", n: 7 }, { position: "RB", n: 8 },
  ];
  assert.strictEqual(ctx.filterByPosition(list, "All").length, 5);
  assert.strictEqual(ctx.filterByPosition(list, "All")[0].n, 1);
  assert.strictEqual(ctx.filterByPosition(list, "RB").length, 5);
  assert.ok(ctx.filterByPosition(list, "RB").every((r) => r.position === "RB"));
  assert.strictEqual(ctx.filterByPosition(list, "TE").length, 0);
});

test("mvpRowsHtml: shows wins and points above replacement, and says so when a position has no one yet", () => {
  const html = ctx.mvpRowsHtml([mvp()]);
  assert.ok(html.includes("Josh Allen"));
  assert.ok(html.includes("2.3 W"));
  assert.ok(html.includes("195 pts"));
  assert.ok(html.includes("swung 2 results"));
  assert.ok(ctx.mvpRowsHtml([]).includes("Not enough games played yet"));
});

test("mvpRowsHtml: the all-time list names the season and marks one that is still being played", () => {
  const html = ctx.mvpRowsHtml([mvp({ season: "2026", inProgress: true }), mvp({ season: "2025", playerId: "2" })], true);
  assert.ok(html.includes("2026 (in progress)"));
  assert.ok(html.includes("2025 ·"));
  assert.ok(!html.includes("2025 (in progress)"));
});

test("draftValueRowsHtml: points over slot with the letter beside it, S+ included, and a note for injured weeks", () => {
  const html = ctx.draftValueRowsHtml([pick(), pick({ playerId: "10", player: "Hurt Guy", grade: "D", valueOverSlot: -60, injuredWeeks: 9 })]);
  assert.ok(html.includes("+124"));
  assert.ok(html.includes("grade-badge-splus"));
  assert.ok(html.includes("-60"));
  assert.ok(html.includes("9 wks injured"));
  assert.ok(html.includes("136 vs 12 typical"));
  assert.ok(ctx.draftValueRowsHtml([]).includes("Nothing to show"));
});

function totalMetrics() {
  return {
    kind: "total",
    awards: [
      { season: "2025", complete: true, mvp: { All: [mvp({ season: undefined })] } },
      { season: "2026", complete: false, mvp: { All: [mvp({ player: "Jaxon Smith-Njigba", position: "WR" })] } },
    ],
    steals: [pick()],
    busts: [],
    cursed: [],
    constants: { pointsPerWin: 85.76 },
  };
}

test("renderAwardsMetricsSection: the all-time view lists an MVP per season, newest first, and flags the current one", () => {
  const html = ctx.renderAwardsMetricsSection({ metrics: totalMetrics() });
  assert.ok(html.includes("League MVP By Season"));
  assert.ok(html.indexOf("2026 (in progress)") < html.indexOf("2025 ·"));
  assert.ok(html.includes("Biggest Draft Steals Of All Time"));
  assert.ok(html.includes("about 86 season points"));
});

test("renderAwardsMetricsSection: a season in progress gets the MVP list with filters but no steals or busts yet", () => {
  const metrics = {
    kind: "season",
    constants: { pointsPerWin: 85.76 },
    awards: { complete: false, regularWeeks: 7, mvp: { All: [mvp()] }, championsAce: null, steals: [], busts: [], cursed: [] },
  };
  const html = ctx.renderAwardsMetricsSection({ metrics });
  assert.ok(html.includes("Through Week 7"));
  assert.ok(html.includes('id="metric-mvp-list"'));
  assert.ok(html.includes('data-metric-group="mvp"'));
  assert.ok(html.includes("handed out when the season ends"));
  assert.ok(!html.includes("Biggest Steals"));
});

test("renderAwardsMetricsSection: nothing when the season has no metrics", () => {
  assert.strictEqual(ctx.renderAwardsMetricsSection({}), "");
});
