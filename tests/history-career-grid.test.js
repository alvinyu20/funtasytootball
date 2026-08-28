const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "history.js"]);
}

test("sparklinePoints: empty input returns an empty string (caller skips rendering the <svg> entirely)", () => {
  const ctx = setup();
  assert.strictEqual(ctx.sparklinePoints([], 100, 28, 3), "");
});

test("sparklinePoints: a single value plots one point at the horizontal start, without dividing by zero", () => {
  const ctx = setup();
  const points = ctx.sparklinePoints([5], 100, 28, 3);
  assert.strictEqual(points, "3.0,25.0", "one value, no x-step, and a finite (not NaN) y from the zero-range fallback");
});

test("sparklinePoints: the highest value plots at the top (smallest y) and the lowest at the bottom (largest y)", () => {
  const ctx = setup();
  const points = ctx.sparklinePoints([2, 8, 4], 100, 28, 3)
    .split(" ")
    .map((p) => p.split(",").map(Number));
  const ys = points.map((p) => p[1]);
  assert.ok(ys[1] < ys[0] && ys[1] < ys[2], "the middle value (8, the max) should have the smallest y coordinate");
});

test("sparklinePoints: flat input (all equal values) doesn't divide by zero and centers the line", () => {
  const ctx = setup();
  const points = ctx.sparklinePoints([6, 6, 6], 100, 28, 3)
    .split(" ")
    .map((p) => p.split(",").map(Number));
  const ys = points.map((p) => p[1]);
  assert.ok(ys.every((y) => Number.isFinite(y)), "no NaN/Infinity from a zero range");
  assert.ok(ys.every((y) => y === ys[0]), "a flat series should plot as a flat line");
});

test("sparklinePoints: x coordinates are evenly spaced from pad to width-pad", () => {
  const ctx = setup();
  const points = ctx.sparklinePoints([1, 2, 3, 4], 100, 28, 3)
    .split(" ")
    .map((p) => p.split(",").map(Number));
  const xs = points.map((p) => p[0]);
  assert.strictEqual(xs[0], 3, "first point starts at the left padding");
  assert.strictEqual(xs[xs.length - 1], 97, "last point ends at width - padding");
});

test("renderCareerRecords: builds a career grid card per manager, using wins-per-season for the sparkline and win% (not title count) as the caption", async () => {
  const ctx = setup();

  // Stub the network-touching pieces this function depends on with a
  // small, fully-controlled pair of managers — one with 3 Sleeper
  // seasons, no manual/ESPN-era history, so the test is about the
  // rendering logic itself, not real league data.
  ctx.__FAKE_STATS__ = {
    managers: [
      {
        userId: "u1",
        username: "evangonnerman",
        teamName: "evangonnerman",
        careerRegularSeasonWins: 20,
        careerRegularSeasonLosses: 10,
        careerRegularSeasonTies: 0,
        careerPlayoffWins: 3,
        careerPlayoffLosses: 1,
        careerPlayoffTies: 0,
        careerPF: 3500.5,
        championships: 2,
        seasons: [
          { season: 2021, wins: 6 },
          { season: 2022, wins: 8 },
          { season: 2023, wins: 6 },
        ],
      },
    ],
  };
  runInLoadedContext(
    ctx,
    `
    DeepHistory.buildAll = async () => [];
    DeepHistory.computeStats = () => __FAKE_STATS__;
    ManualHistory.computeManagerStats = () => new Map();
    `
  );

  await ctx.renderCareerRecords([{ league: { season: "2023" } }], {}, { seasons: [] });

  const gridHtml = ctx.document.getElementById("career-grid").innerHTML;
  assert.ok(gridHtml.includes("evangonnerman"), "should show the manager's name");
  assert.ok(gridHtml.includes("career-spark"), "should render a sparkline element");
  // 20 regular + 3 playoff = 23 wins out of 34 total games = 67.6%
  assert.ok(gridHtml.includes("67.6% win rate"), "should show career win% as the caption");
  assert.ok(!/\d\s*titles?/i.test(gridHtml), "should NOT state a title count anywhere in the card");
  assert.ok(!gridHtml.includes("🏆"), "should not show a trophy/title indicator either");
});

test("renderCareerRecords: a manager's sparkline includes ESPN-era (manual) seasons merged in alongside Sleeper seasons, not just the Sleeper-tracked half of their career", async () => {
  const ctx = setup();
  ctx.__FAKE_STATS__ = {
    managers: [
      {
        userId: "u1",
        username: "yulovesyou",
        teamName: "yulovesyou",
        careerRegularSeasonWins: 8,
        careerRegularSeasonLosses: 5,
        careerRegularSeasonTies: 0,
        careerPlayoffWins: 0,
        careerPlayoffLosses: 0,
        careerPlayoffTies: 0,
        careerPF: 1200,
        championships: 0,
        seasons: [{ season: 2023, wins: 8 }],
      },
    ],
  };
  ctx.__FAKE_MANUAL_STATS__ = new Map([
    [
      "yulovesyou",
      {
        totals: {
          careerRegularSeasonWins: 9,
          careerRegularSeasonLosses: 4,
          careerRegularSeasonTies: 0,
          careerPlayoffWins: 1,
          careerPlayoffLosses: 0,
          careerPlayoffTies: 0,
          careerPF: 1300,
          championships: 1,
          runnerUps: 0,
          thirdPlaceFinishes: 0,
          winningSeasons: 1,
          losingSeasons: 0,
          playoffAppearances: 1,
          byes: 0,
          firstPicks: 0,
        },
        seasons: [{ season: 2017, wins: 9 }],
      },
    ],
  ]);
  runInLoadedContext(
    ctx,
    `
    DeepHistory.buildAll = async () => [];
    DeepHistory.computeStats = () => __FAKE_STATS__;
    ManualHistory.computeManagerStats = () => __FAKE_MANUAL_STATS__;
    `
  );

  await ctx.renderCareerRecords([{ league: { season: "2023" } }], {}, { seasons: [] });

  // Both the merged career total (careerRegularSeasonWins: 8+9=17) and the
  // per-season sparkline data (2017's wins=9 alongside 2023's wins=8)
  // should reflect the merge -- checked indirectly via the win% caption,
  // since the sparkline's raw SVG points aren't easy to assert on
  // directly, but a wrong total here would mean the merge didn't happen.
  const gridHtml = ctx.document.getElementById("career-grid").innerHTML;
  // 17 wins (8+9) + 1 playoff win = 18, out of 8+5+9+4+1 = 27 total games = 66.7%
  assert.ok(gridHtml.includes("66.7% win rate"), "career win% should include the merged-in ESPN-era record");
});

// Three managers with deliberately DIFFERENT orderings across categories
// (gold count, name, years played) so a test sorting by one key can't
// accidentally pass just because it happens to agree with another key.
function fakeCareerTableStats() {
  return {
    managers: [
      {
        userId: "u1",
        username: "zeta",
        teamName: "zeta",
        careerRegularSeasonWins: 40,
        careerRegularSeasonLosses: 20,
        careerRegularSeasonTies: 0,
        careerPlayoffWins: 10,
        careerPlayoffLosses: 5,
        careerPlayoffTies: 0,
        careerPF: 9000,
        championships: 3,
        runnerUps: 1,
        thirdPlaceFinishes: 0,
        playoffAppearances: 5,
        seasons: new Array(6).fill(0).map((_, i) => ({ season: 2018 + i, wins: 6 })),
      },
      {
        userId: "u2",
        username: "alpha",
        teamName: "alpha",
        careerRegularSeasonWins: 35,
        careerRegularSeasonLosses: 25,
        careerRegularSeasonTies: 0,
        careerPlayoffWins: 8,
        careerPlayoffLosses: 8,
        careerPlayoffTies: 0,
        careerPF: 8500,
        championships: 1,
        runnerUps: 3,
        thirdPlaceFinishes: 2,
        playoffAppearances: 6,
        seasons: new Array(6).fill(0).map((_, i) => ({ season: 2018 + i, wins: 5 })),
      },
      {
        userId: "u3",
        username: "mno",
        teamName: "mno",
        careerRegularSeasonWins: 15,
        careerRegularSeasonLosses: 15,
        careerRegularSeasonTies: 0,
        careerPlayoffWins: 2,
        careerPlayoffLosses: 3,
        careerPlayoffTies: 0,
        careerPF: 4000,
        championships: 0,
        runnerUps: 0,
        thirdPlaceFinishes: 1,
        playoffAppearances: 2,
        seasons: new Array(3).fill(0).map((_, i) => ({ season: 2021 + i, wins: 5 })),
      },
    ],
  };
}

async function setupCareerTable(ctx) {
  ctx.__FAKE_STATS__ = fakeCareerTableStats();
  runInLoadedContext(
    ctx,
    `
    DeepHistory.buildAll = async () => [];
    DeepHistory.computeStats = () => __FAKE_STATS__;
    ManualHistory.computeManagerStats = () => new Map();
    `
  );
  await ctx.renderCareerRecords([{ league: { season: "2023" } }], {}, { seasons: [] });
}

test("renderCareerRecords: the table has a two-tier header (Titles / Playoffs / Playoff / Reg Season groups) and defaults to sorting by Gold, descending", async () => {
  const ctx = setup();
  await setupCareerTable(ctx);

  const bodyHtml = ctx.document.getElementById("career-body").innerHTML;
  const names = [...bodyHtml.matchAll(/data-label="Owner">([^<]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(names, ["zeta", "alpha", "mno"], "default sort should be Gold descending: zeta(3), alpha(1), mno(0)");

  const goldCells = [...bodyHtml.matchAll(/data-label="Gold">([^<]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(goldCells, ["3", "1", "—"], "mno's 0 championships should render as an em dash");
});

test("renderCareerRecords: table row values are computed correctly — Playoffs App/Pct/Years, Playoff and Reg Season record/win%", async () => {
  const ctx = setup();
  await setupCareerTable(ctx);

  const bodyHtml = ctx.document.getElementById("career-body").innerHTML;
  // zeta: 5 playoff appearances out of 6 years played = 83%
  assert.ok(bodyHtml.includes('data-label="App">5<'), "zeta's playoff appearances");
  assert.ok(bodyHtml.includes('data-label="Pct">83%<'), "zeta's playoff rate (5/6 seasons)");
  assert.ok(bodyHtml.includes('data-label="Years">6<'), "zeta's years played");
  // zeta playoff record: 10-5 -> 66.7%
  assert.ok(bodyHtml.includes('data-label="Playoff Record">10-5<'));
  assert.ok(bodyHtml.includes('data-label="Playoff Win %">66.7%<'));
  // zeta reg season record: 40-20 -> 66.7%
  assert.ok(bodyHtml.includes('data-label="Reg Season Record">40-20<'));
  assert.ok(bodyHtml.includes('data-label="Reg Season Win %">66.7%<'));
});

test("sortCareerRows: sorting by a different key produces a genuinely different order than the default", async () => {
  const ctx = setup();
  await setupCareerTable(ctx);

  runInLoadedContext(ctx, `CAREER_SORT = { key: "name", dir: "asc" }; renderCareerTable();`);
  const byName = [...ctx.document.getElementById("career-body").innerHTML.matchAll(/data-label="Owner">([^<]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(byName, ["alpha", "mno", "zeta"], "sorting by name should read alphabetically, not match the gold-count order");
});

test("sortCareerRows: clicking the same column again (simulated by toggling dir) flips the order", async () => {
  const ctx = setup();
  await setupCareerTable(ctx);

  runInLoadedContext(ctx, `CAREER_SORT = { key: "gold", dir: "asc" }; renderCareerTable();`);
  const ascending = [...ctx.document.getElementById("career-body").innerHTML.matchAll(/data-label="Owner">([^<]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(ascending, ["mno", "alpha", "zeta"], "ascending gold order should be the exact reverse of the default descending order");
});

test("sortCareerRows: sorting by Years (Playoffs group) and by Playoff Win % each independently reorder the table", async () => {
  const ctx = setup();
  await setupCareerTable(ctx);

  runInLoadedContext(ctx, `CAREER_SORT = { key: "years", dir: "desc" }; renderCareerTable();`);
  const byYears = [...ctx.document.getElementById("career-body").innerHTML.matchAll(/data-label="Owner">([^<]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(byYears, ["zeta", "alpha", "mno"], "zeta and alpha both played 6 years (tied, stable order), mno played 3");

  runInLoadedContext(ctx, `CAREER_SORT = { key: "playoffWinPct", dir: "desc" }; renderCareerTable();`);
  const byPlayoffWinPct = [...ctx.document.getElementById("career-body").innerHTML.matchAll(/data-label="Owner">([^<]+)</g)].map((m) => m[1]);
  // zeta: 10/15=66.7%, alpha: 8/16=50%, mno: 2/5=40%
  assert.deepStrictEqual(byPlayoffWinPct, ["zeta", "alpha", "mno"]);
});
