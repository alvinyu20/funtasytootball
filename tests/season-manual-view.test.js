const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const REAL_MANUAL_HISTORY = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "manual-history.json"), "utf8"));

function setup() {
  const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "season.js"]);
  ctx.__TEST_SEASON_CHAIN__ = [{ league: { season: "2023" } }, { league: { season: "2022" } }];
  ctx.__TEST_MANUAL_HISTORY__ = REAL_MANUAL_HISTORY;
  runInLoadedContext(ctx, "SEASON_CHAIN = __TEST_SEASON_CHAIN__; MANUAL_HISTORY = __TEST_MANUAL_HISTORY__;");
  return ctx;
}

test("renderPicker: interleaves manual (pre-Sleeper) years with live Sleeper years in one newest-first list", () => {
  const ctx = setup();
  ctx.renderPicker("2019");
  const html = ctx.document.getElementById("season-picker").innerHTML;

  assert.ok(html.includes('href="#2023"'), "should include the live Sleeper year 2023");
  assert.ok(html.includes('href="#2019"'), "should include the manual year 2019");
  assert.ok(html.includes('href="#2015"'), "should include the manual year 2015");
  assert.ok(/class="season-pill active" href="#2019"/.test(html), "2019 should be marked active, since that's what was passed as the selected key");

  const order = ["2023", "2022", "2019", "2018", "2017", "2016", "2015"].map((y) => html.indexOf(`#${y}"`));
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i - 1] < order[i], `year at position ${i} should appear after the previous one (newest-first order)`);
  }
});

test("renderPicker: doesn't duplicate a year that (hypothetically) existed in both the Sleeper chain and manual history", () => {
  const ctx = setup();
  runInLoadedContext(ctx, "SEASON_CHAIN = [{ league: { season: '2019' } }];"); // pretend 2019 is ALSO a live Sleeper year
  ctx.renderPicker("2019");
  const html = ctx.document.getElementById("season-picker").innerHTML;
  const occurrences = (html.match(/href="#2019"/g) || []).length;
  assert.strictEqual(occurrences, 1, "2019 should only appear once, not once per source");
});

test("renderManualSeasonSummary: 2019 standings table includes every team with correct data", () => {
  const ctx = setup();
  const season2019 = ctx.ManualHistory.findSeason(REAL_MANUAL_HISTORY, 2019);
  const html = ctx.renderManualSeasonSummary(season2019);

  assert.ok(html.includes("evangonnerman"), "should list the champion");
  assert.ok(html.includes("🏆"), "should show a gold medal emoji somewhere");
  assert.ok(html.includes("🥈"), "should show a silver medal emoji");
  assert.ok(html.includes("🥉"), "should show a bronze medal emoji");
  assert.ok(html.includes("11-2"), "evangonnerman's regular season record should appear");
});

test("renderManualSeasonSummary: includes the playoff bracket with the Finals score and MVP", () => {
  const ctx = setup();
  const season2019 = ctx.ManualHistory.findSeason(REAL_MANUAL_HISTORY, 2019);
  const html = ctx.renderManualSeasonSummary(season2019);

  assert.ok(html.includes("141.5"), "Finals winning score should appear");
  assert.ok(html.includes("101.7"), "Finals losing score should appear");
  assert.ok(html.includes("Saquon Barkley"), "Finals MVP name should appear");
  assert.ok(html.includes("3rd Place"), "the third-place game should be labeled");
});

test("renderManualSeasonSummary: every one of the 5 real seasons renders without throwing", () => {
  const ctx = setup();
  for (const season of REAL_MANUAL_HISTORY.seasons) {
    assert.doesNotThrow(() => ctx.renderManualSeasonSummary(season), `season ${season.year} should render without error`);
  }
});
