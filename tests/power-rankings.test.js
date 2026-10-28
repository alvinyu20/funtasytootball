const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "power-rankings.js"]);
}

function fakeRow(overrides) {
  return {
    rosterId: 1,
    teamName: "Test Team",
    wins: 5,
    losses: 4,
    ties: 0,
    record: "5-4",
    overallRecord: "40-32",
    avgPpg: 110.5,
    stdDev: 12.3,
    playoffPct: 62.5,
    byePct: 10.2,
    rosRank: 3,
    boom: 2,
    bust: 1,
    prScore: 4.1,
    powerRank: 1,
    luckRank: 2,
    finishDistribution: [50, 30, 20],
    ...overrides,
  };
}

test("power-rankings.js loads with no live-data dependency: only config.js and utils.js, not sleeper-api.js or deep-history.js", () => {
  // This IS the test, in a sense -- setup() above only loads the two
  // files a purely snapshot-reading page should need. If a future
  // edit reintroduces a live SleeperAPI/DeepHistory call, this file
  // list would need to grow, which is exactly the kind of change that
  // should prompt someone to notice this comment.
  const ctx = setup();
  assert.strictEqual(typeof ctx.renderPowerRankings, "function");
});

test("deltaBadge: shows NEW when there's no last-week data at all for this team", () => {
  const ctx = setup();
  const badge = ctx.deltaBadge(fakeRow({ teamName: "Alice", powerRank: 3 }), null);
  assert.ok(badge.includes("NEW"));
});

test("deltaBadge: shows NEW for a team specifically missing from an otherwise-present last-week snapshot (a team that's new to the league this season)", () => {
  const ctx = setup();
  const badge = ctx.deltaBadge(fakeRow({ teamName: "Brandnew", powerRank: 5 }), { SomeoneElse: 2 });
  assert.ok(badge.includes("NEW"));
});

test("deltaBadge: an improved rank (lower number) shows an up arrow with the right magnitude", () => {
  const ctx = setup();
  // was #5 last week, now #2 -- moved up 3 spots
  const badge = ctx.deltaBadge(fakeRow({ teamName: "Alice", powerRank: 2 }), { Alice: 5 });
  assert.ok(badge.includes("▲3"));
});

test("deltaBadge: a worse rank (higher number) shows a down arrow", () => {
  const ctx = setup();
  // was #2 last week, now #6 -- dropped 4 spots
  const badge = ctx.deltaBadge(fakeRow({ teamName: "Alice", powerRank: 6 }), { Alice: 2 });
  assert.ok(badge.includes("▼4"));
});

test("deltaBadge: an unchanged rank shows nothing at all, not an arrow and not a dash", () => {
  const ctx = setup();
  assert.strictEqual(ctx.deltaBadge(fakeRow({ teamName: "Alice", powerRank: 4 }), { Alice: 4 }), "");
});

test("renderPowerTable: renders every row's team name and core stats", () => {
  const ctx = setup();
  const snapshot = { rows: [fakeRow({ teamName: "Alice's Team", powerRank: 1 }), fakeRow({ teamName: "Bob's Team", powerRank: 2 })] };
  const html = ctx.renderPowerTable(snapshot, null);
  assert.ok(html.includes("Alice&#39;s Team"));
  assert.ok(html.includes("Bob&#39;s Team"));
  assert.ok(html.includes("#1") && html.includes("#2"));
});

test("renderPowerTable: a team with no ROS rank shows an em dash there, never 'null', 'undefined' or 'NaN'", () => {
  const ctx = setup();
  const snapshot = { byeTeams: 0, rows: [fakeRow({ byePct: null, rosRank: null })] };
  const html = ctx.renderPowerTable(snapshot, null);
  assert.strictEqual(html.match(/<td class="pr-ros">([^<]*)</)[1], "\u2014");
  assert.ok(!/null|undefined|NaN/.test(html));
});

test("renderPreseasonContent: shows only rank, username, and team name — no record, PR score, or any computed stat, since none exist yet", () => {
  const ctx = setup();
  const snapshot = {
    rows: [
      { rank: 1, username: "mayshisha", teamName: "The JAIL BLAZERS" },
      { rank: 2, username: "evangonnerman", teamName: "Big Vibes" },
    ],
  };
  const html = ctx.renderPreseasonContent(snapshot);
  assert.ok(html.includes("mayshisha") && html.includes("The JAIL BLAZERS"));
  assert.ok(html.includes("evangonnerman") && html.includes("Big Vibes"));
  assert.ok(html.includes("#1") && html.includes("#2"));
  // None of the full-table columns should appear anywhere in this view.
  ["PR Score", "Playoff%", "Std Dev", "Overall", "Boom", "Bust"].forEach((col) => {
    assert.ok(!html.includes(col), `preseason view should not show the "${col}" column`);
  });
});

test("renderPreseasonContent: a team with no custom team name (Sleeper default) shows an em dash rather than 'null' or 'undefined'", () => {
  const ctx = setup();
  const snapshot = { rows: [{ rank: 7, username: "jspar279879", teamName: null }] };
  const html = ctx.renderPreseasonContent(snapshot);
  assert.ok(html.includes("jspar279879"));
  assert.ok(!html.includes("null") && !html.includes("undefined"));
});

test("formatGeneratedAt: renders a readable date from an ISO timestamp", () => {
  const ctx = setup();
  assert.strictEqual(ctx.formatGeneratedAt("2026-09-16T14:32:00Z"), "Sep 16, 2026");
});

test("formatGeneratedAt: returns an empty string for a missing or invalid timestamp, rather than 'Invalid Date'", () => {
  const ctx = setup();
  assert.strictEqual(ctx.formatGeneratedAt(null), "");
  assert.strictEqual(ctx.formatGeneratedAt("not a date"), "");
});

/* ---------------------------------------------------------------------------
   The tiered table, the phone list and the finish-probability grid.
   --------------------------------------------------------------------------- */
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");

// Twelve teams the way the live page sees them (Week 7): rank order, real-looking numbers.
function league() {
  const scores = [1.0, 2.61, 3.1, 4.61, 5.47, 6.16, 6.21, 8.77, 9.22, 9.9, 10.01, 10.95];
  return scores.map((prScore, i) =>
    fakeRow({
      rosterId: i + 1,
      teamName: `team${i + 1}`,
      powerRank: i + 1,
      prScore,
      wins: 6 - Math.floor(i / 3),
      losses: 1 + Math.floor(i / 3),
      record: `${6 - Math.floor(i / 3)}-${1 + Math.floor(i / 3)}`,
      overallRecord: `${60 - i * 3}-${16 + i * 3}`,
      avgPpg: 150 - i * 3,
      stdDev: 15 + i,
      playoffPct: 99 - i * 8,
      byePct: i < 6 ? 60 - i * 10 : 0,
      rosRank: i + 1,
      finishDistribution: Array.from({ length: 12 }, (_, k) => (k === i ? 40 : k === 11 - i ? 10 : 50 / 10)),
    })
  );
}
const snap12 = (over) => ({ season: "2026", week: 7, playoffTeams: 6, byeTeams: 2, rows: league(), ...over });

test("tiers: a new tier starts wherever neighboring PR Scores are 1.4 or more apart, and only there", () => {
  const ctx = setup();
  const tiers = ctx.powerTiers(league());
  const ranksOf = (tt) => JSON.parse(JSON.stringify(tt.map((t) => t.map((r) => r.powerRank)))); // out of the page's realm for deepStrictEqual
  assert.deepStrictEqual(ranksOf(tiers), [[1], [2, 3], [4, 5, 6, 7], [8, 9, 10, 11, 12]]);
  // exactly 1.4 apart splits; 1.39 does not
  const rows = [fakeRow({ powerRank: 1, prScore: 2 }), fakeRow({ powerRank: 2, prScore: 3.4 }), fakeRow({ powerRank: 3, prScore: 4.79 })];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.powerTiers(rows).map((t) => t.length))), [1, 2]);
  assert.strictEqual(ctx.powerTiers([]).length, 0);
});

test("tiers: each header says the range of playoff odds inside it, one number for a tier of one", () => {
  const ctx = setup();
  const html = ctx.renderPowerTable(snap12(), null);
  const tableHtml = html.slice(0, html.indexOf('<div class="pr-phone">'));
  const headers = [...tableHtml.matchAll(/class="pr-tier-name">(Tier \d+)<\/span><span class="pr-tier-odds">([^<]*)</g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(headers, [
    ["Tier 1", "99.0% to make the playoffs"],
    ["Tier 2", "83.0\u201391.0% to make the playoffs"],
    ["Tier 3", "51.0\u201375.0% to make the playoffs"],
    ["Tier 4", "11.0\u201343.0% to make the playoffs"],
  ]);
  assert.ok(html.includes("Tier 1</span><span class=\"pr-tier-odds\">99.0% to make it"), "the phone list says it shorter");
});

test("the table and the phone list carry the same teams in the same order, and the list has nothing the table lacks", () => {
  const ctx = setup();
  const html = ctx.renderPowerTable(snap12(), { team2: 3, team5: 5, team9: 8 });
  const table = html.slice(0, html.indexOf('<div class="pr-phone">'));
  const phone = html.slice(html.indexOf('<div class="pr-phone">'));
  const names = (chunk) => [...chunk.matchAll(/class="pr-name-text" data-username="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(names(table), league().map((r) => r.teamName));
  assert.deepStrictEqual(names(phone), names(table));
  const heads = [...table.match(/<thead>[\s\S]*?<\/thead>/)[0].matchAll(/<th class="[^"]*">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepStrictEqual(heads, ["Rank", "Team", "PR Score", "Record", "Luck", "Avg PPG", "Std Dev", "Bye \u00b7 Playoffs \u00b7 Out", "ROS"]);
  // Boom, Bust, Overall and Luck rank are not in the new table, so the phone list must not show them either.
  for (const word of ["Boom", "Bust", "Overall"]) assert.ok(!html.includes(word), `${word} is gone from both`);
  // every stat the phone list shows in its extra panel is one the table shows
  const labels = [...phone.matchAll(/<dt>([^<]*)<\/dt>/g)].map((m) => m[1]);
  assert.deepStrictEqual([...new Set(labels)], ["Avg PPG", "Luck", "ROS rank", "Std dev", "Ovr"]);
});

test("a team's move sits beside its name: up and down arrows with the size of the move, nothing for no move, NEW for no history", () => {
  const ctx = setup();
  const html = ctx.renderPowerTable(snap12(), { team2: 3, team3: 1, team4: 4 });
  const table = html.slice(0, html.indexOf('<div class="pr-phone">'));
  const rowFor = (n) => table.match(new RegExp(`data-username="team${n}"[\\s\\S]*?</td>`))[0];
  assert.ok(rowFor(2).includes("\u25B21") && rowFor(2).includes("luck-positive"), "was 3rd, now 2nd");
  assert.ok(rowFor(3).includes("\u25BC2") && rowFor(3).includes("luck-negative"), "was 1st, now 3rd");
  assert.ok(!rowFor(4).includes("pr-move"), "unchanged: no marker");
  assert.ok(rowFor(5).includes("NEW"), "no rank last week");
});

test("Luck is actual win % minus all-play win %, the same number DeepHistory gives Home", () => {
  const c = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "power-rankings.js"]);
  const cases = [
    { wins: 6, losses: 1, ties: 0, overallRecord: "60-16-1" },
    { wins: 2, losses: 5, ties: 0, overallRecord: "40-37" },
    { wins: 4, losses: 3, ties: 1, overallRecord: "37-40-3" },
  ];
  cases.forEach((r) => {
    const [w, l, t] = r.overallRecord.split("-").map(Number);
    const expected = c.DeepHistory.luckPercent(r.wins, r.losses, r.ties, w, l, t || 0);
    assert.ok(Math.abs(c.rowLuckPct(r) - expected) < 1e-9, r.overallRecord);
  });
  assert.strictEqual(c.rowLuckPct({ wins: 0, losses: 0, ties: 0, overallRecord: "0-0" }), null, "no games yet");
  assert.strictEqual(c.rowLuckPct({ wins: 3, losses: 1, ties: 0, overallRecord: "n/a" }), null);
  const lucky = c.renderPowerTable({ byeTeams: 0, rows: [fakeRow({ wins: 6, losses: 1, overallRecord: "60-16-1" })] }, null);
  assert.ok(lucky.includes('<span class="luck-positive">+7.8%</span>'), "yellow when lucky");
  const unlucky = c.renderPowerTable({ byeTeams: 0, rows: [fakeRow({ wins: 2, losses: 5, overallRecord: "40-37" })] }, null);
  assert.ok(unlucky.includes('<span class="luck-negative">-23.4%</span>'), "blue when unlucky");
});

test("the three-way bar: bye, playoffs without a bye and miss always add up to 100, and a league with no byes has no bye segment or legend", () => {
  const ctx = setup();
  const split = ctx.playoffSplit(fakeRow({ playoffPct: 84.7, byePct: 12.1 }), 2);
  assert.ok(Math.abs(split.bye + split.playoffs + split.miss - 100) < 1e-9);
  assert.deepStrictEqual([split.bye, Math.round(split.playoffs * 10) / 10, Math.round(split.miss * 10) / 10], [12.1, 72.6, 15.3]);
  const noBye = ctx.playoffSplit(fakeRow({ playoffPct: 50, byePct: 10 }), 0);
  assert.deepStrictEqual([noBye.bye, noBye.playoffs, noBye.miss], [0, 50, 50]);
  const clamped = ctx.playoffSplit(fakeRow({ playoffPct: 20, byePct: 35 }), 2);
  assert.strictEqual(clamped.bye, 20, "a bye can't be likelier than the playoffs");
  const html = ctx.renderPowerTable({ byeTeams: 0, rows: [fakeRow()] }, null);
  assert.ok(!html.includes("pr-seg bye") && !html.includes("pr-swatch bye") && html.includes("Playoffs \u00b7 Out"));
  assert.ok(ctx.renderPowerTable(snap12(), null).includes("pr-swatch bye"));
});

test("the PR Score line puts the lowest score at the left end and the highest at the right, one dot per team", () => {
  const ctx = setup();
  const span = ctx.minMax(league().map((r) => r.prScore));
  assert.strictEqual(ctx.spanPct(1.0, span), 0);
  assert.strictEqual(ctx.spanPct(10.95, span), 100);
  assert.ok(ctx.spanPct(6.16, span) > 50 && ctx.spanPct(6.16, span) < 60);
  assert.strictEqual(ctx.spanPct(5, { min: 5, max: 5 }), 50, "everyone tied: centered, not NaN");
  assert.strictEqual((ctx.renderPowerTable(snap12(), null).match(/class="pr-dot"/g) || []).length, 12);
});

test("phone list: a team opens and closes on tap, keeping its button and panel in step", () => {
  const ctx = setup();
  const attrs = { "aria-controls": "pr-detail-1", "aria-expanded": "false" };
  const item = { open: false, classList: { toggle(c, on) { item.open = on; } } };
  const detail = { hidden: true };
  const button = { getAttribute: (k) => attrs[k], setAttribute: (k, v) => (attrs[k] = v), closest: () => item };
  ctx.document.getElementById = () => detail;
  ctx.togglePhoneRow(button);
  assert.deepStrictEqual([attrs["aria-expanded"], detail.hidden, item.open], ["true", false, true]);
  ctx.togglePhoneRow(button);
  assert.deepStrictEqual([attrs["aria-expanded"], detail.hidden, item.open], ["false", true, false]);
  const html = ctx.renderPowerTable(snap12(), null);
  assert.strictEqual((html.match(/aria-expanded="false"/g) || []).length, 12, "every team starts closed");
  assert.strictEqual((html.match(/ hidden>/g) || []).length, 12);
});

test("My Team: the phone list rows are highlighted and tagged YOU like every other list", () => {
  const src = fs.readFileSync(path.join(ROOT, "js", "my-team.js"), "utf8");
  assert.ok(src.match(/const ROW_SELECTOR = "([^"]+)"/)[1].includes(".pr-phone-item"));
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");
  assert.ok(css.includes(".pr-phone-item.mine {"));
  assert.ok(css.includes("tr.mine .pr-name-text::after") && css.includes(".pr-phone-item.mine .pr-name-text::after"), "YOU tag after the name in the table, the grid and the list");
});

test("the table shows from 1100px up and the phone list below it, by CSS alone", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");
  assert.match(css, /@media \(max-width: 1099px\) \{\s*\.pr-board-wrap \{ display: none; \}\s*\.pr-phone \{ display: block; \}/);
  assert.match(css, /\.pr-phone \{ display: none; \}/);
});

// ---- the grid ----

test("grid shades: six steps by chance, and a dash only for a chance that never came up", () => {
  const ctx = setup();
  const shade = (p) => ctx.oddsShade(p);
  assert.deepStrictEqual([0, 0.01, 0.99, 1, 4.99, 5, 9.99, 10, 19.99, 20, 34.99, 35, 100].map(shade), ["none", "u1", "u1", "s1", "s1", "s5", "s5", "s10", "s10", "s20", "s20", "s35", "s35"]);
  assert.strictEqual(shade(null), "none");
  assert.strictEqual(shade(NaN), "none");
});

test("grid labels: whole numbers from 1 up, one decimal under 1, <0.1 for a sliver, a dash for nothing", () => {
  const ctx = setup();
  const label = (p) => ctx.oddsLabel(p);
  assert.deepStrictEqual([70.4, 17.5, 5, 1.2, 1].map(label), ["70", "18", "5", "1", "1"]);
  assert.deepStrictEqual([0.6, 0.2, 0.1, 0.12].map(label), ["0.6", "0.2", "0.1", "0.1"]);
  assert.strictEqual(label(0.96), "0.9", "still under 1, so it never reads as a whole 1 or 1.0");
  assert.strictEqual(label(0.04), "<0.1");
  assert.strictEqual(label(0.01), "<0.1", "a 10,000-run simulation can see 0.01%");
  assert.strictEqual(label(0), "\u2014");
});

test("expected finish: the average final rank, ordering the rows best to worst", () => {
  const ctx = setup();
  assert.strictEqual(ctx.expectedFinish([100, 0, 0]), 1);
  assert.strictEqual(ctx.expectedFinish([50, 0, 50]), 2);
  assert.ok(Math.abs(ctx.expectedFinish([25, 25, 25, 25]) - 2.5) < 1e-9);
  assert.strictEqual(ctx.expectedFinish([]), null);
  assert.strictEqual(ctx.expectedFinish([0, 0]), null);
  assert.strictEqual(ctx.expectedFinish(undefined), null);
  const rows = [
    fakeRow({ teamName: "late", powerRank: 1, finishDistribution: [0, 0, 100] }),
    fakeRow({ teamName: "early", powerRank: 3, finishDistribution: [100, 0, 0] }),
    fakeRow({ teamName: "mid", powerRank: 2, finishDistribution: [0, 100, 0] }),
    fakeRow({ teamName: "none", powerRank: 4, finishDistribution: undefined }),
  ];
  const html = ctx.renderOddsTable({ rows, playoffTeams: 0, byeTeams: 0 });
  const order = [...html.matchAll(/class="pr-name-text" data-username="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(order, ["early", "mid", "late", "none"], "by expected finish; a team with no distribution goes last");
});

test("grid: one column per final rank, bye / playoffs / out headers sized to the zones, a dashed line after the byes and a gold one after the last playoff spot", () => {
  const ctx = setup();
  const html = ctx.renderOddsTable(snap12());
  const ranks = [...html.matchAll(/<th class="rk">(\d+)<\/th>/g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(ranks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const zones = [...html.matchAll(/<th colspan="(\d+)" class="zone zone-(\w+)">([^<]*)</g)].map((m) => [m[2], Number(m[1]), m[3]]);
  assert.deepStrictEqual(zones, [["bye", 2, "Bye"], ["playoffs", 4, "Playoffs"], ["out", 6, "Out"]]);
  const firstRow = html.match(/<tbody><tr>([\s\S]*?)<\/tr>/)[1];
  const cells = [...firstRow.matchAll(/<td class="odds-cell ([^"]*)"/g)].map((m) => m[1]);
  assert.strictEqual(cells.length, 12);
  assert.ok(cells[1].includes("bye-edge") && !cells[1].includes("playoff-edge"), "dashed after 2nd");
  assert.ok(cells[5].includes("playoff-edge") && !cells[5].includes("bye-edge"), "gold after 6th");
  assert.strictEqual((firstRow.match(/bye-edge/g) || []).length, 1);
  assert.strictEqual((firstRow.match(/playoff-edge/g) || []).length, 1);
});

test("grid: no bye zone in a league without byes, and no zones or lines at all when everyone makes the playoffs or the count is unknown", () => {
  const ctx = setup();
  const noBye = ctx.renderOddsTable(snap12({ byeTeams: 0 }));
  assert.ok(!noBye.includes("zone-bye") && !noBye.includes("bye-edge") && noBye.includes("zone-playoffs") && noBye.includes("playoff-edge"));
  const rows = [fakeRow(), fakeRow({ rosterId: 2 })];
  for (const playoffTeams of [undefined, 0, 2, 9]) {
    const html = ctx.renderOddsTable({ rows, playoffTeams, byeTeams: 1 });
    assert.ok(!html.includes("playoff-edge") && !html.includes("bye-edge") && !html.includes("pr-zone-row"), `playoffTeams=${playoffTeams}`);
  }
  // a bye count that is not smaller than the playoff field is ignored rather than drawn wrong
  const odd = ctx.renderOddsTable(snap12({ playoffTeams: 4, byeTeams: 4 }));
  assert.ok(!odd.includes("zone-bye") && !odd.includes("bye-edge"));
});

test("grid: the most likely finish of each row gets the ring; every cell has a hover title in full", () => {
  const ctx = setup();
  const html = ctx.renderOddsTable(snap12());
  const bodyRows = html.match(/<tbody>[\s\S]*<\/tbody>/)[0].split("<tr>").slice(1);
  assert.strictEqual(bodyRows.length, 12);
  bodyRows.forEach((r) => assert.strictEqual((r.match(/ best/g) || []).length, 1, "one ring per team"));
  assert.ok(html.includes('title="team1 \u00b7 1st place \u00b7 40%"'));
  assert.ok(html.includes("2nd place"));
});

test("grid: zero is a dash and a faint sliver keeps its number, so 'possible' and 'not happening' look different", () => {
  const ctx = setup();
  const dist = [60, 30, 9.5, 0.4, 0.07, 0.03, 0, 0, 0, 0, 0, 0];
  const rows = league();
  rows[0].finishDistribution = dist;
  const html = ctx.renderOddsTable({ playoffTeams: 6, byeTeams: 2, rows });
  const cells = html
    .match(/<tbody><tr>[\s\S]*?<\/tr>/)[0] // the row with this distribution sorts first (best expected finish)
    .split("</td>")
    .filter((c) => c.includes('class="odds-cell'))
    .map((c) => [c.match(/class="odds-cell ([a-z0-9]+)/)[1], c.slice(c.lastIndexOf(">") + 1).replace("&lt;", "<")]);
  assert.deepStrictEqual(cells.slice(0, 7), [["s35", "60"], ["s20", "30"], ["s5", "10"], ["u1", "0.4"], ["u1", "<0.1"], ["u1", "<0.1"], ["none", "\u2014"]]);
});

test("grid: how many runs it came from is printed from the snapshot (1,000 for a snapshot that does not say, 10,000 for a new one)", () => {
  const ctx = setup();
  const old = ctx.renderOddsTable(snap12());
  assert.ok(old.includes("None in 1,000 runs") && old.includes("from a 1,000-run simulation") && old.includes("never happened in 1,000 runs"));
  const fresh = ctx.renderOddsTable(snap12({ simRuns: 10000 }));
  assert.ok(fresh.includes("None in 10,000 runs") && fresh.includes("from a 10,000-run simulation") && fresh.includes("never happened in 10,000 runs"));
  assert.ok(!fresh.includes("1,000 runs"));
  assert.strictEqual(ctx.simRunsOf({ simRuns: 0 }), 1000);
  assert.strictEqual(ctx.simRunsOf({ simRuns: "x" }), 1000);
});

test("grid takeaway: surest bet, widest-open team, and exact counts of never and under-1% cells", () => {
  const ctx = setup();
  const rows = [
    fakeRow({ teamName: "sure", powerRank: 1, finishDistribution: [80, 20, 0] }),
    fakeRow({ teamName: "open", powerRank: 2, finishDistribution: [10, 45, 45] }),
    fakeRow({ teamName: "mid", powerRank: 3, finishDistribution: [10, 35, 55] }),
  ];
  rows[0].finishDistribution = [80, 19.5, 0.5];
  const html = ctx.renderOddsTable({ playoffTeams: 0, byeTeams: 0, simRuns: 10000, rows });
  const text = html.match(/<p class="pr-takeaway">([\s\S]*?)<\/p>/)[1];
  assert.ok(text.includes("sure is the surest bet, finishing 1st in 80% of runs."), text);
  assert.ok(text.includes("open has the most open range: even its likeliest finish (2nd) only comes up 45% of the time."), text);
  assert.ok(text.includes("Of the 9 cells, 0 never happened in 10,000 runs and another 1 are under 1% but still possible."), text);
  // a single team has nothing to compare
  assert.ok(!ctx.renderOddsTable({ playoffTeams: 0, rows: [fakeRow()] }).includes("pr-takeaway"));
});

test("nothing from the design mockups leaked into the page: no option labels, headline copy or explainer cards", () => {
  const src = fs.readFileSync(path.join(ROOT, "js", "power-rankings.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");
  const html = fs.readFileSync(path.join(ROOT, "power-rankings.html"), "utf8");
  const mockupOnly = [/option b/i, /every chance stays on the board/i, /same cleaner grid/i, /zones labeled/i, /best guess ringed/i, /small chances kept/i, /dash means zero/i, /expected finish<\/(h|strong)/i, /power rankings \u00b7 phone/i, /mockup/i];
  [src, html].forEach((text) => mockupOnly.forEach((re) => assert.ok(!re.test(text), String(re))));
  assert.ok(!/mockup/i.test(css.slice(css.indexOf("POWER RANKINGS: tiered table"))));
  const page = setup().renderContent(snap12({ generatedAt: "2026-10-27T16:00:00Z" }), null, null, null);
  assert.ok(!/12 teams \u00b7 6 make the playoffs/.test(page), "the team count line already lives in the page header");
});

test("renderContent: panel headings, the season tag, and one footnote that explains the table (including the tier rule)", () => {
  const ctx = setup();
  const html = ctx.renderContent(snap12({ generatedAt: "2026-10-27T16:00:00Z" }), null, null, null);
  assert.ok(html.includes('<h2>Power Rankings<span class="pr-season-tag">2026 \u00b7 After Week 7</span></h2>'));
  assert.ok(html.includes("<h2>Finish Probability By Rank</h2>"));
  assert.ok(html.includes("Luck is actual win % minus Ovr win %. Tiers start where neighboring PR Scores are 1.4 or more apart."));
  assert.ok(html.indexOf("pr-board-wrap") < html.indexOf("Playoff Odds") && html.indexOf("Playoff Odds") < html.indexOf('class="pr-odds"'));
});

test("the record cell labels the second record 'Ovr', not 'all-play', in the table and the phone list", () => {
  const ctx = setup();
  const html = ctx.renderPowerTable(snap12(), null);
  const table = html.slice(0, html.indexOf('<div class="pr-phone">'));
  assert.ok(table.includes('<span class="pr-ovr">60-16 Ovr</span>'));
  assert.strictEqual((table.match(/ Ovr<\/span>/g) || []).length, 12);
  assert.ok(!/all-play<\/span>|All-play/.test(html), "the label is gone from the rows");
  assert.ok(html.includes("<dt>Ovr</dt>"));
});
