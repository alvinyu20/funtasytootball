const test = require("node:test");
const assert = require("node:assert");
const { buildSafeDeep } = require("../scripts/update-power-rankings.js");

function fakeMatchups(points) {
  // points: array of per-roster point totals, roster_id = index + 1
  return points.map((pts, i) => ({ roster_id: i + 1, matchup_id: Math.floor(i / 2) + 1, points: pts }));
}

function fakeSleeperAPI(weeklyMatchups) {
  // weeklyMatchups: array indexed by week-1, each an array of matchup objects (or null/[] to stop the walk)
  return {
    async getMatchups(leagueId, week) {
      const m = weeklyMatchups[week - 1];
      return m === undefined ? [] : m;
    },
  };
}

test("buildSafeDeep: a week still in progress (Sleeper's own current week) is excluded from `weeks`, even if some scores are already in", async () => {
  const weekly = [
    fakeMatchups([100, 95, 110, 88]), // week 1 - fully scored
    fakeMatchups([12, 0, 0, 0]), // week 2 - only one game in so far, clearly in progress
  ];
  const api = fakeSleeperAPI(weekly);
  // Sleeper reports week 2 as current -> only week 1 is "safe"
  const deep = await buildSafeDeep(api, "league1", 17, /* safeBeforeWeek */ 2);
  assert.deepStrictEqual(deep.weeks.map((w) => w.week), [1], "week 2 should be excluded even though it has a nonzero score already");
});

test("buildSafeDeep: `scheduleWeeks` still includes the in-progress week (needed for the playoff simulator's remaining schedule), only `weeks` excludes it", async () => {
  const weekly = [fakeMatchups([100, 95, 110, 88]), fakeMatchups([12, 0, 0, 0])];
  const api = fakeSleeperAPI(weekly);
  const deep = await buildSafeDeep(api, "league1", 17, 2);
  assert.deepStrictEqual(deep.scheduleWeeks.map((w) => w.week), [1, 2], "scheduleWeeks keeps every week fetched, played or not");
});

test("buildSafeDeep: once a week is genuinely done (Sleeper has moved on), it's included normally", async () => {
  const weekly = [fakeMatchups([100, 95, 110, 88]), fakeMatchups([102, 97, 88, 91])];
  const api = fakeSleeperAPI(weekly);
  // Sleeper reports week 3 as current -> weeks 1 AND 2 are both safe
  const deep = await buildSafeDeep(api, "league1", 17, 3);
  assert.deepStrictEqual(deep.weeks.map((w) => w.week), [1, 2]);
});

test("buildSafeDeep: preseason — Sleeper's current week is 1, so there is no safe/complete week at all yet", async () => {
  const weekly = [fakeMatchups([0, 0, 0, 0])]; // Sleeper generates the matchup pairing before any score exists
  const api = fakeSleeperAPI(weekly);
  const deep = await buildSafeDeep(api, "league1", 17, 1);
  assert.deepStrictEqual(deep.weeks, [], "no week should be considered safe before Sleeper's current week has even reached 2");
});

test("buildSafeDeep: a week with a pairing but literally all-zero scores (bye week artifact, or the week hasn't started) doesn't count as played, independent of the week-safety check", async () => {
  const weekly = [fakeMatchups([0, 0, 0, 0]), fakeMatchups([100, 95, 110, 88])];
  const api = fakeSleeperAPI(weekly);
  const deep = await buildSafeDeep(api, "league1", 17, 3); // both weeks would be "safe" by the week-number check alone
  assert.deepStrictEqual(deep.weeks.map((w) => w.week), [2], "week 1's all-zero scores mean it never actually happened, regardless of week safety");
});

test("buildSafeDeep: stops walking once Sleeper returns no matchups at all for a week (end of the generated schedule)", async () => {
  const weekly = [fakeMatchups([100, 95, 110, 88])]; // only week 1 exists; week 2 onward returns []
  const api = fakeSleeperAPI(weekly);
  const deep = await buildSafeDeep(api, "league1", 17, 10);
  assert.deepStrictEqual(deep.scheduleWeeks.map((w) => w.week), [1]);
});

// ---------------------------------------------------------------------------
// The Season page's Power Rank History charts for the in-progress season.
// ---------------------------------------------------------------------------
const fs = require("node:fs");
const path = require("node:path");
const { rostersAsOfWeek, buildCsvHistoryForCurrentSeason, buildExtrasForRun } = require("../scripts/update-power-rankings.js");

const ROOT = path.join(__dirname, "..");

// Four rosters, rows keyed roster_id 1-4 (1 plays 2, 3 plays 4 in week 1, then 1-3 / 2-4, ...).
const ROSTERS = [1, 2, 3, 4].map((id) => ({ roster_id: id, owner_id: `u${id}`, settings: { wins: 9, losses: 9, ties: 9, fpts: 9999, keep: "me" } }));
const wk = (week, pts) => ({ week, matchups: [1, 2, 3, 4].map((id, i) => ({ roster_id: id, matchup_id: week % 2 ? Math.floor(i / 2) + 1 : (i % 2) + 1, points: pts[i] })) });

test("rostersAsOfWeek: records and points are rebuilt from the matchups through that week, replacing today's numbers", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70])];
  // wk1: 1>2, 3>4.  wk2 pairs (1,3) and (2,4): 1>3, 2>4.
  const w1 = rostersAsOfWeek(ROSTERS, weeks, 1, 15);
  const rec = (rs, id) => rs.find((r) => r.roster_id === id).settings;
  assert.deepStrictEqual([rec(w1, 1).wins, rec(w1, 1).losses, rec(w1, 2).wins, rec(w1, 2).losses], [1, 0, 0, 1]);
  assert.strictEqual(rec(w1, 1).ties, 0, "the real roster's current ties (9) must not leak into an earlier week");
  const w2 = rostersAsOfWeek(ROSTERS, weeks, 2, 15);
  assert.deepStrictEqual([rec(w2, 1).wins, rec(w2, 2).wins, rec(w2, 3).wins, rec(w2, 4).wins], [2, 1, 1, 0]);
  assert.strictEqual(rec(w2, 1).fpts, 200);
  assert.strictEqual(rec(w2, 1).fpts_against + rec(w2, 1).fpts_against_decimal / 100, 170, "points against: 90 (wk1) + 80 (wk2)");
});

test("rostersAsOfWeek: playoff weeks, byes and ties are handled the way Sleeper's own record does", () => {
  const weeks = [
    { week: 1, matchups: [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 100 }, { roster_id: 3, matchup_id: null, points: 50 }, { roster_id: 4, matchup_id: 2, points: 10 }] },
    { week: 15, matchups: [{ roster_id: 1, matchup_id: 1, points: 200 }, { roster_id: 2, matchup_id: 1, points: 1 }] },
  ];
  const out = rostersAsOfWeek(ROSTERS, weeks, 15, 15);
  const s = (id) => out.find((r) => r.roster_id === id).settings;
  assert.deepStrictEqual([s(1).wins, s(1).ties, s(2).ties, s(2).losses], [0, 1, 1, 0], "a tie is a tie for both; the week-15 playoff game isn't counted");
  assert.deepStrictEqual([s(3).wins, s(3).losses, s(3).fpts], [0, 0, 0], "a bye row with no matchup_id counts for nothing");
  assert.deepStrictEqual([s(4).wins, s(4).losses], [0, 0], "a matchup with no partner counts for nothing");
});

test("rostersAsOfWeek: points keep their cents (fpts + fpts_decimal) and the input rosters are not changed", () => {
  const weeks = [{ week: 1, matchups: [{ roster_id: 1, matchup_id: 1, points: 100.07 }, { roster_id: 2, matchup_id: 1, points: 99.9 }] }, { week: 2, matchups: [{ roster_id: 1, matchup_id: 1, points: 0.05 }, { roster_id: 2, matchup_id: 1, points: 0.1 }] }];
  const before = JSON.stringify(ROSTERS);
  const out = rostersAsOfWeek(ROSTERS.slice(0, 2), weeks, 2, null);
  const s = out[0].settings;
  assert.deepStrictEqual([s.fpts, s.fpts_decimal], [100, 12], "100.07 + 0.05 = 100.12, not 100.12000000000002");
  assert.strictEqual(s.keep, "me", "unrelated settings are kept");
  assert.strictEqual(JSON.stringify(ROSTERS), before);
});

// A stand-in engine that ranks teams by the wins in the entry it is handed.
function fakeEngine(calls) {
  return {
    computePowerRankings(entry, deep) {
      calls.push({ wins: entry.rosters.map((r) => r.settings.wins), weeksSeen: deep.weeks.map((w) => w.week), scheduleSeen: deep.scheduleWeeks.length });
      const rows = entry.rosters
        .map((r) => ({ teamName: `team${r.roster_id}`, wins: r.settings.wins }))
        .sort((a, b) => b.wins - a.wins || a.teamName.localeCompare(b.teamName))
        .map((r, i) => ({ teamName: r.teamName, powerRank: i + 1, prScore: i + 1 + r.wins / 100, playoffPct: 100 - i * 10 }));
      return { rows };
    },
  };
}

test("buildCsvHistoryForCurrentSeason: every past week is computed from that week's record, only that week's games are 'played', and the whole schedule stays available", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70]), wk(3, [100, 90, 80, 70])];
  const scheduleWeeks = [...weeks, wk(4, [0, 0, 0, 0])];
  const calls = [];
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const out = buildCsvHistoryForCurrentSeason(fakeEngine(calls), entry, { weeks, scheduleWeeks }, {}, {}, 10, 3, null);
  assert.deepStrictEqual(calls.map((c) => c.weeksSeen), [[1], [1, 2], [1, 2, 3]]);
  assert.deepStrictEqual(calls[0].wins, [1, 0, 1, 0], "week 1: the real rosters say 9 wins each; the chart must say what it was after week 1");
  assert.deepStrictEqual(calls[1].wins, [2, 1, 1, 0]);
  assert.deepStrictEqual(calls[2].wins, [9, 9, 9, 9], "the newest week uses the real rosters, so it agrees with Sleeper and with the snapshot");
  assert.ok(calls.every((c) => c.scheduleSeen === 4));
  assert.deepStrictEqual(Object.keys(out), ["ranks", "scores", "playoffOdds"]);
  assert.strictEqual(out.ranks.team1.weekly.length, 3);
  assert.strictEqual(out.playoffOdds.team1.length, 3);
  assert.strictEqual(out.ranks.team1.pre, null);
});

test("buildCsvHistoryForCurrentSeason: the newest week reuses the snapshot's own result instead of simulating again, so the chart ends exactly where the Power Rankings page does", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70])];
  const calls = [];
  const snapshotResult = { rows: [{ teamName: "team1", powerRank: 4, prScore: 7.77, playoffPct: 12.3 }, { teamName: "team2", powerRank: 1, prScore: 1.11, playoffPct: 99 }] };
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const out = buildCsvHistoryForCurrentSeason(fakeEngine(calls), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 2, snapshotResult);
  assert.strictEqual(calls.length, 1, "only week 1 is simulated");
  assert.deepStrictEqual([out.ranks.team1.weekly[1], out.scores.team1.weekly[1], out.playoffOdds.team1[1]], [4, 7.77, 12.3]);
  assert.deepStrictEqual([out.ranks.team2.weekly[1], out.scores.team2.weekly[1], out.playoffOdds.team2[1]], [1, 1.11, 99]);
  assert.ok(Number.isFinite(out.ranks.team1.weekly[0]), "week 1 is still there");
});

// ---- Past weeks are frozen (2026-10-28: running Week 7 had rewritten Weeks 1-6) ----------------------------------
// The engine below returns whatever "today's inputs" say; the saved file says what the page showed back then.
function savedYear(weeksDone) {
  const names = ["team1", "team2", "team3", "team4"];
  const out = { ranks: {}, scores: {}, playoffOdds: {} };
  names.forEach((name, i) => {
    out.ranks[name] = { pre: null, weekly: [] };
    out.scores[name] = { pre: null, weekly: [] };
    out.playoffOdds[name] = [];
    for (let w = 1; w <= weeksDone; w++) {
      out.ranks[name].weekly.push(i + 1 + (w % 2) * 0.5 - (name === "team1" ? 0.5 : 0)); // 0.5 steps: ties are real
      out.scores[name].weekly.push(100 + w * 10 + i); // numbers no engine would produce
      out.playoffOdds[name].push(50 + w + i / 10);
    }
  });
  return out;
}
const finalRows = [
  { teamName: "team1", powerRank: 2, prScore: 2.22, playoffPct: 80 },
  { teamName: "team2", powerRank: 1, prScore: 1.11, playoffPct: 90 },
  { teamName: "team3", powerRank: 3, prScore: 3.33, playoffPct: 40 },
  { teamName: "team4", powerRank: 4, prScore: 4.44, playoffPct: 10 },
];

test("buildCsvHistoryForCurrentSeason: weeks already on file are kept exactly, the engine is not asked about them again, and the newest week is the snapshot's", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70]), wk(3, [100, 90, 80, 70])];
  const calls = [];
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const saved = savedYear(2);
  const before = JSON.stringify(saved);
  const logs = [];
  const out = buildCsvHistoryForCurrentSeason(fakeEngine(calls), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 3, { rows: finalRows }, { saved, log: (m) => logs.push(m) });
  assert.strictEqual(calls.length, 0, "nothing is re-simulated: weeks 1 and 2 are on file and week 3 is the snapshot");
  ["team1", "team2", "team3", "team4"].forEach((t) => {
    assert.deepStrictEqual(out.ranks[t].weekly.slice(0, 2), saved.ranks[t].weekly, `${t}: weeks 1-2 ranks as saved (halves included)`);
    assert.deepStrictEqual(out.scores[t].weekly.slice(0, 2), saved.scores[t].weekly, `${t}: weeks 1-2 scores as saved`);
    assert.deepStrictEqual(out.playoffOdds[t].slice(0, 2), saved.playoffOdds[t], `${t}: weeks 1-2 odds as saved`);
  });
  assert.deepStrictEqual([out.ranks.team1.weekly[2], out.scores.team1.weekly[2], out.playoffOdds.team1[2]], [2, 2.22, 80], "week 3 is the run's own result");
  assert.strictEqual(JSON.stringify(saved), before, "the saved entry that was passed in is not modified");
  assert.ok(logs.some((m) => /Weeks 1, 2 already on file/.test(m)) && !logs.some((m) => /RECONSTRUCTED/.test(m)), "it says what it kept and has nothing to apologise for");
});

test("buildCsvHistoryForCurrentSeason: the Week 7 incident — a run with different ROS inputs adds its week and leaves Weeks 1-6 alone", () => {
  const weeks = [1, 2, 3, 4, 5, 6, 7].map((w) => wk(w, [100, 90, 80, 70]));
  const calls = [];
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const saved = savedYear(6);
  const out = buildCsvHistoryForCurrentSeason(fakeEngine(calls), entry, { weeks, scheduleWeeks: weeks }, {}, { team1: { rank: 12 } }, 10, 7, { rows: finalRows }, { saved });
  assert.strictEqual(calls.length, 0);
  Object.keys(saved.ranks).forEach((t) => {
    assert.deepStrictEqual(out.ranks[t].weekly.slice(0, 6), saved.ranks[t].weekly);
    assert.deepStrictEqual(out.scores[t].weekly.slice(0, 6), saved.scores[t].weekly);
    assert.deepStrictEqual(out.playoffOdds[t].slice(0, 6), saved.playoffOdds[t]);
    assert.strictEqual(out.ranks[t].weekly.length, 7);
  });
});

test("buildCsvHistoryForCurrentSeason: running again in the same week refreshes only that week", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70])];
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const saved = savedYear(2); // week 2 is on file from the first run of the week
  const rerun = finalRows.map((r) => ({ ...r, prScore: r.teamName === "team2" ? 2.11 : r.prScore }));
  const out = buildCsvHistoryForCurrentSeason(fakeEngine([]), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 2, { rows: rerun }, { saved });
  assert.deepStrictEqual(out.scores.team2.weekly, [saved.scores.team2.weekly[0], 2.11], "week 1 as saved, week 2 from this run");
});

test("buildCsvHistoryForCurrentSeason: a week missing from the file is reconstructed and flagged as an approximation, then everything else is still kept", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70]), wk(3, [100, 90, 80, 70]), wk(4, [100, 90, 80, 70])];
  const calls = [];
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const saved = savedYear(3);
  saved.ranks.team3.weekly[1] = undefined; // week 2 has a hole for one team
  const logs = [];
  const out = buildCsvHistoryForCurrentSeason(fakeEngine(calls), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 4, { rows: finalRows }, { saved, log: (m) => logs.push(m) });
  assert.deepStrictEqual(calls.map((c) => c.weeksSeen), [[1, 2]], "only week 2 is recomputed");
  assert.strictEqual(out.scores.team1.weekly[0], saved.scores.team1.weekly[0], "week 1 kept");
  assert.strictEqual(out.scores.team1.weekly[2], saved.scores.team1.weekly[2], "week 3 kept");
  assert.notStrictEqual(out.scores.team1.weekly[1], saved.scores.team1.weekly[1], "week 2 came from the engine");
  assert.ok(Object.values(out.ranks).every((t) => t.weekly.length === 4 && t.weekly.every(Number.isFinite)), "no gaps");
  const warning = logs.find((m) => /RECONSTRUCTED/.test(m));
  assert.ok(warning && /Week 2 was missing/.test(warning) && /approximation/.test(warning), "the script says plainly that week 2 is an approximation");
});

test("buildCsvHistoryForCurrentSeason: no saved entry (first run of a season) reconstructs everything before the newest week; a non-numeric saved value counts as missing", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70])];
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const calls = [];
  buildCsvHistoryForCurrentSeason(fakeEngine(calls), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 2, { rows: finalRows }, {});
  assert.deepStrictEqual(calls.map((c) => c.weeksSeen), [[1]]);
  // a hole in any one of the three series makes the whole week count as missing
  const holes = [(y) => (y.ranks.team4.weekly[0] = null), (y) => (y.scores.team4.weekly[0] = null), (y) => (y.playoffOdds.team4[0] = null), (y) => (y.playoffOdds.team2[0] = "50")];
  holes.forEach((punch, i) => {
    const saved = savedYear(1);
    punch(saved);
    const calls2 = [];
    buildCsvHistoryForCurrentSeason(fakeEngine(calls2), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 2, { rows: finalRows }, { saved });
    assert.strictEqual(calls2.length, 1, `hole ${i + 1}: a null or text in the file is a hole, not a value`);
  });
  // "pre" values already on file (the preseason rank) are carried through, not reset
  const withPre = savedYear(1);
  withPre.ranks.team1.pre = 5;
  withPre.scores.team1.pre = 4.5;
  const out = buildCsvHistoryForCurrentSeason(fakeEngine([]), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 2, { rows: finalRows }, { saved: withPre });
  assert.deepStrictEqual([out.ranks.team1.pre, out.scores.team1.pre, out.ranks.team2.pre], [5, 4.5, null]);
});

test("buildCsvHistoryForCurrentSeason: if the league's teams no longer match the file, nothing from it is trusted", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70])];
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const saved = savedYear(1);
  delete saved.ranks.team4;
  delete saved.scores.team4;
  delete saved.playoffOdds.team4;
  const calls = [];
  buildCsvHistoryForCurrentSeason(fakeEngine(calls), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 2, { rows: finalRows }, { saved });
  assert.strictEqual(calls.length, 1, "week 1 is rebuilt rather than published with a team missing");
});

test("buildCsvHistoryForCurrentSeason: a file that still holds a team the league no longer has is not trusted either", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70])];
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const saved = savedYear(1);
  saved.ranks.gone = { pre: null, weekly: [9] };
  saved.scores.gone = { pre: null, weekly: [9.9] };
  saved.playoffOdds.gone = [1];
  const calls = [];
  const out = buildCsvHistoryForCurrentSeason(fakeEngine(calls), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 2, { rows: finalRows }, { saved });
  assert.strictEqual(calls.length, 1, "week 1 is rebuilt for the four teams that are in the league");
  assert.deepStrictEqual(Object.keys(out.ranks).filter((t) => out.ranks[t].weekly.length === 2).sort(), ["team1", "team2", "team3", "team4"]);
});

test("buildCsvHistoryForCurrentSeason: teams keep the order they have in the file, so the chart's line colours do not move between runs", () => {
  const weeks = [wk(1, [100, 90, 80, 70]), wk(2, [100, 90, 80, 70])];
  const entry = { league: { settings: { playoff_week_start: 15 } }, rosters: ROSTERS };
  const saved = savedYear(1);
  const reordered = { ranks: {}, scores: {}, playoffOdds: {} };
  ["team3", "team1", "team4", "team2"].forEach((t) => {
    reordered.ranks[t] = saved.ranks[t];
    reordered.scores[t] = saved.scores[t];
    reordered.playoffOdds[t] = saved.playoffOdds[t];
  });
  const out = buildCsvHistoryForCurrentSeason(fakeEngine([]), entry, { weeks, scheduleWeeks: weeks }, {}, {}, 10, 2, { rows: finalRows }, { saved: reordered });
  assert.deepStrictEqual(Object.keys(out.ranks), ["team3", "team1", "team4", "team2"]);
  assert.deepStrictEqual(Object.keys(out.scores), ["team3", "team1", "team4", "team2"]);
  assert.deepStrictEqual(Object.keys(out.playoffOdds), ["team3", "team1", "team4", "team2"]);
});

test("the update script hands the season's saved history to the builder instead of overwriting it with a rebuild", () => {
  const script = fs.readFileSync(path.join(ROOT, "scripts", "update-power-rankings.js"), "utf8");
  const main = script.slice(script.indexOf("async function main()"));
  const readAt = main.indexOf("readJson(CSV_HISTORY_PATH");
  assert.ok(readAt >= 0 && readAt < main.indexOf("buildCsvHistoryForCurrentSeason("), "the file is read (so the other seasons are kept too) before the history is built");
  assert.match(main, /saved:\s*csvHistory\.seasons\[season\]/, "and what is on file goes in as `saved`");
  assert.ok(!/re-simulating each past week/i.test(script), "the old 'rebuild every week' wording is gone");
});

test("update-power-rankings workflow stages every file the script writes (the Season charts' file was missing, so it was rebuilt every Tuesday and never saved)", () => {
  const yml = fs.readFileSync(path.join(ROOT, ".github", "workflows", "update-power-rankings.yml"), "utf8");
  const addLine = yml.split("\n").find((l) => l.trim().startsWith("git add"));
  assert.ok(addLine, "the workflow has a git add step");
  const script = fs.readFileSync(path.join(ROOT, "scripts", "update-power-rankings.js"), "utf8");
  const written = [...script.matchAll(/writeJson\((\w+_PATH)/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(written)].sort(), ["CSV_HISTORY_PATH", "EXTRAS_PATH", "HISTORY_PATH", "SNAPSHOT_PATH"], "the script writes these four files");
  for (const file of ["power-rankings-snapshot.json", "power-rank-history.json", "power-rank-csv-history.json", "power-rankings-extras.json"]) {
    assert.ok(addLine.includes(`data/${file}`), `${file} must be in the workflow's git add`);
  }
});

test("update-power-rankings workflow has no schedule: it runs only when data/team-strength.json is pushed, or by hand", () => {
  const yml = fs.readFileSync(path.join(ROOT, ".github", "workflows", "update-power-rankings.yml"), "utf8");
  const code = yml.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n"); // the comments talk about schedules
  assert.ok(!/^\s*schedule:/m.test(code), "no schedule: block");
  assert.ok(!/cron:/.test(code), "no cron line");
  const triggers = code.slice(code.indexOf("\non:"), code.indexOf("\npermissions:"));
  assert.match(triggers, /push:\s*\n\s*branches: \[main\]\s*\n\s*paths:\s*\n\s*- "data\/team-strength\.json"/, "a push that changes the ROS file triggers it");
  assert.strictEqual([...triggers.matchAll(/^\s*- "/gm)].length, 1, "and that is the only file that does");
  assert.match(triggers, /workflow_dispatch:/, "the manual Run workflow button stays");
});

test("committed data: the current season's Power Rank History exists and ends exactly on the Power Rankings snapshot", () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rankings-snapshot.json"), "utf8"));
  if (snapshot.preseason) return; // nothing to chart before Week 1 is final
  const history = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rank-csv-history.json"), "utf8"));
  const year = history.seasons[String(snapshot.season)];
  assert.ok(year, `data/power-rank-csv-history.json has no ${snapshot.season} entry. The Season page shows no Power Rank charts without it (run the Power Rankings Update workflow).`);
  for (const key of ["ranks", "scores", "playoffOdds"]) assert.ok(year[key], `${snapshot.season} is missing ${key}`);
  const last = snapshot.week - 1;
  snapshot.rows.forEach((row) => {
    const r = year.ranks[row.teamName];
    assert.ok(r, `${row.teamName} is missing from the ${snapshot.season} ranks`);
    assert.strictEqual(r.weekly.length, snapshot.week, `${row.teamName}: one rank per finished week`);
    assert.strictEqual(r.weekly[last], row.powerRank, `${row.teamName}: last chart rank matches the snapshot`);
    assert.strictEqual(year.scores[row.teamName].weekly[last], row.prScore);
    assert.strictEqual(year.playoffOdds[row.teamName][last], row.playoffPct);
    assert.ok([...r.weekly, ...year.scores[row.teamName].weekly, ...year.playoffOdds[row.teamName]].every((v) => typeof v === "number" && Number.isFinite(v)), `${row.teamName}: no gaps in the series`);
  });
  // Ranks come from the PR Scores, with a tie sharing the average of the places it covers (two teams on 6.35 at 6th and 7th are both 6.5).
  for (let w = 0; w < snapshot.week; w++) {
    const teams = Object.keys(year.ranks);
    const sc = (t) => year.scores[t].weekly[w];
    teams.forEach((t) => {
      const below = teams.filter((o) => sc(o) < sc(t)).length;
      const tied = teams.filter((o) => sc(o) === sc(t)).length;
      assert.strictEqual(year.ranks[t].weekly[w], below + (tied + 1) / 2, `week ${w + 1}: ${t}'s rank follows its PR Score`);
    });
  }
});

test("committed data: Weeks 1-6 of the 2026 Power Rank History are exactly what the Power Rankings page showed at the time (from the league manager's screenshots), and the Δ-arrow history agrees", () => {
  const shots = JSON.parse(fs.readFileSync(path.join(__dirname, "helpers", "power-rankings-weeks-1-6.json"), "utf8"));
  const history = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rank-csv-history.json"), "utf8")).seasons["2026"];
  const arrows = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rank-history.json"), "utf8")).seasons["2026"];
  assert.deepStrictEqual(Object.keys(shots.weeks), ["1", "2", "3", "4", "5", "6"]);
  for (const [week, rows] of Object.entries(shots.weeks)) {
    const i = Number(week) - 1;
    assert.strictEqual(rows.length, 12);
    // the transcription itself: a week's playoff and bye odds add up, and every move is last week's rank minus this week's
    assert.strictEqual(Math.round(rows.reduce((n, r) => n + r.playoffPct, 0) * 10) / 10, 600, `week ${week}: playoff % adds to 600`);
    assert.strictEqual(Math.round(rows.reduce((n, r) => n + r.byePct, 0) * 10) / 10, 200, `week ${week}: bye % adds to 200`);
    rows.forEach((r) => {
      assert.strictEqual(history.ranks[r.team].weekly[i], r.rank, `${r.team} Week ${week} rank`);
      assert.strictEqual(history.scores[r.team].weekly[i], r.prScore, `${r.team} Week ${week} PR Score`);
      assert.strictEqual(history.playoffOdds[r.team][i], r.playoffPct, `${r.team} Week ${week} playoff odds`);
      assert.strictEqual(arrows[week][r.team], r.rank, `${r.team} Week ${week}: the up/down-arrow history has the same rank`);
      const before = Number(week) === 1 ? arrows["0"][r.team] : arrows[String(Number(week) - 1)][r.team];
      assert.strictEqual(before - r.rank, r.rankMove, `${r.team} Week ${week}: the arrow shown then`);
    });
  }
});

test("committed data: Week 7 of the 2026 Power Rank History, the Δ-arrow history and the snapshot are the numbers the live Power Rankings page showed (league manager's screenshot), not an offline re-run", () => {
  const shot = JSON.parse(fs.readFileSync(path.join(__dirname, "helpers", "power-rankings-week-7.json"), "utf8"));
  const history = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rank-csv-history.json"), "utf8")).seasons["2026"];
  const arrows = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rank-history.json"), "utf8")).seasons["2026"];
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rankings-snapshot.json"), "utf8"));
  assert.strictEqual(shot.rows.length, 12);
  // the transcription: odds add to 600, scores are in rank order, and each move is Week 6's rank minus Week 7's
  assert.strictEqual(Math.round(shot.rows.reduce((n, r) => n + r.playoffPct, 0) * 10) / 10, 600);
  shot.rows.forEach((r, i) => {
    assert.strictEqual(r.rank, i + 1);
    if (i) assert.ok(r.prScore > shot.rows[i - 1].prScore, `${r.team}: scores rise down the table`);
    assert.strictEqual(arrows["6"][r.team] - r.rank, r.rankMove, `${r.team}: the arrow shown on the page`);
  });
  for (const r of shot.rows) {
    assert.strictEqual(history.ranks[r.team].weekly[6], r.rank, `${r.team} Week 7 rank`);
    assert.strictEqual(history.scores[r.team].weekly[6], r.prScore, `${r.team} Week 7 PR Score`);
    assert.strictEqual(history.playoffOdds[r.team][6], r.playoffPct, `${r.team} Week 7 playoff odds`);
    assert.strictEqual(arrows["7"][r.team], r.rank, `${r.team} Week 7 arrow-history rank`);
    const row = snapshot.rows.find((x) => x.teamName === r.team);
    assert.strictEqual(snapshot.week, 7);
    assert.strictEqual(row.powerRank, r.rank, `${r.team} snapshot rank`);
    assert.strictEqual(row.prScore, r.prScore, `${r.team} snapshot PR Score`);
    assert.strictEqual(row.playoffPct, r.playoffPct, `${r.team} snapshot playoff odds`);
    assert.strictEqual(row.rosRank, r.rosRank, `${r.team} snapshot ROS rank`);
    assert.strictEqual(row.record, r.record, `${r.team} record`);
    assert.strictEqual(row.overallRecord, r.overall, `${r.team} Ovr record`);
  }
  assert.deepStrictEqual(snapshot.rows.map((x) => x.teamName), shot.rows.map((r) => r.team), "snapshot rows are in table order");
});

test("buildExtrasForRun: the run's extras carry the snapshot's season, week and timestamp, and are built from the same finished weeks and rows", () => {
  const { loadSiteModules } = require("../scripts/lib/load-site-modules.js");
  const { finishedWeeksOf } = require("../scripts/lib/finished-weeks.js");
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rankings-snapshot.json"), "utf8"));
  if (snapshot.preseason) return;
  const archive = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sleeper-archive", `${snapshot.season}.json`), "utf8"));
  const scheduleWeeks = archive.weeks.map((w) => ({ week: w.week, matchups: w.matchups }));
  const scored = scheduleWeeks.filter((w) => w.matchups.some((m) => (m.points || 0) > 0));
  const weeks = finishedWeeksOf(archive, scored, archive.nflWeek == null ? null : archive.nflWeek);
  if (!weeks.length || Math.max(...weeks.map((w) => w.week)) !== snapshot.week) return; // the saved season has moved on; the next run catches the files up
  const { DeepHistory } = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
  const directory = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "players-slim.json"), "utf8")).players;
  const pr = { week: snapshot.week, rows: snapshot.rows };
  const out = buildExtrasForRun(DeepHistory, {
    season: snapshot.season, pr, generatedAt: snapshot.generatedAt,
    currentSeasonEntry: { league: archive.league, rosters: archive.rosters, users: archive.users },
    deep: { weeks, scheduleWeeks }, playerDirectory: directory,
    teamStrengthTeams: JSON.parse(fs.readFileSync(path.join(ROOT, "data", "team-strength.json"), "utf8")).teams,
  });
  const extrasPath = path.join(ROOT, "data", "power-rankings-extras.json");
  if (!fs.existsSync(extrasPath)) return; // a repo has no extras file until the updated workflow has run once
  const committed = JSON.parse(fs.readFileSync(extrasPath, "utf8"));
  assert.strictEqual(out.season, String(snapshot.season));
  assert.strictEqual(out.week, snapshot.week);
  assert.strictEqual(out.generatedAt, snapshot.generatedAt);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.sos)), committed.sos);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.scores)), committed.scores);
  assert.strictEqual(out.slots.rows.length, snapshot.rows.length, "every team has a slot row");
  assert.deepStrictEqual(out.slots.columns.map((c) => c.key), committed.slots.columns.map((c) => c.key));
});

test("the real engine and the real saved season: running the newest week again leaves every earlier week exactly as it is on file", () => {
  const { loadSiteModules } = require("../scripts/lib/load-site-modules.js");
  const { finishedWeeksOf } = require("../scripts/lib/finished-weeks.js");
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rankings-snapshot.json"), "utf8"));
  if (snapshot.preseason) return;
  const saved = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rank-csv-history.json"), "utf8")).seasons[snapshot.season];
  const archive = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sleeper-archive", `${snapshot.season}.json`), "utf8"));
  const scheduleWeeks = archive.weeks.map((w) => ({ week: w.week, matchups: w.matchups }));
  const scored = scheduleWeeks.filter((w) => w.matchups.some((m) => (m.points || 0) > 0));
  const weeks = finishedWeeksOf(archive, scored, archive.nflWeek == null ? null : archive.nflWeek);
  if (!weeks.length || Math.max(...weeks.map((w) => w.week)) !== snapshot.week) return; // the saved season has moved on
  const { DeepHistory } = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
  let simulated = 0;
  const watching = { ...DeepHistory, computePowerRankings: (...args) => { simulated += 1; return DeepHistory.computePowerRankings(...args); } };
  // A different ROS file than the one the history was made with, the way next week's will be.
  const shuffledStrength = {};
  Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "team-strength.json"), "utf8")).teams).forEach((name, i) => (shuffledStrength[name] = { rank: 12 - i, pt: i * 3 }));
  const out = buildCsvHistoryForCurrentSeason(watching, { league: archive.league, rosters: archive.rosters, users: archive.users }, { weeks, scheduleWeeks }, {}, shuffledStrength, 10, snapshot.week, { rows: snapshot.rows }, { saved });
  assert.strictEqual(simulated, 0, "no past week was re-simulated");
  for (const key of ["ranks", "scores"]) {
    Object.keys(saved[key]).forEach((team) => assert.deepStrictEqual(out[key][team].weekly, saved[key][team].weekly, `${team}: ${key} are untouched`));
  }
  Object.keys(saved.playoffOdds).forEach((team) => assert.deepStrictEqual(out.playoffOdds[team], saved.playoffOdds[team], `${team}: playoff odds are untouched`));
});

/* ---------------------------------------------------------------------------
   The simulation runs 10,000 seasons, and says so in the snapshot.
   --------------------------------------------------------------------------- */
test("the update script simulates 10,000 seasons and records that in the snapshot; the engine's own default agrees", () => {
  const script = fs.readFileSync(path.join(ROOT, "scripts", "update-power-rankings.js"), "utf8");
  assert.match(script, /const PLAYOFF_SIM_ITERATIONS = 10000;/);
  assert.match(script, /simRuns: pr\.simRuns,/);
  assert.match(script, /buildExtrasForRun\(DeepHistory, \{[^}]*teamStrengthTeams,[^}]*\}\);/, "the run hands team-strength.json to the extras so the Road Ahead can use ROS");
  const engine = fs.readFileSync(path.join(ROOT, "js", "deep-history.js"), "utf8");
  assert.match(engine, /computePowerRankings\(seasonEntry, deep, playerDirectory, teamStrengthTeams, iterations = 10000\)/);
  assert.match(engine, /simRuns: iterations,/);
});

function realSeason() {
  const { loadSiteModules } = require("../scripts/lib/load-site-modules.js");
  const { finishedWeeksOf } = require("../scripts/lib/finished-weeks.js");
  const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "power-rankings-snapshot.json"), "utf8"));
  if (snapshot.preseason) return null;
  const archive = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sleeper-archive", `${snapshot.season}.json`), "utf8"));
  const scheduleWeeks = archive.weeks.map((w) => ({ week: w.week, matchups: w.matchups }));
  const scored = scheduleWeeks.filter((w) => w.matchups.some((m) => (m.points || 0) > 0));
  const weeks = finishedWeeksOf(archive, scored, archive.nflWeek == null ? null : archive.nflWeek);
  if (!weeks.length) return null;
  const { DeepHistory } = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
  const directory = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "players-slim.json"), "utf8")).players;
  const strength = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "team-strength.json"), "utf8")).teams;
  return { DeepHistory, entry: { league: archive.league, rosters: archive.rosters, users: archive.users }, deep: { weeks, scheduleWeeks }, directory, strength };
}

test("computePowerRankings: reports how many runs it made, and every team's finish chances add up to 100%", () => {
  const real = realSeason();
  if (!real) return;
  const pr = real.DeepHistory.computePowerRankings(real.entry, real.deep, real.directory, real.strength, 500);
  assert.strictEqual(pr.simRuns, 500);
  pr.rows.forEach((row) => {
    assert.strictEqual(row.finishDistribution.length, pr.rows.length);
    assert.ok(Math.abs(row.finishDistribution.reduce((a, b) => a + b, 0) - 100) < 1e-6, `${row.teamName} sums to 100`);
  });
});

test("10,000 runs: odds come in steps of 0.01%, so a long shot shows up as a number, and two separate runs agree to within a few points", () => {
  const real = realSeason();
  if (!real) return;
  const run = () => real.DeepHistory.computePowerRankings(real.entry, real.deep, real.directory, real.strength, 10000);
  const a = run();
  const b = run();
  assert.strictEqual(a.simRuns, 10000);
  a.rows.forEach((row) => row.finishDistribution.forEach((v) => assert.ok(Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, `${v} is a whole number of runs out of 10,000`)));
  const byName = new Map(b.rows.map((r) => [r.teamName, r]));
  a.rows.forEach((row) => assert.ok(Math.abs(row.playoffPct - byName.get(row.teamName).playoffPct) < 3, `${row.teamName}: ${row.playoffPct} vs ${byName.get(row.teamName).playoffPct}`));
});

// ------------------------------------------------------------------
// the MVP race that the weekly run writes into data/power-rankings-extras.json
// ------------------------------------------------------------------
const { loadSiteModules } = require("./helpers/site-env.js");
const { buildLeague } = require("./helpers/metrics-fixture.js");
const { buildMvpRaceForRun, pointsPerWinFromArchive } = require("../scripts/update-power-rankings.js");

function raceInputs() {
  const ppg = { q1: 30, q2: 24, q3: 22, q4: 20, rb1: 18, rb2: 16, rb3: 14, rb4: 12, w1: 15, w2: 13, w3: 11, w4: 10 };
  const pos = (pid) => (pid.startsWith("q") ? "QB" : pid.startsWith("rb") ? "RB" : "WR");
  const players = {};
  Object.keys(ppg).forEach((pid) => (players[pid] = { position: pos(pid), name: pid }));
  return buildLeague({
    status: "in_season",
    rosterPositions: ["QB", "RB", "WR", "BN"],
    players,
    playoffStart: 15,
    weeks: [1, 2, 3, 4, 5, 6, 7],
    rosterOf: (rid) => [`q${rid}`, `rb${rid}`, `w${rid}`],
    pointsOf: (pid) => ppg[pid],
  });
}

test("buildMvpRaceForRun: projects to the last regular-season week of the league's own calendar, and carries the points-per-win it used", () => {
  const { Metrics } = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "metrics.js"]);
  const league = raceInputs();
  const race = buildMvpRaceForRun(Metrics, {
    currentSeasonEntry: league.seasonEntry,
    deep: league.deep,
    playerDirectory: league.playerDirectory,
    injuriesData: { players: {} },
    pointsPerWin: 90,
    sims: 1000,
  });
  assert.strictEqual(race.throughWeek, 7);
  assert.strictEqual(race.remainingWeeks, 7); // regular season is weeks 1-14
  assert.strictEqual(race.pointsPerWin, 90);
  assert.strictEqual(race.rows[0].player, "q1");
  assert.ok(Math.abs(race.rows[0].wins - race.rows[0].par / 90) < 1e-9);
});

test("pointsPerWinFromArchive: a believable number of season points per win from the saved seasons", () => {
  const { Metrics } = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "metrics.js"]);
  const ppw = pointsPerWinFromArchive(Metrics);
  assert.ok(Number.isFinite(ppw) && ppw > 20 && ppw < 300, `points per win ${ppw}`);
});
