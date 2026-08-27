const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "season.js"]);
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

test("renderSummary: shows gold/silver/bronze medals next to champion/runner-up/3rd place, same as the manual (ESPN-era) seasons", () => {
  const ctx = setup();
  const html = ctx.renderSummary(fakeSummary());

  assert.match(html, /Team Gold 🏆/, "champion should get the trophy emoji");
  assert.match(html, /Team Silver 🥈/, "runner-up should get the silver medal emoji");
  assert.match(html, /Team Bronze 🥉/, "third place should get the bronze medal emoji");
  assert.ok(!/Team Fourth[^<]*(🏆|🥈|🥉)/.test(html), "a team that didn't finish top 3 should get no medal");
});

test("renderSummary: the All-Time view doesn't attach a single-season medal (it has its own repeated-trophy convention for career championships instead)", () => {
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

  assert.match(html, /Team Gold 🏆🏆/, "All-Time view should still repeat the trophy per career championship");
  assert.ok(!html.includes("🥈") && !html.includes("🥉"), "All-Time view shouldn't show single-season runner-up/3rd-place medals");
});
