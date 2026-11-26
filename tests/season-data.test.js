/*
  The Seasons page's own numbers (js/season-data.js), checked on the league's real archive. The 2025
  numbers are the ones in the Seasons mockup PDF (pages 1, 3, 6 and 8), so the page draws what was asked.
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const ROOT = path.join(__dirname, "..");
const archive = (y) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sleeper-archive", `${y}.json`), "utf8"));
const PLAYERS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sleeper-archive", "players.json"), "utf8"));

function season(year) {
  const c = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "season-data.js"]);
  const d = archive(year);
  c.__E__ = { league: d.league, rosters: d.rosters, users: d.users, bracket: d.bracket };
  c.__D__ = { weeks: d.weeks.filter(({ matchups }) => matchups.some((m) => (m.points || 0) > 0)), scheduleWeeks: d.weeks, transactions: d.transactions || [], draft: d.draft };
  c.__P__ = PLAYERS;
  runInLoadedContext(c, "var S = DeepHistory.computeSeasonSummary(__E__, __D__, __P__, null, null, null);");
  return (code) => JSON.parse(runInLoadedContext(c, `JSON.stringify(${code})`));
}

const s2025 = season(2025);
const s2026 = season(2026);

test("Final Standings 2025 (page 1): record, points, all-play, expected wins, luck in percent and schedule", () => {
  const rows = s2025("SeasonData.standingsRows(S, __E__, __D__)");
  const byName = (n) => rows.find((r) => r.name === n);
  const yu = byName("yulovesyou");
  assert.strictEqual(yu.rank, 1);
  assert.strictEqual(yu.record, "11-3");
  assert.strictEqual(yu.pf.toFixed(1), "1922.4");
  assert.strictEqual(yu.diff.toFixed(0), "256");
  assert.strictEqual(yu.ppg.toFixed(1), "137.3", "regular season only");
  assert.strictEqual(yu.allPlay, "87-38-1");
  assert.strictEqual(yu.expWins.toFixed(1), "9.7");
  assert.strictEqual(yu.luckPct.toFixed(1), "9.5", "luck stays the site's percent");
  assert.strictEqual(yu.sched.toFixed(1), "119.0");
  assert.strictEqual(yu.schedRank, 9);
  assert.deepStrictEqual(yu.finish, { kind: "champion", label: "Champion" });
  assert.strictEqual(byName("evangonnerman").finish.label, "Runner-up");
  assert.strictEqual(byName("YuWillLose").finish.label, "Lost quarterfinal");
  assert.strictEqual(byName("JoeSifBoreDough").finish.label, "4th place");
  assert.strictEqual(byName("tduchow").finish.label, "3rd place");
  assert.strictEqual(byName("artmane").finish.label, "Missed");
  assert.strictEqual(byName("artmane").schedRank, 1, "artmane faced the toughest schedule (141.8)");
  assert.strictEqual(byName("artmane").sched.toFixed(1), "141.8");
  assert.strictEqual(byName("mayshisha").schedRank, 10, "and mayshisha the easiest");
  assert.ok(rows.every((r) => !("last5" in r)), "no Last 5 any more");
});

test("a season being played has no finish yet", () => {
  const rows = s2026("SeasonData.standingsRows(S, __E__, __D__)");
  assert.ok(rows.length >= 10);
  assert.ok(rows.every((r) => r.finish === null));
  assert.ok(rows.every((r) => r.wins + r.losses + r.ties >= 5));
});

test("Season Grid 2025 (page 3): every score every week, the week's top and lowest, the playoff rounds, avg and spread", () => {
  const g = s2025("SeasonData.seasonGrid(S, __E__, __D__)");
  assert.strictEqual(g.weeks.length, 14);
  assert.deepStrictEqual(g.playoffCols.map((c) => c.label), ["QF", "SF", "F"]);
  assert.deepStrictEqual(g.weeks.map((w) => Math.round(w.avg)), [122, 128, 121, 138, 137, 130, 127, 125, 134, 125, 112, 127, 117, 115]);
  assert.deepStrictEqual(g.weeks.map((w) => w.topTag).slice(0, 4), ["TDUC", "JOES", "TDUC", "EVAN"]);
  const row = (n) => g.rows.find((r) => r.name === n);
  const evan = row("evangonnerman");
  assert.strictEqual(Math.round(evan.cells[8].pts), 193);
  assert.ok(evan.cells[8].top, "193.2 in week 9 was the week's top score");
  assert.ok(evan.cells[13].bottom, "85 in week 14 was the lowest");
  assert.strictEqual(evan.cells[6].result, "L");
  const yu = row("yulovesyou");
  assert.deepStrictEqual(yu.playoffs.map((p) => (p.bye ? "bye" : Math.round(p.pts) + (p.won ? "W" : "L"))), ["bye", "116W", "151W"]);
  assert.strictEqual(yu.avg.toFixed(1), "137.3");
  assert.strictEqual(yu.spread.toFixed(1), "16.2");
  assert.deepStrictEqual(row("YuWillLose").playoffs.map((p) => p && Math.round(p.pts)), [147, null, null], "a team out in the quarterfinal has nothing after it");
  assert.deepStrictEqual(row("artmane").playoffs, [null, null, null], "the 5th-place game is not shown");
  assert.deepStrictEqual(g.tiles.mostTop, { count: 4, names: ["JoeSifBoreDough"], of: 14 });
  assert.strictEqual(g.tiles.steadiest.name, "YuWillLose");
  assert.strictEqual(g.tiles.steadiest.spread.toFixed(1), "14.6");
  assert.strictEqual(g.tiles.wildest.name, "artmane");
});

test("Season Grid while a season is played: finished weeks only and no playoff columns", () => {
  const g = s2026("SeasonData.seasonGrid(S, __E__, __D__)");
  assert.ok(g.weeks.length >= 1);
  assert.deepStrictEqual(g.playoffCols, []);
  assert.ok(g.rows.every((r) => r.cells.length === g.weeks.length));
});

test("the bracket 2025 (page 6): rounds in order, byes where their team comes back in, seeds, margins and the champion's route", () => {
  const b = s2025("SeasonData.bracketModel(__E__, __D__, S)");
  assert.deepStrictEqual(b.columns.map((c) => `${c.label} ${c.week}`), ["Quarterfinals 15", "Semifinals 16", "Final 17"]);
  const qf = b.columns[0].items.map((x) => (x.kind === "bye" ? `bye ${x.seed}` : x.teams.map((t) => t.seed).join("v")));
  assert.deepStrictEqual(qf, ["bye 1", "4v5", "bye 2", "6v3"], "each first-round item lines up with the semifinal it feeds");
  const sf = b.columns[1].items;
  assert.strictEqual(sf[0].winnerName, "yulovesyou");
  assert.strictEqual(sf[0].margin.toFixed(1), "13.6");
  assert.ok(sf[0].route && !sf[1].route);
  const final = b.columns[2].items.find((x) => x.final);
  assert.deepStrictEqual(final.teams.map((t) => [t.seed, t.name, t.score.toFixed(1), t.won]), [
    [1, "yulovesyou", "151.3", true],
    [2, "evangonnerman", "112.6", false],
  ]);
  assert.strictEqual(final.margin.toFixed(1), "38.6");
  const third = b.columns[2].items.find((x) => x.third);
  assert.strictEqual(third.winnerName, "tduchow");
  assert.ok(!third.route, "the third-place game is never on the champion's route");
  assert.ok(b.columns[0].items[0].route, "the champion's bye is on the route");
  assert.strictEqual(
    s2025("SeasonData.championStory(SeasonData.bracketModel(__E__, __D__, S).champion)"),
    "11-3 and the #1 seed. Rested in week 15, beat JoeSifBoreDough by 13.6 in the semifinal, then evangonnerman by 38.6 in the final."
  );
});

test("an ESPN-era bracket gets the same shape: seeds from the standings, byes lined up with their semifinal", () => {
  const c = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "manual-history.js", "season-data.js"]);
  c.__M__ = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "manual-history.json"), "utf8"));
  const b = JSON.parse(runInLoadedContext(c, "(() => { const s = ManualHistory.findSeason(__M__, 2019); return JSON.stringify(SeasonData.legacyBracket(ManualHistory.buildBracketData(s), s.standings)); })()"));
  assert.deepStrictEqual(b.columns.map((x) => x.label), ["Quarterfinals", "Semifinals", "Final"]);
  assert.deepStrictEqual(b.columns[0].items.map((x) => (x.kind === "bye" ? `bye ${x.name}` : x.winnerName)), ["bye evangonnerman", "yulovesyou", "hmart92", "bye sofarrsogood"]);
  assert.strictEqual(b.columns[2].items[0].final, true, "the final first, the 3rd-place game after it");
  assert.strictEqual(b.columns[2].items[1].third, true);
  assert.strictEqual(b.champion.name, "evangonnerman");
  assert.strictEqual(b.champion.seed, 1);
});

test("Points By Starting Slot 2025 (page 8): the gap to the league average, best and worst per column, strongest and weakest", () => {
  const t = s2025("SeasonData.slotTable(S.positionTable)");
  assert.deepStrictEqual(t.columns.map((c) => c.label), ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "K", "DEF", "FLEX", "SFLX"]);
  assert.strictEqual(t.rows[0].name, "JoeSifBoreDough", "sorted by total");
  const row = (n) => t.rows.find((r) => r.name === n);
  assert.strictEqual(row("evangonnerman").cells[0].v.toFixed(1), "27.0");
  assert.ok(row("evangonnerman").cells[0].best, "the best QB");
  assert.ok(row("artmane").cells[0].worst, "the worst QB");
  assert.deepStrictEqual([row("tduchow").strongest.label, row("tduchow").strongest.gap.toFixed(1)], ["TE", "6.3"]);
  assert.deepStrictEqual([row("artmane").weakest.label, row("artmane").weakest.gap.toFixed(1)], ["QB", "-5.8"]);
  assert.strictEqual(row("artmane").strongest, null, "below average everywhere: no strongest");
});

test("the Power Rank History grids: bands, odds labels and the clinched / out week", () => {
  const c = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "season-data.js"]);
  const j = (code) => JSON.parse(runInLoadedContext(c, `JSON.stringify(${code})`));
  assert.deepStrictEqual(j("[1, 2, 4, 5, 7, 9, 10].map((r) => SeasonData.rankBand(r, 10))"), [5, 4, 4, 3, 2, 2, 1]);
  assert.deepStrictEqual(j("[99.64, 100, 0.74, 0, 0.3, 42.4, 98.6].map(SeasonData.oddsLabel)"), ["99.6", "100", "0.7", "0", "0.3", "42", "99"]);
  const g = j("SeasonData.oddsGrid({ a: [50, 99.6, 100, 100], b: [40, 0.4, 0, 0], c: [30, 99.9, 60, 100], d: [10, 20, 30, 40], e: [10, 0, 5, 0] }, ['d', 'c', 'b', 'a', 'e'])");
  assert.deepStrictEqual(g.rows.map((r) => r.key), ["d", "c", "b", "a", "e"]);
  assert.deepStrictEqual(g.rows.map((r) => r.result), [null, { kind: "in", week: 4 }, { kind: "out", week: 2 }, { kind: "in", week: 2 }, { kind: "out", week: 4 }], "a 0 that comes back is not out yet");
  const r = j("SeasonData.rankGrid({ a: { pre: 6, weekly: [2, 1] }, b: { pre: 1, weekly: [1, 2] } })");
  assert.deepStrictEqual(r.rows.map((x) => [x.key, x.latest, x.move]), [["a", 1, 5], ["b", 2, -1]]);
});

test("Standings Over Time 2025: the champion in gold, the runner-up in white and the points leader who fell in blue", () => {
  const b = s2025("SeasonData.bumpModel(S.standingsHistory, S)");
  assert.deepStrictEqual(b.stories.map((s) => [s.name, s.tone, s.note]), [
    ["yulovesyou", "gold", "champion"],
    ["evangonnerman", "white", "runner-up"],
    ["JoeSifBoreDough", "blue", "most points, finished 5th"],
  ]);
  assert.strictEqual(b.lines.length, 10);
  assert.ok(b.lines.every((l) => l.ranks.length === 14));
});

test("a tied game is a T in the grid, not a loss", () => {
  const c = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "season-data.js"]);
  c.__E__ = { league: { status: "in_season", settings: { playoff_week_start: 15 } }, bracket: [] };
  c.__D__ = { weeks: [{ week: 1, matchups: [{ roster_id: 1, matchup_id: 1, points: 100 }, { roster_id: 2, matchup_id: 1, points: 100 }] }, { week: 2, matchups: [{ roster_id: 1, matchup_id: 1, points: 90 }, { roster_id: 2, matchup_id: 1, points: 80 }] }] };
  const games = JSON.parse(runInLoadedContext(c, "JSON.stringify([...SeasonData.teamGames(__E__, __D__).entries()])"));
  assert.deepStrictEqual(games.map(([rid, g]) => [rid, g.map((x) => x.result).join("")]), [[1, "TW"], [2, "TL"]]);
});
