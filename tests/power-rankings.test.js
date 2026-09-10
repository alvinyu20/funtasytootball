const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "power-rankings.js"]);
}

function fakeRow(overrides) {
  return {
    rosterId: 1,
    teamName: "Test Team",
    wins: 5,
    losses: 4,
    ties: 0,
    record: "5-4",
    overallRecord: "40-32",
    avgPpg: 110.5,
    stdDev: 12.3,
    playoffPct: 62.5,
    byePct: 10.2,
    rosRank: 3,
    boom: 2,
    bust: 1,
    prScore: 4.1,
    powerRank: 1,
    luckRank: 2,
    finishDistribution: [50, 30, 20],
    ...overrides,
  };
}

test("power-rankings.js loads with no live-data dependency: only config.js and utils.js, not sleeper-api.js or deep-history.js", () => {
  // This IS the test, in a sense -- setup() above only loads the two
  // files a purely snapshot-reading page should need. If a future
  // edit reintroduces a live SleeperAPI/DeepHistory call, this file
  // list would need to grow, which is exactly the kind of change that
  // should prompt someone to notice this comment.
  const ctx = setup();
  assert.strictEqual(typeof ctx.renderPowerRankings, "function");
});

test("deltaBadge: shows NEW when there's no last-week data at all for this team", () => {
  const ctx = setup();
  const badge = ctx.deltaBadge(fakeRow({ teamName: "Alice", powerRank: 3 }), null);
  assert.ok(badge.includes("NEW"));
});

test("deltaBadge: shows NEW for a team specifically missing from an otherwise-present last-week snapshot (a team that's new to the league this season)", () => {
  const ctx = setup();
  const badge = ctx.deltaBadge(fakeRow({ teamName: "Brandnew", powerRank: 5 }), { SomeoneElse: 2 });
  assert.ok(badge.includes("NEW"));
});

test("deltaBadge: an improved rank (lower number) shows an up arrow with the right magnitude", () => {
  const ctx = setup();
  // was #5 last week, now #2 -- moved up 3 spots
  const badge = ctx.deltaBadge(fakeRow({ teamName: "Alice", powerRank: 2 }), { Alice: 5 });
  assert.ok(badge.includes("▲3"));
});

test("deltaBadge: a worse rank (higher number) shows a down arrow", () => {
  const ctx = setup();
  // was #2 last week, now #6 -- dropped 4 spots
  const badge = ctx.deltaBadge(fakeRow({ teamName: "Alice", powerRank: 6 }), { Alice: 2 });
  assert.ok(badge.includes("▼4"));
});

test("deltaBadge: an unchanged rank shows a dash, not an arrow", () => {
  const ctx = setup();
  const badge = ctx.deltaBadge(fakeRow({ teamName: "Alice", powerRank: 4 }), { Alice: 4 });
  assert.ok(badge.includes("–"));
  assert.ok(!badge.includes("▲") && !badge.includes("▼"));
});

test("renderPowerTable: renders every row's team name and core stats", () => {
  const ctx = setup();
  const snapshot = { rows: [fakeRow({ teamName: "Alice's Team", powerRank: 1 }), fakeRow({ teamName: "Bob's Team", powerRank: 2 })] };
  const html = ctx.renderPowerTable(snapshot, null);
  assert.ok(html.includes("Alice&#39;s Team"));
  assert.ok(html.includes("Bob&#39;s Team"));
  assert.ok(html.includes("#1") && html.includes("#2"));
});

test("renderPowerTable: shows an em dash for Bye% and ROS when a row has neither (e.g. a non-bye-week league, or ROS not yet entered for that team)", () => {
  const ctx = setup();
  const snapshot = { rows: [fakeRow({ byePct: null, rosRank: null })] };
  const html = ctx.renderPowerTable(snapshot, null);
  const byeCell = html.match(/data-label="Bye%">([^<]*)</)[1];
  const rosCell = html.match(/data-label="ROS">([^<]*)</)[1];
  assert.strictEqual(byeCell, "—");
  assert.strictEqual(rosCell, "—");
});

test("renderOddsTable: one column per possible finishing position, matching the number of teams", () => {
  const ctx = setup();
  const snapshot = { rows: [fakeRow({ teamName: "A", finishDistribution: [100, 0, 0] }), fakeRow({ teamName: "B", finishDistribution: [0, 100, 0] }), fakeRow({ teamName: "C", finishDistribution: [0, 0, 100] })] };
  const html = ctx.renderOddsTable(snapshot);
  const headerCols = [...html.matchAll(/<th>(\d+)<\/th>/g)].map((m) => m[1]);
  assert.deepStrictEqual(headerCols, ["1", "2", "3"]);
});

test("renderOddsTable: tolerates a row with no finishDistribution at all, rather than throwing", () => {
  const ctx = setup();
  const snapshot = { rows: [fakeRow({ finishDistribution: undefined })] };
  assert.doesNotThrow(() => ctx.renderOddsTable(snapshot));
});

test("renderPreseasonContent: shows only rank, username, and team name — no record, PR score, or any computed stat, since none exist yet", () => {
  const ctx = setup();
  const snapshot = {
    rows: [
      { rank: 1, username: "mayshisha", teamName: "The JAIL BLAZERS" },
      { rank: 2, username: "evangonnerman", teamName: "Big Vibes" },
    ],
  };
  const html = ctx.renderPreseasonContent(snapshot);
  assert.ok(html.includes("mayshisha") && html.includes("The JAIL BLAZERS"));
  assert.ok(html.includes("evangonnerman") && html.includes("Big Vibes"));
  assert.ok(html.includes("#1") && html.includes("#2"));
  // None of the full-table columns should appear anywhere in this view.
  ["PR Score", "Playoff%", "Std Dev", "Overall", "Boom", "Bust"].forEach((col) => {
    assert.ok(!html.includes(col), `preseason view should not show the "${col}" column`);
  });
});

test("renderPreseasonContent: a team with no custom team name (Sleeper default) shows an em dash rather than 'null' or 'undefined'", () => {
  const ctx = setup();
  const snapshot = { rows: [{ rank: 7, username: "jspar279879", teamName: null }] };
  const html = ctx.renderPreseasonContent(snapshot);
  assert.ok(html.includes("jspar279879"));
  assert.ok(!html.includes("null") && !html.includes("undefined"));
});

test("formatGeneratedAt: renders a readable date from an ISO timestamp", () => {
  const ctx = setup();
  assert.strictEqual(ctx.formatGeneratedAt("2026-09-16T14:32:00Z"), "Sep 16, 2026");
});

test("formatGeneratedAt: returns an empty string for a missing or invalid timestamp, rather than 'Invalid Date'", () => {
  const ctx = setup();
  assert.strictEqual(ctx.formatGeneratedAt(null), "");
  assert.strictEqual(ctx.formatGeneratedAt("not a date"), "");
});
