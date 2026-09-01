const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "animations.js", "manual-history.js", "teams.js"]);
}

function fakeManager(overrides) {
  return {
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
    championships: 1,
    winningSeasons: 3,
    losingSeasons: 1,
    mostRostered: [],
    headToHead: [],
    headToHeadPlayoffs: [],
    seasons: [
      {
        season: 2023,
        rank: 1,
        wins: 11,
        losses: 2,
        ties: 0,
        fpts: 1489.9,
        fptsAgainst: 1341.6,
        overallWins: 78,
        overallLosses: 39,
        overallTies: 0,
        luckPct: 17.9,
        isChampion: true,
        isRunnerUp: false,
        isThirdPlace: false,
        draftPicks: [],
        startingLineup: { weeksCounted: 14, slots: [] },
      },
    ],
    ...overrides,
  };
}

function heatCells(html) {
  return [...html.matchAll(/<td class="heat-cell"[^>]*style="background:(rgba\([^)]+\))"[^>]*>([^<]*)</g)].map((m) => ({ color: m[1], text: m[2] }));
}

test("renderManagerDetail: Head-to-Head Records' Win % column is colored with a heatmap, best matchup green-ish and worst red-ish", () => {
  const ctx = setup();
  const manager = fakeManager({
    headToHead: [
      { opponentName: "yulovesyou", wins: 8, losses: 2, ties: 0 }, // 80%, best
      { opponentName: "hmart92", wins: 2, losses: 8, ties: 0 }, // 20%, worst
    ],
  });
  const html = ctx.renderManagerDetail(manager);
  const h2hSection = html.slice(html.indexOf("Head-to-Head Records"), html.indexOf("Playoff Head-to-Head"));
  const cells = heatCells(h2hSection);
  assert.strictEqual(cells.length, 2);
  const best = cells.find((c) => c.text === "80%");
  const worst = cells.find((c) => c.text === "20%");
  assert.ok(best && worst, "both win% cells should be heat-colored");
  const [br, bg] = best.color.match(/[\d.]+/g).map(Number);
  const [wr, wg] = worst.color.match(/[\d.]+/g).map(Number);
  assert.ok(bg > br, "the 80% (best) cell should be green-dominant");
  assert.ok(wr > wg, "the 20% (worst) cell should be red-dominant");
});

test("renderManagerDetail: Playoff Head-to-Head's Win % column is independently colored from the regular Head-to-Head table", () => {
  const ctx = setup();
  const manager = fakeManager({
    headToHead: [{ opponentName: "yulovesyou", wins: 5, losses: 5, ties: 0 }],
    headToHeadPlayoffs: [{ opponentName: "hmart92", wins: 3, losses: 0, ties: 0 }],
  });
  const html = ctx.renderManagerDetail(manager);
  const playoffSection = html.slice(html.indexOf("Playoff Head-to-Head"), html.indexOf("Season By Season"));
  const cells = heatCells(playoffSection);
  assert.strictEqual(cells.length, 1);
  assert.strictEqual(cells[0].text, "100%");
});

test("renderManagerDetail: an empty Head-to-Head list shows the empty state, not a heatmap table with no rows", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager({ headToHead: [] }));
  const h2hSection = html.slice(html.indexOf("Head-to-Head Records"), html.indexOf("Playoff Head-to-Head"));
  assert.ok(h2hSection.includes("No matchups recorded yet."));
  assert.strictEqual(heatCells(h2hSection).length, 0);
});

test("renderManagerDetail: Season By Season's Rank column is colored with an INVERTED heatmap -- rank 1 (best) is green, the worst rank is red", () => {
  const ctx = setup();
  const manager = fakeManager({
    seasons: [
      {
        season: 2023,
        rank: 1,
        wins: 11,
        losses: 2,
        ties: 0,
        fpts: 1489.9,
        fptsAgainst: 1341.6,
        overallWins: 78,
        overallLosses: 39,
        overallTies: 0,
        luckPct: 17.9,
        isChampion: true,
        isRunnerUp: false,
        isThirdPlace: false,
        draftPicks: [],
        startingLineup: { weeksCounted: 14, slots: [] },
      },
      {
        season: 2022,
        rank: 10,
        wins: 3,
        losses: 10,
        ties: 0,
        fpts: 1100.0,
        fptsAgainst: 1300.0,
        overallWins: 30,
        overallLosses: 87,
        overallTies: 0,
        luckPct: -5.0,
        isChampion: false,
        isRunnerUp: false,
        isThirdPlace: false,
        draftPicks: [],
        startingLineup: { weeksCounted: 13, slots: [] },
      },
    ],
  });
  const html = ctx.renderManagerDetail(manager);
  const seasonSection = html.slice(html.indexOf("Season By Season"), html.indexOf("Draft Picks"));
  const cells = [...seasonSection.matchAll(/<td class="heat-cell" data-label="Rank" style="background:(rgba\([^)]+\))">(\d+)</g)].map((m) => ({ color: m[1], rank: m[2] }));
  assert.strictEqual(cells.length, 2);
  const rank1 = cells.find((c) => c.rank === "1");
  const rank10 = cells.find((c) => c.rank === "10");
  const [r1r, r1g] = rank1.color.match(/[\d.]+/g).map(Number);
  const [r10r, r10g] = rank10.color.match(/[\d.]+/g).map(Number);
  assert.ok(r1g > r1r, "rank 1 (best) should be green-dominant");
  assert.ok(r10r > r10g, "rank 10 (worst) should be red-dominant");
});

test("renderManagerDetail: heat-cell colors use rgba with a muted alpha, matching the site-wide 'see-through' heatmap style", () => {
  const ctx = setup();
  const manager = fakeManager({ headToHead: [{ opponentName: "yulovesyou", wins: 5, losses: 5, ties: 0 }] });
  const html = ctx.renderManagerDetail(manager);
  const cells = heatCells(html);
  assert.ok(cells.length > 0);
  cells.forEach((c) => assert.match(c.color, /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/));
});
