const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "history-data.js", "season-data.js", "season.js"]);
}

// A minimal-but-complete fake single-season summary, matching the shape
// DeepHistory.computeSeasonSummary() actually returns — just enough for
// renderSummary() to run start to finish without throwing, so this test
// exercises the REAL render function rather than a re-implementation of
// its logic.
function fakeSummary(overrides) {
  return {
    season: 2024,
    status: "complete",
    standings: [
      { rosterId: 1, teamName: "Team Gold", wins: 11, losses: 2, ties: 0, fpts: 1500, fptsAgainst: 1300, overallWins: 12, overallLosses: 1, overallTies: 0, luckPct: 2.1, avgOpponentPF: 1200 },
      { rosterId: 2, teamName: "Team Silver", wins: 9, losses: 4, ties: 0, fpts: 1400, fptsAgainst: 1350, overallWins: 10, overallLosses: 3, overallTies: 0, luckPct: -1.4, avgOpponentPF: 1210 },
      { rosterId: 3, teamName: "Team Bronze", wins: 8, losses: 5, ties: 0, fpts: 1350, fptsAgainst: 1360, overallWins: 8, overallLosses: 5, overallTies: 0, luckPct: 0.5, avgOpponentPF: 1190 },
      { rosterId: 4, teamName: "Team Fourth", wins: 6, losses: 7, ties: 0, fpts: 1250, fptsAgainst: 1300, overallWins: 6, overallLosses: 7, overallTies: 0, luckPct: -0.2, avgOpponentPF: 1180 },
    ],
    championRosterId: 1,
    runnerUpRosterId: 2,
    thirdPlaceRosterId: 3,
    weeksPlayed: 14,
    weeklyLeagueAvg: [],
    teamAverages: [],
    positionTable: { columns: [], rows: [] },
    highestWeekScore: null,
    lowestWeekScore: null,
    top5Closest: [],
    top5Blowouts: [],
    bestByPosition: {},
    bestValuePick: null,
    worstValuePick: null,
    pointsLeader: null,
    top5FaabPickups: [],
    top5WaiverValueAdds: [],
    standingsHistory: [],
    playoffTeams: 4,
    championshipRecap: null,
    bracket: null,
    injuryLuck: null,
    ...overrides,
  };
}

test("renderSummary: the champion, runner-up and 3rd place carry their finish in the standings, same as the ESPN-era seasons", () => {
  const ctx = setup();
  const html = ctx.renderSummary(fakeSummary());
  assert.match(html, /Team Gold<\/span><span class="sn-finish sn-finish-champion">Champion</);
  assert.match(html, /Team Silver<\/span><span class="sn-finish sn-finish-runnerup">Runner-up</);
  assert.match(html, /Team Bronze<\/span><span class="sn-finish sn-finish-third">3rd place</);
  assert.ok(!/Team Fourth<\/span><span class="sn-finish/.test(html), "a team that didn't finish top 3 gets no badge here");
});

test("renderSummary: the All-Time view counts career titles instead of a single-season finish", () => {
  const ctx = setup();
  const html = ctx.renderSummary(
    fakeSummary({
      season: "All-Time",
      championRosterId: null,
      runnerUpRosterId: null,
      thirdPlaceRosterId: null,
      standings: [{ rosterId: 1, teamName: "Team Gold", wins: 11, losses: 2, ties: 0, fpts: 1500, fptsAgainst: 1300, overallWins: 12, overallLosses: 1, overallTies: 0, luckPct: 2.1, championships: 2 }],
      top5Luckiest: [],
      top5Unluckiest: [],
    })
  );
  assert.match(html, /<span class="sn-titles" title="2 titles">🏆🏆<\/span>/, "All-Time view repeats the trophy per career championship");
  assert.ok(!html.includes("sn-finish"), "no single-season finish on the All-Time table");
  assert.ok(!html.includes(">Schedule<"), "no schedule across many seasons");
});

test("renderSummary: there is no Last 5 column", () => {
  const html = setup().renderSummary(fakeSummary());
  assert.ok(!/Last 5/.test(html));
});

test("renderSummary: the standings table keeps luck in percent and draws the playoff line after the last playoff team", () => {
  const ctx = setup();
  const html = ctx.renderSummary(fakeSummary({ playoffTeams: 2 }));
  assert.ok(html.includes(">+2.1%<") && html.includes(">-1.4%<"), "luck is the site's percent");
  const rows = [...html.matchAll(/<tr class="(sn-st-row[^"]*)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(rows.map((r) => r.includes("sn-cut")), [false, true, false, false], "the dashed line sits under the 2nd team");
  assert.deepStrictEqual(rows.map((r) => r.includes("sn-in")), [true, true, false, false]);
});

test("renderSummary: Closest Matchups reports the margin to hundredths (2 decimals), not tenths", () => {
  const ctx = setup();
  const closeMatch = {
    winner: "evangonnerman",
    loser: "yulovesyou",
    winnerPts: 120.37,
    loserPts: 120.34,
    margin: 0.03,
    week: 8,
    season: 2024,
    winnerLineup: [],
    loserLineup: [],
  };
  const html = ctx.renderSummary(fakeSummary({ top5Closest: [closeMatch] }));
  assert.ok(html.includes("0.03 pt"), "a 0.03-point margin should be visible at 2 decimals, not rounded away to 0.0");
  assert.ok(!html.includes("0.0 pt"), "should not show the old 1-decimal rounding");
});

test("renderSummary: Closest Matchups hundredths precision applies the same way on the All-Time (Total) view, since it's the same rendering path", () => {
  const ctx = setup();
  const closeMatch = {
    winner: "evangonnerman",
    loser: "yulovesyou",
    winnerPts: 120.37,
    loserPts: 120.34,
    margin: 0.03,
    week: 8,
    season: 2021,
    winnerLineup: [],
    loserLineup: [],
  };
  const html = ctx.renderSummary(
    fakeSummary({
      season: "All-Time",
      championRosterId: null,
      runnerUpRosterId: null,
      thirdPlaceRosterId: null,
      top5Closest: [closeMatch],
      top5Luckiest: [],
      top5Unluckiest: [],
    })
  );
  assert.ok(html.includes("0.03 pt"), "the Total view's Closest Matchups list should also show hundredths precision");
});

test("renderSummary: Blowouts (a different list) is NOT affected — it still reports margin to tenths, since only Closest Matchups was asked for more precision", () => {
  const ctx = setup();
  const blowout = {
    winner: "evangonnerman",
    loser: "yulovesyou",
    winnerPts: 180.456,
    loserPts: 90.123,
    margin: 90.333,
    week: 3,
    season: 2024,
    winnerLineup: [],
    loserLineup: [],
  };
  const html = ctx.renderSummary(fakeSummary({ top5Blowouts: [blowout] }));
  assert.ok(html.includes("90.3 pt"), "Blowouts should stay at 1-decimal precision");
  assert.ok(!html.includes("90.33 pt"), "Blowouts should NOT have picked up the 2-decimal Closest Matchups change");
});
