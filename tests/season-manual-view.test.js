const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const REAL_MANUAL_HISTORY = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "manual-history.json"), "utf8"));
const REAL_POWER_RANK_CSV_HISTORY = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "power-rank-csv-history.json"), "utf8"));

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

test("renderManualSeasonSummary: Playoff Bracket renders before Final Standings", () => {
  const ctx = setup();
  const season2019 = ctx.ManualHistory.findSeason(REAL_MANUAL_HISTORY, 2019);
  const html = ctx.renderManualSeasonSummary(season2019);

  const bracketIdx = html.indexOf(">Playoff Bracket<");
  const standingsIdx = html.indexOf(">Final Standings<");
  assert.ok(bracketIdx > -1 && standingsIdx > -1, "both section labels should be present");
  assert.ok(bracketIdx < standingsIdx, "Playoff Bracket should come before Final Standings");
});

test("renderManualSeasonSummary: Final Standings has an Avg/Wk column instead of a Playoffs column, correctly computed from PF and games played", () => {
  const ctx = setup();
  const season2019 = ctx.ManualHistory.findSeason(REAL_MANUAL_HISTORY, 2019);
  const html = ctx.renderManualSeasonSummary(season2019);

  assert.ok(!/<th>Playoffs<\/th>/.test(html), "the Playoffs column header should be gone");
  assert.ok(/<th>Avg\/Wk<\/th>/.test(html), "an Avg/Wk column header should be present");
  // evangonnerman 2019: 11-2-0 (13 games), 1489.9 PF -> 114.6 pts/wk
  assert.ok(html.includes("114.6"), "evangonnerman's Avg/Wk should be their PF divided by games played");
});

test("renderManualSeasonSummary: resolves the Finals MVP's photo by matching their name against the player directory", () => {
  const ctx = setup();
  runInLoadedContext(
    ctx,
    `PLAYER_DIRECTORY = { "9005": { full_name: "Saquon Barkley", position: "RB" } };`
  );
  const season2019 = ctx.ManualHistory.findSeason(REAL_MANUAL_HISTORY, 2019);
  const html = ctx.renderManualSeasonSummary(season2019);

  assert.ok(html.includes("sleepercdn.com/content/nfl/players/9005"), "should render a real headshot for the matched player_id, not just the initial-letter fallback");
});

test("renderManualSeasonSummary: falls back gracefully (no crash, initial-letter avatar) when the Finals MVP can't be matched in the player directory", () => {
  const ctx = setup();
  runInLoadedContext(ctx, `PLAYER_DIRECTORY = {};`); // empty directory -> no possible match
  const season2019 = ctx.ManualHistory.findSeason(REAL_MANUAL_HISTORY, 2019);
  let html;
  assert.doesNotThrow(() => {
    html = ctx.renderManualSeasonSummary(season2019);
  });
  assert.ok(html.includes("Saquon Barkley"), "the MVP's name should still be shown even without a photo match");
});

test("renderManualSeasonSummary: includes the Power Rank History chart for an ESPN-era year that has Power Rank CSV data (2019)", () => {
  const ctx = setup();
  ctx.__TEST_POWER_RANK_CSV_HISTORY__ = REAL_POWER_RANK_CSV_HISTORY;
  runInLoadedContext(ctx, "POWER_RANK_CSV_HISTORY = __TEST_POWER_RANK_CSV_HISTORY__;");

  const season2019 = ctx.ManualHistory.findSeason(REAL_MANUAL_HISTORY, 2019);
  const html = ctx.renderManualSeasonSummary(season2019);

  assert.ok(html.includes("Power Rank History"), "the Power Rank History section should render for 2019");
  assert.ok(html.includes("Power Rank By Week"), "should include the rank tab");
  assert.ok(html.includes("jerbear3"), "should include a 2019-only manager's data in the chart");
  // 2019 only has rank data, no Power Score or Playoff Odds — only the one tab should offer itself.
  assert.ok(!html.includes("Power Score History"), "2019 has no Power Score data, so that tab shouldn't appear");
  assert.ok(!html.includes("Playoff Odds History"), "2019 has no Playoff Odds data, so that tab shouldn't appear");
});

test("renderManualSeasonSummary: omits the Power Rank History section entirely for a year with no Power Rank CSV data (e.g. 2015)", () => {
  const ctx = setup();
  ctx.__TEST_POWER_RANK_CSV_HISTORY__ = REAL_POWER_RANK_CSV_HISTORY;
  runInLoadedContext(ctx, "POWER_RANK_CSV_HISTORY = __TEST_POWER_RANK_CSV_HISTORY__;");

  const season2015 = ctx.ManualHistory.findSeason(REAL_MANUAL_HISTORY, 2015);
  const html = ctx.renderManualSeasonSummary(season2015);

  assert.ok(!html.includes("Power Rank History"), "no Power Rank History section should render when there's no data for that year");
});
