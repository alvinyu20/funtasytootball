/*
  The Draft page's numbers (js/draft-data.js): a pick's value / typical / vs slot (Metrics' own numbers), the
  board, rounds, teams, the table's filters and sorts, the in-season model, the report card and the best and
  costliest picks ever. Run against the real file with a small hand-made league (in the shape
  Metrics.applyDraftGrades leaves on the picks), so every number below can be checked by hand.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const setup = () => loadSiteModules(["utils.js", "sleeper-api.js", "deep-history.js", "rivalries-data.js", "draft-data.js"]);
const json = (c, code) => JSON.parse(runInLoadedContext(c, `JSON.stringify(${code})`));

const { pick, stats, D2024, D2025, D2026, META, league, draftOf } = require("./helpers/draft-fixture.js");
const byName = (list, name) => list.find((p) => p.player === name);

// ---- small helpers -----------------------------------------------------------------------------------------

test("round: halves round away from zero, so -2.5 is -3 the way 2.5 is 3", () => {
  const { DraftData } = setup();
  assert.strictEqual(DraftData.round(2.5), 3);
  assert.strictEqual(DraftData.round(-2.5), -3);
  assert.strictEqual(DraftData.round(100.5), 101);
  assert.strictEqual(DraftData.round(-20.5), -21);
  assert.strictEqual(DraftData.round(0.4), 0);
  assert.ok(Object.is(DraftData.round(-0.4), 0), "-0.4 is 0, never -0");
});

test("signed, ordinal and lastName", () => {
  const { DraftData } = setup();
  assert.strictEqual(DraftData.signed(5), "+5");
  assert.strictEqual(DraftData.signed(-5), "-5");
  assert.strictEqual(DraftData.signed(0), "0");
  assert.strictEqual(DraftData.signed(null), "");
  ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"].forEach((s) => assert.strictEqual(DraftData.ordinal(parseInt(s, 10)), s));
  assert.strictEqual(DraftData.lastName("Puka Nacua"), "Nacua");
  assert.strictEqual(DraftData.lastName("Brian Thomas Jr."), "Thomas");
  assert.strictEqual(DraftData.lastName("Marvin Harrison Jr"), "Harrison");
  assert.strictEqual(DraftData.lastName("Patrick Mahomes II"), "Mahomes");
  assert.strictEqual(DraftData.lastName("San Francisco 49ers"), "49ers");
  assert.strictEqual(DraftData.lastName("Jr."), "Jr.", "a name that is only a suffix stays as it is");
  assert.strictEqual(DraftData.lastName(""), "");
  assert.strictEqual(DraftData.lastName(null), "");
});

test("the grades are Metrics' seven letters, and S+ gets a class name CSS can use", () => {
  const { DraftData } = setup();
  assert.strictEqual(DraftData.GRADES.join(" "), "S+ S A B C D F");
  assert.strictEqual(DraftData.UPPER_GRADES.join(" "), "S+ S A", "the steals");
  assert.strictEqual(DraftData.gradeClass("S+"), "Splus", "a + cannot go in a class name");
  assert.strictEqual(DraftData.gradeClass("A"), "A");
  assert.deepStrictEqual(["S+", "S", "A", "B", "F", null].map((g) => DraftData.isUpper(g)), [true, true, true, false, false, false]);
});

test("bands: a pick's vs slot and a whole draft's total fall into five bands with their edges", () => {
  const { DraftData } = setup();
  const pickBand = (n) => DraftData.bandOfVs(n);
  assert.deepStrictEqual([60, 59, 20, 19, 0, -19, -20, -59, -60].map(pickBand), ["b5", "b4", "b4", "b3", "b3", "b3", "b2", "b2", "b1"]);
  const teamBand = (n) => DraftData.bandOfTotal(n);
  assert.deepStrictEqual([150, 149, 50, 49, 0, -49, -50, -149, -150].map(teamBand), ["b5", "b4", "b4", "b3", "b3", "b3", "b2", "b2", "b1"]);
  assert.strictEqual(pickBand(null), "none");
  assert.strictEqual(teamBand(undefined), "none");
});

// ---- one pick ------------------------------------------------------------------------------------------------

test("a graded pick: value, typical and vs slot are Metrics' numbers, rounded for display; vs slot is not worked out again from the rounded two", () => {
  const c = draftOf(setup(), 2024);
  const picks = json(c, "__D__.picks");
  const ann = byName(picks, "Ann Alpha");
  assert.strictEqual(ann.value, 100, "100.4 rounds down");
  assert.strictEqual(ann.typical, 60, "59.6 rounds up");
  assert.strictEqual(ann.vs, 41, "valueOverSlot is 40.8, which is 41 (the Teams and Seasons pages show 41 too), not 100 - 60");
  const bo = byName(picks, "Bo Beta Jr.");
  assert.strictEqual(bo.typical, 56, "55.5 rounds up");
  assert.strictEqual(bo.vs, -6, "-5.5 rounds away from zero");
  const di = byName(picks, "Di Delta");
  assert.strictEqual(di.value, 4);
  assert.strictEqual(di.vs, -66);
  assert.strictEqual(ann.grade, "A", "the grade is Metrics' too");
});

test("value and typical round to the nearest whole number (halves away from zero), not down", () => {
  const c = setup();
  c.__S2__ = stats({ 2024: [pick({ owner: "u1", pickNo: 1, round: 1, player: "Rounder", value: 70.6, typical: 20.5, grade: "A" })] }, META);
  const p = json(c, "DraftData.buildDraft(__S2__, 2024).picks[0]");
  assert.strictEqual(p.value, 71);
  assert.strictEqual(p.typical, 21);
  assert.strictEqual(p.vs, 50, "50.1 rounded");
});

test("a pick who never scored is worth 0 and keeps his grade; a pick Metrics left ungraded has no numbers at all", () => {
  const c = draftOf(setup(), 2024);
  const hal = byName(json(c, "__D__.picks"), "Hal Theta");
  assert.strictEqual(hal.value, 0);
  assert.strictEqual(hal.typical, 30);
  assert.strictEqual(hal.vs, -30);
  assert.strictEqual(hal.grade, "F");
  // no position or no peers: Metrics says ungraded, so the page shows no grade, value, typical or vs slot
  c.__S2__ = stats({ 2024: [pick({ owner: "u1", pickNo: 1, round: 1, player: "No Number", points: 12 })] }, META);
  const p = json(c, "DraftData.buildDraft(__S2__, 2024).picks[0]");
  assert.strictEqual(p.value, null);
  assert.strictEqual(p.typical, null);
  assert.strictEqual(p.vs, null);
  assert.strictEqual(p.grade, null);
  assert.strictEqual(p.points, 12, "his points are still there");
  // marked graded but with no value at all: nothing to show (never a made-up 0)
  c.__S2__ = stats({ 2024: [{ ...pick({ owner: "u1", pickNo: 1, round: 1, player: "Odd", points: 9 }), ungraded: false, grade: "B" }] }, META);
  const odd = json(c, "DraftData.buildDraft(__S2__, 2024).picks[0]");
  assert.strictEqual(odd.value, null);
  assert.strictEqual(odd.grade, null);
  // a value but no peers to compare with: Metrics marks him ungraded with no typical, and the page does not show his value alone
  c.__S2__ = stats({ 2024: [pick({ owner: "u1", pickNo: 1, round: 1, player: "No Peers", value: 55, points: 140 })] }, META);
  const q = json(c, "DraftData.buildDraft(__S2__, 2024).picks[0]");
  assert.strictEqual(q.value, null, "ungraded means no numbers, even when Metrics did measure a value");
  assert.strictEqual(q.typical, null);
  assert.strictEqual(q.vs, null);
  assert.strictEqual(q.grade, null);
});

test("a pick Metrics has not graded stays ungraded, even in a finished season (a page that forgot applyDraftGrades shows no grades)", () => {
  const c = setup();
  const raw = { pickNo: 1, round: 1, pickInRound: 1, player: "Raw", playerId: "p1", position: "WR", points: 100, isKeeper: false };
  c.__S2__ = { managers: [{ userId: "u1", username: "alvin", seasons: [{ season: "2024", draftPicks: [raw] }] }], draftSeasons: META };
  const p = json(c, "DraftData.buildDraft(__S2__, 2024).picks[0]");
  assert.strictEqual(p.grade, null);
  assert.strictEqual(p.value, null);
  assert.strictEqual(p.vs, null);
  assert.strictEqual(p.gp, null);
  assert.strictEqual(p.injWeeks, null);
});

test("capped means a kicker or defense (Metrics holds them at B); everyone else, whatever his grade, can be a steal", () => {
  const c = draftOf(setup(), 2024);
  const picks = json(c, "__D__.picks");
  assert.strictEqual(byName(picks, "Ed Epsilon").capped, true, "a kicker");
  assert.strictEqual(byName(picks, "Fay Zeta").capped, false);
  assert.strictEqual(byName(picks, "Cy Gamma").capped, false);
  assert.strictEqual(byName(picks, "Hal Theta").capped, false);
  c.__S2__ = stats({ 2024: [pick({ owner: "u1", pickNo: 1, round: 1, player: "Dee Fense", position: "DEF", value: 50, typical: 10, grade: "B" }), pick({ owner: "u2", pickNo: 2, round: 1, player: "Missed Time", position: "WR", value: 50, typical: 10, grade: "B", gamesPlayed: 5, injuredWeeks: 8 })] }, META);
  const two = json(c, "DraftData.buildDraft(__S2__, 2024).picks");
  assert.strictEqual(two[0].capped, true, "a defense");
  assert.strictEqual(two[1].capped, false, "a player who missed half the year is no longer capped: the injury credit already handles him");
});

test("a pick's games, starts and injury weeks are Metrics' (games played healthy, weeks started for the team that drafted him), and games possible is the season's weeks", () => {
  const c = draftOf(setup(), 2026);
  const ann = byName(json(c, "__D__.picks"), "Ann Alpha");
  assert.strictEqual(ann.gp, 6);
  assert.strictEqual(ann.starts, 6);
  assert.strictEqual(ann.injWeeks, 0, "a season with injury data and none for him is 0, not unknown");
  assert.strictEqual(ann.gamesPossible, 6, "the season's finished regular-season weeks");
  assert.strictEqual(byName(json(c, "__D__.picks"), "Bo Beta Jr.").injWeeks, 4);
  assert.strictEqual(byName(json(draftOf(setup(), 2024), "__D__.picks"), "Ann Alpha").gamesPossible, 17);
});

test("a pick has the facts the page shows: label, key, position rank text and how far he moved", () => {
  const c = draftOf(setup(), 2024);
  const ann = byName(json(c, "__D__.picks"), "Ann Alpha");
  assert.strictEqual(ann.key, "2024-1");
  assert.strictEqual(ann.label, "1.1");
  assert.strictEqual(ann.owner, "alvin");
  assert.strictEqual(ann.rank.text, "RB1 to RB1");
  assert.strictEqual(ann.rank.delta, 0);
  const s = stats({ 2024: [pick({ owner: "u1", pickNo: 1, round: 1, player: "Mover", position: "WR", positionDraftRank: 13, positionFinishRank: 2, value: 1, typical: 1, grade: "B" })] }, META);
  c.__S2__ = s;
  const p = json(c, "DraftData.buildDraft(__S2__, 2024).picks[0]");
  assert.strictEqual(p.rank.text, "WR13 to WR2");
  assert.strictEqual(p.rank.delta, 11, "positive means he finished higher than he was taken");
  // only one of the two ranks known: never "WRnull", and no arrow
  c.__S3__ = stats({ 2024: [
    pick({ owner: "u1", pickNo: 1, round: 1, player: "Never Ranked", position: "WR", positionDraftRank: 5, positionFinishRank: null, value: 1, typical: 1, grade: "B" }),
    pick({ owner: "u2", pickNo: 2, round: 1, player: "Never Drafted At Rank", position: "WR", positionDraftRank: null, positionFinishRank: 3, value: 1, typical: 1, grade: "B" }),
  ] }, META);
  const two = json(c, "DraftData.buildDraft(__S3__, 2024).picks");
  assert.strictEqual(two[0].rank.text, "WR5 to –");
  assert.strictEqual(two[0].rank.delta, null);
  assert.strictEqual(two[1].rank.text, "");
  assert.strictEqual(two[1].rank.delta, null);
});

// ---- one draft -----------------------------------------------------------------------------------------------

test("buildDraft: teams come back in draft-slot order, and ranked best-first with ranks", () => {
  const c = draftOf(setup(), 2024);
  assert.strictEqual(json(c, "__D__.teams.map(t => t.name).join()"), "alvin,beth,carl,dana");
  assert.strictEqual(json(c, "__D__.teams.map(t => t.slot).join()"), "1,2,3,4");
  assert.strictEqual(json(c, "__D__.ranked.map(t => t.name).join()"), "carl,beth,alvin,dana");
  assert.strictEqual(json(c, "__D__.ranked.map(t => t.rank).join()"), "1,2,3,4");
  assert.strictEqual(json(c, "__D__.ranked.map(t => t.total).join()"), "80,29,11,4", "the sum of each team's vs slot");
  assert.strictEqual(json(c, "__D__.graded"), true);
  assert.strictEqual(json(c, "__D__.teamCount"), 4);
  assert.strictEqual(json(c, "__D__.rounds"), 2);
});

test("buildDraft: a team's best pick skips capped picks and only counts when it beat the slot", () => {
  const c = draftOf(setup(), 2024);
  const teams = json(c, "__D__.teams");
  const dana = teams.find((t) => t.name === "dana");
  assert.strictEqual(dana.best, null, "his +70 was a capped kicker, so he has no steal");
  assert.strictEqual(dana.worst.player, "Di Delta");
  const carl = teams.find((t) => t.name === "carl");
  assert.strictEqual(carl.best.player, "Cy Gamma");
  assert.strictEqual(carl.worst, null, "nothing below the slot");
});

test("buildDraft: a team's grades are in pick order and its position mix skips empty positions", () => {
  const c = draftOf(setup(), 2024);
  const alvin = json(c, "__D__.teams.find(t => t.name === 'alvin')");
  assert.strictEqual(alvin.grades.join(""), "AF");
  assert.strictEqual(alvin.mix.map((m) => `${m.pos}${m.n}`).join(), "RB1,WR1");
});

test("buildDraft: a season with no picks is null, and unknown seasons do not throw", () => {
  const c = draftOf(setup(), 2024);
  assert.strictEqual(json(c, "DraftData.buildDraft(__S__, 1999)"), null);
  assert.strictEqual(json(c, "DraftData.buildDraft(null, 2024)"), null);
});

test("a season still being played has no grades, values or vs slot, and teams rank by points", () => {
  const c = draftOf(setup(), 2026);
  assert.strictEqual(json(c, "__D__.graded"), false);
  assert.strictEqual(json(c, "__D__.weeksPlayed"), 6);
  json(c, "__D__.picks").forEach((p) => {
    assert.strictEqual(p.grade, null);
    assert.strictEqual(p.value, null);
    assert.strictEqual(p.typical, null);
    assert.strictEqual(p.vs, null);
  });
  assert.strictEqual(json(c, "__D__.teams.every(t => t.total === null)"), true);
  assert.strictEqual(json(c, "__D__.ranked.map(t => t.name).join()"), "alvin,beth");
  assert.strictEqual(json(c, "__D__.ranked.map(t => t.points).join()"), "310,128");
});

test("in a season being played each team's hottest pick needs enough games, and injury weeks add up", () => {
  const c = draftOf(setup(), 2026);
  const alvin = json(c, "__D__.teams.find(t => t.name === 'alvin')");
  assert.strictEqual(alvin.hottest.player, "Cy Gamma", "25.0 a game over 4 games beats 20.0");
  assert.strictEqual(alvin.injWeeks, 1);
  const beth = json(c, "__D__.teams.find(t => t.name === 'beth')");
  assert.strictEqual(beth.hottest.player, "Bo Beta Jr.", "10.0 a game; Fay's 13.3 is over only 3 games and Gus's 8.0 over one");
  assert.strictEqual(beth.injWeeks, 12);
});

test("injury weeks stay null (unknown) in a season with no injury data on record, even though Metrics counts 0 there", () => {
  const c = draftOf(setup(), 2025);
  assert.strictEqual(json(c, "__D__.teams.every(t => t.injWeeks === null)"), true);
  assert.strictEqual(json(c, "__D__.picks.every(p => p.injWeeks === null)"), true);
});

test("opts.complete overrides what the data says about whether the season is over", () => {
  const c = draftOf(setup(), 2026);
  assert.strictEqual(json(c, "DraftData.buildDraft(__S__, 2026, { complete: true }).graded"), true);
  assert.strictEqual(json(c, "DraftData.buildDraft(__S__, 2024, { complete: false }).graded"), false);
  assert.strictEqual(json(c, "DraftData.buildDraft(__S__, 2024, { complete: false }).picks.every(p => p.grade === null && p.value === null && p.typical === null && p.vs === null)"), true, "a season treated as unfinished shows no grades even if the picks carry them");
});

test("teamLabel: YOU for the viewer's own team, otherwise the short name", () => {
  const c = draftOf(setup(), 2024);
  assert.strictEqual(json(c, "DraftData.teamLabel(__D__, 'u2', 'u2')"), "YOU");
  assert.strictEqual(json(c, "DraftData.teamLabel(__D__, 'u2', 'u1')"), json(c, "__D__.abbr['beth']"));
  assert.strictEqual(json(c, "DraftData.teamLabel(__D__, 'nobody', null)"), "");
});

// ---- overview -----------------------------------------------------------------------------------------------

test("overview tiles: best draft, biggest steal (never a capped pick), costliest pick, and the viewer's draft", () => {
  const c = draftOf(setup(), 2024);
  const tiles = json(c, "DraftData.overviewTiles(__D__, 'u1')");
  assert.deepStrictEqual(tiles.map((t) => t.key), ["best-draft", "steal", "costly", "mine"]);
  assert.strictEqual(tiles[0].main, "carl");
  assert.strictEqual(tiles[0].sub, "+80 vs slot, from slot 3");
  assert.strictEqual(tiles[1].main, "Cy Gamma", "+80");
  assert.strictEqual(tiles[2].main, "Di Delta");
  assert.strictEqual(tiles[2].sub, "Pick 1.4 by dana, -66");
  assert.strictEqual(tiles[3].main, "3rd of 4");
  assert.strictEqual(tiles[3].sub, "+11 vs slot, from slot 1");
});

test("overview tiles: without a My Team the fourth tile is the worst draft; a capped pick cannot be the biggest steal", () => {
  const c = setup();
  // make the kicker's capped +70 the biggest number in the draft
  const big = D2024.map((p) => (p.player === "Ed Epsilon" ? { ...p, value: 400, valueOverSlot: 380 } : p));
  c.__S__ = stats({ 2024: big }, META);
  const tiles = json(c, "DraftData.overviewTiles(DraftData.buildDraft(__S__, 2024), null)");
  assert.deepStrictEqual(tiles.map((t) => t.key), ["best-draft", "steal", "costly", "worst-draft"]);
  assert.strictEqual(tiles[1].main, "Cy Gamma", "the kicker is held at B, so he is left out");
  assert.strictEqual(tiles[0].main, "dana", "the inflated kicker makes her draft the best");
  assert.strictEqual(tiles[3].main, "alvin", "and leaves alvin's the worst");
  // a season being played has no overview tiles
  assert.strictEqual(json(draftOf(setup(), 2026), "DraftData.overviewTiles(__D__, null).length"), 0);
});

test("short lists: the biggest steals (capped picks left out) and the costliest picks, three each", () => {
  const c = draftOf(setup(), 2024);
  assert.strictEqual(json(c, "DraftData.shortLists(__D__).steals.map(p => p.player).join()"), "Cy Gamma,Ann Alpha,Gus Eta");
  assert.strictEqual(json(c, "DraftData.shortLists(__D__).costly.map(p => p.player).join()"), "Di Delta,Hal Theta,Bo Beta Jr.");
  assert.strictEqual(json(c, "DraftData.shortLists(__D__, 1).steals.length"), 1);
});

test("the board: one row per round, one cell per team in slot order, and a team's second pick in a round is counted", () => {
  const c = draftOf(setup(), 2024);
  const rows = json(c, "DraftData.boardRows(__D__)");
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0].cells.map((x) => x.pick.player), ["Ann Alpha", "Bo Beta Jr.", "Cy Gamma", "Di Delta"]);
  assert.deepStrictEqual(rows[1].cells.map((x) => x.pick.player), ["Hal Theta", "Gus Eta", "Fay Zeta", "Ed Epsilon"]);
  // a traded pick: alvin also holds a second round-1 pick
  const traded = D2024.concat([pick({ owner: "u1", pickNo: 9, round: 1, pickInRound: 5, player: "Extra Pick", value: 1, typical: 1, grade: "B" })]);
  c.__S2__ = stats({ 2024: traded }, META);
  const cell = json(c, "DraftData.boardRows(DraftData.buildDraft(__S2__, 2024))[0].cells[0]");
  assert.strictEqual(cell.pick.player, "Ann Alpha", "the earlier pick is shown");
  assert.strictEqual(cell.extra, 1);
  // a team with no pick in a round has an empty cell
  const gap = D2024.filter((p) => p.pickNo !== 8);
  c.__S2__ = stats({ 2024: gap }, META);
  const empty = json(c, "DraftData.boardRows(DraftData.buildDraft(__S2__, 2024))[1].cells[0]");
  assert.strictEqual(empty.pick, null);
});

// ---- by round -----------------------------------------------------------------------------------------------

test("round summaries: a round's total, its best (never capped) and its costliest pick", () => {
  const c = draftOf(setup(), 2024);
  const rounds = json(c, "DraftData.roundSummaries(__D__)");
  assert.strictEqual(rounds.length, 2);
  assert.strictEqual(rounds[0].total, 41 - 6 + 80 - 66);
  assert.strictEqual(rounds[0].best.player, "Cy Gamma");
  assert.strictEqual(rounds[0].worst.player, "Di Delta");
  assert.strictEqual(rounds[1].total, 70 + 0 + 35 - 30);
  assert.strictEqual(rounds[1].best.player, "Gus Eta", "the kicker's +70 is capped, so the best is +35");
  assert.strictEqual(rounds[1].worst.player, "Hal Theta");
});

test("round summaries in a season being played carry no totals", () => {
  const c = draftOf(setup(), 2026);
  const rounds = json(c, "DraftData.roundSummaries(__D__)");
  assert.deepStrictEqual(rounds.map((r) => r.round), [1, 4, 5, 6, 9], "rounds nobody picked in are skipped");
  assert.strictEqual(rounds.every((r) => r.total === null && r.best === null && r.worst === null), true);
});

// ---- the table -----------------------------------------------------------------------------------------------

test("filter options: only pills that would show something, with counts", () => {
  const c = draftOf(setup(), 2024);
  const keys = (code) => json(c, `DraftData.filterOptions(__D__, ${code}).map(o => o.key).join()`);
  assert.strictEqual(keys("null"), "all,steals,busts,keepers,QB,RB,WR,TE,K", "no My Team, no DEF");
  assert.strictEqual(keys("'u1'"), "all,mine,steals,busts,keepers,QB,RB,WR,TE,K");
  assert.strictEqual(keys("'nobody'"), keys("null"), "a viewer with no picks in this draft gets no My picks pill");
  const counts = json(c, "DraftData.filterOptions(__D__, 'u1')");
  const n = (k) => counts.find((o) => o.key === k).count;
  assert.strictEqual(n("all"), 8);
  assert.strictEqual(n("mine"), 2);
  assert.strictEqual(n("steals"), 3, "grades S+, S or A: Ann, Cy, Gus");
  assert.strictEqual(n("busts"), 2, "grades D or F: Di, Hal");
  assert.strictEqual(n("keepers"), 1);
  // no keepers in 2025 means no Keepers pill
  c.__S2__ = league();
  assert.strictEqual(json(c, "DraftData.filterOptions(DraftData.buildDraft(__S2__, 2025), null).find(o => o.key === 'steals').count"), 3, "2025: the S+ counts with the S and A grades (Cy, Bo, Hal)");
  assert.strictEqual(json(c, "DraftData.filterOptions(DraftData.buildDraft(__S2__, 2025), null).some(o => o.key === 'keepers')"), false);
});

test("filter options in a season being played: a Hurt pill instead of grades, and only when someone is hurt", () => {
  const c = draftOf(setup(), 2026);
  const opts = json(c, "DraftData.filterOptions(__D__, null)");
  assert.deepStrictEqual(opts.map((o) => o.key).slice(0, 2), ["all", "hurt"]);
  assert.strictEqual(opts.some((o) => o.key === "steals" || o.key === "busts"), false);
  assert.strictEqual(opts.find((o) => o.key === "hurt").count, 3, "three or more injury weeks: Bo 4, Di 3, Fay 5");
  c.__S2__ = stats({ 2026: D2026.map((p) => ({ ...p, injuredWeeks: 0 })) }, META);
  assert.strictEqual(json(c, "DraftData.filterOptions(DraftData.buildDraft(__S2__, 2026), null).some(o => o.key === 'hurt')"), false);
});

test("filtering picks: by grade group, owner, position, keepers and hurt; anything unknown is all", () => {
  const c = draftOf(setup(), 2024);
  const names = (key, me) => json(c, `DraftData.filterPicks(__D__, '${key}', ${me ? `'${me}'` : "null"}).map(p => p.player).join()`);
  assert.strictEqual(names("steals"), "Ann Alpha,Cy Gamma,Gus Eta");
  c.__S2__ = league();
  assert.strictEqual(json(c, "DraftData.filterPicks(DraftData.buildDraft(__S2__, 2025), 'steals', null).map(p => p.player).join()"), "Bo Beta Jr.,Cy Gamma,Hal Theta", "an S+ is a steal");
  assert.strictEqual(names("busts"), "Di Delta,Hal Theta");
  assert.strictEqual(names("mine", "u2"), "Bo Beta Jr.,Gus Eta");
  assert.strictEqual(names("QB"), "Cy Gamma");
  assert.strictEqual(names("keepers"), "Ed Epsilon");
  // 2025 has a D (Ann) as well as an F (Di): a bust is either
  c.__S2__ = league();
  assert.strictEqual(json(c, "DraftData.filterPicks(DraftData.buildDraft(__S2__, 2025), 'busts', null).map(p => p.player).join()"), "Ann Alpha,Di Delta");
  assert.strictEqual(json(c, "DraftData.filterOptions(DraftData.buildDraft(__S2__, 2025), null).find(o => o.key === 'busts').count"), 2);
  assert.strictEqual(json(c, "DraftData.filterPicks(__D__, 'all', null).length"), 8);
  assert.strictEqual(json(c, "DraftData.filterPicks(__D__, 'nonsense', null).length"), 8);
  const live = draftOf(setup(), 2026);
  assert.strictEqual(json(live, "DraftData.filterPicks(__D__, 'hurt', null).map(p => p.player).join()"), "Bo Beta Jr.,Di Delta,Fay Zeta");
});

test("sorting: pick order runs small to big, every number column big to small, and the arrow flips both", () => {
  const c = draftOf(setup(), 2024);
  const order = (key, dir) => json(c, `DraftData.sortPicks(__D__.picks, '${key}', ${dir}).map(p => p.pickNo).join()`);
  assert.strictEqual(order("pick", 1), "1,2,3,4,5,6,7,8");
  assert.strictEqual(order("pick", -1), "8,7,6,5,4,3,2,1");
  assert.strictEqual(order("vs", 1), "3,5,1,7,6,2,8,4", "biggest vs slot first: +80, +70, +41, +35, 0, -6, -30, -66");
  assert.strictEqual(order("vs", -1), "4,8,2,6,7,1,5,3");
  assert.strictEqual(order("points", 1), "3,1,7,2,6,5,4,8");
  assert.strictEqual(order("nonsense", 1), "1,2,3,4,5,6,7,8", "an unknown column is pick order");
  assert.strictEqual(order("nonsense", -1), order("pick", -1), "in either direction");
});

test("sorting puts picks with no number last in either direction", () => {
  const c = setup();
  c.__S2__ = stats({ 2024: [
    pick({ owner: "u1", pickNo: 1, round: 1, player: "Has", value: 10, typical: 5, grade: "B" }),
    pick({ owner: "u2", pickNo: 2, round: 1, player: "Hasnt", points: 3 }),
    pick({ owner: "u3", pickNo: 3, round: 1, player: "Has Less", value: 2, typical: 5, grade: "B" }),
  ] }, META);
  const order = (dir) => json(c, `DraftData.sortPicks(DraftData.buildDraft(__S2__, 2024).picks, 'vs', ${dir}).map(p => p.player).join()`);
  assert.strictEqual(order(1), "Has,Has Less,Hasnt");
  assert.strictEqual(order(-1), "Has Less,Has,Hasnt");
});

test("sorting does not change the list it was given", () => {
  const c = draftOf(setup(), 2024);
  assert.strictEqual(json(c, "(() => { const before = __D__.picks.map(p => p.pickNo).join(); DraftData.sortPicks(__D__.picks, 'vs', 1); return before === __D__.picks.map(p => p.pickNo).join(); })()"), true);
});

test("table tiles (graded): the total, how many graded A or better, the best (never capped) and costliest of what is showing", () => {
  const c = draftOf(setup(), 2024);
  const tiles = json(c, "DraftData.tableTiles(__D__, __D__.picks, { filterKey: 'all' })");
  assert.deepStrictEqual(tiles.map((t) => t.key), ["vs", "grades", "best", "costly", "showed-up"]);
  assert.strictEqual(tiles[0].main, "+124", "41 - 6 + 80 - 66 + 70 + 0 + 35 - 30");
  assert.strictEqual(tiles[0].sub, "across 8 picks");
  assert.strictEqual(tiles[0].tone, "good", "a total above the slots is the good color");
  assert.strictEqual(tiles[1].main, "3 of 8");
  assert.match(tiles[1].sub, /graded A or better · 1 S · 2 A · 2 B · 1 C · 2 F/);
  assert.strictEqual(tiles[2].main, "Cy Gamma");
  assert.strictEqual(tiles[3].main, "Di Delta");
  assert.strictEqual(tiles[4].main, "84 starts", "seven picks started 12 weeks, one never played");
  assert.strictEqual(tiles[4].sub, "across all 8 picks");
});

test("table tiles describe whichever picks are showing; My picks says where the draft ranked", () => {
  const c = draftOf(setup(), 2024);
  const tiles = json(c, "DraftData.tableTiles(__D__, DraftData.filterPicks(__D__, 'mine', 'u1'), { filterKey: 'mine', meId: 'u1' })");
  assert.strictEqual(tiles[0].main, "+11");
  assert.strictEqual(tiles[0].sub, "3rd of 4 teams, round 1 slot 1");
  assert.strictEqual(json(c, "DraftData.tableTiles(__D__, [], {}).length"), 0, "nothing showing, no tiles");
  c.__S2__ = league();
  assert.strictEqual(json(c, "DraftData.tableTiles(DraftData.buildDraft(__S2__, 2025), DraftData.filterPicks(DraftData.buildDraft(__S2__, 2025), 'mine', 'u1'), { filterKey: 'mine', meId: 'u1' })[0].tone"), "bad", "alvin's 2025 total is -10");
  assert.strictEqual(json(c, "DraftData.tableTiles(__D__, __D__.picks.filter(p => p.vs === 0), {})[0].tone"), "plain");
  assert.strictEqual(json(c, "DraftData.tableTiles(__D__, DraftData.filterPicks(__D__, 'QB', null), {})[0].sub"), "across 1 pick");
});

test("table tiles (season being played): points with a thousands comma, the hottest pick, starts and injury weeks", () => {
  const c = draftOf(setup(), 2026);
  const tiles = json(c, "DraftData.tableTiles(__D__, __D__.picks, {})");
  assert.deepStrictEqual(tiles.map((t) => t.key), ["points", "hottest", "showed-up"]);
  assert.strictEqual(tiles[0].main, "438");
  assert.strictEqual(tiles[0].sub, "16.2 per game played", "438 points over 27 games");
  assert.strictEqual(tiles[1].main, "Cy Gamma");
  assert.strictEqual(tiles[2].main, "25 starts");
  assert.strictEqual(tiles[2].sub, "across all 7 picks, 13 injury weeks");
  c.__S2__ = stats({ 2026: [pick({ owner: "u1", pickNo: 1, round: 1, player: "Big", points: 1234.4, gamesPlayed: 1, startedWeeks: 1 }), pick({ owner: "u2", pickNo: 2, round: 1, player: "Bigger", points: 1000, gamesPlayed: 1, startedWeeks: 1 })] }, META);
  assert.strictEqual(json(c, "DraftData.tableTiles(DraftData.buildDraft(__S2__, 2026), DraftData.buildDraft(__S2__, 2026).picks, {})[0].main"), "2,234");
});

// ---- the draft so far ----------------------------------------------------------------------------------------

test("live model: round 1 in pick order, teams by points, hot starts after round 3, early picks who are hurt", () => {
  const c = draftOf(setup(), 2026);
  const m = json(c, "DraftData.liveModel(__D__)");
  assert.strictEqual(m.weeksPlayed, 6);
  assert.strictEqual(m.roundOne.map((p) => p.player).join(), "Ann Alpha,Bo Beta Jr.");
  assert.strictEqual(m.teamPoints.map((t) => `${t.name}:${t.points}`).join(), "alvin:310,beth:128");
  // after round 3, 4 or more games, best points a game first
  assert.strictEqual(m.hotStarts.map((p) => p.player).join(), "Cy Gamma,Ed Epsilon", "Ann is round 1; Di has 3 games; Fay has 3; Gus has 1");
  // rounds 1 to 8, 3 or more injury weeks, most weeks first
  assert.strictEqual(m.hurtEarly.map((p) => p.player).join(), "Bo Beta Jr.,Di Delta", "Fay (5 weeks) is a round-9 pick, which is not early");
});

test("live model: hot starts begin after round 3, so a round-3 pick is left out and a round-4 pick is in", () => {
  const c = setup();
  const mk = (pickNo, round) => pick({ owner: "u1", pickNo, round, player: `R${round}`, points: 100, gamesPlayed: 4, startedWeeks: 4, injuredWeeks: 0 });
  c.__S2__ = stats({ 2026: [mk(1, 1), mk(25, 3), mk(37, 4)] }, META);
  assert.strictEqual(json(c, "DraftData.liveModel(DraftData.buildDraft(__S2__, 2026)).hotStarts.map(p => p.player).join()"), "R4");
});

test("live model: the lists are capped at six and a pick right on a threshold is included", () => {
  const c = setup();
  const many = Array.from({ length: 10 }, (_, i) => pick({ owner: "u1", pickNo: 40 + i, round: 5, player: `Late ${i}`, points: 40 + i, gamesPlayed: 4, startedWeeks: 4, injuredWeeks: 3 }));
  c.__S2__ = stats({ 2026: many }, META);
  const m = json(c, "DraftData.liveModel(DraftData.buildDraft(__S2__, 2026))");
  assert.strictEqual(m.hotStarts.length, 6, "capped at six, exactly four games and exactly three injury weeks qualify");
  assert.strictEqual(m.hotStarts[0].player, "Late 9");
  assert.strictEqual(m.hurtEarly.length, 6);
  assert.strictEqual(json(c, "DraftData.isHot({ ppg: 20 })"), true);
  assert.strictEqual(json(c, "DraftData.isHot({ ppg: 19.99 })"), false);
  assert.strictEqual(json(c, "DraftData.isHot({ ppg: null })"), false);
  assert.strictEqual(json(c, "DraftData.isHurt({ injWeeks: 3 })"), true);
  assert.strictEqual(json(c, "DraftData.isHurt({ injWeeks: 2 })"), false);
  assert.strictEqual(json(c, "DraftData.isHurt({ injWeeks: null })"), false);
});

// ---- the report card ----------------------------------------------------------------------------------------

test("graded seasons: only complete ones, oldest first", () => {
  const c = setup();
  c.__S__ = league();
  assert.strictEqual(json(c, "DraftData.gradedSeasons(__S__).join()"), "2024,2025");
  assert.strictEqual(json(c, "DraftData.gradedSeasons(null).length"), 0);
});

test("report card: managers ranked by their total across every graded draft; past managers left out unless asked, and last when in", () => {
  const c = setup();
  c.__S__ = league();
  c.__CUR__ = new Set(["u1", "u2", "u3"]);
  const current = json(c, "DraftData.reportCard(__S__, { currentIds: __CUR__ })");
  assert.strictEqual(current.years.join(), "2024,2025");
  assert.strictEqual(current.rows.map((r) => `${r.name}:${r.total}`).join(), "carl:105,beth:69,alvin:1");
  assert.strictEqual(current.pastCount, 1, "dana is not in the league now");
  const all = json(c, "DraftData.reportCard(__S__, { currentIds: __CUR__, includePast: true })");
  assert.strictEqual(all.rows.map((r) => r.name).join(), "carl,beth,alvin,dana", "dana's +4 beats alvin's +1, but a past manager sits last");
  assert.strictEqual(all.rows[3].past, true);
  // with no current-members list everyone counts as current
  assert.strictEqual(json(c, "DraftData.reportCard(__S__, {}).rows.map(r => r.name).join()"), "carl,beth,dana,alvin");
});

test("report card cells: one per graded year in order, null where the manager did not draft, with the year's rank", () => {
  const c = setup();
  c.__S__ = league();
  const rc = json(c, "DraftData.reportCard(__S__, { includePast: true })");
  const dana = rc.rows.find((r) => r.name === "dana");
  assert.strictEqual(dana.cells[0].total, 4);
  assert.strictEqual(dana.cells[0].rank, 4);
  assert.strictEqual(dana.cells[0].of, 4);
  assert.strictEqual(dana.cells[1], null, "she did not draft in 2025");
  assert.strictEqual(dana.drafts, 1);
  assert.strictEqual(dana.avg, 4);
  const carl = rc.rows.find((r) => r.name === "carl");
  assert.strictEqual(carl.cells[0].band, "b4", "+80 over a draft: between +50 and +150");
  assert.strictEqual(carl.cells[1].total, 25);
  assert.strictEqual(carl.avg, 52.5);
  assert.strictEqual(carl.cells[0].grades.join(""), "SB");
});

test("report card lists: best and worst team-drafts ever (six each) and the viewer's own drafts oldest first", () => {
  const c = setup();
  c.__S__ = league();
  const rc = json(c, "DraftData.reportCard(__S__, { meId: 'u1' })");
  assert.strictEqual(rc.best.map((s) => `${s.name} ${s.year} ${s.total}`).join(), "carl 2024 80,beth 2025 40,beth 2024 29,carl 2025 25,alvin 2024 11,dana 2024 4");
  assert.strictEqual(rc.worst.map((s) => `${s.name} ${s.year} ${s.total}`).join(), "alvin 2025 -10,dana 2024 4,alvin 2024 11,carl 2025 25,beth 2024 29,beth 2025 40");
  assert.strictEqual(rc.mine.map((s) => `${s.year}:${s.total}:${s.rank}`).join(), "2024:11:3,2025:-10:3");
  assert.strictEqual(rc.rows.find((r) => r.name === "alvin").isMe, true);
  assert.strictEqual(json(c, "DraftData.reportCard(__S__, {}).mine.length"), 0, "no My Team, no Your drafts");
});

test("report card with no graded year has no years or rows", () => {
  const c = setup();
  c.__S__ = stats({ 2026: D2026 }, META);
  const rc = json(c, "DraftData.reportCard(__S__, {})");
  assert.strictEqual(rc.years.length, 0);
  assert.strictEqual(rc.rows.length, 0);
});

// ---- the best and costliest picks ever ----------------------------------------------------------------------

test("hall of fame: best picks ever leave out capped picks, costliest do not, ties go to the newer season", () => {
  const c = setup();
  c.__S__ = league();
  const hof = json(c, "DraftData.hallOfFame(__S__)");
  assert.strictEqual(hof.pickCount, 14, "every graded pick with a vs slot, 8 + 6");
  assert.strictEqual(hof.best.map((p) => `${p.season} ${p.player} ${p.vs}`).join(), "2025 Cy Gamma 150,2024 Cy Gamma 80,2024 Ann Alpha 41,2025 Bo Beta Jr. 35,2024 Gus Eta 35,2025 Hal Theta 30,2025 Gus Eta 5");
  assert.strictEqual(hof.best.some((p) => p.player === "Ed Epsilon"), false, "a held-at-B kicker is no steal");
  assert.strictEqual(hof.costly.map((p) => `${p.season} ${p.player} ${p.vs}`).join(), "2025 Di Delta -125,2024 Di Delta -66,2025 Ann Alpha -40,2024 Hal Theta -30,2024 Bo Beta Jr. -6");
  assert.strictEqual(json(c, "DraftData.hallOfFame(__S__, { limit: 2 }).best.length"), 2);
  assert.strictEqual(json(c, "DraftData.hallOfFame(__S__).best.length <= DraftData.HALL_SIZE"), true);
});

test("hall of fame has nothing to rank before a draft is graded", () => {
  const c = setup();
  c.__S__ = stats({ 2026: D2026 }, META);
  assert.strictEqual(json(c, "DraftData.hallOfFame(__S__).pickCount"), 0);
});

// ---- the facts about each season (from Metrics) -------------------------------------------------------------

test("seasonFacts: teams, rounds, weeks played, whether the season is over and whether injuries are on record, from a Metrics analysis", () => {
  const c = setup();
  c.__A__ = {
    contexts: [
      { season: "2025", numTeams: 12, picks: [{ round: 1 }, { round: 16 }, { round: 3 }], regWeeks: Array.from({ length: 14 }, (_, i) => i + 1), complete: true, injuries: { abc: { 1: "Out" } } },
      { season: "2026", numTeams: 10, picks: [], regWeeks: [1, 2, 3], complete: false, injuries: {} },
    ],
  };
  const facts = json(c, "DraftData.seasonFacts(__A__)");
  assert.deepStrictEqual(facts["2025"], { season: "2025", teams: 12, rounds: 16, weeksPlayed: 14, complete: true, injuryKnown: true });
  assert.deepStrictEqual(facts["2026"], { season: "2026", teams: 10, rounds: 0, weeksPlayed: 3, complete: false, injuryKnown: false });
  assert.deepStrictEqual(json(c, "DraftData.seasonFacts(null)"), {});
  assert.deepStrictEqual(json(c, "DraftData.seasonFacts({})"), {});
});

test("an S+ counts as graded A or better and is named in the tile", () => {
  const c = setup();
  c.__S__ = league();
  const tiles = json(c, "DraftData.tableTiles(DraftData.buildDraft(__S__, 2025), DraftData.buildDraft(__S__, 2025).picks, { filterKey: 'all' })");
  assert.strictEqual(tiles[1].main, "3 of 6", "S+, A and A");
  assert.match(tiles[1].sub, /1 S\+ · 2 A · 1 B · 1 D · 1 F/);
  assert.strictEqual(tiles[2].main, "Cy Gamma", "the S+ is the best pick");
});

// ---- the numbers that tune the page ------------------------------------------------------------------------------

test("the page's tunable numbers are the ones the mockups were built around", () => {
  const { DraftData } = setup();
  assert.deepStrictEqual([...DraftData.BOARD_BANDS], [60, 20, -20, -60]);
  assert.deepStrictEqual([...DraftData.TEAM_BANDS], [150, 50, -50, -150]);
  assert.strictEqual(DraftData.HOT_AFTER_ROUND, 3);
  assert.strictEqual(DraftData.HOT_MIN_GAMES, 4);
  assert.strictEqual(DraftData.HURT_MAX_ROUND, 8);
  assert.strictEqual(DraftData.HURT_MIN_INJ, 3);
  assert.strictEqual(DraftData.POSITIONS.join(), "QB,RB,WR,TE,K,DEF");
});
