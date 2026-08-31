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
        draftPicks: [
          { round: 1, pickInRound: 5, player: "Derek Holloway", position: "RB", points: 210.4, vbd: 12.3, grade: "A" },
          { round: 2, pickInRound: 5, player: "Marcus Fielding", position: "WR", points: 150.1, vbd: null, grade: null },
        ],
        startingLineup: {
          weeksCounted: 14,
          slots: [
            { slot: "QB", player: "Alex Turner", acquisition: "Draft", starts: 14 },
            { slot: "RB", player: null, acquisition: null, starts: 0 },
          ],
        },
      },
    ],
    ...overrides,
  };
}

test("renderManagerDetail: Starting Lineup and Draft Picks render as two separate <table> elements, not the old shared flex-row list", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());

  const tableCount = (html.match(/<table class="stat-table compact-mobile">/g) || []).length;
  assert.ok(tableCount >= 2, "should render at least 2 real <table> elements (lineup + draft picks)");
  assert.ok(!html.includes('class="draft-pick-row"'), "should no longer use the old generic flex-row list markup");
});

test("renderManagerDetail: the Starting Lineup table has its own column headers (Slot / Player / Starts), distinct from the Draft Picks table's", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());

  const lineupSection = html.slice(html.indexOf("Starting lineup"), html.indexOf("Draft picks"));
  assert.match(lineupSection, /<th>Slot<\/th><th>Player<\/th><th>Starts<\/th>/);
  assert.ok(lineupSection.includes("Alex Turner"));
  assert.ok(lineupSection.includes("14 gms"));
  assert.ok(lineupSection.includes("Draft"), "acquisition tag should still show");
  assert.ok(lineupSection.includes(">—<"), "an empty roster slot should show an em dash for both player and starts");
});

test("renderManagerDetail: the Draft Picks table has its own column headers (Pick / Player / Points / Grade), distinct from the lineup table's", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());

  const picksSection = html.slice(html.indexOf("Draft picks"));
  assert.match(picksSection, /<th>Pick<\/th><th>Player<\/th><th>Points<\/th><th>Grade<\/th>/);
  assert.ok(picksSection.includes("1.5"), "pick 1.5 (round.pickInRound) should show");
  assert.ok(picksSection.includes("Derek Holloway"));
  assert.ok(picksSection.includes("210.4 pts"));
  assert.ok(picksSection.includes("+12.3 VBD"));
});

test("renderManagerDetail: a draft pick with no grade doesn't render a broken/empty grade badge or crash", () => {
  const ctx = setup();
  assert.doesNotThrow(() => ctx.renderManagerDetail(fakeManager()));
  const html = ctx.renderManagerDetail(fakeManager());
  // Marcus Fielding's row has grade: null -- should just have an empty Grade cell, not a stray "null" string.
  assert.ok(!html.includes(">null<"));
});

test("renderManagerDetail: empty draft/lineup data for a season still shows the informative empty state, not a blank table", () => {
  const ctx = setup();
  const manager = fakeManager();
  manager.seasons[0].draftPicks = [];
  manager.seasons[0].startingLineup = null;
  const html = ctx.renderManagerDetail(manager);
  assert.ok(html.includes("No draft data for this season."));
  assert.ok(html.includes("No lineup data for this season."));
});
