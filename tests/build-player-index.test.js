const test = require("node:test");
const assert = require("node:assert");
const { buildPlayerIndex, ownerUsernameFor, round1, computeFantasyPoints } = require("../scripts/build-player-index.js");

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

test("buildPlayerIndex: uses the manager's username for ownerName in real span/careerHigh output, even when they've set a custom team name", () => {
  const chain = [
    {
      league: { season: "2021" },
      rosters: [{ roster_id: 1, owner_id: "userA" }],
      users: [{ user_id: "userA", display_name: "yulovesyou", metadata: { team_name: "The Wolfpack" } }],
    },
  ];
  const weeksList = [[{ week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 10 })] }]];
  const players = buildPlayerIndex(chain, weeksList, {});
  assert.strictEqual(players.P1.spans[0].ownerName, "yulovesyou", "span ownerName should be the username, not the custom team name");
  assert.strictEqual(players.P1.careerHigh.ownerName, "yulovesyou", "careerHigh ownerName should also be the username");
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

test("buildPlayerIndex: PPG excludes weeks scored exactly 0.0 from the denominator (treated as injury/suspension/DNP), while gamesOwned and gamesStarted are unaffected", () => {
  const chain = twoTeamChain();
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 20 })] }, // played, started
      { week: 2, matchups: [m(1, ["P1"], ["P1"], { P1: 0 })] }, // started but scored 0 -- presumed injured/inactive
      { week: 3, matchups: [m(1, ["P1"], [], { P1: 0 })] }, // benched, also scored 0
      { week: 4, matchups: [m(1, ["P1"], ["P1"], { P1: 10 })] }, // played, started
    ],
    [],
  ];
  const players = buildPlayerIndex(chain, weeksList, {});
  const span = players.P1.spans[0];
  assert.strictEqual(span.gamesOwned, 4, "gamesOwned counts every week rostered, 0-score weeks included");
  assert.strictEqual(span.gamesStarted, 3, "gamesStarted counts every week started, regardless of the resulting score");
  assert.strictEqual(span.gamesPlayed, 2, "only the 2 non-zero-scoring weeks count as 'played' for PPG purposes");
  assert.strictEqual(span.ppg, 15, "(20+10)/2 = 15.0 ppg, not (20+10)/4 = 7.5");
});

test("buildPlayerIndex: totals.ppg also excludes 0.0-score weeks, aggregated correctly across multiple spans", () => {
  const chain = twoTeamChain();
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 20 })] }, // Alice, played
      { week: 2, matchups: [m(2, ["P1"], ["P1"], { P1: 0 })] }, // Bob, 0-score week
      { week: 3, matchups: [m(2, ["P1"], ["P1"], { P1: 30 })] }, // Bob, played
    ],
    [],
  ];
  const players = buildPlayerIndex(chain, weeksList, {});
  const t = players.P1.totals;
  assert.strictEqual(t.gamesOwned, 3);
  assert.strictEqual(t.gamesPlayed, 2, "2 of the 3 owned weeks actually had a non-zero score");
  assert.strictEqual(t.ppg, 25, "(20+30)/2 = 25.0 ppg, not /3");
});

test("buildPlayerIndex: a player who was owned every week but never once scored (gamesPlayed = 0) gets a safe 0 PPG, not a division-by-zero NaN", () => {
  const chain = twoTeamChain();
  const weeksList = [[{ week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 0 })] }], []];
  const players = buildPlayerIndex(chain, weeksList, {});
  assert.strictEqual(players.P1.spans[0].ppg, 0);
  assert.strictEqual(players.P1.totals.ppg, 0);
  assert.ok(!Number.isNaN(players.P1.totals.ppg));
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

test("ownerUsernameFor: uses the manager's Sleeper username, even when they've also set a custom team name", () => {
  const user = { display_name: "someuser123", metadata: { team_name: "The Wolfpack" } };
  assert.strictEqual(ownerUsernameFor(user, 1), "someuser123");
});

test("ownerUsernameFor: falls back to a generic 'Team N' label only when there's no claimed owner at all", () => {
  assert.strictEqual(ownerUsernameFor({ display_name: "someuser123" }, 1), "someuser123");
  assert.strictEqual(ownerUsernameFor(null, 4), "Team 4");
});

test("round1: rounds to exactly one decimal place", () => {
  assert.strictEqual(round1(12.345), 12.3);
  assert.strictEqual(round1(12.35), 12.4);
  assert.strictEqual(round1(10), 10);
});

test("computeFantasyPoints: sums stat count times scoring weight for every matching key", () => {
  const rawStats = { pass_yd: 250, pass_td: 2, pass_int: 1 };
  const scoringSettings = { pass_yd: 0.04, pass_td: 4, pass_int: -2 };
  // 250*0.04 + 2*4 + 1*-2 = 10 + 8 - 2 = 16
  assert.strictEqual(computeFantasyPoints(rawStats, scoringSettings), 16);
});

test("computeFantasyPoints: ignores a stat category the scoring settings don't mention, rather than crashing", () => {
  const rawStats = { pass_yd: 100, some_unrecognized_stat: 5 };
  const scoringSettings = { pass_yd: 0.04 };
  assert.strictEqual(computeFantasyPoints(rawStats, scoringSettings), 4);
});

test("computeFantasyPoints: a bonus stat (e.g. bonus_pass_yd_300) is handled by the same generic sum, no special-casing needed", () => {
  const rawStats = { pass_yd: 320, bonus_pass_yd_300: 1 };
  const scoringSettings = { pass_yd: 0.04, bonus_pass_yd_300: 5 };
  assert.strictEqual(computeFantasyPoints(rawStats, scoringSettings), 320 * 0.04 + 5);
});

test("computeFantasyPoints: returns 0, not NaN or a crash, for missing/empty inputs", () => {
  assert.strictEqual(computeFantasyPoints(null, { pass_yd: 0.04 }), 0);
  assert.strictEqual(computeFantasyPoints({ pass_yd: 100 }, null), 0);
  assert.strictEqual(computeFantasyPoints({}, {}), 0);
});

test("buildPlayerIndex: a genuine free-agent week (a real box score, but not on any roster in this league) is added to weekly with owned:0", () => {
  const chain = twoTeamChain();
  chain[0].league.scoring_settings = { pass_yd: 0.04, pass_td: 4 };
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 20 })] }, // owned week 1
      { week: 2, matchups: [m(1, [], [], {})] }, // week 2: P1 dropped, nobody owns them
    ],
    [],
  ];
  const weekStatsBySeasonWeek = new Map([
    ["2021:1", { P1: { pass_yd: 250, pass_td: 1 } }], // already owned this week -- should NOT duplicate as FA
    ["2021:2", { P1: { pass_yd: 300, pass_td: 3 } }], // free-agent week -- P1 played, nobody in the league had them
  ]);
  const players = buildPlayerIndex(chain, weeksList, {}, weekStatsBySeasonWeek);
  const weekly = players.P1.weekly;
  assert.strictEqual(weekly.length, 2, "week 1 (owned) and week 2 (FA) -- not a duplicate for week 1");
  assert.strictEqual(weekly[0].owned, 1);
  assert.strictEqual(weekly[1].week, 2);
  assert.strictEqual(weekly[1].owned, 0, "week 2 should be marked as an unowned (FA) week");
  assert.strictEqual(weekly[1].points, 24, "300*0.04 + 3*4 = 12 + 12 = 24.0, using this league's own scoring settings");
  assert.strictEqual(players.P1.totals.gamesFA, 1);
});

test("buildPlayerIndex: careerHigh considers free-agent weeks too, not just owned ones -- a player's best week is a fact about them, not about who (if anyone) owned them that week", () => {
  const chain = twoTeamChain();
  chain[0].league.scoring_settings = { pass_yd: 0.04, pass_td: 4 };
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 20 })] }, // owned week 1, 20 pts
      { week: 2, matchups: [m(1, [], [], {})] }, // week 2: unowned
    ],
    [],
  ];
  const weekStatsBySeasonWeek = new Map([
    ["2021:1", { P1: { pass_yd: 250, pass_td: 1 } }],
    ["2021:2", { P1: { pass_yd: 300, pass_td: 3 } }], // FA week, 24.0 pts -- higher than the owned week
  ]);
  const players = buildPlayerIndex(chain, weeksList, {}, weekStatsBySeasonWeek);
  const high = players.P1.careerHigh;
  assert.strictEqual(high.points, 24, "the FA week's 24.0 should win over the owned week's 20.0, even though nobody owned P1 that week");
  assert.strictEqual(high.week, 2);
  assert.strictEqual(high.owned, false);
  assert.strictEqual(high.ownerId, null, "no owner to attribute an FA week's career high to");
  assert.strictEqual(high.ownerName, null);
  assert.strictEqual(high.started, null, "'started' doesn't apply to a week nobody owned them");
});

test("buildPlayerIndex: careerHigh still correctly attributes an owned week when that's genuinely the best one, FA weeks included in the search", () => {
  const chain = twoTeamChain();
  chain[0].league.scoring_settings = { pass_yd: 0.04, pass_td: 4 };
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 40 })] }, // owned week 1, 40 pts -- the real best week
      { week: 2, matchups: [m(1, [], [], {})] },
    ],
    [],
  ];
  const weekStatsBySeasonWeek = new Map([
    ["2021:1", { P1: { pass_yd: 250, pass_td: 1 } }],
    ["2021:2", { P1: { pass_yd: 300, pass_td: 3 } }], // FA week, only 24.0 pts -- lower than the owned week
  ]);
  const players = buildPlayerIndex(chain, weeksList, {}, weekStatsBySeasonWeek);
  const high = players.P1.careerHigh;
  assert.strictEqual(high.points, 40);
  assert.strictEqual(high.owned, true);
  assert.strictEqual(high.ownerId, "userA");
  assert.strictEqual(high.ownerName, "Alice");
});

test("buildPlayerIndex: a week with no box score at all (bye, not yet in the league, etc.) is NOT counted as a free-agent week", () => {
  const chain = twoTeamChain();
  chain[0].league.scoring_settings = { pass_yd: 0.04 };
  const weeksList = [
    [
      { week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 20 })] },
      { week: 2, matchups: [m(1, [], [], {})] },
    ],
    [],
  ];
  const weekStatsBySeasonWeek = new Map([
    ["2021:1", { P1: { pass_yd: 250 } }],
    ["2021:2", {}], // no entry for P1 at all this week -- genuinely didn't play
  ]);
  const players = buildPlayerIndex(chain, weeksList, {}, weekStatsBySeasonWeek);
  assert.strictEqual(players.P1.weekly.length, 1, "only the owned week -- the byeless-box-score week should not appear at all");
  assert.strictEqual(players.P1.totals.gamesFA, 0);
});

test("buildPlayerIndex: FA weeks and owned weeks merge into one chronologically-sorted weekly array, even when FA weeks come first", () => {
  const chain = twoTeamChain();
  chain[0].league.scoring_settings = { pass_yd: 0.04 };
  chain[1].league.scoring_settings = { pass_yd: 0.04 };
  const weeksList = [
    [{ week: 1, matchups: [m(1, [], [], {})] }], // 2021 wk1: nobody owns P1
    [{ week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 15 })] }], // 2022 wk1: Alice owns P1
  ];
  const weekStatsBySeasonWeek = new Map([
    ["2021:1", { P1: { pass_yd: 200 } }], // FA week, chronologically FIRST
    ["2022:1", { P1: { pass_yd: 100 } }], // already owned this week -- ignored as FA
  ]);
  const players = buildPlayerIndex(chain, weeksList, {}, weekStatsBySeasonWeek);
  const weekly = players.P1.weekly;
  assert.strictEqual(weekly.length, 2);
  assert.strictEqual(weekly[0].season, "2021", "the FA week should come first chronologically, not just be appended at the end");
  assert.strictEqual(weekly[0].owned, 0);
  assert.strictEqual(weekly[1].season, "2022");
  assert.strictEqual(weekly[1].owned, 1);
});

test("buildPlayerIndex: without weekStatsBySeasonWeek at all (backward compatible), every entry is simply owned:1 and there are no FA weeks", () => {
  const chain = twoTeamChain();
  const weeksList = [[{ week: 1, matchups: [m(1, ["P1"], ["P1"], { P1: 20 })] }], []];
  const players = buildPlayerIndex(chain, weeksList, {}); // no 4th argument at all
  assert.strictEqual(players.P1.weekly[0].owned, 1);
  assert.strictEqual(players.P1.totals.gamesFA, 0);
});

