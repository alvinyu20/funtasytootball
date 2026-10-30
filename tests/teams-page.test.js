const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const hist = require("./helpers/history-fixture.js");
const fx = require("./helpers/teams-fixture.js");

/*
  The Teams page's markup and wiring (js/teams.js), run against the same made-up league the
  teams-data tests use: alice (3 titles, a live 2022), bob, cara, dan, newbie (joined in 2022)
  and gone (one 2020 season, no longer playing). The numbers themselves are teams-data's job;
  what is checked here is that they reach the page, in the right places, the right way round.
*/

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const count = (text, re) => (text.match(re) || []).length;

function setup() {
  const ctx = loadSiteModules(["config.js", "utils.js", "my-team.js", "sleeper-api.js", "deep-history.js", "manual-history.js", "history-data.js", "teams-data.js", "teams.js"]);
  ctx.__chain = hist.chain();
  ctx.__manual = hist.manual();
  ctx.__managers = fx.fullManagers();
  // Owners are built from the Sleeper seasons alone (the ESPN rows have no isSeasonComplete).
  ctx.__sleeperOnly = ctx.__managers.map((m) => ({ ...m, seasons: m.seasons.filter((s) => s.isSeasonComplete !== undefined) }));
  return ctx;
}

// TEAMS filled in the way renderTeams fills it.
const FILL = `
  TEAMS.ledger = HistoryData.buildLedger(__chain, __manual);
  const od = HistoryData.buildOwners(__sleeperOnly, __manual, TEAMS.ledger);
  TEAMS.owners = od.owners; TEAMS.firstYear = od.firstYear; TEAMS.latestYear = od.latestYear;
  TEAMS.stats = { managers: __managers };
  TEAMS.averages = TeamsData.leagueAverages(__chain, __manual);
  TEAMS.awards = { seasons: {
    2021: { "Best Draft Pick": { detail: "Ann Example, 1st", username: "alice" }, "Worst Drop": { detail: "Zed", username: "alice" } },
    2022: { "Best Team": { detail: "", username: "alice" } },
    2010: { "Best Team": { detail: "", username: "alice" } },
  } };
  TEAMS.trackedYears = new Set(["2020", "2021", "2022"]);
  TEAMS.playerDirectory = { p9: { full_name: "Ann Example" } };
  TEAMS.nameIndex = null;
  TEAMS.teamNames = {};
  __managers.forEach((m) => { if (m.userId && m.teamName) TEAMS.teamNames[m.userId] = m.teamName; });
  const teamCountByYear = {};
  TEAMS.ledger.forEach((s) => (teamCountByYear[s.year] = s.teamCount));
  const years = [];
  for (let y = TEAMS.firstYear; y <= TEAMS.latestYear; y++) years.push(y);
  TEAMS.cards = TEAMS.owners.map((o) => TeamsData.ownerCard(o, { years, teamCountByYear, latestYear: TEAMS.latestYear, teamNames: TEAMS.teamNames }));
  const O = (n) => TEAMS.owners.find((o) => o.name === n);
  const M = (n) => TEAMS.stats.managers.find((m) => m.username === n);
  const C = (n) => TEAMS.cards.find((c) => c.name === n);
  const FACTS = (n) => TeamsData.profileFacts(O(n), TEAMS.owners, TEAMS.ledger, M(n));
`;
const run = (ctx, code) => runInLoadedContext(ctx, `(() => { ${FILL} ${code} })()`);
const html = (ctx, code) => String(run(ctx, code));
const data = (ctx, code) => JSON.parse(run(ctx, `return JSON.stringify((() => { ${code} })())`));

// A stand-in for a DOM element: getAttribute for the attributes it has, closest() for the selectors it can answer.
function fakeEl(attrs, tag) {
  return {
    getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null),
    closest(sel) {
      if (sel === "button") return tag === "button" ? this : null;
      const m = sel.match(/^\[([a-z-]+)\]$/);
      return m && Object.prototype.hasOwnProperty.call(attrs, m[1]) ? this : null;
    },
  };
}

// ---- the index ------------------------------------------------------------------------

test("teamsSubText: seasons of history, active managers, and former managers only when there are some", () => {
  const ctx = setup();
  assert.strictEqual(html(ctx, `return teamsSubText(TEAMS.ledger, TEAMS.cards)`), "4 seasons of history · 5 active managers · 1 former");
  assert.strictEqual(html(ctx, `return teamsSubText([{}], [{ former: false }])`), "1 season of history · 1 active manager");
});

test("teamsControlsHtml: four sorts (the year-rank one named for the latest season) and the Cards / Table switch, the current ones marked on", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsControlsHtml({ sort: "titles", view: "cards" }, 2022)`);
  assert.deepStrictEqual(
    [...out.matchAll(/data-sort="(\w+)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]),
    [["titles", "Titles"], ["win", "Win %"], ["rank", "2022 rank"], ["az", "A to Z"]]
  );
  assert.match(out, /class="pill on" data-sort="titles" aria-pressed="true"/);
  assert.match(out, /class="pill" data-sort="win" aria-pressed="false"/);
  assert.match(out, /class="on" data-view="cards" aria-pressed="true">Cards/);
  const table = html(ctx, `return teamsControlsHtml({ sort: "az", view: "table" }, 2022)`);
  assert.match(table, /class="on" data-view="table" aria-pressed="true">Table/);
  assert.match(table, /class="pill on" data-sort="az"/);
  assert.ok(!/Compare/i.test(out), "no compare button");
});

test("teamsRankPillHtml: 'Nth in <year>' coloured by in or out of the playoff spots, plain 'Nth' in the table, NEW for a newcomer, nothing for a former manager", () => {
  const ctx = setup();
  assert.match(html(ctx, `return teamsRankPillHtml(C("alice"), 2022)`), /<span class="tm-rank in">2nd in 2022<\/span>/);
  assert.match(html(ctx, `return teamsRankPillHtml(C("bob"), 2022)`), /<span class="tm-rank out">3rd in 2022<\/span>/);
  assert.match(html(ctx, `return teamsRankPillHtml(C("alice"), 2022, true)`), /<span class="tm-rank in">2nd<\/span>/);
  const fresh = html(ctx, `return teamsRankPillHtml(C("newbie"), 2022)`);
  assert.match(fresh, /<span class="tm-rank out">5th<span class="tm-dot"> · <\/span><span class="tm-new">NEW<\/span><\/span>/);
  assert.strictEqual(fresh.replace(/<[^>]*>/g, ""), "5th · NEW", "read as text it is still '5th · NEW'");
  assert.strictEqual(html(ctx, `return teamsRankPillHtml(C("gone"), 2022)`), "");
});

test("teamsBarsHtml: one bar per year, title years marked, the live year tinted by in or out, years before they joined left empty", () => {
  const ctx = setup();
  const alice = html(ctx, `return teamsBarsHtml(C("alice"))`);
  assert.strictEqual(count(alice, /<i class="tm-bar/g), 4);
  assert.strictEqual(count(alice, /class="tm-bar title"/g), 3);
  assert.match(alice, /class="tm-bar live in"[^>]*title="2022 so far: 2nd"/);
  assert.match(alice, /title="2021: finished 1st and won the title"/);
  assert.match(alice, /aria-label="Regular-season finish by year, 2019 to 2022"/);
  const bob = html(ctx, `return teamsBarsHtml(C("bob"))`);
  assert.match(bob, /class="tm-bar live out"/);
  assert.ok(!/won the title/.test(bob));
  const newbie = html(ctx, `return teamsBarsHtml(C("newbie"))`);
  assert.strictEqual(count(newbie, /class="tm-bar none"/g), 3, "2019 to 2021 are blank");
  assert.match(newbie, /title="2019: not in the league"/);
});

test("teamsRecordHtml: record, a bar with the .500 tick, and the win rate; dashes when there are no games", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsRecordHtml(C("alice"))`);
  assert.match(out, /<em>20-5<\/em><i class="bar has-tick"><i class="fill up" style="width:80.0%"><\/i><\/i><b>80.0%<\/b>/);
  assert.match(html(ctx, `return teamsRecordHtml(C("cara"))`), /class="fill down" style="width:44.0%"/);
  assert.match(html(ctx, `return teamsRecordHtml({ games: 0 })`), /<em>–<\/em>.*<b>–<\/b>/);
});

test("teamsTitlesHtml / tmRingsHtml: '3 TITLES' with a ring each, singular for one, 'NO TITLES YET', and ×N past six", () => {
  const ctx = setup();
  const three = html(ctx, `return teamsTitlesHtml(C("alice"))`);
  assert.match(three, /3 TITLES/);
  assert.strictEqual(count(three, /<svg class="ring-icon"/g), 3);
  assert.match(html(ctx, `return teamsTitlesHtml({ titles: 1 })`), /1 TITLE<span/);
  assert.match(html(ctx, `return teamsTitlesHtml(C("bob"))`), /class="tm-titles none">NO TITLES YET</);
  const many = html(ctx, `return tmRingsHtml(8)`);
  assert.strictEqual(count(many, /<svg/g), 6);
  assert.match(many, /<b>×8<\/b>/);
  assert.strictEqual(html(ctx, `return tmRingsHtml(0)`), "");
});

test("tmWinBar: .500 is a winning colour (as on the History page), under it is losing, and the fill never leaves the track", () => {
  const ctx = setup();
  assert.match(html(ctx, `return tmWinBar(50)`), /class="fill up" style="width:50.0%"/);
  assert.match(html(ctx, `return tmWinBar(49.9)`), /class="fill down"/);
  assert.match(html(ctx, `return tmWinBar(140)`), /width:100.0%/);
  assert.match(html(ctx, `return tmWinBar(-5)`), /width:0.0%/);
  assert.ok(!/fill/.test(html(ctx, `return tmWinBar(null)`)), "no games, no fill");
  assert.ok(!/has-tick/.test(html(ctx, `return tmWinBar(60, false)`)), "the tick can be left off");
});

test("teamsCardHtml: links to the profile, carries the username for My Team, shows the team name (or holds its space), and escapes names", () => {
  const ctx = setup();
  const card = html(ctx, `return teamsCardHtml(C("alice"), 2022)`);
  assert.match(card, /<a class="tm-card" href="#u1" data-username="alice">/);
  assert.match(card, /<span class="tm-avatar" aria-hidden="true">A<\/span>/);
  assert.match(card, /<span class="tm-team">Team Alice<\/span>/);
  assert.match(html(ctx, `return teamsCardHtml(C("bob"), 2022)`), /<span class="tm-team">&nbsp;<\/span>/);
  const odd = html(ctx, `return teamsCardHtml(Object.assign({}, C("alice"), { name: '<i>x</i>', teamName: 'A&B', userId: 'u 1' }), 2022)`);
  assert.ok(!/<i>x<\/i>/.test(odd), "the name is escaped");
  assert.match(odd, /&lt;i&gt;x&lt;\/i&gt;/);
  assert.match(odd, /A&amp;B/);
  assert.match(odd, /href="#u%201"/, "the id is URL-encoded");
});

test("teamsFormerCardHtml: seasons played and the record; a titles line only when they won one", () => {
  const ctx = setup();
  const gone = html(ctx, `return teamsFormerCardHtml(C("gone"))`);
  assert.match(gone, /class="tm-card former" href="#u6" data-username="gone"/);
  assert.match(gone, /1 SEASON/);
  assert.match(gone, /<em>0-3<\/em>/);
  assert.ok(!/tm-titles/.test(gone));
  assert.match(html(ctx, `return teamsFormerCardHtml(Object.assign({}, C("gone"), { titles: 2, seasons: 4 }))`), /4 SEASONS[\s\S]*2 TITLES/);
});

test("teamsIndexHtml (cards): active managers in the chosen order, former managers under their own label, an empty league says so", () => {
  const ctx = setup();
  const names = (out) => [...out.matchAll(/class="tm-card(?: former)?" href="#\w+" data-username="(\w+)"/g)].map((m) => m[1]);
  const byTitles = html(ctx, `return teamsIndexHtml(TEAMS.cards, { sort: "titles", view: "cards" }, 2022)`);
  assert.deepStrictEqual(names(byTitles), ["alice", "bob", "cara", "dan", "newbie", "gone"]);
  assert.match(byTitles, /FORMER MANAGERS[\s\S]*data-username="gone"/);
  assert.ok(byTitles.indexOf("FORMER MANAGERS") > byTitles.indexOf('data-username="newbie"'), "former managers come last");
  const byRank = html(ctx, `return teamsIndexHtml(TEAMS.cards, { sort: "rank", view: "cards" }, 2022)`);
  assert.deepStrictEqual(names(byRank), ["dan", "alice", "bob", "cara", "newbie", "gone"], "dan is 1st in 2022");
  const noFormer = html(ctx, `return teamsIndexHtml(TEAMS.cards.filter((c) => !c.former), { sort: "titles", view: "cards" }, 2022)`);
  assert.ok(!/FORMER MANAGERS/.test(noFormer));
  assert.match(html(ctx, `return teamsIndexHtml([], { sort: "titles", view: "cards" }, 2022)`), /No managers yet/);
});

test("teamsIndexHtml (table): a row per manager with the year's rank, titles, record, win rate and playoff trips; dashes where there is nothing yet", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsIndexHtml(TEAMS.cards, { sort: "titles", view: "table" }, 2022)`);
  assert.match(out, /<th class="tm-t-rank">2022<\/th>/);
  assert.strictEqual(count(out, /<tr class="tm-trow/g), 6);
  assert.match(out, /<tr class="tm-t-group"><td colspan="9">FORMER MANAGERS/);
  const alice = out.match(/<tr class="tm-trow" data-username="alice">[\s\S]*?<\/tr>/)[0];
  assert.match(alice, /href="#u1">alice</);
  assert.match(alice, /<small>Team Alice<\/small>/);
  assert.match(alice, /tm-rank in">2nd</);
  assert.match(alice, /<b class="medal gold">3<\/b>/);
  assert.match(alice, /tm-t-rec">20-5</);
  assert.match(alice, /<b>80.0%<\/b>/);
  assert.match(alice, /tm-t-po">3 of 3</);
  assert.match(alice, /tm-t-avg">1.7</);
  const newbie = out.match(/<tr class="tm-trow" data-username="newbie">[\s\S]*?<\/tr>/)[0];
  assert.match(newbie, /tm-rank out">5th<span class="tm-dot">/, "a newcomer's NEW can stack under the place on a phone");
  assert.match(newbie, /tm-t-po">–</, "no completed seasons yet");
  assert.match(newbie, /tm-t-avg">–</);
  assert.match(newbie, /medal gold none">–</);
  const gone = out.match(/<tr class="tm-trow is-former" data-username="gone">[\s\S]*?<\/tr>/)[0];
  assert.match(gone, /tm-t-rank">–</);
  assert.match(gone, /tm-t-po">0 of 1</);
});

// ---- the profile: picker, hero, tiles, strip, jump bar ---------------------------------------------

test("teamsPickerHtml: every manager with an id, the open one marked, former managers last", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsPickerHtml("u1")`);
  assert.deepStrictEqual([...out.matchAll(/data-username="(\w+)"/g)].map((m) => m[1]), ["alice", "bob", "cara", "dan", "newbie", "gone"]);
  assert.match(out, /class="tm-pick on" href="#u1" data-username="alice" aria-current="page"/);
  assert.strictEqual(count(out, /aria-current/g), 1);
  assert.match(out, /class="tm-pick is-former" href="#u6"/);
  const ghost = html(ctx, `TEAMS.cards = TEAMS.cards.concat([Object.assign({}, C("bob"), { userId: null, name: "ghost" })]); return teamsPickerHtml("u1")`);
  assert.ok(!/ghost/.test(ghost), "a manager with no account has no profile to open");
});

test("teamsHeroHtml: name, team · since · where they stand, the title line and a ring per title year", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsHeroHtml(FACTS("alice"), "Team Alice", null)`);
  assert.match(out, /<header class="tm-hero" data-username="alice">/);
  assert.match(out, /<h1 class="tm-hero-name">alice<\/h1>/);
  assert.match(out, /<p class="tm-tagline">Team Alice · playing since 2019 · 2022 ranked 2nd after Week 2<\/p>/);
  assert.match(out, /<p class="tm-title-line">3 titles · 3-0 in championship games<\/p>/);
  assert.deepStrictEqual([...out.matchAll(/<li><svg[^>]*>.*?<\/svg><span>(\d+)<\/span>/g)].map((m) => m[1]), ["2019", "2020", "2021"]);
  assert.ok(!/TEAM PROFILE[\s\S]*TEAM PROFILE/.test(out));
});

test("teamsHeroHtml: the Player Representative's photo is in the top bar, large, linked to the player, with the weeks beneath it", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsHeroHtml(FACTS("alice"), "Team Alice", TeamsData.playerRep(M("alice"))[0])`);
  assert.match(out, /<header class="tm-hero has-rep"/);
  assert.match(out, /<figure class="tm-rep-fig">[\s\S]*player-photo-wrap player-photo-hero[\s\S]*<\/figure>/);
  assert.match(out, /<img src="[^"]*p1\.jpg" alt="Player One"/);
  assert.match(out, /<a href="player\.html#p1" class="subtle-link">\s*<div class="player-photo-wrap player-photo-hero">/, "the photo itself links to the player");
  assert.match(out, /<figcaption><span>Player rep<\/span><b><a href="player\.html#p1" class="subtle-link">Player One<\/a><\/b><em>40 wks<\/em><\/figcaption>/);
  // The page sizes it as a portrait, well beyond the usual 40px thumbnail (it was trimmed from 132px when the top got more compact).
  const css = read("css/styles.css");
  const size = css.match(/\.player-photo-hero\s*\{[^}]*?(?<![-\w])width:\s*(\d+)px/);
  assert.ok(size && Number(size[1]) >= 88, "the desktop photo is at least 88px wide");
  assert.ok(!/<figure/.test(html(ctx, `return teamsHeroHtml(FACTS("alice"), "Team Alice", null)`)), "no representative, no photo");
});

test("teamsHeroHtml: no title rings without a title, no team name in the tagline when there isn't one, names escaped", () => {
  const ctx = setup();
  const bob = html(ctx, `return teamsHeroHtml(FACTS("bob"), "", null)`);
  assert.ok(!/class="tm-rings"/.test(bob));
  assert.match(bob, /<p class="tm-tagline">playing since 2019 · /);
  assert.match(bob, /<p class="tm-title-line">No titles yet · 0-3 in championship games<\/p>/);
  const odd = html(ctx, `return teamsHeroHtml(Object.assign({}, FACTS("bob"), { name: "<b>x</b>" }), "A<b>", null)`);
  assert.ok(!/<b>x<\/b>/.test(odd));
  assert.match(odd, /&lt;b&gt;x&lt;\/b&gt;/);
});

test("teamsTilesHtml: three record tiles and four small ones — just the label and the number, with no descriptor line under any of them", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsTilesHtml(FACTS("alice"))`);
  const big = out.match(/<div class="tm-tiles-big">[\s\S]*?<div class="tm-tiles-small">/)[0];
  assert.strictEqual(count(big, /class="tm-tile big"/g), 3);
  assert.match(big, /Overall Record[\s\S]*<b>20-5<\/b><em class="up">80.0%<\/em>/);
  assert.match(big, /Regular Season[\s\S]*<b>14-5<\/b><em class="up">73.7%<\/em>/);
  assert.match(big, /Playoffs[\s\S]*<b>6-0<\/b><em class="up">100.0%<\/em>/);
  const small = out.slice(out.indexOf("tm-tiles-small"));
  assert.strictEqual(count(small, /class="tm-tile small"/g), 4);
  assert.match(small, /Championship Games<\/span>\s*<b>3-0<\/b>\s*<\/div>/);
  assert.match(small, /Playoff Appearances<\/span>\s*<b>3 of 3<\/b>\s*<\/div>/);
  assert.match(small, /First-Round Byes<\/span>\s*<b>2<\/b>\s*<\/div>/);
  assert.match(small, /Third Place<\/span>\s*<b>0<\/b>\s*<\/div>/);
  assert.ok(!/<p>/.test(out), "no descriptor paragraph in any tile");
  for (const gone of ["Best overall win rate", "Includes 2022", "Most playoff wins", "Perfect in the final", "Completed seasons", "of 3 trips", "None yet"]) assert.ok(!out.includes(gone), gone);
  assert.ok(!/1st Pick/i.test(out), "no first-pick tile");
});

test("teamsTilesHtml: a newcomer gets dashes, not '0 of 0' or a 0.0% playoff bar", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsTilesHtml(FACTS("newbie"))`);
  assert.match(out, /Playoffs<\/span>\s*<div class="tm-tile-main"><b>–<\/b><\/div>\s*<i class="bar has-tick"><\/i>\s*<\/div>/);
  assert.match(out, /Championship Games<\/span>\s*<b>–<\/b>/);
  assert.match(out, /Playoff Appearances<\/span>\s*<b>–<\/b>/);
  assert.match(out, /First-Round Byes<\/span>\s*<b>–<\/b>/);
  assert.ok(!/0 of 0/.test(out) && !/<p>/.test(out));
});

test("teamsStripHtml: a square per year with the finish in it, TITLE / LIVE labels, the record under it; the live legend only while a season is live", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsStripHtml(O("alice"))`);
  assert.match(out, /id="tm-strip"/);
  assert.match(out, /style="--n:4"/);
  assert.deepStrictEqual([...out.matchAll(/class="sq st-([\w-]+) tm-sq"/g)].map((m) => m[1]), ["champion", "champion", "champion", "live-in"]);
  assert.match(out, /<b>1<\/b><small>TITLE<\/small>[\s\S]*<span class="tm-sq-rec">3-0<\/span>/);
  assert.match(out, /class="tm-sq-year live">2022<[\s\S]*<small>LIVE<\/small>/);
  assert.match(out, /title="2021: Champion \(1st in the regular season\)"/);
  assert.match(out, /Live: in<\/span><span class="lg"><i class="sq mini st-live-out"><\/i>Live: out/);
  const bob = html(ctx, `return teamsStripHtml(O("bob"))`);
  assert.match(bob, /class="sq st-runnerUp tm-sq"[^>]*><b>1<\/b><small>2ND<\/small>/);
  const done = html(ctx, `const o = O("gone"); return teamsStripHtml(o)`);
  assert.ok(!/Live: in/.test(done), "no live season, no live legend");
  assert.match(done, /class="tm-sq-rec down">0-3</, "a losing record is flagged");
});

test("teamsJumpHtml: only the sections that exist get a button; they jump with data-jump, not an href that would break the page's own routing", () => {
  const ctx = setup();
  const some = html(ctx, `return teamsJumpHtml({ seasons: true, h2h: true, draft: false, lineup: false, awards: true })`);
  assert.deepStrictEqual([...some.matchAll(/data-jump="(\w+)"/g)].map((m) => m[1]), ["seasons", "h2h", "awards"]);
  assert.ok(!/href=/.test(some));
  assert.match(some, /Jump to/);
  const all = html(ctx, `return teamsJumpHtml({ seasons: true, h2h: true, draft: true, lineup: true, awards: true })`);
  assert.match(all, /Seasons[\s\S]*Head-to-head[\s\S]*Drafts[\s\S]*Lineup[\s\S]*Awards/);
});

// ---- Season by Season -------------------------------------------------------------------------------

test("teamsSeasonsHtml: a row per year, newest first — and no Unluckiest / Luckiest / Best-scoring boxes above them", () => {
  const ctx = setup();
  const out = html(ctx, `const rows = TeamsData.seasonRows(O("alice"), M("alice"), TEAMS.averages); return teamsSeasonsHtml("alice", rows)`);
  assert.ok(!/tm-hl|tm-highlights|Unluckiest|Luckiest|Best scoring/.test(out));
  assert.ok(out.trimStart().startsWith('<div class="panel">'), "the table is the first thing in the section");
  assert.deepStrictEqual([...out.matchAll(/<span class="tm-year">(\d+)</g)].map((m) => m[1]), ["2022", "2021", "2020", "2019"]);
  assert.match(out, /class="tm-sbs-row live"[\s\S]*?2022/);
  assert.strictEqual(count(out, /<li class="tm-sbs-row/g), 4);
});

test("teamsSeasonRowHtml: finish square with its title label, record bar, points for and against with the league-average tick, all-play and luck", () => {
  const ctx = setup();
  const out = html(ctx, `const rows = TeamsData.seasonRows(O("alice"), M("alice"), TEAMS.averages); return teamsSeasonsHtml("alice", rows)`);
  const row2021 = out.match(/<li class="tm-sbs-row">\s*<span class="tm-year">2021<[\s\S]*?<\/li>/)[0];
  assert.match(row2021, /class="sq st-champion tm-fin">#1 <small>TITLE<\/small>/);
  assert.match(row2021, /<em>3-0<\/em>/);
  assert.match(row2021, /class="pf" style="width:[\d.]+%"/);
  assert.match(row2021, /class="avg" style="left:[\d.]+%" title="2021 league average: 89.2"/);
  assert.match(row2021, /<b>110.0<\/b> for<br \/><b>80.0<\/b> against/);
  assert.match(row2021, /<em>33-3<\/em>/);
  assert.match(row2021, /<b class="up">\+8.3%<\/b>/);
  assert.match(row2021, /class="fill up" style="left:50%;width:24.9%"/, "luck bars are scaled to the biggest swing in the table (16.7%), not to a fixed 5%");
  assert.match(row2021, /class="tm-line2">110.0 for · 80.0 against · 33-3 vs everyone</, "the phone's second line");
  const live = out.match(/<li class="tm-sbs-row live">[\s\S]*?<\/li>/)[0];
  assert.match(live, /<small>through Week 2<\/small>/);
  assert.match(live, /<b class="down">-16.7%<\/b>/);
  assert.match(live, /class="fill down" style="right:50%;width:50.0%"/, "bad luck grows to the left");
});

test("teamsSeasonRowHtml: an ESPN season has no all-play or luck, and says n/a rather than showing zeros", () => {
  const ctx = setup();
  const out = html(ctx, `const rows = TeamsData.seasonRows(O("alice"), M("alice"), TEAMS.averages); return teamsSeasonsHtml("alice", rows)`);
  const row2019 = out.match(/<li class="tm-sbs-row">\s*<span class="tm-year">2019<[\s\S]*?<\/li>/)[0];
  assert.match(row2019, /<em>n\/a<\/em><small>no matchup data<\/small>/);
  assert.match(row2019, /<b class="na">n\/a<\/b>/);
  assert.match(row2019, /<em>8-3<\/em>/);
  assert.ok(!/vs everyone/.test(row2019.match(/tm-line2">[^<]*</)[0]));
});

test("teamsSeasonsHtml: no seasons says so", () => {
  const ctx = setup();
  assert.match(html(ctx, `return teamsSeasonsHtml("x", [])`), /No seasons yet/);
  assert.ok(!read("js/teams.js").includes("teamsHighlightsHtml"), "the highlight tiles' code is gone");
});

// ---- Head to Head -----------------------------------------------------------------------------------

test("teamsH2hHtml: opponents best win rate first, BEST and WORST flagged, small samples grouped below, playoff-only opponents last", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsH2hHtml(M("alice"))`);
  assert.deepStrictEqual(
    [...out.matchAll(/<li class="tm-h2h-row(?: small| only)?"(?: data-username="([^"]*)")?/g)].map((m) => m[1] || "(group)"),
    ["erin", "bob", "cara", "dan", "gone", "newbie", "(group)"]
  );
  assert.match(out, /href="#u7">erin<\/a><span class="tm-flag best">BEST<\/span>/);
  assert.match(out, /href="#u3">cara<\/a><span class="tm-flag worst">WORST<\/span>/);
  assert.strictEqual(count(out, /tm-flag/g), 2);
  assert.match(out, /UNDER 5 GAMES · TOO SMALL TO RANK/);
  assert.ok(out.indexOf("UNDER 5 GAMES") < out.indexOf('data-username="dan"') && out.indexOf('data-username="dan"') < out.indexOf("PLAYOFFS ONLY"));
  assert.strictEqual(count(out, /tm-h2h-row small/g), 3);
  assert.match(out, /<span class="tm-opp-name">Chris, Liam<\/span>[\s\S]*<span class="tm-only-note">One playoff win over each<\/span>[\s\S]*<span class="tm-po up">2-0<\/span>/);
});

test("teamsH2hRowHtml: record, games, a bar that grows right for a winning record and left for a losing one, win %, and the playoff record", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsH2hHtml(M("alice"))`);
  const row = (name) => out.match(new RegExp(`<li class="tm-h2h-row[^"]*" data-username="${name}">[\\s\\S]*?</li>`))[0];
  assert.match(row("erin"), /tm-h2h-rec">7-1<[\s\S]*tm-h2h-gp">8<[\s\S]*class="fill up" style="left:50%;width:37.5%"[\s\S]*tm-h2h-pct up">88%/);
  assert.match(row("cara"), /tm-h2h-rec">3-5<[\s\S]*class="fill down" style="right:50%;width:12.5%"[\s\S]*tm-h2h-pct down">38%[\s\S]*tm-po up">3-0</);
  assert.match(row("bob"), /tm-po ">1-1</, "an even playoff record has no colour");
  assert.match(row("erin"), /tm-po none">–</);
  assert.match(row("gone"), /tm-cbar dim"><\/i>/, "an even record draws no bar");
  assert.match(row("dan"), /tm-h2h-pct dim">100%/, "small samples are dimmed");
});

test("teamsH2hRowHtml: each opponent with an id gets a Rivalry link to the Rivalries page for that pair; none without an id on either side", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsH2hHtml(M("alice"))`);
  assert.match(out, /<a class="tm-riv" href="rivalries\.html#u1-vs-u2" aria-label="Rivalry with bob"><span class="tm-riv-long">Rivalry →<\/span><span class="tm-riv-short">→<\/span><\/a>/);
  assert.strictEqual(count(out, /class="tm-riv" href="rivalries\.html#u1-vs-/g), 6);
  const noId = html(ctx, `return teamsH2hRowHtml({ userId: null, name: "Zed", record: "1-0", games: 1, winPct: 100, poGames: 0 }, null, false, "u1")`);
  assert.match(noId, /<span class="tm-opp-name">Zed<\/span>/);
  assert.ok(!/href=/.test(noId), "an opponent with no account has nowhere to link");
  const noMe = html(ctx, `return teamsH2hRowHtml({ userId: "u2", name: "bob", record: "1-0", games: 1, winPct: 100, poGames: 0 }, null, false, null)`);
  assert.ok(!/rivalries\.html/.test(noMe));
});

test("teamsH2hHtml: the side cards (best, worst, playoff rival, playoff losses) beside the table, and nothing but a note when there are no matchups", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsH2hHtml(M("alice"))`);
  assert.deepStrictEqual([...out.matchAll(/<div class="tm-h2h-card (\w+)">\s*<span class="tm-tile-label">([^<]*)</g)].map((m) => [m[1], m[2]]), [
    ["best", "Best matchup"],
    ["worst", "Worst matchup"],
    ["rival", "Playoff rival"],
    ["losses", "Playoff losses"],
  ]);
  assert.match(out, /<b>erin, 7-1<\/b>\s*<p>88% across 8 games\./);
  assert.match(out, /<b>cara, 3-0<\/b>/);
  assert.ok(!/Your /.test(out.match(/tm-h2h-cards[\s\S]*/)[0]), "side-card labels do not say 'Your'");
  assert.match(html(ctx, `return teamsH2hHtml(M("bob"))`), /No matchups recorded yet/);
  assert.strictEqual(html(ctx, `return teamsH2hCardsHtml([])`), "");
});

// ---- Draft: report cards, the year picker, the pick table, the lineup ---------------------------------

test("teamsYearPillsHtml: a pill per season they drafted in, the open one on, the unfinished season marked LIVE", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsYearPillsHtml(TeamsData.draftYears(M("alice")), 2021)`);
  assert.deepStrictEqual([...out.matchAll(/data-year="(\d+)"/g)].map((m) => m[1]), ["2022", "2021"]);
  assert.match(out, /class="pill on" data-year="2021" aria-pressed="true">2021<\/button>/);
  assert.match(out, /data-year="2022" aria-pressed="false">2022 <small>LIVE<\/small>/);
});

test("teamsDraftYear: the newest graded year to start with, never the live one; a pick that isn't one of theirs falls back to that", () => {
  const ctx = setup();
  assert.strictEqual(html(ctx, `return teamsDraftYear(M("alice"), { draftYear: null })`), "2021", "2022 is live, so 2021");
  assert.strictEqual(html(ctx, `return teamsDraftYear(M("alice"), { draftYear: 2022 })`), "2022", "but it can be picked");
  assert.strictEqual(html(ctx, `return teamsDraftYear(M("alice"), { draftYear: 2010 })`), "2021");
  assert.strictEqual(html(ctx, `return String(teamsDraftYear(M("bob"), { draftYear: null }))`), "null", "no drafts, no year");
});

test("teamsDraftBodyHtml: the graded year shows every pick's grade and value, plus the lineup, with the year chosen marked in the report cards", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsDraftBodyHtml(M("alice"), { draftYear: null, picksExpanded: false })`);
  assert.match(out, /<h2>2021 Draft, Pick by Pick<\/h2><span class="panel-note">Title year<\/span>/);
  const picks = out.slice(out.indexOf('id="tm-picks"'), out.indexOf('id="tm-lineup"'));
  assert.deepStrictEqual([...picks.matchAll(/tm-pk-n">([\d.]+)</g)].map((m) => m[1]), ["1.1", "1.2", "2.1", "2.2"]);
  assert.deepStrictEqual([...picks.matchAll(/<span class="tm-pk-gr"><i class="gr gr-(\w)"/g)].map((m) => m[1]), ["S", "A", "C", "F"]);
  assert.match(picks, /tm-pk-vbd up">\+80.0</);
  assert.match(picks, /tm-pk-vbd down">-40.0</);
  assert.match(picks, /Points vs\. a typical pick at that slot/);
  assert.match(out, /class="tm-rc-row title on" data-year="2021" aria-pressed="true"/);
  assert.match(out, /Most Common Lineup[\s\S]*2021 · Title/);
});

test("teamsDraftBodyHtml: a season in progress has NO grades and NO value over replacement anywhere, and is left out of the report cards", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsDraftBodyHtml(M("alice"), { draftYear: 2022, picksExpanded: false })`);
  const picks = out.slice(out.indexOf('id="tm-picks"'), out.indexOf('id="tm-lineup"'));
  assert.match(picks, /<h2>2022 Draft, Pick by Pick<\/h2><span class="panel-note">In progress · grades after the season<\/span>/);
  assert.match(picks, /tm-pk-head ungraded/);
  assert.match(picks, /tm-pk-rows ungraded/);
  assert.deepStrictEqual([...picks.matchAll(/tm-pk-n">([\d.]+)</g)].map((m) => m[1]), ["1.1", "1.2"]);
  assert.match(picks, /tm-pk-pts">55.0</);
  assert.ok(!/class="gr /.test(picks), "no grade squares");
  assert.ok(!/tm-pk-gr|tm-pk-vbd|tm-cbar|typical pick|vs slot/.test(picks), "no value versus the slot either");
  const cards = out.slice(out.indexOf('id="tm-reports"'), out.indexOf('id="tm-picks"'));
  assert.deepStrictEqual([...cards.matchAll(/class="tm-rc-row[^"]*" data-year="(\d+)"/g)].map((m) => m[1]), ["2021"], "2022 has no report card yet");
  assert.ok(!/tm-rc-row[^>]*\bon\b/.test(cards), "the report card for the open year isn't there, so no row is lit");
  assert.match(out, /class="pill on" data-year="2022"/);
});

test("teamsDraftBodyHtml: no draft data at all says so", () => {
  const ctx = setup();
  assert.match(html(ctx, `return teamsDraftBodyHtml(M("bob"), { draftYear: null })`), /No draft data yet/);
});

test("teamsReportCardsHtml: a square per pick in order, S + A and D + F counts, TITLE on a title year; the clicked year's row is lit", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsReportCardsHtml(M("alice"), 2021)`);
  assert.deepStrictEqual([...out.matchAll(/<i class="gr gr-(\w)" title="Pick (\d)/g)].map((m) => m[1] + m[2]), ["S1", "A2", "C3", "F4"]);
  assert.match(out, /<em>TITLE<\/em>/);
  assert.match(out, /tm-rc-sa">2<[\s\S]*tm-rc-df">1</);
  assert.match(html(ctx, `return teamsReportCardsHtml(M("alice"), 2019)`), /class="tm-rc-row title" data-year="2021" aria-pressed="false"/);
  assert.match(html(ctx, `return teamsReportCardsHtml(M("bob"), 2021)`), /No graded drafts yet/);
});

test("teamsPicksHtml: ten picks to begin with and a button for the rest, which turns into 'Show fewer'", () => {
  const ctx = setup();
  const table = `{ graded: true, maxVsSlot: 40, picks: Array.from({ length: 12 }, (_, i) => ({ label: "1." + (i + 1), player: "P" + i, playerId: "p" + i, position: "WR", points: 100 - i, vsSlot: 10 - i, grade: "B" })) }`;
  const closed = html(ctx, `return teamsPicksHtml(${table}, false)`);
  assert.strictEqual(count(closed, /<li class="tm-pk-row">/g), 10);
  assert.match(closed, /data-more="picks">Show all 12 picks</);
  const open = html(ctx, `return teamsPicksHtml(${table}, true)`);
  assert.strictEqual(count(open, /<li class="tm-pk-row">/g), 12);
  assert.match(open, /Show fewer picks/);
  const few = html(ctx, `return teamsPicksHtml({ graded: true, maxVsSlot: 1, picks: [{ label: "1.1", player: "A", playerId: "a", position: "QB", points: 1, vsSlot: 1, grade: "S" }] }, false)`);
  assert.ok(!/data-more/.test(few), "a short list has no button");
  assert.match(html(ctx, `return teamsPicksHtml(null, false)`), /No draft data for this season/);
});

test("teamsPicksHtml: a pick without a position or points still draws, and names are escaped", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsPicksHtml({ graded: false, maxVsSlot: 0, picks: [{ label: "3.4", player: "<u>X</u>", playerId: null, position: null, points: null, vsSlot: null, grade: null }] }, false)`);
  assert.ok(!/<u>X<\/u>/.test(out));
  assert.match(out, /&lt;u&gt;X&lt;\/u&gt;/);
  assert.match(out, /tm-pk-pts">–</);
});

test("teamsLineupHtml: how the lineup was put together, then each slot with who, how they arrived and how many starts", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsLineupHtml(TeamsData.lineupView(M("alice").seasons.find((s) => Number(s.season) === 2021)))`);
  assert.match(out, /class="tm-mix" role="img" aria-label="Draft 2, Waivers 1"/);
  assert.match(out, /<i class="acq-draft" style="flex-grow:2"><\/i><i class="acq-waivers" style="flex-grow:1"><\/i>/);
  assert.match(out, /Starts of 14/);
  assert.match(out, /tm-lu-slot">QB<[\s\S]*Quinn[\s\S]*tm-acq acq-draft">DRAFT<[\s\S]*<b>14<\/b>/);
  assert.match(out, /tm-lu-slot">RB1<[\s\S]*tm-acq acq-waivers">WAIVERS<[\s\S]*width:50%/);
  assert.match(out, /tm-lu-slot">K<[\s\S]*tm-lu-name none">—<[\s\S]*<b>–<\/b>/, "an empty slot is a dash, not 0");
  assert.match(html(ctx, `return teamsLineupHtml(null)`), /No lineup data for this season/);
});

// ---- Awards and the Player Representative ---------------------------------------------------------------

test("teamsAwardsHtml: a row per award, newest first, best and worst marked, Best Team with no detail says which year's team, player names link to the player", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsAwardsHtml(TeamsData.awardsFor("alice", TEAMS.awards, TEAMS.trackedYears))`);
  assert.deepStrictEqual([...out.matchAll(/tm-aw-year">(\d+)<[\s\S]*?tm-aw-cat">([^<]*)</g)].map((m) => m[1] + " " + m[2]), ["2022 Best Team", "2021 Best Draft Pick", "2021 Worst Drop"]);
  assert.match(out, /tm-aw-detail">2022 team</);
  assert.match(out, /<i class="tm-aw-sq good" title="Best">/);
  assert.match(out, /<i class="tm-aw-sq bad" title="Worst">/);
  assert.match(out, /<a href="player\.html#p9" class="subtle-link">Ann Example, 1st<\/a>/, "found by name in the player directory");
  assert.match(out, /tm-aw-detail">Zed</, "unknown players are plain text");
  assert.ok(!/2010/.test(out), "years the site doesn't track (no award data) are left out");
});

test("teamsRepHtml: the player on their roster longest on top, then the rest with bars scaled to him", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsRepHtml(TeamsData.playerRep(M("alice")))`);
  assert.match(out, /Player Representative/);
  assert.match(out, /tm-rep-top"><b><a href="player\.html#p1" class="subtle-link">Player One<\/a><\/b><span>40 weeks on the roster, the most of any player/);
  assert.match(out, /class="fill up" style="width:100.0%"[\s\S]*<b>40 wks<\/b>[\s\S]*class="fill sage" style="width:25.0%"[\s\S]*<b>10 wks<\/b>/);
});

// ---- the whole profile -----------------------------------------------------------------------------------

test("teamsProfileHtml: back link and picker, then hero, tiles, strip, jump bar, Season by Season, Head-to-Head, Draft, awards and representative, in that order", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsProfileHtml(O("alice"), M("alice"))`);
  const order = ["All teams", 'id="tm-picker"', "tm-hero", "tm-tiles-big", 'id="tm-strip"', "tm-jump", 'id="tm-seasons"', 'id="tm-h2h"', 'id="tm-draft"', 'id="tm-draft-body"', 'id="tm-lineup"', 'id="tm-awards-wrap"'];
  const at = order.map((s) => out.indexOf(s));
  assert.ok(at.every((i) => i >= 0), `all parts present: ${at}`);
  assert.deepStrictEqual([...at].sort((a, b) => a - b), at, "in order");
  assert.match(out, /<h2>Season by Season<\/h2>/);
  assert.match(out, /<h2>Head-to-Head<\/h2>/);
  assert.match(out, /<h2>Draft Picks and Lineups<\/h2>/);
  assert.match(out, /has-rep/, "alice has a representative, so her photo is in the top bar");
  assert.deepStrictEqual([...out.matchAll(/data-jump="(\w+)"/g)].map((m) => m[1]), ["seasons", "h2h", "draft", "lineup", "awards"]);
  assert.match(out, /class="back-link" href="#"/);
});

test("teamsProfileHtml: someone with no drafts, awards or representative gets no jump links to sections that aren't there", () => {
  const ctx = setup();
  const out = html(ctx, `return teamsProfileHtml(O("bob"), M("bob"))`);
  assert.deepStrictEqual([...out.matchAll(/data-jump="(\w+)"/g)].map((m) => m[1]), ["seasons", "h2h"]);
  assert.ok(!/id="tm-awards-wrap"/.test(out));
  assert.ok(!/<figure/.test(out), "no representative, no photo");
  assert.match(out, /No draft data yet/);
});

test("every component My Team lights up carries a username: cards, picker links, the hero, table rows and head-to-head rows", () => {
  const ctx = setup();
  const profile = html(ctx, `return teamsProfileHtml(O("alice"), M("alice"))`);
  const index = html(ctx, `return teamsIndexHtml(TEAMS.cards, { sort: "titles", view: "cards" }, 2022)`);
  const table = html(ctx, `return teamsIndexHtml(TEAMS.cards, { sort: "titles", view: "table" }, 2022)`);
  for (const [text, re] of [
    [index, /<a class="tm-card[^>]*>/g],
    [table, /<tr class="tm-trow[^>]*>/g],
    [profile, /<a class="tm-pick[^>]*>/g],
    [profile, /<header class="tm-hero[^>]*>/g],
    [profile, /<li class="tm-h2h-row(?! only)[^>]*>/g],
  ]) {
    const tags = text.match(re) || [];
    assert.ok(tags.length > 0, `${re} matched something`);
    tags.forEach((t) => assert.match(t, /data-username="/, t));
  }
  const selector = read("js/my-team.js").match(/const ROW_SELECTOR = "([^"]*)"/)[1];
  [".tm-card", ".tm-pick", ".tm-hero", ".tm-h2h-row"].forEach((c) => assert.ok(selector.split(/,\s*/).includes(c), `${c} is a My Team row`));
  assert.ok(selector.split(/,\s*/).includes("tr"), "table rows too");
});

// ---- drawing and wiring -----------------------------------------------------------------------------------

test("renderRoute: no hash is the index (cards, with the controls and the sub line); a #userId is that profile, and the index is hidden", () => {
  const ctx = setup();
  runInLoadedContext(ctx, `(() => { ${FILL} })()`);
  ctx.location.hash = "";
  runInLoadedContext(ctx, `renderRoute()`);
  const doc = ctx.document;
  assert.strictEqual(doc.getElementById("teams-detail-view").style.display, "none");
  assert.strictEqual(doc.getElementById("teams-index-view").style.display, "");
  assert.strictEqual(doc.getElementById("sb-sub").textContent, "4 seasons of history · 5 active managers · 1 former");
  assert.match(doc.getElementById("teams-index").innerHTML, /class="tm-grid"/);
  assert.match(doc.getElementById("teams-controls").innerHTML, /data-sort="titles"/);

  ctx.location.hash = "#u2";
  runInLoadedContext(ctx, `renderRoute()`);
  assert.strictEqual(doc.getElementById("teams-index-view").style.display, "none");
  assert.strictEqual(doc.getElementById("teams-detail-view").style.display, "");
  assert.match(doc.getElementById("teams-detail-view").innerHTML, /<h1 class="tm-hero-name">bob<\/h1>/);

  ctx.location.hash = "#nobody";
  runInLoadedContext(ctx, `renderRoute()`);
  assert.strictEqual(doc.getElementById("teams-index-view").style.display, "", "an unknown id falls back to the index");
});

test("showProfile: opening a different manager starts the draft over at their newest graded year; redrawing the same one keeps the year", () => {
  const ctx = setup();
  runInLoadedContext(ctx, `(() => { ${FILL} })()`);
  ctx.location.hash = "#u1";
  runInLoadedContext(ctx, `renderRoute(); TEAMS_UI.draftYear = 2022; TEAMS_UI.picksExpanded = true; renderRoute();`);
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.draftYear`), 2022, "same manager: kept");
  ctx.location.hash = "#u2";
  runInLoadedContext(ctx, `renderRoute()`);
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.draftYear`), null);
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.picksExpanded`), false);
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.profileId`), "u2");
});

test("the controls: a sort or view button redraws the index; the draft year, show-all and jump buttons act on the profile", () => {
  const ctx = setup();
  runInLoadedContext(ctx, `(() => { ${FILL} })()`);
  const listeners = {};
  ctx.window = { addEventListener: (name, fn) => (listeners[name] = fn), scrollTo() {} };
  runInLoadedContext(ctx, `initTeamsControls()`);
  assert.strictEqual(typeof listeners.hashchange, "function", "the route follows the address bar");

  const controls = ctx.document.getElementById("teams-controls");
  ctx.location.hash = "";
  runInLoadedContext(ctx, `renderRoute()`);
  controls.onclick({ target: fakeEl({ "data-sort": "az" }, "button") });
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.sort`), "az");
  assert.match(controls.innerHTML, /class="pill on" data-sort="az"/);
  controls.onclick({ target: fakeEl({ "data-view": "table" }, "button") });
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.view`), "table");
  assert.match(ctx.document.getElementById("teams-index").innerHTML, /<table class="tm-table"/);
  controls.onclick({ target: fakeEl({}, "button") }); // a button with neither: ignored
  controls.onclick({ target: fakeEl({ "data-sort": "win" }, "span") }); // not inside a button: ignored
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.sort`), "az");

  ctx.location.hash = "#u1";
  listeners.hashchange();
  const detail = ctx.document.getElementById("teams-detail-view");
  assert.match(ctx.document.getElementById("tm-draft-body").innerHTML || detail.innerHTML, /2021 Draft, Pick by Pick/);
  // Pick the 2022 year: the picks table goes ungraded.
  detail.onclick({ target: fakeEl({ "data-year": "2022" }) });
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.draftYear`), 2022);
  assert.match(ctx.document.getElementById("tm-draft-body").innerHTML, /2022 Draft, Pick by Pick[\s\S]*In progress · grades after the season/);
  // Clicking a report-card row picks that year again.
  detail.onclick({ target: fakeEl({ "data-year": "2021" }) });
  assert.match(ctx.document.getElementById("tm-draft-body").innerHTML, /2021 Draft, Pick by Pick/);
  // Show-all flips and a year change collapses it again.
  detail.onclick({ target: fakeEl({ "data-more": "picks" }) });
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.picksExpanded`), true);
  detail.onclick({ target: fakeEl({ "data-more": "picks" }) });
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.picksExpanded`), false, "a second click folds it back up");
  detail.onclick({ target: fakeEl({ "data-more": "picks" }) });
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.picksExpanded`), true);
  detail.onclick({ target: fakeEl({ "data-year": "2022" }) });
  assert.strictEqual(runInLoadedContext(ctx, `TEAMS_UI.picksExpanded`), false);
  // Jump buttons scroll to their section.
  const scrolled = [];
  ctx.document.getElementById("tm-h2h").scrollIntoView = (o) => scrolled.push(o.block);
  detail.onclick({ target: fakeEl({ "data-jump": "h2h" }) });
  assert.deepStrictEqual(scrolled, ["start"]);
});

test("teamsJump: the Awards button falls back to the wrapper when only the representative panel is there", () => {
  const ctx = setup();
  const real = ctx.document.getElementById;
  const hit = [];
  ctx.document.getElementById = (id) => {
    if (id === "tm-awards") return null;
    const el = real.call(ctx.document, id);
    el.scrollIntoView = () => hit.push(id);
    return el;
  };
  runInLoadedContext(ctx, `teamsJump("awards")`);
  assert.deepStrictEqual(hit, ["tm-awards-wrap"]);
  assert.doesNotThrow(() => runInLoadedContext(ctx, `teamsJump("nowhere")`));
});

// ---- the page itself --------------------------------------------------------------------------------------

test("renderDraft: with no profile open it leaves the page alone", () => {
  const ctx = setup();
  runInLoadedContext(ctx, `(() => { ${FILL} })()`);
  const body = ctx.document.getElementById("tm-draft-body");
  body.innerHTML = "untouched";
  runInLoadedContext(ctx, `TEAMS_UI.profileId = null; renderDraft();`);
  assert.strictEqual(body.innerHTML, "untouched");
  runInLoadedContext(ctx, `TEAMS_UI.profileId = "u1"; renderDraft();`);
  assert.match(body.innerHTML, /Draft Report Cards/);
});

test("teams.js loading: the owners are built before the ESPN seasons are folded in, and a template season nobody filled in never shows", () => {
  const script = read("js/teams.js");
  const built = script.indexOf("HistoryData.buildOwners(");
  assert.ok(built > 0);
  assert.ok(built < script.indexOf("ManualHistory.mergeIntoManager("), "the ESPN rows are shaped differently, so owners come first");
  assert.ok(built < script.indexOf("m.seasons = [...m.seasons"), "and before the ESPN seasons are added to the managers");
  assert.match(script, /startsWith\("REPLACE_WITH"\)/, "an un-replaced template entry is dropped");
});

test("teams.html: the Teams body class, the containers the script draws into, and the scripts in dependency order", () => {
  const page = read("teams.html");
  assert.match(page, /<body class="page-teams">/);
  ["teams-index-view", "teams-detail-view", "teams-controls", "teams-index", "sb-sub", "teams-error", "teams-error-wrap", "progress-status"].forEach((id) => assert.match(page, new RegExp(`id="${id}"`), id));
  const scripts = [...page.matchAll(/<script src="js\/([\w-]+\.js)/g)].map((m) => m[1]);
  const need = ["config.js", "utils.js", "my-team.js", "sleeper-api.js", "deep-history.js", "manual-history.js", "history-data.js", "teams-data.js", "teams.js"];
  need.forEach((s) => assert.ok(scripts.includes(s), `${s} is loaded`));
  assert.deepStrictEqual(need.map((s) => scripts.indexOf(s)), need.map((s) => scripts.indexOf(s)).sort((a, b) => a - b), "dependencies first");
  assert.match(page, /class="nav-link active" href="teams\.html"/);
});

test("the page's copy: none of the mockups' headlines, descriptions or footnotes, and no 'ESPN era' wording, made it in", () => {
  const source = read("js/teams.js") + read("teams.html");
  assert.ok(!/ESPN era/i.test(source));
  assert.ok(!/Compare with/i.test(source), "no compare button");
  assert.ok(!/1st Pick/i.test(source), "no first-pick tile");
});

test("the styles: an ungraded pick table drops the value columns, on desktop and on a phone", () => {
  const css = read("css/styles.css");
  assert.match(css, /\.tm-pk-head\.ungraded, \.tm-pk-rows\.ungraded \.tm-pk-row \{ grid-template-columns: 44px minmax\(0, 1fr\) 44px 70px; \}/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.tm-pk-head\.ungraded, \.tm-pk-rows\.ungraded \.tm-pk-row \{ grid-template-columns: 34px minmax\(0, 1fr\) 60px; \}/);
});
