/*
  Home's other panels: the tiles beside My Team, the My Team card, Hot & Cold and
  the Power Rankings preview.
*/
const test = require("node:test");
const assert = require("node:assert");
const { archive, snapshotFile, FINISHED, TEAMS, homeCtx, json, run, html, secondPass } = require("./helpers/home-fixture.js");

const storageStub = (initial) => {
  const data = new Map(initial ? [["funtasy.myTeam", initial]] : []);
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
};
const userOf = (rosterId) => archive.users.find((u) => u.user_id === archive.rosters.find((r) => r.roster_id === rosterId).owner_id);

// ---- tiles --------------------------------------------------------------------------------------------
test("tiles: waivers, the last FINISHED week's top score and closest game, and a 'Pick your team' call to action until a team is picked", () => {
  const ctx = homeCtx();
  const cells = (m) => json(ctx, `buildPulseCells(${JSON.stringify(m)})`);
  const base = {
    week: 7,
    waivers: { value: "Wed 3 AM ET", sub: "in 1 day, 16 hr" },
    highlightWeek: 6,
    topScore: { pts: 201.44, name: "Alvin's Team" },
    closest: { diff: 0.62, a: "Alvin's Team", b: "Teddy Bears" },
    hasMatchups: true,
    anyPoints: true,
    me: null,
    myMatch: null,
  };
  const noTeam = cells(base);
  assert.deepStrictEqual(noTeam.map((c) => c.label), ["Next waivers", "Top Score · Wk 6", "Closest Game · Wk 6", "Your matchup"]);
  assert.ok(!noTeam.some((c) => /games/i.test(c.label)), "no 'Games on now' cell");
  assert.deepStrictEqual([noTeam[0].value, noTeam[0].sub], ["in 1 day, 16 hr", "Wed 3 AM ET"], "the countdown leads, the clock time sits under it");
  assert.deepStrictEqual([noTeam[1].value, noTeam[1].sub, noTeam[1].gold], ["201.4", "Alvin's Team", true], "the score is the big number, the team under it, in gold");
  assert.deepStrictEqual([noTeam[2].value, noTeam[2].sub], ["0.6 pts", "Alvin's Team over Teddy Bears"]);
  assert.ok(noTeam[3].valueHtml.includes("data-myteam-open") && noTeam[3].valueHtml.includes("Pick your team"));
  const match = { me: { username: "Teddy" }, opponent: { username: "Alvin" }, mine: { points: 101.3 }, theirs: { points: 98.2 } };
  const picked = cells({ ...base, me: "Teddy", myMatch: match });
  assert.ok(picked[3].valueHtml.includes("<strong>101.3</strong> – 98.2"));
  assert.strictEqual(picked[3].sub, "vs Alvin · you’re ahead");
  assert.ok(cells({ ...base, me: "Teddy", myMatch: { ...match, mine: { points: 90 } } })[3].sub.endsWith("you’re behind"));
  assert.strictEqual(cells({ ...base, anyPoints: false, me: "Teddy", myMatch: match })[3].sub, "vs Alvin", "no talk of leads before anyone has scored");
  assert.strictEqual(cells({ ...base, me: "Bye", myMatch: { me: {}, opponent: null, mine: {}, theirs: null } })[3].value, "Bye week");
  assert.ok(cells({ ...base, me: "Gone", myMatch: null })[3].valueHtml.includes("Change team"));
  const tie = cells({ ...base, closest: { diff: 0, a: "A", b: "B" } })[2];
  assert.strictEqual(tie.sub, "A vs B", "a dead heat isn't 'over' anybody");
  const early = cells({ week: 1, waivers: null, highlightWeek: 0, topScore: null, closest: null, hasMatchups: false, me: null, myMatch: null });
  assert.strictEqual(early.length, 0, "nothing finished yet: no top score or closest game to show");
});

test("tiles: the 'Pick your team' prompt lives in the My Team card, so the tile row leaves it out; top score gets the gold class", () => {
  const ctx = homeCtx();
  const cells = [
    { label: "A", value: "1" },
    { label: "Your matchup", valueHtml: '<button data-myteam-open>Pick your team</button>', wide: true },
    { label: "Top Score", value: "9", gold: true },
    { label: "Your matchup", valueHtml: "<strong>1</strong>", mine: true },
  ];
  const kept = json(ctx, `homeTileCells(${JSON.stringify(cells)})`);
  assert.deepStrictEqual(kept.map((c) => c.label), ["A", "Top Score", "Your matchup"]);
  assert.ok(run(ctx, `pulseCellHtml({ label: "Top Score", value: "9", gold: true })`).includes("pulse-gold"));
  assert.ok(!run(ctx, `pulseCellHtml({ label: "Top Score", value: "9" })`).includes("pulse-gold"));
  assert.ok(run(ctx, `pulseCellHtml({ label: "x", value: "9", mine: true })`).includes("pulse-mine"));
});

test("tiles: text is escaped", () => {
  const ctx = homeCtx();
  const out = run(ctx, `pulseCellHtml({ label: "<b>", value: "<i>x</i>", sub: "<u>" })`);
  assert.ok(!out.includes("<b>") && !out.includes("<i>") && !out.includes("<u>"));
});

test("renderLeaguePulse: week label in the header, four tiles after a finished week, and only finished results in them", async () => {
  const ctx = homeCtx();
  ctx.__arch = archive;
  run(
    ctx,
    `HOME.league = __arch.league; HOME.week = 8; HOME.completed = 7; HOME.nowMs = Date.parse("2026-10-27T19:00:00Z");
     HOME.standings = SleeperAPI.buildStandings(__arch.rosters, __arch.users);
     HOME.rawMatchups = __arch.weeks.find((w) => w.week === 7).matchups;
     HOME.highlights = { week: 7, ...weekHighlights(HOME.rawMatchups, HOME.standings) };
     renderLeaguePulse();`
  );
  assert.strictEqual(ctx.document.getElementById("sb-sub").textContent, "Week 8");
  const tiles = html(ctx, "home-tiles");
  assert.strictEqual((tiles.match(/ticker-stat pulse-cell/g) || []).length, 3, "waivers, top score, closest game (no matchup tile until a team is picked)");
  assert.ok(tiles.includes("Wk 7") && tiles.includes("pulse-gold"));
  assert.ok(!tiles.includes("Pick your team"));
  assert.ok(html(ctx, "home-fresh").includes("Through Week 7"));
});

// ---- My Team card -------------------------------------------------------------------------------------------
test("My Team card: asks for a team until one is picked", () => {
  const ctx = homeCtx();
  ctx.localStorage = storageStub();
  run(ctx, "HOME.standings = []; renderMyTeamCard();");
  const card = html(ctx, "my-team-card");
  assert.ok(card.includes("Pick your team") && card.includes("data-myteam-open"));
  assert.ok(!card.includes("mt-you"));
});

test("My Team card: a name that isn't in this league offers to change it", () => {
  const ctx = homeCtx();
  ctx.localStorage = storageStub("ghost");
  ctx.__arch = archive;
  run(ctx, "HOME.standings = SleeperAPI.buildStandings(__arch.rosters, __arch.users); renderMyTeamCard();");
  const card = html(ctx, "my-team-card");
  assert.ok(card.includes("ghost") && card.includes("isn’t in this league") && card.includes("Change team"));
});

test("My Team card: record, standing, Power Rank, playoff odds, last seven results and this week's opponent", async () => {
  const ctx = await secondPass();
  const rosterId = snapshotFile.rows.find((r) => r.powerRank === 1).rosterId;
  const me = userOf(rosterId).display_name;
  const week7 = archive.weeks.find((w) => w.week === FINISHED).matchups;
  ctx.localStorage = storageStub(me);
  ctx.__m = week7;
  run(ctx, `HOME.week = ${FINISHED}; HOME.rawMatchups = __m; renderMyTeamCard();`);
  const card = html(ctx, "my-team-card");
  const team = json(ctx, `HOME.standings.find((t) => t.rosterId === ${rosterId})`);
  assert.ok(card.includes("mt-you"), "marked as yours");
  assert.ok(card.includes(`>${team.wins}-${team.losses}${team.ties ? "-" + team.ties : ""}<`), "record");
  assert.ok(/Standing<\/span><b class="mt-stat-value">\d+(st|nd|rd|th)</.test(card), "place in the table");
  assert.ok(card.includes("#1<"), "Power Rank");
  assert.ok(card.includes("mt-stat-value gold") && card.includes("%<"), "playoff odds in gold");
  assert.strictEqual((card.match(/<i class="fd /g) || []).length, Math.min(7, FINISHED));
  assert.ok(/Last 7 · (won|lost|tied)/.test(card), "the current run in words");
  assert.ok(/Week 7 vs <b>/.test(card), "who they play");
  assert.strictEqual(run(ctx, "document.getElementById('my-team-card').classList"), undefined, "the fake element has no classList; the card must not rely on it");
});

test("My Team card: bye week, and 'You are X-Y against…' once the all-time history has loaded", async () => {
  const ctx = await secondPass();
  const a = archive.rosters[0];
  const b = archive.rosters[1];
  const me = userOf(a.roster_id).display_name;
  ctx.localStorage = storageStub(me);
  ctx.__m = [{ roster_id: a.roster_id, matchup_id: 1, points: 0 }, { roster_id: b.roster_id, matchup_id: 1, points: 0 }];
  run(ctx, `HOME.week = 8; HOME.rawMatchups = __m; renderMyTeamCard();`);
  let card = html(ctx, "my-team-card");
  assert.ok(/Week 8 vs <b>/.test(card) && !card.includes("all-time") && !card.includes("First-ever"), "no series line before the history loads");
  ctx.__a = a.owner_id;
  ctx.__b = b.owner_id;
  run(ctx, `HOME.h2h = { rec: new Map([[__a, new Map([[__b, { wins: 3, losses: 6, ties: 0 }]])]]), name: new Map([[__b, "theirname"]]) }; renderMyTeamCard();`);
  card = html(ctx, "my-team-card");
  assert.ok(card.includes("You are 3-6 against theirname all-time."), card);
  run(ctx, `HOME.h2h = { rec: new Map([[__a, new Map()]]), name: new Map() }; renderMyTeamCard();`);
  assert.ok(html(ctx, "my-team-card").includes("First-ever meeting."));
  ctx.__bye = [{ roster_id: a.roster_id, matchup_id: null, points: 0 }];
  run(ctx, `HOME.rawMatchups = __bye; renderMyTeamCard();`);
  assert.ok(html(ctx, "my-team-card").includes("bye week"));
});

// ---- Hot & Cold --------------------------------------------------------------------------------------------------
test("computeCurrentStreaks: only a run of two or more wins or losses, longest first, and never longer than the weeks given", () => {
  const ctx = homeCtx();
  // 1 beats 2 every week; 3 beats 4 in weeks 1-3 and 4 beats 3 in weeks 4-6; 5 and 6 tie every week.
  const game = (week, a, b, pa, pb) => ({ week, matchups: [{ roster_id: a, matchup_id: a, points: pa }, { roster_id: b, matchup_id: a, points: pb }] });
  const weekOf = (w) => [
    ...game(w, 1, 2, 120, 100).matchups,
    ...(w <= 3 ? game(w, 3, 4, 110, 90) : game(w, 3, 4, 90, 110)).matchups,
    ...game(w, 5, 6, 100, 100).matchups,
  ];
  const merged = [1, 2, 3, 4, 5, 6].map((w) => ({ week: w, matchups: weekOf(w) }));
  ctx.__w = merged;
  const streaks = (completed) =>
    json(
      ctx,
      `(function () {
        const info = new Map([1, 2, 3, 4, 5, 6].map((id) => [id, { teamName: "t" + id, username: "u" + id }]));
        return computeCurrentStreaks(onlyCompletedWeeks(__w, ${completed}), info);
      })()`
    );
  const six = streaks(6);
  assert.deepStrictEqual(six.map((s) => `${s.rosterId}${s.result}${s.length}`).sort(), ["1W6", "2L6", "3L3", "4W3"].sort());
  assert.ok(["1W6", "2L6"].includes(`${six[0].rosterId}${six[0].result}${six[0].length}`) && six[0].length === 6 && six[1].length === 6 && six[2].length === 3, "longest first");
  assert.ok(!six.some((s) => s.rosterId === 5 || s.rosterId === 6), "a run of ties is not a streak");
  const four = streaks(4);
  assert.deepStrictEqual(four.map((s) => `${s.rosterId}${s.result}${s.length}`).sort(), ["1W4", "2L4"], "4 and 3 swapped sides in week 4, so neither is on a run of two yet");
  assert.ok(six[0].teamName.startsWith("t") && six[0].username.startsWith("u"), "carries the team name and the username");
  assert.deepStrictEqual(streaks(1), [], "one game is not a run");
});

test("Hot & Cold: up to three of each, the hottest and coldest first, each with their last seven dots", async () => {
  const ctx = await secondPass();
  const panel = html(ctx, "streaks-panel");
  assert.ok(panel.includes('class="hc-head hot"') && panel.includes('class="hc-head cold"'));
  const hotBlock = panel.slice(panel.indexOf("hc-head hot"), panel.indexOf("hc-head cold"));
  const coldBlock = panel.slice(panel.indexOf("hc-head cold"));
  [hotBlock, coldBlock].forEach((block) => {
    const rows = (block.match(/class="streak-row"/g) || []).length;
    assert.ok(rows >= 1 && rows <= 3, `${rows} rows`);
  });
  assert.ok(/streak-badge hot">\d+W</.test(hotBlock) && /streak-badge cold">\d+L</.test(coldBlock));
  assert.ok(!/streak-badge cold/.test(hotBlock) && !/streak-badge hot/.test(coldBlock));
  const first = (block) => Number(block.match(/streak-badge (?:hot|cold)">(\d+)/)[1]);
  const counts = (block) => [...block.matchAll(/streak-badge (?:hot|cold)">(\d+)/g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(counts(hotBlock), [...counts(hotBlock)].sort((x, y) => y - x));
  assert.ok(first(hotBlock) >= 2);
  assert.ok(/class="name" data-username="[^"]+"/.test(panel), "'my team' can find the row");
  assert.ok(panel.includes("form-dots"));
});

test("Hot & Cold: streaks ignore the half-played week", async () => {
  const lengths = async (completed) => {
    const ctx = await secondPass({ completed });
    return [...html(ctx, "streaks-panel").matchAll(/streak-badge (?:hot|cold)">(\d+)/g)].map((m) => Number(m[1]));
  };
  const four = await lengths(4);
  assert.ok(four.length > 0 && Math.max(...four) <= 4, "no streak counts the unfinished fifth week");
});

test("Hot & Cold: says so when nobody is on a run, and keeps a lone side if only hot or only cold teams exist", () => {
  const ctx = homeCtx();
  run(ctx, `renderStreaksPanel([])`);
  assert.ok(html(ctx, "streaks-panel").includes("No streaks of 2+ games yet."));
  run(ctx, `HOME.results = new Map(); renderStreaksPanel([{ rosterId: 1, teamName: "A", username: "a", result: "W", length: 3 }])`);
  const panel = html(ctx, "streaks-panel");
  assert.ok(panel.includes("hc-head hot") && !panel.includes("hc-head cold"));
  run(ctx, `renderStreaksPanel([1, 2, 3, 4, 5].map((n) => ({ rosterId: n, teamName: "T" + n, username: "t" + n, result: "L", length: 7 - n })))`);
  const cold = html(ctx, "streaks-panel");
  assert.strictEqual((cold.match(/streak-row/g) || []).length, 3, "three at most");
  assert.ok(cold.includes("T1") && !cold.includes("T4"));
});

test("Hot & Cold: the live render path shows no streaks before the first finished week", async () => {
  const ctx = await secondPass({ completed: 0 });
  assert.ok(html(ctx, "streaks-panel").includes("streaks start after Week 1"));
});

// ---- Power Rankings preview --------------------------------------------------------------------------------------------
test("Power Rankings preview: the top five, with their move since last week, PR Score and playoff odds", async () => {
  const ctx = await secondPass();
  ctx.__last = Object.fromEntries(snapshotFile.rows.map((r) => [r.teamName, r.powerRank + 1])); // everyone moved up one
  ctx.__last[snapshotFile.rows.find((r) => r.powerRank === 2).teamName] = 2; // except #2, who held
  ctx.__last[snapshotFile.rows.find((r) => r.powerRank === 3).teamName] = 1; // and #3, who fell
  run(ctx, `renderPowerRankingsSnapshot(HOME.snapshot, __last)`);
  const el = html(ctx, "power-rankings-snapshot");
  assert.strictEqual((el.match(/class="pr-mini-row"/g) || []).length, 5);
  const top = [...snapshotFile.rows].sort((a, b) => a.powerRank - b.powerRank).slice(0, 5);
  const names = [...el.matchAll(/class="pr-mini-name" data-username="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(names, top.map((r) => archive.users.find((u) => u.user_id === r.userId).display_name), "ordered by Power Rank, marked by username");
  assert.ok(el.includes("▲1") && el.includes("▼2") && el.includes("pr-mini-delta muted-inline\">–"), "up one, down two, held");
  assert.ok(el.includes(`>${top[0].prScore.toFixed(2)}<`) && el.includes(`>${top[0].playoffPct.toFixed(1)}%<`));
  assert.strictEqual(ctx.document.getElementById("pr-all-link").textContent, `All ${snapshotFile.rows.length} →`);
  run(ctx, `renderPowerRankingsSnapshot(HOME.snapshot, null)`);
  assert.ok(!html(ctx, "power-rankings-snapshot").includes("▲"), "no history, no arrows");
});

test("Power Rankings preview: ordered by Power Rank whatever order the rows come in, and a team missing from last week's ranks shows no arrow", () => {
  const ctx = homeCtx();
  const rows = [4, 1, 3, 6, 2, 5, 7].map((r) => ({ rosterId: r, teamName: "u" + r, powerRank: r, prScore: r / 10, playoffPct: 50 }));
  ctx.__s = { preseason: false, week: 3, rows };
  run(ctx, `HOME.standings = __s.rows.map((r) => ({ rosterId: r.rosterId, teamName: "Team " + r.rosterId, username: r.teamName })); renderPowerRankingsSnapshot(__s, { u1: null, u2: 3 })`);
  const el = html(ctx, "power-rankings-snapshot");
  assert.deepStrictEqual([...el.matchAll(/class="pr-mini-name"[^>]*>([^<]+)</g)].map((m) => m[1]), ["Team 1", "Team 2", "Team 3", "Team 4", "Team 5"], "the five best, best first");
  const first = el.split('class="pr-mini-row"')[1];
  assert.ok(!first.includes("▲") && !first.includes("▼"), "a null from last week is not a rank");
  assert.ok(el.includes("▲1"), "u2 was 3rd and is 2nd now");
});

test("Power Rankings preview: shows team names (not usernames) when the team has one, and ties keep their decimal", () => {
  const ctx = homeCtx();
  ctx.__s = { preseason: false, week: 3, rows: [{ rosterId: 1, teamName: "uname", powerRank: 1.5, prScore: 0.9, playoffPct: 40 }, { rosterId: 2, teamName: "u2", powerRank: 1.5, prScore: 0.9, playoffPct: null }] };
  run(ctx, `HOME.standings = [{ rosterId: 1, teamName: "The <Team>", username: "uname" }, { rosterId: 2, teamName: "u2", username: "u2" }]; renderPowerRankingsSnapshot(__s, { uname: 2 })`);
  const el = html(ctx, "power-rankings-snapshot");
  assert.ok(el.includes("The &lt;Team&gt;") && !el.includes("<Team>"));
  assert.ok(el.includes(">1.5<") && el.includes("▲0.5"));
  assert.ok(el.includes('pr-mini-pct"></span>'), "no odds, no number");
});

test("Power Rankings preview: preseason is a plain list of who is ranked where; empty and missing snapshots say so", () => {
  const ctx = homeCtx();
  run(ctx, `renderPowerRankingsSnapshot({ preseason: true, rows: [{ rank: 1, username: "a", teamName: "A" }, { rank: 2, username: "b", teamName: "B" }] }, null)`);
  const el = html(ctx, "power-rankings-snapshot");
  assert.strictEqual((el.match(/pr-mini-row pre/g) || []).length, 2);
  assert.ok(el.includes("PRESEASON") && el.includes('data-username="a"'));
  const many = Array.from({ length: 9 }, (_, i) => ({ rank: i + 1, username: "u" + i, teamName: "T" + i }));
  run(ctx, `renderPowerRankingsSnapshot({ preseason: true, rows: ${JSON.stringify(many)} }, null)`);
  assert.strictEqual((html(ctx, "power-rankings-snapshot").match(/pr-mini-row pre/g) || []).length, 5, "the preseason preview is the top five too");
  run(ctx, `renderPowerRankingsSnapshot({ rows: [] }, null)`);
  assert.ok(html(ctx, "power-rankings-snapshot").includes("No power rankings yet."));
  run(ctx, `renderPowerRankingsSnapshot(null, null)`);
  assert.ok(html(ctx, "power-rankings-snapshot").includes("No power rankings yet."));
});

test("Power Rankings chip: says how far the snapshot runs and, if it is behind, that it is", async () => {
  const ctx = await secondPass({ completed: FINISHED });
  const chip = html(ctx, "pr-fresh");
  assert.ok(chip.includes("Snapshot") && chip.includes(`Through Week ${snapshotFile.week}`) && chip.includes("updates with each ROS refresh") && !chip.includes("Tuesday"), chip);
  const preseason = await secondPass({ snapshot: { preseason: true, season: "2026", rows: [] } });
  assert.ok(html(preseason, "pr-fresh").includes("Preseason"));
  const none = await secondPass({ snapshot: null });
  assert.strictEqual(html(none, "pr-fresh"), "");
  assert.strictEqual(run(none, "HOME.powerByRoster.size"), 0);
  assert.strictEqual(run(ctx, "HOME.powerByRoster.size"), TEAMS);
});

// ---- smaller guards ------------------------------------------------------------------------------------------------------
test("latestFinalMatchups: this week once it is over, last week while this one is on, nothing before a week is done", () => {
  const ctx = homeCtx();
  const pick = (completed, week, lastWeek) => run(ctx, `latestFinalMatchups(${completed}, ${week}, ${lastWeek}, "THIS", "LAST")`);
  assert.deepStrictEqual([pick(8, 8, 7), pick(7, 8, 7)], ["THIS", "LAST"]);
  assert.strictEqual(pick(6, 8, 7).length + pick(0, 1, null).length, 0);
  assert.strictEqual(run(ctx, `latestFinalMatchups(0, null, null, "THIS", "LAST").length`), 0);
});

test("league pulse: a finished season has no 'through Week N' chip or waiver clock; the header says the season is over", () => {
  const ctx = homeCtx();
  ctx.__arch = archive;
  run(ctx, `HOME.league = { ...__arch.league, status: "complete" }; HOME.week = 14; HOME.completed = 14; HOME.rawMatchups = []; HOME.standings = []; renderLeaguePulse();`);
  assert.strictEqual(ctx.document.getElementById("sb-sub").textContent, "Season complete");
  assert.strictEqual(html(ctx, "home-fresh"), "");
  assert.ok(!html(ctx, "home-tiles").includes("Next waivers"));
  run(ctx, `HOME.league = { ...__arch.league, status: "pre_draft" }; HOME.week = null; renderLeaguePulse();`);
  assert.strictEqual(ctx.document.getElementById("sb-sub").textContent, "Preseason");
});

test("My Team card: no matchups posted means no 'Week N vs' line (and no crash); a Power Rank only shows when there is one", () => {
  const ctx = homeCtx();
  ctx.localStorage = storageStub(userOf(1).display_name);
  ctx.__arch = archive;
  run(ctx, `HOME.standings = SleeperAPI.buildStandings(__arch.rosters, __arch.users); HOME.week = 8; HOME.rawMatchups = []; HOME.powerByRoster = new Map([[1, { playoffPct: 12.5 }]]); renderMyTeamCard();`);
  const card = html(ctx, "my-team-card");
  assert.ok(card.includes("mt-you") && !card.includes("mt-next") && !card.includes("Week 8 vs"));
  assert.ok(!card.includes("Power rank"), "a snapshot row without a Power Rank adds no Power Rank box");
  assert.ok(card.includes("12.5%"));
});

test("my-team.js knows Home's new rows and cards, so the highlight and the YOU tag land on the whole row", () => {
  const src = require("./helpers/home-fixture.js").read("js", "my-team.js");
  const sel = (name) => src.match(new RegExp(`const ${name} = "([^"]+)"`))[1].split(/,\s*/);
  const rows = sel("ROW_SELECTOR");
  ["tr", ".hs-item", ".streak-row", ".pr-mini-row", ".mu-side", ".lw-side"].forEach((c) => assert.ok(rows.includes(c), `${c} is a row`));
  const cards = sel("CARD_SELECTOR");
  assert.deepStrictEqual(cards, [".mu-card", ".mu-featured", ".lw-row"], "a whole game is highlighted as a card when either side is yours");
  assert.ok(sel("SKIP_SELECTOR").includes(".my-team-card"), "the My Team card isn't decorated by itself");
  assert.ok(/row\.closest\(CARD_SELECTOR\)/.test(src), "the row's card is found");
});
