/*
  The Players page opens on three leaderboards (Most Rostered, Best Career,
  Trending) instead of an empty panel with a search box.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const setup = () => loadSiteModules(["config.js", "utils.js", "my-team.js", "sleeper-api.js", "charts.js", "animations.js", "player.js"]);
const json = (c, code) => JSON.parse(runInLoadedContext(c, `JSON.stringify(${code})`));

function player(name, totals, weekly, extra) {
  return { name, position: "WR", spans: [], totals: { owners: 1, gamesOwned: 0, gamesStarted: 0, gamesPlayed: 0, totalPoints: 0, ppg: 0, ...totals }, weekly: weekly || [], ...extra };
}
const wk = (season, week, points) => ({ season, week, points, started: 1 });

test("recentPlayedWeeks: the newest finished weeks, oldest first; zero-point future shells don't count", () => {
  const c = setup();
  c.__IDX__ = {
    a: player("A", {}, [wk("2025", 17, 10), wk("2026", 1, 9), wk("2026", 2, 8), wk("2026", 3, 7), wk("2026", 4, 0), wk("2026", 5, 0)]),
    b: player("B", {}, [wk("2026", 3, 5), wk("2026", 4, 0)]),
  };
  const weeks = json(c, "recentPlayedWeeks(__IDX__, 3)");
  assert.deepStrictEqual(weeks, [{ season: "2026", week: 1 }, { season: "2026", week: 2 }, { season: "2026", week: 3 }]);
  assert.deepStrictEqual(json(c, "recentPlayedWeeks(__IDX__, 10)").length, 4);
  assert.deepStrictEqual(json(c, "recentPlayedWeeks({}, 3)"), []);
  assert.deepStrictEqual(json(c, "recentPlayedWeeks(null, 3)"), []);
});

test("recentPlayedWeeks: rolls across a season boundary in season-then-week order, not string order", () => {
  const c = setup();
  c.__IDX__ = { a: player("A", {}, [wk("2025", 16, 4), wk("2025", 9, 4), wk("2026", 1, 4)]) };
  assert.deepStrictEqual(json(c, "recentPlayedWeeks(__IDX__, 3)").map((w) => `${w.season}-${w.week}`), ["2025-9", "2025-16", "2026-1"]);
});

test("playerLeaderboards: Most Rostered ranks by games on a roster; players who tie fall to games started, then owners, not the alphabet", () => {
  const c = setup();
  c.__IDX__ = {
    zed: player("Zed Starter", { gamesOwned: 119, gamesStarted: 110, owners: 4 }),
    amy: player("Amy Bench", { gamesOwned: 119, gamesStarted: 20, owners: 9 }),
    mid: player("Mid Owners", { gamesOwned: 119, gamesStarted: 110, owners: 7 }),
    low: player("Low Games", { gamesOwned: 40, gamesStarted: 40, owners: 2 }),
    none: player("Never Rostered", { gamesOwned: 0 }),
  };
  const { rostered } = json(c, "playerLeaderboards(__IDX__, 8)");
  assert.deepStrictEqual(rostered.map((r) => r.name), ["Mid Owners", "Zed Starter", "Amy Bench", "Low Games"]);
  assert.strictEqual(rostered[0].valueText, "119 games");
  assert.strictEqual(rostered[0].sub, "7 owners · 110 starts");
  assert.strictEqual(rostered[3].sub, "2 owners · 40 starts");
});

test("playerLeaderboards: one owner reads '1 owner'; equal on everything falls back to name order so the list never shuffles", () => {
  const c = setup();
  c.__IDX__ = {
    b: player("Bee", { gamesOwned: 10, gamesStarted: 5, owners: 1 }),
    a: player("Ace", { gamesOwned: 10, gamesStarted: 5, owners: 1 }),
  };
  const { rostered } = json(c, "playerLeaderboards(__IDX__)");
  assert.deepStrictEqual(rostered.map((r) => r.name), ["Ace", "Bee"]);
  assert.ok(rostered[0].sub.startsWith("1 owner "));
});

test("playerLeaderboards: Best Career is total points with ppg and games played, and respects the size", () => {
  const c = setup();
  c.__IDX__ = {
    a: player("Alpha", { totalPoints: 2404.4, ppg: 23.8, gamesPlayed: 101, gamesOwned: 1 }),
    b: player("Beta", { totalPoints: 1819, ppg: 20.9, gamesPlayed: 87, gamesOwned: 1 }),
    c: player("Gamma", { totalPoints: 900, ppg: null, gamesPlayed: 3, gamesOwned: 1 }),
  };
  const { career } = json(c, "playerLeaderboards(__IDX__, 2)");
  assert.deepStrictEqual(career.map((r) => r.name), ["Alpha", "Beta"]);
  assert.strictEqual(career[0].valueText, "2,404 pts");
  assert.strictEqual(career[0].sub, "23.8 ppg · 101 games played");
  const withDash = json(c, "playerLeaderboards(__IDX__, 8)").career[2];
  assert.ok(withDash.sub.startsWith("— ppg"), "a missing ppg shows a dash, not 'null'");
});

test("playerLeaderboards: Trending adds up the last three finished weeks only, and says whose roster or 'free agent'", () => {
  const c = setup();
  c.__IDX__ = {
    hot: player("Hot Now", { gamesOwned: 1 }, [wk("2026", 1, 50), wk("2026", 2, 5), wk("2026", 3, 10), wk("2026", 4, 12), wk("2026", 5, 30)], {
      spans: [{ ownerName: "alvin", startSeason: "2026", startWeek: 1 }],
    }),
    old: player("Old Star", { gamesOwned: 1 }, [wk("2026", 1, 99), wk("2026", 2, 99), wk("2026", 3, 0), wk("2026", 4, 0), wk("2026", 5, 0)]),
    fa: player("Free Guy", { gamesOwned: 1 }, [wk("2026", 3, 8), wk("2026", 4, 8), wk("2026", 5, 8, ), ], { spans: [{ ownerName: "beth" }] }),
  };
  // weeks 1-5 all have somebody scoring, so the window is weeks 3-5
  const out = json(c, "playerLeaderboards(__IDX__, 8)");
  assert.deepStrictEqual(out.weeks.map((w) => w.week), [3, 4, 5]);
  assert.strictEqual(out.trending[0].name, "Hot Now");
  assert.strictEqual(out.trending[0].valueText, "52.0 pts", "10 + 12 + 30; the 50 from week 1 is outside the window");
  assert.ok(!out.trending.some((r) => r.name === "Old Star"), "scored nothing in the window");
});

test("playerLeaderboards: an empty or missing index gives empty boards, never throws", () => {
  const c = setup();
  for (const arg of ["{}", "null", "undefined"]) {
    const out = json(c, `playerLeaderboards(${arg})`);
    assert.deepStrictEqual([out.rostered.length, out.career.length, out.trending.length, out.weeks.length], [0, 0, 0, 0]);
  }
});

test("leaderboardHtml: links each row to its player, escapes names, and says so when a board is empty", () => {
  const c = setup();
  const html = c.leaderboardHtml("Most <Rostered>", "note", [{ id: "p 1", name: "<b>Hax</b>", position: "QB", sub: "1 owner", valueText: "3 games" }]);
  assert.ok(html.includes('href="#p%201"'));
  assert.ok(!html.includes("<b>Hax</b>") && html.includes("&lt;b&gt;Hax&lt;/b&gt;"));
  assert.ok(html.includes("Most &lt;Rostered&gt;"));
  assert.ok(c.leaderboardHtml("T", "n", []).includes("Nothing to rank yet."));
});
