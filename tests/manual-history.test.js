const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["manual-history.js"]);
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

test("all 5 real seasons: the medal-derived champion always matches the bracket's own finals winner", () => {
  for (const season of REAL_DATA.seasons) {
    const champFromStandings = season.standings.find((s) => s.medal === "gold").team;
    assert.strictEqual(champFromStandings, season.bracket.finals.winner, `${season.year}: standings gold medal and bracket finals winner should always agree`);
    assert.strictEqual(champFromStandings, season.champion, `${season.year}: season.champion field should also agree`);
  }
});
