const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

// Both tests below stub context.fetch AFTER loading (fetchSeasonDeep looks
// up the global `fetch` binding dynamically each time it's actually
// called, not once at load time, so this works correctly) to simulate a
// static archive file existing for one season but not another, without
// needing any real network access.

test("fetchSeasonDeep: prefers the static archive for a completed season when one exists, and reports status 'archived'", async () => {
  const ctx = loadSiteModules(["utils.js", "sleeper-api.js", "deep-history.js"]);
  const { DeepHistory } = ctx;

  const archiveContent = {
    league: { league_id: "L1", season: "2023" },
    rosters: [{ roster_id: 1 }],
    users: [{ user_id: "u1" }],
    bracket: [],
    weeks: [
      { week: 1, matchups: [{ roster_id: 1, matchup_id: 1, points: 100, players: ["p1"], players_points: { p1: 100 } }] },
      { week: 2, matchups: [{ roster_id: 1, matchup_id: 1, points: 110, players: ["p1"], players_points: { p1: 110 } }] },
      // A future/unplayed week with an all-zero score, matching Sleeper's real
      // behavior of pre-generating the whole season's matchup shells upfront.
      { week: 3, matchups: [{ roster_id: 1, matchup_id: 1, points: 0, players: ["p1"], players_points: { p1: 0 } }] },
    ],
    transactions: [{ type: "waiver", status: "complete", leg: 2, roster_ids: [1], adds: { p1: 1 }, settings: { waiver_bid: 10 } }],
    draft: { draftId: "d1", picks: [{ round: 1, pick_no: 1, roster_id: 1, player_id: "p1" }] },
  };

  ctx.fetch = async (requestPath) => {
    if (requestPath === "data/sleeper-archive/2023.json") {
      return { ok: true, json: async () => archiveContent };
    }
    return { ok: false, status: 404 };
  };

  const seasonEntry = { league: { league_id: "L1", season: "2023", status: "complete" } };
  const progressCalls = [];
  const result = await DeepHistory.fetchSeasonDeep(seasonEntry, (season, status) => progressCalls.push(status));

  assert.deepStrictEqual(progressCalls, ["archived"], "should report 'archived' status, and never touch the live-fetch 'fetching' path");
  assert.strictEqual(result.leagueId, "L1");
  assert.strictEqual(result.season, "2023");
  assert.deepStrictEqual(result.weeks.map((w) => w.week), [1, 2], "week 3 (0 points, unplayed) should be excluded from `weeks`");
  assert.deepStrictEqual(result.scheduleWeeks.map((w) => w.week), [1, 2, 3], "but should still be present in `scheduleWeeks`, matching the live-fetch path's same split");
  assert.strictEqual(result.transactions.length, 1);
  assert.ok(result.draft);
});

test("fetchSeasonDeep: falls through to the live-fetch path when no archive file exists for a season", async () => {
  const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
  const { DeepHistory } = ctx;

  // No archive file for this season anywhere -- every request 404s.
  ctx.fetch = async () => ({ ok: false, status: 404 });

  const seasonEntry = { league: { league_id: "L1", season: "2022", status: "complete" } };
  const progressCalls = [];
  await DeepHistory.fetchSeasonDeep(seasonEntry, (season, status) => progressCalls.push(status));

  assert.deepStrictEqual(progressCalls, ["fetching"], "with no archive available, it should correctly fall through to the live-fetch path rather than getting stuck or silently returning nothing");
});
