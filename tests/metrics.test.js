const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");
const { buildLeague, injuriesFor } = require("./helpers/metrics-fixture.js");

const ctxSite = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "metrics.js"]);
const { Metrics } = ctxSite;

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `expected ${a} to be within ${eps} of ${b}`);

function prepare(league, injuries) {
  return Metrics.prepareSeason(league.seasonEntry, league.deep, league.playerDirectory, injuries || null);
}

// ------------------------------------------------------------------
// small helpers
// ------------------------------------------------------------------
test("bestLineup: fills the strict slots first, then FLEX and SUPER_FLEX from what is left", () => {
  const slots = ["QB", "RB", "WR", "FLEX", "SUPER_FLEX"];
  const cands = [
    { pid: "qb1", pos: "QB", pts: 20 },
    { pid: "qb2", pos: "QB", pts: 18 },
    { pid: "rb1", pos: "RB", pts: 15 },
    { pid: "rb2", pos: "RB", pts: 14 },
    { pid: "wr1", pos: "WR", pts: 10 },
  ];
  // QB 20, RB 15, WR 10, FLEX = rb2 (14), SUPER_FLEX = qb2 (18)
  assert.strictEqual(Metrics.bestLineupScore(slots, cands), 77);
});

test("bestLineup: a quarterback can not fill a FLEX slot", () => {
  const picked = Metrics.bestLineup(["FLEX"], [
    { pid: "qb", pos: "QB", pts: 30 },
    { pid: "wr", pos: "WR", pts: 5 },
  ]);
  assert.strictEqual(picked.length, 1);
  assert.strictEqual(picked[0].pid, "wr");
});

test("makeRng: the same seed repeats exactly, different seeds differ, and normals centre on their mean", () => {
  const a = Metrics.makeRng(7);
  const b = Metrics.makeRng(7);
  const c = Metrics.makeRng(8);
  const first = Array.from({ length: 5 }, () => a.uniform());
  const again = Array.from({ length: 5 }, () => b.uniform());
  const other = Array.from({ length: 5 }, () => c.uniform());
  assert.strictEqual(first.join(), again.join());
  assert.notStrictEqual(first.join(), other.join());
  first.forEach((u) => assert.ok(u >= 0 && u < 1));
  const r = Metrics.makeRng(3);
  const draws = Array.from({ length: 4000 }, () => r.normal(10, 3));
  close(Metrics.mean(draws), 10, 0.3);
});

test("pointsPerWin: the slope of points against wins over finished seasons, 85.8 with nothing to measure", () => {
  const season = {
    complete: true,
    rosters: [10, 8, 6, 4].map((w, i) => ({ settings: { wins: w, losses: 14 - w, ties: 0, fpts: 2000 - 100 * i, fpts_decimal: 0 } })),
  };
  // every two wins is 100 points -> 50 points per win
  close(Metrics.pointsPerWin([season]), 50);
  assert.strictEqual(Metrics.pointsPerWin([{ complete: false, rosters: [] }]), 85.8);
});

// ------------------------------------------------------------------
// replacement level and the injury credit
// ------------------------------------------------------------------
function injuryCreditLeague() {
  return buildLeague({
    teams: 2,
    rosterPositions: ["QB", "RB", "WR", "BN"],
    players: {
      q1: { position: "QB" },
      q2: { position: "QB" },
      rbS: { position: "RB", name: "Star Back" },
      rbT: { position: "RB" },
      w1: { position: "WR" },
      w2: { position: "WR" },
    },
    rosterOf: (rid) => (rid === 1 ? ["q1", "rbS", "w1"] : ["q2", "rbT", "w2"]),
    pointsOf: (pid, week) => ({ q1: 20, q2: 20, rbS: [5, 6].includes(week) ? 0 : 20, rbT: 10, w1: 12, w2: 12 })[pid],
  });
}

test("replacement level is the weakest player who wins a starting slot, measured per regular-season week", () => {
  const ctx = prepare(injuryCreditLeague());
  assert.strictEqual(ctx.regWeeks.length, 6);
  // two RB slots, two RBs score: the lower season total (60) sets the bar
  close(ctx.replacementPerWeek.RB, 10);
  close(ctx.replacementPerWeek.QB, 20);
});

test("playerValue: weeks on the injury report earn half his healthy surplus instead of nothing", () => {
  const league = injuryCreditLeague();
  const ctx = prepare(league, injuriesFor("2024", { rbS: [5, 6] }));
  const v = Metrics.playerValue(ctx, "rbS", "RB");
  assert.strictEqual(v.injuredWeeks, 2);
  assert.strictEqual(v.gamesPlayed, 4);
  // 4 healthy weeks of (20 - 10) = 40, plus 50% x 2 weeks x 10 = 10
  close(v.value, 50);
  // with no credit he would be worth just the 40 he actually earned
  close(Metrics.playerValue(ctx, "rbS", "RB", 0).value, 40);
});

test("parTable: points above replacement only count games he played", () => {
  const ctx = prepare(injuryCreditLeague());
  const row = Metrics.parTable(ctx).get("rbS");
  assert.strictEqual(row.gp, 4);
  close(row.par, 40);
  assert.strictEqual(row.positionRank, 1);
});

// ------------------------------------------------------------------
// draft grades
// ------------------------------------------------------------------
const ROUNDS = ["QB", "RB", "WR", "K", "DEF"]; // picks 1-4, 5-8, 9-12, 13-16, 17-20 (4 teams)

// One draft per season: pick n scores a smooth, falling ppg so nothing is a
// standout except the two picks the tests plant.
function draftSeason(season, status, planted) {
  const players = {};
  const picks = [];
  const ppg = {};
  for (let n = 1; n <= 20; n++) {
    const pos = ROUNDS[Math.floor((n - 1) / 4)];
    const pid = `${pos}-${season}-${n}`;
    players[pid] = { position: pos, name: `P${season}-${n}` };
    picks.push({ pick_no: n, round: Math.floor((n - 1) / 4) + 1, roster_id: ((n - 1) % 4) + 1, player_id: pid, metadata: { position: pos } });
    ppg[pid] = pos === "K" ? 8 - (n - 13) * 0.2 : pos === "DEF" ? 7 - (n - 17) * 0.2 : 30 - n;
  }
  Object.entries(planted || {}).forEach(([n, v]) => {
    const pos = ROUNDS[Math.floor((n - 1) / 4)];
    ppg[`${pos}-${season}-${n}`] = v;
  });
  if (season === "2023") {
    // a pick who never made a roster: should be worth zero, not a debt
    players["RB-ghost"] = { position: "RB", name: "Ghost" };
    picks.push({ pick_no: 21, round: 6, roster_id: 1, player_id: "RB-ghost", metadata: { position: "RB" } });
  }
  const byRoster = { 1: [], 2: [], 3: [], 4: [] };
  picks.forEach((p) => p.player_id !== "RB-ghost" && byRoster[p.roster_id].push(p.player_id));
  return buildLeague({ season, status, players, picks, rosterOf: (rid) => byRoster[rid], pointsOf: (pid) => ppg[pid] });
}

function draftHistory() {
  return [
    draftSeason("2018", "complete"),
    draftSeason("2019", "complete"),
    draftSeason("2020", "complete"),
    draftSeason("2021", "complete", { 14: 40 }), // a kicker having the year of his life
    draftSeason("2022", "complete", { 11: 50 }), // a round-3 receiver far above anything near his slot
    draftSeason("2023", "complete"),
    draftSeason("2024", "in_season"),
  ];
}

function gradeAll() {
  const ctxs = draftHistory().map((l) => prepare(l));
  return { ctxs, graded: Metrics.gradeDrafts(ctxs) };
}

test("gradeDrafts: S+ goes to the single best pick in league history, and is a real grade on the pick", () => {
  const { graded } = gradeAll();
  assert.strictEqual(graded.splus.length, 1);
  const top = graded.splus[0];
  assert.strictEqual(top.player, "P2022-11");
  assert.strictEqual(top.grade, "S+");
  assert.strictEqual(graded.bySeason.get("2022").get(11).grade, "S+");
  assert.ok(top.valueOverSlot > 100);
});

test("gradeDrafts: S+ is rare: round(0.5%) of the graded picks, none when there are too few", () => {
  const { ctxs } = gradeAll();
  // 6 finished seasons of 20 picks + the ghost = 121 graded picks -> round(0.6) = 1
  assert.strictEqual(Metrics.gradeDrafts(ctxs).splus.length, 1);
  // two seasons is 40 picks: 0.5% of that is 0.2 of a pick, so no S+ at all
  assert.strictEqual(Metrics.gradeDrafts(ctxs.slice(3, 5)).splus.length, 0);
});

test("gradeDrafts: kickers and defenses can never grade above B, and are never S+", () => {
  const { graded } = gradeAll();
  const kicker = graded.bySeason.get("2021").get(14);
  assert.ok(kicker.valueOverSlot > 100, "the planted kicker has an outstanding year");
  assert.strictEqual(kicker.grade, "B");
  graded.bySeason.forEach((picks) => {
    picks.forEach((r) => {
      if (r.position === "K" || r.position === "DEF") assert.ok(!["S+", "S", "A"].includes(r.grade), `${r.player} graded ${r.grade}`);
    });
  });
  assert.ok(!graded.splus.some((r) => r.position === "K" || r.position === "DEF"));
});

test("gradeDrafts: a season still being played is not graded, and does not feed anyone else's grade", () => {
  const { ctxs, graded } = gradeAll();
  graded.bySeason.get("2024").forEach((r) => {
    assert.strictEqual(r.ungraded, true);
    assert.strictEqual(r.grade, null);
    assert.strictEqual(r.value, null);
  });
  // leaving it out changes nothing for the finished seasons
  const without = Metrics.gradeDrafts(ctxs.slice(0, 6));
  graded.bySeason.get("2022").forEach((r, pickNo) => {
    assert.strictEqual(without.bySeason.get("2022").get(pickNo).grade, r.grade);
  });
});

test("gradeDrafts: the letter follows the percentile among same-slot peers, with no extra tiers", () => {
  const { graded } = gradeAll();
  const bandFor = (p) => Metrics.GRADE_BANDS.find((b) => p >= b.min).grade;
  let checked = 0;
  graded.bySeason.forEach((picks) => {
    picks.forEach((r) => {
      if (r.ungraded || r.grade === "S+" || r.position === "K" || r.position === "DEF") return;
      assert.strictEqual(r.grade, bandFor(r.percentile), `${r.player}: ${r.percentile}`);
      checked += 1;
    });
  });
  assert.ok(checked > 60);
  assert.deepStrictEqual(Array.from(Metrics.GRADE_ORDER), ["S+", "S", "A", "B", "C", "D", "F"]);
});

test("gradeDrafts: a pick who never played is worth zero, not a negative number", () => {
  const { graded } = gradeAll();
  const ghost = graded.bySeason.get("2023").get(21);
  assert.strictEqual(ghost.value, 0);
  assert.strictEqual(ghost.totalPoints, 0);
});

test("analyze: grades are computed once and pushed onto the draft pick entries the pages render", () => {
  const history = draftHistory();
  const directory = Object.assign({}, ...history.map((l) => l.playerDirectory));
  const analysis = Metrics.analyze(
    history.map((l) => l.seasonEntry),
    history.map((l) => l.deep),
    directory,
    null
  );
  assert.strictEqual(analysis.drafts(), analysis.drafts(), "memoized");
  const managers = [
    { seasons: [{ season: "2022", draftPicks: [{ pickNo: 11 }, { pickNo: 12 }] }, { season: "2024", draftPicks: [{ pickNo: 1 }] }] },
  ];
  Metrics.applyDraftGrades(managers, analysis);
  const [s2022, s2024] = managers[0].seasons;
  assert.strictEqual(s2022.draftPicks[0].grade, "S+");
  assert.strictEqual(s2022.draftPicks[0].ungraded, false);
  assert.ok(s2022.draftPicks[0].value > 150);
  assert.strictEqual(typeof s2022.draftPicks[1].valueOverSlot, "number");
  assert.strictEqual(s2024.draftPicks[0].ungraded, true);
  assert.strictEqual(s2024.draftPicks[0].grade, null);
});

// ------------------------------------------------------------------
// season awards: MVP by position, and the champion's ace
// ------------------------------------------------------------------
test("seasonAwards: League MVP is regular-season points above replacement, with a list per position", () => {
  const ctx = prepare(injuryCreditLeague());
  const awards = Metrics.seasonAwards(ctx, null, { pointsPerWin: 40 });
  assert.strictEqual(awards.mvp.All[0].player, "Star Back");
  // 4 games played (the 2 injured weeks scored nothing) x (20 - 10)
  close(awards.mvp.All[0].par, 40);
  close(awards.mvp.All[0].wins, 1); // 40 points at 40 points per win
  assert.strictEqual(awards.mvp.All[0].owner, "manager1");
  assert.strictEqual(awards.championsAce, null);
});

test("seasonAwards: positional MVPs are filters over the same ranking, not a different one", () => {
  const ctx = prepare(injuryCreditLeague());
  const awards = Metrics.seasonAwards(ctx, null, { pointsPerWin: 40 });
  Metrics.KNOWN_POSITIONS.forEach((pos) => {
    awards.mvp[pos].forEach((r) => assert.strictEqual(r.position, pos));
  });
  const all = awards.mvp.All.filter((r) => r.position === "RB").map((r) => r.player);
  assert.strictEqual(awards.mvp.RB[0].player, all[0]);
});

// ------------------------------------------------------------------
// waiver and free-agent pickups
// ------------------------------------------------------------------
function wireLeague() {
  const players = {};
  const ppg = {
    q1: 20, q2: 20, q3: 20, q4: 20,
    rb1: 15, rb2: 15, rb3: 15, rb4: 15,
    w1: 10, w2: 10, w3: 10, w4: 10,
    wrP: 15, wrQ: 14,
    k1: 8, k2: 8, k3: 8, k4: 8, kP: 12,
    d1: 6, d2: 6, d3: 6, d4: 6,
  };
  const pos = (pid) => (pid.startsWith("q") ? "QB" : pid.startsWith("rb") ? "RB" : pid.startsWith("d") ? "DEF" : pid.startsWith("k") ? "K" : "WR");
  Object.keys(ppg).forEach((pid) => {
    players[pid] = { position: pos(pid), name: pid };
  });
  const rosterOf = (rid, week) => {
    if (rid === 1) return ["q1", "rb1", week < 3 ? "w1" : "wrP", "k1", "d1"];
    if (rid === 2) return ["q2", "rb2", "w2", week < 2 ? "k2" : "kP", "d2"];
    if (rid === 3) return ["q3", "rb3", "w3", "k3", "d3"];
    return ["q4", "rb4", week < 4 ? "w4" : "wrQ", "k4", "d4"];
  };
  return buildLeague({
    players,
    weeks: [1, 2, 3, 4, 5, 6, 7, 8],
    rosterOf,
    pointsOf: (pid) => ppg[pid],
    // week 7: 1v4 and 2v3; week 8: the final (p:1) and a 5th-place game (p:5)
    bracket: [
      { r: 1, m: 1, t1: 1, t2: 4, w: 1, l: 4 },
      { r: 1, m: 2, t1: 2, t2: 3, w: 2, l: 3 },
      { r: 2, m: 3, t1: 1, t2: 2, w: 1, l: 2, p: 1 },
      { r: 2, m: 4, t1: 4, t2: 3, w: 4, l: 3, p: 5 },
    ],
    transactions: [
      { transaction_id: "a", type: "waiver", status: "complete", leg: 3, adds: { wrP: 1 }, drops: { w1: 1 }, settings: { waiver_bid: 12 } },
      { transaction_id: "b", type: "free_agent", status: "complete", leg: 4, adds: { wrQ: 4 }, drops: { w4: 4 }, settings: {} },
      { transaction_id: "c", type: "waiver", status: "complete", leg: 2, adds: { kP: 2 }, drops: { k2: 2 }, settings: { waiver_bid: 0 } },
      { transaction_id: "d", type: "waiver", status: "failed", leg: 2, adds: { rb4: 4 }, drops: {}, settings: { waiver_bid: 50 } },
    ],
  });
}

test("wire: value is points above replacement in games he started for the claimer, playoff games on the title path included", () => {
  const ctx = prepare(wireLeague());
  const rw = ctx.replacementPerWeek.WR;
  close(rw, 7); // starters: wrP 60, w2 60, w3 60, wrQ 42 over 6 weeks
  const { pickups } = Metrics.wire(ctx);
  const wr = pickups.find((p) => p.player === "wrP");
  assert.strictEqual(wr.type, "waiver");
  assert.strictEqual(wr.bid, 12);
  // started weeks 3-6 and both playoff games (weeks 7, 8): 6 games
  assert.strictEqual(wr.startedWeeks, 6);
  close(wr.value, 6 * (15 - rw));
});

test("wire: a playoff game that is not on the path to 1st or 3rd place (the 5th-place game) does not count", () => {
  const ctx = prepare(wireLeague());
  const rw = ctx.replacementPerWeek.WR;
  const { pickups } = Metrics.wire(ctx);
  const fa = pickups.find((p) => p.player === "wrQ");
  assert.strictEqual(fa.type, "free_agent");
  assert.strictEqual(fa.bid, 0);
  // weeks 4, 5, 6 and the week-7 semifinal; his team is only in the 5th-place game in week 8
  assert.strictEqual(fa.startedWeeks, 4);
  assert.strictEqual(fa.heldWeeks, 4);
  close(fa.value, 4 * (14 - rw));
});

test("wire: a kicker or defense counts 40% as much, so only an outstanding one makes a list", () => {
  const ctx = prepare(wireLeague());
  const { pickups } = Metrics.wire(ctx);
  const kicker = pickups.find((p) => p.player === "kP");
  // 7 started games (weeks 2-8) at 12 against an 8-point replacement kicker
  close(kicker.rawValue, 7 * (12 - 8));
  close(kicker.value, kicker.rawValue * 0.4);
  // the same raw edge on a skill player would out-rank him
  assert.strictEqual(pickups[pickups.length - 1].player, "kP");
});

test("wire: failed claims are ignored, and the manager totals add up the claims", () => {
  const ctx = prepare(wireLeague());
  const wire = Metrics.wire(ctx);
  assert.strictEqual(wire.pickups.length, 3);
  assert.ok(!wire.pickups.some((p) => p.player === "rb4"));
  const m1 = wire.managers.find((m) => m.rosterId === 1);
  assert.strictEqual(m1.claims, 1);
  assert.strictEqual(m1.faab, 12);
});

test("faabPointsPerDollar: what a dollar bought, from the claims that actually cost something", () => {
  const ctx = prepare(wireLeague());
  const wire = Metrics.wire(ctx);
  const wr = wire.pickups.find((p) => p.player === "wrP");
  // only the $12 claim has a price; free agents and $0 bids say nothing about price
  close(Metrics.faabPointsPerDollar([wire]), wr.rawValue / 12);
  assert.strictEqual(Metrics.faabPointsPerDollar([{ pickups: [] }]), 0);
});

// ------------------------------------------------------------------
// trades
// ------------------------------------------------------------------
function tradeLeague(opts) {
  const o = Object.assign({ status: "complete", faab: 0, injured: false }, opts || {});
  const ppg = { qA: 20, rA1: 12, rA2: 11, wA: 10, wA2: 6, qB: 20, rS: 25, rB: 8, wB: 10, wB2: 7 };
  const pos = (pid) => (pid.startsWith("q") ? "QB" : pid.startsWith("r") ? "RB" : "WR");
  const players = {};
  Object.keys(ppg).forEach((pid) => (players[pid] = { position: pos(pid), name: pid }));
  const before = { 1: ["qA", "rA1", "rA2", "wA", "wA2"], 2: ["qB", "rS", "rB", "wB", "wB2"] };
  const after = { 1: ["qA", "rS", "wA", "wA2"], 2: ["qB", "rA1", "rA2", "rB", "wB", "wB2"] };
  return buildLeague({
    status: o.status,
    teams: 2,
    rosterPositions: ["QB", "RB", "WR", "FLEX", "BN"],
    players,
    rosterOf: (rid, week) => (week >= 4 ? after[rid] : before[rid]),
    pointsOf: (pid, week) => (o.injured && pid === "rS" && [5, 6].includes(week) ? 0 : ppg[pid]),
    transactions: [
      {
        transaction_id: "t1",
        type: "trade",
        status: "complete",
        leg: 4,
        roster_ids: [1, 2],
        adds: { rS: 1, rA1: 2, rA2: 2 },
        drops: { rA1: 1, rA2: 1, rS: 2 },
        waiver_budget: o.faab ? [{ sender: 2, receiver: 1, amount: o.faab }] : [],
      },
    ],
  });
}

const sideOf = (trade, rid) => trade.sides.find((s) => s.rosterId === rid);

test("trades: judged by the best lineup each side could field, so a 2-for-1 that lands the star wins", () => {
  const ctx = prepare(tradeLeague());
  const [trade] = Metrics.trades(ctx, { pointsPerWin: 100, faabPointsPerDollar: 0 });
  assert.strictEqual(trade.pending, false);
  assert.strictEqual(trade.weeksCounted, 3); // weeks 4, 5, 6
  const a = sideOf(trade, 1); // gave two depth backs, got the 25-point star
  const b = sideOf(trade, 2);
  // A: 20+25+10+6 = 61 against 20+12+10+11 = 53 -> +8 a week
  close(a.lineupPoints, 24);
  // B: 20+12+10+11 = 53 against 20+25+10+8 = 63 -> -10 a week
  close(b.lineupPoints, -30);
  close(a.wins, 0.24);
  close(b.wins, -0.3);
  assert.strictEqual(trade.winnerRosterId, 1);
  assert.strictEqual(a.startedWeeks, 3);
});

test("trades: FAAB changing hands is converted to points at the league's own rate", () => {
  const ctx = prepare(tradeLeague({ faab: 10 }));
  const [trade] = Metrics.trades(ctx, { pointsPerWin: 100, faabPointsPerDollar: 0.8 });
  const a = sideOf(trade, 1);
  const b = sideOf(trade, 2);
  assert.strictEqual(a.faabNet, 10);
  assert.strictEqual(b.faabNet, -10);
  close(a.faabPoints, 8);
  close(a.totalPoints, 32);
  close(b.totalPoints, -38);
  close(a.wins, 0.32);
});

test("trades: a traded player on the injury report is credited half his healthy average, not zero", () => {
  const ctx = prepare(tradeLeague({ injured: true }), injuriesFor("2024", { rS: [5, 6] }));
  const [trade] = Metrics.trades(ctx, { pointsPerWin: 100, faabPointsPerDollar: 0 });
  // week 4: +8. Weeks 5-6 he is credited 12.5: A 20+12.5+10+6 = 48.5 vs 53 -> -4.5 each
  close(sideOf(trade, 1).lineupPoints, 8 - 4.5 - 4.5);
  // B's counterfactual has him back at 12.5 -> 50.5 vs 53 actual: +2.5 each, after -10 in week 4
  close(sideOf(trade, 2).lineupPoints, -10 + 2.5 + 2.5);
});

test("trades: a trade in a season that is still going is pending", () => {
  const ctx = prepare(tradeLeague({ status: "in_season" }));
  const [trade] = Metrics.trades(ctx, { pointsPerWin: 100, faabPointsPerDollar: 0 });
  assert.strictEqual(trade.pending, true);
});

// ------------------------------------------------------------------
// injury luck
// ------------------------------------------------------------------
function injuryLuckLeague(variant) {
  const ppg = { q1: 20, q2: 20, rbS: 25, rbBk: 8, rbT: 9 };
  const players = { q1: { position: "QB" }, q2: { position: "QB" }, rbS: { position: "RB", name: "Star Back" }, rbBk: { position: "RB" }, rbT: { position: "RB" } };
  const rosterOf = (rid, week) => {
    if (rid === 2) {
      return variant === "traded" && week >= 3 ? ["q2", "rbT", "rbS"] : ["q2", "rbT"];
    }
    if (variant === "dropped" && week >= 3) return ["q1", "rbBk"];
    if (variant === "traded" && week >= 3) return ["q1", "rbBk"];
    return ["q1", "rbS", "rbBk"];
  };
  return buildLeague({
    teams: 2,
    rosterPositions: ["QB", "RB", "BN"],
    players,
    rosterOf,
    pointsOf: (pid, week) => (pid === "rbS" && [3, 4].includes(week) ? 0 : ppg[pid]),
  });
}

test("injuryLuck: counts the points a lineup lost to an injured starter, and the results it cost", () => {
  const ctx = prepare(injuryLuckLeague("held"), injuriesFor("2024", { rbS: [3, 4] }));
  const rw = ctx.replacementPerWeek.RB;
  close(rw, 9);
  const exp = (4 * 25 + 4 * 1.15 * rw) / 8; // his own average and the draft-slot baseline, 4 games' worth each
  const luck = Metrics.injuryLuck(ctx, Metrics.injuryBaseline([ctx]));
  const t1 = luck.teams.find((t) => t.rosterId === 1);
  const t2 = luck.teams.find((t) => t.rosterId === 2);
  close(t1.pointsLost, 2 * (exp - 8)); // the bench back played instead, both weeks
  assert.strictEqual(t2.pointsLost, 0);
  assert.strictEqual(t1.resultsLost, 2); // 28 against 29 in both weeks, would have won
  assert.strictEqual(t2.resultsGifted, 2);
  assert.strictEqual(luck.playerInjuries[0].player, "Star Back");
  assert.strictEqual(luck.playerInjuries[0].username, "manager1");
});

test("injuryLuck: a star dropped while hurt is charged to the last manager who held him", () => {
  const ctx = prepare(injuryLuckLeague("dropped"), injuriesFor("2024", { rbS: [3, 4] }));
  const rw = ctx.replacementPerWeek.RB;
  const exp = (2 * 25 + 4 * 1.15 * rw) / 6; // only two healthy games to go on
  const luck = Metrics.injuryLuck(ctx, Metrics.injuryBaseline([ctx]));
  const t1 = luck.teams.find((t) => t.rosterId === 1);
  const t2 = luck.teams.find((t) => t.rosterId === 2);
  close(t1.pointsLost, 2 * (exp - 8));
  assert.strictEqual(t2.pointsLost, 0);
});

test("injuryLuck: the week's holder pays, not whoever drafted him", () => {
  const ctx = prepare(injuryLuckLeague("traded"), injuriesFor("2024", { rbS: [3, 4] }));
  const luck = Metrics.injuryLuck(ctx, Metrics.injuryBaseline([ctx]));
  const t1 = luck.teams.find((t) => t.rosterId === 1);
  const t2 = luck.teams.find((t) => t.rosterId === 2);
  assert.strictEqual(t1.pointsLost, 0);
  assert.ok(t2.pointsLost > 0);
});

// ------------------------------------------------------------------
// the MVP race
// ------------------------------------------------------------------
function raceLeague() {
  const ppg = {
    q1: 30, q2: 24, q3: 22, q4: 20,
    rb1: 18, rb2: 16, rb3: 14, rb4: 12,
    w1: 15, w2: 13, w3: 11, w4: 10,
  };
  const pos = (pid) => (pid.startsWith("q") ? "QB" : pid.startsWith("rb") ? "RB" : "WR");
  const players = {};
  Object.keys(ppg).forEach((pid) => (players[pid] = { position: pos(pid), name: pid }));
  return buildLeague({
    rosterPositions: ["QB", "RB", "WR", "BN"],
    players,
    status: "in_season",
    rosterOf: (rid) => [`q${rid}`, `rb${rid}`, `w${rid}`],
    pointsOf: (pid) => ppg[pid],
  });
}

test("mvpRace: the clear leader has the best chance, chances add up, and the same seed gives the same answer", () => {
  const ctx = prepare(raceLeague());
  const race = Metrics.mvpRace(ctx, 14, { sims: 4000, top: 20, pointsPerWin: 85.8 });
  assert.strictEqual(race.throughWeek, 6);
  assert.strictEqual(race.remainingWeeks, 8);
  assert.strictEqual(race.rows[0].player, "q1");
  assert.ok(race.rows[0].chance > 40, `leader chance ${race.rows[0].chance}`);
  close(
    race.rows.reduce((a, r) => a + r.chance, 0),
    100,
    1e-6
  );
  for (let i = 1; i < race.rows.length; i++) assert.ok(race.rows[i - 1].projectedPar >= race.rows[i].projectedPar);
  // a projection is at least what he has banked, and wins are PAR over points per win
  assert.ok(race.rows[0].projectedPar > race.rows[0].par);
  close(race.rows[0].wins, race.rows[0].par / 85.8);
  const again = Metrics.mvpRace(ctx, 14, { sims: 4000, top: 20, pointsPerWin: 85.8 });
  assert.strictEqual(again.rows.map((r) => r.chance.toFixed(6)).join(), race.rows.map((r) => r.chance.toFixed(6)).join());
});

test("mvpRace: with no weeks left it is settled", () => {
  const ctx = prepare(raceLeague());
  const race = Metrics.mvpRace(ctx, 6, { sims: 500, top: 20 });
  assert.strictEqual(race.remainingWeeks, 0);
  assert.strictEqual(race.rows[0].player, "q1");
  assert.strictEqual(race.rows[0].chance, 100);
  assert.strictEqual(race.rows[1].chance, 0);
});
