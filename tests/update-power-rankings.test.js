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
  for (let w = 0; w < snapshot.week; w++) {
    const ranks = Object.values(year.ranks).map((t) => t.weekly[w]).sort((a, b) => a - b);
    assert.deepStrictEqual(ranks, ranks.map((_, i) => i + 1), `week ${w + 1}: ranks are 1..N once each`);
  }
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
