const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

function setup() {
  const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "animations.js", "manual-history.js", "teams.js"]);
  ctx.__FAKE_LEAGUE_STATS__ = {
    managers: [
      {
        userId: "u1",
        username: "evangonnerman",
        teamName: "evangonnerman",
        careerRegularSeasonWins: 20,
        careerRegularSeasonLosses: 10,
        careerRegularSeasonTies: 0,
        careerPlayoffWins: 5,
        careerPlayoffLosses: 2,
        careerPlayoffTies: 0,
        seasons: [
          { season: 2022, wins: 6 },
          { season: 2023, wins: 8 },
        ],
      },
      {
        userId: "u2",
        username: "yulovesyou",
        teamName: "yulovesyou",
        careerRegularSeasonWins: 15,
        careerRegularSeasonLosses: 15,
        careerRegularSeasonTies: 0,
        careerPlayoffWins: 0,
        careerPlayoffLosses: 3,
        careerPlayoffTies: 0,
        seasons: [{ season: 2023, wins: 7 }],
      },
    ],
  };
  runInLoadedContext(ctx, "LEAGUE_STATS = __FAKE_LEAGUE_STATS__;");
  return ctx;
}

test("renderManagerPicker: builds a career-card link per manager (not the old plain-text pill), with a sparkline and career win% caption", () => {
  const ctx = setup();
  ctx.location.hash = "";
  ctx.renderManagerPicker();

  const html = ctx.document.getElementById("manager-picker").innerHTML;
  assert.ok(html.includes('class="career-card"'), "should render career-card links, not season-pills");
  assert.ok(html.includes("evangonnerman"));
  assert.ok(html.includes("yulovesyou"));
  assert.ok(html.includes("career-spark"), "should include a sparkline element per card");
  // evangonnerman: (20+5) wins / (20+10+5+2) total = 25/37 = 67.6%
  assert.ok(html.includes("67.6% win rate"));
});

test("renderManagerPicker: each card links to #<userId>, the same hash-based navigation the old pills used", () => {
  const ctx = setup();
  ctx.location.hash = "";
  ctx.renderManagerPicker();
  const html = ctx.document.getElementById("manager-picker").innerHTML;
  assert.ok(html.includes('href="#u1"'));
  assert.ok(html.includes('href="#u2"'));
});

test("renderManagerPicker: the card matching the current location.hash gets the active class; the others don't", () => {
  const ctx = setup();
  ctx.location.hash = "#u2";
  ctx.renderManagerPicker();
  const html = ctx.document.getElementById("manager-picker").innerHTML;

  const yuloCard = html.match(/<a class="([^"]*)" href="#u2">/)[1];
  const evanCard = html.match(/<a class="([^"]*)" href="#u1">/)[1];
  assert.ok(yuloCard.includes("active"), "the manager matching the current hash should be marked active");
  assert.ok(!evanCard.includes("active"), "a non-selected manager should not be marked active");
});

test("renderManagerPicker: with no hash selected, no card is marked active", () => {
  const ctx = setup();
  ctx.location.hash = "";
  ctx.renderManagerPicker();
  const html = ctx.document.getElementById("manager-picker").innerHTML;
  assert.ok(!html.includes('class="career-card active"'));
});
