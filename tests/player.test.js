const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "charts.js", "animations.js", "player.js"]);
}

function fakePlayer(overrides) {
  return {
    name: "Test Player",
    position: "RB",
    spans: [
      { ownerId: "u1", ownerName: "yulovesyou", startSeason: "2021", startWeek: 1, endSeason: "2021", endWeek: 3, gamesOwned: 3, gamesStarted: 2, totalPoints: 36, ppg: 12 },
      { ownerId: "u2", ownerName: "hmart92", startSeason: "2021", startWeek: 5, endSeason: "2022", endWeek: 2, gamesOwned: 4, gamesStarted: 4, totalPoints: 51, ppg: 12.8 },
      { ownerId: "u1", ownerName: "yulovesyou", startSeason: "2022", startWeek: 3, endSeason: "2022", endWeek: 3, gamesOwned: 1, gamesStarted: 1, totalPoints: 30, ppg: 30 },
    ],
    careerHigh: { points: 30, season: "2022", week: 3, ownerId: "u1", ownerName: "yulovesyou", started: true },
    totals: { owners: 2, gamesOwned: 8, gamesStarted: 7, gamesBenched: 1, totalPoints: 117, ppg: 14.6 },
    weekly: [
      { season: "2021", week: 1, points: 10, started: 1 },
      { season: "2021", week: 2, points: 5, started: 0 },
      { season: "2021", week: 3, points: 12, started: 1 },
      { season: "2021", week: 5, points: 20, started: 1 },
      { season: "2021", week: 6, points: 8, started: 1 },
      { season: "2022", week: 1, points: 14, started: 1 },
      { season: "2022", week: 2, points: 9, started: 1 },
      { season: "2022", week: 3, points: 30, started: 1 },
    ],
    ...overrides,
  };
}

test("searchPlayers: matches by substring, case-insensitively", () => {
  const ctx = setup();
  ctx.__FAKE_INDEX__ = {
    p1: { name: "Josh Allen", position: "QB", totals: { gamesOwned: 40 } },
    p2: { name: "Keenan Allen", position: "WR", totals: { gamesOwned: 20 } },
    p3: { name: "Derrick Henry", position: "RB", totals: { gamesOwned: 30 } },
  };
  runInLoadedContext(ctx, "PLAYER_INDEX = __FAKE_INDEX__;");
  const results = ctx.searchPlayers("allen");
  assert.strictEqual(results.length, 2, "should match both players with 'Allen' in the name, case-insensitively");
});

test("searchPlayers: ranks results by games rostered, most first", () => {
  const ctx = setup();
  ctx.__FAKE_INDEX__ = {
    p1: { name: "Josh Allen", position: "QB", totals: { gamesOwned: 10 } },
    p2: { name: "Keenan Allen", position: "WR", totals: { gamesOwned: 50 } },
  };
  runInLoadedContext(ctx, "PLAYER_INDEX = __FAKE_INDEX__;");
  const results = ctx.searchPlayers("allen");
  assert.strictEqual(results[0][0], "p2", "the more-rostered player (Keenan Allen, 50 games) should rank first");
});

test("searchPlayers: an empty query returns no results, not everyone", () => {
  const ctx = setup();
  ctx.__FAKE_INDEX__ = { p1: { name: "Josh Allen", position: "QB", totals: { gamesOwned: 10 } } };
  runInLoadedContext(ctx, "PLAYER_INDEX = __FAKE_INDEX__;");
  assert.deepStrictEqual([...ctx.searchPlayers("")], []);
  assert.deepStrictEqual([...ctx.searchPlayers("   ")], []);
});

test("searchPlayers: caps results at 8, even with many matches", () => {
  const ctx = setup();
  const index = {};
  for (let i = 0; i < 15; i++) index["p" + i] = { name: `Test Player ${i}`, position: "RB", totals: { gamesOwned: i } };
  ctx.__FAKE_INDEX__ = index;
  runInLoadedContext(ctx, "PLAYER_INDEX = __FAKE_INDEX__;");
  assert.strictEqual(ctx.searchPlayers("test").length, 8);
});

test("formatSpanRange: collapses to a single label when a span starts and ends the same week", () => {
  const ctx = setup();
  const span = { startSeason: "2022", startWeek: 3, endSeason: "2022", endWeek: 3 };
  assert.strictEqual(ctx.formatSpanRange(span), "2022 Wk3");
});

test("formatSpanRange: shows a start-to-end range for a multi-week span, including across season boundaries", () => {
  const ctx = setup();
  const span = { startSeason: "2021", startWeek: 5, endSeason: "2022", endWeek: 2 };
  assert.strictEqual(ctx.formatSpanRange(span), "2021 Wk5 – 2022 Wk2");
});

test("buildSpanLookup: correctly attributes a given (season, week) to the span whose range contains it", () => {
  const ctx = setup();
  const spans = [
    { ownerId: "u1", startSeason: "2021", startWeek: 1, endSeason: "2021", endWeek: 3 },
    { ownerId: "u2", startSeason: "2021", startWeek: 5, endSeason: "2022", endWeek: 2 },
  ];
  const find = ctx.buildSpanLookup(spans);
  assert.strictEqual(find("2021", 2).ownerId, "u1");
  assert.strictEqual(find("2021", 6).ownerId, "u2");
  assert.strictEqual(find("2022", 1).ownerId, "u2", "should correctly resolve across the season boundary");
  assert.strictEqual(find("2021", 4), null, "a week inside a real gap (not in any span) should resolve to null, not throw");
});

test("renderPlayerDetail: renders the header, stat strip, career-high callout, and ownership table with the same-owner-twice case intact", () => {
  const ctx = setup();
  const html = ctx.renderPlayerDetail("9999", fakePlayer());

  assert.ok(html.includes("Test Player"), "player name in the header");
  assert.ok(html.includes(">RB<"), "position shown");
  assert.ok(html.includes(">2<") , "owners stat card (2 distinct owners)");
  assert.ok(html.includes("7 / 1"), "started/benched stat card");
  assert.ok(html.includes("Career high"));
  assert.ok(html.includes("30.0"), "career-high value");
  assert.ok(html.includes("owned by yulovesyou"), "career-high owner attribution");

  const yuloCount = (html.match(/yulovesyou/g) || []).length;
  assert.ok(yuloCount >= 2, "yulovesyou should appear in at least 2 separate table rows (their two non-contiguous spans)");
});

test("renderPlayerDetail: omits the career-high callout box gracefully when there's no career high on record", () => {
  const ctx = setup();
  const html = ctx.renderPlayerDetail("9999", fakePlayer({ careerHigh: null }));
  assert.ok(!html.includes("player-high-callout"), "the callout box itself should be omitted (the chart legend's unrelated 'Career high' label is expected to still appear)");
});

test("renderCareerArc: both All and Starts tab panels are present, with the correct game counts in the tab labels", () => {
  const ctx = setup();
  const html = ctx.renderCareerArc(fakePlayer());
  assert.ok(html.includes("All (8)"), "the All tab should show the total games-owned count");
  assert.ok(html.includes("Starts (7)"), "the Starts tab should show the games-started count");
  assert.ok(html.includes('data-chart-panel="all"'));
  assert.ok(html.includes('data-chart-panel="starts"'));
});

test("careerArcSvg: bands reflect real ownership spans, including the short middle span and the repeat owner", () => {
  const ctx = setup();
  const svg = ctx.careerArcSvg(fakePlayer(), "all");
  assert.ok(svg.includes("YULOVESYOU"), "band label for yulovesyou");
  assert.ok(svg.includes("HMART92"), "band label for hmart92");
});

test("careerArcSvg: the 'starts' view excludes benched weeks from the plotted line but keeps the season labels for weeks that DO have a start", () => {
  const ctx = setup();
  const player = fakePlayer();
  const allSvg = ctx.careerArcSvg(player, "all");
  const startsSvg = ctx.careerArcSvg(player, "starts");
  const allDotCount = (allSvg.match(/<circle/g) || []).length;
  const startsDotCount = (startsSvg.match(/<circle/g) || []).length;
  assert.ok(startsDotCount < allDotCount, "the starts-only view should have fewer plotted dots than the all-games view (1 benched week excluded)");
});

test("careerArcSvg: the y-axis is a clean multiple-of-5 scale, and expands past 35 only when the data actually requires it", () => {
  const ctx = setup();
  const lowPlayer = fakePlayer(); // max value 30, should NOT expand past the 35 floor
  const lowSvg = ctx.careerArcSvg(lowPlayer, "all");
  assert.ok(lowSvg.includes(">35<"), "should show a 35 tick even though nobody scored above 30");
  assert.ok(!lowSvg.includes(">40<"), "should NOT show a 40 tick when nothing exceeds 35");

  const highPlayer = fakePlayer();
  highPlayer.weekly = [...highPlayer.weekly, { season: "2022", week: 4, points: 41, started: 1 }];
  const highSvg = ctx.careerArcSvg(highPlayer, "all");
  assert.ok(highSvg.includes(">45<"), "a 41-point week should expand the axis to the next multiple of 5 (45), not stop at 35 or jump to an arbitrary number");
});

test("careerArcSvg: marks exactly one point as the career high, matching player.careerHigh's (season, week)", () => {
  const ctx = setup();
  const svg = ctx.careerArcSvg(fakePlayer(), "all");
  const ringCount = (svg.match(/r="10"/g) || []).length;
  assert.strictEqual(ringCount, 1, "exactly one halo ring, marking only the career high (not a career-low too)");
});

test("careerArcSvg: handles a player with no weekly data without throwing", () => {
  const ctx = setup();
  assert.doesNotThrow(() => ctx.careerArcSvg(fakePlayer({ weekly: [] }), "all"));
});

test("careerArcSvg: the first and last owner bands never extend past the chart's plot area, so their labels don't get clipped off the SVG canvas", () => {
  const ctx = setup();
  const svg = ctx.careerArcSvg(fakePlayer(), "all");
  const rectXs = [...svg.matchAll(/<rect x="(-?[\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(rectXs.length > 0, "should have found band rects");
  assert.ok(
    rectXs.every((x) => x >= 44),
    `no band should start left of the plot area's left edge (padL=44) — found: ${rectXs}`
  );
});
