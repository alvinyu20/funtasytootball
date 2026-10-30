/*
  The Rivalries page numbers (js/rivalries-data.js): one pair's series, the game log, the opponent chips,
  the league map, streaks and records, and the career compare. Run against the real file.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const setup = () => loadSiteModules(["rivalries-data.js"]);
const json = (c, code) => JSON.parse(runInLoadedContext(c, `JSON.stringify(${code})`));

// A game as the raw pairGameLog stores it: whichever id sorts first is "a".
const game = (aId, bId, aScore, bScore, season, week, isPlayoff) => ({ aUserId: aId, bUserId: bId, aScore, bScore, season: String(season), week, isPlayoff: !!isPlayoff });
const managers = [
  { userId: "u1", username: "alvin", seasons: [1, 2, 3] },
  { userId: "u2", username: "beth", seasons: [1, 2, 3] },
  { userId: "u3", username: "carl", seasons: [1, 2] },
  { userId: "u4", username: "dana", seasons: [1] },
  { userId: "u5", username: "ghost", seasons: [1] }, // not in this year's league
];
const current = ["u1", "u2", "u3", "u4"];

function withGlobals(c, vars) {
  Object.entries(vars).forEach(([k, v]) => (c[k] = v));
  return c;
}

test("abbreviations: four letters, a three-word CamelCase name is its initials, digits are ignored", () => {
  const c = setup();
  c.__N__ = ["yulovesyou", "YuWillLose", "JoeSifBoreDough", "hmart92", "LyDaniel", "jspar279879", "caityb", "Pathieu"];
  const a = json(c, "RivalriesData.abbreviations(__N__)");
  assert.strictEqual(a.yulovesyou, "YULO");
  assert.strictEqual(a.YuWillLose, "YWL");
  assert.strictEqual(a.JoeSifBoreDough, "JOES");
  assert.strictEqual(a.hmart92, "HMAR");
  assert.strictEqual(a.LyDaniel, "LYDA");
  assert.strictEqual(a.jspar279879, "JSPA");
  assert.strictEqual(a.caityb, "CAIT");
  assert.strictEqual(a.Pathieu, "PATH");
});

test("abbreviations: two names that start the same get longer until they differ, and the answer never depends on order", () => {
  const c = setup();
  c.__N__ = ["mayshisha", "maysonly", "solo"];
  const a = json(c, "RivalriesData.abbreviations(__N__)");
  assert.notStrictEqual(a.mayshisha, a.maysonly);
  assert.strictEqual(a.solo, "SOLO");
  assert.ok(a.mayshisha.startsWith("MAYS") && a.maysonly.startsWith("MAYS"));
  c.__N__ = ["solo", "maysonly", "mayshisha"];
  assert.deepStrictEqual(json(c, "RivalriesData.abbreviations(__N__)"), a);
  // identical letters all the way down still end up different
  c.__N__ = ["abc1", "abc2"];
  const same = json(c, "RivalriesData.abbreviations(__N__)");
  assert.notStrictEqual(same.abc1, same.abc2);
});

test("bandOf: the five bands go by the rounded whole percent, so a printed 55% is colored as 55%", () => {
  const c = setup();
  const band = (p) => runInLoadedContext(c, `RivalriesData.bandOf(${p})`);
  assert.deepStrictEqual([100, 70, 69.5, 69.4, 55, 54.5, 54.4, 45, 44.5, 44.4, 30, 29.5, 29.4, 0].map(band), ["b5", "b5", "b5", "b4", "b4", "b4", "b3", "b3", "b3", "b2", "b2", "b2", "b1", "b1"]);
  assert.strictEqual(runInLoadedContext(c, "RivalriesData.bandOf(null)"), "none");
});

test("fmt1 / signed1: one decimal with halves rounded up, so 90.05 prints 90.1 (a bare toFixed would say 90.0)", () => {
  const c = setup();
  const f = (x) => runInLoadedContext(c, `RivalriesData.fmt1(${x})`);
  assert.strictEqual(f(90.05), "90.1");
  assert.strictEqual(f(133.5), "133.5");
  assert.strictEqual(f(0.04), "0.0");
  const s = (x) => runInLoadedContext(c, `RivalriesData.signed1(${x})`);
  assert.deepStrictEqual([s(1.44), s(-30.05), s(0), s(0.01)], ["+1.4", "-30.1", "0.0", "0.0"]);
});

test("margins: a half-point margin made by subtracting two scores rounds up (122.82 - 32.77 is 90.04999999999998 in floating point, and prints 90.1)", () => {
  const c = setup();
  c.__LOG__ = { "u1|u2": [game("u1", "u2", 122.82, 32.77, 2024, 1), game("u1", "u2", 32.77, 122.82, 2024, 2)] };
  const g = json(c, 'RivalriesData.gamesBetween(__LOG__, "u1", "u2")');
  assert.deepStrictEqual(g.map((x) => x.diff), [90.1, -90.1]);
  const rows = json(c, 'RivalriesData.gameLog(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))');
  assert.deepStrictEqual(rows.map((x) => x.diff), [-90.1, 90.1]);
  assert.strictEqual(runInLoadedContext(c, "RivalriesData.signed1(122.82 - 32.77)"), "+90.1");
});

test("gamesBetween: every game is from the first manager's side whichever way it was stored, oldest first", () => {
  const c = setup();
  c.__LOG__ = {
    "u1|u2": [game("u1", "u2", 100, 90, 2022, 5), game("u2", "u1", 120, 80, 2021, 9), game("u1", "u2", 70.25, 70.25, 2021, 2)],
  };
  const g = json(c, 'RivalriesData.gamesBetween(__LOG__, "u1", "u2")');
  assert.deepStrictEqual(g.map((x) => [x.season, x.week, x.a, x.b, x.result]), [[2021, 2, 70.25, 70.25, "T"], [2021, 9, 80, 120, "L"], [2022, 5, 100, 90, "W"]]);
  const flipped = json(c, 'RivalriesData.gamesBetween(__LOG__, "u2", "u1")');
  assert.deepStrictEqual(flipped.map((x) => x.result), ["T", "W", "L"], "from beth's side the results turn around");
  assert.strictEqual(flipped[1].diff, 40);
  assert.deepStrictEqual(json(c, 'RivalriesData.gamesBetween(__LOG__, "u1", "u9")'), []);
});

// alvin 7-4 beth over 11 meetings, one playoff win, closest 3.7, 2020 to 2026
function sevenFour() {
  const c = setup();
  const rows = [
    [2020, 7, 167.5, 117.9, 0], [2021, 5, 114.8, 111.1, 0], [2021, 14, 109.3, 134.6, 0], [2022, 5, 116.9, 148.2, 0], [2022, 14, 108.1, 97.1, 0],
    [2023, 5, 123.8, 111.1, 0], [2023, 14, 156.8, 145.7, 0], [2024, 7, 129.3, 113.0, 0], [2025, 9, 151.7, 193.2, 0], [2025, 17, 151.3, 112.6, 1], [2026, 3, 110.1, 140.2, 0],
  ];
  c.__LOG__ = { "u1|u2": rows.map(([y, w, a, b, po]) => game("u1", "u2", a, b, y, w, po)) };
  return c;
}

test("summarize: the record, win rate, who leads, playoffs, averages, and the closest and biggest game", () => {
  const c = sevenFour();
  const s = json(c, 'RivalriesData.summarize(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))');
  assert.strictEqual(s.record, "7-4");
  assert.strictEqual(s.n, 11);
  assert.strictEqual(Math.round(s.pct), 64);
  assert.strictEqual(s.leader, "a");
  assert.strictEqual(s.lead, 3);
  assert.deepStrictEqual([s.playoffs.w, s.playoffs.l, s.playoffs.n], [1, 0, 1]);
  assert.deepStrictEqual([s.firstSeason, s.lastSeason], [2020, 2026]);
  assert.strictEqual(Math.round(s.avgA * 10) / 10, 130.9);
  assert.strictEqual(Math.round(s.avgB * 10) / 10, 129.5);
  assert.strictEqual(Math.round(s.avgMargin * 10) / 10, 1.4);
  assert.deepStrictEqual([s.closest.margin, s.closest.season, s.closest.week], [3.7, 2021, 5]);
  assert.deepStrictEqual([s.blowout.margin, s.blowout.season, s.blowout.week], [49.6, 2020, 7]);
  assert.strictEqual(s.strip.map((x) => x.result).join(""), "WWLLWWWWLWL");
  assert.strictEqual(s.strip.filter((x) => x.isPlayoff).length, 1);
});

test("summarize: seen from the other side every number turns around, and a tie is neither a win nor a loss", () => {
  const c = sevenFour();
  const s = json(c, 'RivalriesData.summarize(RivalriesData.gamesBetween(__LOG__, "u2", "u1"))');
  assert.strictEqual(s.record, "4-7");
  assert.strictEqual(s.leader, "b");
  c.__LOG__ = { "u1|u2": [game("u1", "u2", 100, 90, 2024, 1), game("u1", "u2", 90, 100, 2024, 2), game("u1", "u2", 95, 95, 2024, 3)] };
  const t = json(c, 'RivalriesData.summarize(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))');
  assert.strictEqual(t.record, "1-1-1");
  assert.strictEqual(t.leader, null);
  assert.strictEqual(Math.round(t.pct), 33);
  assert.deepStrictEqual([t.closest.margin, t.closest.week], [0, 3]);
});

test("summarize: two games tied for the closest or the biggest name the newer one", () => {
  const c = setup();
  c.__LOG__ = { "u1|u2": [game("u1", "u2", 100, 90, 2021, 1), game("u1", "u2", 100, 90, 2023, 4), game("u1", "u2", 100, 50, 2022, 2), game("u1", "u2", 140, 90, 2024, 6)] };
  const s = json(c, 'RivalriesData.summarize(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))');
  assert.deepStrictEqual([s.closest.season, s.closest.week], [2023, 4]);
  assert.deepStrictEqual([s.blowout.season, s.blowout.week], [2024, 6]);
  assert.deepStrictEqual(json(c, "RivalriesData.summarize([])").record, "0-0");
});

test("seriesLines: the leader's name and win rate; a level series says so; one meeting is singular", () => {
  const c = sevenFour();
  c.__S__ = json(c, 'RivalriesData.summarize(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))');
  assert.deepStrictEqual(json(c, 'RivalriesData.seriesLines(__S__, "alvin", "beth")'), { lead: "alvin leads the series by 3.", detail: "11 meetings, 64% win rate" });
  c.__S__ = json(c, 'RivalriesData.summarize(RivalriesData.gamesBetween(__LOG__, "u2", "u1"))');
  assert.deepStrictEqual(json(c, 'RivalriesData.seriesLines(__S__, "beth", "alvin")'), { lead: "alvin leads the series by 3.", detail: "11 meetings, 64% win rate" }, "the leader's rate, whoever is listed first");
  c.__LOG__ = { "u1|u2": [game("u1", "u2", 100, 90, 2024, 1), game("u1", "u2", 90, 100, 2024, 2)] };
  c.__S__ = json(c, 'RivalriesData.summarize(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))');
  assert.strictEqual(json(c, 'RivalriesData.seriesLines(__S__, "alvin", "beth")').lead, "The series is level.");
  c.__LOG__ = { "u1|u2": [game("u1", "u2", 100, 90, 2024, 1)] };
  c.__S__ = json(c, 'RivalriesData.summarize(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))');
  assert.strictEqual(json(c, 'RivalriesData.seriesLines(__S__, "alvin", "beth")').detail, "1 meeting, 100% win rate");
});

test("rangeText: a span of years, or one year on its own", () => {
  const c = setup();
  assert.strictEqual(runInLoadedContext(c, "RivalriesData.rangeText(2020, 2026)"), "2020 to 2026");
  assert.strictEqual(runInLoadedContext(c, "RivalriesData.rangeText(2024, 2024)"), "2024");
  assert.strictEqual(runInLoadedContext(c, "RivalriesData.rangeText(null, null)"), "");
});

test("gameLog: newest first, with the series after each game, the season's record on its first row, and the notes", () => {
  const c = sevenFour();
  const rows = json(c, 'RivalriesData.gameLog(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))');
  assert.strictEqual(rows.length, 11);
  assert.deepStrictEqual([rows[0].season, rows[0].week, rows[0].seriesAfter], [2026, 3, "7-4"]);
  assert.deepStrictEqual(rows.map((r) => r.seriesAfter), ["7-4", "7-3", "6-3", "6-2", "5-2", "4-2", "3-2", "2-2", "2-1", "2-0", "1-0"]);
  // the season record, only on a season's first (newest) row
  assert.deepStrictEqual(rows.filter((r) => r.firstOfSeason).map((r) => `${r.season} ${r.seasonRecord}`), ["2026 0-1", "2025 1-1", "2024 1-0", "2023 2-0", "2022 1-1", "2021 1-1", "2020 1-0"]);
  assert.strictEqual(rows[1].firstOfSeason, true, "2025's newest game, wk 17");
  assert.strictEqual(rows[2].firstOfSeason, false, "2025's older game carries no season record");
  // notes: the playoff game, the closest game, the biggest blowout
  const notes = (season, week) => rows.find((r) => r.season === season && r.week === week).notes;
  assert.deepStrictEqual(notes(2025, 17), ["Playoff"]);
  assert.deepStrictEqual(notes(2021, 5), ["Closest"]);
  assert.deepStrictEqual(notes(2020, 7), ["Biggest blowout"]);
  assert.deepStrictEqual(notes(2024, 7), []);
});

test("gameLog: the closest and the biggest are only called out when they are different games", () => {
  const c = setup();
  c.__LOG__ = { "u1|u2": [game("u1", "u2", 100, 90, 2024, 1)] };
  assert.deepStrictEqual(json(c, 'RivalriesData.gameLog(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))')[0].notes, []);
  c.__LOG__ = { "u1|u2": [game("u1", "u2", 100, 90, 2024, 1), game("u1", "u2", 80, 90, 2024, 2, true)] };
  const r = json(c, 'RivalriesData.gameLog(RivalriesData.gamesBetween(__LOG__, "u1", "u2"))');
  assert.deepStrictEqual(r.map((x) => x.notes), [["Playoff"], []], "equal margins: neither is special");
  assert.deepStrictEqual(json(c, "RivalriesData.gameLog([])"), []);
});

test("opponentChips: the first manager's record against each opponent, most-met first, lead / trail / level by color", () => {
  const c = setup();
  c.__LOG__ = {
    "u1|u2": [game("u1", "u2", 100, 90, 2022, 1), game("u1", "u2", 100, 90, 2022, 2), game("u2", "u1", 100, 90, 2022, 3)],
    "u1|u3": [game("u1", "u3", 90, 100, 2022, 4)],
    "u1|u4": [game("u1", "u4", 90, 100, 2022, 5), game("u1", "u4", 100, 90, 2022, 6)],
    "u1|u5": [game("u1", "u5", 100, 90, 2022, 7)],
    "u2|u3": [game("u2", "u3", 100, 90, 2022, 8)],
  };
  withGlobals(c, { __M__: managers, __CUR__: new Set(current) });
  const chips = json(c, 'RivalriesData.opponentChips(__LOG__, __M__, "u1", { currentIds: __CUR__ })');
  assert.deepStrictEqual(chips.map((x) => `${x.name} ${x.record} ${x.tone}`), ["beth 2-1 lead", "dana 1-1 even", "carl 0-1 trail"]);
  assert.deepStrictEqual(chips.map((x) => x.abbr), ["BETH", "DANA", "CARL"]);
  const withPast = json(c, 'RivalriesData.opponentChips(__LOG__, __M__, "u1", { currentIds: __CUR__, selectedB: "u5" })');
  assert.ok(withPast.some((x) => x.name === "ghost"), "a past manager that is picked still shows, so the chip row never loses the selection");
  assert.deepStrictEqual(json(c, 'RivalriesData.opponentChips(__LOG__, __M__, "u4", { currentIds: __CUR__ })').map((x) => x.name), ["alvin"]);
});

function mapFixture() {
  const c = setup();
  const many = [];
  for (let i = 0; i < 6; i++) many.push(game("u1", "u2", 100 + i, 90, 2020 + i, 1)); // alvin 6-0 beth
  c.__LOG__ = {
    "u1|u2": many,
    "u1|u3": [game("u1", "u3", 90, 100, 2022, 1), game("u1", "u3", 100, 90, 2023, 1)],
    "u1|u5": [game("u1", "u5", 100, 90, 2021, 1)],
    "u2|u3": [game("u2", "u3", 100, 90, 2022, 2), game("u2", "u3", 100, 90, 2022, 3), game("u2", "u3", 100, 90, 2022, 4), game("u2", "u3", 90, 100, 2022, 5), game("u2", "u3", 100, 90, 2022, 6)],
  };
  withGlobals(c, { __M__: managers, __CUR__: new Set(current) });
  return c;
}

test("leagueMap: you first, then the others longest-tenured first; past managers only when asked, and always last", () => {
  const c = mapFixture();
  const off = json(c, 'RivalriesData.leagueMap(__LOG__, __M__, { currentIds: __CUR__, meId: "u3", includePast: false })');
  assert.deepStrictEqual(off.rows.map((r) => r.name), ["carl", "alvin", "beth", "dana"], "carl is you, so first; then alvin and beth (3 seasons, alphabetical), dana (1)");
  assert.deepStrictEqual(off.cols.map((x) => x.name), off.rows.map((r) => r.name), "columns are in the same order as rows");
  assert.strictEqual(off.cols[0].isMe, true);
  assert.strictEqual(off.pastCount, 1);
  const on = json(c, 'RivalriesData.leagueMap(__LOG__, __M__, { currentIds: __CUR__, meId: "u3", includePast: true })');
  assert.deepStrictEqual(on.rows.map((r) => r.name), ["carl", "alvin", "beth", "dana", "ghost"]);
  assert.strictEqual(on.cols[4].past, true);
  assert.strictEqual(on.rows[0].cells.length, 5);
});

test("leagueMap: a cell is the row manager's record, win rate and band; the diagonal is blank; fewer than 5 meetings is flagged; no meetings is empty", () => {
  const c = mapFixture();
  const m = json(c, 'RivalriesData.leagueMap(__LOG__, __M__, { currentIds: __CUR__, meId: "u1", includePast: false })');
  const row = (name) => m.rows.find((r) => r.name === name);
  const cell = (r, c2) => row(r).cells[m.cols.findIndex((x) => x.name === c2)];
  assert.strictEqual(cell("alvin", "alvin").self, true);
  const ab = cell("alvin", "beth");
  assert.deepStrictEqual([ab.record, ab.pctText, ab.band, ab.small, ab.n], ["6-0", "100%", "b5", false, 6]);
  const ba = cell("beth", "alvin");
  assert.deepStrictEqual([ba.record, ba.pctText, ba.band], ["0-6", "0%", "b1"], "the same series from the other side");
  const ac = cell("alvin", "carl");
  assert.deepStrictEqual([ac.record, ac.pctText, ac.band, ac.small], ["1-1", "50%", "b3", true]);
  const bc = cell("beth", "carl");
  assert.deepStrictEqual([bc.n, bc.record, bc.small], [5, "4-1", false], "exactly 5 meetings is enough to draw a solid edge");
  const ad = cell("alvin", "dana");
  assert.deepStrictEqual([ad.n, ad.record, ad.band, ad.small], [0, "", "none", false]);
});

test("leagueMap: the ALL column counts every game against every manager there has been, past ones too, even when they are hidden", () => {
  const c = mapFixture();
  const off = json(c, 'RivalriesData.leagueMap(__LOG__, __M__, { currentIds: __CUR__, meId: "u1", includePast: false })');
  const all = (name) => off.rows.find((r) => r.name === name).all.record;
  assert.strictEqual(all("alvin"), "8-1", "6-0 vs beth, 1-1 vs carl and 1-0 vs the hidden past manager");
  assert.strictEqual(all("beth"), "4-7", "0-6 vs alvin, 4-1 vs carl");
  assert.strictEqual(all("carl"), "2-5");
  assert.strictEqual(all("dana"), "0-0");
  assert.strictEqual(off.allLabel, "ALL 4", "one fewer than the managers there have ever been");
  const on = json(c, 'RivalriesData.leagueMap(__LOG__, __M__, { currentIds: __CUR__, meId: "u1", includePast: true })');
  assert.strictEqual(on.rows.find((r) => r.name === "alvin").all.record, "8-1", "switching past managers on does not change anyone's total");
  const ghost = on.rows.find((r) => r.name === "ghost");
  assert.strictEqual(ghost.all.record, "0-1");
  assert.strictEqual(ghost.past, true);
});

test("currentStreaks: the straight wins the newest meeting is part of, longest first, current managers only, short runs and a tied finish left out", () => {
  const c = setup();
  const run = (a, b, winners, startYear) => winners.map((w, i) => (w === a ? game(a, b, 100, 90, startYear, i + 1) : game(a, b, 90, 100, startYear, i + 1)));
  c.__LOG__ = {
    "u1|u2": run("u1", "u2", ["u2", "u1", "u1", "u1", "u1"], 2022), // alvin has won 4 straight, began wk 2
    "u1|u3": run("u1", "u3", ["u1", "u3", "u3", "u3"], 2023), // carl 3 straight, began wk 2
    "u1|u4": run("u1", "u4", ["u4", "u4", "u1", "u1"], 2023), // only 2: too short
    "u2|u3": [...run("u2", "u3", ["u2", "u2", "u2", "u2", "u2"], 2024).slice(0, 4), game("u2", "u3", 95, 95, 2024, 5)], // the newest game was a tie: the run is over
    "u1|u5": run("u1", "u5", ["u1", "u1", "u1", "u1", "u1", "u1"], 2021), // a past manager: not shown
    "u3|u4": [1, 2, 3, 4].map((w) => game("u3", "u4", 100, 100, 2025, w)), // four ties in a row is nobody's run
  };
  withGlobals(c, { __M__: managers, __CUR__: new Set(current) });
  const s = json(c, "RivalriesData.currentStreaks(__LOG__, __M__, { currentIds: __CUR__ })");
  assert.deepStrictEqual(s.map((x) => `${x.holder} over ${x.other} ${x.length} since ${x.startSeason} wk ${x.startWeek}`), ["alvin over beth 4 since 2022 wk 2", "carl over alvin 3 since 2023 wk 2"]);
  assert.strictEqual(s[0].holderId, "u1");
  assert.strictEqual(json(c, "RivalriesData.currentStreaks(__LOG__, __M__, { currentIds: __CUR__, limit: 1 })").length, 1);
  assert.strictEqual(json(c, "RivalriesData.currentStreaks(__LOG__, __M__, { currentIds: __CUR__, minLength: 2 })").length, 3);
});

test("currentStreaks: equal runs go to the one that began most recently, then by name, the same every visit", () => {
  const c = setup();
  const wins = (a, b, year, n) => Array.from({ length: n }, (_, i) => game(a, b, 100, 90, year, i + 1));
  c.__LOG__ = { "u1|u2": wins("u1", "u2", 2021, 3), "u3|u4": wins("u3", "u4", 2025, 3), "u1|u3": wins("u3", "u1", 2025, 3) };
  withGlobals(c, { __M__: managers, __CUR__: new Set(current) });
  const names = () => json(c, "RivalriesData.currentStreaks(__LOG__, __M__, { currentIds: __CUR__ })").map((x) => `${x.holder}>${x.other}`);
  assert.deepStrictEqual(names(), ["carl>alvin", "carl>dana", "alvin>beth"]);
  assert.deepStrictEqual(names(), names());
});

test("pairRecords: lopsided and even only count pairs with 8+ meetings; blowouts are single games; all current managers only", () => {
  const c = setup();
  const series = (a, b, results, year) => results.map((r, i) => (r === "a" ? game(a, b, 100 + i, 90, year, i + 1) : game(a, b, 90, 100 + i, year, i + 1)));
  c.__LOG__ = {
    "u1|u2": series("u1", "u2", ["a", "a", "a", "a", "a", "a", "a", "a", "a", "b"], 2022), // 9-1: 90%
    "u1|u3": series("u1", "u3", ["a", "b", "a", "b", "a", "b", "a", "b"], 2022), // 4-4
    "u2|u3": series("u2", "u3", ["b", "b", "b", "b", "b", "b", "b"], 2022), // only 7 meetings: out of the first two lists
    "u2|u4": [game("u2", "u4", 500, 10, 2023, 1)], // one enormous win from a pair that has barely met: still a blowout
    "u3|u4": series("u3", "u4", ["a", "a", "a", "a", "a", "a", "a", "b", "b"], 2022), // 7-2: 78%
    "u1|u5": series("u1", "u5", ["a", "a", "a", "a", "a", "a", "a", "a", "a", "a"], 2022), // a past manager
  };
  withGlobals(c, { __M__: managers, __CUR__: new Set(current) });
  const r = json(c, "RivalriesData.pairRecords(__LOG__, __M__, { currentIds: __CUR__ })");
  assert.deepStrictEqual(r.lopsided.map((x) => `${x.a}>${x.b} ${x.record} ${x.pct}%`), ["alvin>beth 9-1 90%", "carl>dana 7-2 78%"]);
  assert.deepStrictEqual(r.even.map((x) => `${x.a} vs ${x.b} ${x.record}`), ["alvin vs carl 4-4", "carl vs dana 7-2", "alvin vs beth 9-1"]);
  assert.strictEqual(r.even[0].gap, 0);
  assert.strictEqual(r.blowouts[0].a, "beth", "the largest margin is first");
  assert.strictEqual(r.blowouts[0].margin, 490);
  assert.ok(r.blowouts.every((x) => x.a !== "ghost" && x.b !== "ghost"), "the past manager's games are not in any list");
  assert.strictEqual(json(c, "RivalriesData.pairRecords(__LOG__, __M__, { currentIds: __CUR__, limit: 2 })").blowouts.length, 2);
});

test("pairRecords: the even list reads alphabetically, and the record is told from the side of whoever is named first", () => {
  const c = setup();
  // the ids sort the other way round from the names: u1 is zed, u2 is amy, so the stored "a" side is zed
  const ms = [{ userId: "u1", username: "zed" }, { userId: "u2", username: "amy" }];
  const games = [[100, 90], [100, 90], [100, 90], [90, 100], [90, 100], [90, 100], [90, 100], [90, 100]].map(([a, b], i) => game("u1", "u2", a, b, 2022, i + 1));
  c.__LOG__ = { "u1|u2": games }; // zed 3-5 amy
  withGlobals(c, { __M__: ms, __CUR__: new Set(["u1", "u2"]) });
  const r = json(c, "RivalriesData.pairRecords(__LOG__, __M__, { currentIds: __CUR__ })");
  assert.deepStrictEqual([r.even[0].a, r.even[0].b, r.even[0].record, r.even[0].aId], ["amy", "zed", "5-3", "u2"], "amy is named first, so 5-3 is amy's record");
  assert.deepStrictEqual([r.lopsided[0].a, r.lopsided[0].b, r.lopsided[0].record], ["amy", "zed", "5-3"]);
});

test("pairRecords: lopsided ties on win rate go to more meetings; even ties on the gap go to more meetings; names settle the rest", () => {
  const c = setup();
  const series = (a, b, wonByA, total) => Array.from({ length: total }, (_, i) => (i < wonByA ? game(a, b, 100, 90, 2022, i + 1) : game(a, b, 90, 100, 2022, i + 1)));
  c.__LOG__ = { "u1|u2": series("u1", "u2", 8, 10), "u3|u4": series("u3", "u4", 4, 5).concat(series("u3", "u4", 4, 5).map((g) => ({ ...g, week: g.week + 10 }))) };
  withGlobals(c, { __M__: managers, __CUR__: new Set(current) });
  const r = json(c, "RivalriesData.pairRecords(__LOG__, __M__, { currentIds: __CUR__ })");
  assert.deepStrictEqual(r.lopsided.map((x) => x.meetings), [10, 10], "both pairs are 80%, both have met 10 times; name order decides");
  assert.deepStrictEqual(r.lopsided.map((x) => x.a), ["alvin", "carl"]);
});

test("leagueSummary: the games, the years, and the line under the heading", () => {
  const c = mapFixture();
  const s = json(c, "RivalriesData.leagueSummary(__LOG__)");
  assert.strictEqual(s.games, 6 + 2 + 1 + 5);
  assert.deepStrictEqual([s.first, s.last], [2020, 2025]);
  assert.strictEqual(s.text, "14 games, 2020 to 2025, playoffs included");
  assert.strictEqual(json(c, "RivalriesData.leagueSummary({})").text, "");
});

// An owner as HistoryData.buildOwners gives it.
const owner = (o) => ({ titles: 0, seconds: 0, thirds: 0, podiums: 0, trips: 0, poW: 0, poL: 0, poT: 0, poGames: 0, poPct: 0, regW: 0, regL: 0, regT: 0, regGames: 0, regPct: 0, avgFinish: null, ...o });

test("careerFacts: the counts and rates the compare uses; a rate with nothing behind it is null", () => {
  const c = setup();
  c.__O__ = owner({ titles: 5, seconds: 0, podiums: 6, trips: 9, poW: 12, poL: 5, poGames: 17, poPct: 70.588, regW: 80, regL: 55, regGames: 135, regPct: 59.26, avgFinish: 3.57 });
  const f = json(c, "RivalriesData.careerFacts(__O__, 5)");
  assert.deepStrictEqual([f.titles, f.finalsText, f.finalsPct, f.byes, f.top3, f.trips, f.avgFinish], [5, "5-0", 100, 5, 6, 9, 3.57]);
  assert.strictEqual(Math.round(f.overallPct * 10) / 10, Math.round(((80 + 12) / (135 + 17)) * 1000) / 10);
  c.__O__ = owner({});
  const none = json(c, "RivalriesData.careerFacts(__O__, undefined)");
  assert.deepStrictEqual([none.finalsText, none.finalsPct, none.poPct, none.regPct, none.overallPct, none.avgFinish, none.byes], ["\u2013", null, null, null, null, null, 0]);
  assert.strictEqual(runInLoadedContext(c, "RivalriesData.careerFacts(null, 0)"), null);
});

// byes come from the manager, not the owner: 5 for the first side and 3 for the second unless told otherwise
function compare(a, b, byesA = 5, byesB = 3) {
  const c = setup();
  c.__A__ = a;
  c.__B__ = b;
  return json(c, `RivalriesData.careerRows(RivalriesData.careerFacts(__A__, ${byesA}), RivalriesData.careerFacts(__B__, ${byesB}), "YOU", "EVAN")`);
}

test("careerRows: nine rows; the bigger number leads, the gap is written out, and the summary counts rows each side leads", () => {
  const r = compare(
    owner({ titles: 5, seconds: 0, podiums: 6, trips: 9, poW: 12, poL: 5, poGames: 17, poPct: 70.6, regW: 80, regL: 55, regGames: 135, regPct: 59.4, avgFinish: 3.6 }),
    owner({ titles: 3, seconds: 4, podiums: 5, trips: 8, poW: 14, poL: 5, poGames: 19, poPct: 73.7, regW: 77, regL: 58, regGames: 135, regPct: 57.0, avgFinish: 4.5 })
  );
  assert.deepStrictEqual(r.rows.map((x) => x.label), ["Titles", "Champ games", "Playoff win rate", "Playoff appearances", "First-round byes", "Reg. season win rate", "Overall win rate", "Top-3 finishes", "Average finish"]);
  const by = (label) => r.rows.find((x) => x.label === label);
  assert.deepStrictEqual([by("Titles").winner, by("Titles").gap, by("Titles").aText, by("Titles").bText], ["a", "YOU +2", "5", "3"]);
  assert.deepStrictEqual([by("Champ games").winner, by("Champ games").gap, by("Champ games").aText, by("Champ games").bText], ["a", "YOU never lost one", "5-0", "3-4"]);
  assert.deepStrictEqual([by("Playoff win rate").winner, by("Playoff win rate").gap], ["b", "EVAN +3.1 pts"]);
  assert.deepStrictEqual([by("Playoff appearances").gap, by("First-round byes").gap, by("Top-3 finishes").gap], ["YOU +1", "YOU +2", "YOU +1"]);
  assert.deepStrictEqual([by("Reg. season win rate").winner, by("Reg. season win rate").gap], ["a", "YOU +2.4 pts"]);
  assert.deepStrictEqual([by("Average finish").winner, by("Average finish").gap, by("Average finish").aText], ["a", "YOU +0.9 places", "3.6"], "a lower average finish is the better one");
  assert.deepStrictEqual([r.winsA, r.winsB, r.summary], [8, 1, "8 to 1 for YOU"]);
});

test("careerRows: level rows lead for nobody; no data is a dash and not a lead; a side ahead overall is named in the summary", () => {
  const same = owner({ titles: 2, seconds: 1, podiums: 3, trips: 6, poW: 6, poL: 4, poGames: 10, poPct: 60, regW: 60, regL: 40, regGames: 100, regPct: 60, avgFinish: 4 });
  const r = compare(same, same, 4, 4);
  assert.ok(r.rows.every((x) => x.winner === null && x.gap === "Level"));
  assert.strictEqual(r.summary, "level, 0 to 0");
  const empty = compare(same, owner({}));
  const po = empty.rows.find((x) => x.label === "Playoff win rate");
  assert.deepStrictEqual([po.bText, po.winner, po.gap], ["\u2013", null, ""]);
  const behind = compare(owner({ titles: 0, podiums: 0, avgFinish: 8 }), owner({ titles: 3, seconds: 0, podiums: 4, avgFinish: 3 }));
  assert.strictEqual(behind.summary.endsWith("for EVAN"), true);
  assert.deepStrictEqual([behind.rows[0].winner, behind.rows[0].gap], ["b", "EVAN +3"]);
  assert.deepStrictEqual(json(setup(), "RivalriesData.careerRows(null, null, 'a', 'b')"), { rows: [], winsA: 0, winsB: 0, summary: "" });
});

test("careerRows: Champ games goes to the better record; a side with no finals loses to one that has won one, and two sides with none are level", () => {
  const mk = (titles, seconds) => owner({ titles, seconds });
  const row = (a, b) => compare(a, b).rows.find((x) => x.label === "Champ games");
  assert.deepStrictEqual([row(mk(3, 1), mk(2, 2)).winner, row(mk(3, 1), mk(2, 2)).gap], ["a", "YOU +25 pts"]);
  assert.deepStrictEqual([row(mk(1, 0), mk(0, 0)).winner, row(mk(1, 0), mk(0, 0)).gap], ["a", "YOU never lost one"]);
  assert.deepStrictEqual([row(mk(0, 0), mk(2, 1)).winner, row(mk(0, 0), mk(2, 1)).gap], ["b", "EVAN +0 pts".replace(" +0 pts", " leads")]);
  assert.strictEqual(row(mk(0, 0), mk(0, 0)).winner, null);
  assert.strictEqual(row(mk(0, 2), mk(0, 0)).winner, null, "two lost finals against none is not a lead for anyone");
  assert.strictEqual(row(mk(2, 1), mk(2, 1)).gap, "Level");
});
