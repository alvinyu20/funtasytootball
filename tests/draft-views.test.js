/*
  Draft Board list modes: "By round" and "By team" (what a phone opens on, since
  the grid only fits about two team columns), plus the toggle that switches them.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const setup = () => loadSiteModules(["config.js", "utils.js", "my-team.js", "sleeper-api.js", "draft.js"]);

function pick(round, pickInRound, extra) {
  return { round, pickInRound, pickNo: (round - 1) * 2 + pickInRound, playerId: `p${round}${pickInRound}`, player: `Player ${round}.${pickInRound}`, position: "WR", grade: "B", ...extra };
}

function fakeBoard() {
  // Two teams, two rounds. Picks are deliberately out of order inside allPicks and inside a column.
  const a = [pick(2, 1, { ownerUsername: "alvin" }), pick(1, 1, { ownerUsername: "alvin", grade: "S" })];
  const b = [pick(2, 2, { ownerUsername: "beth" }), pick(1, 2, { ownerUsername: "beth" })];
  return {
    allPicks: [b[1], a[1], b[0], a[0]], // out of pick order on purpose
    columns: [
      { username: "alvin", teamName: "Alvin's Team", picks: a },
      { username: "beth", teamName: "Beth's Team", picks: b },
    ],
  };
}

test("defaultDraftView: phones open on the list, wide screens on the board, unknown width on the board", () => {
  const c = setup();
  assert.strictEqual(c.defaultDraftView(390), "round");
  assert.strictEqual(c.defaultDraftView(720), "round");
  assert.strictEqual(c.defaultDraftView(721), "grid");
  assert.strictEqual(c.defaultDraftView(1200), "grid");
  assert.strictEqual(c.defaultDraftView(null), "grid");
});

test("draftViewToggleHtml: four modes, exactly one active, and it says which", () => {
  const c = setup();
  for (const active of ["grid", "round", "team", "table"]) {
    const html = c.draftViewToggleHtml(active);
    assert.strictEqual((html.match(/data-draft-view="/g) || []).length, 4);
    assert.strictEqual((html.match(/ active"/g) || []).length, 1);
    assert.ok(new RegExp(`class="view-toggle-btn active" data-draft-view="${active}" aria-selected="true"`).test(html), `${active} should be the active tab`);
  }
  const html = c.draftViewToggleHtml("grid");
  assert.ok(html.includes(">Board<") && html.includes(">By round<") && html.includes(">By team<") && html.includes(">Table<"));
});

test("renderDraftByRound: one heading per round, rounds in order, picks in pick order inside each round", () => {
  const c = setup();
  const html = c.renderDraftByRound(fakeBoard());
  assert.deepStrictEqual([...html.matchAll(/Round (\d+)<\/h3>/g)].map((m) => m[1]), ["1", "2"]);
  const order = [...html.matchAll(/draft-list-pick">([\d.]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(order, ["1.1", "1.2", "2.1", "2.2"]);
});

test("renderDraftByRound: every row names who made the pick, and S grades keep their highlight", () => {
  const c = setup();
  const html = c.renderDraftByRound(fakeBoard());
  assert.ok(html.includes('data-username="alvin"') && html.includes('data-username="beth"'));
  assert.ok(html.includes("draft-list-owner\">alvin<"));
  assert.strictEqual((html.match(/draft-cell-s-grade/g) || []).length, 1);
});

test("renderDraftByTeam: one fold-away group per team, the first open, picks in round order, owner not repeated on each row", () => {
  const c = setup();
  const html = c.renderDraftByTeam(fakeBoard());
  assert.strictEqual((html.match(/<details/g) || []).length, 2);
  assert.strictEqual((html.match(/<details[^>]* open>/g) || []).length, 1);
  assert.ok(/<details[^>]* open>\s*<summary><span class="draft-team-name" data-username="alvin"/.test(html), "the first team is the open one");
  assert.ok(html.indexOf("alvin") < html.indexOf("beth"));
  const firstTeam = html.split("</details>")[0];
  assert.deepStrictEqual([...firstTeam.matchAll(/draft-list-pick">([\d.]+)</g)].map((m) => m[1]), ["1.1", "2.1"]);
  assert.ok(firstTeam.includes("2 picks"));
  assert.ok(!html.includes("draft-list-owner"), "the heading already says whose picks these are");
});

test("renderDraftByTeam: opens on your team when one is picked", () => {
  const c = setup();
  c.localStorage.setItem("funtasy.myTeam", "BETH");
  const html = c.renderDraftByTeam(fakeBoard());
  const groups = html.split("</details>").filter((g) => g.includes("<details"));
  assert.ok(!/<details[^>]* open>/.test(groups[0]), "alvin stays folded");
  assert.ok(/<details[^>]* open>/.test(groups[1]), "beth opens");
});

test("draftViewBodyHtml: round and team wrap their list; grid is the board table", () => {
  const c = setup();
  const board = fakeBoard();
  assert.ok(c.draftViewBodyHtml(board, "round").startsWith('<div class="draft-list">'));
  assert.ok(c.draftViewBodyHtml(board, "round").includes("draft-list-heading"));
  assert.ok(c.draftViewBodyHtml(board, "team").includes("draft-team"));
  assert.ok(!c.draftViewBodyHtml(board, "team").includes("draft-list-heading"));
});

test("escaping: a hostile player or manager name can't inject markup into the list views", () => {
  const c = setup();
  const board = fakeBoard();
  board.allPicks[0].player = "<img src=x onerror=alert(1)>";
  board.allPicks[0].ownerUsername = "<script>x</script>";
  board.columns[0].username = "<b>bold</b>";
  const html = c.renderDraftByRound(board) + c.renderDraftByTeam(board);
  assert.ok(!html.includes("<img src=x") && !html.includes("<script>") && !html.includes("<b>bold"));
});
