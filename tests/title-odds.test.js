const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js"]);
const { DeepHistory } = ctx;

test("playoffBracket: a 6-team field gives seeds 1 and 2 a bye, and seed 1 meets the 4-v-5 winner", () => {
  const b = DeepHistory.playoffBracket(6);
  assert.strictEqual(b.length, 3);
  // wild-card round: 4 v 5 and 3 v 6
  assert.deepStrictEqual([b[0][0][0].seed, b[0][0][1].seed], [4, 5]);
  assert.deepStrictEqual([b[0][1][0].seed, b[0][1][1].seed], [3, 6]);
  // semifinals: seed 1 plays the winner of 4 v 5, seed 2 the winner of 3 v 6
  assert.strictEqual(b[1][0][0].seed, 1);
  assert.deepStrictEqual(Array.from(b[1][0][1].winnerOf), [0, 0]);
  assert.strictEqual(b[1][1][0].seed, 2);
  assert.deepStrictEqual(Array.from(b[1][1][1].winnerOf), [0, 1]);
  // final
  assert.deepStrictEqual(Array.from(b[2][0][0].winnerOf), [1, 0]);
  assert.deepStrictEqual(Array.from(b[2][0][1].winnerOf), [1, 1]);
});

test("playoffBracket: 4 and 8 team fields, and null for a size the league does not play", () => {
  assert.strictEqual(DeepHistory.playoffBracket(4).length, 2);
  assert.strictEqual(DeepHistory.playoffBracket(8).length, 3);
  assert.strictEqual(DeepHistory.playoffBracket(8)[0].length, 4);
  assert.strictEqual(DeepHistory.playoffBracket(5), null);
});

test("playBracket: plays the games in bracket order, so an upset moves on to the next real opponent", () => {
  const bracket = DeepHistory.playoffBracket(6);
  const seeds = [101, 102, 103, 104, 105, 106];
  const log = [];
  // the higher id always wins, so every upset happens
  const champion = DeepHistory.playBracket(
    bracket,
    seeds,
    (id) => id,
    (a, b) => {
      log.push([a, b]);
      return a >= b;
    }
  );
  assert.strictEqual(champion, 106);
  assert.strictEqual(log.length, 5);
  assert.deepStrictEqual(Array.from(log[0]), [104, 105]);
  assert.deepStrictEqual(Array.from(log[1]), [103, 106]);
  assert.deepStrictEqual(Array.from(log[2]), [101, 105]); // seed 1 gets the 4-v-5 winner
  assert.deepStrictEqual(Array.from(log[3]), [102, 106]); // seed 2 gets the 3-v-6 winner
});

test("playBracket: the strongest seed 1 wins when it should", () => {
  const champion = DeepHistory.playBracket(
    DeepHistory.playoffBracket(6),
    [1, 2, 3, 4, 5, 6],
    (id) => 100 - id,
    (a, b) => a >= b
  );
  assert.strictEqual(champion, 1);
});

function sixTeams(strengths) {
  const rosterIds = [1, 2, 3, 4, 5, 6];
  const records = new Map(rosterIds.map((id) => [id, { wins: 0, losses: 0, ties: 0, pf: 0 }]));
  const weeks = [
    [[1, 2], [3, 4], [5, 6]],
    [[1, 3], [2, 5], [4, 6]],
    [[1, 4], [2, 6], [3, 5]],
    [[1, 5], [2, 3], [4, 6]],
    [[1, 6], [2, 4], [3, 5]],
  ];
  return { rosterIds, records, weeks, rosPt: new Map(rosterIds.map((id, i) => [id, strengths[i]])) };
}

test("simulateSeasonOdds: every simulated season has one champion, and a dominant team wins most of them", () => {
  const { rosterIds, records, weeks, rosPt } = sixTeams([160, 60, 60, 60, 60, 60]);
  const { finish, title } = DeepHistory.simulateSeasonOdds(rosterIds, records, weeks, rosPt, 1500, 6);
  const total = rosterIds.reduce((a, id) => a + title.get(id), 0);
  assert.ok(Math.abs(total - 100) < 1e-9, `title odds sum to ${total}`);
  assert.ok(title.get(1) > 50, `dominant team title odds ${title.get(1)}`);
  rosterIds.forEach((id) => {
    const sum = Array.from(finish.get(id)).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 100) < 1e-9);
  });
});

test("simulateSeasonOdds: a bye is worth something, so an even field still favors the top seeds", () => {
  // six equal teams, but the one already far ahead in the standings takes seed 1
  const { rosterIds, records, weeks, rosPt } = sixTeams([80, 80, 80, 80, 80, 80]);
  records.set(1, { wins: 9, losses: 0, ties: 0, pf: 1200 });
  records.set(2, { wins: 8, losses: 1, ties: 0, pf: 1150 });
  records.set(6, { wins: 0, losses: 9, ties: 0, pf: 700 });
  const { title } = DeepHistory.simulateSeasonOdds(rosterIds, records, weeks, rosPt, 4000, 6);
  assert.ok(title.get(1) > title.get(6), `${title.get(1)} vs ${title.get(6)}`);
  assert.ok(title.get(2) > title.get(6));
});

test("simulateSeasonOdds: no title odds for a bracket size the league does not play", () => {
  const { rosterIds, records, weeks, rosPt } = sixTeams([80, 80, 80, 80, 80, 80]);
  const { title } = DeepHistory.simulateSeasonOdds(rosterIds, records, weeks, rosPt, 100, 5);
  rosterIds.forEach((id) => assert.strictEqual(title.get(id), null));
});

test("simulatePlayoffOdds: still returns just the finish chances, as before", () => {
  const { rosterIds, records, weeks, rosPt } = sixTeams([80, 80, 80, 80, 80, 80]);
  const finish = DeepHistory.simulatePlayoffOdds(rosterIds, records, weeks, rosPt, 200);
  assert.strictEqual(finish.get(1).length, 6);
});
