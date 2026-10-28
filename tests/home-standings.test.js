/*
  Home's Standings: one row per team (Record with Ovr under it, Form dots,
  Points · PF − PA, Avg/Wk, Luck, Playoffs bar, ROS), drawn as a wide table and
  as a compact list from the same rows, in two passes: Sleeper's own table
  first, then the season's weekly data fills the rest in.
*/
const test = require("node:test");
const assert = require("node:assert");
const { archive, snapshotFile, FINISHED, TEAMS, homeCtx, json, run, html, firstPass, secondPass } = require("./helpers/home-fixture.js");

// ---- results and form ---------------------------------------------------------------------------
test("teamResultsByRoster: every team's finished games, oldest first, byes left out", () => {
  const ctx = homeCtx();
  ctx.__w = [
    { week: 2, matchups: [{ roster_id: 1, matchup_id: 1, points: 90 }, { roster_id: 2, matchup_id: 1, points: 100.5 }, { roster_id: 3, matchup_id: null, points: 70 }] },
    { week: 1, matchups: [{ roster_id: 1, matchup_id: 1, points: 80 }, { roster_id: 2, matchup_id: 1, points: 80 }] },
  ];
  const r = json(ctx, `Object.fromEntries(teamResultsByRoster(__w))`);
  assert.deepStrictEqual(r[1].map((g) => [g.week, g.result, g.own, g.opp]), [[1, "T", 80, 80], [2, "L", 90, 100.5]], "sorted by week, not by the order they arrived in");
  assert.deepStrictEqual(r[2].map((g) => g.result), ["T", "W"]);
  assert.strictEqual(r[3], undefined, "a bye is not a game");
});

test("formDotsHtml: the last seven, oldest on the left, with a spoken label; a dash before any game", () => {
  const ctx = homeCtx();
  const dots = (list, n) => run(ctx, `formDotsHtml(${JSON.stringify(list)}${n ? ", " + n : ""})`);
  const games = "WWLWLLT".repeat(2).split("").map((result, i) => ({ week: i + 1, result }));
  const out = dots(games);
  assert.strictEqual((out.match(/<i class="fd /g) || []).length, 7, "never more than seven dots");
  assert.ok(out.includes('aria-label="Last 7, oldest first: win, win, loss, win, loss, loss, tie"'), out);
  assert.ok(out.includes('class="fd w"') && out.includes('class="fd l"') && out.includes('class="fd t"'));
  assert.ok(dots(games.slice(0, 3)).includes("Last 3,"), "fewer games, fewer dots");
  assert.strictEqual((dots(games, 3).match(/<i /g) || []).length, 3);
  assert.ok(dots([]).includes("form-none") && !dots([]).includes("<i "));
  assert.ok(dots(null).includes("form-none"));
});

test("formNote: the current run in words", () => {
  const ctx = homeCtx();
  const note = (s) => run(ctx, `formNote(${JSON.stringify(s.split("").map((result) => ({ result })))})`);
  assert.strictEqual(note("LLW"), "won last week");
  assert.strictEqual(note("WLL"), "lost the last 2");
  assert.strictEqual(note("LWWWW"), "won the last 4");
  assert.strictEqual(note("WT"), "tied last week");
  assert.strictEqual(note(""), "");
  assert.strictEqual(run(ctx, "formNote(null)"), "");
});

// ---- the playoff and bye lines -----------------------------------------------------------------------
test("standingsLineAfter: a bye line under the last bye team, a playoff line under the last playoff team, nothing else", () => {
  const ctx = homeCtx();
  const line = (rank, total, bye, playoffs) => json(ctx, `standingsLineAfter(${rank}, ${total}, ${bye}, ${playoffs})`);
  assert.deepStrictEqual(line(2, 12, 2, 6), { cls: "bye", text: "Bye line · Top 2" });
  assert.deepStrictEqual(line(6, 12, 2, 6), { cls: "playoffs", text: "Playoff line · Top 6" });
  assert.strictEqual(line(1, 12, 2, 6), null);
  assert.strictEqual(line(3, 12, 2, 6), null);
  assert.strictEqual(line(12, 12, 2, 6), null, "no line under the last team");
  assert.deepStrictEqual(line(4, 12, 0, 4), { cls: "playoffs", text: "Playoff line · Top 4" }, "no byes: only the playoff line");
  assert.deepStrictEqual(line(4, 12, 4, 4), { cls: "playoffs", text: "Playoff line · Top 4" }, "a bye for everyone who gets in is just the playoff line");
  assert.strictEqual(line(6, 12, 2, null), null, "no playoff format known, no lines");
});

test("homeByeTeams: the snapshot's count when there is one, otherwise two byes for a six-team playoff and none for anything else", () => {
  const ctx = homeCtx();
  const byes = (snap, playoffs) => run(ctx, `HOME.snapshot = ${JSON.stringify(snap)}; HOME.playoffTeams = ${playoffs}; homeByeTeams()`);
  assert.strictEqual(byes({ byeTeams: 1 }, 6), 1);
  assert.strictEqual(byes({ byeTeams: 0 }, 6), 0, "a snapshot that says no byes is believed");
  assert.strictEqual(byes(null, 6), 2);
  assert.strictEqual(byes(null, 4), 0);
  assert.strictEqual(byes(null, null), 0);
});

// ---- the points bar --------------------------------------------------------------------------------------
test("diffBarHtml: yellow out of the middle for a team outscoring its opponents, blue the other way, one scale for every row", () => {
  const ctx = homeCtx();
  const bar = (d, max) => run(ctx, `diffBarHtml(${d}, ${max})`);
  assert.ok(bar(50, 100).includes('class="hs-fill pos" style="width:25%"'), "half the biggest gap is a quarter of the track");
  assert.ok(bar(-100, 100).includes('class="hs-fill neg" style="width:50%"'), "the biggest gap fills one half");
  assert.ok(bar(0, 100).includes('hs-fill zero" style="width:0%"'));
  assert.ok(bar(0.1, 1000).includes("width:1.5%"), "a tiny gap still shows");
  assert.ok(!bar(null, 100).includes("hs-fill"), "no bar until the points against are known");
  assert.ok(bar(10, 0).includes("hs-fill"), "a zero scale doesn't divide by zero");
});

// ---- first pass: Sleeper's table only ------------------------------------------------------------------------
test("Standings, first pass: Sleeper's table in Sleeper's order, Record and PF, dashes for what the weekly data adds later", () => {
  const ctx = firstPass();
  const rows = json(ctx, "buildStandingsRows()");
  assert.strictEqual(rows.length, TEAMS);
  assert.deepStrictEqual(rows.map((r) => r.rank), Array.from({ length: TEAMS }, (_, i) => i + 1));
  rows.forEach((r) => {
    assert.ok(r.pf > 0, "Points For is on Sleeper's table");
    assert.strictEqual(r.pa, null);
    assert.strictEqual(r.diff, null);
    assert.strictEqual(r.ovr, null);
    assert.strictEqual(r.luck, null);
    assert.strictEqual(r.avg, null);
    assert.strictEqual(r.playoffPct, null);
    assert.strictEqual(r.ros, null);
    assert.strictEqual(r.results.length, 0);
  });
  const table = html(ctx, "standings-body");
  assert.strictEqual((table.match(/<tr class="hs-row">/g) || []).length, TEAMS);
  assert.ok(/\d PF</.test(table) && !/ PA</.test(table), "only PF until the points against are known");
  assert.ok(!/ Ovr</.test(table));
  const legend = html(ctx, "standings-legend");
  assert.ok(legend.includes("Win") && !legend.includes("Bye") && !legend.includes("Miss"), "no odds, so no odds key");
  assert.strictEqual(run(ctx, "HOME.rankByRoster.size"), TEAMS);
});

test("Standings: the bye and playoff lines sit in both the table and the list, after the right ranks", () => {
  const ctx = firstPass();
  const table = html(ctx, "standings-body");
  const list = html(ctx, "standings-list");
  assert.strictEqual((table.match(/Bye line · Top 2/g) || []).length, 1, "a six-team playoff means two byes, even before the snapshot says so");
  assert.strictEqual((list.match(/Bye line · Top 2/g) || []).length, 1);
  assert.strictEqual((table.match(/Playoff line · Top 6/g) || []).length, 1);
  assert.strictEqual((list.match(/Playoff line · Top 6/g) || []).length, 1);
  const rowsBefore = table.slice(0, table.indexOf("hs-line playoffs")).match(/<tr class="hs-row">/g) || [];
  assert.strictEqual(rowsBefore.length, 6, "the line falls after the sixth team");
});

test("Standings: each team name carries the username 'my team' looks for, and a manager with no team name isn't printed twice", () => {
  const ctx = firstPass();
  const table = html(ctx, "standings-body");
  const names = [...table.matchAll(/class="hs-name" data-username="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(names.length, TEAMS);
  assert.strictEqual(new Set(names).size, TEAMS);
  const lists = [...html(ctx, "standings-list").matchAll(/class="hs-name" data-username="([^"]+)"/g)];
  assert.strictEqual(lists.length, TEAMS, "the compact list is marked the same way");
  const row = run(ctx, `standingsRowHtml({ rank: 1, rosterId: 1, userId: "9", teamName: "jspar", username: "JSpar", record: "1-0", results: [], diff: null, pa: null, pf: 5, avg: null, luck: null, playoffPct: null, ros: null, ovr: null }, { byeTeams: 2, maxAbs: 1 })`);
  assert.ok(!row.includes("username-sub"), "same word, different case: not repeated");
  assert.ok(row.includes('href="teams.html#9"'), "the name links to the team page");
  const other = run(ctx, `standingsRowHtml({ rank: 1, rosterId: 1, userId: null, teamName: "A <b>", username: "alvin", record: "1-0", results: [], diff: null, pa: null, pf: 5, avg: null, luck: null, playoffPct: null, ros: null, ovr: null }, { byeTeams: 2, maxAbs: 1 })`);
  assert.ok(other.includes('class="username-sub">alvin') && other.includes("A &lt;b&gt;") && !other.includes("<b>"));
});

// ---- second pass: the full row --------------------------------------------------------------------------------
test("Standings, second pass: Ovr under the Record, PF · PA, the difference, Avg/Wk, Luck, odds and ROS all arrive", async () => {
  const ctx = await secondPass();
  const rows = json(ctx, "buildStandingsRows()");
  assert.strictEqual(rows.length, TEAMS);
  rows.forEach((r) => {
    assert.ok(/^\d+-\d+(-\d+)?$/.test(r.ovr), r.ovr);
    assert.strictEqual(r.ovr.split("-").reduce((s, n) => s + Number(n), 0), FINISHED * (TEAMS - 1), "an Ovr record is every game against every other team");
    assert.ok(r.pa > 0 && Math.abs(r.diff - (r.pf - r.pa)) < 1e-9);
    assert.ok(r.avg > 0 && Math.abs(r.avg - r.pf / FINISHED) < 1.5, "average over the finished weeks");
    assert.strictEqual(r.results.length, FINISHED);
    assert.ok(Number.isFinite(r.luck));
    assert.ok(Number.isFinite(r.playoffPct), "the snapshot's odds");
  });
  const table = html(ctx, "standings-body");
  assert.ok(/ Ovr</.test(table) && / PF · /.test(table) && / PA</.test(table));
  assert.strictEqual((table.match(/<i class="fd /g) || []).length, TEAMS * Math.min(7, FINISHED));
  assert.ok(table.includes("pr-bar"), "the playoff bar");
  assert.ok(table.includes("hs-line bye") && table.includes("Bye line · Top 2"), "the snapshot says two teams get a bye");
  const legend = html(ctx, "standings-legend");
  ["Win", "Loss", "Bye", "Playoffs, no bye", "Miss"].forEach((w) => assert.ok(legend.includes(w), w));
  const topPct = Math.max(...rows.map((r) => r.playoffPct));
  assert.ok(table.includes(`${topPct.toFixed(1)}%`));
});

test("Standings, second pass: only finished weeks count, so a half-played week never reaches the table", async () => {
  const gamesIn = (rows) => rows.map((r) => r.ovr.split("-").reduce((s, n) => s + Number(n), 0));
  const four = json(await secondPass({ completed: 4 }), "buildStandingsRows()");
  gamesIn(four).forEach((g) => assert.strictEqual(g, 4 * (TEAMS - 1), "four finished weeks of games against everyone else"));
  four.forEach((r) => assert.strictEqual(r.results.length, 4));
  const six = json(await secondPass({ completed: 6 }), "buildStandingsRows()");
  gamesIn(six).forEach((g) => assert.strictEqual(g, 6 * (TEAMS - 1)));
  assert.notDeepStrictEqual(four.map((r) => r.avg), six.map((r) => r.avg));
});

test("Standings, second pass: with no finished week yet the table keeps its first-pass look", async () => {
  const ctx = await secondPass({ completed: 0 });
  assert.strictEqual(run(ctx, "HOME.summary"), null);
  const rows = json(ctx, "buildStandingsRows()");
  rows.forEach((r) => assert.ok(r.ovr === null && r.pa === null && r.results.length === 0));
  assert.ok(html(ctx, "streaks-panel").includes("empty-state"));
});

test("Standings, second pass: without a snapshot there are no odds, only the rest of the row", async () => {
  const ctx = await secondPass({ snapshot: null });
  const rows = json(ctx, "buildStandingsRows()");
  rows.forEach((r) => assert.ok(r.playoffPct === null && r.ovr !== null));
  assert.ok(!html(ctx, "standings-body").includes("pr-bar"));
  assert.ok(html(ctx, "standings-body").includes("Playoff line · Top 6"), "the lines still follow the league's own settings");
  assert.ok(html(ctx, "standings-body").includes("Bye line · Top 2"), "and a six-team playoff still means two byes");
});

test("Standings: ROS rank comes from the strength file by username", () => {
  const ctx = firstPass();
  const user = archive.users[0];
  const owner = archive.rosters.find((r) => r.owner_id === user.user_id);
  ctx.__user = user;
  run(ctx, `HOME.teamStrength = { teams: { [__user.display_name]: { rank: 4 } } }; renderStandings();`);
  const rows = json(ctx, "buildStandingsRows()");
  const mine = rows.find((r) => r.rosterId === owner.roster_id);
  assert.strictEqual(mine.ros, 4);
  assert.ok(html(ctx, "standings-body").includes(">#4<"));
});

test("Standings list (phone): name, record and odds on top; form, difference and the bar under them", async () => {
  const ctx = await secondPass();
  const list = html(ctx, "standings-list");
  assert.strictEqual((list.match(/class="hs-item"/g) || []).length, TEAMS);
  assert.ok(list.includes("hs-l1") && list.includes("hs-l2") && list.includes("hs-prank") && list.includes("hs-prec") && list.includes("hs-ppct"));
  assert.ok(/<span class="hs-pdiff (pos|neg|zero)">/.test(list));
  assert.strictEqual((list.match(/<i class="fd /g) || []).length, TEAMS * Math.min(7, FINISHED));
});

// ---- the little notes under the table ---------------------------------------------------------------------------
test("Standings notes: where the odds and the ROS ranks come from and how old they are", async () => {
  const ctx = await secondPass();
  run(ctx, `HOME.teamStrength = { asOf: "2026-10-21", teams: {} }; HOME.nowMs = Date.parse("2026-10-27T19:00:00Z"); renderStandingsNotes();`);
  const note = html(ctx, "ros-note");
  assert.ok(note.includes("Playoff odds") && note.includes("Through Week 7"), note);
  assert.ok(note.includes("ROS ranks") && note.includes("FantasyPros"), note);
  run(ctx, `HOME.snapshot = null; HOME.teamStrength = null; renderStandingsNotes();`);
  assert.strictEqual(html(ctx, "ros-note"), "", "nothing to say, nothing shown");
});

// ---- the phone's 'Full table' switch ------------------------------------------------------------------------------
test("Standings: 'Full table' toggles between the compact list and the whole table (phone only; CSS hides the button from 1100px)", () => {
  const ctx = homeCtx();
  const clicks = [];
  const panelClasses = new Set();
  const btn = {
    _a: {},
    getAttribute(k) { return this._a[k] || null; },
    setAttribute(k, v) { this._a[k] = v; },
    addEventListener(type, fn) { clicks.push(fn); },
    textContent: "Full table →",
  };
  const panel = { classList: { toggle: (c) => (panelClasses.has(c) ? (panelClasses.delete(c), false) : (panelClasses.add(c), true)) } };
  ctx.document.getElementById = (id) => (id === "standings-more" ? btn : id === "standings-panel" ? panel : { innerHTML: "" });
  run(ctx, "bindStandingsToggle(); bindStandingsToggle();");
  assert.strictEqual(clicks.length, 1, "binding twice binds once");
  clicks[0]();
  assert.ok(panelClasses.has("show-full") && btn.textContent === "Compact list" && btn._a["aria-pressed"] === "true");
  clicks[0]();
  assert.ok(!panelClasses.has("show-full") && btn.textContent === "Full table →" && btn._a["aria-pressed"] === "false");
});
