/*
  Home's matchup cards: a status label, a W/L tag with the margin once a game is
  final, no repeated name when a manager has no team name, and a Featured
  Matchup that reads the same way as the cards beside it.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const ctx = () => loadSiteModules(["config.js", "utils.js", "my-team.js", "sleeper-api.js", "deep-history.js", "dashboard.js"]);
const json = (c, code) => JSON.parse(runInLoadedContext(c, `JSON.stringify(${code})`));
const row = (id, points) => ({ roster_id: id, matchup_id: 1, points });

test("matchupStatus: final once the week is over, in progress once anyone has scored, upcoming before that", () => {
  const c = ctx();
  const st = (a, b, final) => runInLoadedContext(c, `matchupStatus(${JSON.stringify(row(1, a))}, ${JSON.stringify(row(2, b))}, ${final})`);
  assert.strictEqual(st(101, 99, true), "final");
  assert.strictEqual(st(0, 0, true), "final", "a finished week stays final even if a team scored nothing");
  assert.strictEqual(st(12.3, 0, false), "progress");
  assert.strictEqual(st(0, 0.1, false), "progress");
  assert.strictEqual(st(0, 0, false), "upcoming");
  assert.strictEqual(runInLoadedContext(c, `MATCHUP_STATUS_LABEL.final + "|" + MATCHUP_STATUS_LABEL.progress + "|" + MATCHUP_STATUS_LABEL.upcoming`), "Final|In progress|Upcoming");
});

test("matchupOutcome: the winner is marked W with the margin, the loser L; a game in progress says who leads; nothing before kickoff", () => {
  const c = ctx();
  const out = (a, b, status) => json(c, `matchupOutcome(${JSON.stringify(row(1, a))}, ${JSON.stringify(row(2, b))}, "${status}")`);
  assert.deepStrictEqual(out(110.5, 98.2, "final"), { a: { text: "W +12.3", cls: "win" }, b: { text: "L", cls: "loss" }, lead: "a" });
  assert.deepStrictEqual(out(90, 100.04, "final"), { a: { text: "L", cls: "loss" }, b: { text: "W +10.0", cls: "win" }, lead: "b" });
  assert.deepStrictEqual(out(100, 100, "final"), { a: { text: "T", cls: "tie" }, b: { text: "T", cls: "tie" }, lead: null });
  assert.deepStrictEqual(out(70, 64.5, "progress"), { a: { text: "Leads +5.5", cls: "leads" }, b: null, lead: "a" });
  assert.deepStrictEqual(out(50, 50, "progress"), { a: null, b: null, lead: null });
  assert.deepStrictEqual(out(0, 0, "upcoming"), { a: null, b: null, lead: null });
  assert.deepStrictEqual(out(10, 5, "upcoming"), { a: null, b: null, lead: null }, "before kickoff nobody is a winner or a leader, whatever the numbers say");
});

test("usernameSubHtml: a manager with no team name isn't printed twice", () => {
  const c = ctx();
  const sub = (name, user) => runInLoadedContext(c, `usernameSubHtml(${JSON.stringify(name)}, ${JSON.stringify(user)})`);
  assert.strictEqual(sub("jspar279879", "jspar279879"), "");
  assert.strictEqual(sub("JSpar279879", " jspar279879 "), "", "case and spacing don't matter");
  assert.strictEqual(sub("Alvin's Team", "alvinyu"), '<span class="username-sub">alvinyu</span>');
  assert.strictEqual(sub("Alvin's Team", null), "");
  assert.ok(sub("T", "<b>x</b>").includes("&lt;b&gt;"), "escaped");
});

test("matchup card (final): status label, W +margin on the winner, L on the loser, scores to one decimal", () => {
  const c = ctx();
  const html = runInLoadedContext(c, `matchupCardHtml(${JSON.stringify(row(1, 120.04))}, ${JSON.stringify(row(2, 98))}, "Alvin's Team", "jspar279879", "alvin", "jspar279879", "cur", 0, "final")`);
  assert.ok(html.includes("status-final") && html.includes(">Final<"));
  assert.ok(html.includes("W +22.0") && html.includes('result-win') && html.includes(">L<"));
  assert.ok(html.includes("120.0") && html.includes("98.0"));
  assert.ok(html.includes('class="side winner"'), "the winner's side is flagged for styling");
  assert.strictEqual((html.match(/jspar279879/g) || []).length, 2, "the name once and data-users once -- not repeated as a subtitle");
  assert.ok(!html.includes('class="username-sub">jspar279879'));
  assert.ok(html.includes('class="username-sub">alvin'));
  assert.ok(html.includes('id="h2h-cur-1-2"'), "the head-to-head slot keeps the id renderMatchupHeadToHead fills");
  assert.ok(html.includes('data-users="alvin|jspar279879"') && html.includes('data-order="0"'));
});

test("matchup card (upcoming): a dash instead of 0.0, no W/L, labelled Upcoming", () => {
  const c = ctx();
  const html = runInLoadedContext(c, `matchupCardHtml(${JSON.stringify(row(1, 0))}, ${JSON.stringify(row(2, 0))}, "A", "B", "a", "b", "cur", 1, "upcoming")`);
  assert.ok(html.includes(">Upcoming<") && html.includes("—"));
  assert.ok(!html.includes("0.0") && !html.includes("result-tag"));
});

test("matchup card (in progress): says who leads, never W or L", () => {
  const c = ctx();
  const html = runInLoadedContext(c, `matchupCardHtml(${JSON.stringify(row(1, 61.2))}, ${JSON.stringify(row(2, 40))}, "A", "B", "a", "b", "cur", 0, "progress")`);
  assert.ok(html.includes(">In progress<") && html.includes("Leads +21.2"));
  assert.ok(!html.includes("result-win") && !html.includes('class="side winner"'));
});

function featured(c, status, aPts, bPts) {
  c.__f = {
    a: row(1, aPts), b: row(2, bPts), aName: "Alvin's Team", bName: "Teddy Bears",
    sa: { wins: 4, losses: 1, ties: 0 }, sb: { wins: 3, losses: 2, ties: 1 }, status,
  };
  return runInLoadedContext(c, `featuredMatchupHtml(__f, 6)`);
}

test("Featured Matchup: finished games read as finished (Final label, W/L tags) and the pick reason is kept", () => {
  const c = ctx();
  const html = featured(c, "final", 130.5, 101.25);
  assert.ok(html.includes(">Final<") && html.includes("Week 6") && html.includes("picked for the best combined record on the slate"));
  assert.ok(html.includes("W +29.3") || html.includes("W +29.2"), "margin shown on the winner");
  assert.ok(html.includes("4-1") && html.includes("3-2-1"), "records are shown");
  assert.ok(html.includes('class="side winner"'));
});

test("Featured Matchup: before kickoff it shows records and dashes, not 0.0 scores or a winner", () => {
  const c = ctx();
  const html = featured(c, "upcoming", 0, 0);
  assert.ok(html.includes(">Upcoming<") && html.includes("—"));
  assert.ok(!html.includes("0.0") && !html.includes("result-tag") && !html.includes("winner"));
});

test("weekHighlights: top score and closest game from a finished week; nothing from an empty or unscored one", () => {
  const c = ctx();
  c.__s = [1, 2, 3, 4].map((id) => ({ rosterId: id, teamName: "T" + id }));
  const m = (id, mid, pts) => ({ roster_id: id, matchup_id: mid, points: pts });
  c.__m = [m(1, 1, 110), m(2, 1, 100), m(3, 2, 150.5), m(4, 2, 150.1), { roster_id: 5, matchup_id: null, points: 0 }];
  const h = json(c, `weekHighlights(__m, __s)`);
  assert.deepStrictEqual(h.topScore, { name: "T3", pts: 150.5 });
  assert.strictEqual(h.closest.a + h.closest.b, "T3T4");
  assert.ok(Math.abs(h.closest.diff - 0.4) < 1e-9);
  const none = json(c, `weekHighlights([], __s)`);
  assert.deepStrictEqual(none, { topScore: null, closest: null });
  c.__z = [m(1, 1, 0), m(2, 1, 0)];
  assert.deepStrictEqual(json(c, `weekHighlights(__z, __s)`), { topScore: null, closest: null }, "an unplayed week has no top score");
});

test("This Week's panel renders each game with the right status for a week that is final, in progress, or not started", () => {
  const c = ctx();
  c.__s = [1, 2].map((id) => ({ rosterId: id, teamName: "T" + id, username: "u" + id, wins: 1, losses: 0, ties: 0 }));
  const run = (completed, a, b) => {
    c.__m = [row(1, a), row(2, b)];
    runInLoadedContext(c, `HOME.completed = ${completed}; renderMatchupsAndFeatured(__m, __s, 3);`);
    return c.document.getElementById("matchups-list").innerHTML;
  };
  assert.ok(run(3, 100, 90).includes("W +10.0"), "week 3 is final once three weeks are complete");
  assert.ok(run(2, 100, 90).includes("In progress") && run(2, 100, 90).includes("Leads +10.0"));
  assert.ok(run(2, 0, 0).includes("Upcoming"));
  assert.ok(c.document.getElementById("featured-matchup-panel").innerHTML.includes("Upcoming"));
});
