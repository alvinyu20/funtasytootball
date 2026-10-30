/*
  What DeepHistory keeps about every draft pick for the Draft page (js/deep-history.js): games played,
  weeks started for the team that drafted him, where he finished among the players at his position, the
  season's facts (draftSeasons), and the injury weeks that attachInjuryWeeks adds afterwards without ever
  touching a grade.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const setup = () => loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
const json = (c, code) => JSON.parse(runInLoadedContext(c, `JSON.stringify(${code})`));

// A two-team league with a three-week regular season (the playoffs start in week 4) and a two-round draft of four players.
//   roster 1 (alvin) drafts Rae (RB) and Wil (WR); roster 2 (beth) drafts Quin (QB), Ron (RB) and Zed (RB, who never scores).
const DIRECTORY = {
  rae: { position: "RB", first_name: "Rae", last_name: "Runner" },
  ron: { position: "RB", first_name: "Ron", last_name: "Rusher" },
  quin: { position: "QB", first_name: "Quin", last_name: "Thrower" },
  wil: { position: "WR", first_name: "Wil", last_name: "Catcher" },
  fill: { position: "RB", first_name: "Fill", last_name: "Ler" }, // not drafted by anyone, but scores
  zed: { position: "RB", first_name: "Zed", last_name: "Zero" }, // drafted late, never scored
};

// points each player scored in each week; a 0 or missing week is a game missed
const SCORES = {
  1: { rae: 20, ron: 10, quin: 25, wil: 12, fill: 15, zed: 0 },
  2: { rae: 18, ron: 14, quin: 22, wil: 0, fill: 9, zed: 0 },
  3: { rae: 0, ron: 16, quin: 24, wil: 13, fill: 8, zed: 0 },
  4: { rae: 30, ron: 5, quin: 20, wil: 11, fill: 8, zed: 0 }, // a playoff week: counts for nothing here
};
// who each roster started: rae started weeks 1-2, ron on roster 2 started week 1 only
const STARTERS = {
  1: { 1: ["rae", "wil"], 2: ["quin", "ron"] },
  2: { 1: ["rae", "fill"], 2: ["quin", "ron"] },
  3: { 1: ["wil", "fill"], 2: ["quin", "fill"] },
  4: { 1: ["rae", "wil"], 2: ["quin", "ron"] },
};

function weeks(through) {
  return [1, 2, 3, 4]
    .filter((w) => w <= through)
    .map((week) => ({
      week,
      matchups: [1, 2].map((rosterId) => ({
        roster_id: rosterId,
        matchup_id: 1,
        points: 100,
        starters: STARTERS[week][rosterId],
        players: Object.keys(DIRECTORY),
        players_points: Object.fromEntries(Object.entries(SCORES[week]).filter(([pid]) => (rosterId === 1 ? ["rae", "wil", "fill"] : ["quin", "ron", "zed"]).includes(pid))),
      })),
    }));
}

function league(status, through, season = "2025") {
  const entry = {
    league: { league_id: "L1", season, status, settings: { playoff_week_start: 4, num_teams: 2 }, roster_positions: ["QB", "RB", "WR", "BN"] },
    rosters: [
      { roster_id: 1, owner_id: "u1", settings: { wins: 2, losses: 1, ties: 0, fpts: 300 } },
      { roster_id: 2, owner_id: "u2", settings: { wins: 1, losses: 2, ties: 0, fpts: 250 } },
    ],
    users: [
      { user_id: "u1", display_name: "alvin", metadata: {} },
      { user_id: "u2", display_name: "beth", metadata: {} },
    ],
    bracket: [],
  };
  const pick = (pick_no, round, roster_id, player_id, extra = {}) => ({ pick_no, round, roster_id, player_id, metadata: { position: DIRECTORY[player_id].position, first_name: DIRECTORY[player_id].first_name, last_name: DIRECTORY[player_id].last_name }, ...extra });
  const deep = {
    weeks: weeks(through),
    scheduleWeeks: weeks(through),
    transactions: [],
    draft: { picks: [pick(1, 1, 1, "rae"), pick(2, 1, 2, "quin"), pick(3, 2, 2, "ron"), pick(4, 2, 1, "wil", { is_keeper: true }), pick(5, 3, 2, "zed")] },
  };
  return { entry, deep };
}

function statsFor(status = "complete", through = 4) {
  const c = setup();
  const { entry, deep } = league(status, through);
  c.__CHAIN__ = [entry];
  c.__DEEP__ = [deep];
  c.__DIR__ = DIRECTORY;
  runInLoadedContext(c, "var __STATS__ = DeepHistory.computeStats(__CHAIN__, __DEEP__, __DIR__);");
  return c;
}

const picksOf = (c) => json(c, "__STATS__.managers.flatMap(m => m.seasons.flatMap(s => s.draftPicks))");
const named = (picks, player) => picks.find((p) => p.playerId === player);

test("each pick carries games played, weeks started for the drafting team, and the position ranks", () => {
  const c = statsFor();
  const picks = picksOf(c);
  assert.strictEqual(picks.length, 5);
  const rae = named(picks, "rae");
  assert.strictEqual(rae.gp, 2, "weeks 1 and 2: he scored 0 in week 3, and the playoff week is not counted");
  assert.strictEqual(rae.starts, 2, "started weeks 1 and 2 for roster 1");
  assert.strictEqual(rae.gamesPossible, 3, "three regular-season weeks");
  assert.strictEqual(rae.posKey, "RB");
  const quin = named(picks, "quin");
  assert.strictEqual(quin.gp, 3);
  assert.strictEqual(quin.starts, 3);
  const wil = named(picks, "wil");
  assert.strictEqual(wil.gp, 2, "a 0 in week 2 is a missed game");
  assert.strictEqual(wil.starts, 2, "started weeks 1 and 3, and the week-4 start is a playoff week");
  assert.strictEqual(wil.isKeeper, true);
});

test("starts count only weeks he started for the team that drafted him", () => {
  const c = statsFor();
  const picks = picksOf(c);
  assert.strictEqual(named(picks, "ron").starts, 2, "weeks 1 and 2 (a start in week 4 is a playoff week)");
  // fill was started by both rosters in week 3, but nobody drafted him: he has no pick row, and the picks above are unaffected
  assert.strictEqual(named(picks, "fill"), undefined);
});

test("position ranks: where he was taken among players at his position, and where he finished", () => {
  const c = statsFor();
  const picks = picksOf(c);
  // RBs taken: Rae (pick 1) is the 1st RB, Ron (pick 3) the 2nd, Zed (pick 5) the 3rd
  assert.strictEqual(named(picks, "rae").posDraftRank, 1);
  assert.strictEqual(named(picks, "ron").posDraftRank, 2);
  assert.strictEqual(named(picks, "zed").posDraftRank, 3);
  assert.strictEqual(named(picks, "quin").posDraftRank, 1);
  // RB season points over the whole year: Rae 38+30 = 68, Ron 40+5 = 45, Fill 32+8 = 40 (the finish counts every scorer at the position)
  const rae = named(picks, "rae");
  assert.ok(rae.posFinishRank >= 1 && rae.posFinishRank <= 3);
  const ron = named(picks, "ron");
  assert.ok(ron.posFinishRank > rae.posFinishRank, "Ron scored less than Rae");
  assert.strictEqual(named(picks, "quin").posFinishRank, 1, "the only QB");
  assert.strictEqual(named(picks, "zed").posFinishRank, null, "a player who never scored did not finish anywhere");
  assert.strictEqual(named(picks, "zed").gp, 0);
});

test("draftSeasons: teams, rounds, weeks played and whether the season is over", () => {
  const done = statsFor("complete", 4);
  const info = json(done, "__STATS__.draftSeasons['2025']");
  assert.strictEqual(info.teams, 2);
  assert.strictEqual(info.rounds, 3);
  assert.strictEqual(info.weeksPlayed, 3, "regular-season weeks only");
  assert.strictEqual(info.complete, true);
  const live = statsFor("in_season", 2);
  const liveInfo = json(live, "__STATS__.draftSeasons['2025']");
  assert.strictEqual(liveInfo.complete, false);
  assert.strictEqual(liveInfo.weeksPlayed, 2, "only the finished weeks");
  assert.strictEqual(named(picksOf(live), "rae").gamesPossible, 2);
});

test("injury weeks start unknown (null) and only attachInjuryWeeks fills them in", () => {
  const c = statsFor();
  assert.ok(picksOf(c).every((p) => p.injWeeks === null));
  assert.strictEqual(json(c, "DeepHistory.attachInjuryWeeks(__STATS__, __CHAIN__, __DEEP__, null) === __STATS__"), true, "no injury data, nothing changes");
  assert.ok(picksOf(c).every((p) => p.injWeeks === null));
});

test("attachInjuryWeeks counts the regular-season weeks a drafted player was on the injury report", () => {
  const c = statsFor();
  c.__INJ__ = {
    players: {
      rae: { weeks: { 2025: { 2: "Out", 3: "IR", 4: "Out" }, 2024: { 1: "Out", 2: "Out" } } }, // week 4 is a playoff week; 2024 is another year
      quin: { weeks: { 2025: { 1: "Doubtful" } } },
    },
  };
  runInLoadedContext(c, "DeepHistory.attachInjuryWeeks(__STATS__, __CHAIN__, __DEEP__, __INJ__);");
  const picks = picksOf(c);
  assert.strictEqual(named(picks, "rae").injWeeks, 2, "weeks 2 and 3 only");
  assert.strictEqual(named(picks, "quin").injWeeks, 1);
  assert.strictEqual(named(picks, "ron").injWeeks, 0, "a season with injury data and no entry for him is 0, not unknown");
  assert.strictEqual(named(picks, "wil").injWeeks, 0);
});

test("attachInjuryWeeks fills each season from that season's own injury data only", () => {
  const c = setup();
  const a = league("complete", 4, "2024");
  const b = league("complete", 4, "2025");
  c.__CHAIN__ = [a.entry, b.entry];
  c.__DEEP__ = [a.deep, b.deep];
  c.__DIR__ = DIRECTORY;
  runInLoadedContext(c, "var __STATS__ = DeepHistory.computeStats(__CHAIN__, __DEEP__, __DIR__);");
  c.__INJ__ = { players: { rae: { weeks: { 2025: { 1: "Out", 2: "Out" } } } } }; // nothing for 2024
  runInLoadedContext(c, "DeepHistory.attachInjuryWeeks(__STATS__, __CHAIN__, __DEEP__, __INJ__);");
  const bySeason = (season) => json(c, `__STATS__.managers.flatMap(m => m.seasons.filter(s => String(s.season) === '${season}').flatMap(s => s.draftPicks))`);
  assert.strictEqual(named(bySeason(2025), "rae").injWeeks, 2);
  assert.ok(bySeason(2024).every((p) => p.injWeeks === null), "2024 has no injury data, so its picks stay unknown");
});

test("attachInjuryWeeks leaves a season with no injury data unknown, and never changes a grade or a value", () => {
  const c = statsFor();
  const before = JSON.stringify(picksOf(c).map(({ injWeeks, ...rest }) => rest));
  c.__INJ__ = { players: { rae: { weeks: { 2019: { 1: "Out" } } } } }; // nothing for 2025
  runInLoadedContext(c, "DeepHistory.attachInjuryWeeks(__STATS__, __CHAIN__, __DEEP__, __INJ__);");
  assert.ok(picksOf(c).every((p) => p.injWeeks === null), "no 2025 injury data at all means unknown");
  c.__INJ__ = { players: { rae: { weeks: { 2025: { 1: "Out", 2: "Out", 3: "Out" } } } } };
  runInLoadedContext(c, "DeepHistory.attachInjuryWeeks(__STATS__, __CHAIN__, __DEEP__, __INJ__);");
  const after = JSON.stringify(picksOf(c).map(({ injWeeks, ...rest }) => rest));
  assert.strictEqual(after, before, "grades, values and every other fact are exactly as they were");
});
