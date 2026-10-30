const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "power-rankings.js"]);

function row(name, titlePct, extra) {
  return { rosterId: 1, teamName: name, username: name, record: "4-3", avgPpg: 120.5, playoffPct: 60, byePct: 20, powerRank: 1, titlePct, ...extra };
}

test("titleLabel: every nonzero chance shows, so 'possible' and 'impossible' stay apart", () => {
  assert.strictEqual(ctx.titleLabel(24.44), "24.4%");
  assert.strictEqual(ctx.titleLabel(0.03), "<0.1%");
  assert.strictEqual(ctx.titleLabel(0), "—");
  assert.strictEqual(ctx.titleLabel(null), "—");
});

test("hasTitleOdds: only a snapshot that carries titlePct for every team gets the panel", () => {
  assert.strictEqual(ctx.hasTitleOdds({ rows: [row("A", 10), row("B", 5)] }), true);
  assert.strictEqual(ctx.hasTitleOdds({ rows: [row("A", 10), row("B", undefined)] }), false);
  assert.strictEqual(ctx.hasTitleOdds({ rows: [] }), false);
});

test("renderTitleOdds: nothing at all for an older snapshot with no title odds", () => {
  assert.strictEqual(ctx.renderTitleOdds({ rows: [row("A", undefined)], playoffTeams: 6, byeTeams: 2 }, ""), "");
});

test("renderTitleOdds: teams sorted by title chance, Title sits right after Team, and there is no odds-by-seed table", () => {
  const snapshot = {
    playoffTeams: 6,
    byeTeams: 2,
    titleSimRuns: 200000,
    rows: [row("Low Team", 3.2), row("Top Team", 31.9), row("Mid Team", 12.1)],
  };
  const html = ctx.renderTitleOdds(snapshot, "<span class=\"chip\">chip</span>");
  assert.ok(html.indexOf("Top Team") < html.indexOf("Mid Team") && html.indexOf("Mid Team") < html.indexOf("Low Team"));
  const heads = [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepStrictEqual(heads, ["#", "Team", "Title", "Playoffs", "Bye", "Record", "Avg PPG"]);
  assert.ok(html.includes("31.9%"));
  assert.ok(html.includes("200,000-run simulation"));
  assert.ok(html.includes("top 2 get a bye"));
  assert.ok(!html.includes("By Seed"), "title odds are one number, not a table by seed");
});

test("renderTitleOdds: leaves out the Bye column in a league without byes", () => {
  const html = ctx.renderTitleOdds({ playoffTeams: 4, byeTeams: 0, rows: [row("A", 60, { byePct: null }), row("B", 40, { byePct: null })] }, "");
  const heads = [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepStrictEqual(heads, ["#", "Team", "Title", "Playoffs", "Record", "Avg PPG"]);
});

function mvpExtras(overrides) {
  const r = (i, name, pos, par, proj, chance) => ({
    playerId: String(i), player: name, position: pos, owner: "someone", par, wins: par / 85.8, ppg: 20, gamesPlayed: 7,
    weekly: [20, 22, 18, 25, 0, 21, 19], projectedPar: proj, chance,
  });
  return Object.assign(
    {
      season: "2026",
      week: 7,
      mvpRace: {
        throughWeek: 7,
        remainingWeeks: 7,
        sims: 20000,
        pointsPerWin: 85.76,
        rows: [
          r(1, "Alpha Back", "RB", 118, 193, 39.2),
          r(2, "Beta Wideout", "WR", 120, 186, 29.1),
          r(3, "Gamma Back", "RB", 98, 166, 12),
          r(4, "Delta Passer", "QB", 92, 152, 6),
          r(5, "Echo Back", "RB", 86, 146, 5),
          r(6, "Foxtrot Back", "RB", 81, 138, 1.4),
          r(7, "Golf Wideout", "WR", 80, 135, 0.04),
        ],
      },
    },
    overrides
  );
}

test("mvpChanceLabel: whole percents above 1%, one decimal below it, and a floor label for near-zero", () => {
  assert.strictEqual(ctx.mvpChanceLabel(39.2), "39%");
  assert.strictEqual(ctx.mvpChanceLabel(1.4), "1%");
  assert.strictEqual(ctx.mvpChanceLabel(0.8), "0.8%");
  assert.strictEqual(ctx.mvpChanceLabel(0.04), "<0.1%");
  assert.strictEqual(ctx.mvpChanceLabel(0), "—");
});

test("renderMvpRace: five cards for the best players, the rest in a table, projected final always shown, no range", () => {
  const html = ctx.renderMvpRace(mvpExtras(), { season: "2026", week: 7 }, "");
  assert.strictEqual((html.match(/class="mvp-card( lead)?"/g) || []).length, 5);
  assert.ok(html.includes("Alpha Back") && html.includes("Echo Back"));
  assert.ok(html.includes("Foxtrot Back") && html.includes("Golf Wideout"), "ranks 6 and 7 are in the table");
  assert.strictEqual((html.match(/<span>Projected final<\/span>/g) || []).length, 5);
  assert.ok(html.includes(">193<"));
  assert.ok(html.includes("39%"));
  assert.ok(html.includes("1.4 W"), "points above replacement are also shown in wins");
  assert.ok(!/80%|range|low\s*[–-]\s*high/i.test(html), "no confidence range is shown");
});

test("renderMvpRace: stays out of the way when the data is from another week or missing", () => {
  assert.strictEqual(ctx.renderMvpRace(mvpExtras({ week: 6 }), { season: "2026", week: 7 }, ""), "");
  assert.strictEqual(ctx.renderMvpRace({ season: "2026", week: 7 }, { season: "2026", week: 7 }, ""), "");
  assert.strictEqual(ctx.renderMvpRace(null, { season: "2026", week: 7 }, ""), "");
});
