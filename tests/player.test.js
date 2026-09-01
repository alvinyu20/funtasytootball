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
      { ownerId: "u1", ownerName: "yulovesyou", startSeason: "2021", startWeek: 1, endSeason: "2021", endWeek: 3, gamesOwned: 3, gamesStarted: 2, gamesPlayed: 3, totalPoints: 36, ppg: 12 },
      { ownerId: "u2", ownerName: "hmart92", startSeason: "2021", startWeek: 5, endSeason: "2022", endWeek: 2, gamesOwned: 4, gamesStarted: 4, gamesPlayed: 4, totalPoints: 51, ppg: 12.8 },
      { ownerId: "u1", ownerName: "yulovesyou", startSeason: "2022", startWeek: 3, endSeason: "2022", endWeek: 3, gamesOwned: 1, gamesStarted: 1, gamesPlayed: 1, totalPoints: 30, ppg: 30 },
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

test("searchPlayers: a name that starts with the query outranks a heavily-rostered name that only contains it mid-word", () => {
  const ctx = setup();
  ctx.__FAKE_INDEX__ = {
    p1: { name: "Travis Kelce", position: "TE", totals: { gamesOwned: 90 } }, // "c" only appears mid-word, in "Kelce"
    p2: { name: "Christian McCaffrey", position: "RB", totals: { gamesOwned: 10 } }, // first name genuinely starts with "c"
  };
  runInLoadedContext(ctx, "PLAYER_INDEX = __FAKE_INDEX__;");
  const results = ctx.searchPlayers("c");
  assert.strictEqual(results[0][0], "p2", "Christian McCaffrey should rank first for query 'c' even though Travis Kelce is far more rostered");
});

test("searchPlayers: a last name starting with the query ranks above a name that only contains it mid-word, even without matching at the very start of the full name", () => {
  const ctx = setup();
  ctx.__FAKE_INDEX__ = {
    p1: { name: "Travis Kelce", position: "TE", totals: { gamesOwned: 90 } }, // mid-word match only
    p2: { name: "Amari Cooper", position: "WR", totals: { gamesOwned: 5 } }, // last name starts with "c", first name doesn't
  };
  runInLoadedContext(ctx, "PLAYER_INDEX = __FAKE_INDEX__;");
  const results = ctx.searchPlayers("c");
  assert.strictEqual(results[0][0], "p2", "Amari Cooper's last name starts with 'c', which should outrank a mid-word-only match");
});

test("searchPlayers: within the same match quality, the more-rostered player still wins the tiebreaker", () => {
  const ctx = setup();
  ctx.__FAKE_INDEX__ = {
    p1: { name: "Christian McCaffrey", position: "RB", totals: { gamesOwned: 10 } },
    p2: { name: "CeeDee Lamb", position: "WR", totals: { gamesOwned: 80 } },
  };
  runInLoadedContext(ctx, "PLAYER_INDEX = __FAKE_INDEX__;");
  const results = ctx.searchPlayers("c");
  assert.strictEqual(results[0][0], "p2", "both start with 'c' (same tier) -- the more-rostered player (CeeDee Lamb) should win the tiebreak");
});

test("searchPlayers: a name that doesn't match anywhere at all is excluded, not just ranked last", () => {
  const ctx = setup();
  ctx.__FAKE_INDEX__ = {
    p1: { name: "Josh Allen", position: "QB", totals: { gamesOwned: 40 } },
    p2: { name: "Derrick Henry", position: "RB", totals: { gamesOwned: 30 } },
  };
  runInLoadedContext(ctx, "PLAYER_INDEX = __FAKE_INDEX__;");
  const results = ctx.searchPlayers("zzz");
  assert.strictEqual(results.length, 0);
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
  assert.ok(html.includes("7 / 1 / 0"), "started/benched/FA stat card, FA defaulting to 0 when the fixture has no gamesFA");
  assert.ok(html.includes("Career high"));
  assert.ok(html.includes("30.0"), "career-high value");
  assert.ok(html.includes("owned by yulovesyou"), "career-high owner attribution");

  const yuloCount = (html.match(/yulovesyou/g) || []).length;
  assert.ok(yuloCount >= 2, "yulovesyou should appear in at least 2 separate table rows (their two non-contiguous spans)");
});

test("renderPlayerDetail: the started/benched/FA stat card shows a non-zero FA count when the player has free-agent weeks on record", () => {
  const ctx = setup();
  const player = fakePlayer({ totals: { owners: 2, gamesOwned: 8, gamesStarted: 7, gamesBenched: 1, gamesFA: 5, totalPoints: 117, ppg: 14.6 } });
  const html = ctx.renderPlayerDetail("9999", player);
  assert.ok(html.includes("7 / 1 / 5"), "started/benched/FA stat card should reflect a real FA count, not just default to 0");
});

test("renderPlayerDetail: omits the career-high callout box gracefully when there's no career high on record", () => {
  const ctx = setup();
  const html = ctx.renderPlayerDetail("9999", fakePlayer({ careerHigh: null }));
  assert.ok(!html.includes("player-high-callout"), "the callout box itself should be omitted (the chart legend's unrelated 'Career high' label is expected to still appear)");
});

test("cumulativeOwnershipRows: the same owner's non-contiguous spans combine into a single aggregated row", () => {
  const ctx = setup();
  const rows = ctx.cumulativeOwnershipRows(fakePlayer().spans);
  assert.strictEqual(rows.length, 2, "yulovesyou's two spans should collapse into one row, alongside hmart92's one row -- 2 total");
  const yulo = rows.find((r) => r.ownerName === "yulovesyou");
  assert.strictEqual(yulo.gamesOwned, 4, "3 + 1 games owned across both spans");
  assert.strictEqual(yulo.gamesStarted, 3, "2 + 1 games started across both spans");
  assert.strictEqual(yulo.totalPoints, 66, "36 + 30 points across both spans");
});

test("cumulativeOwnershipRows: PPG is re-derived from combined totals, not averaged from each span's own PPG", () => {
  const ctx = setup();
  const rows = ctx.cumulativeOwnershipRows(fakePlayer().spans);
  const yulo = rows.find((r) => r.ownerName === "yulovesyou");
  // 66 total points / (3+1) games played = 16.5 -- NOT (12 + 30) / 2 = 21,
  // which is what naively averaging the two spans' own ppg values would give.
  assert.strictEqual(yulo.ppg, 16.5);
});

test("cumulativeOwnershipRows: sorted by games owned, most first", () => {
  const ctx = setup();
  const rows = ctx.cumulativeOwnershipRows(fakePlayer().spans);
  assert.strictEqual(rows[0].ownerName, "yulovesyou", "yulovesyou has 4 combined games owned vs hmart92's 4 -- tie broken by Map insertion order, but the sort itself should be descending by gamesOwned");
  assert.ok(rows[0].gamesOwned >= rows[1].gamesOwned);
});

test("cumulativeOwnershipRows: a single-span owner (no repeats) still aggregates correctly as a trivial one-span sum", () => {
  const ctx = setup();
  const rows = ctx.cumulativeOwnershipRows(fakePlayer().spans);
  const hmart = rows.find((r) => r.ownerName === "hmart92");
  assert.strictEqual(hmart.gamesOwned, 4);
  assert.strictEqual(hmart.ppg, 12.75, "51 points / 4 games played = 12.75");
});

test("renderOwnershipHistory: both By Span and Cumulative tab panels are present, with the same-owner-twice case visible in the By Span view and collapsed in Cumulative", () => {
  const ctx = setup();
  const html = ctx.renderOwnershipHistory(fakePlayer());
  assert.ok(html.includes('data-chart-panel="by-span"'));
  assert.ok(html.includes('data-chart-panel="cumulative"'));

  const bySpanSection = html.slice(html.indexOf('data-chart-panel="by-span"'), html.indexOf('data-chart-panel="cumulative"'));
  const yuloCountBySpan = (bySpanSection.match(/yulovesyou/g) || []).length;
  assert.strictEqual(yuloCountBySpan, 2, "By Span should still show yulovesyou's two separate spans as two rows");

  const cumulativeSection = html.slice(html.indexOf('data-chart-panel="cumulative"'));
  const yuloCountCumulative = (cumulativeSection.match(/yulovesyou/g) || []).length;
  assert.strictEqual(yuloCountCumulative, 1, "Cumulative should show yulovesyou once, combined");
});

test("renderOwnershipHistory: the Cumulative table has no Span column, since it's combining across spans", () => {
  const ctx = setup();
  const html = ctx.renderOwnershipHistory(fakePlayer());
  const cumulativeSection = html.slice(html.indexOf('data-chart-panel="cumulative"'));
  assert.ok(!/<th>Span<\/th>/.test(cumulativeSection.split("</thead>")[0]));
});

test("renderCareerArc: Owned, All, and Starts tab panels are all present, with the correct game counts in each tab label", () => {
  const ctx = setup();
  const html = ctx.renderCareerArc(fakePlayer());
  assert.ok(html.includes("Owned (8)"), "the Owned tab should show the games-owned count");
  assert.ok(html.includes("All (8)"), "with no FA weeks on this fixture, All should equal Owned (8 + 0)");
  assert.ok(html.includes("Starts (7)"), "the Starts tab should show the games-started count");
  assert.ok(html.includes('data-chart-panel="owned"'));
  assert.ok(html.includes('data-chart-panel="all"'));
  assert.ok(html.includes('data-chart-panel="starts"'));
});

test("renderCareerArc: the All tab is active by default, not Owned", () => {
  const ctx = setup();
  const html = ctx.renderCareerArc(fakePlayer());
  assert.ok(html.includes('class="chart-tab active" data-chart-tab="all"'), "the All button should carry the active class");
  assert.ok(html.includes('class="chart-tab" data-chart-tab="owned"'), "the Owned button should NOT be active");
  const allPanel = html.slice(html.indexOf('data-chart-panel="all"'));
  assert.ok(!allPanel.slice(0, 40).includes("display:none"), "the All panel should be visible by default");
  const ownedPanel = html.slice(html.indexOf('data-chart-panel="owned"'), html.indexOf('data-chart-panel="all"'));
  assert.ok(ownedPanel.includes("display:none"), "the Owned panel should be hidden by default");
});

function fakePlayerWithFA() {
  const player = fakePlayer();
  // Insert two free-agent weeks into the existing owned timeline: one
  // mid-career (between the 2021 and 2022 stretches) and one at the
  // very end, both marked owned:0 and with no span covering them.
  player.weekly = [
    { season: "2021", week: 1, points: 10, started: 1, owned: 1 },
    { season: "2021", week: 2, points: 5, started: 0, owned: 1 },
    { season: "2021", week: 3, points: 12, started: 1, owned: 1 },
    { season: "2021", week: 4, points: 18, started: 0, owned: 0 }, // FA week
    { season: "2021", week: 5, points: 20, started: 1, owned: 1 },
    { season: "2021", week: 6, points: 8, started: 1, owned: 1 },
    { season: "2022", week: 1, points: 14, started: 1, owned: 1 },
    { season: "2022", week: 2, points: 9, started: 1, owned: 1 },
    { season: "2022", week: 3, points: 30, started: 1, owned: 1 },
    { season: "2022", week: 4, points: 22, started: 0, owned: 0 }, // FA week
  ];
  player.totals = { ...player.totals, gamesFA: 2 };
  return player;
}

test("renderCareerArc: the All tab's count includes both owned and free-agent games", () => {
  const ctx = setup();
  const html = ctx.renderCareerArc(fakePlayerWithFA());
  assert.ok(html.includes("Owned (8)"), "8 owned weeks, unchanged");
  assert.ok(html.includes("All (10)"), "8 owned + 2 FA = 10");
});

test("careerArcSvg: 'owned' mode excludes free-agent weeks entirely", () => {
  const ctx = setup();
  const svg = ctx.careerArcSvg(fakePlayerWithFA(), "owned");
  const dotCount = (svg.match(/<circle/g) || []).length;
  const allSvg = ctx.careerArcSvg(fakePlayerWithFA(), "all");
  const allDotCount = (allSvg.match(/<circle/g) || []).length;
  assert.ok(dotCount < allDotCount, "'owned' should plot fewer points than 'all', since it excludes the 2 FA weeks");
});

test("careerArcSvg: 'all' mode plots free-agent stretches with a neutral gray band, but no 'UNOWNED' text label", () => {
  const ctx = setup();
  const svg = ctx.careerArcSvg(fakePlayerWithFA(), "all");
  assert.ok(!svg.includes("UNOWNED"), "no text should be printed for an unowned stretch -- the legend already explains the gray band");
  assert.ok(svg.includes('fill="#5A5A52" opacity="0.12"'), "the neutral gray band itself should still render, just without a text label");
});

test("careerArcSvg: two consecutive narrow bands with long owner names get staggered onto different vertical positions", () => {
  const ctx = setup();
  // A 14-week filler span first, so the chart has enough total points
  // that individual 1-week bands are actually narrow -- with only 2-3
  // points total, the whole plot width goes into a single step and
  // nothing is ever cramped, regardless of label length.
  const fillerWeeks = Array.from({ length: 14 }, (_, i) => ({ season: "2020", week: i + 1, points: 10, started: 1, owned: 1 }));
  const player = {
    name: "Test Player",
    position: "RB",
    spans: [
      { ownerId: "u0", ownerName: "Filler", startSeason: "2020", startWeek: 1, endSeason: "2020", endWeek: 14, gamesOwned: 14, gamesStarted: 14, gamesPlayed: 14, totalPoints: 140, ppg: 10 },
      { ownerId: "u1", ownerName: "AVeryLongUsernameIndeed", startSeason: "2021", startWeek: 1, endSeason: "2021", endWeek: 1, gamesOwned: 1, gamesStarted: 1, gamesPlayed: 1, totalPoints: 10, ppg: 10 },
      { ownerId: "u2", ownerName: "AnotherVeryLongUsernameToo", startSeason: "2021", startWeek: 2, endSeason: "2021", endWeek: 2, gamesOwned: 1, gamesStarted: 1, gamesPlayed: 1, totalPoints: 12, ppg: 12 },
    ],
    careerHigh: null,
    totals: { owners: 3, gamesOwned: 16, gamesStarted: 16, gamesBenched: 0, gamesFA: 0, gamesPlayed: 16, totalPoints: 162, ppg: 10.1 },
    weekly: [...fillerWeeks, { season: "2021", week: 1, points: 10, started: 1, owned: 1 }, { season: "2021", week: 2, points: 12, started: 1, owned: 1 }],
  };
  const svg = ctx.careerArcSvg(player, "owned");
  const yValues = [...svg.matchAll(/<text x="[\d.]+" y="(\d+)" font-family="IBM Plex Mono, monospace" font-size="10" font-weight="600"/g)].map((m) => m[1]);
  assert.strictEqual(yValues.length, 3, "the filler band plus both single-week bands should each get a label");
  assert.notStrictEqual(yValues[1], yValues[2], "the two consecutive cramped labels should be staggered onto different Y positions, not overlap");
});

test("careerArcSvg: an older cached player with no `owned` field at all on its weekly entries is treated as fully owned, not silently emptied out", () => {
  const ctx = setup();
  const player = fakePlayer();
  player.weekly = player.weekly.map(({ owned, ...rest }) => rest); // strip the field entirely, simulating pre-FA-feature cached data
  const ownedSvg = ctx.careerArcSvg(player, "owned");
  const allSvg = ctx.careerArcSvg(player, "all");
  const ownedDotCount = (ownedSvg.match(/<circle/g) || []).length;
  const allDotCount = (allSvg.match(/<circle/g) || []).length;
  assert.strictEqual(ownedDotCount, allDotCount, "with no owned field anywhere, 'owned' and 'all' should show the exact same points");
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

test("pickRandomPlayerId: returns null when the index is empty", () => {
  const ctx = setup();
  assert.strictEqual(ctx.pickRandomPlayerId({}, ""), null);
  assert.strictEqual(ctx.pickRandomPlayerId(null, ""), null);
});

test("pickRandomPlayerId: returns the only id when there's exactly one player, even if it matches currentId", () => {
  const ctx = setup();
  assert.strictEqual(ctx.pickRandomPlayerId({ "4046": {} }, "4046"), "4046");
});

test("pickRandomPlayerId: with 2+ players, never returns the same id as currentId, across many trials", () => {
  const ctx = setup();
  const index = { p1: {}, p2: {} };
  for (let i = 0; i < 50; i++) {
    assert.strictEqual(ctx.pickRandomPlayerId(index, "p1"), "p2", "with only 2 players, landing on p1 again should be impossible");
  }
});

test("pickRandomPlayerId: with several players, only ever returns a valid id from the index", () => {
  const ctx = setup();
  const index = { p1: {}, p2: {}, p3: {}, p4: {} };
  for (let i = 0; i < 30; i++) {
    const picked = ctx.pickRandomPlayerId(index, "p1");
    assert.ok(["p2", "p3", "p4"].includes(picked));
  }
});

function heatCells(html) {
  return [...html.matchAll(/<td class="heat-cell" data-label="PPG" style="background:(rgba\([^)]+\))">([\d.]+)</g)].map((m) => ({ color: m[1], ppg: m[2] }));
}

test("renderOwnershipHistory: By Span's PPG column is heat-colored relative to this player's own spans, best span green-ish and worst red-ish", () => {
  const ctx = setup();
  const html = ctx.renderOwnershipHistory(fakePlayer());
  const bySpanSection = html.slice(html.indexOf('data-chart-panel="by-span"'), html.indexOf('data-chart-panel="cumulative"'));
  const cells = heatCells(bySpanSection);
  assert.strictEqual(cells.length, 3, "one per span");
  const best = cells.find((c) => c.ppg === "30.0"); // yulovesyou's 2nd stint, the max in this fixture
  const worst = cells.find((c) => c.ppg === "12.0"); // yulovesyou's 1st stint, the min
  assert.ok(best && worst);
  const [br, bg] = best.color.match(/[\d.]+/g).map(Number);
  const [wr, wg] = worst.color.match(/[\d.]+/g).map(Number);
  assert.ok(bg > br, "the highest-PPG span should be green-dominant");
  assert.ok(wr > wg, "the lowest-PPG span should be red-dominant");
});

test("renderOwnershipHistory: Cumulative's PPG column is heat-colored independently, scaled to the combined per-owner totals, not the raw per-span values", () => {
  const ctx = setup();
  const html = ctx.renderOwnershipHistory(fakePlayer());
  const cumulativeSection = html.slice(html.indexOf('data-chart-panel="cumulative"'));
  const cells = heatCells(cumulativeSection);
  assert.strictEqual(cells.length, 2, "one per distinct owner");
  // yulovesyou combined: (36+30)/(3+1) = 16.5 -- the max here.
  // hmart92: 51/4 = 12.75 -- the min here.
  const yulo = cells.find((c) => c.ppg === "16.5");
  assert.ok(yulo, "yulovesyou's combined 16.5 PPG should be present");
  const [yr, yg] = yulo.color.match(/[\d.]+/g).map(Number);
  assert.ok(yg > yr, "yulovesyou (the higher combined PPG) should be green-dominant");
});

test("renderOwnershipHistory: heat-cell colors on both PPG columns use a muted rgba alpha, matching the see-through heatmap style everywhere else", () => {
  const ctx = setup();
  const html = ctx.renderOwnershipHistory(fakePlayer());
  const cells = heatCells(html);
  assert.ok(cells.length >= 5, "3 by-span + 2 cumulative rows");
  cells.forEach((c) => assert.match(c.color, /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/));
});
