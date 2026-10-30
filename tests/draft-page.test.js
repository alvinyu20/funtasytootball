/*
  The Draft page (js/draft.js + draft.html): the routes, the default season, every view's markup and the
  page's structure. The render functions are plain "data in, HTML string out", so they run here as they are.
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const { pick, stats, D2024, D2026, META, league, draftOf } = require("./helpers/draft-fixture.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const setup = () => loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "rivalries-data.js", "draft-data.js", "draft.js"]);
const run = (c, code) => runInLoadedContext(c, code);
const count = (html, re) => (html.match(re) || []).length;
// "46px 58px minmax(0, 1fr) 40px" is four columns
const colTokens = (style) => style.replace(/minmax\([^)]*\)/g, "1fr").trim().split(/\s+/);

// A page-ready context: the 2024, 2025 (graded) and 2026 (live) drafts of the fixture league.
function page(season = 2024) {
  const c = draftOf(setup(), season);
  c.__LIVE__ = null;
  run(c, "var __LIVE__ = DraftData.buildDraft(__S__, 2026);");
  return c;
}

// ---- routes ---------------------------------------------------------------------------------------------------

test("hash: a season, a tab and a team in any order, and anything unknown is ignored", () => {
  const c = setup();
  const parse = (h) => JSON.parse(run(c, `JSON.stringify(parseDraftHash(${JSON.stringify(h)}, ["2026", "2025", "2024"]))`));
  assert.deepStrictEqual(parse("#2025"), { season: "2025", tab: null, team: null });
  assert.deepStrictEqual(parse("#2025/table"), { season: "2025", tab: "table", team: null });
  assert.deepStrictEqual(parse("#2025/team/u1"), { season: "2025", tab: "team", team: "u1" });
  assert.deepStrictEqual(parse("#report"), { season: null, tab: "report", team: null });
  assert.deepStrictEqual(parse("#table/2024"), { season: "2024", tab: "table", team: null });
  assert.deepStrictEqual(parse("#1999/nonsense"), { season: null, tab: null, team: null });
  assert.deepStrictEqual(parse(""), { season: null, tab: null, team: null });
  assert.deepStrictEqual(parse("#%E0%A4%A"), { season: null, tab: null, team: null }, "a broken escape does not throw");
  assert.strictEqual(parse("#2025/round/u1").team, null, "only the By Team tab takes a team");
});

test("hash: building one drops the default tab and only By Team carries a team", () => {
  const c = setup();
  assert.strictEqual(run(c, "draftHash('2025', 'overview')"), "#2025");
  assert.strictEqual(run(c, "draftHash('2025')"), "#2025");
  assert.strictEqual(run(c, "draftHash('2025', 'table')"), "#2025/table");
  assert.strictEqual(run(c, "draftHash('2025', 'team', 'u1')"), "#2025/team/u1");
  assert.strictEqual(run(c, "draftHash('2025', 'round', 'u1')"), "#2025/round");
  assert.strictEqual(run(c, "draftHash('2025', 'team', 'a b/c')"), "#2025/team/a%20b%2Fc");
  // and a built hash parses back to what built it
  assert.strictEqual(run(c, "JSON.stringify(parseDraftHash(draftHash('2024', 'team', 'a b/c'), ['2024']))"), JSON.stringify({ season: "2024", tab: "team", team: "a b/c" }));
});

test("tabs: six, the two all-years ones only once a draft has been graded, and no Board toggle anywhere", () => {
  const c = setup();
  assert.strictEqual(run(c, "tabsFor(true).map(t => t.key).join()"), "overview,round,team,table,report,hall");
  assert.strictEqual(run(c, "tabsFor(false).map(t => t.key).join()"), "overview,round,team,table");
  assert.strictEqual(run(c, "DEFAULT_TAB"), "overview");
  assert.strictEqual(run(c, "TABS.find(t => t.key === 'hall').label"), "Steals & Busts");
  assert.strictEqual(run(c, "TABS.some(t => /board/i.test(t.key + t.label))"), false);
  const js = read("js/draft.js");
  assert.ok(!/draftViewToggleHtml|data-view=/.test(js), "the old Board / list setting is gone");
});

test("default season: the newest season with a draft, even while it is being played", () => {
  const c = setup();
  const chain = (...s) => s.map((season) => ({ league: { season: String(season) } }));
  c.__S__ = league();
  assert.strictEqual(run(c, `pickDefaultSeason(${JSON.stringify(chain(2024, 2025, 2026))}, __S__)`), "2026");
  // 2026's draft has not happened: fall back to the newest season that has one
  c.__S2__ = stats({ 2024: D2024 }, META);
  assert.strictEqual(run(c, `pickDefaultSeason(${JSON.stringify(chain(2024, 2025, 2026))}, __S2__)`), "2024");
  // no season has a draft at all: the newest season in the chain, so the page has something to show
  c.__S3__ = stats({}, META);
  assert.strictEqual(run(c, `pickDefaultSeason(${JSON.stringify(chain(2025, 2026))}, __S3__)`), "2026");
  assert.strictEqual(run(c, "pickDefaultSeason([], __S__)"), null);
  assert.strictEqual(run(c, "pickDefaultSeason(null, __S__)"), null);
});

test("meIdFor matches the My Team name to a manager by username or team name, ignoring case", () => {
  const c = setup();
  c.__S__ = league();
  assert.strictEqual(run(c, "meIdFor(__S__, 'alvin')"), "u1");
  assert.strictEqual(run(c, "meIdFor(__S__, '  BETH ')"), "u2");
  assert.strictEqual(run(c, "meIdFor(__S__, 'Team carl')"), "u3");
  assert.strictEqual(run(c, "meIdFor(__S__, 'nobody')"), null);
  assert.strictEqual(run(c, "meIdFor(__S__, '')"), null);
  assert.strictEqual(run(c, "meIdFor(__S__, null)"), null);
  assert.strictEqual(run(c, "meIdFor(null, 'alvin')"), null);
});

test("currentIdsFor: the managers with a team in the newest season; null (everyone) when it cannot tell", () => {
  const c = setup();
  c.__S__ = league();
  const chain = JSON.stringify([{ league: { season: "2025" } }, { league: { season: "2026" } }]);
  assert.strictEqual(run(c, `[...currentIdsFor(__S__, ${chain})].sort().join()`), "u1,u2", "only alvin and beth have a 2026 draft in this league");
  assert.strictEqual(run(c, `currentIdsFor(__S__, [{ league: { season: "1999" } }])`), null);
  assert.strictEqual(run(c, "currentIdsFor(__S__, [])"), null);
});

// ---- pick rows ------------------------------------------------------------------------------------------------

test("every row layout has a --cols track for each cell it draws, graded and live", () => {
  const c = page(2024);
  const cells = /class="c-(?:pick|team|player|grade|vs|rank|pts|ppg|gp|inj)[ "]/g;
  ["round", "team", "mini", "table"].forEach((kind) => {
    [["__D__", "graded"], ["__LIVE__", "live"]].forEach(([d, mode]) => {
      const html = run(c, `rowsHtml(${d}.picks.slice(0, 3), ${d}, null, ${JSON.stringify(kind)})`);
      const tracks = colTokens(html.match(/--cols: ([^"]*)"/)[1]).length;
      const rows = html.split("<li>").slice(1).filter((r) => r.includes('class="dr-row'));
      assert.strictEqual(rows.length, 3, `${kind} ${mode}`);
      rows.forEach((r) => assert.strictEqual(count(r.split('<span class="dr-narrow">')[0], cells), tracks, `${kind} ${mode}: a cell for every column`));
      assert.strictEqual(count(html.split("</li>")[0], cells), tracks, `${kind} ${mode}: the header row has a cell for each column too`);
    });
  });
});

test("a pick row is one button for the pick card, with the player, grade and vs slot", () => {
  const c = page(2024);
  const html = run(c, "rowHtml(__D__.picks[0], __D__, null, 'round')");
  assert.ok(html.includes('data-pick="2024-1"'));
  assert.ok(html.startsWith("<li><button"));
  assert.ok(html.includes("Ann Alpha"));
  assert.ok(html.includes('class="gr gr-A"'));
  assert.ok(html.includes('<span class="dr-vs b4">+41</span>'));
  assert.ok(html.includes("RB1 to RB1"));
});

test("a row marks the viewer's own picks, unless the list is already theirs (mark: false)", () => {
  const c = page(2024);
  assert.ok(run(c, "rowHtml(__D__.picks[0], __D__, 'u1', 'round')").includes("dr-row dr-me"));
  assert.ok(!run(c, "rowHtml(__D__.picks[0], __D__, 'u2', 'round')").includes("dr-me"));
  assert.ok(!run(c, "rowHtml(__D__.picks[0], __D__, 'u1', 'team', { mark: false })").includes("dr-me"));
});

test("a keeper is tagged, a capped pick explains its grade, a pick with no grade shows a dash", () => {
  const c = page(2024);
  const ed = run(c, "rowHtml(__D__.picks.find(p => p.player === 'Ed Epsilon'), __D__, null, 'round')");
  assert.ok(ed.includes('<span class="dr-keeper">keeper</span>'));
  assert.ok(ed.includes("Held at B"), "the grade square says why it is B");
  const live = run(c, "rowHtml(__LIVE__.picks[0], __LIVE__, null, 'round')");
  assert.ok(!live.includes('class="gr '), "no grades while the season is on");
  assert.ok(run(c, "gradeSqHtml(null)").includes("gr-none"));
});

test("a season being played shows points, per game and games out of the weeks played; a hot pick is marked", () => {
  const c = page(2024);
  const ann = run(c, "rowHtml(__LIVE__.picks[0], __LIVE__, null, 'round')");
  assert.ok(ann.includes('<span class="c-pts">120.0</span>'));
  assert.ok(ann.includes('<span class="c-ppg dr-hot">20.0</span>'), "20 a game is hot");
  assert.ok(ann.includes("6 of 6"));
  const bo = run(c, "rowHtml(__LIVE__.picks[1], __LIVE__, null, 'round')");
  assert.ok(!bo.includes('c-ppg dr-hot'));
  assert.ok(bo.includes('<span class="dr-inj">4 inj</span>'), "injury weeks show as a tag");
});

test("everything a name could carry is escaped in rows, the board, tiles and the pick card", () => {
  const evil = "Zed<svg/onload=alert(1)>"; // no spaces, so even the board's last-name cell carries all of it
  const c = setup();
  c.__S__ = stats({ 2024: D2024.map((p) => (p.pickNo === 1 ? { ...p, player: evil } : p)) }, META);
  run(c, "var __D__ = DraftData.buildDraft(__S__, 2024);");
  const all = [
    run(c, "rowsHtml(__D__.picks, __D__, 'u1', 'round')"),
    run(c, "boardHtml(__D__, 'u1')"),
    run(c, "tilesHtml(DraftData.overviewTiles(__D__, 'u1'))"),
    run(c, "tableTabHtml(__D__, 'u1', { filter: 'all', sort: { key: 'pick', dir: 1 } })"),
    run(c, "pickCardHtml(__D__.picks[0], 'u1')"),
    run(c, "overviewHtml(__D__, 'u1', null)"),
  ].join("");
  assert.ok(!all.includes("<svg"), "the name is never written as markup");
  assert.ok(all.includes("&lt;svg"));
});

// ---- overview ---------------------------------------------------------------------------------------------------

test("board: a cell for every pick, shaded by band, with the viewer's column and picks marked", () => {
  const c = page(2024);
  const html = run(c, "boardHtml(__D__, 'u1')");
  assert.strictEqual(count(html, /<button type="button" class="dr-cell /g), 8);
  assert.strictEqual(count(html, /<th scope="col"/g), 4);
  assert.strictEqual(count(html, /<th scope="row" class="dr-round">/g), 2);
  assert.ok(html.includes(">YOU</th>"), "the viewer's column says YOU");
  assert.strictEqual(count(html, /dr-mine/g), 2, "alvin's two picks");
  assert.ok(html.includes("dr-cell b4 pos-rb dr-mine"), "Ann's +41 is band 4");
  assert.ok(html.includes("dr-cell b5 pos-qb"), "Cy's +80 is band 5");
});

test("board cells: a last name, the grade and vs slot, and a spoken description", () => {
  const c = page(2024);
  const cell = run(c, "boardCellHtml(DraftData.boardRows(__D__)[0].cells[2], __D__, null)");
  assert.ok(cell.includes('<span class="dr-cell-name">Gamma</span>'));
  assert.ok(cell.includes('<span class="dr-cell-meta">S +80</span>'));
  assert.ok(cell.includes('aria-label="Pick 1.3, Cy Gamma, QB, grade S, +80 versus slot, drafted by carl"'));
  assert.strictEqual(run(c, "boardCellHtml({ teamId: 'x', pick: null, extra: 0 }, __D__, null)"), '<td class="dr-cell-empty"></td>');
  assert.ok(run(c, "boardCellHtml({ teamId: 'x', pick: __D__.picks[0], extra: 2 }, __D__, null)").includes("Also holds 2 more picks this round"));
});

test("overview: tiles, the board, who drafted best and the short lists; nothing from the left-out mockup pages", () => {
  const c = page(2024);
  const html = run(c, "overviewHtml(__D__, 'u1', null)");
  assert.strictEqual(count(html, /class="dr-tile[ "]/g), 4);
  ["Draft board", "Who drafted best", "Steals and costliest picks"].forEach((h) => assert.ok(html.includes(`<h2>${h}</h2>`), h));
  assert.strictEqual(count(html, /class="dr-wdb-item/g), 4, "a row for every team");
  assert.ok(html.indexOf("carl") < html.indexOf("dana"), "best draft first");
  assert.ok(!/Position Strategy|Does the Round 1 slot matter|What each round has been worth/i.test(html + read("js/draft.js")));
});

test("on a phone the viewer's own row in who drafted best starts open; on a wide screen nothing does", () => {
  const c = page(2024);
  const state = (phone) => `{ stats: __S__, meId: 'u1', currentIds: null, ui: { filter: 'all', sort: { key: 'pick', dir: 1 }, reportYear: 'total', includePast: false }, phone: ${phone} }`;
  const body = (phone) => run(c, `bodyHtml({ season: '2024', tab: 'overview', team: null }, __D__, ${state(phone)})`);
  assert.strictEqual(count(body(true), /<details class="dr-wdb-item dr-me" open>/g), 1);
  assert.strictEqual(count(body(false), /<details class="dr-wdb-item[^>]* open/g), 0);
});

test("who drafted best: each row opens to that team's picks; on a phone the viewer's own row starts open", () => {
  const c = page(2024);
  assert.strictEqual(count(run(c, "overviewHtml(__D__, 'u1', null)"), /<details class="dr-wdb-item[^>]* open/g), 0);
  const open = run(c, "overviewHtml(__D__, 'u1', 'u1')");
  assert.strictEqual(count(open, /<details class="dr-wdb-item[^>]* open/g), 1);
  assert.ok(/<details class="dr-wdb-item dr-me" open>/.test(open));
  const row = run(c, "wdbRowHtml(__D__.ranked[0], __D__, null, null)");
  assert.ok(row.includes('<span class="dr-total dr-tone-good">+80</span>'));
  assert.strictEqual(count(row, /class="dr-row[ "]/g), 2, "carl's two picks");
});

test("overview of a season being played is the draft so far: round 1, points, hot starts, hurt early picks", () => {
  const c = page(2024);
  const html = run(c, "liveOverviewHtml(__LIVE__, 'u1')");
  assert.ok(html.includes("Through week 6"));
  assert.ok(html.includes("<h2>Round 1 so far</h2>"));
  assert.ok(html.includes("<h2>Points from the whole draft</h2>"));
  assert.ok(html.includes("<h2>Hot starts after round 3</h2>"));
  assert.ok(html.includes("<h2>Early picks who are hurt</h2>"));
  assert.ok(html.includes(">310<"), "alvin's points");
  assert.ok(html.includes('<span class="dr-you">YOU</span>'));
  assert.ok(!html.includes("Draft board"), "no board without grades");
  // without injury data the hurt list and the injury column are left out
  c.__S2__ = stats({ 2026: D2026.map((p) => ({ ...p, injWeeks: null })) }, META);
  const quiet = run(c, "liveOverviewHtml(DraftData.buildDraft(__S2__, 2026), null)");
  assert.ok(!quiet.includes("Early picks who are hurt"));
  assert.ok(!quiet.includes("dr-pt-inj"));
});

// ---- by round ---------------------------------------------------------------------------------------------------

test("by round: a jump chip and a panel per round, each with its total and its picks", () => {
  const c = page(2024);
  const html = run(c, "byRoundHtml(__D__, null)");
  assert.strictEqual(count(html, /class="dr-rchip"/g), 2);
  assert.strictEqual(count(html, /<section class="panel dr-round"/g), 2);
  assert.ok(html.includes('id="dr-round-2"'));
  assert.ok(html.includes('data-jump="dr-round-2"'));
  assert.ok(html.includes("<b>+49</b> round total vs slot"), "round 1: 41 - 6 + 80 - 66 = 49... shown signed");
  assert.ok(html.includes("Best: Cy Gamma (+80). Costliest: Di Delta (-66)."));
  assert.strictEqual(count(html, /data-pick="/g), 8);
  assert.ok(!/What each round has been worth/i.test(html));
});

test("by round in a season being played: no totals, the most points instead", () => {
  const c = page(2024);
  const html = run(c, "byRoundHtml(__LIVE__, null)");
  assert.ok(!html.includes("round total vs slot"));
  assert.ok(html.includes("Most points: Ann Alpha (120.0)."));
});

// ---- by team ----------------------------------------------------------------------------------------------------

test("by team: a card per team, best draft first, each opening to its picks; the viewer's card says YOU", () => {
  const c = page(2024);
  const html = run(c, "byTeamHtml(__D__, 'u1', null)");
  assert.strictEqual(count(html, /<details class="dr-team/g), 4);
  assert.deepStrictEqual([...html.matchAll(/class="dr-team-name">([^<]+)</g)].map((m) => m[1]), ["carl", "beth", "alvin", "dana"]);
  assert.ok(html.includes('<span class="dr-team-score"><small>total vs slot</small><b class="dr-tone-good">+80</b>'));
  assert.ok(html.includes('<span class="dr-pf">picked </span>from slot 3'));
  assert.strictEqual(count(html, /class="dr-you"/g), 1);
  assert.ok(html.includes('id="dr-team-u1"'));
  assert.strictEqual(count(html, /class="dr-row[ "]/g), 8, "the cards hold every pick once");
  assert.ok(html.includes('aria-label="Grades in draft order: S, B"'));
  assert.ok(html.includes("Best Gamma +80"));
  assert.ok(html.includes("Costliest Delta -66"));
});

test("by team: a card named in the address starts open", () => {
  const c = page(2024);
  const html = run(c, "byTeamHtml(__D__, null, 'u2')");
  assert.strictEqual(count(html, /<details class="dr-team[^>]* open>/g), 1);
  assert.ok(/id="dr-team-u2" open>/.test(html));
});

test("by team in a season being played: points, the hottest pick and injury weeks", () => {
  const c = page(2024);
  const html = run(c, "byTeamHtml(__LIVE__, null, null)");
  assert.ok(html.includes("<small>points</small><b>310</b>"));
  assert.ok(html.includes("Hottest Gamma 25.0/g"));
  assert.ok(html.includes("1 injury weeks"));
  assert.ok(!html.includes("total vs slot"));
});

// ---- table ----------------------------------------------------------------------------------------------------------

test("table: every pick, the sorted column marked for assistive tech, and a Sort by menu for the phone", () => {
  const c = page(2024);
  const ui = "{ filter: 'all', sort: { key: 'vs', dir: 1 } }";
  const html = run(c, `tableTabHtml(__D__, null, ${ui})`);
  assert.strictEqual(count(html, /<tr class="[^"]*" data-pick=/g), 8);
  assert.strictEqual(count(html, /aria-sort="descending"/g), 1, "vs slot is the sorted column, biggest first");
  assert.ok(/aria-sort="descending"><button type="button" class="dr-sort active" data-sort="vs">Vs slot ▾/.test(html));
  assert.ok(/aria-sort="none"><button type="button" class="dr-sort" data-sort="pick">Pick<\/button>/.test(html));
  assert.ok(html.includes('<select id="dr-sort"'));
  assert.ok(html.includes('<option value="vs" selected>'));
  // pick order's own arrow points up (small to big) when it runs the natural way
  assert.ok(run(c, "tableTabHtml(__D__, null, { filter: 'all', sort: { key: 'pick', dir: 1 } })").includes('aria-sort="ascending"'));
  const first = html.match(/<tr class="[^"]*" data-pick="([^"]+)"/)[1];
  assert.strictEqual(first, "2024-3", "the biggest vs slot first");
});

test("table: the filter pills say which one is on; the Table opens on all picks", () => {
  const c = page(2024);
  const html = run(c, "tableTabHtml(__D__, 'u1', { filter: 'mine', sort: { key: 'pick', dir: 1 } })");
  assert.ok(html.includes('class="dr-pill active" data-filter="mine" aria-pressed="true"'));
  assert.ok(html.includes('data-filter="all" aria-pressed="false"'));
  assert.strictEqual(count(html, /<tr class="[^"]*" data-pick=/g), 2, "only alvin's picks");
  assert.ok(!html.includes('<th scope="col" class="">Team</th>'), "the Team column is pointless on My picks");
  // a filter that no longer exists falls back to all
  const stale = run(c, "tableTabHtml(__D__, null, { filter: 'keepers-gone', sort: { key: 'pick', dir: 1 } })");
  assert.strictEqual(count(stale, /<tr class="[^"]*" data-pick=/g), 8);
  assert.ok(stale.includes('data-filter="all" aria-pressed="true"'));
});

test("table columns: value, typical and vs slot when graded; per game when the season is on", () => {
  const c = page(2024);
  const heads = (d) => run(c, `tableColumns(${d}, false).map(x => x.head).join()`);
  assert.strictEqual(heads("__D__"), "Pick,Team,Player,Grade,Points,Value,Typical,Vs slot,Pos. rank,GP,ST");
  assert.strictEqual(heads("__LIVE__"), "Pick,Team,Player,Points,Per game,Pos. rank,GP,ST");
  const graded = run(c, "tableTabHtml(__D__, null, { filter: 'all', sort: { key: 'pick', dir: 1 } })");
  assert.ok(graded.includes("<b>Typical</b> is what that draft slot usually returns"));
  const live = run(c, "tableTabHtml(__LIVE__, null, { filter: 'all', sort: { key: 'pick', dir: 1 } })");
  assert.ok(live.includes("Grades and value vs slot arrive when the season ends."));
  assert.ok(!live.includes('data-sort="vs"'));
  assert.ok(live.includes('data-filter="hurt"'));
});

test("table cells: value and typical are the rounded numbers, hot per-game numbers are marked", () => {
  const c = page(2024);
  const row = run(c, "tableHtml([__D__.picks[0]], __D__, null, { sort: { key: 'pick', dir: 1 } }, 'all')");
  assert.ok(row.includes('<td class="t-num">250.0</td>'));
  assert.ok(row.includes('<td class="t-num">101</td>'));
  assert.ok(row.includes('<td class="t-num t-dim">60</td>'));
  const live = run(c, "tableHtml([__LIVE__.picks[0]], __LIVE__, null, { sort: { key: 'pick', dir: 1 } }, 'all')");
  assert.ok(live.includes('<td class="t-num dr-hot">20.0</td>'));
});

// ---- report card ------------------------------------------------------------------------------------------------

test("report card: the best and worst drafts ever, a row per manager, a column per graded year", () => {
  const c = setup();
  c.__S__ = league();
  c.__CUR__ = null;
  run(c, "__CUR__ = new Set(['u1', 'u2', 'u3']);");
  const html = run(c, "reportHtml(__S__, 'u1', __CUR__, { reportYear: 'total', includePast: false })");
  ["Best drafts ever", "Worst drafts ever", "Your drafts"].forEach((t) => assert.ok(html.includes(`aria-label="${t}"`), t));
  assert.ok(html.includes("dr-rc-top-3"));
  assert.strictEqual(count(html, /<th scope="col">20(24|25)<\/th>/g), 2);
  const grid = html.split('<table class="dr-rc">')[1].split("</table>")[0];
  assert.strictEqual(count(grid, /<th scope="row" class="dr-rc-mgr">/g), 3, "dana is a past manager");
  assert.ok(grid.indexOf("carl") < grid.indexOf("beth") && grid.indexOf("beth") < grid.indexOf("alvin"));
  assert.ok(grid.includes("<small>2 drafts</small>"));
  assert.ok(html.includes("Include past managers"), "a toggle, because one manager is no longer in the league");
  assert.ok(!html.includes('id="dr-past" checked'));
});

test("report card: past managers show last, marked, once the toggle is on; no toggle when there are none", () => {
  const c = setup();
  c.__S__ = league();
  run(c, "var __CUR__ = new Set(['u1', 'u2', 'u3']);");
  const html = run(c, "reportHtml(__S__, null, __CUR__, { reportYear: 'total', includePast: true })");
  assert.ok(html.includes('id="dr-past" checked'));
  assert.ok(html.includes("former manager"));
  assert.ok(/<tr class=" dr-past">/.test(html) || /dr-past"><th/.test(html));
  assert.ok(!html.includes('aria-label="Your drafts"'), "no My Team, no Your drafts");
  const none = run(c, "reportHtml(__S__, null, null, { reportYear: 'total', includePast: false })");
  assert.ok(!none.includes("Include past managers"), "everyone counts as current, so nothing to toggle");
});

test("report card cells link to that team's draft and say what they are", () => {
  const c = setup();
  c.__S__ = league();
  const html = run(c, "reportHtml(__S__, null, null, { reportYear: 'total', includePast: true })");
  assert.ok(html.includes('href="#2024/team/u3"'));
  assert.ok(html.includes('title="2024: +80 vs slot, 1st of 4, slot 3"'));
  assert.ok(html.includes('<td class="dr-rc-none">–</td>'), "dana did not draft in 2025");
  assert.ok(html.includes('<span class="dr-rc-t">+80</span><span class="dr-rc-r">#1</span>'));
});

test("report card on a phone: one year (or the totals) at a time, one manager per row", () => {
  const c = setup();
  c.__S__ = league();
  const total = run(c, "reportHtml(__S__, 'u1', null, { reportYear: 'total', includePast: false })");
  const phone = total.split('<div class="dr-rcp">')[1];
  assert.ok(phone.includes('data-report-year="total"'));
  assert.ok(phone.indexOf('data-report-year="2025"') < phone.indexOf('data-report-year="2024"'), "newest year first");
  assert.ok(/data-report-year="total" aria-pressed="true"/.test(phone));
  assert.ok(phone.includes("2 drafts · +1/yr"), "alvin: 2 drafts, +11 and -10, averaging +1 a year");
  const y = run(c, "reportHtml(__S__, null, null, { reportYear: '2025', includePast: false })");
  const list = y.split('<ul class="dr-rcp-list">')[1];
  assert.strictEqual(count(list, /<li class="dr-rcp-row/g), 3, "three teams drafted in 2025");
  assert.ok(list.indexOf("beth") < list.indexOf("carl") && list.indexOf("carl") < list.indexOf("alvin"), "that year's best first: +40, +25, -10");
  // a year that is not on the card falls back to the totals
  const bad = run(c, "reportHtml(__S__, null, null, { reportYear: '1999', includePast: false })");
  assert.ok(/data-report-year="total" aria-pressed="true"/.test(bad));
});

test("report card before any draft is graded says so", () => {
  const c = setup();
  c.__S__ = stats({ 2026: D2026 }, META);
  assert.ok(run(c, "reportHtml(__S__, null, null, { reportYear: 'total', includePast: false })").includes("No graded drafts yet"));
  assert.ok(run(c, "hallHtml(__S__, null)").includes("No graded drafts yet"));
});

// ---- steals and busts ----------------------------------------------------------------------------------------------

test("steals and busts: the best and costliest picks ever, a row each, with the year and the manager", () => {
  const c = setup();
  c.__S__ = league();
  const html = run(c, "hallHtml(__S__, 'u3')");
  assert.ok(html.includes("<h2>7 best picks ever</h2>"));
  assert.ok(html.includes("<h2>5 costliest picks ever</h2>"));
  assert.strictEqual(count(html, /<button type="button" class="dr-row dr-hall/g), 12);
  assert.ok(html.includes("'25"));
  assert.ok(html.includes("carl · 400.0 pts"));
  assert.ok(html.includes("dr-me"), "carl's own picks are marked");
  assert.ok(!html.includes("Ed Epsilon"), "a held-at-B kicker is no steal, and he was not costly either");
  // each list's columns match its --cols
  const tracks = colTokens(html.match(/--cols: ([^"]*)"/)[1]).length;
  assert.strictEqual(tracks, 7);
  assert.strictEqual(count(html.split('<li class="dr-rowhead"')[1].split("</li>")[0], /<span/g), 1 + tracks, "the header has a cell for each column");
});

// ---- the pick card ---------------------------------------------------------------------------------------------------

test("pick card (graded): value, typical and vs slot up top, the games and position rank below", () => {
  const c = page(2024);
  const html = run(c, "pickCardHtml(__D__.picks[0], 'u1')");
  assert.ok(html.includes("2024 · pick 1.1"));
  assert.ok(html.includes('<h3 class="dr-pc-name">Ann Alpha</h3>'));
  assert.ok(html.includes("<dt>Value</dt><dd>101</dd>"));
  assert.ok(html.includes("<dt>Typical</dt><dd>60</dd>"));
  assert.ok(html.includes('<dd><span class="dr-vs b4">+41</span></dd>'));
  assert.ok(html.includes("<dt>Points</dt><dd>250.0</dd>"));
  assert.ok(html.includes("<dt>Games played</dt><dd>15 of 17</dd>"));
  assert.ok(html.includes("<dt>Position rank</dt>"));
  assert.ok(html.includes('class="dr-you"'), "alvin's own pick says YOU");
  assert.ok(html.includes('href="player.html#p1"'));
  assert.ok(html.includes("dr-pc-grade"));
});

test("pick card: a keeper says so, a capped grade explains itself, a season being played has no grade or vs slot", () => {
  const c = page(2024);
  const ed = run(c, "pickCardHtml(__D__.picks.find(p => p.player === 'Ed Epsilon'), null)");
  assert.ok(ed.includes("· keeper"));
  assert.ok(ed.includes('<p class="dr-pc-note">Held at B'));
  const live = run(c, "pickCardHtml(__LIVE__.picks[0], null)");
  assert.ok(live.includes("<dt>Points</dt><dd>120.0</dd>"));
  assert.ok(live.includes("<dt>Per game</dt><dd>20.0</dd>"));
  assert.ok(live.includes("<dt>Games</dt><dd>6 of 6</dd>"));
  assert.ok(!live.includes("<dt>Typical</dt>") && !live.includes("dr-pc-grade"));
});

// ---- head: eyebrow, year pills, tabs ----------------------------------------------------------------------------------

test("heading pieces: the eyebrow, the year pills and the tabs", () => {
  const c = page(2024);
  assert.strictEqual(run(c, "eyebrowText({ season: '2024', tab: 'overview' }, __D__)"), "2024 draft");
  assert.strictEqual(run(c, "eyebrowText({ season: '2026', tab: 'overview' }, __LIVE__)"), "2026 draft · through week 6");
  assert.strictEqual(run(c, "eyebrowText({ season: '2026', tab: 'report' }, null)"), "All graded drafts");
  assert.strictEqual(run(c, "eyebrowText({ season: '2026', tab: 'hall' }, null)"), "All graded drafts");
  const years = run(c, "yearsHtml(['2026', '2025'], { season: '2025', tab: 'table' })");
  assert.ok(years.includes('class="dr-year active" href="#2025/table" aria-current="true">2025'));
  assert.ok(years.includes('class="dr-year" href="#2026/table">2026'), "the year pills keep the tab you are on");
  const tabs = run(c, "tabsHtml(tabsFor(true), { season: '2025', tab: 'round' })");
  assert.strictEqual(count(tabs, /role="tab"/g), 6);
  assert.ok(tabs.includes('class="dr-tab active" role="tab" aria-selected="true" href="#2025/round">By Round'));
  assert.ok(tabs.includes('href="#2025">Overview'));
});

test("the body: a season with no draft says so, and each tab draws its own view", () => {
  const c = page(2024);
  const state = "{ stats: __S__, meId: null, currentIds: null, ui: { filter: 'all', sort: { key: 'pick', dir: 1 }, reportYear: 'total', includePast: false }, phone: false }";
  const body = (tab, d) => run(c, `bodyHtml({ season: '2024', tab: '${tab}', team: null }, ${d}, ${state})`);
  assert.ok(body("overview", "null").includes("No draft on record for 2024 yet."));
  assert.ok(body("overview", "__D__").includes("Draft board"));
  assert.ok(body("overview", "__LIVE__").includes("Round 1 so far"));
  assert.ok(body("round", "__D__").includes("dr-rounds"));
  assert.ok(body("team", "__D__").includes("dr-teams"));
  assert.ok(body("table", "__D__").includes("dr-table"));
  assert.ok(body("report", "null").includes("Report card"));
  assert.ok(body("hall", "null").includes("best picks ever"));
});

// ---- the page's structure ---------------------------------------------------------------------------------------------

test("draft.html: every element the script looks up exists once, and the scripts load in dependency order", () => {
  const html = read("draft.html");
  const js = read("js/draft.js");
  const ids = [...js.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(ids.length > 5);
  [...new Set(ids)].forEach((id) => {
    if (id.includes("$")) return; // built from a variable, like a team card's id
    assert.strictEqual(count(html, new RegExp(`id="${id}"`, "g")), 1, `#${id} appears once`);
  });
  const allIds = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(new Set(allIds).size, allIds.length, "no id appears twice");
  const scripts = [...html.matchAll(/<script src="js\/([^"?]+)/g)].map((m) => m[1]);
  const at = (f) => scripts.indexOf(f);
  ["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "rivalries-data.js", "draft-data.js", "draft.js"].forEach((f) => assert.ok(at(f) >= 0, `${f} is loaded`));
  assert.ok(at("config.js") < at("utils.js") && at("utils.js") < at("sleeper-api.js") && at("sleeper-api.js") < at("deep-history.js"));
  assert.ok(at("rivalries-data.js") < at("draft-data.js") && at("deep-history.js") < at("draft-data.js") && at("draft-data.js") < at("draft.js"));
  assert.ok(at("my-team.js") >= 0 && at("my-team.js") < at("draft.js"), "My Team is picked before the page draws");
});

test("draft.html: the stylesheet is linked here and only here, and the nav marks Draft as the current page", () => {
  assert.ok(/<link rel="stylesheet" href="css\/draft\.css\?v=[0-9a-f]+"/.test(read("draft.html")));
  fs.readdirSync(ROOT)
    .filter((f) => f.endsWith(".html") && f !== "draft.html")
    .forEach((f) => assert.ok(!read(f).includes("draft.css"), `${f} does not load the draft stylesheet`));
  assert.ok(/class="nav-link active" href="draft\.html"/.test(read("draft.html")));
  assert.ok(/<body class="page-draft">/.test(read("draft.html")));
});

test("the pick card is a modal dialog that starts hidden, with a way to close it by button, backdrop and Escape", () => {
  const html = read("draft.html");
  const sheet = html.match(/<div class="dr-sheet"[^>]*>/)[0];
  assert.ok(sheet.includes('role="dialog"') && sheet.includes('aria-modal="true"') && sheet.includes("aria-label=") && /\shidden[\s>]/.test(sheet));
  assert.ok(count(html, /data-sheet-close/g) >= 2, "the backdrop and the close button");
  const js = read("js/draft.js");
  assert.ok(/e\.key === "Escape"/.test(js), "Escape closes it");
  assert.ok(/trapFocus/.test(js), "focus stays inside while it is open");
  const css = read("css/draft.css");
  assert.ok(/\.dr-sheet\[hidden\]\s*\{\s*display:\s*none/.test(css), "hidden really hides it");
});

test("the phone layout switches at the same width the script asks about, and motion respects the viewer's setting", () => {
  const css = read("css/draft.css");
  const js = read("js/draft.js");
  assert.ok(/@media \(max-width: 720px\)/.test(css));
  assert.ok(js.includes("(max-width: 720px)"), "isPhone() asks the same question");
  assert.ok(/prefers-reduced-motion/.test(css) || /prefers-reduced-motion/.test(js));
  // every pick row has both versions, and the stylesheet decides which one shows
  assert.ok(/\.dr-narrow\s*\{[^}]*display:\s*none/.test(css));
});

test("the sample page has no leftover scaffolding: no console.log, no TODO, no stray markup of the old Board toggle", () => {
  ["js/draft.js", "js/draft-data.js"].forEach((f) => {
    const src = read(f);
    assert.ok(!/console\.log|TODO|FIXME|debugger/.test(src), `${f} is clean`);
  });
  assert.ok(!/draft-view|draft-board-toggle|draftViewToggle/.test(read("draft.html") + read("js/draft.js")));
});
