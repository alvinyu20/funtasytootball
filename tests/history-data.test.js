const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const fx = require("./helpers/history-fixture.js");

function setup() {
  const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "history-data.js"]);
  ctx.__chain = fx.chain();
  ctx.__manual = fx.manual();
  ctx.__managers = fx.managers();
  return ctx;
}

// Evaluates an expression inside the loaded site and hands back plain JSON.
function ev(ctx, code) {
  return JSON.parse(runInLoadedContext(ctx, `JSON.stringify((() => { ${code} })())`));
}

const LEDGER = "const ledger = HistoryData.buildLedger(__chain, __manual);";

// ---- the ledger --------------------------------------------------------------

test("buildLedger: every season oldest to newest, the ESPN year first, each with its standings in seed order", () => {
  const ctx = setup();
  const ledger = ev(ctx, `return HistoryData.buildLedger(__chain, __manual)`);
  assert.deepStrictEqual(ledger.map((s) => [s.year, s.source]), [[2019, "manual"], [2020, "sleeper"], [2021, "sleeper"], [2022, "sleeper"]]);
  // Sleeper seed = record, then points: bob 3-0 is #1 in 2020 even though alice won the title
  assert.deepStrictEqual(ledger[1].rows.map((r) => [r.name, r.seed]), [["bob", 1], ["alice", 2], ["cara", 3], ["dan", 4]]);
  assert.deepStrictEqual(ledger[0].rows.map((r) => [r.name, r.seed]), [["bob", 1], ["Alice", 2], ["cara", 3], ["dan", 4], ["zed", 5]]);
});

test("buildLedger: champion, runner-up and third are the rows the bracket (or the ESPN medals) name", () => {
  const ctx = setup();
  const ledger = ev(ctx, `return HistoryData.buildLedger(__chain, __manual)`);
  const podium = (s) => [s.champion && s.champion.name, s.runnerUp && s.runnerUp.name, s.third && s.third.name];
  assert.deepStrictEqual(podium(ledger[0]), ["Alice", "bob", "cara"], "ESPN year, from the medals");
  assert.deepStrictEqual(podium(ledger[1]), ["alice", "bob", "cara"], "Sleeper year, from the bracket");
  assert.deepStrictEqual(podium(ledger[3]), [null, null, null], "a season with no finished bracket has no podium");
});

test("buildLedger: an ESPN season with no medals still finds its podium from the final and the third-place game", () => {
  const ctx = setup();
  ctx.__manual.seasons[0].standings.forEach((r) => delete r.medal);
  const s = ev(ctx, `return HistoryData.buildLedger([], __manual)[0]`);
  assert.deepStrictEqual([s.champion.name, s.runnerUp.name, s.third.name], ["Alice", "bob", "cara"]);
});

test("buildLedger: complete follows the Sleeper status; ESPN years are always complete", () => {
  const ctx = setup();
  const ledger = ev(ctx, `return HistoryData.buildLedger(__chain, __manual)`);
  assert.deepStrictEqual(ledger.map((s) => s.complete), [true, true, true, false]);
});

test("buildLedger: playoff spots come from the league settings (6 if unset) and, for ESPN, from who made the playoffs", () => {
  const ctx = setup();
  delete ctx.__chain[1].league.settings.playoff_teams; // the 2021 league
  const ledger = ev(ctx, `return HistoryData.buildLedger(__chain, __manual)`);
  assert.strictEqual(ledger[2].playoffTeams, 6, "no setting: the default");
  assert.strictEqual(ledger[1].playoffTeams, 2, "the league's own setting");
  assert.strictEqual(ledger[0].playoffTeams, 3, "three ESPN teams are marked as playoff teams");
});

test("buildLedger: a team's custom name is kept, and a year in both sources keeps the Sleeper one", () => {
  const ctx = setup();
  ctx.__manual.seasons.push({ year: 2020, champion: "bob", standings: [{ team: "bob", standing: 1, wins: 1, losses: 0, medal: "gold" }] });
  const ledger = ev(ctx, `return HistoryData.buildLedger(__chain, __manual)`);
  const y2020 = ledger.filter((s) => s.year === 2020);
  assert.strictEqual(y2020.length, 1);
  assert.strictEqual(y2020[0].source, "sleeper");
  assert.strictEqual(y2020[0].rows.find((r) => r.name === "alice").teamName, "Team Alice");
});

// ---- Trophy Room ---------------------------------------------------------------

test("trophyCards: newest first, with the season in progress on top and a real card for each champion", () => {
  const ctx = setup();
  const cards = ev(ctx, `${LEDGER} return HistoryData.trophyCards(ledger)`);
  assert.deepStrictEqual(cards.map((c) => [c.year, c.kind]), [[2022, "live"], [2021, "champion"], [2020, "champion"], [2019, "champion"]]);
});

test("trophyCards: each champion's record and seed are their regular-season finish, and BEAT is the runner-up", () => {
  const ctx = setup();
  const cards = ev(ctx, `${LEDGER} return HistoryData.trophyCards(ledger)`);
  const c2020 = cards.find((c) => c.year === 2020);
  assert.strictEqual(c2020.record, "2-1");
  assert.strictEqual(c2020.seed, 2, "alice won the 2020 title as the #2 seed");
  assert.strictEqual(c2020.beat, "bob");
  const c2021 = cards.find((c) => c.year === 2021);
  assert.strictEqual(c2021.seed, 1);
  assert.strictEqual(c2021.record, "3-0");
});

test("trophyCards: titles are numbered per owner across both eras, and only a back-to-back title is a REPEAT", () => {
  const ctx = setup();
  const cards = ev(ctx, `${LEDGER} return HistoryData.trophyCards(ledger)`);
  const by = (y) => cards.find((c) => c.year === y);
  assert.deepStrictEqual([by(2019).titleNumber, by(2020).titleNumber, by(2021).titleNumber], [1, 2, 3], "2019 is ESPN, matched to Sleeper's alice despite the capital A");
  assert.deepStrictEqual([by(2019).repeat, by(2020).repeat, by(2021).repeat], [false, true, true]);
});

test("trophyCards: a title that is not back-to-back is numbered but is not a repeat", () => {
  const ctx = setup();
  ctx.__chain[0].bracket[0] = { r: 3, m: 7, p: 1, t1: 2, t2: 1, w: 2, l: 1 }; // bob wins 2020 instead
  const cards = ev(ctx, `${LEDGER} return HistoryData.trophyCards(ledger)`);
  const by = (y) => cards.find((c) => c.year === y);
  assert.deepStrictEqual([by(2020).name, by(2020).titleNumber, by(2020).repeat], ["bob", 1, false]);
  assert.deepStrictEqual([by(2021).name, by(2021).titleNumber, by(2021).repeat], ["alice", 2, false], "alice's 2019 and 2021 titles are not consecutive");
});

test("trophyCards: a year missing from the record between two titles is not a back-to-back", () => {
  const ctx = setup();
  ctx.__chain.shift(); // no 2020 at all: alice won 2019 (ESPN) and 2021
  const cards = ev(ctx, `${LEDGER} return HistoryData.trophyCards(ledger)`);
  assert.deepStrictEqual(cards.find((c) => c.year === 2021).repeat, false);
  assert.strictEqual(cards.find((c) => c.year === 2021).titleNumber, 2, "still her second title");
});

test("trophyCards: the team name shows only when it is a real, different name", () => {
  const ctx = setup();
  const cards = ev(ctx, `${LEDGER} return HistoryData.trophyCards(ledger)`);
  assert.strictEqual(cards.find((c) => c.year === 2021).teamName, "Team Alice");
  assert.strictEqual(cards.find((c) => c.year === 2019).teamName, null, "ESPN years have no team name on record");
  ctx.__chain[1].users[0].metadata = {};
  const again = ev(ctx, `${LEDGER} return HistoryData.trophyCards(ledger)`);
  assert.strictEqual(again.find((c) => c.year === 2021).teamName, null, "no custom name falls back to the username, which is not repeated");
});

test("trophyCards: a finished season with no champion on record gets no card and breaks a repeat streak", () => {
  const ctx = setup();
  ctx.__chain[0].bracket = []; // 2020 finished but its bracket is missing
  const cards = ev(ctx, `${LEDGER} return HistoryData.trophyCards(ledger)`);
  assert.ok(!cards.some((c) => c.year === 2020));
  assert.strictEqual(cards.find((c) => c.year === 2021).repeat, false, "2021 follows a year with no known champion");
});

// ---- Titles by Owner, header tiles ------------------------------------------------

test("titlesByOwner: most titles first, ties to whoever won theirs first; counts finished seasons and champions", () => {
  const ctx = setup();
  ctx.__chain[0].bracket[0] = { r: 3, m: 7, p: 1, t1: 2, t2: 1, w: 2, l: 1 }; // bob 2020, alice 2019 + 2021
  const t = ev(ctx, `${LEDGER} return HistoryData.titlesByOwner(ledger)`);
  assert.deepStrictEqual(t.owners.map((o) => [o.name, o.titles]), [["alice", 2], ["bob", 1]]);
  assert.strictEqual(t.seasonsComplete, 3, "2019, 2020 and 2021; the live 2022 is not complete");
  assert.strictEqual(t.champions, 2);
  const tie = ev(ctx, `${LEDGER} ledger[0].champion = null; return HistoryData.titlesByOwner(ledger).owners.map((o) => o.name)`);
  assert.deepStrictEqual(tie, ["bob", "alice"], "1-1: bob won first (2020 vs 2021)");
});

test("titlesByOwner / heroStats: a season whose final has been played counts as finished even if Sleeper still calls it in season", () => {
  const ctx = setup();
  ctx.__chain[2].bracket = [{ r: 3, m: 7, p: 1, t1: 4, t2: 1, w: 4, l: 1 }]; // dan wins 2022; status stays in_season
  const t = ev(ctx, `${LEDGER} return HistoryData.titlesByOwner(ledger)`);
  assert.strictEqual(t.seasonsComplete, 4);
  assert.strictEqual(t.champions, 2);
  const h = ev(ctx, `${LEDGER} return HistoryData.heroStats(ledger)`);
  assert.strictEqual(h.liveYear, null, "nothing is still being played");
});

test("heroStats: seasons on record, finished seasons, the live year, champions and who has the most titles", () => {
  const ctx = setup();
  const h = ev(ctx, `${LEDGER} return HistoryData.heroStats(ledger)`);
  assert.deepStrictEqual([h.seasonsOnRecord, h.seasonsComplete, h.liveYear, h.champions, h.mostTitles, h.mostTitlesNames], [4, 3, 2022, 1, 3, ["alice"]]);
});

// ---- Where Podiums Come From -------------------------------------------------------

test("podiumsBySeed: titles, runner-ups and thirds counted by regular-season seed", () => {
  const ctx = setup();
  const p = ev(ctx, `${LEDGER} return HistoryData.podiumsBySeed(ledger)`);
  assert.strictEqual(p.seasons, 3);
  const row = (seed) => p.rows[seed - 1];
  // 2019 ESPN: Alice #2 title, bob #1 second, cara #3 third. 2020: alice #2, bob #1, cara #3. 2021: alice #1, bob #2, cara #3.
  assert.deepStrictEqual([row(1).title, row(1).second, row(1).third, row(1).total], [1, 2, 0, 3]);
  assert.deepStrictEqual([row(2).title, row(2).second, row(2).third, row(2).total], [2, 1, 0, 3]);
  assert.deepStrictEqual([row(3).title, row(3).second, row(3).third, row(3).total], [0, 0, 3, 3]);
  assert.strictEqual(p.rows.reduce((t, r) => t + r.total, 0), 9, "three podium places in each of three seasons");
});

test("podiumsBySeed: at least six seeds are listed, more only when a podium came from further down", () => {
  const ctx = setup();
  const p = ev(ctx, `${LEDGER} return HistoryData.podiumsBySeed(ledger)`);
  assert.strictEqual(p.rows.length, 6);
  assert.deepStrictEqual([p.rows[3].total, p.rows[5].total], [0, 0], "seeds with no podium show empty");
  const deep = ev(ctx, `${LEDGER} ledger[1].runnerUp = { seed: 8, name: "x", key: "x" }; return HistoryData.podiumsBySeed(ledger).rows.length`);
  assert.strictEqual(deep, 8);
});

test("podiumsBySeed: a league with an eight-team playoff lists eight seeds even if no podium came from 7th or 8th", () => {
  const ctx = setup();
  ctx.__chain[0].league.settings.playoff_teams = 8;
  assert.strictEqual(ev(ctx, `${LEDGER} return HistoryData.podiumsBySeed(ledger).rows.length`), 8);
});

test("podiumsBySeed: a season without a champion on record is left out of the count", () => {
  const ctx = setup();
  const p = ev(ctx, `${LEDGER} return HistoryData.podiumsBySeed(ledger.slice(3))`);
  assert.strictEqual(p.seasons, 0);
});

// ---- owners and their seasons --------------------------------------------------------

const OWNERS = `${LEDGER} const data = HistoryData.buildOwners(__managers, __manual, ledger); const by = (n) => data.owners.find((o) => o.name === n);`;

test("buildOwners: ESPN seasons join the Sleeper owner of the same username, whatever the capitalisation; ESPN-only owners are not listed", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} return { names: data.owners.map((o) => o.name).sort(), alice: by("alice").cells.map((c) => c.year), first: data.firstYear, latest: data.latestYear }`);
  assert.deepStrictEqual(r.names, ["alice", "bob", "cara", "dan", "gone", "newbie"], "zed only ever played ESPN");
  assert.deepStrictEqual(r.alice, [2019, 2020, 2021, 2022]);
  assert.deepStrictEqual([r.first, r.latest], [2019, 2022]);
});

test("buildOwners: each season is a medal, a playoff trip, a miss, or in/out while it is being played", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} const s = (n) => by(n).cells.map((c) => c.year + ":" + c.status).join(" "); return { alice: s("alice"), bob: s("bob"), cara: s("cara"), dan: s("dan"), newbie: s("newbie") }`);
  assert.strictEqual(r.alice, "2019:champion 2020:champion 2021:champion 2022:live-in");
  assert.strictEqual(r.bob, "2019:runnerUp 2020:runnerUp 2021:runnerUp 2022:live-out");
  assert.strictEqual(r.cara, "2019:third 2020:third 2021:third 2022:live-out");
  assert.strictEqual(r.dan, "2019:missed 2020:missed 2021:missed 2022:live-in");
  assert.strictEqual(r.newbie, "2022:live-out", "5th of 5 with two playoff spots");
});

test("cellStatus: the in/out line is the number of playoff spots, and a season nobody has played yet is neither", () => {
  const ctx = setup();
  const st = (cell, spots) => ev(ctx, `return HistoryData.cellStatus(${JSON.stringify(cell)}, ${spots})`);
  const live = { complete: false, wins: 1, losses: 1, ties: 0 };
  assert.strictEqual(st({ ...live, finish: 6 }, 6), "live-in");
  assert.strictEqual(st({ ...live, finish: 7 }, 6), "live-out");
  assert.strictEqual(st({ ...live, finish: 3 }, undefined), "live-in", "no setting falls back to six spots");
  assert.strictEqual(st({ complete: false, wins: 0, losses: 0, ties: 0, finish: 1 }, 6), "live");
  assert.strictEqual(st({ complete: true, finish: 1, isChampion: true }, 6), "champion");
  assert.strictEqual(st({ complete: true, finish: 9, appeared: true }, 6), "playoffs");
  assert.strictEqual(st({ complete: true, finish: 9 }, 6), "missed");
});

test("buildOwners: a year an owner already has from Sleeper is not added a second time from the ESPN file", () => {
  const ctx = setup();
  ctx.__managers[0].seasons.unshift(fx.managerSeason(2019, 3, 6, 5)); // alice also has a Sleeper 2019
  const alice = ev(ctx, `${OWNERS} return data.owners.find((o) => o.name === "alice")`);
  const y2019 = alice.cells.filter((c) => c.year === 2019);
  assert.strictEqual(y2019.length, 1);
  assert.strictEqual(y2019[0].source, "sleeper");
  assert.strictEqual(y2019[0].finish, 3);
});

test("buildOwners: titles, runner-ups and thirds add up across both eras", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} const m = (o) => [o.titles, o.seconds, o.thirds, o.podiums]; return { alice: m(by("alice")), bob: m(by("bob")), cara: m(by("cara")), dan: m(by("dan")) }`);
  assert.deepStrictEqual(r, { alice: [3, 0, 0, 3], bob: [0, 3, 0, 3], cara: [0, 0, 3, 3], dan: [0, 0, 0, 0] });
});

test("buildOwners: playoff trips are out of FINISHED seasons, so the season in progress is never counted as a miss", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} const t = (n) => [by(n).trips, by(n).completedYears, Math.round(by(n).tripPct)]; return { alice: t("alice"), dan: t("dan"), newbie: t("newbie") }`);
  assert.deepStrictEqual(r.alice, [3, 3, 100]);
  assert.deepStrictEqual(r.dan, [0, 3, 0]);
  assert.deepStrictEqual(r.newbie, [0, 0, 0], "no finished seasons yet: 0 of 0, not a 0% record");
});

test("buildOwners: career records add the ESPN and Sleeper seasons, and the regular season includes the one in progress", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} const a = by("alice"); return { reg: [a.regW, a.regL], po: [a.poW, a.poL], regPct: Math.round(a.regPct * 10) / 10, poPct: a.poPct }`);
  // regular season: 2019 8-3, 2020 2-1, 2021 3-0, 2022 1-1 (in progress)
  assert.deepStrictEqual(r.reg, [14, 5]);
  assert.strictEqual(r.regPct, 73.7);
  // playoffs: 2019 2-0, 2020 2-0, 2021 2-0
  assert.deepStrictEqual(r.po, [6, 0]);
  assert.strictEqual(r.poPct, 100);
});

test("buildOwners: average finish is over finished seasons only, and is null before one has been played", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} return { alice: by("alice").avgFinish, bob: by("bob").avgFinish, newbie: by("newbie").avgFinish }`);
  assert.strictEqual(r.alice, (2 + 2 + 1) / 3, "2019 #2, 2020 #2, 2021 #1; the live 2022 #2 is left out");
  assert.strictEqual(r.bob, (1 + 1 + 2) / 3);
  assert.strictEqual(r.newbie, null);
});

test("buildOwners: active, former and new are judged against the newest season on record", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} const f = (n) => [by(n).active, by(n).former, by(n).isNew]; return { alice: f("alice"), gone: f("gone"), newbie: f("newbie") }`);
  assert.deepStrictEqual(r.alice, [true, false, false]);
  assert.deepStrictEqual(r.gone, [false, true, false], "played 2020 and not since");
  assert.deepStrictEqual(r.newbie, [true, false, true], "first season is the newest one");
});

test("buildOwners: someone whose first season is also the first season on record is not 'new'", () => {
  const ctx = setup();
  const r = ev(ctx, `const ledger = HistoryData.buildLedger(__chain.slice(0, 1), { seasons: [] }); const d = HistoryData.buildOwners(__managers, { seasons: [] }, ledger); return d.owners.filter((o) => o.isNew).map((o) => o.name)`);
  assert.deepStrictEqual(r, []);
});

// ---- sorting and filtering ------------------------------------------------------------

const names = (rows) => rows.map((o) => o.name);

test("sortOwners: Titles puts the most titles first, then the better playoff rate, then more trips", () => {
  const ctx = setup();
  ctx.__managers[2].seasons[0].isChampion = true; // cara also wins one: 1 title, 3 of 3 trips
  ctx.__managers[2].seasons[0].isThirdPlace = false;
  const r = ev(ctx, `${OWNERS} return HistoryData.sortOwners(data.owners, "titles").map((o) => o.name)`);
  assert.deepStrictEqual(r.slice(0, 2), ["alice", "cara"], "alice 3 titles, then cara's single one beats everyone with none");
});

test("sortOwners: the zero-title owners are ranked by playoff rate, then by seasons played, then by regular-season win rate", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} return HistoryData.sortOwners(data.owners, "titles").map((o) => o.name)`);
  // alice 3 titles; bob 3/3 trips; cara 3/3 trips (tie: poW 3 vs 3, years 3 vs 3, regPct) ... dan 0/3, gone 0/1, newbie 0/0
  assert.strictEqual(r[0], "alice");
  assert.deepStrictEqual(r.slice(-3), ["dan", "gone", "newbie"], "0 of 3, then 0 of 1, then 0 of 0");
});

test("sortOwners: Titles falls through playoff wins, then seasons played, then regular-season win %, before the name", () => {
  const ctx = setup();
  const order = (a, b) =>
    ev(
      ctx,
      `const o = (name, x) => Object.assign({ name, titles: 0, tripPct: 50, trips: 1, poW: 0, completedYears: 2, regPct: 50, regGames: 20, podiums: 0, seconds: 0 }, x);
       return HistoryData.sortOwners([o("a", ${JSON.stringify(b)}), o("z", ${JSON.stringify(a)})], "titles").map((x) => x.name)`
    );
  assert.deepStrictEqual(order({ poW: 5, completedYears: 1 }, { poW: 2, completedYears: 3 }), ["z", "a"], "more playoff wins first, even over more seasons");
  assert.deepStrictEqual(order({ completedYears: 5, regPct: 40 }, { completedYears: 2, regPct: 60 }), ["z", "a"], "then more seasons, even over a better win rate");
  assert.deepStrictEqual(order({ regPct: 60 }, { regPct: 40 }), ["z", "a"], "then the better regular-season win rate");
  assert.deepStrictEqual(order({}, {}), ["a", "z"], "and a dead heat is by name");
});

test("sortOwners: Reg. season win % puts the owner with more games first when the rates are equal", () => {
  const ctx = setup();
  const r = ev(
    ctx,
    `const o = (name, regGames) => ({ name, titles: 0, tripPct: 0, trips: 0, poW: 0, completedYears: 0, regPct: 50, regGames, podiums: 0, seconds: 0 });
     return HistoryData.sortOwners([o("a", 20), o("z", 40)], "winpct").map((x) => x.name)`
  );
  assert.deepStrictEqual(r, ["z", "a"], "50% over 40 games says more than 50% over 20");
});

test("sortOwners: each pill orders the table its own way", () => {
  const ctx = setup();
  const by = (how) => ev(ctx, `${OWNERS} return HistoryData.sortOwners(data.owners, ${JSON.stringify(how)}).map((o) => o.name)`);
  assert.strictEqual(by("podiums")[0], "alice", "3 podiums, ties broken by titles");
  assert.deepStrictEqual(by("podiums").slice(0, 3), ["alice", "bob", "cara"]);
  assert.strictEqual(by("winpct")[0], "bob", "15-4 beats alice's 14-5");
  assert.strictEqual(by("playoff").slice(-1)[0], "newbie", "no seasons, no rate");
  assert.notDeepStrictEqual(by("winpct"), by("titles"), "win % is not just the title order");
});

test("sortOwners: an unknown sort falls back to Titles, and sorting never changes the list it was given", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} const before = data.owners.map((o) => o.name).join(); const a = HistoryData.sortOwners(data.owners, "nonsense").map((o) => o.name).join(); const b = HistoryData.sortOwners(data.owners, "titles").map((o) => o.name).join(); return { same: a === b, untouched: before === data.owners.map((o) => o.name).join() }`);
  assert.deepStrictEqual(r, { same: true, untouched: true });
});

test("filterOwners: 'active' keeps only owners in the newest season", () => {
  const ctx = setup();
  const r = ev(ctx, `${OWNERS} return { all: HistoryData.filterOwners(data.owners, "all").length, active: HistoryData.filterOwners(data.owners, "active").map((o) => o.name).sort() }`);
  assert.strictEqual(r.all, 6);
  assert.deepStrictEqual(r.active, ["alice", "bob", "cara", "dan", "newbie"]);
});

// ---- Your History ----------------------------------------------------------------------

test("yourHistory: titles with their years, podiums, average finish and playoff record", () => {
  const ctx = setup();
  const y = ev(ctx, `${OWNERS} return HistoryData.yourHistory(data.owners, ledger, "ALICE")`);
  assert.deepStrictEqual([y.name, y.titles, y.titleYears, y.podiums, y.podiumText], ["alice", 3, [2019, 2020, 2021], 3, "3 titles"]);
  assert.strictEqual(y.poRecord, "6-0");
  assert.strictEqual(y.finishRank, 2, "bob's 1.33 average finish beats alice's 1.67");
  assert.strictEqual(y.playoffRank, 1);
});

test("yourHistory: the podium line lists each kind that applies, and singular/plural", () => {
  const ctx = setup();
  const y = ev(ctx, `${OWNERS} by("bob").seconds = 1; by("bob").thirds = 2; by("bob").titles = 1; return HistoryData.yourHistory(data.owners, ledger, "bob").podiumText`);
  assert.strictEqual(y, "1 title, 1 runner-up, 2 thirds");
});

test("yourHistory: who is ahead in playoff wins, when you are second", () => {
  const ctx = setup();
  const y = ev(ctx, `${OWNERS} return HistoryData.yourHistory(data.owners, ledger, "bob")`);
  assert.strictEqual(y.playoffRank, 2);
  assert.deepStrictEqual([y.aheadName, y.aheadRecord], ["alice", "6-0"]);
});

test("yourHistory: the season in progress shows your rank, the games played and whether you are inside the playoff spots", () => {
  const ctx = setup();
  const inside = ev(ctx, `${OWNERS} return HistoryData.yourHistory(data.owners, ledger, "alice").live`);
  assert.deepStrictEqual(inside, { year: 2022, finish: 2, games: 2, inside: true, playoffTeams: 2 });
  const outside = ev(ctx, `${OWNERS} return HistoryData.yourHistory(data.owners, ledger, "bob").live`);
  assert.strictEqual(outside.inside, false);
  assert.strictEqual(ev(ctx, `${OWNERS} return HistoryData.yourHistory(data.owners, ledger, "gone").live`), null, "not in this season");
});

test("yourHistory: nobody picked, or someone with no seasons here, is null; no live line when the newest season is finished", () => {
  const ctx = setup();
  assert.strictEqual(ev(ctx, `${OWNERS} return HistoryData.yourHistory(data.owners, ledger, "nobody")`), null);
  assert.strictEqual(ev(ctx, `${OWNERS} return HistoryData.yourHistory(data.owners, ledger, "zed")`), null, "zed only played ESPN");
  assert.strictEqual(ev(ctx, `${OWNERS} return HistoryData.yourHistory(data.owners, ledger.slice(0, 3), "alice").live`), null);
});

// ---- Championship Rings ----------------------------------------------------------------

function ringSeason(season, ownerId, name) {
  return {
    league: { season },
    rosters: [
      { roster_id: 1, owner_id: "u1" },
      { roster_id: 2, owner_id: "u2" },
    ],
    users: [
      { user_id: "u1", display_name: "yulovesyou" },
      { user_id: "u2", display_name: "hmart92" },
    ],
    bracket: [],
  };
}

function rings(ctx, seasons, deep, directory, champion) {
  ctx.__seasons = seasons;
  ctx.__deep = deep;
  ctx.__dir = directory || {};
  return ev(
    ctx,
    `${champion ? `SleeperAPI.findChampionRosterId = ${champion};` : `SleeperAPI.findChampionRosterId = () => 1;`} return HistoryData.computeRings(__seasons, __deep, __dir)`
  );
}

test("computeRings: a player on the champion's roster at ANY point that season earns the ring, started or not", () => {
  const ctx = setup();
  const r = rings(ctx, [ringSeason("2021")], [{ weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["P1", "P2"] }, { roster_id: 2, players: ["P3"] }] }, { week: 2, matchups: [{ roster_id: 1, players: ["P1"] }, { roster_id: 2, players: ["P3"] }] }] }]);
  assert.deepStrictEqual(r.map((p) => p.playerId).sort(), ["P1", "P2"], "P2 was dropped before the end, P3 was never the champion's");
});

test("computeRings: games started counts only the weeks the player was in the champion's starting lineup", () => {
  const ctx = setup();
  const r = rings(ctx, [ringSeason("2021")], [{ weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["P1"], starters: ["P1"] }] }, { week: 2, matchups: [{ roster_id: 1, players: ["P1"], starters: [] }] }, { week: 3, matchups: [{ roster_id: 1, players: ["P1"], starters: ["P1"] }] }] }]);
  assert.strictEqual(r[0].totalGamesStarted, 2, "3 weeks rostered, 2 started");
});

test("computeRings: starts add up across every title season, and each ring remembers its season and owner", () => {
  const ctx = setup();
  const w = (roster, started) => ({ week: 1, matchups: [{ roster_id: roster, players: ["P1"], starters: started ? ["P1"] : [] }] });
  const r = rings(
    ctx,
    [ringSeason("2021"), ringSeason("2022")],
    [{ weeks: [w(1, true), { ...w(1, true), week: 2 }] }, { weeks: [w(2, true)] }],
    {},
    `(() => { let n = 0; return () => (++n === 1 ? 1 : 2); })()`
  );
  assert.strictEqual(r[0].rings.length, 2);
  assert.strictEqual(r[0].totalGamesStarted, 3, "2 starts in 2021 and 1 in 2022");
  assert.deepStrictEqual(r[0].rings.map((x) => [x.season, x.ownerName, x.ownerKey, x.gamesStarted]), [[2021, "yulovesyou", "yulovesyou", 2], [2022, "hmart92", "hmart92", 1]]);
});

test("computeRings: kickers and defenses are not eligible even when they were on the champion's roster", () => {
  const ctx = setup();
  const r = rings(ctx, [ringSeason("2021")], [{ weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["P1", "K1", "D1"] }] }] }], { P1: { position: "RB" }, K1: { position: "K" }, D1: { position: "DEF" } });
  assert.deepStrictEqual(r.map((p) => p.playerId), ["P1"]);
});

test("computeRings: several weeks on the same champion in ONE season is one ring", () => {
  const ctx = setup();
  const r = rings(ctx, [ringSeason("2021")], [{ weeks: [1, 2, 3].map((week) => ({ week, matchups: [{ roster_id: 1, players: ["P1"] }] })) }]);
  assert.strictEqual(r[0].rings.length, 1);
});

test("computeRings: a season with no champion on record gives nobody a ring", () => {
  const ctx = setup();
  const r = rings(ctx, [ringSeason("2026")], [{ weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["P1"] }] }] }], {}, "() => null");
  assert.deepStrictEqual(r, []);
});

test("computeRings: most rings first, then most games started", () => {
  const ctx = setup();
  const seasons = [ringSeason("2020"), ringSeason("2021"), ringSeason("2022")];
  const deep = [
    { weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["A", "B"], starters: ["A", "B"] }] }] },
    { weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["A", "B", "C"], starters: ["A", "C"] }] }] },
    { weeks: [{ week: 1, matchups: [{ roster_id: 1, players: ["C"], starters: ["C"] }, ] }] },
  ];
  const r = rings(ctx, seasons, deep);
  // A: 2 rings 2 starts; B: 2 rings 1 start; C: 2 rings 2 starts (2021 + 2022)
  assert.deepStrictEqual(r.map((p) => [p.playerId, p.rings.length, p.totalGamesStarted]), [["A", 2, 2], ["C", 2, 2], ["B", 2, 1]]);
});

test("ringColumns: one column per Sleeper season that has a champion; ESPN years and the live season have none", () => {
  const ctx = setup();
  const cols = ev(ctx, `${LEDGER} return HistoryData.ringColumns(ledger)`);
  assert.deepStrictEqual(cols.map((c) => [c.year, c.ownerKey]), [[2020, "alice"], [2021, "alice"]]);
});

test("ownerLetters: each owner's first letter, and a longer label for a second owner with the same initial", () => {
  const ctx = setup();
  const l = ev(ctx, `return Object.fromEntries(HistoryData.ownerLetters([{ key: "evan", name: "evangonnerman" }, { key: "yu", name: "yulovesyou" }, { key: "eli", name: "elijah" }, { key: "evan", name: "evangonnerman" }]))`);
  assert.deepStrictEqual(l, { evan: "E", yu: "Y", eli: "El" });
});
