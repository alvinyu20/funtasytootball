/*
  The three Power Rank History charts (Power Rank By Week, Power Score History,
  Playoff Odds History) on a Season page, including the in-progress season.
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "power-rank-csv-history.json"), "utf8"));
const setup = () => loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "season.js"]);

function section(c, history, season) {
  c.__H__ = history;
  runInLoadedContext(c, "POWER_RANK_CSV_HISTORY = __H__;");
  return c.renderPowerRankHistorySection(season);
}
const tabKeys = (html) => [...html.matchAll(/data-chart-tab="(\w+)"/g)].map((m) => m[1]);

test("every season since 2021, including the current one, offers all three charts", () => {
  const c = setup();
  const current = Math.max(...Object.keys(REAL.seasons).map(Number));
  assert.ok(current >= 2026, "the data file has this season");
  for (const year of Object.keys(REAL.seasons).filter((y) => Number(y) >= 2021)) {
    assert.deepStrictEqual(tabKeys(section(c, REAL, Number(year))), ["rank", "score", "odds"], `${year} should have rank, score and odds tabs`);
  }
});

test("2019-2020 only have ranks, so they offer just the rank chart (no empty tabs)", () => {
  const c = setup();
  assert.deepStrictEqual(tabKeys(section(c, REAL, 2020)), ["rank"]);
});

test("a season with no history yet shows nothing, rather than an empty box", () => {
  const c = setup();
  assert.strictEqual(section(c, REAL, 2031), "");
  assert.strictEqual(section(c, null, 2026), "");
  assert.strictEqual(section(c, { seasons: {} }, 2026), "");
});

test("one finished week (the start of a season) still draws all three charts with real positions", () => {
  const c = setup();
  const oneWeek = { seasons: { 2030: { ranks: { a: { pre: null, weekly: [1] }, b: { pre: null, weekly: [2] } }, scores: { a: { pre: null, weekly: [1.2] }, b: { pre: null, weekly: [2.4] } }, playoffOdds: { a: [80], b: [40] } } } };
  const html = section(c, oneWeek, 2030);
  assert.deepStrictEqual(tabKeys(html), ["rank", "score", "odds"]);
  assert.ok(!/NaN|Infinity|undefined/.test(html));
  assert.ok((html.match(/class="lc-dot"/g) || []).length >= 6);
});

test("the current season's three charts have one point per finished week for every team", () => {
  const c = setup();
  const html = section(c, REAL, 2026);
  const year = REAL.seasons["2026"];
  const teams = Object.keys(year.ranks);
  const weeks = year.ranks[teams[0]].weekly.length;
  assert.ok(teams.length >= 8 && weeks >= 1);
  for (const team of teams) assert.ok(html.includes(`data-series="${team}"`), `${team} is drawn`);
  // each of the three charts draws a visible dot per team per week
  assert.ok((html.match(/class="lc-dot" /g) || []).length >= teams.length * weeks * 3);
});
