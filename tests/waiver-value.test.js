const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["utils.js", "sleeper-api.js", "deep-history.js"]);
const { DeepHistory } = ctx;

// Shared 10-team league scaffold used across several scenarios below.
function makeLeague({ rosterPositions, playoffStart = 15 }) {
  const rosters = Array.from({ length: 10 }, (_, i) => ({ roster_id: i + 1, owner_id: "u" + (i + 1), settings: {} }));
  const users = Array.from({ length: 10 }, (_, i) => ({ user_id: "u" + (i + 1), display_name: "team" + (i + 1), metadata: {} }));
  const league = {
    season: "2023",
    league_id: "L1",
    status: "complete",
    name: "L",
    previous_league_id: null,
    roster_positions: rosterPositions,
    settings: { playoff_week_start: playoffStart },
  };
  return { league, rosters, users, bracket: [] };
}

test("waiver value: drop detection caps a manager's credit at the weeks they actually had the player", () => {
  const seasonEntry = makeLeague({ rosterPositions: ["WR", "WR", "BN"] });
  const playerDirectory = { nacuaLike: { position: "WR" } };
  for (let rid = 1; rid <= 10; rid++) {
    for (let s = 1; s <= 2; s++) playerDirectory[`wr_${rid}_${s}`] = { position: "WR" };
  }

  const weeks = [];
  for (let wk = 1; wk <= 14; wk++) {
    const matchups = [];
    for (let rid = 1; rid <= 10; rid++) {
      const players = [`wr_${rid}_1`, `wr_${rid}_2`];
      const pp = { [`wr_${rid}_1`]: 10, [`wr_${rid}_2`]: 10 };
      if (rid === 1 && wk <= 2) {
        players.push("nacuaLike");
        pp.nacuaLike = 26;
      }
      if (rid === 3 && wk >= 3) {
        players.push("nacuaLike");
        pp.nacuaLike = 26;
      }
      matchups.push({ roster_id: rid, matchup_id: rid, points: Object.values(pp).reduce((a, b) => a + b, 0), starters: players, players, players_points: pp });
    }
    weeks.push({ week: wk, matchups });
  }
  const transactions = [
    { type: "free_agent", status: "complete", leg: 1, roster_ids: [1], adds: { nacuaLike: 1 }, settings: {} },
    { type: "waiver", status: "complete", leg: 3, roster_ids: [3], drops: { nacuaLike: 1 }, adds: { nacuaLike: 3 }, settings: { waiver_bid: 10 } },
  ];
  const deep = { leagueId: "L1", season: "2023", weeks, scheduleWeeks: weeks, transactions, draft: null };

  const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, playerDirectory, null, null, {});
  const team1Entry = summary.top5WaiverValueAdds.find((w) => w.playerId === "nacuaLike" && w.username === "team1");
  const team3Entry = summary.top5WaiverValueAdds.find((w) => w.playerId === "nacuaLike" && w.username === "team3");

  assert.strictEqual(team1Entry.activeWeeks, 2, "manager who dropped the player after 2 weeks should be capped at 2 active weeks, not credited for the rest of the season");
  assert.strictEqual(team3Entry.activeWeeks, 12, "manager who picked the player up week 3 and kept them should get all 12 remaining weeks");
});

test("waiver value: pickup-week roster-snapshot lag doesn't wipe out an otherwise-legitimate, never-dropped pickup", () => {
  const seasonEntry = makeLeague({ rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN", "BN"] });
  const playerDirectory = { pukaLike: { position: "WR" }, week14Flash: { position: "WR" } };
  for (let i = 0; i < 18; i++) playerDirectory[`wr${i}`] = { position: "WR" };
  for (let i = 0; i < 12; i++) playerDirectory[`qb${i}`] = { position: "QB" };
  for (let i = 0; i < 20; i++) playerDirectory[`rb${i}`] = { position: "RB" };
  for (let i = 0; i < 10; i++) playerDirectory[`te${i}`] = { position: "TE" };

  const weeks = [];
  for (let wk = 1; wk <= 14; wk++) weeks.push({ week: wk, matchups: Array.from({ length: 10 }, (_, i) => ({ roster_id: i + 1, matchup_id: i + 1, points: 0, starters: [], players: [], players_points: {} })) });

  const qbRates = [24, 22, 21, 19, 18, 17.5, 17, 16.5, 16, 15.5, 15, 14.5];
  const rbRates = Array.from({ length: 20 }, (_, i) => 18 - i * 0.6);
  const wrRates = Array.from({ length: 18 }, (_, i) => 16 - i * 0.5);
  const teRates = Array.from({ length: 10 }, (_, i) => 11 - i * 0.7);

  function assignWeeklyPoints(playerId, ppgRate, ownerRosterId, startWeek = 1, endWeek = 14) {
    for (let wk = startWeek; wk <= endWeek; wk++) {
      const m = weeks[wk - 1].matchups.find((mm) => mm.roster_id === ownerRosterId);
      m.players.push(playerId);
      m.players_points[playerId] = ppgRate;
    }
  }
  qbRates.forEach((r, i) => assignWeeklyPoints(`qb${i}`, r, (i % 10) + 1));
  rbRates.forEach((r, i) => assignWeeklyPoints(`rb${i}`, r, (i % 10) + 1));
  wrRates.forEach((r, i) => assignWeeklyPoints(`wr${i}`, r, (i % 10) + 1));
  teRates.forEach((r, i) => assignWeeklyPoints(`te${i}`, r, (i % 10) + 1));

  // Puka-like: picked up week 2, roster snapshot for week 2 itself doesn't
  // yet list the player (a plausible real Sleeper timing gap between a
  // transaction's recorded week and when that week's matchup roster
  // snapshot is generated) — the pickup-week itself is intentionally
  // NOT added to `players` here, only from week 3 onward.
  for (let wk = 2; wk <= 14; wk++) {
    const m = weeks[wk - 1].matchups.find((mm) => mm.roster_id === 1);
    if (wk > 2) m.players.push("pukaLike");
    m.players_points.pukaLike = 13.5;
  }
  assignWeeklyPoints("week14Flash", 25, 2, 14, 14);

  const transactions = [
    { type: "waiver", status: "complete", leg: 2, roster_ids: [1], adds: { pukaLike: 1 }, settings: { waiver_bid: 45 } },
    { type: "waiver", status: "complete", leg: 14, roster_ids: [2], adds: { week14Flash: 2 }, settings: { waiver_bid: 0 } },
  ];
  const deep = { leagueId: "L1", season: "2023", weeks, scheduleWeeks: weeks, transactions, draft: null };

  const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, playerDirectory, null, null, {});
  const puka = summary.top5WaiverValueAdds.find((w) => w.playerId === "pukaLike");

  assert.ok(puka, "a never-dropped pickup should still appear in the list despite a same-week roster-snapshot timing gap");
  assert.strictEqual(puka.activeWeeks, 13, "should count all 13 weeks from pickup (week 2) through the end of the regular season");
});

test("waiver value: duration-weighted scoring favors sustained production over one hot week", () => {
  const seasonEntry = makeLeague({ rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN", "BN"] });
  const playerDirectory = { pukaLike: { position: "WR" }, week14Flash: { position: "WR" } };
  for (let i = 0; i < 18; i++) playerDirectory[`wr${i}`] = { position: "WR" };
  for (let i = 0; i < 12; i++) playerDirectory[`qb${i}`] = { position: "QB" };
  for (let i = 0; i < 20; i++) playerDirectory[`rb${i}`] = { position: "RB" };
  for (let i = 0; i < 10; i++) playerDirectory[`te${i}`] = { position: "TE" };

  const weeks = [];
  for (let wk = 1; wk <= 14; wk++) weeks.push({ week: wk, matchups: Array.from({ length: 10 }, (_, i) => ({ roster_id: i + 1, matchup_id: i + 1, points: 0, starters: [], players: [], players_points: {} })) });

  const qbRates = [24, 22, 21, 19, 18, 17.5, 17, 16.5, 16, 15.5, 15, 14.5];
  const rbRates = Array.from({ length: 20 }, (_, i) => 18 - i * 0.6);
  const wrRates = Array.from({ length: 18 }, (_, i) => 16 - i * 0.5);
  const teRates = Array.from({ length: 10 }, (_, i) => 11 - i * 0.7);
  function assignWeeklyPoints(playerId, ppgRate, ownerRosterId, startWeek = 1, endWeek = 14) {
    for (let wk = startWeek; wk <= endWeek; wk++) {
      const m = weeks[wk - 1].matchups.find((mm) => mm.roster_id === ownerRosterId);
      m.players.push(playerId);
      m.players_points[playerId] = ppgRate;
    }
  }
  qbRates.forEach((r, i) => assignWeeklyPoints(`qb${i}`, r, (i % 10) + 1));
  rbRates.forEach((r, i) => assignWeeklyPoints(`rb${i}`, r, (i % 10) + 1));
  wrRates.forEach((r, i) => assignWeeklyPoints(`wr${i}`, r, (i % 10) + 1));
  teRates.forEach((r, i) => assignWeeklyPoints(`te${i}`, r, (i % 10) + 1));

  assignWeeklyPoints("pukaLike", 13.5, 1, 2, 14); // sustained, 13 weeks
  assignWeeklyPoints("week14Flash", 25, 2, 14, 14); // one huge week, 1 week

  const transactions = [
    { type: "waiver", status: "complete", leg: 2, roster_ids: [1], adds: { pukaLike: 1 }, settings: { waiver_bid: 45 } },
    { type: "waiver", status: "complete", leg: 14, roster_ids: [2], adds: { week14Flash: 2 }, settings: { waiver_bid: 0 } },
  ];
  const deep = { leagueId: "L1", season: "2023", weeks, scheduleWeeks: weeks, transactions, draft: null };

  const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, playerDirectory, null, null, {});
  const puka = summary.top5WaiverValueAdds.find((w) => w.playerId === "pukaLike");
  const flash = summary.top5WaiverValueAdds.find((w) => w.playerId === "week14Flash");

  assert.ok(flash.relativeValuePerWeek > puka.relativeValuePerWeek, "the single hot week should have a higher PER-WEEK rate");
  assert.ok(puka.relativeValue > flash.relativeValue, "but sustained production should win on the CUMULATIVE score that actually determines ranking");
});

test("waiver value: position-relative scoring lets a dominant WR outrank a merely-solid streaming QB in SuperFlex, despite lower raw PPG", () => {
  const seasonEntry = makeLeague({ rosterPositions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN", "BN"] });
  const playerDirectory = { pukaLike: { position: "WR" }, howellLike: { position: "QB" } };
  for (let i = 0; i < 12; i++) playerDirectory[`qb${i}`] = { position: "QB" };
  for (let i = 0; i < 20; i++) playerDirectory[`rb${i}`] = { position: "RB" };
  for (let i = 0; i < 18; i++) playerDirectory[`wr${i}`] = { position: "WR" };
  for (let i = 0; i < 10; i++) playerDirectory[`te${i}`] = { position: "TE" };

  const weeks = [];
  for (let wk = 1; wk <= 14; wk++) weeks.push({ week: wk, matchups: Array.from({ length: 10 }, (_, i) => ({ roster_id: i + 1, matchup_id: i + 1, points: 0, starters: [], players: [], players_points: {} })) });

  const qbRates = [24, 22, 21, 19, 18, 17.5, 17, 16.5, 16, 15.5, 15, 14.5];
  const rbRates = Array.from({ length: 20 }, (_, i) => 18 - i * 0.6);
  const wrRates = Array.from({ length: 18 }, (_, i) => 16 - i * 0.5);
  const teRates = Array.from({ length: 10 }, (_, i) => 11 - i * 0.7);
  function assignWeeklyPoints(playerId, ppgRate, ownerRosterId, startWeek = 1) {
    for (let wk = startWeek; wk <= 14; wk++) {
      const m = weeks[wk - 1].matchups.find((mm) => mm.roster_id === ownerRosterId);
      m.players.push(playerId);
      m.players_points[playerId] = ppgRate;
    }
  }
  qbRates.forEach((r, i) => assignWeeklyPoints(`qb${i}`, r, (i % 10) + 1));
  rbRates.forEach((r, i) => assignWeeklyPoints(`rb${i}`, r, (i % 10) + 1));
  wrRates.forEach((r, i) => assignWeeklyPoints(`wr${i}`, r, (i % 10) + 1));
  teRates.forEach((r, i) => assignWeeklyPoints(`te${i}`, r, (i % 10) + 1));

  assignWeeklyPoints("pukaLike", 13.5, 1, 2); // dominant relative to a tight WR pool
  assignWeeklyPoints("howellLike", 20, 2, 1); // higher raw PPG, but only middling within a stacked SuperFlex QB pool

  const transactions = [
    { type: "waiver", status: "complete", leg: 2, roster_ids: [1], adds: { pukaLike: 1 }, settings: { waiver_bid: 45 } },
    { type: "waiver", status: "complete", leg: 1, roster_ids: [2], adds: { howellLike: 2 }, settings: { waiver_bid: 8 } },
  ];
  const deep = { leagueId: "L1", season: "2023", weeks, scheduleWeeks: weeks, transactions, draft: null };

  const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, playerDirectory, null, null, {});
  const puka = summary.top5WaiverValueAdds.find((w) => w.playerId === "pukaLike");
  const howell = summary.top5WaiverValueAdds.find((w) => w.playerId === "howellLike");

  assert.ok(howell.pickupPPG > puka.pickupPPG, "sanity check: Howell's raw PPG really is higher");
  assert.ok(puka.relativeValuePerWeek > howell.relativeValuePerWeek, "but Puka's position-relative value should still be higher, since he's further above a tighter WR pool");
});

test("waiver value: injury-flagged weeks are excluded from both points and the active-week count", () => {
  const seasonEntry = makeLeague({ rosterPositions: ["RB", "RB", "RB", "BN"] });
  const playerDirectory = { kyrenLike: { position: "RB" } };
  for (let rid = 1; rid <= 10; rid++) for (let s = 1; s <= 3; s++) playerDirectory[`rb_${rid}_${s}`] = { position: "RB" };

  const weeks = [];
  for (let wk = 1; wk <= 14; wk++) {
    const matchups = [];
    for (let rid = 1; rid <= 10; rid++) {
      const players = [`rb_${rid}_1`, `rb_${rid}_2`, `rb_${rid}_3`];
      const pp = {};
      players.forEach((p) => (pp[p] = 8));
      if (rid === 1) {
        players.push("kyrenLike");
        pp.kyrenLike = wk <= 3 ? 0 : 28;
      }
      matchups.push({ roster_id: rid, matchup_id: rid, points: Object.values(pp).reduce((a, b) => a + b, 0), starters: players, players, players_points: pp });
    }
    weeks.push({ week: wk, matchups });
  }
  const transactions = [{ type: "free_agent", status: "complete", leg: 1, roster_ids: [1], adds: { kyrenLike: 1 }, settings: {} }];
  const deep = { leagueId: "L1", season: "2023", weeks, scheduleWeeks: weeks, transactions, draft: null };
  const injuriesForSeason = { kyrenLike: { 1: "Out", 2: "Out", 3: "Out" } };

  const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, playerDirectory, null, null, injuriesForSeason);
  const kyren = summary.top5WaiverValueAdds.find((w) => w.playerId === "kyrenLike");

  assert.strictEqual(kyren.activeWeeks, 11, "the 3 injured weeks should be excluded from the count entirely, not counted as 0-point weeks");
  assert.strictEqual(kyren.pickupPPG, 28, "the per-week rate should reflect only the healthy weeks, not be diluted by the injured 0-point weeks");
});

test("waiver value: an unusual, non-standard transaction type (e.g. a commissioner-processed move) still counts as a pickup", () => {
  const seasonEntry = makeLeague({ rosterPositions: ["WR", "WR", "BN"] });
  const playerDirectory = { pukaLike: { position: "WR" } };
  for (let rid = 1; rid <= 10; rid++) for (let s = 1; s <= 2; s++) playerDirectory[`wr_${rid}_${s}`] = { position: "WR" };

  const weeks = [];
  for (let wk = 1; wk <= 14; wk++) {
    const matchups = [];
    for (let rid = 1; rid <= 10; rid++) {
      const players = [`wr_${rid}_1`, `wr_${rid}_2`];
      const pp = { [`wr_${rid}_1`]: 10, [`wr_${rid}_2`]: 10 };
      if (rid === 1 && wk >= 2) {
        players.push("pukaLike");
        pp.pukaLike = 24;
      }
      matchups.push({ roster_id: rid, matchup_id: rid, points: Object.values(pp).reduce((a, b) => a + b, 0), starters: players, players, players_points: pp });
    }
    weeks.push({ week: wk, matchups });
  }
  const transactions = [{ type: "commissioner", status: "complete", leg: 2, roster_ids: [1], adds: { pukaLike: 1 }, settings: {} }];
  const deep = { leagueId: "L1", season: "2023", weeks, scheduleWeeks: weeks, transactions, draft: null };

  const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, playerDirectory, null, null, {});
  assert.ok(summary.top5WaiverValueAdds.find((w) => w.playerId === "pukaLike"), "a non-'waiver'/'free_agent' but non-trade transaction type should still be treated as a genuine pickup");
});

test("waiver value: trades are correctly excluded — a trade is not a waiver pickup", () => {
  const seasonEntry = makeLeague({ rosterPositions: ["WR", "WR", "BN"] });
  const playerDirectory = { pukaLike: { position: "WR" } };
  for (let rid = 1; rid <= 10; rid++) for (let s = 1; s <= 2; s++) playerDirectory[`wr_${rid}_${s}`] = { position: "WR" };

  const weeks = [];
  for (let wk = 1; wk <= 14; wk++) {
    const matchups = [];
    for (let rid = 1; rid <= 10; rid++) {
      const players = [`wr_${rid}_1`, `wr_${rid}_2`];
      const pp = { [`wr_${rid}_1`]: 10, [`wr_${rid}_2`]: 10 };
      if (rid === 1 && wk >= 2) {
        players.push("pukaLike");
        pp.pukaLike = 24;
      }
      matchups.push({ roster_id: rid, matchup_id: rid, points: Object.values(pp).reduce((a, b) => a + b, 0), starters: players, players, players_points: pp });
    }
    weeks.push({ week: wk, matchups });
  }
  const transactions = [{ type: "trade", status: "complete", leg: 2, roster_ids: [1, 2], adds: { pukaLike: 1 }, drops: {}, settings: {} }];
  const deep = { leagueId: "L1", season: "2023", weeks, scheduleWeeks: weeks, transactions, draft: null };

  const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, playerDirectory, null, null, {});
  assert.ok(!summary.top5WaiverValueAdds.find((w) => w.playerId === "pukaLike"), "a trade should never be counted as a waiver pickup");
});
