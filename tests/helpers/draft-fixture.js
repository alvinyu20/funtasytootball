/*
  A small hand-made league for the Draft tests: the shape DeepHistory.computeStats() leaves in
  stats.managers[].seasons[].draftPicks once Metrics.applyDraftGrades has run over it, so the page code
  runs on it as it is.

    2024  complete, four teams, two rounds (one kicker, one keeper, one pick who never scored)
    2025  complete, three teams (dana has left), two rounds, one S+
    2026  still being played: points, games and injury weeks, no grades

  Every number is chosen so the answers can be worked out by hand (see the comments on the picks).
*/
const { runInLoadedContext } = require("./site-env.js");

// ---- the league -------------------------------------------------------------------------------------------

const USERS = { u1: "alvin", u2: "beth", u3: "carl", u4: "dana" };

/*
  One pick the way DeepHistory.computeStats stores it (player, round, points ...) with what Metrics adds:
  value, typical and valueOverSlot (value - typical, unrounded), grade, ungraded, gamesPlayed, startedWeeks,
  injuredWeeks and the position ranks. Give a value and a typical and the pick counts as graded; give neither
  and it is ungraded, as every pick in a season still being played is. `owner` is moved onto the manager by stats().
*/
function pick(o) {
  const e = { pickInRound: 1, playerId: `p${o.pickNo}`, position: "WR", points: 100, grade: null, ungraded: true, value: null, typical: null, valueOverSlot: null, gamesPlayed: 15, startedWeeks: 12, heldWeeks: 15, injuredWeeks: 0, positionDraftRank: null, positionFinishRank: null, isKeeper: false, ...o };
  if (e.value != null && e.typical != null) {
    e.ungraded = false;
    if (o.valueOverSlot == null) e.valueOverSlot = e.value - e.typical;
  }
  return e;
}

function stats(picksBySeason, meta) {
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
  return { managers, draftSeasons: meta };
}

// 2024: four teams, two rounds (a snake). Every number is picked so the answers are round ones.
//   owner pick  player        pos   value   typical  vs slot  grade
const D2024 = [
  pick({ owner: "u1", pickNo: 1, round: 1, pickInRound: 1, player: "Ann Alpha", position: "RB", value: 100.4, typical: 59.6, grade: "A", points: 250, positionDraftRank: 1, positionFinishRank: 1 }), // 100 and 60 on the page, but +40.8 = +41 (not 100 - 60)
  pick({ owner: "u2", pickNo: 2, round: 1, pickInRound: 2, player: "Bo Beta Jr.", value: 50, typical: 55.5, grade: "C", points: 190 }), //                                       -5.5 = -6 (rounds away from zero)
  pick({ owner: "u3", pickNo: 3, round: 1, pickInRound: 3, player: "Cy Gamma", position: "QB", value: 130, typical: 50, grade: "S", points: 320 }), //                           +80
  pick({ owner: "u4", pickNo: 4, round: 1, pickInRound: 4, player: "Di Delta", position: "TE", value: 4, typical: 70, grade: "F", points: 80 }), //                                -66
  pick({ owner: "u4", pickNo: 5, round: 2, pickInRound: 1, player: "Ed Epsilon", position: "K", value: 90, typical: 20, grade: "B", points: 150, isKeeper: true }), //          +70 (a kicker: held at B, never a steal)
  pick({ owner: "u3", pickNo: 6, round: 2, pickInRound: 2, player: "Fay Zeta", value: 40, typical: 40, grade: "B", points: 160 }), //                                              0
  pick({ owner: "u2", pickNo: 7, round: 2, pickInRound: 3, player: "Gus Eta", position: "RB", value: 70, typical: 35, grade: "A", points: 200 }), //                              +35
  pick({ owner: "u1", pickNo: 8, round: 2, pickInRound: 4, player: "Hal Theta", value: 0, typical: 30, grade: "F", points: 0, gamesPlayed: 0, startedWeeks: 0 }), //              -30 (never scored: worth 0, and graded)
];

// 2025: dana left, so three teams, two rounds.
const D2025 = [
  pick({ owner: "u1", pickNo: 1, round: 1, pickInRound: 1, player: "Ann Alpha", position: "RB", value: 20, typical: 60, grade: "D", points: 120 }), //                 -40
  pick({ owner: "u2", pickNo: 2, round: 1, pickInRound: 2, player: "Bo Beta Jr.", value: 90, typical: 55, grade: "A", points: 230 }), //                              +35
  pick({ owner: "u3", pickNo: 3, round: 1, pickInRound: 3, player: "Cy Gamma", position: "QB", value: 200, typical: 50, grade: "S+", points: 400 }), //                +150 (the one S+)
  pick({ owner: "u3", pickNo: 4, round: 2, pickInRound: 1, player: "Di Delta", position: "TE", value: 0, typical: 125, grade: "F", points: 60 }), //                  -125
  pick({ owner: "u2", pickNo: 5, round: 2, pickInRound: 2, player: "Gus Eta", position: "RB", value: 40, typical: 35, grade: "B", points: 170 }), //                   +5
  pick({ owner: "u1", pickNo: 6, round: 2, pickInRound: 3, player: "Hal Theta", value: 60, typical: 30, grade: "A", points: 190 }), //                                +30
];

// What seasonFacts() works out from Metrics: injuryKnown is false where the season has no injury data on record.
const META = {
  2024: { season: "2024", complete: true, weeksPlayed: 17, injuryKnown: false },
  2025: { season: "2025", complete: true, weeksPlayed: 17, injuryKnown: false },
  2026: { season: "2026", complete: false, weeksPlayed: 6, injuryKnown: true },
};

// 2026, still being played: rounds are spread out so the "after round 3" and "rounds 1 to 8" cuts are testable.
// (injuredWeeks, gamesPlayed and startedWeeks are Metrics' names; there is no grade or value yet.)
const D2026 = [
  pick({ owner: "u1", pickNo: 1, round: 1, pickInRound: 1, player: "Ann Alpha", position: "RB", points: 120, gamesPlayed: 6, startedWeeks: 6, injuredWeeks: 0 }), //          20.0 a game: hot
  pick({ owner: "u2", pickNo: 2, round: 1, pickInRound: 2, player: "Bo Beta Jr.", points: 60, gamesPlayed: 6, startedWeeks: 6, injuredWeeks: 4 }), //                       10.0, early and hurt
  pick({ owner: "u1", pickNo: 13, round: 4, pickInRound: 1, player: "Cy Gamma", position: "QB", points: 100, gamesPlayed: 4, startedWeeks: 4, injuredWeeks: 1 }), //            25.0, round 4: a hot start
  pick({ owner: "u2", pickNo: 14, round: 4, pickInRound: 2, player: "Di Delta", position: "TE", points: 20, gamesPlayed: 3, startedWeeks: 2, injuredWeeks: 3 }), //             6.7, hurt
  pick({ owner: "u1", pickNo: 25, round: 5, pickInRound: 1, player: "Ed Epsilon", position: "K", points: 90, gamesPlayed: 4, startedWeeks: 4, injuredWeeks: 0 }), //            22.5
  pick({ owner: "u2", pickNo: 26, round: 9, pickInRound: 2, player: "Fay Zeta", points: 40, gamesPlayed: 3, startedWeeks: 3, injuredWeeks: 5 }), //                          13.3, round 9: not "early"
  pick({ owner: "u2", pickNo: 27, round: 6, pickInRound: 3, player: "Gus Eta", position: "RB", points: 8, gamesPlayed: 1, startedWeeks: 0, injuredWeeks: 0 }), //                8.0 in one game: too few to count
];

const league = () => stats({ 2024: D2024, 2025: D2025, 2026: D2026 }, META);

function draftOf(c, season) {
  c.__S__ = league();
  runInLoadedContext(c, `var __D__ = DraftData.buildDraft(__S__, ${season});`);
  return c;
}

module.exports = { USERS, pick, stats, D2024, D2025, D2026, META, league, draftOf };
