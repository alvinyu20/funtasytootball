/*
  A small hand-made league for the Draft tests: the shape DeepHistory.computeStats() leaves in
  stats.managers[].seasons[].draftPicks, so the page code runs on it as it is.

    2024  complete, four teams, two rounds (one kicker held at grade B, one keeper, one pick who never scored)
    2025  complete, three teams (dana has left), two rounds
    2026  still being played: points, games and injury weeks, no grades

  Every number is chosen so the answers can be worked out by hand (see the comments on the picks).
*/
const { runInLoadedContext } = require("./site-env.js");

// ---- the league -------------------------------------------------------------------------------------------

const USERS = { u1: "alvin", u2: "beth", u3: "carl", u4: "dana" };

// One pick the way DeepHistory.computeStats stores it, plus `owner` (moved onto the manager by stats()).
function pick(o) {
  return { pickInRound: 1, playerId: `p${o.pickNo}`, position: "WR", points: 100, vbd: null, gradingVbd: null, expectedVbd: null, z: null, grade: null, gp: 15, starts: 12, injWeeks: null, gamesPossible: 17, posDraftRank: null, posFinishRank: null, isKeeper: false, ...o };
}

function stats(picksBySeason, meta, model = { intercept: 100, slope: -10, stdDev: 40 }) {
  const managers = Object.keys(USERS)
    .map((id) => ({ userId: id, username: USERS[id], teamName: `Team ${USERS[id]}`, seasons: [] }))
    .map((m) => {
      Object.entries(picksBySeason).forEach(([season, picks]) => {
        const mine = picks.filter((p) => p.owner === m.userId).map(({ owner, ...entry }) => entry);
        if (mine.length) m.seasons.push({ season, draftPicks: mine });
      });
      return m;
    })
    .filter((m) => m.seasons.length);
  return { managers, draftSeasons: meta, draftGradeModel: model };
}

// 2024: four teams, two rounds (a snake). Every number is picked so the answers are round ones.
//   owner pick  player        pos   vbd    typical z     grade
const D2024 = [
  pick({ owner: "u1", pickNo: 1, round: 1, pickInRound: 1, player: "Ann Alpha", position: "RB", gradingVbd: 100.5, vbd: 140, expectedVbd: 60.4, z: 1.0, grade: "A", points: 250, posDraftRank: 1, posFinishRank: 1 }), //  +101 -60 = +41
  pick({ owner: "u2", pickNo: 2, round: 1, pickInRound: 2, player: "Bo Beta Jr.", gradingVbd: 50, expectedVbd: 55.5, z: -0.1, grade: "C", points: 190 }), //                      50 -56 = -6
  pick({ owner: "u3", pickNo: 3, round: 1, pickInRound: 3, player: "Cy Gamma", position: "QB", gradingVbd: 130, expectedVbd: 50, z: 2.0, grade: "S", points: 320 }), //              130 -50 = +80
  pick({ owner: "u4", pickNo: 4, round: 1, pickInRound: 4, player: "Di Delta", position: "TE", gradingVbd: -20.5, expectedVbd: 45, z: -2.0, grade: "F", points: 80 }), //            -21 -45 = -66
  pick({ owner: "u4", pickNo: 5, round: 2, pickInRound: 1, player: "Ed Epsilon", position: "K", gradingVbd: 90, expectedVbd: 20, z: 2.0, grade: "B", points: 150, isKeeper: true }), //   90 -20 = +70 (grade held down to B)
  pick({ owner: "u3", pickNo: 6, round: 2, pickInRound: 2, player: "Fay Zeta", gradingVbd: 40, expectedVbd: 40, z: 0.1, grade: "B", points: 160 }), //                               40 -40 = 0
  pick({ owner: "u2", pickNo: 7, round: 2, pickInRound: 3, player: "Gus Eta", position: "RB", gradingVbd: 70, expectedVbd: 35, z: 1.0, grade: "A", points: 200 }), //                   70 -35 = +35
  pick({ owner: "u1", pickNo: 8, round: 2, pickInRound: 4, player: "Hal Theta", gradingVbd: null, vbd: null, expectedVbd: 30, grade: "F", points: 0, gp: 0, starts: 0 }), //          0 -30 = -30 (never scored)
];

// 2025: dana left, so three teams, two rounds.
const D2025 = [
  pick({ owner: "u1", pickNo: 1, round: 1, pickInRound: 1, player: "Ann Alpha", position: "RB", gradingVbd: 20, expectedVbd: 60, z: -1, grade: "D", points: 120 }), //            -40
  pick({ owner: "u2", pickNo: 2, round: 1, pickInRound: 2, player: "Bo Beta Jr.", gradingVbd: 90, expectedVbd: 55, z: 0.9, grade: "A", points: 230 }), //                       +35
  pick({ owner: "u3", pickNo: 3, round: 1, pickInRound: 3, player: "Cy Gamma", position: "QB", gradingVbd: 200, expectedVbd: 50, z: 3.0, grade: "S", points: 400 }), //            +150
  pick({ owner: "u3", pickNo: 4, round: 2, pickInRound: 1, player: "Di Delta", position: "TE", gradingVbd: -80, expectedVbd: 45, z: -3.0, grade: "F", points: 60 }), //           -125
  pick({ owner: "u2", pickNo: 5, round: 2, pickInRound: 2, player: "Gus Eta", position: "RB", gradingVbd: 40, expectedVbd: 35, z: 0.1, grade: "B", points: 170 }), //               +5
  pick({ owner: "u1", pickNo: 6, round: 2, pickInRound: 3, player: "Hal Theta", gradingVbd: 60, expectedVbd: 30, z: 0.8, grade: "A", points: 190 }), //                           +30
];

const META = { 2024: { season: 2024, complete: true, weeksPlayed: 17 }, 2025: { season: 2025, complete: true, weeksPlayed: 17 }, 2026: { season: 2026, complete: false, weeksPlayed: 6 } };

// 2026, still being played: rounds are spread out so the "after round 3" and "rounds 1 to 8" cuts are testable.
const D2026 = [
  pick({ owner: "u1", pickNo: 1, round: 1, pickInRound: 1, player: "Ann Alpha", position: "RB", points: 120, gp: 6, starts: 6, injWeeks: 0, gamesPossible: 6 }), //          20.0 a game: hot
  pick({ owner: "u2", pickNo: 2, round: 1, pickInRound: 2, player: "Bo Beta Jr.", points: 60, gp: 6, starts: 6, injWeeks: 4, gamesPossible: 6 }), //                       10.0, early and hurt
  pick({ owner: "u1", pickNo: 13, round: 4, pickInRound: 1, player: "Cy Gamma", position: "QB", points: 100, gp: 4, starts: 4, injWeeks: 1, gamesPossible: 6 }), //            25.0, round 4: a hot start
  pick({ owner: "u2", pickNo: 14, round: 4, pickInRound: 2, player: "Di Delta", position: "TE", points: 20, gp: 3, starts: 2, injWeeks: 3, gamesPossible: 6 }), //             6.7, hurt
  pick({ owner: "u1", pickNo: 25, round: 5, pickInRound: 1, player: "Ed Epsilon", position: "K", points: 90, gp: 4, starts: 4, injWeeks: 0, gamesPossible: 6 }), //            22.5
  pick({ owner: "u2", pickNo: 26, round: 9, pickInRound: 2, player: "Fay Zeta", points: 40, gp: 3, starts: 3, injWeeks: 5, gamesPossible: 6 }), //                          13.3, round 9: not "early"
  pick({ owner: "u2", pickNo: 27, round: 6, pickInRound: 3, player: "Gus Eta", position: "RB", points: 8, gp: 1, starts: 0, injWeeks: 0, gamesPossible: 6 }), //                8.0 in one game: too few to count
];

const league = () => stats({ 2024: D2024, 2025: D2025, 2026: D2026 }, META);

function draftOf(c, season) {
  c.__S__ = league();
  runInLoadedContext(c, `var __D__ = DraftData.buildDraft(__S__, ${season});`);
  return c;
}

module.exports = { USERS, pick, stats, D2024, D2025, D2026, META, league, draftOf };
