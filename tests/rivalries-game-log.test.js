const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "rivalries.js"]);
}

function fakeLeagueStats(games) {
  return {
    managers: [
      { userId: "u1", username: "yulovesyou", teamName: "yulovesyou" },
      { userId: "u2", username: "hmart92", teamName: "hmart92" },
    ],
    pairGameLog: {
      "u1|u2": games,
    },
  };
}

test("renderRivalry: the winning score each week is gold/bold with its margin of victory, the losing score is muted, and there's no separate Result column repeating the same information as text", () => {
  const ctx = setup();
  const stats = fakeLeagueStats([{ season: "2023", week: 5, aUserId: "u1", aScore: 130.5, bUserId: "u2", bScore: 98.2, isPlayoff: false }]);
  ctx.__FAKE_STATS__ = stats;
  runInLoadedContext(ctx, "LEAGUE_STATS = __FAKE_STATS__;");
  ctx.renderRivalry("u1", "u2");

  const html = ctx.document.getElementById("rivalry-content").innerHTML;
  assert.ok(!html.includes("<th>Result</th>"), "the redundant Result column header should be gone");
  assert.ok(html.includes('class="rivalry-score-win"'), "the winning score should carry the win class");
  assert.ok(html.includes('class="rivalry-score-loss"'), "the losing score should carry the loss class");
  assert.ok(html.includes("130.5"), "winning score value");
  assert.ok(html.includes("98.2"), "losing score value");
  assert.ok(html.includes('<span class="rivalry-score-margin">+32.3</span>'), "the margin of victory should be shown alongside the winning score");
});

test("renderRivalry: a tie shows both scores in neutral styling, with no winner class on either side and no margin shown", () => {
  const ctx = setup();
  const stats = fakeLeagueStats([{ season: "2023", week: 5, aUserId: "u1", aScore: 100.0, bUserId: "u2", bScore: 100.0, isPlayoff: false }]);
  ctx.__FAKE_STATS__ = stats;
  runInLoadedContext(ctx, "LEAGUE_STATS = __FAKE_STATS__;");
  ctx.renderRivalry("u1", "u2");

  const html = ctx.document.getElementById("rivalry-content").innerHTML;
  assert.ok(!html.includes("rivalry-score-win"), "a tie shouldn't declare either side a winner");
  assert.ok(!html.includes("rivalry-score-loss"), "a tie shouldn't declare either side a loser");
  assert.ok(!html.includes("rivalry-score-margin"), "no margin of victory to show when nobody won");
});

test("renderRivalry: the winner is correctly identified regardless of which manager is 'A' vs 'B' in the raw game record", () => {
  const ctx = setup();
  // aUserId is u2 here, not u1 -- the winning score (110) belongs to
  // whichever field actually matches u1, not always the "a" field.
  const stats = fakeLeagueStats([{ season: "2023", week: 1, aUserId: "u2", aScore: 90.0, bUserId: "u1", bScore: 110.0, isPlayoff: false }]);
  ctx.__FAKE_STATS__ = stats;
  runInLoadedContext(ctx, "LEAGUE_STATS = __FAKE_STATS__;");
  ctx.renderRivalry("u1", "u2");

  const html = ctx.document.getElementById("rivalry-content").innerHTML;
  const winCell = html.match(/data-label="yulovesyou" class="rivalry-score-win">([\d.]+)/);
  assert.ok(winCell, "yulovesyou's column should be the winning one");
  assert.strictEqual(winCell[1], "110.0");
});

test("renderRivalry: a playoff game shows a distinct badge rather than plain parenthetical text", () => {
  const ctx = setup();
  const stats = fakeLeagueStats([{ season: "2023", week: 16, aUserId: "u1", aScore: 130.0, bUserId: "u2", bScore: 100.0, isPlayoff: true }]);
  ctx.__FAKE_STATS__ = stats;
  runInLoadedContext(ctx, "LEAGUE_STATS = __FAKE_STATS__;");
  ctx.renderRivalry("u1", "u2");

  const html = ctx.document.getElementById("rivalry-content").innerHTML;
  assert.ok(html.includes('<span class="rivalry-playoff-badge">Playoffs</span>'));
  assert.ok(!html.includes("(Playoffs)"), "should not still show the old plain-text parenthetical form");
});

test("renderRivalry: multiple games each get their own independently-correct win/loss styling", () => {
  const ctx = setup();
  const stats = fakeLeagueStats([
    { season: "2023", week: 1, aUserId: "u1", aScore: 120.0, bUserId: "u2", bScore: 100.0, isPlayoff: false }, // u1 wins
    { season: "2023", week: 2, aUserId: "u1", aScore: 90.0, bUserId: "u2", bScore: 115.0, isPlayoff: false }, // u2 wins
  ]);
  ctx.__FAKE_STATS__ = stats;
  runInLoadedContext(ctx, "LEAGUE_STATS = __FAKE_STATS__;");
  ctx.renderRivalry("u1", "u2");

  const html = ctx.document.getElementById("rivalry-content").innerHTML;
  const winCount = (html.match(/rivalry-score-win/g) || []).length;
  const lossCount = (html.match(/rivalry-score-loss/g) || []).length;
  assert.strictEqual(winCount, 2, "one win cell per game, across 2 games");
  assert.strictEqual(lossCount, 2, "one loss cell per game, across 2 games");
});
