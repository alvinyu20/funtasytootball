/*
  Home's matchup preview: each game as a small side-by-side comparison with a
  status, a W/L tag with the margin once it is final, the all-time series, the
  Featured Matchup drawn bigger from the same pieces, and the plain scoreboard
  for last week.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const ctx = () => loadSiteModules(["config.js", "utils.js", "my-team.js", "sleeper-api.js", "deep-history.js", "dashboard.js"]);
const storageStub = (initial) => {
  const data = new Map(initial ? [["funtasy.myTeam", initial]] : []);
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
};
const run = (c, code) => runInLoadedContext(c, code);
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

// ---- one side of a game ------------------------------------------------------------------------------------------------
// A side as the card builders take it (what matchupSide returns), for tests that don't need Home's state.
const side = (over) => ({
  rosterId: 1, userId: "u1", name: "Alvin's Team", username: "alvin", wins: 4, losses: 1, ties: 0, record: "4-1",
  points: 100, powerRank: 3, avg: 120.5, playoffPct: 80, byePct: 30, results: [], ...over,
});
const dots = (s) => s.split("").map((result, i) => ({ week: i + 1, result }));

test("sameManager / rankText / winShare / edgeOf: the small comparisons the cards are built from", () => {
  const c = ctx();
  const ev = (code) => runInLoadedContext(c, code);
  assert.strictEqual(ev(`sameManager(" Alvin ", "alvin")`), true);
  assert.strictEqual(ev(`sameManager("alvin", null)`), false);
  assert.strictEqual(ev(`sameManager(null, "")`), false, "two blanks are not the same manager");
  assert.strictEqual(ev(`rankText(3)`), "3");
  assert.strictEqual(ev(`rankText(5.5)`), "5.5");
  assert.strictEqual(ev(`winShare({ wins: 3, losses: 1, ties: 0 })`), 0.75);
  assert.strictEqual(ev(`winShare({ wins: 1, losses: 1, ties: 2 })`), 0.5, "a tie is half a win");
  assert.strictEqual(ev(`winShare({ wins: 0, losses: 0, ties: 0 })`), null, "no games, no share");
  assert.strictEqual(ev(`edgeOf(5, 3)`), "a");
  assert.strictEqual(ev(`edgeOf(3, 5)`), "b");
  assert.strictEqual(ev(`edgeOf(3, 3)`), null);
  assert.strictEqual(ev(`edgeOf(3, 5, true)`), "a", "lower is better for ranks");
  assert.strictEqual(ev(`edgeOf(null, 5)`), null);
  assert.strictEqual(ev(`edgeOf(NaN, 5)`), null);
});

test("matchupSide: record from the Standings, Power Rank and odds from the snapshot, Avg from the finished weeks, results from the weekly data", () => {
  const c = ctx();
  c.__row = { roster_id: 7, points: 88.8 };
  c.__team = { userId: "u7", teamName: "Team Seven", username: "seven", wins: 5, losses: 1, ties: 1 };
  run(c, `HOME.powerByRoster = new Map([[7, { powerRank: 2, avgPpg: 111, playoffPct: 91.2, byePct: 40 }]]); HOME.results = new Map([[7, [{ week: 1, result: "W" }]]]);`);
  const s = json(c, `matchupSide(__row, __team)`);
  assert.deepStrictEqual([s.rosterId, s.name, s.username, s.record, s.points, s.powerRank, s.avg, s.playoffPct, s.byePct, s.results.length], [7, "Team Seven", "seven", "5-1-1", 88.8, 2, 111, 91.2, 40, 1]);
  run(c, `HOME.avgByRoster = new Map([[7, 123.4]])`);
  assert.strictEqual(json(c, `matchupSide(__row, __team)`).avg, 123.4, "the finished-weeks average wins over the snapshot's");
  const bare = json(c, `matchupSide({ roster_id: 9 }, null, "Fallback")`);
  assert.deepStrictEqual([bare.name, bare.record, bare.powerRank, bare.avg, bare.playoffPct, bare.points, bare.results.length], ["Fallback", "", null, null, null, 0, 0]);
  assert.strictEqual(json(c, `matchupSide({ roster_id: 9 }, null)`).name, "Roster 9");
  run(c, `HOME.powerByRoster = new Map([[7, { powerRank: "x", playoffPct: undefined }]])`);
  assert.strictEqual(json(c, `matchupSide(__row, __team)`).powerRank, null, "junk in the snapshot is no number");
});

// ---- the comparison --------------------------------------------------------------------------------------------------------------
test("matchupCompareHtml: a row per number both teams have, the brighter mark on the side with the edge", () => {
  const c = ctx();
  c.__a = side({ results: dots("WWL") });
  c.__b = side({ rosterId: 2, name: "Teddy", username: "teddy", wins: 3, losses: 2, record: "3-2", powerRank: 7, avg: 100, playoffPct: 40, byePct: 5, results: dots("LLW") });
  const out = run(c, `matchupCompareHtml(__a, __b, 2)`);
  const labels = [...out.matchAll(/class="cmp-label">([^<]+)</g)].map((m) => m[1]);
  assert.deepStrictEqual(labels, ["Record", "Power rank", "Avg / wk", "Playoffs", "Bye", "Last 7"]);
  const row = (label) => out.split('<div class="cmp-row').find((r) => r.includes(`>${label}<`));
  assert.ok(/cmp-val a edge">4-1</.test(row("Record")) && /cmp-val b">3-2</.test(row("Record")));
  assert.ok(/cmp-val a edge">#3</.test(row("Power rank")), "the better (lower) rank has the edge");
  assert.ok(/cmp-val a edge">120\.5</.test(row("Avg / wk")) && /cmp-val b">100\.0</.test(row("Avg / wk")));
  assert.ok(row("Avg / wk").includes('style="width:100%"') && row("Avg / wk").includes('style="width:82.99%"'), "bars share one scale: the bigger average fills it");
  assert.ok(/cmp-val a edge">80\.0%</.test(row("Playoffs")) && /cmp-val b">40\.0%</.test(row("Playoffs")));
  assert.strictEqual((row("Last 7").match(/<i class="fd /g) || []).length, 6, "three dots a side");
});

test("matchupCompareHtml: a row only appears when both teams have the number; no Bye row in a league without byes; level teams have no edge", () => {
  const c = ctx();
  c.__a = side({ powerRank: null, avg: null, playoffPct: null, byePct: null });
  c.__b = side({ rosterId: 2, powerRank: 4, avg: 99, playoffPct: 50, byePct: 20 });
  const out = run(c, `matchupCompareHtml(__a, __b, 2)`);
  assert.deepStrictEqual([...out.matchAll(/class="cmp-label">([^<]+)</g)].map((m) => m[1]), ["Record"], "one side missing the numbers: just the Record");
  assert.ok(!out.includes(" edge"), "4-1 against 4-1 is level");
  c.__a2 = side();
  c.__b2 = side({ rosterId: 2, wins: 2, losses: 3, record: "2-3" });
  const noBye = run(c, `matchupCompareHtml(__a2, __b2, 0)`);
  assert.ok(noBye.includes("Playoffs") && !noBye.includes(">Bye<"));
  assert.ok(!noBye.includes("Last 7"), "no results yet, no form row");
  assert.ok(run(c, `matchupCompareHtml(__a2, __b2, 2)`).includes(">Bye<"));
  c.__a3 = side({ playoffPct: 0 });
  c.__b3 = side({ rosterId: 2, playoffPct: 0.4 });
  assert.ok(run(c, `matchupCompareHtml(__a3, __b3, 0)`).includes("width:1.5%"), "a sliver of a chance still shows a sliver");
});

// ---- the all-time series ----------------------------------------------------------------------------------------------------------------
test("seriesText: nothing until the history loads; 'You are…' for your own game, usernames for everyone else's", () => {
  const c = ctx();
  c.localStorage = storageStub();
  c.__a = side({ userId: "A", username: "alvin", name: "Alvin's Team" });
  c.__b = side({ rosterId: 2, userId: "B", username: "teddy", name: "Teddy Bears" });
  const text = (variant) => run(c, `seriesText(__a, __b${variant ? `, "${variant}"` : ""})`);
  assert.strictEqual(text(), "", "no history yet");
  run(c, `HOME.h2h = { rec: new Map([["A", new Map([["B", { wins: 4, losses: 5, ties: 0 }]])], ["B", new Map([["A", { wins: 5, losses: 4, ties: 0 }]])]]), name: new Map([["A", "alvinyu"], ["B", "teddyy"]]) }`);
  assert.strictEqual(text(), "All-time: alvinyu 4-5 teddyy");
  assert.strictEqual(text("featured"), "All-time series: alvinyu 4-5 teddyy");
  run(c, `MyTeam.set("alvin")`);
  assert.strictEqual(text(), "You are 4-5 all-time");
  assert.strictEqual(text("featured"), "All-time series: you are 4-5 against teddyy");
  run(c, `MyTeam.set("teddy")`);
  assert.strictEqual(text(), "You are 5-4 all-time", "from the other side of the same series");
  run(c, `MyTeam.clear(); HOME.h2h = { rec: new Map(), name: new Map() }`);
  assert.strictEqual(text(), "First-ever meeting");
  run(c, `HOME.h2h = { rec: new Map([["A", new Map([["B", { wins: 2, losses: 2, ties: 1 }]])]]), name: new Map() }`);
  assert.strictEqual(text(), "All-time: alvin 2-2-1 teddy", "falls back to the usernames on the cards when the history has no name");
});

// ---- a card --------------------------------------------------------------------------------------------------------------------------------
const cardHtml = (c, a, b, o) => {
  c.__a = a;
  c.__b = b;
  c.__o = o;
  return run(c, `matchupPreviewCardHtml(__a, __b, __o)`);
};

test("matchup card (final): W +margin on the winner, L on the loser, scores to one decimal, a card that is a <details>", () => {
  const c = ctx();
  const html = cardHtml(c, side({ points: 120.04, username: "alvin" }), side({ rosterId: 2, name: "jspar279879", username: "jspar279879", record: "3-2", points: 98 }), { status: "final", idPrefix: "cur", order: 0, byeTeams: 2 });
  assert.ok(html.startsWith("\n      <details class=\"mu-card status-final\""), html.slice(0, 80));
  assert.ok(html.includes("W +22.0") && html.includes("result-win") && html.includes(">L<"));
  assert.ok(html.includes(">120.0<") && html.includes(">98.0<"));
  assert.ok(/mu-side winner">\s*<span class="mu-name" data-username="alvin"/.test(html), "the winner's side is flagged for styling");
  assert.strictEqual((html.match(/jspar279879/g) || []).length, 3, "the name, its data-username and data-users: not repeated as a subtitle");
  assert.ok(!html.includes('class="mu-user">jspar279879'));
  assert.ok(html.includes('class="mu-user">alvin'), "a different username is shown under the team name");
  assert.ok(html.includes('id="mu-cur-1-2"') && html.includes('data-users="alvin|jspar279879"') && html.includes('data-order="0"'));
  assert.ok(html.includes("PR #3") && html.includes("mu-compare"));
  assert.ok(!html.includes("mu-series"), "no series line until the history has loaded");
});

test("matchup card: the id is the same whichever side is on the left, so a redraw finds its card again", () => {
  const c = ctx();
  const id = (r1, r2) => cardHtml(c, side({ rosterId: r1 }), side({ rosterId: r2 }), { status: "final", idPrefix: "cur", order: 0 }).match(/id="([^"]+)"/)[1];
  assert.strictEqual(id(3, 9), "mu-cur-3-9");
  assert.strictEqual(id(9, 3), "mu-cur-3-9");
});

test("matchup card (upcoming): no scores, no W/L, a dash nowhere it would read as 0.0", () => {
  const c = ctx();
  const html = cardHtml(c, side({ points: 0 }), side({ rosterId: 2, points: 0 }), { status: "upcoming", idPrefix: "cur", order: 1, byeTeams: 2 });
  assert.ok(html.includes("status-upcoming") && !/>0\.0</.test(html) && !html.includes("result-tag") && !html.includes("mu-score") && !html.includes("winner"));
  assert.ok(html.includes("mu-compare") && html.includes('data-order="1"'));
});

test("matchup card (in progress): says who leads, never W or L", () => {
  const c = ctx();
  const html = cardHtml(c, side({ points: 61.2 }), side({ rosterId: 2, points: 40 }), { status: "progress", idPrefix: "cur", order: 0 });
  assert.ok(html.includes("status-progress") && html.includes("Leads +21.2") && html.includes("mu-score lead") && html.includes("mu-score trail"));
  assert.ok(!html.includes("result-win") && !html.includes("winner"));
});

test("matchup card: a tie reads as a tie on both sides; names and usernames are escaped; the series shows in the header and in the body", () => {
  const c = ctx();
  const tied = cardHtml(c, side({ points: 100 }), side({ rosterId: 2, points: 100 }), { status: "final", idPrefix: "cur", order: 0 });
  assert.strictEqual((tied.match(/result-tie/g) || []).length, 2);
  assert.ok(!tied.includes("winner") && tied.includes("mu-score even"));
  const evil = cardHtml(c, side({ name: "<img src=x>", username: "<b>x</b>" }), side({ rosterId: 2 }), { status: "final", idPrefix: "cur", order: 0 });
  assert.ok(!evil.includes("<img") && !evil.includes("<b>x"));
  run(c, `HOME.h2h = { rec: new Map([["u1", new Map([["u2", { wins: 1, losses: 0, ties: 0 }]])]]), name: new Map() }`);
  const withSeries = cardHtml(c, side({ userId: "u1" }), side({ rosterId: 2, userId: "u2", username: "teddy" }), { status: "final", idPrefix: "cur", order: 0 });
  assert.ok(withSeries.includes('class="mu-glance"') && withSeries.includes('class="mu-series"'));
});

// ---- grouping games -----------------------------------------------------------------------------------------------------------------------------
test("matchupPairs: every real game with the higher scorer first; a bye or a lone row is not a game", () => {
  const c = ctx();
  c.__m = [row(1, 90), row(2, 100), { roster_id: 3, matchup_id: 2, points: 50 }, { roster_id: 4, matchup_id: 2, points: 50 }, { roster_id: 5, matchup_id: null, points: 99 }, { roster_id: 6, matchup_id: 3, points: 1 }];
  const pairs = json(c, `matchupPairs(__m)`);
  assert.strictEqual(pairs.length, 2);
  assert.deepStrictEqual(pairs[0].map((r) => r.roster_id), [2, 1]);
  assert.deepStrictEqual(pairs[1].map((r) => r.roster_id), [3, 4], "level scores keep their order");
  assert.deepStrictEqual(json(c, `matchupPairs(null)`), []);
});

test("mineFirst: the picked team goes on the left of its own game; any other game is left alone", () => {
  const c = ctx();
  c.__p = [row(1, 100), row(2, 90)];
  c.__by = new Map([[1, { username: "alvin" }], [2, { username: "teddy" }]]);
  const order = (me) => json(c, `mineFirst(__p, __by, ${JSON.stringify(me)})`).map((r) => r.roster_id);
  assert.deepStrictEqual(order("teddy"), [2, 1]);
  assert.deepStrictEqual(order("TEDDY "), [2, 1]);
  assert.deepStrictEqual(order("alvin"), [1, 2]);
  assert.deepStrictEqual(order(null), [1, 2]);
  assert.deepStrictEqual(order("zed"), [1, 2]);
});

// ---- Featured Matchup -------------------------------------------------------------------------------------------------------------------------------
function featured(c, status, aPts, bPts) {
  c.__f = {
    a: row(1, aPts), b: row(2, bPts), aName: "Alvin's Team", bName: "Teddy Bears",
    sa: { teamName: "Alvin's Team", username: "alvin", wins: 4, losses: 1, ties: 0 }, sb: { teamName: "Teddy Bears", username: "teddy", wins: 3, losses: 2, ties: 1 }, status,
  };
  return runInLoadedContext(c, `featuredMatchupHtml(__f)`);
}

test("Featured Matchup: finished games read as finished (W/L tags, the winner flagged), records and the comparison shown", () => {
  const c = ctx();
  const html = featured(c, "final", 130.5, 101.25);
  assert.ok(html.includes("mu-featured status-final") && html.includes("W +29.3"), "margin shown on the winner");
  assert.ok(html.includes(">4-1<") && html.includes(">3-2-1<"), "records are in the comparison");
  assert.ok(/mu-side mu-fside winner">\s*<div class="mu-fname mu-name" data-username="alvin"/.test(html));
  assert.ok(html.includes("mu-fhead") && html.includes("mu-compare") && html.includes(">130.5<") && html.includes(">101.3<"));
});

test("Featured Matchup: before kickoff it shows records, not 0.0 scores or a winner", () => {
  const c = ctx();
  const html = featured(c, "upcoming", 0, 0);
  assert.ok(html.includes("status-upcoming") && html.includes(">4-1<"));
  assert.ok(!/>0\.0</.test(html) && !html.includes("result-tag") && !html.includes("winner") && !html.includes("mu-score"));
});

test("Featured Matchup: a game under way says who leads", () => {
  const c = ctx();
  const html = featured(c, "progress", 44, 12);
  assert.ok(html.includes("Leads +32.0") && !html.includes("result-win") && !html.includes("winner"));
});

test("Featured Matchup: spells out the all-time series when the history has loaded", () => {
  const c = ctx();
  c.localStorage = storageStub("alvin");
  run(c, `HOME.h2h = { rec: new Map([["A", new Map([["B", { wins: 3, losses: 6, ties: 0 }]])]]), name: new Map([["B", "teddyy"]]) }`);
  c.__f = {
    a: row(1, 0), b: row(2, 0), status: "upcoming",
    sa: { userId: "A", teamName: "Alvin's Team", username: "alvin", wins: 1, losses: 0, ties: 0 }, sb: { userId: "B", teamName: "Teddy Bears", username: "teddy", wins: 1, losses: 0, ties: 0 },
  };
  assert.ok(run(c, `featuredMatchupHtml(__f)`).includes("All-time series: you are 3-6 against teddyy"));
});

// ---- This Week's panel -----------------------------------------------------------------------------------------------------------------------------------
test("This Week's panel renders each game with the right status for a week that is final, in progress, or not started", () => {
  const c = ctx();
  c.localStorage = storageStub();
  c.__s = [1, 2].map((id) => ({ rosterId: id, teamName: "T" + id, username: "u" + id, wins: 1, losses: 0, ties: 0 }));
  const draw = (completed, a, b) => {
    c.__m = [row(1, a), row(2, b)];
    run(c, `HOME.completed = ${completed}; renderMatchupsAndFeatured(__m, __s, 3);`);
    return c.document.getElementById("matchups-list").innerHTML;
  };
  assert.ok(draw(3, 100, 90).includes("W +10.0"), "week 3 is final once three weeks are complete");
  const mid = draw(2, 100, 90);
  assert.ok(mid.includes("status-progress") && mid.includes("Leads +10.0"));
  assert.ok(draw(2, 0, 0).includes("status-upcoming"));
  assert.ok(c.document.getElementById("featured-matchup-panel").innerHTML.includes("status-upcoming"));
  assert.ok(c.document.getElementById("featured-note").innerHTML.includes("Best combined record on the slate"));
});

test("This Week's panel: your game first with you on the left; everyone else in the order Sleeper gave", () => {
  const c = ctx();
  c.localStorage = storageStub("u4");
  c.__s = [1, 2, 3, 4, 5, 6].map((id) => ({ rosterId: id, teamName: "T" + id, username: "u" + id, wins: 1, losses: 0, ties: 0 }));
  c.__m = [
    { roster_id: 1, matchup_id: 1, points: 0 }, { roster_id: 2, matchup_id: 1, points: 0 },
    { roster_id: 3, matchup_id: 2, points: 0 }, { roster_id: 4, matchup_id: 2, points: 0 },
    { roster_id: 5, matchup_id: 3, points: 0 }, { roster_id: 6, matchup_id: 3, points: 0 },
  ];
  run(c, `HOME.completed = 2; renderMatchupsAndFeatured(__m, __s, 3);`);
  const out = c.document.getElementById("matchups-list").innerHTML;
  const ids = [...out.matchAll(/id="(mu-cur-\d+-\d+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(ids, ["mu-cur-3-4", "mu-cur-1-2", "mu-cur-5-6"]);
  const mine = out.slice(out.indexOf("mu-cur-3-4"), out.indexOf("mu-cur-1-2"));
  assert.ok(mine.indexOf('data-username="u4"') < mine.indexOf('data-username="u3"'), "u4 is the left side of its own game");
  assert.ok(out.includes('data-order="1"'), "each card remembers where it started");
});

test("Featured Matchup: you are on the left even when you are the lower scorer in the game that was picked", () => {
  const c = ctx();
  c.localStorage = storageStub("u2");
  c.__s = [1, 2, 3, 4].map((id) => ({ rosterId: id, teamName: "T" + id, username: "u" + id, wins: id <= 2 ? 3 : 0, losses: 0, ties: 0 }));
  c.__m = [
    { roster_id: 1, matchup_id: 1, points: 90 }, { roster_id: 2, matchup_id: 1, points: 50 },
    { roster_id: 3, matchup_id: 2, points: 10 }, { roster_id: 4, matchup_id: 2, points: 5 },
  ];
  run(c, `HOME.completed = 3; renderMatchupsAndFeatured(__m, __s, 3);`);
  const out = c.document.getElementById("featured-matchup-panel").innerHTML;
  assert.ok(out.indexOf('data-username="u2"') < out.indexOf('data-username="u1"'), "u2 lost the game but sits on the left");
  assert.ok(out.includes("L</span>") && out.includes("W +40.0"), "the tags still follow the scores");
  c.localStorage = storageStub("u1");
  run(c, `renderMatchupsAndFeatured(__m, __s, 3);`);
  const other = c.document.getElementById("featured-matchup-panel").innerHTML;
  assert.ok(other.indexOf('data-username="u1"') < other.indexOf('data-username="u2"'));
});

test("This Week's panel: nothing posted, no week, or a bye-only slate says so instead of drawing empty cards", () => {
  const c = ctx();
  c.localStorage = storageStub();
  run(c, `renderMatchupsAndFeatured([], [], 5)`);
  assert.ok(c.document.getElementById("matchups-list").innerHTML.includes("Matchups for week 5 aren't posted yet."));
  assert.ok(c.document.getElementById("featured-matchup-panel").innerHTML.includes("aren't posted yet"));
  run(c, `renderMatchupsAndFeatured([], [], null)`);
  assert.ok(c.document.getElementById("matchups-list").innerHTML.includes("No matchups to show right now."));
  c.__m = [{ roster_id: 1, matchup_id: null, points: 0 }];
  run(c, `HOME.completed = 0; renderMatchupsAndFeatured(__m, [], 5)`);
  assert.ok(c.document.getElementById("matchups-list").innerHTML.includes("No matchups posted yet."));
  assert.ok(c.document.getElementById("featured-matchup-panel").innerHTML.includes("No matchups to feature yet."));
});

// ---- phone: a card is folded until tapped --------------------------------------------------------------------------------------------------------------------
test("syncMatchupCards: every card open on a wide screen; on a phone each starts folded and a card the person opened stays open", () => {
  const c = ctx();
  const cards = [{ id: "mu-cur-1-2", open: false }, { id: "mu-cur-3-4", open: false }];
  c.document.querySelectorAll = (sel) => (sel === ".mu-card" ? cards : []);
  c.window = { matchMedia: () => ({ matches: false }) };
  run(c, `syncMatchupCards()`);
  assert.deepStrictEqual(cards.map((x) => x.open), [true, true]);
  c.window = { matchMedia: () => ({ matches: true }) };
  run(c, `syncMatchupCards()`);
  assert.deepStrictEqual(cards.map((x) => x.open), [false, false], "folded on a phone");
  run(c, `openMatchupCards.add("mu-cur-3-4"); syncMatchupCards()`);
  assert.deepStrictEqual(cards.map((x) => x.open), [false, true], "the one that was tapped open stays open when the panel is drawn again");
  c.document.querySelectorAll = undefined;
  assert.doesNotThrow(() => run(c, `syncMatchupCards()`), "a page without querySelectorAll just skips it");
});

// ---- Last Week ---------------------------------------------------------------------------------------------------------------------------------------------------------------
test("biggestUpset: the widest Power Rank gap in a game the lower-ranked team won; nothing if the favourites all won or ranks are missing", () => {
  const c = ctx();
  const game = (w, l) => ({ winner: { name: "W" + w, rank: w }, loser: { name: "L" + l, rank: l } });
  const up = (games) => json(c, `biggestUpset(${JSON.stringify(games)})`);
  const best = up([game(2, 1), game(9, 3), game(8, 7)]);
  assert.deepStrictEqual([best.winner.name, best.loser.name, best.gap], ["W9", "L3", 6]);
  assert.strictEqual(up([game(1, 4), game(2, 9)]), null, "the higher-ranked team won every time");
  assert.strictEqual(up([{ winner: { name: "A", rank: null }, loser: { name: "B", rank: 3 } }]), null);
  assert.strictEqual(up([]), null);
  assert.strictEqual(up(null), null);
  assert.strictEqual(run(c, `rankWord(3)`) + "|" + run(c, `rankWord(1)`) + "|" + run(c, `rankWord(5.5)`), "3rd|1st|#5.5");
});

test("recapRowHtml: one line per game, 'Won by' the margin between the two scores, the winner's score in the bright colour", () => {
  const c = ctx();
  const html = (a, b, status) => {
    c.__a = side(a);
    c.__b = side({ rosterId: 2, name: "Teddy", username: "teddy", ...b });
    return run(c, `recapRowHtml(__a, __b, "${status}", 4)`);
  };
  const final = html({ points: 130.55 }, { points: 101.2 }, "final");
  assert.ok(final.includes("lw-row status-final") && final.includes('data-order="4"') && final.includes('data-users="alvin|teddy"'));
  assert.ok(final.includes("Won by") && final.includes("+29.4"));
  assert.ok(final.includes("lw-score lead") && final.includes("lw-score trail"));
  assert.ok(final.includes('class="lw-name" data-username="alvin"'));
  const live = html({ points: 40 }, { points: 30 }, "progress");
  assert.ok(live.includes("Leads by") && live.includes("+10.0"));
  assert.ok(html({ points: 100 }, { points: 100 }, "final").includes(">Tie<"));
  const upcoming = html({ points: 0 }, { points: 0 }, "upcoming");
  assert.ok(upcoming.includes("—") && !upcoming.includes("Won by") && !upcoming.includes("Leads by"));
  assert.ok(!html({ name: "<s>x</s>" }, {}, "final").includes("<s>"));
});

test("Last Week: a plain scoreboard with the week's average, and a line under it for the top score, the closest game and the biggest upset", () => {
  const c = ctx();
  c.localStorage = storageStub();
  const ids = [1, 2, 3, 4];
  c.__s = ids.map((id) => ({ rosterId: id, teamName: "T" + id, username: "u" + id, wins: 1, losses: 0, ties: 0 }));
  c.__m = [
    { roster_id: 1, matchup_id: 1, points: 150 }, { roster_id: 2, matchup_id: 1, points: 100 },
    { roster_id: 3, matchup_id: 2, points: 120 }, { roster_id: 4, matchup_id: 2, points: 119.5 },
  ];
  // T4 (ranked 4th) beat T3 (ranked 1st) is not it; make T2 (ranked 9th) beat nobody -- the upset is T3 over T4 reversed below
  run(c, `HOME.powerByRoster = new Map([[1, { powerRank: 1 }], [2, { powerRank: 2 }], [3, { powerRank: 4 }], [4, { powerRank: 3 }]]); HOME.completed = 7;`);
  run(c, `renderLastWeekMatchups(__m, __s, 7)`);
  const list = c.document.getElementById("last-week-matchups-list").innerHTML;
  assert.strictEqual((list.match(/class="lw-row /g) || []).length, 2);
  const chip = c.document.getElementById("last-week-fresh").innerHTML;
  assert.ok(chip.includes("Final") && chip.includes("Week 7") && chip.includes("Avg 122.4"), chip);
  const foot = c.document.getElementById("last-week-foot").textContent;
  assert.ok(foot.startsWith("Top score 150.0 (T1) · Closest 0.5"), foot);
  assert.ok(foot.includes("Biggest upset: T3 (4th) over T4 (3rd)"), foot);
  run(c, `HOME.completed = 6; renderLastWeekMatchups(__m, __s, 7)`);
  assert.ok(c.document.getElementById("last-week-fresh").innerHTML.includes("In progress"));
  assert.strictEqual(c.document.getElementById("last-week-foot").textContent, "", "no wrap-up for a week that isn't over");
});

test("Last Week: the first week has no last week, and a week with nothing posted says so", () => {
  const c = ctx();
  c.localStorage = storageStub();
  run(c, `renderLastWeekMatchups([], [], null)`);
  assert.ok(c.document.getElementById("last-week-matchups-list").innerHTML.includes("No prior week yet this season."));
  run(c, `renderLastWeekMatchups([], [], 3)`);
  assert.ok(c.document.getElementById("last-week-matchups-list").innerHTML.includes("Week 3 matchups aren't available."));
  assert.strictEqual(run(c, `recapFootText([], [])`), "");
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

