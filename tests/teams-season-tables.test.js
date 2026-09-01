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
      {
        season: 2022,
        rank: 4,
        wins: 6,
        losses: 7,
        ties: 0,
        fpts: 1300.0,
        fptsAgainst: 1320.0,
        overallWins: 60,
        overallLosses: 57,
        overallTies: 0,
        luckPct: -2.1,
        isChampion: false,
        isRunnerUp: false,
        isThirdPlace: false,
        draftPicks: [{ round: 1, pickInRound: 2, player: "Someone Else", position: "QB", points: 180.0, vbd: 5.0, grade: "B" }],
        startingLineup: { weeksCounted: 13, slots: [{ slot: "QB", player: "Someone Else", acquisition: "Draft", starts: 13 }] },
      },
    ],
    ...overrides,
  };
}

function section(html, label) {
  // Pulls out everything between one yard-divider label and the next,
  // so a test can check that a given piece of content lives in the
  // RIGHT standalone section rather than just appearing somewhere on
  // the page.
  const start = html.indexOf(`<span class="label">${label}</span>`);
  if (start === -1) return null;
  const next = html.indexOf('<span class="label">', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

test("renderManagerDetail: Season By Season, Draft Picks, and Most Common Lineup are three separate top-level sections, not nested inside each other", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());

  assert.ok(html.includes('<span class="label">Season By Season</span>'));
  assert.ok(html.includes('<span class="label">Draft Picks</span>'));
  assert.ok(html.includes('<span class="label">Most Common Lineup</span>'));

  const seasonSection = section(html, "Season By Season");
  assert.ok(!seasonSection.includes("<details"), "Season By Season itself should have no per-year dropdowns -- those live in the other two sections");
});

test("renderManagerDetail: Season By Season is a single table with Year as its own column, one row per season -- not a separate card per year", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());
  const seasonSection = section(html, "Season By Season");

  assert.match(seasonSection.split("</thead>")[0], /<th>Year<\/th>/);
  const tableCount = (seasonSection.match(/<table class="stat-table compact-mobile">/g) || []).length;
  assert.strictEqual(tableCount, 1, "should be exactly one table, not one per year");
  const rowCount = (seasonSection.match(/<tr>\s*<td data-label="Year">/g) || []).length;
  assert.strictEqual(rowCount, 2, "one row for 2023, one row for 2022");
});

test("renderManagerDetail: Season By Season's Year column shows the trophy for a championship season inline, and PF/PA/Overall/Luck/Record for both", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());
  const seasonSection = section(html, "Season By Season");

  assert.ok(seasonSection.includes("2023 🏆"), "the championship season's year cell should include the trophy");
  assert.ok(!seasonSection.includes("2022 🏆"), "a non-championship season's year cell should not");
  assert.ok(seasonSection.includes("11-2"), "2023's record");
  assert.ok(seasonSection.includes("1489.9"), "2023's PF");
  assert.ok(seasonSection.includes("78-39"), "2023's overall record");
});

test("renderManagerDetail: Draft Picks section has one dropdown per year, each with that year's own table", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());
  const picksSection = section(html, "Draft Picks");

  const detailsCount = (picksSection.match(/<details class="draft-details">/g) || []).length;
  assert.strictEqual(detailsCount, 2, "one dropdown per season (2023 and 2022)");
  assert.match(picksSection, /<th>Pick<\/th><th>Player<\/th><th>Points<\/th><th>Grade<\/th>/);
  assert.ok(picksSection.includes("Derek Holloway"), "2023's pick");
  assert.ok(picksSection.includes("Someone Else"), "2022's pick");
  assert.ok(picksSection.includes("2023 — 2 picks"));
  assert.ok(picksSection.includes("2022 — 1 pick"), "singular 'pick' when there's exactly one");
});

test("renderManagerDetail: Most Common Lineup section has one dropdown per year, each with that year's own table", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());
  const lineupSection = section(html, "Most Common Lineup");

  const detailsCount = (lineupSection.match(/<details class="draft-details">/g) || []).length;
  assert.strictEqual(detailsCount, 2, "one dropdown per season (2023 and 2022)");
  assert.match(lineupSection, /<th>Slot<\/th><th>Player<\/th><th>Starts<\/th>/);
  assert.ok(lineupSection.includes("Alex Turner"), "2023's lineup");
  assert.ok(lineupSection.includes("2023 — 14 games"));
  assert.ok(lineupSection.includes("2022 — 13 games"));
});

test("renderManagerDetail: a championship season's per-year dropdown summary shows the trophy, a non-champion season's doesn't", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());
  const picksSection = section(html, "Draft Picks");
  assert.ok(picksSection.includes("🏆 2023"), "2023 was a championship season");
  assert.ok(!picksSection.includes("🏆 2022"), "2022 was not");
});

test("renderManagerDetail: no longer uses the old shared flex-row list markup for either table", () => {
  const ctx = setup();
  const html = ctx.renderManagerDetail(fakeManager());
  assert.ok(!html.includes('class="draft-pick-row"'));
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
  manager.seasons.length = 1; // simplify to just the one (now-empty) season for this check
  const html = ctx.renderManagerDetail(manager);
  assert.ok(html.includes("No draft data for this season."));
  assert.ok(html.includes("No lineup data for this season."));
});
