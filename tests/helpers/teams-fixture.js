/*
  A small made-up league for the Teams tests: the same four owners and seasons
  as the History fixture (see history-fixture.js), with the extra numbers the
  Teams page needs on each manager (points, all-play records, luck, draft picks,
  lineups, head-to-head).

    alice  2019 ESPN #2 title, 2020 #2 title, 2021 #1 title, 2022 live #2
    bob    2019 #1 2nd, 2020 #1 2nd, 2021 #2 2nd, 2022 live #3
    cara   2019 #3 3rd, 2020 #3 3rd, 2021 #3 3rd, 2022 live #4
    dan    never a medal, 2022 live #1
*/
const base = require("./history-fixture.js");

function season(year, rank, w, l, o = {}) {
  const games = w + l;
  const s = base.managerSeason(year, rank, w, l, o);
  return Object.assign(s, {
    fpts: o.fpts != null ? o.fpts : games * 90,
    fptsAgainst: o.against != null ? o.against : games * 85,
    overallWins: o.ow != null ? o.ow : w * 3,
    overallLosses: o.ol != null ? o.ol : l * 3,
    overallTies: 0,
    luckPct: o.luck !== undefined ? o.luck : 0,
    draftPicks: o.picks || [],
    startingLineup: o.lineup || null,
  });
}

// An ESPN-era season as ManualHistory.computeManagerStats shapes it: no isSeasonComplete, no all-play.
function espnSeason(year, rank, w, l, o = {}) {
  return {
    season: year,
    rank,
    wins: w,
    losses: l,
    ties: 0,
    fpts: o.fpts != null ? o.fpts : 100,
    fptsAgainst: o.against != null ? o.against : 90,
    overallWins: w,
    overallLosses: l,
    overallTies: 0,
    isChampion: !!o.champ,
    isRunnerUp: !!o.second,
    isThirdPlace: !!o.third,
    luckPct: null,
    draftPicks: [],
    startingLineup: null,
  };
}

const pick = (round, inRound, player, grade, vbd, points) => ({ round, pickInRound: inRound, player, playerId: "p-" + player.toLowerCase().replace(/\W+/g, ""), position: "RB", points, vbd, grade });

const lineup = {
  weeksCounted: 14,
  slots: [
    { slot: "QB", player: "Quinn", playerId: "pq", acquisition: "Draft", starts: 14 },
    { slot: "RB1", player: "Rudy", playerId: "pr", acquisition: "Waivers", starts: 7 },
    { slot: "WR1", player: "Wes", playerId: "pw", acquisition: "Draft", starts: 10 },
    { slot: "K", player: null, playerId: null, acquisition: null, starts: 0 },
  ],
};

// The managers with the ESPN seasons already folded in, the way teams.js leaves them.
function fullManagers() {
  const ms = base.managers();
  const by = (name) => ms.find((m) => m.username === name);

  const alice = by("alice");
  alice.byes = 2;
  alice.championships = 3;
  alice.runnerUps = 0;
  alice.mostRostered = [
    { playerId: "p1", name: "Player One", weeksRostered: 40 },
    { playerId: "p2", name: "Player Two", weeksRostered: 10 },
  ];
  alice.seasons = [
    espnSeason(2019, 2, 8, 3, { champ: true, fpts: 880, against: 800 }),
    season(2020, 2, 2, 1, { champ: true, pw: 2, fpts: 300, against: 280, ow: 18, ol: 18, luck: 16.7 }),
    season(2021, 1, 3, 0, {
      champ: true,
      pw: 2,
      fpts: 330,
      against: 240,
      ow: 33,
      ol: 3,
      luck: 8.3,
      lineup,
      picks: [pick(1, 1, "Ann", "S", 80, 300), pick(1, 2, "Bo", "A", 40, 200), pick(2, 1, "Cy", "C", -2, 90), pick(2, 2, "Di", "F", -40, 10)],
    }),
    season(2022, 2, 1, 1, { complete: false, fpts: 200, against: 190, ow: 4, ol: 2, luck: -16.7, picks: [pick(1, 1, "Ed", "A", 12, 55), pick(1, 2, "Flo", "S", 30, 70)] }),
  ];
  alice.headToHead = [
    { opponentUserId: "u2", opponentName: "bob", wins: 6, losses: 2, ties: 0 },
    { opponentUserId: "u3", opponentName: "cara", wins: 3, losses: 5, ties: 0 },
    { opponentUserId: "u4", opponentName: "dan", wins: 4, losses: 0, ties: 0 },
    { opponentUserId: "u5", opponentName: "newbie", wins: 1, losses: 0, ties: 0 },
    { opponentUserId: "u6", opponentName: "gone", wins: 2, losses: 2, ties: 0 },
    { opponentUserId: "u7", opponentName: "erin", wins: 7, losses: 1, ties: 0 },
  ];
  alice.headToHeadPlayoffs = [
    { opponentUserId: "u2", opponentName: "bob", wins: 1, losses: 1, ties: 0 },
    { opponentUserId: "u3", opponentName: "cara", wins: 3, losses: 0, ties: 0 },
    { opponentUserId: null, opponentName: "Liam", wins: 1, losses: 0, ties: 0 },
    { opponentUserId: null, opponentName: "Chris", wins: 1, losses: 0, ties: 0 },
  ];

  const bob = by("bob");
  bob.championships = 0;
  bob.runnerUps = 3;
  bob.byes = 1;
  bob.mostRostered = [];
  bob.seasons = [espnSeason(2019, 1, 9, 2, { second: true }), season(2020, 1, 3, 0, { second: true, pw: 1, pl: 1 }), season(2021, 2, 2, 1, { second: true, pw: 1, pl: 1 }), season(2022, 3, 1, 1, { complete: false })];
  bob.headToHead = [];
  bob.headToHeadPlayoffs = [];

  [["cara", [3, 3, 4]], ["dan", [4, 4, 1]]].forEach(([name]) => {
    const m = by(name);
    m.byes = 0;
    m.mostRostered = [];
    m.headToHead = [];
    m.headToHeadPlayoffs = [];
  });
  by("cara").seasons = [espnSeason(2019, 3, 6, 5, { third: true }), season(2020, 3, 1, 2, { third: true, pw: 1, pl: 1 }), season(2021, 3, 1, 2, { third: true, pw: 1, pl: 1 }), season(2022, 4, 0, 2, { complete: false })];
  by("dan").seasons = [espnSeason(2019, 4, 3, 8), season(2020, 4, 0, 3), season(2021, 4, 0, 3), season(2022, 1, 2, 0, { complete: false })];
  by("newbie").byes = 0;
  by("gone").byes = 0;
  return ms;
}

module.exports = { fullManagers, season, espnSeason, pick, lineup, base };
