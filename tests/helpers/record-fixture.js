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

module.exports = { fixtureInput, NAMES };
