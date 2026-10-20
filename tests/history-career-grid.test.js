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

// The History page's career section is a sortable table (the per-manager sparkline cards now
// live on the Teams page), so these tests read the table body.
const owners = (html) => [...html.matchAll(/data-label="Owner">(?:<a [^>]*>)?([^<]+)</g)].map((m) => m[1]);

test("renderCareerRecords: one table row per manager, with the owner's name linking to their Teams page", async () => {
  const ctx = setup();
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
        runnerUps: 0,
        thirdPlaceFinishes: 0,
        playoffAppearances: 3,
        seasons: [{ season: 2021, wins: 6 }, { season: 2022, wins: 8 }, { season: 2023, wins: 6 }],
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

  const bodyHtml = ctx.document.getElementById("career-body").innerHTML;
  assert.deepStrictEqual(owners(bodyHtml), ["evangonnerman"]);
  assert.ok(bodyHtml.includes('href="teams.html#u1"'), "the owner's name links to their Teams page");
  assert.strictEqual((bodyHtml.match(/<tr>/g) || []).length, 1);
  assert.ok(bodyHtml.includes('data-label="Gold">2<'));
  assert.ok(bodyHtml.includes('data-label="Silver">—<'), "no runner-up finishes renders as an em dash");
  assert.ok(bodyHtml.includes('data-label="Years">3<'));
  assert.strictEqual(ctx.document.getElementById("career-grid").innerHTML, "", "the old card grid is no longer drawn on this page");
});

test("renderCareerRecords: ESPN-era (manual) seasons are merged into a manager's row alongside their Sleeper seasons, not just the Sleeper-tracked half of their career", async () => {
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
        runnerUps: 0,
        thirdPlaceFinishes: 0,
        playoffAppearances: 0,
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

  const bodyHtml = ctx.document.getElementById("career-body").innerHTML;
  assert.ok(bodyHtml.includes('data-label="Reg Season Record">17-9<'), "8-5 on Sleeper plus 9-4 on ESPN");
  assert.ok(bodyHtml.includes('data-label="Playoff Record">1-0<'), "the ESPN-era playoff win is included");
  assert.ok(bodyHtml.includes('data-label="Years">2<'), "one Sleeper season plus one ESPN season");
  assert.ok(bodyHtml.includes('data-label="Gold">1<'), "the ESPN-era title is included");
  assert.ok(bodyHtml.includes('data-label="Reg Season Win %">65.4%<'), "17 of 26 regular-season games");
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
  const names = owners(bodyHtml);
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
  const byName = owners(ctx.document.getElementById("career-body").innerHTML);
  assert.deepStrictEqual(byName, ["alpha", "mno", "zeta"], "sorting by name should read alphabetically, not match the gold-count order");
});

test("sortCareerRows: clicking the same column again (simulated by toggling dir) flips the order", async () => {
  const ctx = setup();
  await setupCareerTable(ctx);

  runInLoadedContext(ctx, `CAREER_SORT = { key: "gold", dir: "asc" }; renderCareerTable();`);
  const ascending = owners(ctx.document.getElementById("career-body").innerHTML);
  assert.deepStrictEqual(ascending, ["mno", "alpha", "zeta"], "ascending gold order should be the exact reverse of the default descending order");
});

test("sortCareerRows: sorting by Years (Playoffs group) and by Playoff Win % each independently reorder the table", async () => {
  const ctx = setup();
  await setupCareerTable(ctx);

  runInLoadedContext(ctx, `CAREER_SORT = { key: "years", dir: "desc" }; renderCareerTable();`);
  const byYears = owners(ctx.document.getElementById("career-body").innerHTML);
  assert.deepStrictEqual(byYears, ["zeta", "alpha", "mno"], "zeta and alpha both played 6 years (tied, stable order), mno played 3");

  runInLoadedContext(ctx, `CAREER_SORT = { key: "playoffWinPct", dir: "desc" }; renderCareerTable();`);
  const byPlayoffWinPct = owners(ctx.document.getElementById("career-body").innerHTML);
  // zeta: 10/15=66.7%, alpha: 8/16=50%, mno: 2/5=40%
  assert.deepStrictEqual(byPlayoffWinPct, ["zeta", "alpha", "mno"]);
});
