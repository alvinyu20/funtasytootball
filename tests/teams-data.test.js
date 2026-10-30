const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const hist = require("./helpers/history-fixture.js");
const fx = require("./helpers/teams-fixture.js");

function setup() {
  const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "history-data.js", "teams-data.js"]);
  ctx.__chain = hist.chain();
  ctx.__manual = hist.manual();
  ctx.__managers = fx.fullManagers();
  // buildOwners takes the Sleeper seasons only and folds the ESPN ones in itself
  ctx.__sleeperOnly = ctx.__managers.map((m) => ({ ...m, seasons: m.seasons.filter((s) => s.isSeasonComplete !== undefined) }));
  return ctx;
}

// Runs code inside the loaded site and hands back plain JSON.
function ev(ctx, code) {
  return JSON.parse(runInLoadedContext(ctx, `JSON.stringify((() => { ${code} })())`));
}

const DATA = `
  const ledger = HistoryData.buildLedger(__chain, __manual);
  const data = HistoryData.buildOwners(__sleeperOnly, __manual, ledger);
  const owner = (n) => data.owners.find((o) => o.name === n);
  const manager = (n) => __managers.find((m) => m.username === n);
  const averages = TeamsData.leagueAverages(__chain, __manual);
`;

// ---- league scoring averages ----------------------------------------------------------

test("leagueAverages: points per team per game for each year, from every team's points over every game played", () => {
  const ctx = setup();
  const avg = ev(ctx, `return TeamsData.leagueAverages(__chain, __manual)`);
  // 2020: 300+310+250+200 = 1060 points over 12 games
  assert.ok(Math.abs(avg[2020].ppg - 1060 / 12) < 1e-9);
  assert.strictEqual(avg[2020].teams, 4);
  // 2022 is still being played: 770 points over the 8 games so far
  assert.ok(Math.abs(avg[2022].ppg - 770 / 8) < 1e-9);
});

test("leagueAverages: years before Sleeper come from the ESPN file, including teams that never reached Sleeper", () => {
  const ctx = setup();
  const avg = ev(ctx, `return TeamsData.leagueAverages(__chain, __manual)`);
  // five ESPN teams at 100 points over 11 games each
  assert.ok(Math.abs(avg[2019].ppg - 500 / 55) < 1e-9);
  assert.strictEqual(avg[2019].teams, 5);
});

test("leagueAverages: a year in both sources keeps the Sleeper numbers, and a team with no games or no points is skipped", () => {
  const ctx = setup();
  ctx.__manual.seasons.push({ year: 2020, standings: [{ team: "x", wins: 5, losses: 5, pointsFor: 9999 }] });
  ctx.__chain[0].rosters.push({ roster_id: 9, owner_id: "u9", settings: { wins: 0, losses: 0, ties: 0, fpts: 500 } });
  const avg = ev(ctx, `return TeamsData.leagueAverages(__chain, __manual)`);
  assert.ok(Math.abs(avg[2020].ppg - 1060 / 12) < 1e-9);
  assert.strictEqual(avg[2020].teams, 4, "the roster that has played nothing is not a team in the average");
  assert.deepStrictEqual(ev(ctx, `return TeamsData.leagueAverages([], null)`), {});
});

// ---- Season by Season -----------------------------------------------------------------------

test("seasonRows: one row per season, newest first, with finish, label, record and points per game", () => {
  const ctx = setup();
  const rows = ev(ctx, `${DATA} return TeamsData.seasonRows(owner("alice"), manager("alice"), averages)`);
  assert.deepStrictEqual(rows.map((r) => r.year), [2022, 2021, 2020, 2019]);
  const r21 = rows.find((r) => r.year === 2021);
  assert.deepStrictEqual([r21.finish, r21.status, r21.label, r21.record, r21.winPct], [1, "champion", "TITLE", "3-0", 100]);
  assert.ok(Math.abs(r21.ppgFor - 110) < 1e-9, "330 points over 3 games");
  assert.ok(Math.abs(r21.ppgAgainst - 80) < 1e-9);
  assert.ok(r21.leagueAvg > 0);
});

test("seasonRows: the season in progress is LIVE and says so, with the all-play record and luck so far", () => {
  const ctx = setup();
  const live = ev(ctx, `${DATA} return TeamsData.seasonRows(owner("alice"), manager("alice"), averages)[0]`);
  assert.deepStrictEqual([live.live, live.label, live.status, live.record], [true, "LIVE", "live-in", "1-1"]);
  assert.strictEqual(live.overall.text, "4-2");
  assert.strictEqual(live.luck, -16.7);
});

test("seasonRows: labels follow how the playoffs went", () => {
  const ctx = setup();
  const label = (n, y) => ev(ctx, `${DATA} return TeamsData.seasonRows(owner(${JSON.stringify(n)}), manager(${JSON.stringify(n)}), averages).find((r) => r.year === ${y}).label`);
  assert.strictEqual(label("bob", 2021), "2ND");
  assert.strictEqual(label("cara", 2020), "3RD");
  assert.strictEqual(label("dan", 2020), "MISSED");
  assert.strictEqual(label("alice", 2019), "TITLE");
});

test("seasonRows: an ESPN year with no all-play record has points but no overall record and no luck", () => {
  const ctx = setup();
  const r = ev(ctx, `${DATA} return TeamsData.seasonRows(owner("alice"), manager("alice"), averages).find((x) => x.year === 2019)`);
  assert.ok(Math.abs(r.ppgFor - 880 / 11) < 1e-9);
  assert.strictEqual(r.overall, null);
  assert.strictEqual(r.luck, null);
});

test("seasonRows: a year with no scoring average says null rather than 0, and no owner is no rows", () => {
  const ctx = setup();
  assert.strictEqual(ev(ctx, `${DATA} return TeamsData.seasonRows(owner("alice"), manager("alice"), {})[0].leagueAvg`), null);
  assert.deepStrictEqual(ev(ctx, `return TeamsData.seasonRows(null, null, {})`), []);
});

test("seasonHighlights is gone: the Unluckiest / Luckiest / Best-scoring boxes were removed along with their logic", () => {
  const ctx = setup();
  assert.strictEqual(ev(ctx, `return typeof TeamsData.seasonHighlights`), "undefined");
});

// ---- profile header and tiles -------------------------------------------------------------

test("profileFacts: the hero line says where the season stands, after how many games", () => {
  const ctx = setup();
  const f = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("alice"), data.owners, ledger, manager("alice"))`);
  assert.strictEqual(f.since, 2019);
  assert.strictEqual(f.now, "2022 ranked 2nd after Week 2");
  const dan = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("dan"), data.owners, ledger, manager("dan")).now`);
  assert.strictEqual(dan, "2022 ranked 1st after Week 2");
});

test("profileFacts: a season that has not started, one that is over, and someone who has left", () => {
  const ctx = setup();
  ctx.__chain[2].rosters.forEach((r) => Object.assign(r.settings, { wins: 0, losses: 0, ties: 0 }));
  ctx.__sleeperOnly.forEach((m) => m.seasons.forEach((s) => s.season === "2022" && Object.assign(s, { wins: 0, losses: 0, ties: 0 })));
  assert.strictEqual(ev(ctx, `${DATA} return TeamsData.profileFacts(owner("alice"), data.owners, ledger, manager("alice")).now`), "2022 season hasn't started");
  const over = setup();
  over.__chain[2].league.status = "complete";
  over.__sleeperOnly.forEach((m) => m.seasons.forEach((s) => (s.isSeasonComplete = true)));
  assert.strictEqual(ev(over, `${DATA} return TeamsData.profileFacts(owner("alice"), data.owners, ledger, manager("alice")).now`), "2022 finished 2nd");
  assert.strictEqual(ev(ctx, `${DATA} return TeamsData.profileFacts(owner("gone"), data.owners, ledger, manager("gone")).now`), "Last played 2020");
});

test("profileFacts: titles with their years, and the record in championship games", () => {
  const ctx = setup();
  const f = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("alice"), data.owners, ledger, manager("alice"))`);
  assert.deepStrictEqual([f.titles, f.titleYears, f.titleGames], [3, [2019, 2020, 2021], { record: "3-0" }]);
  const bob = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("bob"), data.owners, ledger, manager("bob")).titleGames`);
  assert.deepStrictEqual(bob, { record: "0-3" });
  const dan = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("dan"), data.owners, ledger, manager("dan")).titleGames`);
  assert.deepStrictEqual(dan, { record: "–" }, "no finals is a dash, not 0-0");
});

test("profileFacts: overall record adds regular season and playoffs, and ranks the owner's win rate among all owners", () => {
  const ctx = setup();
  const f = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("alice"), data.owners, ledger, manager("alice"))`);
  assert.strictEqual(f.regular.record, "14-5");
  assert.strictEqual(f.playoffs.record, "6-0");
  assert.strictEqual(f.overall.record, "20-5");
  assert.ok(Math.abs(f.overall.pct - 80) < 1e-9);
  assert.strictEqual(f.overall.rank, 1);
  assert.strictEqual(f.overall.of, 6, "every owner who has played a game, former and brand new included");
  const bob = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("bob"), data.owners, ledger, manager("bob")).overall`);
  assert.strictEqual(bob.rank, 2);
});

test("profileFacts: the tiles carry numbers only — no descriptor note on any of them", () => {
  const ctx = setup();
  const f = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("alice"), data.owners, ledger, manager("alice"))`);
  for (const key of ["overall", "regular", "playoffs", "titleGames", "trips", "byes", "third"]) {
    assert.ok(!("note" in f[key]), `${key} has no note`);
  }
  assert.ok(!("years" in f.third), "and third place no longer lists its years");
  assert.strictEqual(f.regular.record, "14-5");
  assert.ok(Math.abs(f.regular.pct - (14 / 19) * 100) < 1e-9);
});

test("profileFacts: playoff trips are out of finished seasons, byes come from the manager, third place is a count", () => {
  const ctx = setup();
  const f = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("cara"), data.owners, ledger, manager("cara"))`);
  assert.strictEqual(f.trips.text, "3 of 3");
  assert.deepStrictEqual(f.third, { count: 3 });
  const alice = ev(ctx, `${DATA} return TeamsData.profileFacts(owner("alice"), data.owners, ledger, manager("alice"))`);
  assert.deepStrictEqual(alice.byes, { count: 2, text: "2" });
  const newbie = ev(ctx, `${DATA} const f = TeamsData.profileFacts(owner("newbie"), data.owners, ledger, manager("newbie")); return { trips: f.trips, byes: f.byes }`);
  assert.deepStrictEqual(newbie, { trips: { text: "–" }, byes: { count: 0, text: "–" } }, "no finished season yet reads as dashes, not 0 of 0");
});

// ---- manager cards ---------------------------------------------------------------------------

const CARD_CTX = `const teamCountByYear = {}; ledger.forEach((s) => (teamCountByYear[s.year] = s.teamCount));
  const cctx = { years: ledger.map((s) => s.year), teamCountByYear, latestYear: data.latestYear };
  const card = (n) => TeamsData.ownerCard(owner(n), cctx);`;

test("ownerCard: one bar per year in the league's history, taller for a better finish, gold for a title year", () => {
  const ctx = setup();
  const c = ev(ctx, `${DATA} ${CARD_CTX} return card("alice")`);
  assert.deepStrictEqual(c.bars.map((b) => b.year), [2019, 2020, 2021, 2022]);
  assert.deepStrictEqual(c.bars.map((b) => b.title), [true, true, true, false]);
  const h = (n, y) => ev(ctx, `${DATA} ${CARD_CTX} return card(${JSON.stringify(n)}).bars.find((b) => b.year === ${y}).height`);
  assert.strictEqual(h("alice", 2021), 1, "1st of 4");
  assert.ok(Math.abs(h("dan", 2020) - 0.12) < 1e-9, "last place is a short bar, not a missing one");
  assert.ok(h("bob", 2020) > h("cara", 2020), "1st is taller than 3rd");
});

test("ownerCard: years before an owner joined are empty, and the season in progress is a live bar", () => {
  const ctx = setup();
  const c = ev(ctx, `${DATA} ${CARD_CTX} return card("newbie")`);
  assert.deepStrictEqual(c.bars.map((b) => !!b.empty), [true, true, true, false]);
  assert.strictEqual(c.bars[3].live, true);
  assert.strictEqual(ev(ctx, `${DATA} ${CARD_CTX} return card("alice")`).bars[3].live, true);
});

test("ownerCard: overall record and win %, titles, and the current standing with whether it is inside the playoff spots", () => {
  const ctx = setup();
  const c = ev(ctx, `${DATA} ${CARD_CTX} return card("alice")`);
  assert.deepStrictEqual([c.record, c.titles, c.titleYears], ["20-5", 3, [2019, 2020, 2021]]);
  assert.ok(Math.abs(c.pct - 80) < 1e-9);
  assert.deepStrictEqual(c.rank, { finish: 2, text: "2nd in 2022", inside: true, started: true, isNew: false });
  const bob = ev(ctx, `${DATA} ${CARD_CTX} return card("bob")`);
  assert.strictEqual(bob.rank.inside, false, "3rd with two playoff spots");
  assert.strictEqual(ev(ctx, `${DATA} ${CARD_CTX} return card("gone")`).rank, null, "not in the newest season: no standing");
  assert.strictEqual(ev(ctx, `${DATA} ${CARD_CTX} return card("newbie")`).rank.isNew, true);
});

test("sortCards: Titles puts established owners first by titles then win %, with newcomers at the end", () => {
  const ctx = setup();
  const names = ev(
    ctx,
    `const mk = (name, titles, pct, games) => ({ name, titles, pct, games, rank: null });
     return TeamsData.sortCards([mk("new", 0, 90, 5), mk("b", 1, 50, 100), mk("a", 1, 60, 100), mk("z", 3, 40, 100), mk("c", 0, 55, 100)], "titles").map((c) => c.name)`
  );
  assert.deepStrictEqual(names, ["z", "a", "b", "c", "new"]);
});

test("sortCards: Win % orders by win rate, newcomers last; 2026 rank by the current standing; A to Z by name", () => {
  const ctx = setup();
  const run = (how) =>
    ev(
      ctx,
      `const mk = (name, pct, games, finish) => ({ name, titles: 0, pct, games, rank: finish ? { finish } : null });
       return TeamsData.sortCards([mk("b", 50, 100, 3), mk("new", 99, 4, 1), mk("a", 70, 100, 2), mk("gone", 80, 100, null), mk("c", 60, 100, 4)], ${JSON.stringify(how)}).map((c) => c.name)`
    );
  assert.deepStrictEqual(run("win"), ["gone", "a", "c", "b", "new"]);
  assert.deepStrictEqual(run("rank"), ["new", "a", "b", "c", "gone"]);
  assert.deepStrictEqual(run("az"), ["a", "b", "c", "gone", "new"]);
  assert.deepStrictEqual(run("nonsense"), run("titles"));
});

test("sortCards: sorting never changes the list it was given", () => {
  const ctx = setup();
  const same = ev(ctx, `const list = [{ name: "b", titles: 0, pct: 1, games: 99 }, { name: "a", titles: 1, pct: 2, games: 99 }]; TeamsData.sortCards(list, "titles"); return list.map((c) => c.name)`);
  assert.deepStrictEqual(same, ["b", "a"]);
});

// ---- Head to Head --------------------------------------------------------------------------------

const H2H = `${DATA} const h = TeamsData.headToHead(manager("alice"));`;

test("headToHead: opponents with five or more games are ranked by win rate, fewer come after by games played", () => {
  const ctx = setup();
  const h = ev(ctx, `${H2H} return { ranked: h.ranked.map((r) => r.name), small: h.small.map((r) => r.name) }`);
  assert.deepStrictEqual(h.ranked, ["erin", "bob", "cara"]);
  assert.deepStrictEqual(h.small, ["dan", "gone", "newbie"]);
});

test("headToHead: the playoff record is put on the same row as the regular season, matched by id or by name", () => {
  const ctx = setup();
  const bob = ev(ctx, `${H2H} return h.ranked.find((r) => r.name === "bob")`);
  assert.deepStrictEqual([bob.record, bob.poRecord, bob.games, bob.poGames], ["6-2", "1-1", 8, 2]);
  assert.strictEqual(Math.round(bob.winPct), 75);
  // an earlier-years playoff entry that only knows the name still lands on the Sleeper row
  const byName = ev(ctx, `${DATA} const m = manager("alice"); m.headToHeadPlayoffs.push({ opponentUserId: null, opponentName: "ERIN", wins: 0, losses: 1, ties: 0 }); const h = TeamsData.headToHead(m); return h.ranked.find((r) => r.name === "erin").poRecord`);
  assert.strictEqual(byName, "0-1");
});

test("headToHead: an opponent met only in the playoffs is listed on its own, after everyone else", () => {
  const ctx = setup();
  const h = ev(ctx, `${H2H} return { names: h.playoffOnly.map((r) => r.name), rows: h.rows.length }`);
  assert.deepStrictEqual(h.names, ["Chris", "Liam"]);
  assert.strictEqual(h.rows, 8, "six regular-season opponents and two playoff-only");
});

test("headToHead: the best and worst ranked rows are marked, and one ranked row has no 'worst'", () => {
  const ctx = setup();
  assert.deepStrictEqual(ev(ctx, `${H2H} return [h.bestKey, h.worstKey]`), ["u:u7", "u:u3"]);
  const one = ev(ctx, `${DATA} const m = manager("alice"); m.headToHead = m.headToHead.slice(0, 1); const h = TeamsData.headToHead(m); return [h.bestKey, h.worstKey]`);
  assert.deepStrictEqual(one, ["u:u2", null]);
  assert.deepStrictEqual(ev(ctx, `${DATA} const h = TeamsData.headToHead(manager("bob")); return [h.rows.length, h.bestKey, h.worstKey]`), [0, null, null]);
  assert.deepStrictEqual(ev(ctx, `return TeamsData.headToHead(null).rows`), []);
});

test("headToHead: a win rate tie is broken by more games, then by name", () => {
  const ctx = setup();
  const order = ev(
    ctx,
    `const m = { headToHead: [
       { opponentUserId: "a", opponentName: "zed", wins: 4, losses: 4, ties: 0 },
       { opponentUserId: "b", opponentName: "amy", wins: 4, losses: 4, ties: 0 },
       { opponentUserId: "c", opponentName: "kim", wins: 5, losses: 5, ties: 0 } ], headToHeadPlayoffs: [] };
     return TeamsData.headToHead(m).ranked.map((r) => r.name)`
  );
  assert.deepStrictEqual(order, ["kim", "amy", "zed"]);
});

test("playoffOnlyGroups: opponents who are all the same single game share one row", () => {
  const ctx = setup();
  const g = ev(ctx, `${H2H} return TeamsData.playoffOnlyGroups(h.playoffOnly)`);
  assert.deepStrictEqual(g, [{ names: ["Chris", "Liam"], record: "2-0", note: "One playoff win over each" }]);
  const losses = ev(ctx, `return TeamsData.playoffOnlyGroups([{ name: "a", po: { wins: 0, losses: 1, ties: 0 }, poGames: 1, poRecord: "0-1" }, { name: "b", po: { wins: 0, losses: 1, ties: 0 }, poGames: 1, poRecord: "0-1" }])[0].note`);
  assert.strictEqual(losses, "One playoff loss to each");
});

test("playoffOnlyGroups: mixed results stay one row each, and none is none", () => {
  const ctx = setup();
  const g = ev(ctx, `return TeamsData.playoffOnlyGroups([{ name: "a", po: { wins: 1, losses: 0, ties: 0 }, poGames: 1, poRecord: "1-0" }, { name: "b", po: { wins: 0, losses: 1, ties: 0 }, poGames: 1, poRecord: "0-1" }])`);
  assert.deepStrictEqual(g.map((x) => [x.names, x.record, x.note]), [[["a"], "1-0", ""], [["b"], "0-1", ""]]);
  assert.deepStrictEqual(ev(ctx, `return TeamsData.playoffOnlyGroups([])`), []);
  const single = ev(ctx, `return TeamsData.playoffOnlyGroups([{ name: "a", po: { wins: 1, losses: 0, ties: 0 }, poGames: 1, poRecord: "1-0" }])`);
  assert.strictEqual(single[0].note, "", "one opponent needs no 'over each'");
});

test("playoffOnlyGroups: opponents met more than once are never merged into 'one playoff win over each'", () => {
  const ctx = setup();
  const g = ev(ctx, `return TeamsData.playoffOnlyGroups([{ name: "a", po: { wins: 2, losses: 0, ties: 0 }, poGames: 2, poRecord: "2-0" }, { name: "b", po: { wins: 2, losses: 0, ties: 0 }, poGames: 2, poRecord: "2-0" }])`);
  assert.deepStrictEqual(g.map((x) => [x.names, x.record, x.note]), [[["a"], "2-0", ""], [["b"], "2-0", ""]]);
});

test("sortFormer: A to Z is alphabetical; every other order puts whoever played the most seasons first, then the most games; the list given is left alone", () => {
  const ctx = setup();
  const list = `[{ name: "zed", seasons: 3, games: 40 }, { name: "amy", seasons: 1, games: 10 }, { name: "bob", seasons: 3, games: 50 }, { name: "cy", seasons: 1, games: 10 }]`;
  assert.deepStrictEqual(ev(ctx, `return TeamsData.sortFormer(${list}, "az").map((c) => c.name)`), ["amy", "bob", "cy", "zed"]);
  assert.deepStrictEqual(ev(ctx, `return TeamsData.sortFormer(${list}, "titles").map((c) => c.name)`), ["bob", "zed", "amy", "cy"]);
  assert.deepStrictEqual(ev(ctx, `const l = ${list}; TeamsData.sortFormer(l, "az"); return l.map((c) => c.name)`), ["zed", "amy", "bob", "cy"]);
});

test("headToHeadCards: best and worst matchup say the win rate and games, and what happened in the playoffs", () => {
  const ctx = setup();
  const cards = ev(ctx, `${H2H} return TeamsData.headToHeadCards(h)`);
  assert.deepStrictEqual(cards.map((c) => c.kind), ["best", "worst", "rival", "losses"]);
  assert.deepStrictEqual([cards[0].head, cards[0].body], ["erin, 7-1", "88% across 8 games."]);
  assert.deepStrictEqual([cards[1].head, cards[1].body], ["cara, 3-5", "38% in 8 games. bob is next at 6-2, then erin at 7-1."]);
  const withPlayoffs = ev(ctx, `${DATA} const m = manager("alice"); m.headToHeadPlayoffs.push({ opponentUserId: "u7", opponentName: "erin", wins: 2, losses: 0, ties: 0 }); return TeamsData.headToHeadCards(TeamsData.headToHead(m))[0].body`);
  assert.strictEqual(withPlayoffs, "88% across 8 games, and 2-0 against them in the playoffs.");
});

test("headToHeadCards: the playoff rival is the opponent met most, and the losses are counted by opponent", () => {
  const ctx = setup();
  const cards = ev(ctx, `${H2H} return TeamsData.headToHeadCards(h)`);
  assert.deepStrictEqual([cards[2].head, cards[2].body], ["cara, 3-0", "3 playoff games, more than against anyone else."]);
  assert.deepStrictEqual([cards[3].head, cards[3].body], ["1 total", "1 to bob."]);
  const many = ev(
    ctx,
    `const m = { headToHead: [], headToHeadPlayoffs: [
       { opponentUserId: "a", opponentName: "evan", wins: 0, losses: 2, ties: 0 },
       { opponentUserId: "b", opponentName: "joe", wins: 3, losses: 1, ties: 0 },
       { opponentUserId: "c", opponentName: "tom", wins: 0, losses: 1, ties: 0 },
       { opponentUserId: "d", opponentName: "pat", wins: 0, losses: 1, ties: 0 } ] };
     return TeamsData.headToHeadCards(TeamsData.headToHead(m)).slice(-2)`
  );
  assert.deepStrictEqual(many[0], { kind: "rival", label: "Playoff rival", head: "joe, 3-1", body: "4 playoff games, more than against anyone else." });
  assert.strictEqual(many[1].head, "5 total");
  assert.strictEqual(many[1].body, "2 to evan and 1 each to joe, pat and tom.");
  const three = ev(
    ctx,
    `const m = { headToHead: [], headToHeadPlayoffs: [
       { opponentUserId: "a", opponentName: "evan", wins: 0, losses: 3, ties: 0 },
       { opponentUserId: "b", opponentName: "joe", wins: 0, losses: 3, ties: 0 },
       { opponentUserId: "c", opponentName: "tom", wins: 0, losses: 2, ties: 0 },
       { opponentUserId: "d", opponentName: "pat", wins: 0, losses: 1, ties: 0 } ] };
     return TeamsData.headToHeadCards(TeamsData.headToHead(m)).slice(-1)[0].body`
  );
  assert.strictEqual(three, "3 to evan, 3 to joe, 2 to tom and 1 to pat.", "one list with a single 'and', not an 'and' inside an 'and'");
});

test("headToHeadCards: a second opponent with two or more playoff wins is named; no playoff games means no playoff cards", () => {
  const ctx = setup();
  const second = ev(
    ctx,
    `const m = { headToHead: [], headToHeadPlayoffs: [
       { opponentUserId: "a", opponentName: "evan", wins: 2, losses: 2, ties: 0 },
       { opponentUserId: "b", opponentName: "sam", wins: 3, losses: 0, ties: 0 } ] };
     return TeamsData.headToHeadCards(TeamsData.headToHead(m))[0].body`
  );
  assert.strictEqual(second, "4 playoff games, more than against anyone else. 3-0 against sam.");
  const none = ev(ctx, `const m = { headToHead: [{ opponentUserId: "a", opponentName: "x", wins: 5, losses: 0, ties: 0 }], headToHeadPlayoffs: [] }; return TeamsData.headToHeadCards(TeamsData.headToHead(m)).map((c) => c.kind)`);
  assert.deepStrictEqual(none, ["best"], "one ranked opponent: a best matchup but no worst, rival or losses");
  assert.deepStrictEqual(ev(ctx, `return TeamsData.headToHeadCards(TeamsData.headToHead(null))`), []);
});

test("headToHeadCards: with no playoff losses the card says so", () => {
  const ctx = setup();
  const c = ev(ctx, `const m = { headToHead: [], headToHeadPlayoffs: [{ opponentUserId: "a", opponentName: "x", wins: 2, losses: 0, ties: 0 }] }; return TeamsData.headToHeadCards(TeamsData.headToHead(m)).find((x) => x.kind === "losses")`);
  assert.deepStrictEqual([c.head, c.body], ["0 total", "No playoff losses yet."]);
});

// ---- Draft ---------------------------------------------------------------------------------------

test("draftYears: years with picks, newest first; a season in progress is listed but marked ungraded", () => {
  const ctx = setup();
  const years = ev(ctx, `${DATA} return TeamsData.draftYears(manager("alice"))`);
  assert.deepStrictEqual(years, [
    { year: 2022, picks: 2, graded: false, title: false },
    { year: 2021, picks: 4, graded: true, title: true },
  ]);
  assert.deepStrictEqual(ev(ctx, `return TeamsData.draftYears(null)`), []);
});

test("defaultDraftYear: the newest graded year, else the newest year with picks, else nothing", () => {
  const ctx = setup();
  assert.strictEqual(ev(ctx, `${DATA} return TeamsData.defaultDraftYear(TeamsData.draftYears(manager("alice")))`), 2021);
  assert.strictEqual(ev(ctx, `return TeamsData.defaultDraftYear([{ year: 2026, graded: false }])`), 2026);
  assert.strictEqual(ev(ctx, `return TeamsData.defaultDraftYear([])`), null);
});

test("reportCards: every pick's grade in pick order with the S+A and D+F counts; a season in progress has no row at all", () => {
  const ctx = setup();
  const rows = ev(ctx, `${DATA} return TeamsData.reportCards(manager("alice"))`);
  assert.deepStrictEqual(rows, [{ year: 2021, title: true, grades: ["S", "A", "C", "F"], sa: 2, df: 1 }]);
});

test("reportCards: D and F both count as a bad pick, S and A both as a good one", () => {
  const ctx = setup();
  const row = ev(ctx, `const m = { seasons: [{ season: 2020, isSeasonComplete: true, draftPicks: [{ grade: "S" }, { grade: "A" }, { grade: "B" }, { grade: "D" }, { grade: "F" }, { grade: "D" }] }] }; return TeamsData.reportCards(m)[0]`);
  assert.deepStrictEqual([row.sa, row.df], [2, 3]);
});

test("reportCards: a pick with no grade stays in its place as an ungraded square", () => {
  const ctx = setup();
  const row = ev(ctx, `${DATA} const m = manager("alice"); m.seasons.find((s) => Number(s.season) === 2021).draftPicks[1].grade = null; return TeamsData.reportCards(m)[0]`);
  assert.deepStrictEqual(row.grades, ["S", null, "C", "F"]);
  assert.strictEqual(row.sa, 1);
});

test("draftTable: a finished year shows grade and points versus the slot for every pick", () => {
  const ctx = setup();
  const t = ev(ctx, `${DATA} return TeamsData.draftTable(manager("alice").seasons.find((s) => Number(s.season) === 2021))`);
  assert.deepStrictEqual([t.year, t.graded, t.title, t.picks.length], [2021, true, true, 4]);
  assert.deepStrictEqual(t.picks.map((p) => [p.label, p.grade, p.vsSlot]), [["1.1", "S", 80], ["1.2", "A", 40], ["2.1", "C", -2], ["2.2", "F", -40]]);
  assert.strictEqual(t.maxVsSlot, 80);
});

test("draftTable: the season in progress shows the picks and points so far but NO grade and NO value versus the slot", () => {
  const ctx = setup();
  const t = ev(ctx, `${DATA} return TeamsData.draftTable(manager("alice").seasons.find((s) => Number(s.season) === 2022))`);
  assert.strictEqual(t.graded, false);
  assert.deepStrictEqual(t.picks.map((p) => [p.label, p.grade, p.vsSlot, p.points]), [["1.1", null, null, 55], ["1.2", null, null, 70]]);
  assert.strictEqual(t.maxVsSlot, 0);
});

test("draftTable: an unknown grade is dropped, and no season is null", () => {
  const ctx = setup();
  const t = ev(ctx, `${DATA} const s = manager("alice").seasons.find((x) => Number(x.season) === 2021); s.draftPicks[0].grade = "Z"; return TeamsData.draftTable(s)`);
  assert.strictEqual(t.picks[0].grade, null);
  assert.strictEqual(ev(ctx, `return TeamsData.draftTable(null)`), null);
});

test("isGraded: a season without the flag (an ESPN year) counts as over, and only an explicit false is not", () => {
  const ctx = setup();
  assert.deepStrictEqual(ev(ctx, `return [TeamsData.isGraded({}), TeamsData.isGraded({ isSeasonComplete: true }), TeamsData.isGraded({ isSeasonComplete: false })]`), [true, true, false]);
});

// ---- Most Common Lineup --------------------------------------------------------------------------

test("lineupView: each slot's starts and share of the games, and how the starters were acquired", () => {
  const ctx = setup();
  const v = ev(ctx, `${DATA} return TeamsData.lineupView(manager("alice").seasons.find((s) => Number(s.season) === 2021))`);
  assert.deepStrictEqual([v.year, v.weeks, v.title], [2021, 14, true]);
  assert.deepStrictEqual(v.slots.map((s) => [s.slot, s.starts, s.acquisition]), [["QB", 14, "Draft"], ["RB1", 7, "Waivers"], ["WR1", 10, "Draft"], ["K", 0, null]]);
  assert.strictEqual(v.slots[1].share, 0.5);
  assert.deepStrictEqual(v.mix, [{ label: "Draft", count: 2 }, { label: "Waivers", count: 1 }], "an empty slot is not counted");
});

test("lineupView: a starter with no recorded acquisition is 'Roster', a share never passes 1, and no lineup is null", () => {
  const ctx = setup();
  const v = ev(ctx, `return TeamsData.lineupView({ season: "2021", startingLineup: { weeksCounted: 10, slots: [{ slot: "QB", player: "Q", starts: 12 }] } })`);
  assert.deepStrictEqual([v.slots[0].acquisition, v.slots[0].share], ["Roster", 1]);
  assert.strictEqual(ev(ctx, `return TeamsData.lineupView({ season: 2019, startingLineup: null })`), null);
  assert.strictEqual(ev(ctx, `return TeamsData.lineupView({ season: 2019, startingLineup: { weeksCounted: 0, slots: [] } })`), null);
  assert.strictEqual(ev(ctx, `return TeamsData.lineupView({ season: 2019, startingLineup: { weeksCounted: 0, slots: [{ slot: "QB", player: "Q", starts: 0 }] } })`).slots[0].share, 0);
});

// ---- Season Awards and Player Representative ------------------------------------------------------

const AWARDS = {
  seasons: {
    2025: { "Best Draft Pick": { username: "Alice", detail: "Ann, 1st" }, "Worst Drop": { username: "bob", detail: "Rudy" } },
    2023: { "Best Team": { username: "alice", detail: "" }, "Best FA Pickup": { username: "alice", detail: "Kyren" } },
    2017: { "Best Draft Pick": { username: "alice", detail: "Old" } },
    2024: { "Most Significant Injury": { username: "alice", detail: "Hurt" }, "Worst Draft Pick": { winnerName: "Macklin", detail: "no username" } },
  },
};

test("awardsFor: the owner's awards newest first, best-of ones good and worst-of ones bad, matched whatever the capitalisation", () => {
  const ctx = setup();
  ctx.__awards = AWARDS;
  const rows = ev(ctx, `return TeamsData.awardsFor("alice", __awards, new Set(["2025", "2024", "2023"]))`);
  assert.deepStrictEqual(rows.map((r) => [r.year, r.category, r.good]), [[2025, "Best Draft Pick", true], [2024, "Most Significant Injury", false], [2023, "Best Draft Pick".replace("Draft Pick", "FA Pickup"), true], [2023, "Best Team", true]]);
  assert.strictEqual(rows[0].detail, "Ann, 1st");
});

test("awardsFor: years the site does not track are left out, and nothing to look up is an empty list", () => {
  const ctx = setup();
  ctx.__awards = AWARDS;
  const rows = ev(ctx, `return TeamsData.awardsFor("alice", __awards, new Set(["2025"]))`);
  assert.deepStrictEqual(rows.map((r) => r.year), [2025]);
  assert.strictEqual(ev(ctx, `return TeamsData.awardsFor("alice", __awards, null).length`), 5, "no year filter keeps them all");
  assert.deepStrictEqual(ev(ctx, `return TeamsData.awardsFor(null, __awards, null)`), []);
  assert.deepStrictEqual(ev(ctx, `return TeamsData.awardsFor("alice", null, null)`), []);
});

test("playerRep: the five most rostered players, each bar sized against the leader", () => {
  const ctx = setup();
  const rep = ev(ctx, `${DATA} return TeamsData.playerRep(manager("alice"))`);
  assert.deepStrictEqual(rep.map((p) => [p.name, p.weeks, p.share]), [["Player One", 40, 1], ["Player Two", 10, 0.25]]);
  assert.deepStrictEqual(ev(ctx, `${DATA} return TeamsData.playerRep(manager("bob"))`), []);
  assert.deepStrictEqual(ev(ctx, `return TeamsData.playerRep(null)`), []);
  const six = ev(ctx, `return TeamsData.playerRep({ mostRostered: Array.from({ length: 8 }, (_, i) => ({ playerId: "p" + i, name: "P" + i, weeksRostered: 8 - i })) }).length`);
  assert.strictEqual(six, 5);
});
