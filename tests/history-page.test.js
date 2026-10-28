const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const fx = require("./helpers/history-fixture.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function setup() {
  const ctx = loadSiteModules(["config.js", "utils.js", "my-team.js", "sleeper-api.js", "deep-history.js", "manual-history.js", "history-data.js", "history.js"]);
  ctx.__chain = fx.chain();
  ctx.__manual = fx.manual();
  ctx.__managers = fx.managers();
  return ctx;
}

// The fixture league, built the way the page builds it.
const DATA = `
  const ledger = HistoryData.buildLedger(__chain, __manual);
  const data = HistoryData.buildOwners(__managers, __manual, ledger);
`;
const html = (ctx, code) => runInLoadedContext(ctx, `(() => { ${DATA} ${code} })()`);
const count = (text, re) => (text.match(re) || []).length;
const ui = (over) => JSON.stringify({ sort: "titles", show: "all", expanded: false, ...over });

// ---- header ---------------------------------------------------------------------------

test("heroTilesHtml: seasons finished (with the live one noted), different champions, and who has the most titles", () => {
  const ctx = setup();
  const out = html(ctx, `return heroTilesHtml(HistoryData.heroStats(ledger))`);
  assert.strictEqual(count(out, /class="hist-tile/g), 3);
  assert.match(out, /Seasons<\/span>\s*<span class="value">3<\/span>\s*<span class="sub">complete, plus 2022 live</);
  assert.match(out, /Champions<\/span>\s*<span class="value">1<\/span>/);
  assert.match(out, /hist-tile gold[\s\S]*Most titles[\s\S]*value">3<[\s\S]*alice</);
  assert.ok(!/Scoring|\+\d+%/.test(out), "no scoring tile: that belongs to the page that was left out");
});

test("heroTilesHtml: with no live season it just says complete, and a long tie is a count, not a list", () => {
  const ctx = setup();
  const out = html(ctx, `return heroTilesHtml({ seasonsComplete: 4, liveYear: null, champions: 3, mostTitles: 1, mostTitlesNames: ["a", "b", "c"] })`);
  assert.match(out, /<span class="sub">complete<\/span>/);
  assert.match(out, /3 owners tied/);
});

test("yourHistoryHtml: no team picked is one button that opens the picker; a picked team shows a loading line until the history is in", () => {
  const ctx = setup();
  const none = html(ctx, `return yourHistoryHtml(null, null, false)`);
  assert.match(none, /data-myteam-open/);
  assert.ok(!/you-list/.test(none));
  const loading = html(ctx, `return yourHistoryHtml(null, "alice", true)`);
  assert.match(loading, /YOU · alice/);
  assert.match(loading, /Loading/);
});

test("yourHistoryHtml: titles with their years, podiums, average finish with its rank, playoff games, and the season so far", () => {
  const ctx = setup();
  const out = html(ctx, `return yourHistoryHtml(HistoryData.yourHistory(data.owners, ledger, "alice"), "alice", false)`);
  assert.match(out, /Titles<\/span><small>2019, 2020, 2021<\/small><\/dt>\s*<dd class="">3</);
  assert.match(out, /Podiums<\/span><small>3 titles<\/small><\/dt>\s*<dd class="">3</);
  assert.match(out, /Avg finish<\/span><small>2nd best in the league, 3 seasons<\/small>[\s\S]*?>1\.7</);
  assert.match(out, /Playoff games<\/span><small>Most playoff wins in the league<\/small><\/dt>\s*<dd class="">6-0</);
  assert.match(out, /2022 so far<\/span><small>Ranked 2nd after Week 2, inside the top 2<\/small><\/dt>\s*<dd class="up">2ND</);
});

test("yourHistoryHtml: outside the playoff spots reads as blue, and 'behind only' names who is ahead", () => {
  const ctx = setup();
  const out = html(ctx, `return yourHistoryHtml(HistoryData.yourHistory(data.owners, ledger, "bob"), "bob", false)`);
  assert.match(out, /Behind only alice \(6-0\)/);
  assert.match(out, /Ranked 3rd after Week 2, outside the top 2[\s\S]*dd class="down">3RD</);
});

test("yourHistoryHtml: a newcomer has no finish or playoff rows yet, and a picked team with no seasons says so", () => {
  const ctx = setup();
  const out = html(ctx, `return yourHistoryHtml(HistoryData.yourHistory(data.owners, ledger, "newbie"), "newbie", false)`);
  assert.ok(!/Avg finish|Playoff games/.test(out));
  assert.match(out, /2022 so far/);
  assert.match(out, /None yet/);
  const empty = html(ctx, `return yourHistoryHtml(null, "zed", false)`);
  assert.match(empty, /No seasons on record yet/);
});

// ---- Titles by Owner -------------------------------------------------------------------

test("titlesBarHtml: a segment per champion sized by titles, the leader yellow and the rest blue, a count only past one title", () => {
  const ctx = setup();
  ctx.__chain[0].bracket[0] = { r: 3, m: 7, p: 1, t1: 2, t2: 1, w: 2, l: 1 }; // bob 2020, alice 2019 + 2021
  const out = html(ctx, `return titlesBarHtml(HistoryData.titlesByOwner(ledger))`);
  const segs = [...out.matchAll(/class="tb-seg" style="flex-grow:(\d+);background:(#[0-9A-F]{6})"/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(segs, [["2", "#F0A340"], ["1", "#4EA8DD"]]);
  assert.match(out, /tb-name">alice · 2</);
  assert.match(out, /tb-name">bob</, "one title: just the name");
});

test("titlesBarHtml: also draws a bar per owner for the phone, and describes the whole bar to a screen reader", () => {
  const ctx = setup();
  const out = html(ctx, `return titlesBarHtml(HistoryData.titlesByOwner(ledger))`);
  assert.match(out, /<ul class="tb-rows">[\s\S]*tb-row-name">alice<[\s\S]*<b>3<\/b>/);
  assert.match(out, /role="img" aria-label="alice 3"/);
  assert.match(html(setup(), `return titlesBarHtml({ owners: [], seasonsComplete: 0, champions: 0 })`), /No champions crowned yet/);
});

test("titlesMetaText: finished seasons and different champions, singular when there is one", () => {
  const ctx = setup();
  assert.strictEqual(html(ctx, `return titlesMetaText(HistoryData.titlesByOwner(ledger))`), "3 seasons complete · 1 different champion");
  assert.strictEqual(html(ctx, `return titlesMetaText({ seasonsComplete: 11, champions: 5 })`), "11 seasons complete · 5 different champions");
});

// ---- Trophy Room -----------------------------------------------------------------------

test("trophyRoomHtml: one card per season, newest first, each linking to that season", () => {
  const ctx = setup();
  const out = html(ctx, `return trophyRoomHtml(HistoryData.trophyCards(ledger))`);
  assert.deepStrictEqual([...out.matchAll(/href="season\.html#(\d+)"/g)].map((m) => m[1]), ["2022", "2021", "2020", "2019"]);
  assert.strictEqual(count(out, /class="trophy-card/g), 4);
});

test("trophyRoomHtml: a champion card says how the title was won — title number, record, seed, who was beaten", () => {
  const ctx = setup();
  const out = html(ctx, `return trophyRoomHtml(HistoryData.trophyCards(ledger))`);
  const card2020 = out.split("<a ").find((c) => c.includes('season.html#2020'));
  assert.match(card2020, /tc-pill">REPEAT · TITLE 2</, "back-to-back after 2019");
  assert.match(card2020, /Record<\/span><b>2-1</);
  assert.match(card2020, /Seed<\/span><b>#2</);
  assert.match(card2020, /Beat<\/span><b data-no-mine>bob</);
  assert.match(card2020, /tc-badge">A</);
  assert.match(card2020, /tc-team">Team Alice</);
});

test("trophyRoomHtml: a first title is just 'TITLE 1', and the team line stays (blank) so cards in a row still line up", () => {
  const ctx = setup();
  ctx.__chain[1].bracket[0] = { r: 3, m: 7, p: 1, t1: 2, t2: 1, w: 2, l: 1 }; // bob wins 2021
  const out = html(ctx, `return trophyRoomHtml(HistoryData.trophyCards(ledger))`);
  const bob = out.split("<a ").find((c) => c.includes("season.html#2021"));
  assert.match(bob, /tc-pill">TITLE 1</);
  assert.match(bob, /tc-team">&nbsp;</);
});

test("trophyRoomHtml: the ESPN years carry no 'ESPN era' label or any other source badge", () => {
  const ctx = setup();
  const out = html(ctx, `return trophyRoomHtml(HistoryData.trophyCards(ledger))`);
  assert.ok(!/ESPN|Sleeper|era/i.test(out));
  assert.ok(out.includes("season.html#2019"), "but the 2019 card is there");
});

test("trophyRoomHtml: the season in progress is a dashed LIVE card with TBD for what is not known yet — no week, leader or record line", () => {
  const ctx = setup();
  const out = html(ctx, `return trophyRoomHtml(HistoryData.trophyCards(ledger))`);
  const live = out.split("<a ").find((c) => c.includes("trophy-card live"));
  assert.match(live, /tc-pill">LIVE</);
  assert.match(live, /tc-badge">\?</);
  assert.match(live, /tc-name">In progress</);
  assert.strictEqual(count(live, /<b>TBD<\/b>/g), 3);
  assert.ok(!/data-username/.test(live), "an unknown champion is nobody's team");
  assert.ok(!/tc-team|tc-leader|of the season|Leader after|Season in progress/.test(live), "no 'Week # of the season', 'Leader after Week #' or leader's record on the card");
});

test("trophyRoomHtml: the live card reads the same with no clock and no leader — it doesn't depend on either", () => {
  const ctx = setup();
  const out = html(ctx, `return trophyRoomHtml([{ kind: "live", year: 2022 }])`);
  assert.match(out, /tc-name">In progress</);
  assert.ok(!/tc-team|tc-leader|Week \d/.test(out));
});

test("History page: it no longer asks Sleeper for the NFL week or builds a live summary — the trophy card was the only user", () => {
  assert.ok(!/getNflState|nflState|liveSummary/.test(read("js/history.js")));
  assert.ok(!/liveSummary/.test(read("js/history-data.js")));
});

test("trophyRoomHtml: your team's cards are found by My Team through the card itself, and the beaten team's name is skipped", () => {
  const ctx = setup();
  const out = html(ctx, `return trophyRoomHtml(HistoryData.trophyCards(ledger))`);
  assert.ok(/class="trophy-card[^"]*" href="season\.html#2021" data-username="alice"/.test(out));
  const myTeam = read("js/my-team.js");
  assert.match(myTeam, /ROW_SELECTOR = "[^"]*\.trophy-card/);
  assert.match(myTeam, /SKIP_SELECTOR = "[^"]*\[data-no-mine\]/);
});

test("trophyRoomHtml: names are escaped", () => {
  const ctx = setup();
  const out = html(ctx, `return trophyRoomHtml([{ kind: "champion", year: 2020, key: "x", name: "<b>x</b>", userId: null, teamName: "A&B", titleNumber: 1, repeat: false, record: "1-0", seed: 1, beat: "<i>y</i>" }])`);
  assert.ok(!out.includes("<b>x</b>") && !out.includes("<i>y</i>"));
  assert.match(out, /A&amp;B/);
});

// ---- Every Season at a Glance ---------------------------------------------------------

test("seasonGridHtml: a column for every season from the first to the newest, the newest marked live, and an average-finish column", () => {
  const ctx = setup();
  const out = html(ctx, `return seasonGridHtml(data, true)`);
  assert.deepStrictEqual([...out.matchAll(/<th scope="col" class="sg-year[^"]*">(\d+)</g)].map((m) => m[1]), ["2019", "2020", "2021", "2022"]);
  assert.match(out, /sg-year live">2022</);
  assert.match(out, /sg-avg">Avg finish</);
});

test("seasonGridHtml: each square is the regular-season finish, labelled for a medal, in the colour of how the playoffs went", () => {
  const ctx = setup();
  const out = html(ctx, `return seasonGridHtml(data, true)`);
  const alice = out.split('<tr class="sg-row').find((r) => r.includes('data-username="alice"'));
  assert.match(alice, /st-champion"[^>]*><b>2<\/b><small>TITLE<\/small>/, "2019 title from the #2 seed");
  assert.match(alice, /st-champion"[^>]*><b>1<\/b><small>TITLE<\/small>/);
  assert.match(alice, /st-live-in"[^>]*><b>2<\/b>/, "2022 so far: second, inside the top two");
  const bob = out.split('<tr class="sg-row').find((r) => r.includes('data-username="bob"'));
  assert.match(bob, /st-runnerUp"[^>]*><b>1<\/b><small>2ND<\/small>/);
  assert.match(bob, /st-live-out"/);
  const cara = out.split('<tr class="sg-row').find((r) => r.includes('data-username="cara"'));
  assert.match(cara, /st-third"[^>]*><b>3<\/b><small>3RD<\/small>/);
  const dan = out.split('<tr class="sg-row').find((r) => r.includes('data-username="dan"'));
  assert.match(dan, /st-missed"[^>]*><b>4<\/b>/);
});

test("seasonGridHtml: seasons an owner did not play are empty dashed squares, one per column", () => {
  const ctx = setup();
  const out = html(ctx, `return seasonGridHtml(data, true)`);
  const newbie = out.split('<tr class="sg-row').find((r) => r.includes('data-username="newbie"'));
  assert.strictEqual(count(newbie, /sq-empty/g), 3);
  assert.strictEqual(count(newbie, /<td class="sg-cell">/g), 4);
});

test("seasonGridHtml: former owners are dimmed, and the average finish is a number and a dot placed on a 1st-to-last track", () => {
  const ctx = setup();
  const out = html(ctx, `return seasonGridHtml(data, true)`);
  assert.match(out.split('<tr class="sg-row').find((r) => r.includes('data-username="gone"')), /^ is-former/);
  const alice = out.split('<tr class="sg-row').find((r) => r.includes('data-username="alice"'));
  // 5 teams in the ESPN year is the largest field: 1.67 -> (1.67-1)/(5-1) = 16.7%
  assert.match(alice, /sg-avg-text">1\.7<\/span><span class="sg-track" aria-hidden="true"><i style="left:16\.7%"/);
  const newbie = out.split('<tr class="sg-row').find((r) => r.includes('data-username="newbie"'));
  assert.match(newbie, /sg-avg-text">–</);
  assert.ok(!/sg-track/.test(newbie), "no finished season, no dot");
});

test("seasonGridHtml: owners link to their Teams page, and a legend explains the colours", () => {
  const ctx = setup();
  const out = html(ctx, `return seasonGridHtml(data, true)`);
  assert.match(out, /href="teams\.html#u1"[^>]*>alice</);
  for (const word of ["Champion", "Runner-up", "Third", "Made playoffs", "Missed", "2022: in", "2022: out"]) assert.ok(out.includes(word), word);
  assert.ok(!html(ctx, `return seasonGridHtml(data, false)`).includes("2022: in"), "no live entries when every season is finished");
});

// ---- Career Records ---------------------------------------------------------------------

test("careerControlsHtml: sort pills and the All / Active filter, with the current choice pressed", () => {
  const ctx = setup();
  const out = html(ctx, `return careerControlsHtml(${ui({ sort: "playoff", show: "active" })}, data.owners, data.latestYear)`);
  assert.deepStrictEqual([...out.matchAll(/data-sort="(\w+)"/g)].map((m) => m[1]), ["titles", "podiums", "playoff", "winpct"]);
  assert.match(out, /pill on" data-sort="playoff" aria-pressed="true"/);
  assert.match(out, /pill" data-sort="titles" aria-pressed="false"/);
  assert.match(out, />All 6</);
  assert.match(out, />Active in 2022 \(5\)</);
  assert.match(out, /pill on" data-show="active"/);
  assert.match(out, /pill-long">Reg\. season win %<[\s\S]*pill-short">Win %</, "a short label for the phone");
});

test("careerListHtml: one row per owner in the chosen order, ranked from 1", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui()})`);
  assert.deepStrictEqual([...out.matchAll(/<li class="cr-row[^"]*" data-username="([^"]+)"/g)].map((m) => m[1]), ["alice", "bob", "cara", "dan", "gone", "newbie"]);
  assert.deepStrictEqual([...out.matchAll(/cr-rank">(\d+)</g)].map((m) => m[1]), ["1", "2", "3", "4", "5", "6"]);
  const byWin = html(ctx, `return careerListHtml(data, ${ui({ sort: "winpct" })})`);
  assert.strictEqual([...byWin.matchAll(/data-username="([^"]+)"/g)][0][1], "bob");
});

test("careerListHtml: the Active filter drops former owners and renumbers", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui({ show: "active" })})`);
  assert.ok(!out.includes('data-username="gone"'));
  assert.strictEqual(count(out, /<li class="cr-row/g), 5);
  assert.deepStrictEqual([...out.matchAll(/cr-rank">(\d+)</g)].map((m) => m[1]), ["1", "2", "3", "4", "5"]);
});

test("careerListHtml: medals are numbered circles, with a dash where there are none", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui()})`);
  const alice = out.split("<li ").find((r) => r.includes('data-username="alice"'));
  assert.match(alice, /medal gold" title="Titles">3<\/b><b class="medal silver none" title="Runner-up finishes">–<\/b><b class="medal bronze none" title="Third places">–</);
  const bob = out.split("<li ").find((r) => r.includes('data-username="bob"'));
  assert.match(bob, /medal gold none" title="Titles">–<\/b><b class="medal silver" title="Runner-up finishes">3</);
});

test("careerListHtml: the strip has a square for every season, with the medal number inside and the live season outlined", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui()})`);
  const strip = (name) => out.split("<li ").find((r) => r.includes(`data-username="${name}"`)).match(/<span class="cr-strip"[\s\S]*?<\/span>/)[0];
  const alice = strip("alice");
  assert.strictEqual(count(alice, /<i class="sq/g), 4);
  assert.deepStrictEqual([...alice.matchAll(/<i class="sq (st-[\w-]+|sq-empty)"[^>]*>(\d?)</g)].map((m) => [m[1], m[2]]), [["st-champion", "1"], ["st-champion", "1"], ["st-champion", "1"], ["st-live-in", ""]]);
  assert.strictEqual(count(strip("newbie"), /sq-empty/g), 3, "seasons before they joined are empty");
  assert.match(alice, /aria-label="alice&#39;s seasons, 2019 to 2022"/);
});

test("careerListHtml: playoff trips, playoff games and regular season each get their numbers and a bar", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui()})`);
  const alice = out.split("<li ").find((r) => r.includes('data-username="alice"'));
  assert.match(alice, /cr-trips"><em>3 of 3<\/em>[\s\S]*?<b>100%<\/b>/);
  assert.match(alice, /cr-po"><em>6-0<\/em>/);
  assert.match(alice, /cr-reg"><em>14-5<\/em>[\s\S]*?<b>73\.7%<\/b>/);
});

test("careerListHtml: bars run 0-100% with a tick at .500; a winning record is yellow and a losing one blue", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui()})`);
  const row = (name) => out.split("<li ").find((r) => r.includes(`data-username="${name}"`));
  assert.match(row("alice"), /cr-po"><em>6-0<\/em><i class="bar has-tick"><i class="fill up" style="width:100\.0%"/);
  assert.match(row("cara"), /cr-po"><em>3-3<\/em><i class="bar has-tick"><i class="fill up" style="width:50\.0%"/, "exactly .500 counts as good");
  assert.match(row("dan"), /cr-reg"><em>5-14<\/em><i class="bar has-tick"><i class="fill down" style="width:26\.3%"/);
  assert.match(row("alice"), /cr-trips"><em>3 of 3<\/em><i class="bar"><i class="fill up"/, "trips has no tick");
});

test("careerListHtml: an exactly-.500 regular season is yellow, like a .500 playoff record", () => {
  const ctx = setup();
  const out = runInLoadedContext(
    ctx,
    `(() => { ${DATA} const o = Object.assign({}, data.owners[0], { regW: 10, regL: 10, regT: 0, regGames: 20, regPct: 50, poPct: 50, poGames: 2, poW: 1, poL: 1 });
      return careerListHtml({ owners: [o], firstYear: 2019, latestYear: 2022, maxTeams: 5 }, ${ui()}); })()`
  );
  assert.match(out, /cr-reg"><em>10-10<\/em><i class="bar has-tick"><i class="fill up" style="width:50\.0%"/);
});

test("barHtml: never draws past either end of the track", () => {
  const ctx = setup();
  const out = html(ctx, `return barHtml(150, "up", false) + barHtml(-5, "down", true) + barHtml(null, "up", false)`);
  assert.deepStrictEqual([...out.matchAll(/width:([\d.]+)%/g)].map((m) => m[1]), ["100.0", "0.0", "0.0"]);
});

test("careerListHtml: no playoff games or no finished seasons shows a dash and an empty bar, not 0%", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui()})`);
  const newbie = out.split("<li ").find((r) => r.includes('data-username="newbie"'));
  assert.match(newbie, /cr-trips"><em>0 of 0<\/em><i class="bar"><i class="fill up" style="width:0\.0%"[\s\S]*?<b>–<\/b>/);
  assert.match(newbie, /cr-po"><em>–<\/em>/);
  assert.match(newbie, /cr-line2">0\/0 playoffs · – · 0-2</);
});

test("careerListHtml: FORMER and NEW tags come from the newest season on record", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui()})`);
  assert.match(out.split("<li ").find((r) => r.includes('data-username="gone"')), /<span class="tag">FORMER<\/span>/);
  assert.match(out.split("<li ").find((r) => r.includes('data-username="newbie"')), /<span class="tag">NEW 2022<\/span>/);
  assert.ok(!/class="tag"/.test(out.split("<li ").find((r) => r.includes('data-username="alice"'))));
});

test("careerListHtml: phone rows past the tenth are marked, and 'Show all' appears only when some are hidden", () => {
  const ctx = setup();
  const many = JSON.stringify(Array.from({ length: 13 }, (_, i) => ({ ...JSON.parse(html(ctx, `return JSON.stringify(data.owners[0])`)), key: `o${i}`, name: `o${i}`, userId: null })));
  ctx.__many = many;
  const out = runInLoadedContext(ctx, `(() => { return careerListHtml({ owners: JSON.parse(__many), firstYear: 2019, latestYear: 2022, maxTeams: 5 }, ${ui()}); })()`);
  assert.strictEqual(count(out, /cr-row cr-extra/g), 3, "rows 11-13");
  assert.match(out, /data-more="career">Show all 13 owners</);
  const expanded = runInLoadedContext(ctx, `careerListHtml({ owners: JSON.parse(__many), firstYear: 2019, latestYear: 2022, maxTeams: 5 }, ${ui({ expanded: true })})`);
  assert.match(expanded, /cr-rows expanded/);
  assert.match(expanded, /Show fewer owners/);
  assert.ok(!/data-more/.test(html(ctx, `return careerListHtml(data, ${ui()})`)), "six owners: nothing to reveal");
});

test("careerListHtml: the legend explains the squares and the .500 tick, and the strip header spans the seasons on record", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui()})`);
  assert.match(out, /Seasons 2019 → 2022/);
  assert.match(out, /tick-key[\s\S]*\.500/);
  assert.match(out, /Titles · 2nd · 3rd/);
});

test("careerListHtml: names link to Teams pages, are escaped, and an empty league says so", () => {
  const ctx = setup();
  const out = html(ctx, `return careerListHtml(data, ${ui()})`);
  assert.match(out, /href="teams\.html#u2"[^>]*>bob</);
  assert.match(html(ctx, `return careerListHtml({ owners: [], firstYear: null, latestYear: null, maxTeams: 0 }, ${ui()})`), /No completed seasons yet/);
});

// ---- Championship Rings -----------------------------------------------------------------

const RINGS = `
  const rings = {
    columns: [{ year: 2020, ownerKey: "alice", ownerName: "alice" }, { year: 2021, ownerKey: "bob", ownerName: "bob" }, { year: 2022, ownerKey: "alice", ownerName: "alice" }],
    letters: new Map([["alice", "A"], ["bob", "B"]]),
    ranked: [
      { playerId: "P1", name: "Player One", totalGamesStarted: 40, rings: [{ season: 2020 }, { season: 2022 }] },
      { playerId: "P2", name: "Player Two", totalGamesStarted: 10, rings: [{ season: 2021 }] },
    ],
  };
`;

test("ringsListHtml: a ring icon per ring, a square per season lettered by the champion's owner, and a games-started bar", () => {
  const ctx = setup();
  const out = html(ctx, `${RINGS} return ringsListHtml(rings)`);
  const p1 = out.split("<li ").find((r) => r.includes("Player One"));
  assert.strictEqual(count(p1, /class="ring-icon"/g), 2);
  assert.deepStrictEqual([...p1.matchAll(/<i class="sq (st-champion|sq-empty)[^"]*"[^>]*>([A-Z]?)</g)].map((m) => m[2] || "-"), ["A", "-", "A"]);
  assert.match(p1, /rg-gs"><i class="bar"><i class="fill dim" style="width:100\.0%"[\s\S]*<b>40<\/b>/);
  const p2 = out.split("<li ").find((r) => r.includes("Player Two"));
  assert.match(p2, /<i class="sq sq-empty"[^>]*><\/i><i class="sq st-champion"[^>]*>B<\/i>/);
  assert.match(p2, /width:25\.0%/, "10 starts is a quarter of the leader's 40");
  assert.match(out, /rg-squares"><span>2020<\/span><span>2021<\/span><span>2022<\/span>/);
});

test("ringsListHtml: the legend names each owner once, and marks yours with (you) and an outline on your squares", () => {
  const ctx = setup();
  runInLoadedContext(ctx, `MyTeam.set("alice")`);
  const out = html(ctx, `${RINGS} return ringsListHtml(rings)`);
  assert.strictEqual(count(out, /class="lg"><i class="sq mini st-champion/g), 2, "alice once, bob once");
  assert.match(out, /alice \(you\)/);
  assert.ok(!/bob \(you\)/.test(out));
  const p1 = out.split("<li ").find((r) => r.includes("Player One"));
  assert.strictEqual(count(p1, /is-mine/g), 2, "both of alice's title squares");
  assert.strictEqual(count(out.split("<li ").find((r) => r.includes("Player Two")).split("</li>")[0], /is-mine/g), 0);
  assert.match(out, /Not on a champion's roster/);
});

test("ringsListHtml: nobody picked means no outlines and no (you)", () => {
  const ctx = setup();
  runInLoadedContext(ctx, `MyTeam.clear()`);
  const out = html(ctx, `${RINGS} return ringsListHtml(rings)`);
  assert.ok(!/is-mine|\(you\)/.test(out));
});

test("ringsListHtml: past the fifth player, rows are held back on a phone until 'Show all'", () => {
  const ctx = setup();
  const out = html(ctx, `${RINGS} rings.ranked = Array.from({ length: 8 }, (_, i) => ({ playerId: "P" + i, name: "Player " + i, totalGamesStarted: 10 - i, rings: [{ season: 2020 }] })); return ringsListHtml(rings)`);
  assert.strictEqual(count(out, /rg-row rg-extra/g), 3);
  assert.match(out, /data-more="rings">Show all 8 players</);
  assert.ok(!/data-more/.test(html(ctx, `${RINGS} return ringsListHtml(rings)`)));
});

test("ringsListHtml: more than six rings is six icons and a count; the player and photo link to the player's page", () => {
  const ctx = setup();
  const icons = html(ctx, `return ringIconsHtml(8)`);
  assert.strictEqual(count(icons, /class="ring-icon"/g), 6);
  assert.match(icons, /×8/);
  const out = html(ctx, `${RINGS} return ringsListHtml(rings)`);
  assert.match(out, /href="player\.html#P1"/);
  assert.match(out, /player-photo-xs/);
});

test("ringsMetaText: the years the rings cover", () => {
  const ctx = setup();
  assert.strictEqual(html(ctx, `${RINGS} return ringsMetaText(rings.columns)`), "Sleeper era · 2020 → 2022");
  assert.strictEqual(html(ctx, `return ringsMetaText([])`), "");
});

// ---- Where Podiums Come From --------------------------------------------------------------

test("podiumChartHtml: a bar per seed, as wide as its podiums are a share of the seasons, split into title / runner-up / third", () => {
  const ctx = setup();
  const out = html(ctx, `return podiumChartHtml(HistoryData.podiumsBySeed(ledger))`);
  assert.strictEqual(count(out, /class="pc-row"/g), 6);
  const seed1 = out.split('<div class="pc-row">')[1];
  assert.match(seed1, /Seed 1</);
  assert.match(seed1, /pc-bar" style="width:100\.00%"/, "3 podiums in 3 seasons fills the track");
  assert.deepStrictEqual([...seed1.matchAll(/pc-seg (\w+)" style="flex-grow:(\d)"/g)].map((m) => [m[1], m[2]]), [["title", "1"], ["second", "2"]]);
  assert.match(seed1, /pc-total">3</);
  const seed4 = out.split('<div class="pc-row">')[4];
  assert.match(seed4, /width:0\.00%/);
  assert.ok(!/pc-seg/.test(seed4), "no podiums, no segments");
});

test("podiumChartHtml: a legend and what the right-hand number is", () => {
  const ctx = setup();
  const out = html(ctx, `return podiumChartHtml(HistoryData.podiumsBySeed(ledger))`);
  for (const word of ["Title", "Runner-up", "Third", "Podiums out of 3"]) assert.ok(out.includes(word), word);
  assert.match(html(ctx, `return podiumChartHtml({ rows: [], seasons: 0 })`), /No champions crowned yet/);
});

// ---- the page, wired --------------------------------------------------------------------------

async function renderPage(ctx, mine) {
  runInLoadedContext(
    ctx,
    `
    SleeperAPI.getSeasonChain = async () => __chain;
    SleeperAPI.getPlayerDirectory = async () => ({});
    fetchJsonSafe = async () => __manual;
    DeepHistory.buildAll = async () => [];
    DeepHistory.computeStats = () => ({ managers: __managers });
    ${mine ? `MyTeam.set(${JSON.stringify(mine)});` : `MyTeam.clear();`}
    `
  );
  await ctx.renderHistory();
  await new Promise((r) => setTimeout(r, 0)); // the full-history part runs after the quick part
  await new Promise((r) => setTimeout(r, 0));
}

test("renderHistory: the quick sections fill from the season chain alone, and the full-history sections follow", async () => {
  const ctx = setup();
  await renderPage(ctx);
  const el = (id) => ctx.document.getElementById(id);
  assert.strictEqual(el("sb-title").textContent, "Trophy Case");
  assert.strictEqual(el("sb-eyebrow").textContent, "ALL-TIME");
  assert.strictEqual(el("sb-sub").textContent, "4 seasons on record");
  assert.match(el("hist-tiles").innerHTML, /hist-tile/);
  assert.match(el("titles-bar").innerHTML, /tb-seg/);
  assert.match(el("titles-meta").textContent, /3 seasons complete/);
  assert.strictEqual(count(el("trophy-room").innerHTML, /class="trophy-card/g), 4);
  assert.match(el("podium-chart").innerHTML, /pc-row/);
  assert.match(el("season-grid").innerHTML, /sg-table/);
  assert.match(el("career-list").innerHTML, /cr-row/);
  assert.match(el("career-controls").innerHTML, /data-sort="titles"/);
  assert.match(el("rings-list").innerHTML, /No champions crowned yet|rg-row/);
});

test("renderHistory: Championship Rings lists the top ten players, not every ringed player", async () => {
  const ctx = setup();
  runInLoadedContext(ctx, `HistoryData.computeRings = () => Array.from({ length: 13 }, (_, i) => ({ playerId: "P" + i, totalGamesStarted: 20 - i, rings: [{ season: 2020 }] }));`);
  await renderPage(ctx);
  assert.strictEqual(count(ctx.document.getElementById("rings-list").innerHTML, /<li class="rg-row/g), 10);
  assert.match(ctx.document.getElementById("rings-meta").textContent, /Sleeper era/);
});

test("renderHistory: your team gets its card filled in once the full history is in", async () => {
  const ctx = setup();
  await renderPage(ctx, "alice");
  const you = ctx.document.getElementById("hist-you").innerHTML;
  assert.match(you, /YOU · alice/);
  assert.match(you, /you-row/);
  const none = setup();
  await renderPage(none);
  assert.match(none.document.getElementById("hist-you").innerHTML, /data-myteam-open/);
});

test("renderHistory: nobody's seasons are lost when the full history cannot load — the quick sections stay, the rest say so", async () => {
  const ctx = setup();
  runInLoadedContext(ctx, `SleeperAPI.getSeasonChain = async () => __chain; SleeperAPI.getPlayerDirectory = async () => ({}); fetchJsonSafe = async () => __manual; DeepHistory.buildAll = async () => { throw new Error("offline"); };`);
  ctx.console = { ...console, error: () => {} };
  await ctx.renderHistory();
  await new Promise((r) => setTimeout(r, 0));
  const el = (id) => ctx.document.getElementById(id);
  assert.match(el("trophy-room").innerHTML, /trophy-card/);
  for (const id of ["season-grid", "career-list", "rings-list"]) assert.match(el(id).innerHTML, /Couldn't load this section/, id);
});

test("renderHistory: with no seasons from Sleeper it shows the error box", async () => {
  const ctx = setup();
  ctx.__chain = [];
  runInLoadedContext(ctx, `SleeperAPI.getSeasonChain = async () => []; SleeperAPI.getPlayerDirectory = async () => ({}); fetchJsonSafe = async () => ({ seasons: [] });`);
  const quiet = console.error;
  console.error = () => {};
  try {
    await ctx.renderHistory();
  } finally {
    console.error = quiet;
  }
  assert.match(ctx.document.getElementById("hist-error").textContent, /Couldn't load the league's seasons/);
  assert.strictEqual(ctx.document.getElementById("hist-error").style.display, "block");
  assert.strictEqual(ctx.document.getElementById("hist-error-wrap").style.display, "block");
});

test("renderHistory: an ESPN entry whose champion was never filled in does not reach the page", async () => {
  const ctx = setup();
  ctx.__manual.seasons.push({ year: 2018, champion: "REPLACE_WITH_NAME", standings: [] });
  await renderPage(ctx);
  assert.ok(!ctx.document.getElementById("trophy-room").innerHTML.includes("season.html#2018"));
  assert.strictEqual(ctx.document.getElementById("sb-sub").textContent, "4 seasons on record");
});

test("the Career Records controls: choosing a sort or a filter redraws the list, and the choice sticks to its pill", async () => {
  const ctx = setup();
  await renderPage(ctx);
  const controls = ctx.document.getElementById("career-controls");
  const click = (attr, value) => controls.onclick({ target: { closest: () => ({ getAttribute: (a) => (a === attr ? value : null) }) } });
  const order = () => [...ctx.document.getElementById("career-list").innerHTML.matchAll(/<li class="cr-row[^"]*" data-username="([^"]+)"/g)].map((m) => m[1]);

  assert.strictEqual(order()[0], "alice");
  click("data-sort", "winpct");
  assert.strictEqual(order()[0], "bob");
  assert.match(controls.innerHTML, /pill on" data-sort="winpct" aria-pressed="true"/);
  click("data-show", "active");
  assert.ok(!order().includes("gone"));
  assert.match(controls.innerHTML, /pill on" data-show="active"/);
  assert.match(controls.innerHTML, /pill on" data-sort="winpct"/, "changing the filter keeps the sort");
  click("data-show", "all");
  assert.ok(order().includes("gone"));
});

test("the 'Show all' buttons flip the phone list open and shut", async () => {
  const ctx = setup();
  await renderPage(ctx);
  runInLoadedContext(ctx, `CAREER_UI.expanded = false;`);
  const list = ctx.document.getElementById("career-list");
  list.onclick({ target: { closest: () => ({}) } });
  assert.strictEqual(runInLoadedContext(ctx, `CAREER_UI.expanded`), true);
  list.onclick({ target: { closest: () => ({}) } });
  assert.strictEqual(runInLoadedContext(ctx, `CAREER_UI.expanded`), false);
  const rings = ctx.document.getElementById("rings-list");
  rings.onclick({ target: { closest: () => null } }); // a click that is not on the button does nothing
  assert.strictEqual(runInLoadedContext(ctx, `RINGS_UI.expanded`), false);
  rings.onclick({ target: { closest: () => ({}) } });
  assert.strictEqual(runInLoadedContext(ctx, `RINGS_UI.expanded`), true);
  rings.onclick({ target: { closest: () => ({}) } });
  assert.strictEqual(runInLoadedContext(ctx, `RINGS_UI.expanded`), false, "a second tap closes it again");
});

// ---- the page's own files ----------------------------------------------------------------------

test("history.html: the sections come in the order Titles by Owner, Trophy Room, Every Season, Career Records, then Rings beside Podiums", () => {
  const page = read("history.html");
  const order = ["titles-panel", 'id="champions"', 'id="seasons"', 'id="career"', 'id="rings"', 'id="podiums"'].map((needle) => page.indexOf(needle));
  assert.ok(order.every((i) => i > 0), "every section is there");
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, "in that order");
  assert.match(page, /<body class="page-history">/);
});

test("history.html: jump-to chips point at sections that exist", () => {
  const page = read("history.html");
  const targets = [...page.matchAll(/<a href="#([a-z]+)">/g)].map((m) => m[1]);
  assert.deepStrictEqual(targets, ["champions", "seasons", "career", "rings", "podiums"]);
  for (const id of targets) assert.ok(page.includes(`id="${id}"`), id);
});

test("history.html: no headline or description copy from the mockups, no old section dividers, and no fact cards", () => {
  const page = read("history.html");
  for (const text of ["TELLS THE TITLE STORY", "ESPN era", "Won With", "Rings you can see", "Points Per Team", "Waiting List", "yard-divider"]) assert.ok(!page.includes(text), text);
  const script = read("js/history.js");
  for (const text of ["ESPN era", "Points per team", "Waiting list", "Eras and droughts"]) assert.ok(!script.toLowerCase().includes(text.toLowerCase()), text);
});

test("history.html: loads the data helper before the page script, and every script keeps its cache stamp", () => {
  const page = read("history.html");
  assert.ok(page.indexOf("js/history-data.js") > page.indexOf("js/manual-history.js"));
  assert.ok(page.indexOf("js/history-data.js") < page.indexOf("js/history.js"));
  assert.match(page, /js\/history-data\.js\?v=[0-9a-f]{10}/);
});

test("the styles: six trophy columns on desktop, one row per year on a phone, and the phone-only controls are hidden above it", () => {
  const css = read("css/styles.css");
  assert.match(css, /\.trophy-grid \{ display: grid; grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.trophy-grid \{ grid-template-columns: 1fr/);
  assert.match(css, /\.cr-more \{ display: none; \}/, "the Show all button is for phones only");
  assert.match(css, /\.cr-rows:not\(\.expanded\) \.cr-extra \{ display: none; \}/);
  assert.match(css, /\.rg-rows:not\(\.expanded\) \.rg-extra \{ display: none; \}/);
  assert.match(css, /\.bar\.has-tick::after \{[^}]*left: 50%/, ".500 is half way along");
});

test("the styles: the season squares use the site's colours — yellow champion, olive playoffs, teal-blue missed, outlines for the live season", () => {
  const css = read("css/styles.css");
  assert.match(css, /\.sq\.st-champion \{ background: var\(--good\)/);
  assert.match(css, /\.sq\.st-playoffs \{ background: var\(--pr-playoffs\)/);
  assert.match(css, /\.sq\.st-missed \{ background: var\(--pr-miss\)/);
  assert.match(css, /\.sq\.st-live-in \{[^}]*border: 2px solid var\(--good\)/);
  assert.match(css, /\.sq\.st-live-out \{[^}]*border: 2px solid var\(--bad\)/);
  assert.match(css, /\.bar > \.fill\.down \{ background: var\(--bad\)/);
});

test("the old History styles and the old Won-With cell are gone", () => {
  const css = read("css/styles.css");
  assert.ok(!/rings-won-with/.test(css));
  assert.ok(!/\.trophy-champion-name|\.trophy-team-name|\.trophy-year/.test(css));
});
