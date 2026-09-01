const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "draft.js"]);
}

function fakePick(overrides) {
  return {
    round: 1,
    pickInRound: 1,
    playerId: "4046",
    player: "Test Player",
    position: "RB",
    points: 200,
    vbd: 10,
    grade: "B",
    ownerUsername: "yulovesyou",
    ...overrides,
  };
}

test("topPicksForBoard: ranks by letter grade, best first (S before A before B)", () => {
  const ctx = setup();
  const board = {
    allPicks: [fakePick({ player: "B Grade Pick", grade: "B" }), fakePick({ player: "S Grade Pick", grade: "S" }), fakePick({ player: "A Grade Pick", grade: "A" })],
  };
  const top = ctx.topPicksForBoard(board);
  assert.deepStrictEqual([...top.map((p) => p.player)], ["S Grade Pick", "A Grade Pick", "B Grade Pick"]);
});

test("topPicksForBoard: within the same grade, breaks ties by VBD descending", () => {
  const ctx = setup();
  const board = {
    allPicks: [fakePick({ player: "Lower VBD", grade: "A", vbd: 5 }), fakePick({ player: "Higher VBD", grade: "A", vbd: 20 })],
  };
  const top = ctx.topPicksForBoard(board);
  assert.strictEqual(top[0].player, "Higher VBD");
  assert.strictEqual(top[1].player, "Lower VBD");
});

test("topPicksForBoard: excludes ungraded picks entirely, rather than sorting them to the bottom", () => {
  const ctx = setup();
  const board = {
    allPicks: [fakePick({ player: "Graded", grade: "C" }), fakePick({ player: "Ungraded", grade: null })],
  };
  const top = ctx.topPicksForBoard(board);
  assert.strictEqual(top.length, 1);
  assert.strictEqual(top[0].player, "Graded");
});

test("topPicksForBoard: caps at 5, even with more graded picks available", () => {
  const ctx = setup();
  const board = { allPicks: Array.from({ length: 12 }, (_, i) => fakePick({ player: `Pick ${i}`, grade: "B", vbd: 12 - i })) };
  assert.strictEqual(ctx.topPicksForBoard(board).length, 5);
});

test("renderTopPicks: includes the player photo, name, position, drafted-by owner, grade, and points/VBD", () => {
  const ctx = setup();
  const html = ctx.renderTopPicks([fakePick({ round: 2, pickInRound: 5, player: "Derek Holloway", position: "RB", points: 210.4, vbd: 12.3, grade: "A", ownerUsername: "hmart92" })]);
  assert.ok(html.includes("player-photo-xs"), "should render a small player photo");
  assert.ok(html.includes("2.5"), "should show round.pickInRound");
  assert.ok(html.includes("Derek Holloway"));
  assert.ok(html.includes("(RB)"));
  assert.ok(html.includes("hmart92"), "should show who drafted the player");
  assert.ok(html.includes("210.4 pts"));
  assert.ok(html.includes("+12.3 VBD"));
});

test("renderTopPicks: returns an empty string when there are no picks to show, rather than an empty table", () => {
  const ctx = setup();
  assert.strictEqual(ctx.renderTopPicks([]), "");
});

test("buildDraftBoard: attaches the drafting manager's username to every pick in allPicks, without disturbing the grid's own per-column pick data", () => {
  const ctx = setup();
  ctx.__FAKE_LEAGUE_STATS__ = {
    managers: [
      {
        userId: "u1",
        username: "yulovesyou",
        teamName: "yulovesyou",
        seasons: [{ season: "2023", draftPicks: [fakePick({ round: 1, pickInRound: 1, player: "Player A", ownerUsername: undefined })] }],
      },
      {
        userId: "u2",
        username: "hmart92",
        teamName: "hmart92",
        seasons: [{ season: "2023", draftPicks: [fakePick({ round: 1, pickInRound: 2, player: "Player B", ownerUsername: undefined })] }],
      },
    ],
  };
  runInLoadedContext(ctx, "LEAGUE_STATS = __FAKE_LEAGUE_STATS__;");
  const board = ctx.buildDraftBoard("2023");
  const ownerByPlayer = Object.fromEntries(board.allPicks.map((p) => [p.player, p.ownerUsername]));
  assert.strictEqual(ownerByPlayer["Player A"], "yulovesyou");
  assert.strictEqual(ownerByPlayer["Player B"], "hmart92");
  // The grid itself (columns/rounds) should be unaffected by this addition.
  assert.strictEqual(board.columns.length, 2);
});
