const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "records.js"]);
}

// A minimal-but-complete fake `stats` object, matching the shape
// DeepHistory.computeStats() actually returns (records + top5Records +
// managers) — just enough for buildRecordCards() to run start to finish
// against the REAL function, rather than a re-implementation of its logic.
function fakeStats(overrides) {
  const highestWeekScoreTop5 = [
    { points: 180.4, teamName: "evangonnerman", username: "evangonnerman", season: 2024, week: 9 },
    { points: 175.2, teamName: "yulovesyou", username: "yulovesyou", season: 2023, week: 4 },
    { points: 170.1, teamName: "hmart92", username: "hmart92", season: 2022, week: 11 },
    { points: 168.8, teamName: "tduchow", username: "tduchow", season: 2021, week: 2 },
    { points: 165.0, teamName: "sofarrsogood", username: "sofarrsogood", season: 2024, week: 6 },
  ];
  return {
    records: {
      highestWeekScore: highestWeekScoreTop5[0],
      lowestWeekScore: null,
      biggestBlowout: null,
      closestGame: null,
      longestWinStreak: null,
      longestLoseStreak: null,
      bestValuePick: null,
      worstValuePick: null,
      mostTrades: null,
      mostWaiverAdds: null,
      mostBenchPointsLeft: null,
      mostConsistentSeason: null,
      leastConsistentSeason: null,
      toughestSchedule: null,
      easiestSchedule: null,
    },
    top5Records: {
      highestWeekScore: highestWeekScoreTop5,
    },
    managers: [
      { teamName: "evangonnerman", championships: 3, careerWins: 60, careerLosses: 30, careerTies: 0, careerPF: 9200.5, careerBenchPointsLeft: 400.2 },
      { teamName: "yulovesyou", championships: 1, careerWins: 55, careerLosses: 35, careerTies: 0, careerPF: 8900.2, careerBenchPointsLeft: 380.1 },
      { teamName: "hmart92", championships: 0, careerWins: 30, careerLosses: 60, careerTies: 0, careerPF: 7100.0, careerBenchPointsLeft: 0 },
    ],
    ...overrides,
  };
}

test("buildRecordCards: a category with a top5Records list renders as an expandable <details> card, not a plain non-interactive card", () => {
  const ctx = setup();
  const html = ctx.buildRecordCards(fakeStats());
  assert.match(html, /<details class="record-card record-card-expandable top5">[\s\S]*?Highest Single-Week Score/, "should wrap in <details> when 5 entries are available");
});

test("buildRecordCards: the expandable card's collapsed view still shows the single #1 record, unchanged from before", () => {
  const ctx = setup();
  const html = ctx.buildRecordCards(fakeStats());
  assert.match(html, /Highest Single-Week Score/);
  assert.match(html, />180\.4</, "the #1 value should still show in the summary");
  assert.match(html, /evangonnerman · 2024 Wk 9/, "the #1 detail line should still show in the summary");
});

test("buildRecordCards: the expanded Top 5 table lists all 5 entries in rank order with their own detail and value", () => {
  const ctx = setup();
  const html = ctx.buildRecordCards(fakeStats());
  const table = html.match(/<div class="record-top5">[\s\S]*?<\/table>/)[0];
  ["evangonnerman", "yulovesyou", "hmart92", "tduchow", "sofarrsogood"].forEach((name) => {
    assert.ok(table.includes(name), `Top 5 table should include ${name}`);
  });
  assert.ok(table.includes("2024 Wk 9"), "should show the detail (season/week) for each row");
  assert.ok(table.includes("175.2 pts"), "should show the value for each row");
});

test("buildRecordCards: a category with only a #1 (no top5Records entry, or fewer than 2) falls back to a plain, non-expandable card", () => {
  const ctx = setup();
  const stats = fakeStats();
  stats.records.lowestWeekScore = { points: 45.2, teamName: "jerbear3", season: 2019, week: 3 };
  // no top5Records.lowestWeekScore entry at all -> nothing to expand
  const html = ctx.buildRecordCards(stats);
  const cardMatch = html.match(/<div class="record-card">\s*<p class="record-label">Lowest Single-Week Score/);
  assert.ok(cardMatch, "should render as a plain (non-<details>) card");
});

test("buildRecordCards: a top5Records entry with fewer than 2 items also falls back to a plain card (nothing meaningful to expand)", () => {
  const ctx = setup();
  const stats = fakeStats();
  stats.records.lowestWeekScore = { points: 45.2, teamName: "jerbear3", season: 2019, week: 3 };
  stats.top5Records.lowestWeekScore = [stats.records.lowestWeekScore]; // only 1 entry
  const html = ctx.buildRecordCards(stats);
  const cardMatch = html.match(/<div class="record-card">\s*<p class="record-label">Lowest Single-Week Score/);
  assert.ok(cardMatch, "a single-entry top5 list shouldn't produce an expandable card — should render as a plain card instead");
});

test("buildRecordCards: the manager-level cards (Most Championships, Best Win %, Most Career Points, Career Bench Waste) are also expandable with their own Top 5", () => {
  const ctx = setup();
  const html = ctx.buildRecordCards(fakeStats());

  assert.match(html, /Most Championships[\s\S]*?record-top5/);
  const champsTable = html.match(/Most Championships[\s\S]*?<\/table>/)[0];
  assert.ok(champsTable.includes("evangonnerman"));
  assert.ok(champsTable.includes("yulovesyou"));
  assert.ok(!champsTable.includes("hmart92"), "hmart92 has 0 championships and should be excluded from the Most Championships top 5");

  assert.match(html, /Most Career Points[\s\S]*?record-top5/);
  const pointsTable = html.match(/Most Career Points[\s\S]*?<\/table>/)[0];
  assert.ok(pointsTable.includes("9200.5"));
});

test("buildRecordCards: Career Bench Waste is omitted entirely when nobody has any bench waste on record", () => {
  const ctx = setup();
  const stats = fakeStats();
  stats.managers.forEach((m) => { m.careerBenchPointsLeft = 0; });
  const html = ctx.buildRecordCards(stats);
  assert.ok(!html.includes("Career Bench Waste"));
});

test("buildRecordCards: Closest Game reports its top5 rows to hundredths, matching the Season page's Closest Matchups precision change", () => {
  const ctx = setup();
  const stats = fakeStats();
  const closeGames = [
    { winner: "evangonnerman", loser: "yulovesyou", margin: 0.03, season: 2024, week: 8 },
    { winner: "hmart92", loser: "tduchow", margin: 0.15, season: 2023, week: 5 },
  ];
  stats.records.closestGame = closeGames[0];
  stats.top5Records.closestGame = closeGames;
  const html = ctx.buildRecordCards(stats);
  assert.ok(html.includes("0.03 pts"), "the top5 table row should show hundredths precision");
});

test("buildRecordCards: doesn't throw when top5Records is entirely missing (e.g. an older cached stats shape)", () => {
  const ctx = setup();
  const stats = fakeStats({ top5Records: undefined });
  assert.doesNotThrow(() => ctx.buildRecordCards(stats));
});
