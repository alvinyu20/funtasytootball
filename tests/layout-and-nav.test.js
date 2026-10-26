/*
  Newsletters are gone, Season stops calling an in-progress year "Final",
  Power Rankings' tables carry the sticky/playoff-line markup, and the nav and
  layout rules the pass depends on are still in the files.
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules } = require("./helpers/site-env.js");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));

test("no page links to a newsletter page, and none of the newsletter files are left", () => {
  assert.ok(pages.length >= 10);
  for (const f of pages) {
    const html = read(f);
    assert.ok(!/newsletter/i.test(html), `${f} still mentions newsletters`);
  }
  for (const gone of ["newsletter.html", "newsletters.html", "js/newsletter.js", "js/newsletters.js", "data/newsletters.json", "data/newsletter.json"]) {
    assert.ok(!fs.existsSync(path.join(ROOT, gone)), `${gone} should be deleted`);
  }
  for (const f of fs.readdirSync(path.join(ROOT, "js")).filter((x) => x.endsWith(".js"))) {
    assert.ok(!/newsletter/i.test(read(path.join("js", f))), `js/${f} still mentions newsletters`);
  }
});

test("every page's nav has the same links in the same order", () => {
  const linksOf = (f) => [...read(f).matchAll(/<a class="nav-link[^"]*" href="([^"]+)"/g)].map((m) => m[1]);
  const reference = linksOf("index.html");
  assert.ok(reference.length >= 9);
  for (const f of pages) {
    const links = linksOf(f);
    if (!links.length) continue; // a standalone page with no site nav
    assert.deepStrictEqual(links, reference, `${f}'s nav differs from the home page's`);
  }
});

test("the desktop tab bar starts at 1000px and the hamburger still covers tablets and phones", () => {
  const css = read("css/styles.css");
  assert.match(css, /@media \(min-width: 1000px\)\s*\{\s*\.nav-toggle, \.nav-backdrop \{ display: none; \}/);
});

test("stacked panels get a gap, but panels inside a grid don't get extra margin on top of the grid gap", () => {
  const css = read("css/styles.css");
  assert.match(css, /\.panel \+ \.panel \{ margin-top: 24px; \}/);
  assert.match(css, /\.section-grid > \.panel,\s*\.player-boards > \.panel \{ margin-top: 0; \}/);
});

test("standingsLabel: an in-progress season is 'Standings · Through Week N', not 'Final Standings'", () => {
  const c = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "season.js"]);
  assert.strictEqual(c.standingsLabel({ season: 2026, status: "in_season", weeksPlayed: 5 }), "Standings · Through Week 5");
  assert.strictEqual(c.standingsLabel({ season: 2026, status: "in_season", weeksPlayed: 0 }), "Standings");
  assert.strictEqual(c.standingsLabel({ season: 2025, status: "complete", weeksPlayed: 14 }), "Final Standings");
  assert.strictEqual(c.standingsLabel({ season: "All-Time", status: "in_season", weeksPlayed: 3 }), "Final Standings");
  assert.strictEqual(c.standingsLabel({ season: 2026, status: "pre_draft", weeksPlayed: 0 }), "Standings");
});

test("featuredMatchupPair: the pair with the best combined record; the higher scorer is `a`; ties go to the first pair", () => {
  const c = loadSiteModules(["config.js", "utils.js"]);
  c.__RAW__ = [
    { roster_id: 1, matchup_id: 1, points: 80 },
    { roster_id: 2, matchup_id: 1, points: 100 },
    { roster_id: 3, matchup_id: 2, points: 90 },
    { roster_id: 4, matchup_id: 2, points: 70 },
    { roster_id: 5, matchup_id: null, points: 60 },
    { roster_id: 6, matchup_id: 3, points: 60 },
  ];
  c.__STAND__ = [
    { rosterId: 1, wins: 2 }, { rosterId: 2, wins: 1 },
    { rosterId: 3, wins: 4 }, { rosterId: 4, wins: 3 },
    { rosterId: 6, wins: 9 },
  ];
  const r = c.featuredMatchupPair(c.__RAW__, c.__STAND__);
  assert.deepStrictEqual([r.a.roster_id, r.b.roster_id], [3, 4]);
  assert.strictEqual(r.sa.wins, 4);
  const tied = c.featuredMatchupPair(c.__RAW__, [{ rosterId: 1, wins: 3 }, { rosterId: 2, wins: 3 }, { rosterId: 3, wins: 3 }, { rosterId: 4, wins: 3 }]);
  assert.deepStrictEqual([tied.a.roster_id, tied.b.roster_id], [2, 1], "first pair wins the tie, higher scorer first");
});

test("featuredMatchupPair: nothing posted (or only unpaired rows) is null; a team missing from the standings counts as 0 wins", () => {
  const c = loadSiteModules(["config.js", "utils.js"]);
  assert.strictEqual(c.featuredMatchupPair([], []), null);
  assert.strictEqual(c.featuredMatchupPair(null, null), null);
  assert.strictEqual(c.featuredMatchupPair([{ roster_id: 1, matchup_id: 1, points: 5 }], []), null, "one side only");
  const r = c.featuredMatchupPair([{ roster_id: 1, matchup_id: 1, points: 5 }, { roster_id: 2, matchup_id: 1, points: 6 }], []);
  assert.strictEqual(r.sa, null);
  assert.strictEqual(r.sb, null);
});

function fakeRow(overrides) {
  return {
    rosterId: 1, teamName: "T", username: "tee", wins: 5, losses: 4, ties: 0, record: "5-4", overallRecord: "40-32",
    avgPpg: 110, stdDev: 12, playoffPct: 60, byePct: 10, rosRank: 3, boom: 2, bust: 1, prScore: 4, powerRank: 1, luckRank: 2,
    finishDistribution: [40, 30, 20, 10], ...overrides,
  };
}

test("Power Rankings table: Rank | Team | Δ first (so Team stays pinned beside Rank), and the first two columns are sticky", () => {
  const c = loadSiteModules(["config.js", "utils.js", "power-rankings.js"]);
  const html = c.renderPowerTable({ rows: [fakeRow()] }, null);
  const heads = [...html.match(/<thead>[\s\S]*?<\/thead>/)[0].matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepStrictEqual(heads.slice(0, 3), ["Rank", "Team", "Δ"]);
  assert.ok(html.includes("sticky-cols-2"));
});

test("odds heatmap: Team column sticky, and a gold cutoff after the last playoff spot", () => {
  const c = loadSiteModules(["config.js", "utils.js", "power-rankings.js"]);
  const rows = [fakeRow(), fakeRow({ rosterId: 2 }), fakeRow({ rosterId: 3 }), fakeRow({ rosterId: 4 })];
  const html = c.renderOddsTable({ rows, playoffTeams: 2 });
  assert.ok(html.includes("sticky-cols-1") && html.includes("odds-table"));
  const heads = [...html.matchAll(/<th class="([^"]*)">(\d+)<\/th>/g)].map((m) => [m[2], m[1].trim()]);
  assert.deepStrictEqual(heads, [["1", "in-playoffs"], ["2", "in-playoffs playoff-edge"], ["3", ""], ["4", ""]]);
  const firstRow = html.match(/<tbody><tr>([\s\S]*?)<\/tr>/)[1];
  assert.strictEqual((firstRow.match(/playoff-edge/g) || []).length, 1, "the cutoff line is drawn once per row");
  assert.ok(html.includes("playoff cutoff"));
});

test("odds heatmap: no cutoff line when everyone makes the playoffs or the count is unknown", () => {
  const c = loadSiteModules(["config.js", "utils.js", "power-rankings.js"]);
  const rows = [fakeRow(), fakeRow({ rosterId: 2 })];
  for (const playoffTeams of [undefined, 0, 2, 9]) {
    const html = c.renderOddsTable({ rows, playoffTeams });
    assert.ok(!html.includes("playoff-edge") && !html.includes("in-playoffs"), `playoffTeams=${playoffTeams}`);
  }
});

test("Home's Standings table pins Team and tucks the extra columns behind the 'more' toggle", () => {
  const html = read("index.html");
  assert.match(html, /<table class="stat-table compact-mobile sticky-cols-2 home-standings" id="home-standings">/);
  assert.ok(html.includes('id="standings-more"'));
  assert.ok((html.match(/class="col-more"/g) || []).length >= 3);
});
