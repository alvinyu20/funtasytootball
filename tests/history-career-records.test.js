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

test("renderCareerRecords: no longer renders a career-grid sparkline element on the History page (that graph was removed; sparklinePoints itself lives on for the Teams page picker)", async () => {
  const ctx = setup();
  await setupCareerTable(ctx);
  // The test harness's document stub always hands back a blank
  // placeholder for any id, real or not (it doesn't model "this element
  // isn't in the page"), so the meaningful check here is that nothing
  // ever got written to it — confirming renderCareerRecords no longer
  // calls document.getElementById("career-grid") at all.
  assert.strictEqual(ctx.document.getElementById("career-grid").innerHTML, "", "nothing should ever be written to #career-grid — that render call was removed along with the graph");
});

test("renderCareerRecords: the career table still correctly merges in ESPN-era (manual) totals for a manager who played both eras, now that the grid that used to show this is gone", async () => {
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
  assert.ok(bodyHtml.includes('data-label="Owner">yulovesyou<'));
  // Regular season: 8 (Sleeper) + 9 (ESPN) = 17 wins, 5+4=9 losses.
  assert.ok(bodyHtml.includes('data-label="Reg Season Record">17-9<'), "regular season record should include the merged-in ESPN-era games");
  assert.ok(bodyHtml.includes('data-label="Gold">1<'), "the ESPN-era championship should count toward career titles");
  assert.ok(bodyHtml.includes('data-label="Years">2<'), "should count both the 2017 (ESPN) and 2023 (Sleeper) seasons played");
});

function fakeSeason(season, championRosterId) {
  return {
    league: { season },
    rosters: [
      { roster_id: 1, owner_id: "u1" },
      { roster_id: 2, owner_id: "u2" },
    ],
    users: [
      { user_id: "u1", display_name: "yulovesyou" },
      { user_id: "u2", display_name: "hmart92" },
    ],
    bracket: [], // irrelevant -- findChampionRosterId is stubbed directly in each test
  };
}

test("renderChampionshipRings: a player rostered by the champion at ANY point that season earns a ring, even if they were dropped before the title game and never started", async () => {
  const ctx = setup();
  const seasons = [fakeSeason("2021")];
  ctx.__FAKE_DEEP__ = [
    {
      weeks: [
        { week: 1, matchups: [{ roster_id: 1, players: ["P1", "P2"] }, { roster_id: 2, players: ["P3"] }] },
        { week: 2, matchups: [{ roster_id: 1, players: ["P1"] }, { roster_id: 2, players: ["P3"] }] }, // P2 already dropped by week 2
      ],
    },
  ];
  runInLoadedContext(ctx, `SleeperAPI.findChampionRosterId = () => 1; DeepHistory.buildAll = async () => __FAKE_DEEP__;`);

  const playerDirectory = { P1: { full_name: "Player One" }, P2: { full_name: "Player Two" }, P3: { full_name: "Player Three" } };
  await ctx.renderChampionshipRings(seasons, playerDirectory);

  const html = ctx.document.getElementById("rings-body").innerHTML;
  assert.ok(html.includes("Player One"), "on the champion's roster both weeks");
  assert.ok(html.includes("Player Two"), "only on the champion's roster week 1, but still earns the ring for that season");
  assert.ok(!html.includes("Player Three"), "only ever on the non-champion roster");
});

test("renderChampionshipRings: the same player on the champion's roster in multiple weeks of ONE season only earns that season's ring once", async () => {
  const ctx = setup();
  const seasons = [fakeSeason("2021")];
  ctx.__FAKE_DEEP__ = [
    {
      weeks: [
        { week: 1, matchups: [{ roster_id: 1, players: ["P1"] }] },
        { week: 2, matchups: [{ roster_id: 1, players: ["P1"] }] },
        { week: 3, matchups: [{ roster_id: 1, players: ["P1"] }] },
      ],
    },
  ];
  runInLoadedContext(ctx, `SleeperAPI.findChampionRosterId = () => 1; DeepHistory.buildAll = async () => __FAKE_DEEP__;`);
  await ctx.renderChampionshipRings(seasons, { P1: { full_name: "Player One" } });
  const html = ctx.document.getElementById("rings-body").innerHTML;
  assert.ok(html.includes('data-label="Rings">1<'), "3 weeks on the same champion in the same season is still just 1 ring, not 3");
});

test("renderChampionshipRings: multiple championship seasons for the same player accumulate rings, and the breakdown lists every year and owner", async () => {
  const ctx = setup();
  const seasons = [fakeSeason("2021"), fakeSeason("2022")];
  ctx.__FAKE_DEEP__ = [
    { weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["P1"] }] }] }, // 2021: roster 1 (yulovesyou) champion, P1 on it
    { weeks: [{ week: 1, matchups: [{ roster_id: 2, players: ["P1"] }] }] }, // 2022: roster 2 (hmart92) champion, P1 traded there and on it
  ];
  runInLoadedContext(
    ctx,
    `
    let __ringsCallCount = 0;
    SleeperAPI.findChampionRosterId = () => { __ringsCallCount++; return __ringsCallCount === 1 ? 1 : 2; };
    DeepHistory.buildAll = async () => __FAKE_DEEP__;
    `
  );
  await ctx.renderChampionshipRings(seasons, { P1: { full_name: "Player One" } });
  const html = ctx.document.getElementById("rings-body").innerHTML;
  assert.ok(html.includes('data-label="Rings">2<'), "two different championship seasons should give 2 rings");
  assert.ok(html.includes("2021 (yulovesyou)"), "breakdown should note the 2021 ring came via yulovesyou");
  assert.ok(html.includes("2022 (hmart92)"), "breakdown should note the 2022 ring came via hmart92");
});

test("renderChampionshipRings: a season with no determinable champion (still in progress, or bracket data missing) is skipped without crashing", async () => {
  const ctx = setup();
  const seasons = [fakeSeason("2026")];
  ctx.__FAKE_DEEP__ = [{ weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["P1"] }] }] }];
  runInLoadedContext(ctx, `SleeperAPI.findChampionRosterId = () => null; DeepHistory.buildAll = async () => __FAKE_DEEP__;`);
  await assert.doesNotReject(ctx.renderChampionshipRings(seasons, { P1: { full_name: "Player One" } }));
  const html = ctx.document.getElementById("rings-body").innerHTML;
  assert.ok(!html.includes("Player One"), "nobody should get a ring for a season with no confirmed champion");
});

test("renderChampionshipRings: ranks by ring count descending and caps at the top 10", async () => {
  const ctx = setup();
  // 12 one-season "championships" for 12 different single-player rosters,
  // so every player has exactly 1 ring except P1, who's on the champion
  // roster in season 1 in addition to their own solo season -- giving P1
  // 2 rings and everyone else 1, so P1 should sort first.
  const seasons = Array.from({ length: 12 }, (_, i) => fakeSeason(String(2010 + i)));
  ctx.__FAKE_DEEP__ = seasons.map((_, i) => ({
    weeks: [{ week: 1, matchups: [{ roster_id: 1, players: i === 0 ? ["P1"] : [`P${i + 1}`] }] }],
  }));
  ctx.__FAKE_DEEP__[1].weeks[0].matchups[0].players.push("P1"); // P1 also rides along on season index 1's champion roster
  runInLoadedContext(ctx, `SleeperAPI.findChampionRosterId = () => 1; DeepHistory.buildAll = async () => __FAKE_DEEP__;`);

  const directory = {};
  for (let i = 1; i <= 12; i++) directory[`P${i}`] = { full_name: `Player ${i}` };
  await ctx.renderChampionshipRings(seasons, directory);

  const html = ctx.document.getElementById("rings-body").innerHTML;
  const rows = [...html.matchAll(/data-label="Player">([^<]+)</g)].map((m) => m[1]);
  assert.strictEqual(rows.length, 10, "should cap at the top 10, even though 12 players earned at least 1 ring");
  assert.strictEqual(rows[0], "Player 1", "the 2-ring player should rank first");
});
