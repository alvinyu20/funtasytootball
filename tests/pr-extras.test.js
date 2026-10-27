/*
  scripts/lib/pr-extras.js: the numbers behind the Power Rankings page's
  Strength of Schedule, Weekly Scores and Lineup Slot sections. The fixture is
  small enough to work out on paper (see the comments), so the expected values
  below are hand-computed, not copied from the code's own output.
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const X = require("../scripts/lib/pr-extras.js");

const ROOT = path.join(__dirname, "..");
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

const g = (roster_id, matchup_id, points) => ({ roster_id, matchup_id, points });
const teams = [
  { rosterId: 1, userId: "u1", teamName: "A", record: "2-1" },
  { rosterId: 2, userId: "u2", teamName: "B", record: "0-3" },
  { rosterId: 3, userId: "u3", teamName: "C", record: "2-1" },
  { rosterId: 4, userId: "u4", teamName: "D", record: "2-1" },
];
// Weeks 1-3 are played. Totals: A 300, B 245, C 325, D 330 (three games each).
const played = [
  { week: 1, matchups: [g(1, 1, 100), g(2, 1, 80), g(3, 2, 120), g(4, 2, 90)] },
  { week: 2, matchups: [g(1, 1, 110), g(3, 1, 100), g(2, 2, 70), g(4, 2, 130)] },
  { week: 3, matchups: [g(1, 1, 90), g(4, 1, 110), g(2, 2, 95), g(3, 2, 105)] },
];
// Weeks 4-5 are regular season still to play, week 6 is the first playoff week.
const future = [
  { week: 4, matchups: [g(1, 1, 0), g(2, 1, 0), g(3, 2, 0), g(4, 2, 0)] },
  { week: 5, matchups: [g(1, 1, 0), g(3, 1, 0), g(2, 2, 0), g(4, 2, 0)] },
  { week: 6, matchups: [g(1, 1, 0), g(4, 1, 0), g(2, 2, 0), g(3, 2, 0)] },
];
const schedule = [...played, ...future];

test("gamePairs: only real two-team games; a bye or a lone row counts for nothing", () => {
  const pairs = X.gamePairs([g(1, 1, 10), g(2, 1, 20), g(3, null, 99), g(4, 2, 5)]);
  assert.strictEqual(pairs.length, 1);
  assert.deepStrictEqual(pairs[0].map((m) => m.roster_id), [1, 2]);
});

test("rankDescending: 1 is the highest, equal values share a rank, nulls stay null", () => {
  assert.deepStrictEqual(X.rankDescending([10, 30, 20]), [3, 1, 2]);
  assert.deepStrictEqual(X.rankDescending([5, 5, 9, 1]), [2, 2, 1, 4]);
  assert.deepStrictEqual(X.rankDescending([5, null, 9]), [2, null, 1]);
});

test("true SOS: for each game, the opponent's average in its OTHER games, averaged; PA/G is the plain average of what opponents scored", () => {
  const sos = X.buildStrengthOfSchedule({ teams, weeks: played, scheduleWeeks: schedule, playoffStart: 6 });
  const by = Object.fromEntries(sos.rows.map((r) => [r.teamName, r]));
  // A's games: vs B (B scored 80 in it) -> (245-80)/2 = 82.5; vs C (100) -> (325-100)/2 = 112.5; vs D (110) -> (330-110)/2 = 110. Mean 101.67.
  assert.strictEqual(by.A.trueSos, 101.67);
  assert.strictEqual(by.B.trueSos, 103.33); // 100, 100, 110
  assert.strictEqual(by.C.trueSos, 96.67); // 120, 95, 75
  assert.strictEqual(by.D.trueSos, 98.33); // 102.5, 87.5, 105
  assert.strictEqual(by.A.paPerGame, 96.67); // opponents scored 80, 100, 110
  assert.strictEqual(by.B.paPerGame, 111.67); // 100, 130, 105
  assert.strictEqual(by.C.paPerGame, 98.33); // 90, 110, 95
  assert.strictEqual(by.D.paPerGame, 93.33); // 120, 70, 90
  assert.deepStrictEqual(sos.rows.map((r) => r.games), [3, 3, 3, 3]);
  assert.strictEqual(sos.leagueAvgPpg, 100); // 1200 points over 12 team-games
});

test("true SOS differs from PA/G: ranks are 1 = hardest, and the two rankings disagree for C, A and D", () => {
  const sos = X.buildStrengthOfSchedule({ teams, weeks: played, scheduleWeeks: schedule, playoffStart: 6 });
  const by = Object.fromEntries(sos.rows.map((r) => [r.teamName, [r.paRank, r.trueRank]]));
  assert.deepStrictEqual(by, { A: [3, 2], B: [1, 1], C: [2, 4], D: [4, 3] });
});

test("rows come hardest-true-schedule first", () => {
  const sos = X.buildStrengthOfSchedule({ teams, weeks: played, scheduleWeeks: schedule, playoffStart: 6 });
  assert.deepStrictEqual(sos.rows.map((r) => r.teamName), ["B", "A", "D", "C"]);
});

test("road ahead: remaining regular-season games, opponents rated by current PPG, as distance from the league average; playoff weeks and played weeks don't count", () => {
  const sos = X.buildStrengthOfSchedule({ teams, weeks: played, scheduleWeeks: schedule, playoffStart: 6 });
  const by = Object.fromEntries(sos.rows.map((r) => [r.teamName, r.ahead]));
  // PPG now: A 100, B 81.67, C 108.33, D 110. Weeks 4-5: A faces B then C, B faces A then D, C faces D then A, D faces C then B.
  assert.deepStrictEqual(by.A, { games: 2, oppPpg: 95, delta: -5 });
  assert.deepStrictEqual(by.B, { games: 2, oppPpg: 105, delta: 5 });
  assert.deepStrictEqual(by.C, { games: 2, oppPpg: 105, delta: 5 });
  assert.deepStrictEqual(by.D, { games: 2, oppPpg: 95, delta: -5 });
  assert.deepStrictEqual(sos.remaining, { fromWeek: 4, toWeek: 5, games: 2 });
});

test("road ahead: with no playoff start known every future week counts; with nothing left it is null", () => {
  const all = X.buildStrengthOfSchedule({ teams, weeks: played, scheduleWeeks: schedule, playoffStart: null });
  assert.strictEqual(all.remaining.toWeek, 6);
  assert.strictEqual(all.rows[0].ahead.games, 3);
  const none = X.buildStrengthOfSchedule({ teams, weeks: played, scheduleWeeks: played, playoffStart: 6 });
  assert.strictEqual(none.remaining, null);
  assert.ok(none.rows.every((r) => r.ahead === null));
});

test("one finished week: PA/G exists but true SOS can't (the opponent has no other game yet)", () => {
  const sos = X.buildStrengthOfSchedule({ teams, weeks: [played[0]], scheduleWeeks: schedule, playoffStart: 6 });
  assert.ok(sos.rows.every((r) => r.trueSos === null && r.trueRank === null));
  assert.ok(sos.rows.every((r) => r.paPerGame != null && r.paRank != null));
  assert.ok(sos.rows.every((r) => r.ahead !== null), "the road ahead still works");
});

test("a team that never played (a bye all season, or not in the schedule) gets null numbers and sorts last", () => {
  const withIdle = [...teams, { rosterId: 5, userId: "u5", teamName: "E", record: "0-0" }];
  const weeks = [{ week: 1, matchups: [g(1, 1, 100), g(2, 1, 80), g(3, 2, 120), g(4, 2, 90), g(5, null, 150)] }, played[1]];
  const sos = X.buildStrengthOfSchedule({ teams: withIdle, weeks, scheduleWeeks: weeks, playoffStart: 6 });
  const e = sos.rows[sos.rows.length - 1];
  assert.strictEqual(e.teamName, "E");
  assert.strictEqual(e.games, 0);
  assert.strictEqual(e.trueSos, null);
  assert.strictEqual(e.paPerGame, null);
  assert.strictEqual(sos.leagueAvgPpg, (100 + 80 + 120 + 90 + 110 + 100 + 70 + 130) / 8, "a bye score isn't part of the league average");
});

test("no finished games at all: nothing to say", () => {
  assert.strictEqual(X.buildStrengthOfSchedule({ teams, weeks: [], scheduleWeeks: schedule, playoffStart: 6 }), null);
  assert.strictEqual(X.buildWeeklyScores({ teams, weeks: [] }), null);
});

test("weekly scores: one entry per week in week order (null where a team had no game), low/high/average, best average first", () => {
  const withBye = [
    { week: 1, matchups: [g(1, 1, 100), g(2, 1, 80), g(3, 2, 120), g(4, 2, 90)] },
    { week: 2, matchups: [g(1, 1, 110), g(3, 1, 100), g(4, null, 130), g(2, null, 70)] },
    played[2],
  ];
  const res = X.buildWeeklyScores({ teams, weeks: withBye });
  assert.deepStrictEqual(res.rows.map((r) => r.teamName), ["C", "A", "D", "B"]); // 108.33, 100, 100, 87.5
  const d = res.rows.find((r) => r.teamName === "D");
  assert.deepStrictEqual(d.scores, [90, null, 110], "week 2 was a bye");
  assert.strictEqual(d.avg, 100);
  assert.strictEqual(d.low, 90);
  assert.strictEqual(d.high, 110);
  const a = res.rows.find((r) => r.teamName === "A");
  assert.deepStrictEqual(a.scores, [100, 110, 90]);
  assert.strictEqual(res.leagueAvgPpg, (100 + 80 + 120 + 90 + 110 + 100 + 90 + 110 + 95 + 105) / 10);
});

test("weekly scores: ties on average break by name so the order never shuffles between runs", () => {
  const res = X.buildWeeklyScores({ teams, weeks: played });
  const names = res.rows.map((r) => r.teamName);
  assert.deepStrictEqual(names, ["D", "C", "A", "B"]); // 110, 108.33, 100, 81.67
});

test("weekly scores: a team's average equals what the Power Rankings table shows as Avg PPG for it", () => {
  const snapshot = readJson("data/power-rankings-snapshot.json");
  const extras = readJson("data/power-rankings-extras.json");
  if (snapshot.preseason || !extras.scores) return;
  extras.scores.rows.forEach((row) => {
    const t = snapshot.rows.find((r) => r.teamName === row.teamName);
    assert.ok(t, `${row.teamName} is in the snapshot`);
    assert.ok(Math.abs(t.avgPpg - row.avg) < 0.006, `${row.teamName}: table ${t.avgPpg} vs strip ${row.avg}`);
  });
});

const slotLeague = { roster_positions: ["QB", "RB", "RB", "FLEX", "SUPER_FLEX", "K", "BN"] };
function stubTable(weeksSeen) {
  return (rosterInfo, league, deep) => {
    weeksSeen.push(deep.weeks.map((w) => w.week));
    return {
      // the order DeepHistory.buildPositionTable really gives: K before the flex slots
      columns: [
        { key: "QB", label: "QB" },
        { key: "RB1", label: "RB1" },
        { key: "RB2", label: "RB2" },
        { key: "K", label: "K" },
        { key: "FLEX", label: "FLEX" },
        { key: "SUPER_FLEX", label: "SUPERFLEX" },
      ],
      rows: [
        { rosterId: 1, teamName: "A", cells: { QB: 20, RB1: 18, RB2: 10, K: 8, FLEX: 7, SUPER_FLEX: 12 } },
        { rosterId: 2, teamName: "B", cells: { QB: 10, RB1: 12, RB2: 10, K: 8, FLEX: null, SUPER_FLEX: 8 } },
        { rosterId: 3, teamName: "C", cells: { QB: 15, RB1: 15, RB2: 10, K: 11, FLEX: 5, SUPER_FLEX: 10 } },
      ],
    };
  };
}

test("lineupOrder: columns follow the league's roster_positions, numbered slots stay in order, unknown slots go last", () => {
  const cols = [{ key: "K" }, { key: "RB2" }, { key: "XYZ" }, { key: "SUPER_FLEX" }, { key: "QB" }, { key: "RB1" }, { key: "FLEX" }];
  assert.deepStrictEqual(X.lineupOrder(cols, slotLeague.roster_positions).map((c) => c.key), ["QB", "RB1", "RB2", "FLEX", "SUPER_FLEX", "K", "XYZ"]);
});

test("lineup slots: each cell is the team's slot average minus the league's average for that slot; vs Avg is their sum; best total first", () => {
  const seen = [];
  const res = X.buildSlotGaps({ teams, weeks: played, league: slotLeague, playerDirectory: {}, buildPositionTable: stubTable(seen) });
  assert.deepStrictEqual(res.columns.map((c) => c.key), ["QB", "RB1", "RB2", "FLEX", "SUPER_FLEX", "K"]);
  // QB: (20+10+15)/3 = 15, RB1: 15, RB2: 10, K: 9, SUPER_FLEX: 10, FLEX: (7+5)/2 = 6 (B has none, so it doesn't drag the average)
  assert.deepStrictEqual(res.leagueAvg, { QB: 15, RB1: 15, RB2: 10, FLEX: 6, SUPER_FLEX: 10, K: 9 });
  const a = res.rows.find((r) => r.teamName === "A");
  assert.deepStrictEqual(a.cells, { QB: 5, RB1: 3, RB2: 0, FLEX: 1, SUPER_FLEX: 2, K: -1 });
  assert.strictEqual(a.total, 10);
  const b = res.rows.find((r) => r.teamName === "B");
  assert.strictEqual(b.cells.FLEX, null, "a slot the team never filled stays empty");
  assert.strictEqual(b.total, -5 - 3 + 0 - 2 - 1, "and adds nothing to the total");
  assert.deepStrictEqual(res.rows.map((r) => r.teamName), ["A", "C", "B"]);
  ["QB", "RB1", "RB2", "FLEX", "SUPER_FLEX", "K"].forEach((k) => {
    const sum = res.rows.reduce((s, r) => s + (r.cells[k] || 0), 0);
    assert.ok(Math.abs(sum) < 0.011, `${k}: the deltas around a league average add up to zero`);
  });
});

test("lineup slots: no weeks, or no table, is null", () => {
  assert.strictEqual(X.buildSlotGaps({ teams, weeks: [], league: slotLeague, playerDirectory: {}, buildPositionTable: stubTable([]) }), null);
  assert.strictEqual(X.buildSlotGaps({ teams, weeks: played, league: slotLeague, playerDirectory: {}, buildPositionTable: () => ({ columns: [], rows: [] }) }), null);
});

test("buildPowerRankingsExtras: regular-season weeks only, carries the snapshot's season and week, and all three sections", () => {
  const seen = [];
  const withPlayoffs = [...played, { week: 6, matchups: [g(1, 1, 500), g(4, 1, 1), g(2, 2, 2), g(3, 2, 3)] }];
  const league = { ...slotLeague, settings: { playoff_week_start: 6 } };
  const out = X.buildPowerRankingsExtras({
    season: 2026, week: 3, generatedAt: "2026-10-13T17:51:12.898Z", teams, league, weeks: withPlayoffs, scheduleWeeks: schedule, playerDirectory: {}, buildPositionTable: stubTable(seen),
  });
  assert.strictEqual(out.season, "2026");
  assert.strictEqual(out.week, 3);
  assert.strictEqual(out.generatedAt, "2026-10-13T17:51:12.898Z");
  assert.deepStrictEqual(seen, [[1, 2, 3]], "the slot table never sees the playoff week");
  assert.strictEqual(out.sos.leagueAvgPpg, 100, "the 500-point playoff score isn't in the league average");
  assert.strictEqual(out.scores.rows.find((r) => r.teamName === "A").scores.length, 3);
  assert.ok(out.slots.rows.length === 3);
  assert.ok(/never edit it by hand/.test(out._instructions));
});

test("buildPowerRankingsExtras: before any finished week every section is null", () => {
  const out = X.buildPowerRankingsExtras({
    season: 2026, week: 0, generatedAt: "x", teams, league: { ...slotLeague, settings: {} }, weeks: [], scheduleWeeks: schedule, playerDirectory: {}, buildPositionTable: stubTable([]),
  });
  assert.strictEqual(out.sos, null);
  assert.strictEqual(out.scores, null);
  assert.strictEqual(out.slots, null);
});

test("committed data: the extras were built for the same season and week as the Power Rankings snapshot", () => {
  const snapshot = readJson("data/power-rankings-snapshot.json");
  const extras = readJson("data/power-rankings-extras.json");
  if (snapshot.preseason) return;
  assert.strictEqual(String(extras.season), String(snapshot.season));
  assert.strictEqual(extras.week, snapshot.week, "extras and snapshot must come from the same run");
  assert.strictEqual(extras.sos.rows.length, snapshot.rows.length);
  assert.deepStrictEqual(extras.slots.columns.map((c) => c.key), ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX", "SUPER_FLEX", "K", "DEF"], "columns read like the lineup");
});

test("committed data: recomputing from the saved 2026 season reproduces the committed SOS and weekly scores", () => {
  const { finishedWeeksOf } = require("../scripts/lib/finished-weeks.js");
  const snapshot = readJson("data/power-rankings-snapshot.json");
  const extras = readJson("data/power-rankings-extras.json");
  const archive = readJson(`data/sleeper-archive/${snapshot.season}.json`);
  if (snapshot.preseason) return;
  const scheduleWeeks = archive.weeks.map((w) => ({ week: w.week, matchups: w.matchups }));
  const scored = scheduleWeeks.filter((w) => w.matchups.some((m) => (m.points || 0) > 0));
  const weeks = finishedWeeksOf(archive, scored, archive.nflWeek == null ? null : archive.nflWeek);
  const last = weeks.length ? Math.max(...weeks.map((w) => w.week)) : 0;
  if (last !== snapshot.week) return; // the saved season has moved on since the snapshot; the next run catches the files up
  const out = X.buildPowerRankingsExtras({
    season: snapshot.season, week: snapshot.week, generatedAt: snapshot.generatedAt, teams: snapshot.rows, league: archive.league, weeks, scheduleWeeks, playerDirectory: {},
    buildPositionTable: () => ({ columns: [], rows: [] }),
  });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.sos)), extras.sos);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.scores)), extras.scores);
});
