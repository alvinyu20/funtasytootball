const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "draft.js"]);
}

function fakeEntry(season, status) {
  return { league: { season, status } };
}

function fakePick(overrides) {
  return { round: 1, pickInRound: 1, playerId: "1", player: "Test Player", position: "RB", points: 1, vbd: 1, grade: "B", ...overrides };
}

// LEAGUE_STATS shaped just enough to drive buildDraftBoard: one manager
// with a season entry (and draftPicks) for every season passed in.
function fakeLeagueStats(seasonsWithPicks) {
  return {
    managers: [
      {
        userId: "u1",
        username: "tduchow",
        teamName: "tduchow",
        seasons: seasonsWithPicks.map(({ season, picks }) => ({ season, draftPicks: picks })),
      },
    ],
  };
}

test("pickDefaultSeason: picks the newest season with a draft on record, even if it's the current in-progress season (not strictly the newest COMPLETE one)", () => {
  const ctx = setup();
  const seasonChain = [fakeEntry("2024", "complete"), fakeEntry("2025", "complete"), fakeEntry("2026", "in_season")];
  ctx.__STATS__ = fakeLeagueStats([
    { season: "2024", picks: [fakePick()] },
    { season: "2025", picks: [fakePick()] },
    { season: "2026", picks: [fakePick()] }, // this year's draft already happened
  ]);
  runInLoadedContext(ctx, "LEAGUE_STATS = __STATS__;");
  assert.strictEqual(ctx.pickDefaultSeason(seasonChain), "2026");
});

test("pickDefaultSeason: falls back to the newest season that DOES have a draft when the newest season has none yet (upcoming season, pre-draft)", () => {
  const ctx = setup();
  const seasonChain = [fakeEntry("2024", "complete"), fakeEntry("2025", "complete"), fakeEntry("2026", "pre_draft")];
  ctx.__STATS__ = fakeLeagueStats([
    { season: "2024", picks: [fakePick()] },
    { season: "2025", picks: [fakePick()] },
    { season: "2026", picks: [] }, // draft hasn't happened yet
  ]);
  runInLoadedContext(ctx, "LEAGUE_STATS = __STATS__;");
  assert.strictEqual(ctx.pickDefaultSeason(seasonChain), "2025");
});

test("pickDefaultSeason: a season's completion status alone doesn't matter — only whether it actually has draft picks logged", () => {
  const ctx = setup();
  // Regression check for the old behavior, which keyed off status ===
  // "complete" specifically and would have picked 2025 here even though
  // 2026 has a perfectly good draft on record already.
  const seasonChain = [fakeEntry("2025", "complete"), fakeEntry("2026", "in_season")];
  ctx.__STATS__ = fakeLeagueStats([
    { season: "2025", picks: [fakePick()] },
    { season: "2026", picks: [fakePick()] },
  ]);
  runInLoadedContext(ctx, "LEAGUE_STATS = __STATS__;");
  assert.strictEqual(ctx.pickDefaultSeason(seasonChain), "2026");
});

test("pickDefaultSeason: falls back to the newest season in the chain when NO season has draft data at all, so the page always has something to select", () => {
  const ctx = setup();
  const seasonChain = [fakeEntry("2025", "complete"), fakeEntry("2026", "pre_draft")];
  ctx.__STATS__ = fakeLeagueStats([]);
  runInLoadedContext(ctx, "LEAGUE_STATS = __STATS__;");
  assert.strictEqual(ctx.pickDefaultSeason(seasonChain), "2026");
});

test("pickDefaultSeason: returns null for an empty season chain rather than throwing", () => {
  const ctx = setup();
  assert.strictEqual(ctx.pickDefaultSeason([]), null);
});
