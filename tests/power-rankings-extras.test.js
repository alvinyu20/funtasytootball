/*
  The Power Rankings page's Strength of Schedule, Weekly Scores and Lineup Slot
  sections (js/power-rankings.js, fed by data/power-rankings-extras.json).
  Fixtures are small and worked out by hand: positions on the axes, bar widths,
  who is "steadiest" and "biggest flip" are all checkable on paper.
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules } = require("./helpers/site-env.js");

const ROOT = path.join(__dirname, "..");
const setup = () => loadSiteModules(["config.js", "utils.js", "power-rankings.js"]);
const CHIP = '<span class="fresh-chip">chip</span>';

// Six teams, so a flip is a move of 3+ spots. PA/G rank vs true rank:
// T1 6->1, T2 5->2, T3 4->4, T4 3->3, T5 2->5, T6 1->6.
function sosFixture() {
  const row = (teamName, paPerGame, trueSos, paRank, trueRank, ahead, record = "3-2") => ({ rosterId: 1, teamName, record, games: 5, paPerGame, trueSos, paRank, trueRank, ahead });
  return {
    leagueAvgPpg: 127.8,
    remaining: { fromWeek: 6, toWeek: 14, games: 9 },
    rows: [
      row("T6", 140, 118, 1, 6, { games: 9, oppPpg: 126.8, delta: -1 }),
      row("T3", 122, 124, 4, 4, { games: 9, oppPpg: 128, delta: 0.2 }),
      row("T1", 105, 130, 6, 1, { games: 9, oppPpg: 133.8, delta: 6 }, "4-1"),
      row("T5", 135, 120, 2, 5, { games: 9, oppPpg: 124.8, delta: -3 }),
      row("T2", 110, 128, 5, 2, { games: 9, oppPpg: 131.1, delta: 3.3 }),
      row("T4", 128, 125, 3, 3, { games: 9, oppPpg: 126.3, delta: -1.5 }),
    ],
  };
}

test("scheduleWord, sosFlipThreshold, signed1, axisPct and niceAxis: the small helpers", () => {
  const c = setup();
  assert.strictEqual(c.scheduleWord(1, 12), "the hardest schedule");
  assert.strictEqual(c.scheduleWord(12, 12), "the easiest schedule");
  assert.strictEqual(c.scheduleWord(4, 12), "a tough schedule");
  assert.strictEqual(c.scheduleWord(9, 12), "an easy schedule");
  assert.strictEqual(c.scheduleWord(6, 12), "a middling schedule");
  assert.strictEqual(c.sosFlipThreshold(12), 4);
  assert.strictEqual(c.sosFlipThreshold(6), 3, "never less than 3");
  assert.strictEqual(c.sosFlipThreshold(14), 5);
  assert.strictEqual(c.signed1(8.14), "+8.1");
  assert.strictEqual(c.signed1(-3), "-3.0");
  assert.strictEqual(c.signed1(0), "0.0");
  assert.strictEqual(c.signed1(-0.04), "0.0", "a value that rounds to zero doesn't print -0.0");
  assert.strictEqual(c.axisPct(75, 50, 100), 50);
  assert.strictEqual(c.axisPct(-10, 0, 100), 0, "kept inside the track");
  assert.strictEqual(c.axisPct(500, 0, 100), 100);
  const axis = c.niceAxis([105, 140], 10, 3);
  assert.strictEqual(axis.min, 100);
  assert.strictEqual(axis.max, 150);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(axis.ticks)), [100, 110, 120, 130, 140, 150]);
});

test("extrasMatchSnapshot: only the same season and the same week", () => {
  const c = setup();
  const snap = { season: "2026", week: 5 };
  assert.strictEqual(c.extrasMatchSnapshot({ season: "2026", week: 5 }, snap), true);
  assert.strictEqual(c.extrasMatchSnapshot({ season: 2026, week: 5 }, snap), true, "a number vs a string season is still the same season");
  assert.strictEqual(c.extrasMatchSnapshot({ season: "2026", week: 4 }, snap), false);
  assert.strictEqual(c.extrasMatchSnapshot({ season: "2025", week: 5 }, snap), false);
  assert.strictEqual(c.extrasMatchSnapshot(null, snap), false);
});

test("Schedule Faced So Far: hardest true schedule first, with each team's PA/G rank -> true rank", () => {
  const c = setup();
  const html = c.renderSosPanel(sosFixture(), CHIP);
  assert.deepStrictEqual([...html.matchAll(/class="sos-name" data-username="([^"]+)"/g)].map((m) => m[1]), ["T1", "T2", "T4", "T3", "T5", "T6"], "true rank 1 to 6");
  assert.ok(html.indexOf("#6 → #1") < html.indexOf("#5 → #2") && html.indexOf("#5 → #2") < html.indexOf("#3 → #3"));
  assert.ok(html.includes("#1 → #6"));
  assert.ok(html.includes("PA/G → True"));
  assert.ok(html.includes("Schedule Faced So Far"));
  assert.ok(html.includes(CHIP));
});

test("Schedule Faced So Far: the ring sits at PA/G, the dot at true SOS, joined by a line, on a round-number axis", () => {
  const c = setup();
  const html = c.renderSosPanel(sosFixture(), CHIP);
  // axis 100-150: T1's PA/G 105 is 10% along, its true SOS 130 is 60%
  const t1 = html.slice(html.indexOf('data-username="T1"'), html.indexOf('data-username="T2"'));
  assert.ok(t1.includes('class="sos-link" style="left:10%;width:50%"'));
  assert.ok(t1.includes('class="sos-dot ring" style="left:10%"'));
  assert.ok(t1.includes('class="sos-dot fill" style="left:60%"'));
  // T5 is the other way round (PA/G 135 = 70%, true 120 = 40%): the link starts at the smaller one
  const t5 = html.slice(html.indexOf('data-username="T5"'), html.indexOf('data-username="T6"'));
  assert.ok(t5.includes('class="sos-link" style="left:40%;width:30%"'));
  assert.ok(t5.includes('sos-dot ring" style="left:70%"') && t5.includes('sos-dot fill" style="left:40%"'));
  assert.deepStrictEqual([...html.matchAll(/class="axis-tick" style="left:[\d.]+%">(\d+)</g)].map((m) => m[1]), ["100", "110", "120", "130", "140", "150"]);
});

test("Schedule Faced So Far: rows that moved at least the threshold are highlighted, the rest are not", () => {
  const c = setup();
  const html = c.renderSosPanel(sosFixture(), CHIP);
  const rows = html.split('<div class="sos-row').slice(2); // skip the text before the first row and the axis row
  const flagged = rows.filter((r) => r.startsWith(" flip")).map((r) => r.match(/data-username="([^"]+)"/)[1]);
  assert.deepStrictEqual(flagged.sort(), ["T1", "T2", "T5", "T6"], "moves of 5, 3, 3 and 5; T3 and T4 didn't move");
});

test("Schedule Faced So Far: the takeaway names the biggest flip in words (ties go to the larger raw gap)", () => {
  const c = setup();
  const html = c.renderSosPanel(sosFixture(), CHIP);
  assert.ok(html.includes("<strong>Biggest flip:</strong> T1 looks like the easiest schedule by PA/G (#6) but has actually faced the hardest schedule (#1)."), html.match(/Biggest flip[^<]*<\/p>|Biggest flip.*/)[0]);
});

test("Schedule Faced So Far: when nobody moves far enough, it says so instead of inventing a flip", () => {
  const c = setup();
  const sos = sosFixture();
  sos.rows.forEach((r) => (r.paRank = r.trueRank));
  const html = c.renderSosPanel(sos, CHIP);
  assert.ok(html.includes("No big flips"));
  assert.ok(!html.includes("Biggest flip"));
  assert.ok(!html.includes('sos-row flip'));
});

test("Schedule Faced So Far: needs two teams with a true SOS; before that there is no panel", () => {
  const c = setup();
  const sos = sosFixture();
  sos.rows.forEach((r) => ((r.trueSos = null), (r.trueRank = null)));
  assert.strictEqual(c.renderSosPanel(sos, CHIP), "");
  assert.strictEqual(c.renderSosPanel({ ...sosFixture(), rows: sosFixture().rows.slice(0, 1) }, CHIP), "");
});

test("Road Ahead: order, bar side and width", () => {
  const c = setup();
  const html = c.renderRoadAheadPanel(sosFixture(), CHIP);
  const order = [...html.matchAll(/class="road-name" data-username="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(order, ["T1", "T2", "T3", "T6", "T4", "T5"], "by distance from the league average, hardest first");
  const bars = [...html.matchAll(/class="road-bar (hard|easy)" style="width:([\d.]+)%"/g)].map((m) => [m[1], Number(m[2])]);
  // biggest gap is 6 -> half the track (50%); 3.3 -> 27.5; 0.2 -> 1.67; -1 -> 8.33; -1.5 -> 12.5; -3 -> 25
  assert.deepStrictEqual(bars.map((b) => b[0]), ["hard", "hard", "hard", "easy", "easy", "easy"]);
  assert.deepStrictEqual(bars.map((b) => Math.round(b[1] * 10) / 10), [50, 27.5, 1.7, 8.3, 12.5, 25]);
  assert.deepStrictEqual([...html.matchAll(/class="road-val">([^<]+)</g)].map((m) => m[1]), ["+6.0", "+3.3", "+0.2", "-1.0", "-1.5", "-3.0"]);
  assert.ok(html.includes("Weeks 6-14 · 9 games"));
  assert.ok(html.includes("league average of 127.8 PPG"));
});

test("Road Ahead: the takeaway names the toughest and easiest remaining slate, with the toughest one's record", () => {
  const c = setup();
  const html = c.renderRoadAheadPanel(sosFixture(), CHIP);
  assert.ok(html.includes("<strong>Worth knowing:</strong> T1 (4-1) has the toughest remaining slate, with opponents rating 133.8 PPG on average; T5 has the easiest."));
});

test("Road Ahead: the note says how opponents are rated: 80% ROS / 20% PPG when the file used ROS, PPG alone for an older file or a fallback", () => {
  const c = setup();
  const withRos = sosFixture();
  withRos.remaining = { ...withRos.remaining, rosWeight: 0.8 };
  const note = c.renderRoadAheadPanel(withRos, CHIP).match(/<p class="heatmap-note">([^<]*)<\/p>/)[1];
  assert.ok(note.includes("80% on its FantasyPros rest-of-season strength and 20% on its points per game so far"), note);
  assert.ok(note.includes("league average of 127.8 PPG"));
  for (const remaining of [{ ...withRos.remaining, rosWeight: 0 }, { fromWeek: 6, toWeek: 14, games: 9 }, null]) {
    const html = c.renderRoadAheadPanel({ ...withRos, remaining }, CHIP);
    const plain = html.match(/<p class="heatmap-note">([^<]*)<\/p>/)[1];
    assert.ok(plain.includes("every opponent rated by its points per game so far") && !plain.includes("FantasyPros"), plain);
  }
});

test("Road Ahead: a team with nothing left to play is skipped; one team alone gets no takeaway; none at all is no panel", () => {
  const c = setup();
  const sos = sosFixture();
  sos.rows.find((r) => r.teamName === "T6").ahead = null;
  const html = c.renderRoadAheadPanel(sos, CHIP);
  assert.ok(!html.includes('data-username="T6"'));
  const one = c.renderRoadAheadPanel({ ...sosFixture(), rows: sosFixture().rows.slice(0, 1) }, CHIP);
  assert.ok(one.includes("road-row") && !one.includes("Worth knowing"));
  sos.rows.forEach((r) => (r.ahead = null));
  assert.strictEqual(c.renderRoadAheadPanel(sos, CHIP), "");
});

test("SOS section: two panels side by side; if only one has anything to say it takes the full width", () => {
  const c = setup();
  const both = c.renderSosSection(sosFixture(), CHIP);
  assert.ok(both.includes('<span class="label">Strength of Schedule</span>'));
  assert.ok(both.includes('<div class="section-grid">') && both.includes("Schedule Faced So Far") && both.includes("Road Ahead"));
  const weekOne = sosFixture();
  weekOne.rows.forEach((r) => ((r.trueSos = null), (r.trueRank = null)));
  const solo = c.renderSosSection(weekOne, CHIP);
  assert.ok(solo.includes("section-grid section-grid-solo") && solo.includes("Road Ahead") && !solo.includes("Schedule Faced So Far"));
  assert.strictEqual(c.renderSosSection(null, CHIP), "");
  assert.strictEqual(c.renderSosSection({ rows: [] }, CHIP), "");
});

function scoresFixture() {
  return {
    leagueAvgPpg: 112,
    rows: [
      { teamName: "X", scores: [99.6, 120.4, 110], avg: 110, low: 99.6, high: 120.4 },
      { teamName: "Y", scores: [90, 150, null], avg: 120, low: 90, high: 150 },
      { teamName: "Z", scores: [105, 106, 107], avg: 106, low: 105, high: 107 },
    ],
  };
}

test("Every Week, One Dot: best average first, one dot per week actually played, at its place on the axis", () => {
  const c = setup();
  const html = c.renderScoreStrips(scoresFixture(), CHIP);
  assert.deepStrictEqual([...html.matchAll(/class="strip-name" data-username="([^"]+)"/g)].map((m) => m[1]), ["Y", "X", "Z"]);
  assert.strictEqual((html.match(/class="strip-dot" style/g) || []).length, 3 + 2 + 3, "Y's bye week gets no dot");
  // axis 75-175 (scores 90-150, 5 of padding, steps of 25): Y's 90 is 15% along, its 150 is 75%
  const y = html.slice(html.indexOf('data-username="Y"'), html.indexOf('data-username="X"'));
  assert.ok(y.includes('class="strip-dot" style="left:15%" title="Week 1 · 90.0"'));
  assert.ok(y.includes('class="strip-dot" style="left:75%" title="Week 2 · 150.0"'));
  assert.ok(y.includes('class="strip-span" style="left:15%;width:60%"'), "the line runs from the worst week to the best");
  assert.ok(y.includes('class="strip-avg" style="left:45%"'), "average 120 is 45% along");
  assert.ok(html.includes('class="strip-league" style="left:37%"'), "league average 112 is 37% along, drawn on every row");
  assert.deepStrictEqual([...html.matchAll(/class="axis-tick" style="left:[\d.]+%">(\d+)</g)].map((m) => m[1]), ["75", "100", "125", "150", "175"]);
});

test("Every Week, One Dot: low and high are rounded, and a row's hover text lists every week", () => {
  const c = setup();
  const html = c.renderScoreStrips(scoresFixture(), CHIP);
  assert.deepStrictEqual([...html.matchAll(/class="strip-range">([^<]+)</g)].map((m) => m[1]), ["Low · High", "90 · 150", "100 · 120", "105 · 107"]);
  assert.ok(html.includes('title="Y — average 120.0: Wk 1 90.0, Wk 2 150.0"'));
  assert.ok(html.includes("League avg 112.0"));
});

test("Every Week, One Dot: the takeaway names the steadiest and the wildest by the gap between best and worst week", () => {
  const c = setup();
  const html = c.renderScoreStrips(scoresFixture(), CHIP);
  assert.ok(html.includes("<strong>Takeaway:</strong> Z has been the steadiest (2 point spread between best and worst week), while Y swings 60 points."));
});

test("Every Week, One Dot: one week of scores can't say who is steady, so no takeaway; a very wide spread widens the axis step to 50", () => {
  const c = setup();
  const one = { leagueAvgPpg: 100, rows: [{ teamName: "X", scores: [100], avg: 100, low: 100, high: 100 }, { teamName: "Y", scores: [120], avg: 120, low: 120, high: 120 }] };
  const html = c.renderScoreStrips(one, CHIP);
  assert.ok(!html.includes("Takeaway"));
  assert.ok(html.includes("strip-dot"));
  const wide = { leagueAvgPpg: 150, rows: [{ teamName: "X", scores: [50, 280], avg: 165, low: 50, high: 280 }] };
  const ticks = [...c.renderScoreStrips(wide, CHIP).matchAll(/class="axis-tick"[^>]*>(\d+)</g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(ticks, [0, 50, 100, 150, 200, 250, 300]);
  assert.strictEqual(c.renderScoreStrips({ leagueAvgPpg: 1, rows: [] }, CHIP), "");
  assert.strictEqual(c.renderScoreStrips(null, CHIP), "");
});

function slotsFixture() {
  return {
    columns: [{ key: "QB", label: "QB" }, { key: "RB1", label: "RB1" }, { key: "SUPER_FLEX", label: "SUPERFLEX" }],
    leagueAvg: { QB: 20, RB1: 18, SUPER_FLEX: 12 },
    rows: [
      { teamName: "Q", cells: { QB: -12, RB1: 10.6, SUPER_FLEX: 4 }, total: 2.6 },
      { teamName: "P", cells: { QB: 8.14, RB1: -1.3, SUPER_FLEX: null }, total: 6.84 },
    ],
  };
}

test("Lineup slot heatmap: header is Team, the slots (SUPERFLEX shortened to SFLX), then vs Avg; best total first", () => {
  const c = setup();
  const html = c.renderSlotHeatmap(slotsFixture(), CHIP);
  assert.deepStrictEqual([...html.match(/<thead>[\s\S]*?<\/thead>/)[0].matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]), ["Team", "QB", "RB1", "SFLX", "vs Avg"]);
  assert.deepStrictEqual([...html.matchAll(/class="team-cell" data-username="([^"]+)"/g)].map((m) => m[1]), ["P", "Q"]);
  assert.ok(html.includes("sticky-cols-1") && html.includes("slot-table") && html.includes("stay-scrollable"));
});

test("Lineup slot heatmap: cells show the signed gap, colored on one fixed scale that saturates at +-10; an empty slot is a dash", () => {
  const c = setup();
  const html = c.renderSlotHeatmap(slotsFixture(), CHIP);
  const cells = [...html.match(/<tbody>[\s\S]*<\/tbody>/)[0].matchAll(/<td class="heat-cell(?: empty)?"( style="background:([^"]+)")?[^>]*>([^<]+)</g)].map((m) => ({ bg: m[2], text: m[3] }));
  assert.deepStrictEqual(cells.map((x) => x.text), ["+8.1", "-1.3", "—", "-12.0", "+10.6", "+4.0"]);
  assert.strictEqual(cells[2].bg, undefined, "no fill on an empty slot");
  assert.strictEqual(cells[0].bg, c.divergingHeatColor(8.14, 10));
  assert.strictEqual(cells[3].bg, "rgb(51, 107, 122)", "-12 is past the scale, so it's the full blue");
  assert.strictEqual(cells[4].bg, "rgb(124, 93, 49)", "+10.6 is past the scale, so it's the full yellow");
  assert.ok(html.includes("title=\"P QB: 28.1 PPG (league 20.0)\""));
});

test("Lineup slot heatmap: the vs Avg total is yellow when positive, blue when negative", () => {
  const c = setup();
  const html = c.renderSlotHeatmap(slotsFixture(), CHIP);
  assert.ok(html.includes('<span class="luck-positive">+6.8</span>'));
  assert.ok(html.includes('<span class="luck-positive">+2.6</span>'));
  const neg = slotsFixture();
  neg.rows[0].total = -4.2;
  assert.ok(c.renderSlotHeatmap(neg, CHIP).includes('<span class="luck-negative">-4.2</span>'));
});

test("Lineup slot heatmap: the legend is the fixed scale, and the takeaway names the single biggest strength and deepest hole", () => {
  const c = setup();
  const html = c.renderSlotHeatmap(slotsFixture(), CHIP);
  assert.deepStrictEqual([...html.matchAll(/class="slot-key"[^>]*>([^<]+)</g)].map((m) => m[1]), ["-10", "-6.7", "-3.3", "0", "+3.3", "+6.7", "+10"]);
  assert.ok(html.includes("<strong>Takeaway:</strong> Biggest strength: Q's RB1 at +10.6 points per game above the league average for that slot. Deepest hole: Q's QB at -12.0."));
});

test("Lineup slot heatmap: no strength is claimed when every cell is below average, and no hole when none is", () => {
  const c = setup();
  const allBelow = { columns: [{ key: "QB", label: "QB" }], leagueAvg: { QB: 20 }, rows: [{ teamName: "A", cells: { QB: -2 }, total: -2 }, { teamName: "B", cells: { QB: -1 }, total: -1 }] };
  const a = c.renderSlotHeatmap(allBelow, CHIP);
  assert.ok(!a.includes("Biggest strength") && a.includes("Deepest hole: A's QB at -2.0."));
  const allAbove = { columns: [{ key: "QB", label: "QB" }], leagueAvg: { QB: 20 }, rows: [{ teamName: "A", cells: { QB: 2 }, total: 2 }, { teamName: "B", cells: { QB: 1 }, total: 1 }] };
  const b = c.renderSlotHeatmap(allAbove, CHIP);
  assert.ok(b.includes("Biggest strength: A's QB at +2.0") && !b.includes("Deepest hole"));
  assert.strictEqual(c.renderSlotHeatmap({ columns: [], leagueAvg: {}, rows: [] }, CHIP), "");
  assert.strictEqual(c.renderSlotHeatmap(null, CHIP), "");
});

function fullExtras(over) {
  return { season: "2026", week: 5, sos: sosFixture(), scores: scoresFixture(), slots: slotsFixture(), ...over };
}

test("renderExtrasSections: all three sections, in order, when the extras match the snapshot", () => {
  const c = setup();
  const html = c.renderExtrasSections({ season: "2026", week: 5 }, fullExtras(), CHIP);
  const at = (label) => html.indexOf(`<span class="label">${label}</span>`);
  assert.ok(at("Strength of Schedule") >= 0 && at("Strength of Schedule") < at("Consistency") && at("Consistency") < at("Lineups"));
});

test("renderExtrasSections: nothing at all when the extras are missing or from a different week or season (a stale file must not sit under a newer table)", () => {
  const c = setup();
  const snap = { season: "2026", week: 5 };
  assert.strictEqual(c.renderExtrasSections(snap, null, CHIP), "");
  assert.strictEqual(c.renderExtrasSections(snap, fullExtras({ week: 4 }), CHIP), "");
  assert.strictEqual(c.renderExtrasSections(snap, fullExtras({ season: "2025" }), CHIP), "");
});

test("renderExtrasSections: a section the file has nothing for is simply left out", () => {
  const c = setup();
  const html = c.renderExtrasSections({ season: "2026", week: 5 }, fullExtras({ sos: null, slots: null }), CHIP);
  assert.ok(html.includes("Every Week, One Dot") && !html.includes("Strength of Schedule") && !html.includes("Lineups"));
});

test("renderContent: the Power Rankings page draws the extras under the odds table, and the same page without them is unchanged", () => {
  const c = setup();
  const row = { rosterId: 1, teamName: "T1", username: "T1", wins: 1, losses: 0, ties: 0, record: "1-0", overallRecord: "1-0", avgPpg: 100, stdDev: 1, playoffPct: 50, byePct: null, rosRank: 1, boom: 0, bust: 0, prScore: 1, powerRank: 1, luckRank: 1, finishDistribution: [100] };
  const snapshot = { season: "2026", week: 5, playoffTeams: 1, byeTeams: 0, rows: [row], generatedAt: "2026-10-13T17:00:00Z" };
  const withExtras = c.renderContent(snapshot, null, null, fullExtras());
  const without = c.renderContent(snapshot, null, null, null);
  assert.ok(withExtras.indexOf("Finish Probability By Rank") < withExtras.indexOf("Schedule Faced So Far"));
  assert.ok(withExtras.startsWith(without.trimEnd().slice(0, 200)), "the table and odds panels come first, unchanged");
  assert.ok(!without.includes("Schedule Faced So Far") && !without.includes("Every Week, One Dot"));
});

test("renderPowerRankings: loads the extras file next to the snapshot and shows the sections; a missing or mismatched extras file doesn't break the page", async () => {
  const snapshotRow = { rosterId: 1, teamName: "T1", wins: 1, losses: 0, ties: 0, record: "1-0", overallRecord: "1-0", avgPpg: 100, stdDev: 1, playoffPct: 50, byePct: null, rosRank: 1, boom: 0, bust: 0, prScore: 1, powerRank: 1, luckRank: 1, finishDistribution: [100] };
  const snapshot = { season: "2026", week: 5, preseason: false, playoffTeams: 1, byeTeams: 0, rows: [snapshotRow], generatedAt: "2026-10-13T17:00:00Z" };
  const run = async (extrasBody) => {
    const c = setup();
    const asked = [];
    c.fetch = async (file) => {
      asked.push(file);
      const body = file.includes("snapshot") ? snapshot : file.includes("extras") ? extrasBody : { seasons: {} };
      return { ok: body != null, json: async () => body };
    };
    await c.renderPowerRankings();
    return { html: c.document.getElementById("pr-content").innerHTML, asked, error: c.document.getElementById("pr-error").textContent };
  };
  const ok = await run(fullExtras());
  assert.ok(ok.asked.includes("data/power-rankings-extras.json"));
  assert.ok(ok.html.includes("Schedule Faced So Far") && ok.html.includes("Every Week, One Dot") && ok.html.includes("Where Each Lineup Is Strong Or Thin"));
  for (const body of [null, fullExtras({ week: 3 })]) {
    const r = await run(body);
    assert.ok(r.html.includes("Finish Probability By Rank"), "the table and odds still show");
    assert.ok(!r.html.includes("Schedule Faced So Far"));
    assert.strictEqual(r.error, "");
  }
});

test("the new row types highlight under My Team, like every other table and list", () => {
  const src = fs.readFileSync(path.join(ROOT, "js", "my-team.js"), "utf8");
  const selector = src.match(/const ROW_SELECTOR = "([^"]+)"/)[1];
  for (const cls of [".sos-row", ".road-row", ".strip-row"]) assert.ok(selector.includes(cls), `${cls} must be a My Team row`);
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");
  for (const cls of [".sos-row.mine", ".road-row.mine", ".strip-row.mine"]) assert.ok(css.includes(cls), `${cls} needs a highlight`);
});

test("on a phone the schedule and score rows put the name and numbers on one line with the plot under them", () => {
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");
  const phone = css.slice(css.indexOf("/* Phones: the name and the numbers share a first line"));
  assert.match(phone, /@media \(max-width: 640px\)/);
  assert.match(phone, /grid-template-areas: "name ranks" "track track"/);
});
