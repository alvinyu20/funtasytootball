/*
  The Rivalries page's markup (js/rivalries.js): the game log, the top card, the opponent chips, the league map,
  the streak cards and record lists, the career compare, and the phone's bottom sheet. The numbers behind them
  are tested in rivalries-data.test.js; this file checks that what is drawn matches what the numbers say.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const setup = () => loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "rivalries-data.js", "rivalries.js"]);

const raw = (aId, bId, aScore, bScore, season, week, isPlayoff) => ({ season: String(season), week, aUserId: aId, aScore, bUserId: bId, bScore, isPlayoff: !!isPlayoff });

function fakeStats(games, extraManagers = []) {
  return {
    managers: [
      { userId: "u1", username: "yulovesyou", teamName: "yulovesyou", seasons: [2023] },
      { userId: "u2", username: "hmart92", teamName: "hmart92", seasons: [2023] },
      ...extraManagers,
    ],
    pairGameLog: { "u1|u2": games },
  };
}

// A page state with the page's own builder, then the page's own render.
function page(stats, { me = "yulovesyou", currentIds = null, careers = "{}" } = {}) {
  const c = setup();
  c.__STATS__ = stats;
  c.__CUR__ = currentIds;
  runInLoadedContext(c, `RIV = buildRivalryState({ stats: __STATS__, currentIds: __CUR__, careers: ${careers}, me: ${JSON.stringify(me)} });`);
  return c;
}
const html = (c, id) => c.document.getElementById(id).innerHTML;
const count = (s, re) => (s.match(re) || []).length;

test("game log: the winning score carries the won class and the margin is signed from the first manager's side", () => {
  const c = page(fakeStats([raw("u1", "u2", 130.5, 98.2, 2023, 5)]));
  c.renderRivalry("u1", "u2");
  const log = html(c, "riv-log-panel");
  assert.ok(log.includes('<span class="riv-s won">130.5</span>'), "the winning score is marked");
  assert.ok(log.includes('<span class="riv-s">98.2</span>'), "the losing score is plain");
  assert.ok(log.includes('<td class="riv-mg good">+32.3</td>'), "a win is a plus and the good (yellow) color");
  assert.ok(!log.includes("<th>Result</th>"), "no column that repeats what the colors already say");
});

test("game log: a tie has no winner, no good or bad color, and the series shows it as a tie", () => {
  const c = page(fakeStats([raw("u1", "u2", 100, 100, 2023, 5)]));
  c.renderRivalry("u1", "u2");
  const log = html(c, "riv-log-panel");
  assert.strictEqual(count(log, /riv-s won/g), 0);
  assert.ok(log.includes('<td class="riv-mg">0.0</td>'));
  assert.ok(log.includes('<td class="riv-sr">0-0-1</td>'));
});

test("game log: whichever way round the game was stored, and whichever manager is picked first, the right score wins", () => {
  // stored with hmart92 as "a": the 110 belongs to yulovesyou
  const c = page(fakeStats([raw("u2", "u1", 90, 110, 2023, 1)]));
  c.renderRivalry("u1", "u2");
  let log = html(c, "riv-log-panel");
  assert.ok(log.includes('<span class="riv-s won">110.0</span><span class="riv-to"> to </span><span class="riv-s">90.0</span>'), "yulovesyou first, and winning");
  assert.ok(log.includes("+20.0"));
  c.renderRivalry("u2", "u1");
  log = html(c, "riv-log-panel");
  assert.ok(log.includes('<span class="riv-s">90.0</span><span class="riv-to"> to </span><span class="riv-s won">110.0</span>'), "flipped: hmart92 first, losing");
  assert.ok(log.includes('<td class="riv-mg bad">-20.0</td>'), "a loss is a minus and the bad (blue) color");
});

test("game log: a playoff row is marked and says so in the notes", () => {
  const c = page(fakeStats([raw("u1", "u2", 130, 100, 2023, 16, true), raw("u1", "u2", 120, 110, 2023, 3, false)]));
  c.renderRivalry("u1", "u2");
  const log = html(c, "riv-log-panel");
  assert.strictEqual(count(log, /<tr class="riv-po/g), 1);
  assert.ok(/<tr class="riv-po[^"]*">[\s\S]*?wk 16[\s\S]*?Playoff/.test(log), "the playoff row is the wk 16 one and its note says Playoff");
});

test("game log: each game gets its own correct styling, newest first, and the season's record sits on a season's first row only", () => {
  const c = page(
    fakeStats([
      raw("u1", "u2", 120, 100, 2023, 1), // yulovesyou wins
      raw("u1", "u2", 90, 115, 2023, 2), // hmart92 wins
    ])
  );
  c.renderRivalry("u1", "u2");
  const log = html(c, "riv-log-panel");
  assert.strictEqual(count(log, /riv-s won/g), 2, "one winning score per game");
  assert.ok(log.indexOf("wk 2") < log.indexOf("wk 1"), "the newer game is above the older");
  assert.strictEqual(count(log, /riv-yr-rec/g), 1, "the 2023 record is on the one row that starts the season");
  assert.strictEqual(count(log, /riv-cont/g), 1, "the other row is a continuation of it");
});

test("game log: long histories show a few meetings and a button for the rest; short ones have no button", () => {
  const many = Array.from({ length: 9 }, (_, i) => raw("u1", "u2", 100 + i, 90, 2020 + (i % 4), i + 1));
  const c = page(fakeStats(many));
  c.renderRivalry("u1", "u2");
  const log = html(c, "riv-log-panel");
  assert.strictEqual(count(log, /<tr class=/g), 9);
  assert.strictEqual(count(log, /riv-extra/g), 3, "the first six stay, the other three are the extra ones");
  assert.ok(log.includes("Show all 9 meetings"));
  const few = page(fakeStats(many.slice(0, 6)));
  few.renderRivalry("u1", "u2");
  assert.ok(!html(few, "riv-log-panel").includes("riv-more"), "six or fewer need no button");
  assert.strictEqual(count(html(few, "riv-log-panel"), /riv-extra/g), 0);
});

test("top card: your own name reads YOU, everyone else is four letters, and the page's copy has the jump-to id the sheet's copy lacks", () => {
  const c = page(fakeStats([raw("u1", "u2", 130, 100, 2023, 5)]));
  c.renderRivalry("u1", "u2");
  const hero = html(c, "riv-hero");
  assert.ok(hero.includes('<span>YOU</span> <span class="riv-vs">vs</span> <span>HMAR</span>'));
  assert.ok(hero.includes('id="riv-this"'));
  assert.ok(hero.includes('<span class="riv-record">1-0</span>'));
  const model = runInLoadedContext(c, 'rivalryModel("u1", "u2")');
  assert.ok(!runInLoadedContext(c, "heroHtml").call(null, model, { sheet: true }).includes("id="), "two copies of one id on the page would break the jump link");
});

test("top card: a pair that has never met says so, and the page still draws", () => {
  const c = page({ managers: fakeStats([]).managers, pairGameLog: {} });
  c.renderRivalry("u1", "u2");
  assert.ok(html(c, "riv-hero").includes("haven't played each other yet"));
  assert.strictEqual(html(c, "riv-log-panel"), "", "no log to show");
  assert.strictEqual(c.document.getElementById("riv-log-panel").style.display, "none");
  assert.strictEqual(c.document.getElementById("riv-compare-panel").style.display, "none");
});

test("renderRivalry: the same manager twice asks for two different ones and clears the lower blocks", () => {
  const c = page(fakeStats([raw("u1", "u2", 130, 100, 2023, 5)]));
  c.renderRivalry("u1", "u2");
  c.renderRivalry("u1", "u1");
  assert.ok(html(c, "riv-hero").includes("Pick two different managers."));
  assert.strictEqual(html(c, "riv-log-panel"), "");
  assert.strictEqual(html(c, "riv-compare-panel"), "");
});

test("names are escaped everywhere they are printed", () => {
  const evil = { userId: "u3", username: '<img src=x onerror="boom()">', teamName: "x", seasons: [2023] };
  const stats = fakeStats([raw("u1", "u2", 130, 100, 2023, 5)], [evil]);
  stats.pairGameLog["u1|u3"] = [raw("u1", "u3", 100, 90, 2023, 6), raw("u1", "u3", 100, 90, 2023, 7), raw("u1", "u3", 100, 90, 2023, 8)];
  const c = page(stats);
  c.renderRivalry("u3", "u1");
  c.drawLeagueSections();
  const everything = ["riv-face-a", "riv-face-b", "riv-chips", "riv-hero", "riv-log-panel", "riv-map", "riv-streaks"].map((id) => html(c, id)).join("");
  assert.ok(!everything.includes("<img"), "no raw tag from a username");
  assert.ok(everything.includes("&lt;img"), "it is printed as text instead");
});

test("opponent chips: your own is YOU, the open one is pressed, and the color says who leads", () => {
  const stats = fakeStats([raw("u1", "u2", 130, 100, 2023, 5), raw("u1", "u2", 120, 100, 2023, 6)]);
  const c = page(stats);
  c.renderRivalry("u2", "u1");
  const chips = html(c, "riv-chips");
  assert.strictEqual(count(chips, /<button/g), 1);
  assert.ok(chips.includes('<span class="rc-n">YOU</span><span class="rc-r">0-2</span>'), "hmart92's record against you");
  assert.ok(chips.includes("riv-chip trail sel"), "hmart92 trails and this chip is the open one");
  assert.ok(chips.includes('aria-pressed="true"'));
  c.renderRivalry("u1", "u2");
  assert.ok(html(c, "riv-chips").includes("riv-chip lead sel"));
});

test("opponent chips: someone with no games yet gets a plain sentence, not an empty row", () => {
  const stats = { managers: fakeStats([]).managers, pairGameLog: {} };
  const c = page(stats);
  c.renderRivalry("u1", "u2");
  assert.ok(html(c, "riv-chips").includes("hasn't played anyone yet"));
});

test("league map: every pair that has met is a button that opens that pair, the open one is marked, strangers are a dash", () => {
  const stats = fakeStats([raw("u1", "u2", 130, 100, 2023, 5), raw("u1", "u2", 120, 100, 2023, 6)], [{ userId: "u3", username: "caityb", teamName: "caityb", seasons: [2023] }]);
  stats.pairGameLog["u1|u3"] = [raw("u1", "u3", 100, 90, 2023, 7)]; // you have met caityb too, so your row has two buttons and only one is the open pair
  const c = page(stats);
  c.renderRivalry("u1", "u2");
  const map = html(c, "riv-map");
  assert.ok(map.includes('data-riv-a="u1" data-riv-b="u2" data-riv-src="map"'));
  assert.ok(map.includes('data-riv-a="u1" data-riv-b="u3" data-riv-src="map"'));
  assert.ok(map.includes('data-riv-a="u2" data-riv-b="u1" data-riv-src="map"'), "the other half of the same rivalry is also a button");
  assert.strictEqual(count(map, /rm-cell [a-z0-9 ]*sel/g), 1, "only the open pair, in the open direction, is marked");
  assert.strictEqual(count(map, /rm-cell none/g), 2, "hmart92 and caityb have never met: a dash each way");
  assert.strictEqual(count(map, /class="rm-self"/g), 3);
  assert.ok(map.includes("rm-cell b5 small") || map.includes("rm-cell b5"), "two meetings is a 100% cell, drawn as few meetings");
  assert.ok(map.includes("few meetings"), "the label that screen readers get says the sample is small");
});

test("league map: past managers are left out until the switch is on, and then they are labeled past", () => {
  const past = { userId: "u9", username: "oldtimer", teamName: "oldtimer", seasons: [2021] };
  const stats = fakeStats([raw("u1", "u2", 130, 100, 2023, 5)], [past]);
  stats.pairGameLog["u1|u9"] = [raw("u1", "u9", 100, 90, 2021, 1)];
  const c = page(stats, { currentIds: new Set(["u1", "u2"]) });
  c.renderRivalry("u1", "u2");
  assert.ok(!html(c, "riv-map").includes("oldtimer"));
  assert.strictEqual(c.document.getElementById("riv-past-wrap").style.display, "", "the switch is offered because someone is hidden");
  runInLoadedContext(c, "RIV.includePast = true;");
  c.drawMap();
  assert.ok(html(c, "riv-map").includes("oldtimer"));
  assert.ok(html(c, "riv-map").includes("rm-past"));
  const alone = page(fakeStats([raw("u1", "u2", 130, 100, 2023, 5)]), { currentIds: new Set(["u1", "u2"]) });
  alone.renderRivalry("u1", "u2");
  assert.strictEqual(alone.document.getElementById("riv-past-wrap").style.display, "none", "no switch when nobody is hidden");
});

test("league map legend: five bands and the few-meetings key, with the real minimum", () => {
  const c = page(fakeStats([]));
  const legend = runInLoadedContext(c, "mapLegendHtml()");
  assert.strictEqual(count(legend, /rm-sw b[1-5]/g), 5);
  assert.ok(legend.includes("Fewer than 5 meetings"));
});

test("streaks and record lists: your own rows are highlighted, and a row opens with you first", () => {
  // hmart92 has beaten you three straight; you have 9 meetings of 8-1 against caityb
  const stats = fakeStats([raw("u1", "u2", 90, 100, 2023, 1), raw("u1", "u2", 90, 100, 2023, 2), raw("u1", "u2", 90, 100, 2023, 3)], [{ userId: "u3", username: "caityb", teamName: "caityb", seasons: [2023] }]);
  stats.pairGameLog["u1|u3"] = Array.from({ length: 9 }, (_, i) => raw("u1", "u3", i < 8 ? 100 : 80, 90, 2023, i + 1));
  const c = page(stats);
  const streaks = runInLoadedContext(c, "streaksHtml()");
  assert.ok(streaks.includes("riv-streak mine"));
  assert.ok(streaks.includes('data-riv-a="u1" data-riv-b="u2"'), "the card for a rivalry you are in opens from your side even though hmart92 holds the streak");
  assert.ok(streaks.includes("hmart92 over yulovesyou") === true);
  const rows = runInLoadedContext(c, 'recordRowsHtml(RIV.records.lopsided, "lopsided")');
  assert.ok(rows.includes("riv-rr mine"));
  assert.ok(rows.includes("YOU over CAIT"));
  assert.ok(rows.includes('<span class="rr-v">8-1</span><span class="rr-s">89%</span>'));
  const blow = runInLoadedContext(c, 'recordRowsHtml(RIV.records.blowouts, "blowouts")');
  assert.ok(/<span class="rr-v">[\d.]+<\/span><span class="rr-s">2023 wk \d+<\/span>/.test(blow), "a margin and the game it came from");
});

test("streaks and record lists: an empty list says so in a sentence", () => {
  const c = page({ managers: fakeStats([]).managers, pairGameLog: {} });
  assert.ok(runInLoadedContext(c, "streaksHtml()").includes("No one is on a run of 3 or more"));
  assert.ok(runInLoadedContext(c, 'recordRowsHtml([], "even")').includes("Nothing yet."));
});

test("career compare: the leader of each row is marked on its own side, and the heading counts the rows", () => {
  const stats = fakeStats([raw("u1", "u2", 130, 100, 2023, 5)]);
  const c = setup();
  c.__STATS__ = stats;
  c.__OA__ = { titles: 5, seconds: 0, podiums: 6, trips: 9, poW: 12, poL: 5, poGames: 17, poPct: 70.6, regW: 80, regL: 55, regGames: 135, regPct: 59.3, avgFinish: 3.6 };
  c.__OB__ = { titles: 1, seconds: 2, podiums: 2, trips: 5, poW: 3, poL: 4, poGames: 7, poPct: 42.9, regW: 40, regL: 50, regGames: 90, regPct: 44.4, avgFinish: 6.2 };
  runInLoadedContext(c, 'RIV = buildRivalryState({ stats: __STATS__, currentIds: null, careers: { u1: RivalriesData.careerFacts(__OA__, 4), u2: RivalriesData.careerFacts(__OB__, 1) }, me: "yulovesyou" });');
  c.renderRivalry("u1", "u2");
  const cc = html(c, "riv-compare-panel");
  assert.strictEqual(count(cc, /riv-cc-row/g), 9);
  assert.strictEqual(count(cc, /cc-pill win-a/g), 9, "yulovesyou leads every row");
  assert.strictEqual(count(cc, /cc-pill win-b/g), 0);
  assert.ok(cc.includes("9 to 0 for YOU"));
  assert.ok(cc.includes("YOU +4"), "titles: 5 against 1");
  assert.ok(cc.includes("ESPN years included"));
  c.renderRivalry("u2", "u1");
  const flipped = html(c, "riv-compare-panel");
  assert.strictEqual(count(flipped, /cc-pill win-b/g), 9, "swap the sides and the winner moves to the other column");
  assert.ok(flipped.includes("9 to 0 for YOU"));
});

test("career compare: with no career data for a manager the block is left out instead of drawn empty", () => {
  const c = page(fakeStats([raw("u1", "u2", 130, 100, 2023, 5)]));
  c.renderRivalry("u1", "u2");
  assert.strictEqual(html(c, "riv-compare-panel"), "");
  assert.strictEqual(c.document.getElementById("riv-compare-panel").style.display, "none");
  assert.ok(c.document.getElementById("riv-cols").className.includes("riv-cols-one"), "the game log takes the whole width");
});

test("bottom sheet: opens with a copy of the top card, loads the pair behind it, and gives focus back to the cell on close", () => {
  const c = page(fakeStats([raw("u1", "u2", 130, 100, 2023, 5)]));
  const calls = [];
  c.document.body = { classList: { add: (x) => calls.push("add " + x), remove: (x) => calls.push("remove " + x) } };
  const sheet = c.document.getElementById("riv-sheet");
  sheet.hidden = true;
  const load = c.document.getElementById("riv-sheet-load");
  load.attrs = {};
  load.setAttribute = (k, v) => (load.attrs[k] = v);
  load.focus = () => calls.push("focus load");
  const opener = { focus: () => calls.push("focus cell") };
  c.openSheet("u1", "u2", opener);
  assert.strictEqual(sheet.hidden, false);
  assert.ok(html(c, "riv-sheet-body").includes("riv-hero"));
  assert.ok(!html(c, "riv-sheet-body").includes('id="riv-this"'), "the page's own card keeps that id");
  assert.deepStrictEqual([load.attrs["data-riv-a"], load.attrs["data-riv-b"]], ["u1", "u2"]);
  assert.deepStrictEqual(calls, ["add riv-sheet-open", "focus load"]);
  c.closeSheet();
  assert.strictEqual(sheet.hidden, true);
  assert.deepStrictEqual(calls.slice(2), ["remove riv-sheet-open", "focus cell"]);
  c.closeSheet(); // closing twice does nothing
  assert.strictEqual(calls.length, 4);
});
