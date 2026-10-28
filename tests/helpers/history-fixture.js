/*
  A small, made-up league for the History tests: four owners, three Sleeper
  seasons (2020 and 2021 finished, 2022 still being played, two playoff spots)
  and one ESPN season (2019), so every rule can be checked by hand.

    2019 (ESPN)   bob #1 (silver), alice #2 (gold), cara #3 (bronze), dan #4; zed (ESPN only) #5
    2020 (Sleeper) bob 3-0 #1, alice 2-1 #2, cara 1-2 #3, dan 0-3 #4  -> alice champion, bob runner-up, cara third
    2021 (Sleeper) alice 3-0 #1, bob 2-1 #2, cara 1-2 #3, dan 0-3 #4  -> alice champion, bob runner-up, cara third
    2022 (Sleeper, live) dan 2-0, alice 1-1, bob 1-1 (fewer points), cara 0-2

  alice therefore wins three in a row (2019-2021).
*/

const USERS = {
  alice: { id: "u1", team: "Team Alice" },
  bob: { id: "u2", team: null },
  cara: { id: "u3", team: "Cara Co" },
  dan: { id: "u4", team: "dan" }, // a team name equal to the username is not a real team name
};
const ROSTER = { alice: 1, bob: 2, cara: 3, dan: 4 };

// rows: [{ who, w, l, t, pts }]; champ / second / third are names
function sleeperSeason(year, rows, opts = {}) {
  const { champ, second, third, complete = true, playoffTeams = 2 } = opts;
  const bracket = [];
  if (champ) bracket.push({ r: 3, m: 7, p: 1, t1: ROSTER[champ], t2: ROSTER[second], w: ROSTER[champ], l: ROSTER[second] });
  if (third) bracket.push({ r: 3, m: 6, p: 3, t1: ROSTER[third], t2: 9, w: ROSTER[third], l: 9 });
  return {
    league: { season: String(year), status: complete ? "complete" : "in_season", settings: { playoff_teams: playoffTeams } },
    rosters: rows.map((r) => ({
      roster_id: ROSTER[r.who],
      owner_id: USERS[r.who].id,
      settings: { wins: r.w, losses: r.l, ties: r.t || 0, fpts: Math.floor(r.pts), fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 },
    })),
    users: rows.map((r) => ({
      user_id: USERS[r.who].id,
      display_name: r.who,
      metadata: USERS[r.who].team ? { team_name: USERS[r.who].team } : {},
    })),
    bracket,
  };
}

function chain() {
  return [
    sleeperSeason(
      2020,
      [
        { who: "alice", w: 2, l: 1, pts: 300 },
        { who: "bob", w: 3, l: 0, pts: 310 },
        { who: "cara", w: 1, l: 2, pts: 250 },
        { who: "dan", w: 0, l: 3, pts: 200 },
      ],
      { champ: "alice", second: "bob", third: "cara" }
    ),
    sleeperSeason(
      2021,
      [
        { who: "alice", w: 3, l: 0, pts: 320 },
        { who: "bob", w: 2, l: 1, pts: 300 },
        { who: "cara", w: 1, l: 2, pts: 250 },
        { who: "dan", w: 0, l: 3, pts: 200 },
      ],
      { champ: "alice", second: "bob", third: "cara" }
    ),
    sleeperSeason(
      2022,
      [
        { who: "alice", w: 1, l: 1, pts: 200 },
        { who: "bob", w: 1, l: 1, pts: 190 },
        { who: "cara", w: 0, l: 2, pts: 150 },
        { who: "dan", w: 2, l: 0, pts: 230 },
      ],
      { complete: false }
    ),
  ];
}

function manual() {
  const row = (team, standing, w, l, o = {}) => ({
    team,
    standing,
    draftPick: standing,
    wins: w,
    losses: l,
    ties: 0,
    pointsFor: 100,
    pointsAgainst: 90,
    playoffAppearance: !!o.playoff,
    playoffBye: false,
    playoffWins: o.pw || 0,
    playoffLosses: o.pl || 0,
    playoffPoints: 0,
    medal: o.medal || null,
  });
  return {
    seasons: [
      {
        year: 2019,
        champion: "Alice", // capitalised on purpose: owners match across eras whatever the case
        standings: [
          row("bob", 1, 9, 2, { playoff: true, pw: 1, pl: 1, medal: "silver" }),
          row("Alice", 2, 8, 3, { playoff: true, pw: 2, pl: 0, medal: "gold" }),
          row("cara", 3, 6, 5, { playoff: true, pw: 1, pl: 1, medal: "bronze" }),
          row("dan", 4, 3, 8),
          row("zed", 5, 1, 10),
        ],
        bracket: { finals: { winner: "Alice", loser: "bob" }, thirdPlace: { winner: "cara", loser: "dan" } },
      },
    ],
  };
}

// The per-season shape DeepHistory.computeStats() gives each manager.
function managerSeason(season, rank, w, l, o = {}) {
  return {
    season: String(season),
    rank,
    wins: w,
    losses: l,
    ties: 0,
    regularSeasonWins: o.regW != null ? o.regW : w,
    regularSeasonLosses: o.regL != null ? o.regL : l,
    regularSeasonTies: 0,
    playoffWins: o.pw || 0,
    playoffLosses: o.pl || 0,
    playoffTies: 0,
    isChampion: !!o.champ,
    isRunnerUp: !!o.second,
    isThirdPlace: !!o.third,
    isPlayoffAppearance: !!o.playoff || !!o.champ || !!o.second || !!o.third,
    isSeasonComplete: o.complete !== false,
  };
}

function managers() {
  return [
    {
      userId: "u1",
      username: "alice",
      teamName: "Team Alice",
      seasons: [
        managerSeason(2020, 2, 2, 1, { champ: true, pw: 2 }),
        managerSeason(2021, 1, 3, 0, { champ: true, pw: 2 }),
        managerSeason(2022, 2, 1, 1, { complete: false }),
      ],
    },
    {
      userId: "u2",
      username: "bob",
      teamName: "bob",
      seasons: [
        managerSeason(2020, 1, 3, 0, { second: true, pw: 1, pl: 1 }),
        managerSeason(2021, 2, 2, 1, { second: true, pw: 1, pl: 1 }),
        managerSeason(2022, 3, 1, 1, { complete: false }),
      ],
    },
    {
      userId: "u3",
      username: "cara",
      teamName: "Cara Co",
      seasons: [
        managerSeason(2020, 3, 1, 2, { third: true, pw: 1, pl: 1 }),
        managerSeason(2021, 3, 1, 2, { third: true, pw: 1, pl: 1 }),
        managerSeason(2022, 4, 0, 2, { complete: false }),
      ],
    },
    {
      userId: "u4",
      username: "dan",
      teamName: "dan",
      seasons: [managerSeason(2020, 4, 0, 3), managerSeason(2021, 4, 0, 3), managerSeason(2022, 1, 2, 0, { complete: false })],
    },
    {
      // first season is the one in progress
      userId: "u5",
      username: "newbie",
      teamName: "newbie",
      seasons: [managerSeason(2022, 5, 0, 2, { complete: false })],
    },
    {
      // left after 2020
      userId: "u6",
      username: "gone",
      teamName: "gone",
      seasons: [managerSeason(2020, 5, 0, 3)],
    },
  ];
}

module.exports = { sleeperSeason, chain, manual, managers, managerSeason, USERS, ROSTER };
