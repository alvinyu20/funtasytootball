/*
  A tiny two-season league, small enough to check Record Book answers by
  hand, shared by the Record Book engine and Records page tests.

  Four managers: a (u1), b (u2), c (u3), d (u4); one QB each ("q1".."q4",
  whose weekly points are the team's score). Playoffs start in week 4.

  2022 — complete. Three regular-season weeks, then a 4-team bracket:
    W1  a 100 - b 90    c 110 - d 80
    W2  a 120 - c 100   b 95  - d 85
    W3  a 105 - d 90    b 130 - c 70
    Records: a 3-0, b 2-1, c 1-2, d 0-3.
    Weekly medians: W1 95, W2 97.5, W3 97.5 -> median wins a3 b1 c2 d0,
    so luck (wins minus median wins) is a 0, b +1, c -1, d 0.
    Playoffs: wk4 a 130-d 100 and c 95-b 90; wk5 final a 120-c 100
    (a champion, c runner-up) and third-place b 80-d 70.

  2023 — in progress. Two regular-season weeks only (playoffs start wk 4):
    W1  a 80 - b 100    c 90 - d 120
    W2  a 70 - c 85     b 110 - d 60
    Records so far: a 0-2, b 2-0, c 1-1, d 1-1.
*/

const NAMES = { u1: "a", u2: "b", u3: "c", u4: "d" };

function row(rosterId, matchupId, points) {
  const q = "q" + rosterId;
  return { roster_id: rosterId, matchup_id: matchupId, points, players: [q], starters: [q], players_points: { [q]: points } };
}

function week(n, pairs) {
  const matchups = [];
  pairs.forEach(([r1, p1, r2, p2], i) => {
    matchups.push(row(r1, i + 1, p1), row(r2, i + 1, p2));
  });
  return { week: n, matchups };
}

function seasonEntry(season, leagueId, status, bracket) {
  return {
    league: {
      season: String(season),
      league_id: leagueId,
      status,
      name: "Fixture League",
      roster_positions: ["QB"],
      settings: { playoff_week_start: 4, playoff_teams: 4 },
    },
    rosters: [1, 2, 3, 4].map((id) => ({ roster_id: id, owner_id: "u" + id, settings: {} })),
    users: [1, 2, 3, 4].map((id) => ({ user_id: "u" + id, display_name: NAMES["u" + id] })),
    bracket,
  };
}

const BRACKET_2022 = [
  { r: 1, m: 1, t1: 1, t2: 4, w: 1, l: 4 },
  { r: 1, m: 2, t1: 2, t2: 3, w: 3, l: 2 },
  { r: 2, m: 3, t1_from: { w: 1 }, t2_from: { w: 2 }, w: 1, l: 3, p: 1 },
  { r: 2, m: 4, t1_from: { l: 1 }, t2_from: { l: 2 }, w: 2, l: 4, p: 3 },
];

function fixtureInput() {
  return {
    seasonChain: [seasonEntry(2022, "L22", "complete", BRACKET_2022), seasonEntry(2023, "L23", "in_season", [])],
    deepSeasons: [
      {
        weeks: [
          week(1, [[1, 100, 2, 90], [3, 110, 4, 80]]),
          week(2, [[1, 120, 3, 100], [2, 95, 4, 85]]),
          week(3, [[1, 105, 4, 90], [2, 130, 3, 70]]),
          week(4, [[1, 130, 4, 100], [3, 95, 2, 90]]),
          week(5, [[1, 120, 3, 100], [2, 80, 4, 70]]),
        ],
        transactions: [],
        draft: null,
      },
      {
        weeks: [week(1, [[1, 80, 2, 100], [3, 90, 4, 120]]), week(2, [[1, 70, 3, 85], [2, 110, 4, 60]])],
        transactions: [],
        draft: null,
      },
    ],
    playerDirectory: {
      q1: { position: "QB", first_name: "Quinn", last_name: "One" },
      q2: { position: "QB", first_name: "Quinn", last_name: "Two" },
      q3: { position: "QB", first_name: "Quinn", last_name: "Three" },
      q4: { position: "QB", first_name: "Quinn", last_name: "Four" },
    },
    stats: null,
    rawStats: null,
  };
}

// One pre-Sleeper (ESPN) season: totals only, with an Overall Record on file for a and b.
// a: 9-4 (69.2%) against a 70-47 Overall Record (59.8%) -> luck +9.4%.
// b: 7-6 (53.8%) against a 60-57 Overall Record (51.3%) -> luck +2.6%.
// e is only ever in the ESPN era (a departed manager with no Sleeper account).
function fixtureManual() {
  const row = (team, wins, losses, pointsFor, extra) => ({
    team, wins, losses, ties: 0, pointsFor, pointsAgainst: 1300, playoffAppearance: true, playoffBye: false,
    playoffWins: 0, playoffLosses: 0, playoffPoints: 0, medal: null, ...extra,
  });
  return {
    seasons: [
      {
        year: 2019,
        standings: [
          row("a", 9, 4, 1500, { medal: "gold", playoffWins: 2, overallRecord: { wins: 70, losses: 47, ties: 0 } }),
          row("b", 7, 6, 1400, { overallRecord: { wins: 60, losses: 57, ties: 0 } }),
          row("e", 3, 10, 1100, { playoffAppearance: false }),
        ],
      },
    ],
  };
}

// Weekly Power Rankings in the shape of data/power-rank-csv-history.json.
//  2019 (pre-Sleeper, ranks only): a is #1 all five weeks; in week 5 b and "ghost" (a name that
//        matches no manager anywhere) tie for last, so both are averaged to 2.5 and both count as last.
//  2022 (three weeks): ranks a [1,1,2] b [2,3,1] c [3,2,4] d [4,4,3];
//        scores a [5.0,5.5,6.0] b [6.0,7.0,4.5] c [7.5,6.5,9.0] d [9.0,9.5,8.0] (lower is better);
//        odds a [60,99.6,100] b [50,80,99.5] c [40,99.9,20] d [30,40,50] -> a clinches in week 2,
//        b in week 3, c never (it ends at 20%) and d never.
//  2023 (in progress): ranks a [2,1] b [1,2] c [3,3] d [4,4]; scores a [3.0,3.5] ...
function fixturePowerRanks() {
  const series = (weekly) => ({ pre: null, weekly });
  return {
    seasons: {
      2019: {
        ranks: {
          a: series([1, 1, 1, 1, 1]),
          b: series([2, 2, 2, 2, 2.5]),
          ghost: series([3, 3, 3, 3, 2.5]),
        },
      },
      2022: {
        ranks: { a: series([1, 1, 2]), b: series([2, 3, 1]), c: series([3, 2, 4]), d: series([4, 4, 3]) },
        scores: { a: series([5.0, 5.5, 6.0]), b: series([6.0, 7.0, 4.5]), c: series([7.5, 6.5, 9.0]), d: series([9.0, 9.5, 8.0]) },
        playoffOdds: { a: [60, 99.6, 100], b: [50, 80, 99.5], c: [40, 99.9, 20], d: [30, 40, 50] },
      },
      2023: {
        ranks: { a: series([2, 1]), b: series([1, 2]), c: series([3, 3]), d: series([4, 4]) },
        scores: { a: series([3.0, 3.5]), b: series([4.0, 4.5]), c: series([5.0, 5.5]), d: series([6.0, 6.5]) },
        playoffOdds: { a: [99.9, 100], b: [99.8, 100], c: [20, 10], d: [5, 1] },
      },
    },
  };
}

module.exports = { fixtureInput, fixtureManual, fixturePowerRanks, NAMES };
