/*
  The three Power Rank History views on a Season page, stacked (mockup page 15): Power Rank By Week (a
  numbered grid), Power Score History (a small chart per team on one scale) and Playoff Odds, Week By Week
  (a grid with the week each team clinched or was knocked out). The in-progress season included.
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "power-rank-csv-history.json"), "utf8"));
const setup = () => loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "history-data.js", "season-data.js", "season.js"]);

function section(c, history, season) {
  c.__H__ = history;
  runInLoadedContext(c, "POWER_RANK_CSV_HISTORY = __H__;");
  return c.renderPowerRankHistorySection(season);
}
const panels = (html) => ["Power Rank By Week", "Power Score History", "Playoff Odds, Week By Week"].filter((t) => html.includes(`<h2>${t}</h2>`));
const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("every season since 2021, including the current one, shows all three views", () => {
  const c = setup();
  const current = Math.max(...Object.keys(REAL.seasons).map(Number));
  assert.ok(current >= 2026, "the data file has this season");
  for (const year of Object.keys(REAL.seasons).filter((y) => Number(y) >= 2021)) {
    assert.strictEqual(panels(section(c, REAL, Number(year))).length, 3, `${year} should have all three`);
  }
});

test("2019-2020 only have ranks, so they show just the rank grid (no empty panels)", () => {
  const c = setup();
  assert.deepStrictEqual(panels(section(c, REAL, 2020)), ["Power Rank By Week"]);
});

test("a season with no history yet shows nothing, rather than an empty box", () => {
  const c = setup();
  assert.strictEqual(section(c, REAL, 2031), "");
  assert.strictEqual(section(c, null, 2026), "");
  assert.strictEqual(section(c, { seasons: {} }, 2026), "");
});

test("one finished week (the start of a season) still draws all three views with real numbers", () => {
  const c = setup();
  const oneWeek = { seasons: { 2030: { ranks: { a: { pre: null, weekly: [1] }, b: { pre: null, weekly: [2] } }, scores: { a: { pre: null, weekly: [1.2] }, b: { pre: null, weekly: [2.4] } }, playoffOdds: { a: [80], b: [40] } } } };
  const html = section(c, oneWeek, 2030);
  assert.strictEqual(panels(html).length, 3);
  assert.ok(!/NaN|Infinity|undefined/.test(html));
  assert.strictEqual((html.match(/class="sn-pr sn-pr-/g) || []).length, 2, "a rank square per team");
  assert.strictEqual((html.match(/class="sn-spark"/g) || []).length, 2, "a small chart per team");
  assert.ok(html.includes(">80</span>") && html.includes(">40</span>"));
});

test("the current season: a rank square and an odds square per team per finished week, and every team's card", () => {
  const c = setup();
  const html = section(c, REAL, 2026);
  const year = REAL.seasons["2026"];
  const teams = Object.keys(year.ranks);
  const weeks = year.ranks[teams[0]].weekly.length;
  assert.ok(teams.length >= 8 && weeks >= 1);
  for (const team of teams) assert.ok(html.includes(`data-username="${team}"`), `${team} is drawn`);
  const pre = teams.filter((t) => year.ranks[t].pre != null).length;
  assert.strictEqual((html.match(/class="sn-pr sn-pr-[1-5]"/g) || []).length, teams.length * weeks + pre);
  assert.strictEqual((html.match(/class="sn-odds sn-odds-(?!none)/g) || []).length, teams.length * weeks);
  assert.strictEqual((html.match(/class="sn-spark-card"/g) || []).length, teams.length);
});

test("two teams tied on PR Score share their places, and the grid says 2.5 rather than rounding", () => {
  const c = setup();
  const tied = { seasons: { 2030: { ranks: { a: { pre: null, weekly: [1] }, b: { pre: null, weekly: [2.5] }, d: { pre: null, weekly: [2.5] }, e: { pre: null, weekly: [4] } }, scores: { a: { pre: null, weekly: [1] }, b: { pre: null, weekly: [2.2] }, d: { pre: null, weekly: [2.2] }, e: { pre: null, weekly: [4] } }, playoffOdds: { a: [80], b: [60], d: [50], e: [40] } } } };
  const html = section(c, tied, 2030);
  assert.strictEqual((html.match(/>2\.5<\/span>/g) || []).length, 2, "a tie reads 2.5 for each team");
  assert.ok(html.includes(">1</span>") && html.includes(">4</span>"), "whole ranks stay whole numbers");
  assert.ok(!html.includes(">3</span>"), "nobody is rounded into somebody else's place");
});

test("the real 2026 history has its tied weeks (Week 1: two teams on 6.35, Week 4: two on 10.10) shown as halves", () => {
  const c = setup();
  const html = section(c, REAL, 2026);
  assert.strictEqual((html.match(/>6\.5<\/span>/g) || []).length >= 2, true);
  assert.strictEqual((html.match(/>10\.5<\/span>/g) || []).length >= 2, true);
});

test("2025: rows follow the latest rank, the vs-preseason move, and the clinched / out weeks", () => {
  const c = setup();
  const html = section(c, REAL, 2025);
  const text = strip(html);
  const order = ["JoeSifBoreDough", "yulovesyou", "evangonnerman", "YuWillLose"].map((n) => text.indexOf(n));
  assert.ok(order.every((x, i) => x >= 0 && (i === 0 || x > order[i - 1])), "sorted by the final week's rank");
  assert.ok(text.includes("Clinched W6") && text.includes("Clinched W8") && text.includes("Out W11"));
  assert.ok(html.includes(">99.6</span>") && html.includes(">0.7</span>"), "99.x and under-1 odds keep a decimal");
  assert.ok(html.includes("▲ 3") && html.includes("▼ 6"), "moves against preseason");
});
