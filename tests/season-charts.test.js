const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "charts.js", "manual-history.js", "season.js"]);
}

// A 3-week standings history for 3 teams, matching computeStandingsHistory's
// real shape closely enough to exercise standingsHistoryToRankSeries:
// team A finishes 1st, B 2nd, C 3rd, but the order shuffles along the way.
function fakeStandingsHistory() {
  return [
    {
      week: 1,
      standings: [
        { rosterId: 2, teamName: "Team B", username: "teamB", wins: 1, losses: 0, ties: 0 },
        { rosterId: 1, teamName: "Team A", username: "teamA", wins: 0, losses: 1, ties: 0 },
        { rosterId: 3, teamName: "Team C", username: "teamC", wins: 0, losses: 1, ties: 0 },
      ],
    },
    {
      week: 2,
      standings: [
        { rosterId: 1, teamName: "Team A", username: "teamA", wins: 2, losses: 0, ties: 0 },
        { rosterId: 2, teamName: "Team B", username: "teamB", wins: 1, losses: 1, ties: 0 },
        { rosterId: 3, teamName: "Team C", username: "teamC", wins: 0, losses: 2, ties: 0 },
      ],
    },
  ];
}

test("standingsHistoryToRankSeries: converts week-by-week snapshots into one rank series per team, matching each week's actual finishing position", () => {
  const ctx = setup();
  const series = ctx.standingsHistoryToRankSeries(fakeStandingsHistory());

  assert.strictEqual(series.length, 3, "one series per team");
  const teamA = series.find((s) => s.name === "teamA");
  assert.ok(teamA);
  assert.strictEqual(teamA.points[0].y, 2, "Team A was 2nd (behind Team B) in week 1");
  assert.strictEqual(teamA.points[1].y, 1, "Team A moved into 1st in week 2");

  const teamC = series.find((s) => s.name === "teamC");
  assert.strictEqual(teamC.points[1].y, 3, "Team C stayed last in week 2");
});

test("standingsHistoryToRankSeries: x labels are week numbers, not indices, so a chart starting mid-season still reads correctly", () => {
  const ctx = setup();
  const history = fakeStandingsHistory();
  history[0].week = 5; // as if this replay started at week 5, not week 1
  history[1].week = 6;
  const series = ctx.standingsHistoryToRankSeries(history);
  assert.strictEqual(series[0].points[0].x, "W5");
  assert.strictEqual(series[0].points[1].x, "W6");
});

test("standingsHistoryToRankSeries: falls back to teamName when a team has no username (e.g. an unclaimed roster)", () => {
  const ctx = setup();
  const history = fakeStandingsHistory();
  history.forEach((snap) => snap.standings.forEach((s) => { if (s.rosterId === 3) s.username = null; }));
  const series = ctx.standingsHistoryToRankSeries(history);
  const teamC = series.find((s) => s.name === "Team C");
  assert.ok(teamC, "should fall back to teamName when username is missing");
});

test("findPlayoffOddsAnnotations: finds the earliest week a team's odds lock in at 100% and stay there", () => {
  const ctx = setup();
  const dataset = {
    teamA: [70, 85, 99.8, 100, 100, 100],
    teamB: [30, 15, 0.2, 0, 0, 0],
  };
  const annotations = ctx.findPlayoffOddsAnnotations(dataset);
  const clinch = annotations.find((a) => a.seriesName === "teamA");
  assert.ok(clinch);
  assert.strictEqual(clinch.pointIndex, 2, "should mark week index 2 (99.8%, the first week it locks in and stays there)");
  assert.match(clinch.label, /Clinched — Wk 3/);
});

test("findPlayoffOddsAnnotations: finds the earliest week a team's odds bottom out near 0% and stay there", () => {
  const ctx = setup();
  const dataset = {
    teamA: [70, 85, 99.8, 100, 100, 100],
    teamB: [30, 15, 0.2, 0, 0, 0],
  };
  const annotations = ctx.findPlayoffOddsAnnotations(dataset);
  const eliminated = annotations.find((a) => a.seriesName === "teamB");
  assert.ok(eliminated);
  assert.strictEqual(eliminated.pointIndex, 2, "should mark week index 2 (0.2%, the first week it's within the elimination tolerance and stays there) — symmetric with the 99.5% clinch tolerance");
  assert.match(eliminated.label, /Eliminated — Wk 3/);
});

test("findPlayoffOddsAnnotations: a temporary dip to 100% that later drops back down doesn't count as clinched", () => {
  const ctx = setup();
  const dataset = { teamA: [80, 100, 90, 100, 100] }; // spikes to 100% at week 2 but drops back at week 3 — not really clinched until week 4
  const annotations = ctx.findPlayoffOddsAnnotations(dataset);
  const clinch = annotations.find((a) => a.seriesName === "teamA");
  assert.ok(clinch);
  assert.strictEqual(clinch.pointIndex, 3, "should skip the false-start spike at week 2 and mark the real, lasting clinch at week 4");
});

test("findPlayoffOddsAnnotations: only returns the single earliest clinch and elimination across the whole league, not one per team", () => {
  const ctx = setup();
  const dataset = {
    teamA: [90, 100, 100],
    teamB: [85, 95, 100], // clinches later than teamA
    teamC: [20, 5, 0],
    teamD: [30, 10, 0], // eliminated later than teamC
  };
  const annotations = ctx.findPlayoffOddsAnnotations(dataset);
  assert.strictEqual(annotations.length, 2, "exactly one clinch annotation and one elimination annotation, not four");
  assert.strictEqual(annotations.find((a) => a.color === "var(--gold)").seriesName, "teamA");
  assert.strictEqual(annotations.find((a) => a.color === "var(--rust)").seriesName, "teamC");
});

test("findPlayoffOddsAnnotations: returns an empty array when nobody has clinched or been eliminated yet", () => {
  const ctx = setup();
  const dataset = { teamA: [60, 55, 62], teamB: [40, 45, 38] };
  const annotations = ctx.findPlayoffOddsAnnotations(dataset);
  assert.deepStrictEqual([...annotations], []);
});
