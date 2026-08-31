const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "animations.js", "records.js"]);
}

test("renderRecords: calls initAnimatedDropdowns after rendering, the same generic smooth open/close handler every other expandable panel on the site already uses (lineups, draft picks, bracket games)", async () => {
  const ctx = setup();
  ctx.__CALLS__ = [];
  runInLoadedContext(
    ctx,
    `
    SleeperAPI.getSeasonChain = async () => [{ league: { season: "2023", name: "Test League" }, rosters: [], users: [], bracket: [] }];
    SleeperAPI.getPlayerDirectory = async () => ({});
    DeepHistory.buildAll = async () => [{ weeks: [] }];
    DeepHistory.computeStats = () => ({ records: {}, top5Records: {}, managers: [] });
    initScrollAnimations = () => { __CALLS__.push("initScrollAnimations"); };
    initAnimatedDropdowns = () => { __CALLS__.push("initAnimatedDropdowns"); };
    `
  );

  await ctx.renderRecords();

  assert.ok(ctx.__CALLS__.includes("initAnimatedDropdowns"), "renderRecords should call initAnimatedDropdowns so its Top 5 disclosures animate open/close instead of snapping");
});
