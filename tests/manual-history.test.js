const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["sleeper-api.js", "deep-history.js", "manual-history.js"]);
const { ManualHistory } = ctx;

const REAL_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "manual-history.json"), "utf8"));

test("computeManagerStats: yulovesyou's career totals across all 5 ESPN seasons are correct", () => {
  const stats = ManualHistory.computeManagerStats(REAL_DATA);
  const yulovesyou = stats.get("yulovesyou");
  assert.ok(yulovesyou, "yulovesyou should have an entry");
  assert.strictEqual(yulovesyou.seasons.length, 5, "played in all 5 ESPN seasons");

  // Regular season: 2015 8-5, 2016 8-5, 2017 9-4, 2018 10-3, 2019 8-5
  assert.strictEqual(yulovesyou.totals.careerRegularSeasonWins, 8 + 8 + 9 + 10 + 8);
  assert.strictEqual(yulovesyou.totals.careerRegularSeasonLosses, 5 + 5 + 4 + 3 + 5);

  // Championships: 2015 gold, 2017 gold, 2018 gold = 3. 2019 bronze = 1 third place.
  assert.strictEqual(yulovesyou.totals.championships, 3, "won gold in 2015, 2017, and 2018");
  assert.strictEqual(yulovesyou.totals.thirdPlaceFinishes, 1, "bronze in 2019");
  assert.strictEqual(yulovesyou.totals.runnerUps, 0, "never finished silver");
});

test("computeManagerStats: a manager who never continued past the ESPN era still has correct totals (used for the trophy room, just not a Sleeper-era team profile)", () => {
  const stats = ManualHistory.computeManagerStats(REAL_DATA);
  const chris = stats.get("Chris");
  assert.ok(chris);
  assert.strictEqual(chris.totals.runnerUps, 1, "silver in 2015");
  assert.strictEqual(chris.totals.thirdPlaceFinishes, 0, "Chris LOST the 2016 third-place game to sofarrsogood, so no medal that year");
});

test("computeManagerStats: byes and first picks are counted correctly", () => {
  const stats = ManualHistory.computeManagerStats(REAL_DATA);
  // tduchow: 2015 standing #1 with a bye (verified against the CSV directly).
  const tduchow = stats.get("tduchow");
  assert.ok(tduchow.totals.byes >= 1, "tduchow had at least one bye (2015, #1 seed)");
});

test("computeManagerStats: a season with a genuine all-play Overall Record on file uses it for overallWins/Losses and computes a real Luck value", () => {
  const stats = ManualHistory.computeManagerStats(REAL_DATA);
  const yulo2017 = stats.get("yulovesyou").seasons.find((s) => s.season === 2017);
  assert.ok(yulo2017, "yulovesyou should have a 2017 season entry");
  assert.strictEqual(yulo2017.overallWins, 83, "should use the real all-play record (83-34), not wins+playoffWins");
  assert.strictEqual(yulo2017.overallLosses, 34);
  assert.strictEqual(yulo2017.overallTies, 0);
  assert.ok(yulo2017.luckPct != null, "luckPct should be computed, not null, now that all-play data exists");
  assert.ok(Math.abs(yulo2017.luckPct - -1.7094017094017144) < 1e-9, `expected ~-1.71, got ${yulo2017.luckPct}`);
});

test("computeManagerStats: a season without an Overall Record on file still falls back to the old regular+playoff combined number, with luckPct null", () => {
  const stats = ManualHistory.computeManagerStats(REAL_DATA);
  const yulo2015 = stats.get("yulovesyou").seasons.find((s) => s.season === 2015);
  assert.ok(yulo2015, "yulovesyou should have a 2015 season entry");
  assert.strictEqual(yulo2015.luckPct, null, "2015 has no Overall Record on file, so Luck can't be computed");
  // 2015: 8 regular-season wins + however many playoff wins (yulovesyou won it all that year)
  assert.strictEqual(yulo2015.overallWins, yulo2015.wins + 3, "falls back to wins + playoffWins when there's no all-play record");
});

test("computeManagerStats: a manager who never continued into the Sleeper era still gets a real Luck value for a season with Overall Record data (Hayden #2, 2017)", () => {
  const stats = ManualHistory.computeManagerStats(REAL_DATA);
  const hayden2017 = stats.get("Hayden #2").seasons.find((s) => s.season === 2017);
  assert.ok(hayden2017);
  assert.strictEqual(hayden2017.overallWins, 26);
  assert.strictEqual(hayden2017.overallLosses, 91);
  assert.ok(Math.abs(hayden2017.luckPct - 0.8547008547008572) < 1e-9, `expected ~0.85, got ${hayden2017.luckPct}`);
});

test("computeAllSeasonLuck: only includes (team, season) pairs that have a genuine Overall Record on file", () => {
  const all = ManualHistory.computeAllSeasonLuck(REAL_DATA);
  // 3 years (2017-2019) x 10 teams = 30 entries with luck data; 2015/2016 excluded entirely.
  assert.strictEqual(all.length, 30, "should have exactly 30 luck-computable team-seasons (2017-2019, 10 teams each)");
  assert.ok(!all.some((e) => e.season === 2015), "2015 has no Overall Record data, so no entries for it");
  assert.ok(!all.some((e) => e.season === 2016), "2016 has no Overall Record data, so no entries for it");
  assert.ok(
    all.every((e) => e.season === 2017 || e.season === 2018 || e.season === 2019),
    "every entry should be from one of the 3 years with data"
  );
});

test("computeAllSeasonLuck: evangonnerman's 2019 entry matches the expected Luck value and shape season.js's Total page expects", () => {
  const all = ManualHistory.computeAllSeasonLuck(REAL_DATA);
  const evan2019 = all.find((e) => e.teamName === "evangonnerman" && e.season === 2019);
  assert.ok(evan2019);
  assert.strictEqual(evan2019.wins, 11);
  assert.strictEqual(evan2019.losses, 2);
  assert.strictEqual(evan2019.overallWins, 78);
  assert.strictEqual(evan2019.overallLosses, 39);
  assert.ok(Math.abs(evan2019.luckPct - 17.948717948717952) < 1e-9, `expected ~17.95, got ${evan2019.luckPct}`);
});

test("mergeIntoManager: adds manual totals onto an existing Sleeper-side manager object without clobbering its own numbers", () => {
  const stats = ManualHistory.computeManagerStats(REAL_DATA);
  const manualTotals = stats.get("yulovesyou").totals;

  const sleeperManager = {
    careerRegularSeasonWins: 50, careerRegularSeasonLosses: 20, careerRegularSeasonTies: 1,
    careerPlayoffWins: 10, careerPlayoffLosses: 5, careerPlayoffTies: 0,
    careerPF: 5000, championships: 2, runnerUps: 1, thirdPlaceFinishes: 0,
    winningSeasons: 8, losingSeasons: 2, playoffAppearances: 8, byes: 3, firstPicks: 1,
  };
  const before = { ...sleeperManager };
  ManualHistory.mergeIntoManager(sleeperManager, manualTotals);

  assert.strictEqual(sleeperManager.careerRegularSeasonWins, before.careerRegularSeasonWins + manualTotals.careerRegularSeasonWins);
  assert.strictEqual(sleeperManager.championships, before.championships + manualTotals.championships, "2 Sleeper-era + 3 ESPN-era = 5");
  assert.strictEqual(sleeperManager.careerPF, before.careerPF + manualTotals.careerPF);
});

test("mergeIntoManager: does nothing (and doesn't throw) when there's no manual data for this manager", () => {
  const sleeperManager = { careerRegularSeasonWins: 10, championships: 1 };
  const before = { ...sleeperManager };
  assert.doesNotThrow(() => ManualHistory.mergeIntoManager(sleeperManager, undefined));
  assert.deepStrictEqual(sleeperManager, before);
});

test("findSeason: matches a manual year by string or number", () => {
  assert.ok(ManualHistory.findSeason(REAL_DATA, 2017));
  assert.ok(ManualHistory.findSeason(REAL_DATA, "2017"));
  assert.strictEqual(ManualHistory.findSeason(REAL_DATA, 2099), null, "a year with no manual data returns null");
});

test("buildBracketData: 2019 bracket matches the exact results given — quarterfinals, semifinals, 3rd place, and finals with scores", () => {
  const season2019 = ManualHistory.findSeason(REAL_DATA, 2019);
  const bracket = ManualHistory.buildBracketData(season2019);

  const qfRound = bracket.rounds.find((r) => r.label === "Quarterfinals");
  const sfRound = bracket.rounds.find((r) => r.label === "Semifinals");
  const finalsRound = bracket.rounds.find((r) => r.label === "Finals");

  assert.strictEqual(qfRound.games.length, 2);
  assert.ok(qfRound.games.some((g) => g.team1.name === "hmart92" && g.team2.name === "tduchow" && g.team1.isWinner));
  assert.ok(qfRound.games.some((g) => g.team1.name === "yulovesyou" && g.team2.name === "Trevor" && g.team1.isWinner));

  assert.ok(sfRound.games.some((g) => g.team1.name === "evangonnerman" && g.team2.name === "yulovesyou" && g.team1.isWinner));

  const thirdPlaceGame = finalsRound.games.find((g) => g.specialLabel === "3rd Place");
  assert.ok(thirdPlaceGame);
  assert.strictEqual(thirdPlaceGame.team1.name, "yulovesyou");
  assert.strictEqual(thirdPlaceGame.team2.name, "sofarrsogood");

  const finalsGame = finalsRound.games.find((g) => g.isChampionship);
  assert.strictEqual(finalsGame.team1.name, "evangonnerman");
  assert.strictEqual(finalsGame.team1.score, 141.5);
  assert.strictEqual(finalsGame.team2.name, "hmart92");
  assert.strictEqual(finalsGame.team2.score, 101.7);

  assert.strictEqual(bracket.champion.name, "evangonnerman");
  assert.strictEqual(bracket.champion.mvp.player, "Saquon Barkley");
  assert.strictEqual(bracket.champion.mvp.points, 41.9);
});

test("buildBracketData: quarterfinal and semifinal games correctly have a null score (not available in the source data)", () => {
  const season2019 = ManualHistory.findSeason(REAL_DATA, 2019);
  const bracket = ManualHistory.buildBracketData(season2019);
  const qfRound = bracket.rounds.find((r) => r.label === "Quarterfinals");
  for (const g of qfRound.games) {
    assert.strictEqual(g.team1.score, null);
    assert.strictEqual(g.team2.score, null);
  }
});

test("buildBracketData: returns an empty bracket gracefully for a season with no bracket field, rather than throwing", () => {
  const bracket = ManualHistory.buildBracketData({ year: 2099, standings: [] });
  assert.strictEqual(bracket.rounds.length, 0);
  assert.strictEqual(bracket.champion, null);
});

test("computeHeadToHeadPlayoffs: evangonnerman vs yulovesyou is 2-1 across their 3 playoff meetings (2016 QF, 2017 Finals, 2019 SF)", () => {
  const map = ManualHistory.computeHeadToHeadPlayoffs(REAL_DATA);
  const evanVsYulo = map.get("evangonnerman").get("yulovesyou");
  assert.strictEqual(evanVsYulo.wins, 2);
  assert.strictEqual(evanVsYulo.losses, 1);
  assert.strictEqual(evanVsYulo.ties, 0);

  const yuloVsEvan = map.get("yulovesyou").get("evangonnerman");
  assert.strictEqual(yuloVsEvan.wins, 1, "the reverse record should be the mirror image");
  assert.strictEqual(yuloVsEvan.losses, 2);
  assert.strictEqual(yuloVsEvan.ties, 0);
});

test("computeHeadToHeadPlayoffs: a manager who never continued into the Sleeper era (e.g. Chris) is still a valid opponent key", () => {
  const map = ManualHistory.computeHeadToHeadPlayoffs(REAL_DATA);
  const yuloVsChris = map.get("yulovesyou").get("Chris");
  assert.strictEqual(yuloVsChris.wins, 1, "yulovesyou beat Chris in the 2015 Finals");
  assert.strictEqual(yuloVsChris.losses, 0);
  assert.strictEqual(yuloVsChris.ties, 0);
});

test("computeHeadToHeadPlayoffs: only records games that actually happened — no entry for a pair that never met in the playoffs", () => {
  const map = ManualHistory.computeHeadToHeadPlayoffs(REAL_DATA);
  assert.strictEqual(map.get("Chris").has("evangonnerman"), false, "Chris and evangonnerman never played each other in a manual-era playoff game");
});

test("mergeHeadToHeadPlayoffs: combines ESPN-era and Sleeper-era meetings against the same opponent into one row, rather than two separate rows", () => {
  const manager = {
    username: "evangonnerman",
    headToHeadPlayoffs: [{ opponentUserId: "123", opponentName: "yulovesyou", wins: 1, losses: 0, ties: 0 }], // 1 Sleeper-era playoff win already on record
  };
  const manualOpponents = ManualHistory.computeHeadToHeadPlayoffs(REAL_DATA).get("evangonnerman"); // 2-1 vs yulovesyou in the ESPN era
  ManualHistory.mergeHeadToHeadPlayoffs(manager, manualOpponents);

  const row = manager.headToHeadPlayoffs.find((h) => h.opponentName === "yulovesyou");
  assert.ok(row, "should still be a single row for yulovesyou, not two");
  assert.strictEqual(row.wins, 3, "1 Sleeper-era + 2 ESPN-era wins");
  assert.strictEqual(row.losses, 1, "0 Sleeper-era + 1 ESPN-era loss");
  assert.strictEqual(manager.headToHeadPlayoffs.length, Array.from(manualOpponents.keys()).length, "no duplicate rows created for opponents merged into the existing one");
});

test("mergeHeadToHeadPlayoffs: adds a brand-new opponent row for an ESPN-era-only opponent the Sleeper-era manager had no prior record against", () => {
  const manager = { username: "yulovesyou", headToHeadPlayoffs: [] };
  const manualOpponents = ManualHistory.computeHeadToHeadPlayoffs(REAL_DATA).get("yulovesyou");
  ManualHistory.mergeHeadToHeadPlayoffs(manager, manualOpponents);

  const chrisRow = manager.headToHeadPlayoffs.find((h) => h.opponentName === "Chris");
  assert.ok(chrisRow, "Chris (who never played in the Sleeper era) should still appear as an opponent");
  assert.strictEqual(chrisRow.wins, 1);
  assert.strictEqual(chrisRow.opponentUserId, null, "no Sleeper user_id exists for an ESPN-era-only opponent");
});

test("mergeHeadToHeadPlayoffs: does nothing (and doesn't throw) when the manager has no manual-era playoff opponents", () => {
  const manager = { username: "someone-who-only-ever-played-on-sleeper", headToHeadPlayoffs: [{ opponentUserId: "1", opponentName: "rival", wins: 2, losses: 1, ties: 0 }] };
  const before = JSON.parse(JSON.stringify(manager));
  assert.doesNotThrow(() => ManualHistory.mergeHeadToHeadPlayoffs(manager, undefined));
  assert.deepStrictEqual(manager, before);
});

test("all 5 real seasons: the medal-derived champion always matches the bracket's own finals winner", () => {
  for (const season of REAL_DATA.seasons) {
    const champFromStandings = season.standings.find((s) => s.medal === "gold").team;
    assert.strictEqual(champFromStandings, season.bracket.finals.winner, `${season.year}: standings gold medal and bracket finals winner should always agree`);
    assert.strictEqual(champFromStandings, season.champion, `${season.year}: season.champion field should also agree`);
  }
});
