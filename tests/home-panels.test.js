/*
  Home's other panels: the header, the My Team card (with its avatar), Hot & Cold
  and the Power Rankings preview.
*/
const test = require("node:test");
const assert = require("node:assert");
const { archive, snapshotFile, FINISHED, TEAMS, homeCtx, json, run, html, secondPass } = require("./helpers/home-fixture.js");

const storageStub = (initial) => {
  const data = new Map(initial ? [["funtasy.myTeam", initial]] : []);
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
};
const userOf = (rosterId) => archive.users.find((u) => u.user_id === archive.rosters.find((r) => r.roster_id === rosterId).owner_id);

// ---- header -------------------------------------------------------------------------------------------
test("Home has no row of tiles beside My Team: the page and its script no longer carry the waiver clock, top score or closest-game cells", () => {
  const { read } = require("./helpers/home-fixture.js");
  const page = read("index.html");
  assert.ok(!page.includes("home-tiles"), "no tile container in the markup");
  const top = page.slice(page.indexOf('class="wrap home-top"'), page.indexOf("home-standings-block"));
  assert.ok(top.includes('id="my-team-card"') && top.includes("Featured Matchup") && !top.includes("Next waivers"), "the top row is My Team and the Featured Matchup, nothing else");
  const src = read("js", "dashboard.js");
  for (const gone of ["buildPulseCells", "homeTileCells", "pulseCellHtml", "waiverPulse", "nextWaiverRun", "easternParts", "easternWallToMs", "latestFinalMatchups", "HOME.highlights"]) {
    assert.ok(!src.includes(gone), `${gone} is gone from dashboard.js`);
  }
  assert.ok(!/WAIVER_CLEAR_HOUR_ET/.test(read("js", "config.js")), "and its config constant with it");
  assert.ok(!/home-tiles|pulse-cell/.test(read("css", "styles.css")), "and the tile CSS");
});

test("renderLeaguePulse: the header says the week and the freshness chip says how far the data runs; nothing else is drawn", async () => {
  const ctx = homeCtx();
  ctx.__arch = archive;
  run(
    ctx,
    `HOME.league = __arch.league; HOME.week = 8; HOME.completed = 7; HOME.nowMs = Date.parse("2026-10-27T19:00:00Z");
     HOME.standings = SleeperAPI.buildStandings(__arch.rosters, __arch.users);
     HOME.rawMatchups = __arch.weeks.find((w) => w.week === 7).matchups;
     renderLeaguePulse();`
  );
  assert.strictEqual(ctx.document.getElementById("sb-sub").textContent, "Week 8");
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
test("league pulse: a finished season has no 'through Week N' chip; the header says the season is over", () => {
  const ctx = homeCtx();
  ctx.__arch = archive;
  run(ctx, `HOME.league = { ...__arch.league, status: "complete" }; HOME.week = 14; HOME.completed = 14; HOME.rawMatchups = []; HOME.standings = []; renderLeaguePulse();`);
  assert.strictEqual(ctx.document.getElementById("sb-sub").textContent, "Season complete");
  assert.strictEqual(html(ctx, "home-fresh"), "");
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

// ---- My Team avatar ---------------------------------------------------------------------------------------
const myCardFor = (user) => {
  const ctx = homeCtx();
  const arch = JSON.parse(JSON.stringify(archive));
  const roster = arch.rosters[0];
  const idx = arch.users.findIndex((u) => u.user_id === roster.owner_id);
  arch.users[idx] = { ...arch.users[idx], ...user };
  ctx.localStorage = storageStub(arch.users[idx].display_name);
  ctx.__arch = arch;
  run(ctx, "HOME.standings = SleeperAPI.buildStandings(__arch.rosters, __arch.users); HOME.week = 8; HOME.rawMatchups = []; renderMyTeamCard();");
  return html(ctx, "my-team-card");
};

test("My Team card: the avatar sits beside the team name — the team's own picture when it has one", () => {
  const card = myCardFor({ avatar: "profilehash", metadata: { team_name: "Brock Hard", avatar: "https://sleepercdn.com/uploads/teamavatar.png" } });
  assert.match(card, /<div class="mt-head">\s*<span class="mt-avatar">[\s\S]*?<img src="https:\/\/sleepercdn\.com\/uploads\/teamavatar\.png"[\s\S]*?<\/span>\s*<div class="mt-id">\s*<p class="mt-name">Brock Hard<\/p>/);
  assert.ok(card.includes("player-photo-wrap mt-avatar-img"));
  assert.ok(card.indexOf("mt-head") < card.indexOf("mt-stats") && card.indexOf("mt-top") < card.indexOf("mt-head"), "label row, then avatar and name, then the numbers");
});

test("My Team card: without a team picture it uses the manager's profile picture, and without either a letter", () => {
  const plain = myCardFor({ avatar: "profilehash", metadata: { team_name: "Brock Hard" } });
  assert.ok(plain.includes('src="https://sleepercdn.com/avatars/profilehash"'), "profile picture at full size, not the thumbnail");
  assert.ok(!plain.includes("/thumbs/"));
  const none = myCardFor({ avatar: null, metadata: { team_name: "Brock Hard" } });
  assert.ok(!none.includes("<img"));
  assert.match(none, /player-photo-fallback" style="display:flex;">B</, "the team's first letter in the circle");
  const insecure = myCardFor({ avatar: null, metadata: { team_name: "Brock Hard", avatar: "http://evil.example/x.png" } });
  assert.ok(!insecure.includes("evil.example"), "only https pictures are used");
});

test("My Team card: the avatar falls back to the letter if the picture fails to load, and a team name is escaped", () => {
  const card = myCardFor({ avatar: "profilehash", metadata: { team_name: "<b>Bold</b>" } });
  assert.ok(card.includes("onerror=\"this.style.display='none'; this.nextElementSibling.style.display='flex';\""));
  assert.ok(!card.includes("<b>Bold</b>") && card.includes("&lt;b&gt;Bold&lt;/b&gt;"));
});

test("SleeperAPI.teamAvatarUrl: the team's own picture, else the profile picture, else nothing", () => {
  const ctx = homeCtx();
  const url = (u) => run(ctx, `SleeperAPI.teamAvatarUrl(${JSON.stringify(u)})`);
  assert.strictEqual(url({ avatar: "h", metadata: { avatar: "https://sleepercdn.com/uploads/t.png" } }), "https://sleepercdn.com/uploads/t.png");
  assert.strictEqual(url({ avatar: "h", metadata: {} }), "https://sleepercdn.com/avatars/h");
  assert.strictEqual(url({ avatar: "h" }), "https://sleepercdn.com/avatars/h");
  assert.strictEqual(url({ avatar: "h", metadata: { avatar: "javascript:alert(1)" } }), "https://sleepercdn.com/avatars/h");
  assert.strictEqual(url({ avatar: null }), null);
  assert.strictEqual(run(ctx, "SleeperAPI.teamAvatarUrl(null)"), null);
  const rows = JSON.parse(run(ctx, `JSON.stringify(SleeperAPI.buildStandings(${JSON.stringify(archive.rosters)}, ${JSON.stringify(archive.users)}).map((t) => ({ teamAvatar: t.teamAvatar, avatar: t.avatar })))`));
  assert.ok(rows.every((r) => r.teamAvatar === null || /^https:\/\//.test(r.teamAvatar)), "every standings row carries a ready-to-use picture URL (or null)");
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
