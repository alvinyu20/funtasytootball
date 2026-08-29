const test = require("node:test");
const assert = require("node:assert");
const { buildPlayerIndex, teamNameFor, round1 } = require("../scripts/build-player-index.js");

// A small helper for building a fake matchup entry.
function m(rosterId, players, starters, points) {
  return { roster_id: rosterId, players, starters, players_points: points };
}

function twoTeamChain() {
  return [
    { league: { season: "2021" }, rosters: [{ roster_id: 1, owner_id: "userA" }, { roster_id: 2, owner_id: "userB" }], users: [{ user_id: "userA", display_name: "Alice" }, { user_id: "userB", display_name: "Bob" }] },
    { league: { season: "2022" }, rosters: [{ roster_id: 1, owner_id: "userA" }, { roster_id: 2, owner_id: "userB" }], users: [{ user_id: "userA", display_name: "Alice" }, { user_id: "userB", display_name: "Bob" }] },
  ];
}

test("buildPlayerIndex: a player who never started is excluded entirely, even if heavily rostered", () => {
  const chain = twoTeamChain();
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], [], { P1: 10 })] },
      { week: 2, matchups: [m(1, ["P1"], [], { P1: 12 })] },
    ],
    [],
  ];
  const players = buildPlayerIndex(chain, weeksList, {});
  assert.strictEqual(players.P1, undefined, "a never-started player should not appear in the index at all");
});

test("buildPlayerIndex: a single continuous ownership span computes gamesOwned/gamesStarted/PPG correctly", () => {
  const chain = twoTeamChain();
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 10 })] },
      { week: 2, matchups: [m(1, ["P1"], [], { P1: 6 })] },
      { week: 3, matchups: [m(1, ["P1"], ["P1"], { P1: 20 })] },
    ],
    [],
  ];
  const players = buildPlayerIndex(chain, weeksList, { P1: { full_name: "Test Player", position: "WR" } });
  const p = players.P1;
  assert.ok(p, "a player with at least one start should be included");
  assert.strictEqual(p.name, "Test Player");
  assert.strictEqual(p.position, "WR");
  assert.strictEqual(p.spans.length, 1, "one continuous span, same owner throughout");
  assert.strictEqual(p.spans[0].ownerName, "Alice");
  assert.strictEqual(p.spans[0].gamesOwned, 3);
  assert.strictEqual(p.spans[0].gamesStarted, 2);
  assert.strictEqual(p.spans[0].totalPoints, 36);
  assert.strictEqual(p.spans[0].ppg, 12, "36 points over 3 owned games = 12.0 ppg");
  assert.strictEqual(p.totals.owners, 1);
  assert.strictEqual(p.totals.gamesBenched, 1);
});

test("buildPlayerIndex: the same owner reacquiring a player after someone else had them is TWO spans, not one merged span", () => {
  const chain = twoTeamChain();
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 10 })] },
      { week: 2, matchups: [m(2, ["P1"], ["P1"], { P1: 15 })] }, // Bob has them week 2
      { week: 3, matchups: [m(1, ["P1"], ["P1"], { P1: 8 })] }, // Alice again, week 3
    ],
    [],
  ];
  const players = buildPlayerIndex(chain, weeksList, {});
  const spans = players.P1.spans;
  assert.strictEqual(spans.length, 3, "Alice / Bob / Alice should be three separate spans, not two");
  assert.strictEqual(spans[0].ownerName, "Alice");
  assert.strictEqual(spans[1].ownerName, "Bob");
  assert.strictEqual(spans[2].ownerName, "Alice");
  assert.strictEqual(players.P1.totals.owners, 2, "only 2 DISTINCT owners despite 3 spans — Alice shouldn't be double-counted");
});

test("buildPlayerIndex: a true free-agent gap (nobody in the league owns them that week) breaks a span even when the SAME owner has them before and after", () => {
  const chain = twoTeamChain();
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 10 })] },
      { week: 2, matchups: [m(1, [], [], {})] }, // Alice drops P1 -- nobody owns them this week
      { week: 3, matchups: [m(1, ["P1"], ["P1"], { P1: 14 })] }, // Alice re-adds P1
    ],
    [],
  ];
  const players = buildPlayerIndex(chain, weeksList, {});
  const p = players.P1;
  assert.strictEqual(p.spans.length, 2, "a real gap should split into two spans, even though it's the same owner on both sides");
  assert.strictEqual(p.spans[0].endWeek, 1);
  assert.strictEqual(p.spans[1].startWeek, 3);
  assert.strictEqual(p.weekly.length, 2, "the gap week should have no entry at all in the weekly array");
  assert.ok(!p.weekly.some((w) => w.week === 2), "week 2 (the free-agent gap) should not appear in weekly");
});

test("buildPlayerIndex: an ownership span correctly continues across a season boundary when nothing else changes", () => {
  const chain = twoTeamChain();
  const weeksList = [
    [
      { week: 1, matchups: [m(2, ["P1"], ["P1"], { P1: 9 })] },
      { week: 2, matchups: [m(2, ["P1"], ["P1"], { P1: 11 })] },
    ],
    [{ week: 1, matchups: [m(2, ["P1"], ["P1"], { P1: 13 })] }],
  ];
  const players = buildPlayerIndex(chain, weeksList, {});
  const spans = players.P1.spans;
  assert.strictEqual(spans.length, 1, "no gap and no owner change -- should remain one continuous span across the season boundary");
  assert.strictEqual(spans[0].startSeason, "2021");
  assert.strictEqual(spans[0].startWeek, 1);
  assert.strictEqual(spans[0].endSeason, "2022");
  assert.strictEqual(spans[0].endWeek, 1);
  assert.strictEqual(spans[0].gamesOwned, 3);
});

test("buildPlayerIndex: career high correctly identifies the single highest-scoring week and its owner/started status, even across multiple spans", () => {
  const chain = twoTeamChain();
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 10 })] },
      { week: 2, matchups: [m(2, ["P1"], [], { P1: 30 })] }, // Bob's week -- benched but still the high
      { week: 3, matchups: [m(2, ["P1"], ["P1"], { P1: 18 })] },
    ],
    [],
  ];
  const players = buildPlayerIndex(chain, weeksList, {});
  const high = players.P1.careerHigh;
  assert.strictEqual(high.points, 30);
  assert.strictEqual(high.season, "2021");
  assert.strictEqual(high.week, 2);
  assert.strictEqual(high.ownerName, "Bob");
  assert.strictEqual(high.started, false, "the career high can be a benched week — it's about points scored, not lineup decisions");
});

test("buildPlayerIndex: multiple players in the same data are indexed independently, keyed by their own player_id", () => {
  const chain = twoTeamChain();
  const weeksList = [
    [{ week: 1, matchups: [m(1, ["P1", "P2"], ["P1"], { P1: 10, P2: 5 })] }],
    [],
  ];
  const players = buildPlayerIndex(chain, weeksList, {});
  assert.ok(players.P1, "P1 started, should be included");
  assert.strictEqual(players.P2, undefined, "P2 never started (rostered but benched), should be excluded");
});

test("buildPlayerIndex: falls back to first_name + last_name when a player has no full_name in the directory, and to a generic label when neither exists", () => {
  const chain = twoTeamChain();
  const weeksList = [[{ week: 1, matchups: [m(1, ["P1", "P2"], ["P1", "P2"], { P1: 10, P2: 8 })] }], []];
  const players = buildPlayerIndex(chain, weeksList, { P1: { first_name: "Jane", last_name: "Doe" } });
  assert.strictEqual(players.P1.name, "Jane Doe");
  assert.strictEqual(players.P2.name, "Unknown Player", "no directory entry at all should still produce a safe fallback name, not crash");
});

test("teamNameFor: prefers a manager's custom team name over their Sleeper display name", () => {
  const user = { display_name: "someuser123", metadata: { team_name: "The Wolfpack" } };
  assert.strictEqual(teamNameFor(user, 1), "The Wolfpack");
});

test("teamNameFor: falls back to display_name, then to a generic 'Team N' label", () => {
  assert.strictEqual(teamNameFor({ display_name: "someuser123" }, 1), "someuser123");
  assert.strictEqual(teamNameFor(null, 4), "Team 4");
});

test("round1: rounds to exactly one decimal place", () => {
  assert.strictEqual(round1(12.345), 12.3);
  assert.strictEqual(round1(12.35), 12.4);
  assert.strictEqual(round1(10), 10);
});
