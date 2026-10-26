const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules } = require("./helpers/site-env.js");
const fastData = require("../scripts/build-fast-data.js");

/*
  Fast first load: the slim player directory, the season chain read from the
  repo backup, and the parallel live fetch for the season in progress.
  Everything runs against stubbed fetches (no network); the last block checks
  the committed data files against the real archive.
*/

const ROOT = path.join(__dirname, "..");
const SLEEPER = "https://api.sleeper.app/v1";

function json(data) {
  return { ok: true, status: 200, json: async () => data };
}
const NOT_FOUND = { ok: false, status: 404, json: async () => null };

// A fetch stub that answers from a { path-or-url: data } map, logs every
// request, and tracks how many were in flight at once.
function makeFetch(routes, { delay = 0, track = null } = {}) {
  const calls = [];
  let inflight = 0;
  let trackedNow = 0;
  const stub = async (url) => {
    calls.push(String(url));
    inflight++;
    const tracked = track ? track(String(url)) : false;
    if (tracked) trackedNow++;
    stub.maxInflight = Math.max(stub.maxInflight, inflight);
    stub.maxTracked = Math.max(stub.maxTracked, trackedNow);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    inflight--;
    if (tracked) trackedNow--;
    const hit = routes[url];
    if (typeof hit === "function") return hit(url);
    return hit === undefined ? NOT_FOUND : json(hit);
  };
  stub.calls = calls;
  stub.maxInflight = 0;
  stub.maxTracked = 0;
  return stub;
}
const liveCalls = (fetchStub) => fetchStub.calls.filter((u) => u.startsWith(SLEEPER));
const archiveCalls = (fetchStub) => fetchStub.calls.filter((u) => u.startsWith("data/sleeper-archive/"));

function load() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
}

// ---------------------------------------------------------------- slim players

test("slimPlayerDirectory: keeps only the five fields the site reads, and only fantasy-position players", () => {
  const { SleeperAPI } = load();
  const slim = SleeperAPI.slimPlayerDirectory({
    100: { full_name: "Pat QB", first_name: "Pat", last_name: "QB", position: "QB", team: "KC", age: 30, injury_status: "Out", search_rank: 3 },
    200: { full_name: "Lou Backer", first_name: "Lou", last_name: "Backer", position: "LB", team: "DAL" },
    300: { full_name: "Free Agent", first_name: "Free", last_name: "Agent", position: "WR", team: null },
    PHI: { full_name: "Philadelphia Eagles", first_name: "Philadelphia", last_name: "Eagles", position: "DEF", team: "PHI" },
  });
  assert.deepStrictEqual(Object.keys(slim), ["100", "300", "PHI"], "the linebacker is left out; order is the full directory's order");
  assert.deepStrictEqual(Object.keys(slim[100]).sort(), ["first_name", "full_name", "last_name", "position", "team"]);
  assert.strictEqual(slim[100].full_name, "Pat QB");
  assert.strictEqual(slim[100].age, undefined, "fields the site never reads are dropped");
  assert.strictEqual("team" in slim[300], false, "a null team is left out rather than stored as null");
});

test("slimPlayerDirectory: keepIds keeps a player of any position, fantasy_positions counts, extra positions can be added", () => {
  const { SleeperAPI } = load();
  const full = {
    1: { full_name: "Lou Backer", position: "LB" },
    2: { full_name: "Hybrid Guy", position: "CB", fantasy_positions: ["WR"] },
    3: { full_name: "Other Backer", position: "LB" },
    4: { full_name: "Punter Pete", position: "P" },
  };
  const slim = SleeperAPI.slimPlayerDirectory(full, { keepIds: [1] });
  assert.deepStrictEqual(Object.keys(slim), ["1", "2"], "kept by id (1) and by also playing a fantasy position (2); the other linebacker and the punter go");
  const withIdp = SleeperAPI.slimPlayerDirectory(full, { positions: ["LB"] });
  assert.deepStrictEqual(Object.keys(withIdp), ["1", "2", "3"], "an IDP league can ask for linebackers");
});

test("slimPlayerDirectory: copes with an empty or missing directory", () => {
  const { SleeperAPI } = load();
  assert.strictEqual(Object.keys(SleeperAPI.slimPlayerDirectory({})).length, 0);
  assert.strictEqual(Object.keys(SleeperAPI.slimPlayerDirectory(null)).length, 0);
});

test("getPlayerDirectory: uses the slim file when it exists — no Sleeper request, nothing written to browser storage", async () => {
  const ctx = load();
  ctx.fetch = makeFetch({ "data/players-slim.json": { players: { 7: { full_name: "Slim Shady", position: "WR" } } } });
  const dir = await ctx.SleeperAPI.getPlayerDirectory();
  assert.strictEqual(dir[7].full_name, "Slim Shady");
  assert.strictEqual(liveCalls(ctx.fetch).length, 0, "the 14 MB live directory is never requested");
  assert.strictEqual(Object.keys(ctx.localStorage._data).length, 0);
});

test("getPlayerDirectory: without the slim file it falls back to Sleeper, trims the result, and now actually caches it", async () => {
  const ctx = load();
  ctx.fetch = makeFetch({ [`${SLEEPER}/players/nfl`]: { 1: { full_name: "A QB", position: "QB", age: 25 }, 2: { full_name: "A Lineman", position: "OT" } } });
  const dir = await ctx.SleeperAPI.getPlayerDirectory();
  assert.deepStrictEqual(Object.keys(dir), ["1"]);
  assert.strictEqual(dir[1].age, undefined);
  const cached = JSON.parse(ctx.localStorage.getItem("sleeper_players_nfl_v2"));
  assert.deepStrictEqual(Object.keys(cached.players), ["1"], "the trimmed copy is small enough to fit in browser storage");

  // A second visit is served from that cache: Sleeper is not asked again.
  const ctx2 = load();
  ctx2.localStorage.setItem("sleeper_players_nfl_v2", ctx.localStorage.getItem("sleeper_players_nfl_v2"));
  ctx2.fetch = makeFetch({});
  const again = await ctx2.SleeperAPI.getPlayerDirectory();
  assert.strictEqual(again[1].full_name, "A QB");
  assert.strictEqual(liveCalls(ctx2.fetch).length, 0);
});

test("getPlayerDirectory: with no slim file and Sleeper down, the repo's full backup is used (and trimmed)", async () => {
  const ctx = load();
  ctx.fetch = makeFetch({
    [`${SLEEPER}/players/nfl`]: () => ({ ok: false, status: 503, json: async () => null }),
    "data/sleeper-archive/players.json": { 1: { full_name: "Backed Up", position: "RB", age: 22 }, 2: { full_name: "Kick Returner", position: "CB" } },
  });
  const dir = await ctx.SleeperAPI.getPlayerDirectory();
  assert.deepStrictEqual(Object.keys(dir), ["1"]);
  assert.strictEqual(dir[1].full_name, "Backed Up");
});

// ---------------------------------------------------------------- season chain

function league(id, season, status, prev) {
  return { league_id: id, season, status, previous_league_id: prev };
}
function userRow(id, name, avatar, team) {
  return { user_id: id, display_name: name, avatar, metadata: { team_name: team } };
}
function backup(lg, users) {
  return { league: lg, rosters: [{ roster_id: 1, owner_id: users[0].user_id }], users, bracket: [{ m: 1, r: 1, p: 1, w: 1, l: 2 }], weeks: [], transactions: [], draft: null };
}
const INDEX = [
  { season: "2022", leagueId: "L1", previousLeagueId: null, status: "complete" },
  { season: "2023", leagueId: "L2", previousLeagueId: "L1", status: "complete" },
  { season: "2024", leagueId: "L3", previousLeagueId: "L2", status: "in_season" },
];
function chainRoutes(overrides = {}) {
  return {
    "data/sleeper-archive/index.json": INDEX,
    "data/sleeper-archive/2022.json": backup(league("L1", "2022", "complete", null), [userRow("u1", "OldName", "oldAv", "Team 2022")]),
    "data/sleeper-archive/2023.json": backup(league("L2", "2023", "complete", "L1"), [userRow("u1", "OldName", "oldAv", "Team 2023")]),
    [`${SLEEPER}/league/L3`]: league("L3", "2024", "in_season", "L2"),
    [`${SLEEPER}/league/L3/rosters`]: [{ roster_id: 1, owner_id: "u1" }],
    [`${SLEEPER}/league/L3/users`]: [userRow("u1", "NewName", "newAv", "Team 2024")],
    [`${SLEEPER}/league/L3/winners_bracket`]: [],
    ...overrides,
  };
}

test("getSeasonChain: finished seasons come from the backup — Sleeper is only asked about the current league", async () => {
  const ctx = load();
  ctx.fetch = makeFetch(chainRoutes());
  const chain = await ctx.SleeperAPI.getSeasonChain("L3");

  assert.deepStrictEqual(Array.from(chain, (s) => s.league.league_id), ["L1", "L2", "L3"], "still oldest -> newest");
  assert.deepStrictEqual(Array.from(liveCalls(ctx.fetch)).sort(), [`${SLEEPER}/league/L3`, `${SLEEPER}/league/L3/rosters`, `${SLEEPER}/league/L3/users`, `${SLEEPER}/league/L3/winners_bracket`].sort());
  assert.strictEqual(chain[0].rosters.length, 1);
  assert.strictEqual(chain[0].bracket.length, 1, "the season's playoff bracket comes along from the backup");
  assert.strictEqual(chain[0].league.status, "complete");
});

test("getSeasonChain: old seasons show each manager's current display name and avatar (like Sleeper), but keep that season's team name", async () => {
  const ctx = load();
  ctx.fetch = makeFetch(chainRoutes());
  const chain = await ctx.SleeperAPI.getSeasonChain("L3");
  const old = chain[0].users[0];
  assert.strictEqual(old.display_name, "NewName");
  assert.strictEqual(old.avatar, "newAv");
  assert.strictEqual(old.metadata.team_name, "Team 2022");
  assert.strictEqual(chain[2].users[0].display_name, "NewName");

  // The shared backup copy itself was not changed (other readers use it too).
  const raw = await ctx.SleeperAPI.getArchivedSeason("2022", "L1");
  assert.strictEqual(raw.users[0].display_name, "OldName");
});

test("getSeasonChain: a manager who has left keeps their backed-up name", async () => {
  const ctx = load();
  ctx.fetch = makeFetch(chainRoutes({ [`${SLEEPER}/league/L3/users`]: [userRow("u9", "Newcomer", "av9", "Team 2024")] }));
  const chain = await ctx.SleeperAPI.getSeasonChain("L3");
  assert.strictEqual(chain[0].users[0].display_name, "OldName");
});

test("getSeasonChain: each backup file is downloaded once, even when the deep fetch asks for it afterwards", async () => {
  const ctx = load();
  ctx.fetch = makeFetch(chainRoutes());
  const chain = await ctx.SleeperAPI.getSeasonChain("L3");
  const progress = [];
  await ctx.DeepHistory.fetchSeasonDeep(chain[0], (s, status) => progress.push(status));
  await ctx.DeepHistory.fetchSeasonDeep(chain[1], (s, status) => progress.push(status));
  assert.deepStrictEqual(progress, ["archived", "archived"]);
  const counts = {};
  archiveCalls(ctx.fetch).forEach((u) => (counts[u] = (counts[u] || 0) + 1));
  assert.strictEqual(counts["data/sleeper-archive/2022.json"], 1);
  assert.strictEqual(counts["data/sleeper-archive/2023.json"], 1);
  assert.strictEqual(counts["data/sleeper-archive/2024.json"], undefined, "the season in progress is never read from the backup");
  assert.strictEqual(counts["data/sleeper-archive/index.json"], 1);
});

test("getSeasonChain: with no index file it walks the chain live exactly like before", async () => {
  const ctx = load();
  const live = (id, season, status, prev, name) => ({
    [`${SLEEPER}/league/${id}`]: league(id, season, status, prev),
    [`${SLEEPER}/league/${id}/rosters`]: [{ roster_id: 1, owner_id: "u1" }],
    [`${SLEEPER}/league/${id}/users`]: [userRow("u1", name, "av", "T")],
    [`${SLEEPER}/league/${id}/winners_bracket`]: [],
  });
  ctx.fetch = makeFetch({ ...live("L3", "2024", "in_season", "L2", "N"), ...live("L2", "2023", "complete", "L1", "N"), ...live("L1", "2022", "complete", null, "N") });
  const chain = await ctx.SleeperAPI.getSeasonChain("L3");
  assert.deepStrictEqual(Array.from(chain, (s) => s.league.league_id), ["L1", "L2", "L3"]);
  assert.strictEqual(liveCalls(ctx.fetch).length, 12, "four requests per season, as it always was");
});

test("getSeasonChain: a backup saved before its season finished is not trusted — that season is fetched live, earlier ones still use the backup", async () => {
  const ctx = load();
  ctx.fetch = makeFetch(
    chainRoutes({
      "data/sleeper-archive/2023.json": backup(league("L2", "2023", "in_season", "L1"), [userRow("u1", "OldName", "oldAv", "Team 2023")]),
      [`${SLEEPER}/league/L2`]: league("L2", "2023", "complete", "L1"),
      [`${SLEEPER}/league/L2/rosters`]: [{ roster_id: 1, owner_id: "u1" }, { roster_id: 2, owner_id: "u2" }],
      [`${SLEEPER}/league/L2/users`]: [userRow("u1", "NewName", "newAv", "Team 2023")],
      [`${SLEEPER}/league/L2/winners_bracket`]: [],
    })
  );
  const chain = await ctx.SleeperAPI.getSeasonChain("L3");
  assert.deepStrictEqual(Array.from(chain, (s) => s.league.league_id), ["L1", "L2", "L3"]);
  assert.strictEqual(chain[1].rosters.length, 2, "L2 came from Sleeper, not the stale backup");
  assert.ok(liveCalls(ctx.fetch).some((u) => u.endsWith("/league/L2")));
  assert.ok(!liveCalls(ctx.fetch).some((u) => u.includes("/league/L1")), "L1's backup is finished, so it is still read from the backup");
});

test("getSeasonChain: a season listed in the index whose file is missing falls back to a live fetch", async () => {
  const ctx = load();
  const routes = chainRoutes({
    [`${SLEEPER}/league/L1`]: league("L1", "2022", "complete", null),
    [`${SLEEPER}/league/L1/rosters`]: [{ roster_id: 1, owner_id: "u1" }],
    [`${SLEEPER}/league/L1/users`]: [userRow("u1", "N", "a", "T")],
    [`${SLEEPER}/league/L1/winners_bracket`]: [],
  });
  delete routes["data/sleeper-archive/2022.json"];
  ctx.fetch = makeFetch(routes);
  const chain = await ctx.SleeperAPI.getSeasonChain("L3");
  assert.deepStrictEqual(Array.from(chain, (s) => s.league.league_id), ["L1", "L2", "L3"]);
  assert.ok(liveCalls(ctx.fetch).some((u) => u.endsWith("/league/L1")));
});

test("getSeasonChain: the starting league is always live, even when it is finished and backed up", async () => {
  const ctx = load();
  const routes = chainRoutes({
    "data/sleeper-archive/index.json": INDEX.map((e) => (e.leagueId === "L3" ? { ...e, status: "complete" } : e)),
    "data/sleeper-archive/2024.json": backup(league("L3", "2024", "complete", "L2"), [userRow("u1", "OldName", "oldAv", "Team 2024")]),
    [`${SLEEPER}/league/L3`]: league("L3", "2024", "complete", "L2"),
  });
  ctx.fetch = makeFetch(routes);
  const chain = await ctx.SleeperAPI.getSeasonChain("L3");
  assert.strictEqual(chain[2].users[0].display_name, "NewName", "its users list came from Sleeper");
  assert.ok(liveCalls(ctx.fetch).some((u) => u.endsWith("/league/L3/users")));
});

test("getSeasonChain: a corrupt index (not a list) is ignored", async () => {
  const ctx = load();
  const live = (id, prev) => ({
    [`${SLEEPER}/league/${id}`]: league(id, "2024", "in_season", prev),
    [`${SLEEPER}/league/${id}/rosters`]: [],
    [`${SLEEPER}/league/${id}/users`]: [],
    [`${SLEEPER}/league/${id}/winners_bracket`]: [],
  });
  ctx.fetch = makeFetch({ "data/sleeper-archive/index.json": { oops: true }, ...live("L3", "L2"), ...live("L2", null) });
  const chain = await ctx.SleeperAPI.getSeasonChain("L3");
  assert.strictEqual(chain.length, 2);
});

// ---------------------------------------------------------------- deep fetch

function matchup(points) {
  return [{ roster_id: 1, matchup_id: 1, points, players: ["p1"], starters: ["p1"], players_points: { p1: points } }];
}
function liveSeasonRoutes(weeks, extra = {}, nflWeek = 18) {
  const routes = {
    [`${SLEEPER}/state/nfl`]: { season: "2026", week: nflWeek },
    [`${SLEEPER}/league/L9/drafts`]: [{ draft_id: "d9" }],
    [`${SLEEPER}/draft/d9/picks`]: [{ round: 1, pick_no: 1, roster_id: 1, player_id: "p1" }],
    ...extra,
  };
  for (let w = 1; w <= 17; w++) {
    routes[`${SLEEPER}/league/L9/matchups/${w}`] = weeks[w] === undefined ? [] : weeks[w];
    routes[`${SLEEPER}/league/L9/transactions/${w}`] = [{ type: "waiver", status: "complete", leg: w, roster_ids: [1], adds: { p1: 1 }, settings: { waiver_bid: 1 } }];
  }
  return routes;
}
// A season in progress whose rosters have each finished `games` games.
const inProgress = (games, settings = {}) => ({
  league: { league_id: "L9", season: "2026", status: "in_season", settings },
  rosters: [{ roster_id: 1, settings: { wins: games, losses: 0, ties: 0 } }],
});
const IN_PROGRESS = inProgress(17);

test("fetchSeasonDeep (live): later weeks load in parallel and the result is the same list the one-at-a-time walk built", async () => {
  const ctx = load();
  ctx.fetch = makeFetch(liveSeasonRoutes({ 1: matchup(100), 2: matchup(110), 3: matchup(0), 4: [], 5: matchup(50) }, {}, 3), { delay: 5, track: (u) => u.includes("/matchups/") });
  const result = await ctx.DeepHistory.fetchSeasonDeep(inProgress(2), () => {});

  assert.deepStrictEqual(Array.from(result.scheduleWeeks, (w) => w.week), [1, 2, 3], "stops at the first empty week, even though week 5 has data");
  assert.deepStrictEqual(Array.from(result.weeks, (w) => w.week), [1, 2], "week 3 has no points yet, so it is schedule only");
  assert.deepStrictEqual(Array.from(result.transactions, (t) => t.leg), [1, 2, 3]);
  assert.strictEqual(result.draft.draftId, "d9");
  assert.strictEqual(result.draft.picks.length, 1);
  assert.ok(ctx.fetch.maxTracked >= 4, `weeks should be fetched concurrently (saw at most ${ctx.fetch.maxTracked} week requests at once)`);
  assert.ok(ctx.fetch.maxTracked <= 6, "but bounded to six at a time");
  const matchupCalls = ctx.fetch.calls.filter((u) => u.includes("/matchups/")).length;
  assert.strictEqual(matchupCalls, 17, "week 1, then the other 16 in one parallel batch");
});

test("fetchSeasonDeep (live): a full in-progress schedule keeps every week as schedule", async () => {
  const ctx = load();
  const weeks = {};
  for (let w = 1; w <= 17; w++) weeks[w] = matchup(w <= 4 ? 100 + w : 0);
  ctx.fetch = makeFetch(liveSeasonRoutes(weeks, {}, 5));
  const result = await ctx.DeepHistory.fetchSeasonDeep(inProgress(4), () => {});
  assert.strictEqual(result.scheduleWeeks.length, 17);
  assert.deepStrictEqual(Array.from(result.weeks, (w) => w.week), [1, 2, 3, 4]);
  assert.strictEqual(result.transactions.length, 17);
});

test("fetchSeasonDeep (live): a season that has not started costs one matchups request, not seventeen", async () => {
  const ctx = load();
  ctx.fetch = makeFetch(liveSeasonRoutes({}));
  const result = await ctx.DeepHistory.fetchSeasonDeep(IN_PROGRESS, () => {});
  assert.strictEqual(result.weeks.length, 0);
  assert.strictEqual(result.scheduleWeeks.length, 0);
  assert.strictEqual(ctx.fetch.calls.filter((u) => u.includes("/matchups/")).length, 1);
  assert.strictEqual(ctx.fetch.calls.filter((u) => u.includes("/transactions/")).length, 0);
});

test("fetchSeasonDeep (live): a week that fails to load ends the schedule there, like before", async () => {
  const ctx = load();
  const weeks = { 1: matchup(100), 2: matchup(110), 4: matchup(120) };
  ctx.fetch = makeFetch(liveSeasonRoutes(weeks, { [`${SLEEPER}/league/L9/matchups/3`]: () => ({ ok: false, status: 500, json: async () => null }) }));
  const result = await ctx.DeepHistory.fetchSeasonDeep(IN_PROGRESS, () => {});
  assert.deepStrictEqual(Array.from(result.scheduleWeeks, (w) => w.week), [1, 2]);
});

test("fetchSeasonDeep (live): a missing draft board is fine", async () => {
  const ctx = load();
  ctx.fetch = makeFetch(liveSeasonRoutes({ 1: matchup(100) }, { [`${SLEEPER}/league/L9/drafts`]: [] }, 2));
  const result = await ctx.DeepHistory.fetchSeasonDeep(inProgress(1), () => {});
  assert.strictEqual(result.draft, null);
  assert.strictEqual(result.weeks.length, 1);
});

test("fetchSeasonDeep: a backup that wasn't finished when it was saved, or belongs to another league, is not served as a finished season", async () => {
  for (const archived of [backup(league("L1", "2023", "in_season", null), [userRow("u1", "n", "a", "t")]), backup(league("OTHER", "2023", "complete", null), [userRow("u1", "n", "a", "t")])]) {
    const ctx = load();
    ctx.fetch = makeFetch({ "data/sleeper-archive/2023.json": archived });
    const progress = [];
    await ctx.DeepHistory.fetchSeasonDeep({ league: { league_id: "L1", season: "2023", status: "complete" } }, (s, status) => progress.push(status));
    assert.deepStrictEqual(progress, ["fetching"], "falls through to the live fetch");
  }
});

// ---------------------------------------------------------------- build script

const fixtureArchive = (season, id, prev, extra = {}) => ({
  league: { league_id: id, season, status: "complete", previous_league_id: prev, roster_positions: ["QB", "RB", "WR", "FLEX", "SUPER_FLEX", "K", "DEF", "BN", "BN", "IR"] },
  rosters: [{ roster_id: 1, players: ["10", "11"], reserve: ["12"], taxi: null, starters: ["10", "0"] }],
  users: [],
  bracket: [],
  weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["10", "13"], starters: ["10"], players_points: { 10: 5, 13: 0 } }] }],
  transactions: [{ adds: { 14: 1 }, drops: { 15: 1 } }, { adds: null, drops: null }],
  draft: { picks: [{ player_id: "16" }, { player_id: null }] },
  ...extra,
});

test("build-fast-data: referencedPlayerIds finds every id in lineups, benches, roster moves, drafts and rosters (and skips empty slots)", () => {
  const ids = fastData.referencedPlayerIds([fixtureArchive("2024", "A", null)]);
  assert.deepStrictEqual([...ids].sort(), ["10", "11", "12", "13", "14", "15", "16"]);
});

test("build-fast-data: positionsFromArchives adds IDP positions only when a league uses IDP slots", () => {
  assert.deepStrictEqual(fastData.positionsFromArchives([fixtureArchive("2024", "A", null)]).sort(), ["DEF", "K", "QB", "RB", "WR"], "FLEX/SUPER_FLEX/BN/IR are slots, not positions");
  const idp = fixtureArchive("2025", "B", "A", {});
  idp.league.roster_positions = ["QB", "DL", "IDP_FLEX"];
  const positions = fastData.positionsFromArchives([idp]);
  ["QB", "DL", "LB", "DB", "CB", "S"].forEach((p) => assert.ok(positions.includes(p), p));
});

test("build-fast-data: buildSlimPlayers keeps anyone in the league's history whatever their position", () => {
  const { SleeperAPI } = load();
  const full = {
    10: { full_name: "Starter", position: "QB" },
    13: { full_name: "Odd Position", position: "LS" },
    99: { full_name: "Stranger", position: "LB" },
  };
  const slim = fastData.buildSlimPlayers(full, [fixtureArchive("2024", "A", null)], SleeperAPI);
  assert.deepStrictEqual(Object.keys(slim.players), ["10", "13"]);
});

test("build-fast-data: buildArchiveIndex lists each season oldest first with its league, previous league and status", () => {
  const index = fastData.buildArchiveIndex([fixtureArchive("2025", "B", "A"), fixtureArchive("2024", "A", null), { league: {} }]);
  assert.deepStrictEqual(index.map((e) => e.season), ["2024", "2025"]);
  assert.deepStrictEqual(index.map((e) => e.leagueId), ["A", "B"]);
  assert.strictEqual(index[0].previousLeagueId, null);
  assert.strictEqual(index[1].previousLeagueId, "A");
  assert.strictEqual(index[1].status, "complete");
});

// ------------------------------------------------------- committed data files

function readArchives() {
  const dir = path.join(ROOT, "data", "sleeper-archive");
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

test("committed data/sleeper-archive/index.json matches the season files — rerun `node scripts/build-fast-data.js` if this fails", () => {
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sleeper-archive", "index.json"), "utf8"));
  const expected = fastData.buildArchiveIndex(readArchives());
  assert.strictEqual(JSON.stringify(committed), JSON.stringify(expected));
});

test("committed data/players-slim.json is current and covers every player in the league's history — rerun `node scripts/build-fast-data.js` if this fails", () => {
  const { SleeperAPI } = load();
  const archives = readArchives();
  const full = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sleeper-archive", "players.json"), "utf8"));
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "players-slim.json"), "utf8"));
  const expected = fastData.buildSlimPlayers(full, archives, SleeperAPI);
  assert.strictEqual(JSON.stringify(committed), JSON.stringify(expected), "slim file is out of date with the player backup");
  const missing = [...fastData.referencedPlayerIds(archives)].filter((id) => !committed.players[id]);
  assert.deepStrictEqual(missing, [], "every player who ever appears in a lineup, roster move or draft resolves by name");
  const bytes = fs.statSync(path.join(ROOT, "data", "players-slim.json")).size;
  assert.ok(bytes < 1024 * 1024, `slim directory is ${Math.round(bytes / 1024)} KB — should stay well under 1 MB`);
});

test("name-to-player matching (used for award photos) gives the same answers with the slim directory", () => {
  const ctx = loadSiteModules(["utils.js"]);
  const full = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sleeper-archive", "players.json"), "utf8"));
  const slim = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "players-slim.json"), "utf8")).players;
  const indexFull = ctx.buildPlayerNameIndex(full);
  const indexSlim = ctx.buildPlayerNameIndex(slim);
  const strings = [];
  (function walk(v) {
    if (typeof v === "string") strings.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  })(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "season-awards.json"), "utf8")));
  const differences = strings.filter((s) => ctx.findPlayerIdByName(s, indexFull) !== ctx.findPlayerIdByName(s, indexSlim));
  assert.deepStrictEqual(differences, []);
});
