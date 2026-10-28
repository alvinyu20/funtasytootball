/*
  The "fresh, finished-looking Home" batch: freshness chips, member-facing
  copy, the waiver clock, and "my team". (The Standings, tiles, panels and
  matchup cards have their own files: home-standings, home-panels, matchup-cards.)
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const homeCtx = () => loadSiteModules(["config.js", "utils.js", "my-team.js", "sleeper-api.js", "deep-history.js", "dashboard.js"]);
const json = (ctx, code) => JSON.parse(runInLoadedContext(ctx, `JSON.stringify(${code})`));

// ---- freshness chips ---------------------------------------------------------------------------
test("freshness chip: says which week it covers and how it updates, in one consistent phrase", () => {
  const ctx = loadSiteModules(["config.js", "utils.js"]);
  const chip = (o) => runInLoadedContext(ctx, `freshnessChipHtml(${JSON.stringify(o)})`);
  assert.strictEqual(
    chip({ label: "Snapshot", through: 6, current: 7, note: "updates Tuesdays" }),
    '<span class="fresh-chip fresh-snap">Snapshot · Through Week 6 · updates Tuesdays</span>'
  );
  assert.ok(chip({ label: "Live", week: 7, tone: "live" }).includes("fresh-live") && chip({ label: "Live", week: 7 }).includes("Week 7"));
  assert.ok(chip({ through: 0 }).includes("Season starts Week 1"));
  assert.strictEqual(chip({}), "");
});

test("freshness chip: turns blue (the bad color) only when the data is more than one finished week behind", () => {
  const ctx = loadSiteModules(["config.js", "utils.js"]);
  const tone = (through, current) => {
    const html = runInLoadedContext(ctx, `freshnessChipHtml({ through: ${through}, current: ${current} })`);
    return /fresh-(snap|live|behind)/.exec(html)[1];
  };
  assert.strictEqual(tone(6, 7), "snap", "week 7 is being played, week 6 is the latest finished one");
  assert.strictEqual(tone(7, 7), "snap");
  assert.strictEqual(tone(5, 7), "behind");
  assert.strictEqual(tone(1, 7), "behind");
  assert.strictEqual(runInLoadedContext(ctx, `freshnessChipHtml({ through: 3 })`).includes("fresh-behind"), false, "no current week known: never behind");
  assert.ok(runInLoadedContext(ctx, `freshnessChipHtml({ label: "x", tone: "behind" })`).includes("fresh-behind"), "a forced tone wins");
});

test("freshness chip: escapes its text and dates never shift with the viewer's time zone", () => {
  const ctx = loadSiteModules(["config.js", "utils.js"]);
  const html = runInLoadedContext(ctx, `freshnessChipHtml({ label: "<img src=x>", title: 'a"b' })`);
  assert.ok(!html.includes("<img") && html.includes("&lt;img") && html.includes("a&quot;b"));
  assert.strictEqual(runInLoadedContext(ctx, `shortDateLabel("2026-10-07")`), "Oct 7");
  assert.strictEqual(runInLoadedContext(ctx, `shortDateLabel("2026-10-13T17:51:12.898Z")`), "Oct 13");
  assert.strictEqual(runInLoadedContext(ctx, `shortDateLabel("nonsense")`), "");
  assert.strictEqual(runInLoadedContext(ctx, `daysSinceDate("2026-10-07", Date.UTC(2026, 9, 26))`), 19);
  assert.strictEqual(runInLoadedContext(ctx, `daysSinceDate(null, 0)`), null);
});

// ---- finished weeks only -----------------------------------------------------------------------

test("completedWeekCount: the most games any roster has finished, which is the week the Record covers", () => {
  const ctx = homeCtx();
  const n = (rows) => runInLoadedContext(ctx, `completedWeekCount(${JSON.stringify(rows)})`);
  assert.strictEqual(n([{ wins: 4, losses: 1, ties: 0 }, { wins: 2, losses: 2, ties: 1 }]), 5);
  assert.strictEqual(n([]), 0);
  assert.strictEqual(n([{ wins: 0, losses: 0, ties: 0 }]), 0);
});

// ---- league pulse --------------------------------------------------------------------------------
const at = (iso) => Date.parse(iso);

test("Eastern Time maths: right on both sides of the daylight-saving changes", () => {
  const ctx = homeCtx();
  const parts = (iso) => json(ctx, `easternParts(${at(iso)})`);
  assert.deepStrictEqual(
    { dow: parts("2026-10-26T15:00:00Z").dow, hour: parts("2026-10-26T15:00:00Z").hour },
    { dow: 1, hour: 11 },
    "EDT: 15:00Z is 11 AM Monday"
  );
  assert.strictEqual(parts("2026-11-04T08:00:00Z").hour, 3, "EST after the clocks go back");
  assert.strictEqual(parts("2026-10-28T07:00:00Z").hour, 3, "EDT before they do");
  const wall = (y, m, d, h) => new Date(runInLoadedContext(ctx, `easternWallToMs(${y}, ${m}, ${d}, ${h})`)).toISOString();
  assert.strictEqual(wall(2026, 10, 28, 3), "2026-10-28T07:00:00.000Z");
  assert.strictEqual(wall(2026, 11, 4, 3), "2026-11-04T08:00:00.000Z");
  assert.strictEqual(wall(2026, 3, 11, 3), "2026-03-11T07:00:00.000Z", "just after spring-forward");
  assert.strictEqual(wall(2026, 3, 4, 3), "2026-03-04T08:00:00.000Z", "just before it");
});

test("Next waivers: Sleeper's waiver day (0 = Monday) at the measured clear hour, rolling to next week once it has passed", () => {
  const ctx = homeCtx();
  const next = (nowIso, day = 2, hour = 3) => {
    const r = json(ctx, `nextWaiverRun(${at(nowIso)}, ${day}, ${hour})`);
    return r && new Date(r.ms).toISOString() + " " + r.dow;
  };
  assert.strictEqual(next("2026-10-26T15:00:00Z"), "2026-10-28T07:00:00.000Z Wed");
  assert.strictEqual(next("2026-10-28T06:59:00Z"), "2026-10-28T07:00:00.000Z Wed", "a minute before");
  assert.strictEqual(next("2026-10-28T07:00:00Z"), "2026-11-04T08:00:00.000Z Wed", "at the moment they clear, the next run is a week out (and clocks changed)");
  assert.strictEqual(next("2026-10-26T15:00:00Z", 0, 3), "2026-11-02T08:00:00.000Z Mon", "a Monday league: 3 AM has passed today, so next Monday (clocks have changed)");
  assert.strictEqual(next("2026-10-26T15:00:00Z", 6, 3).slice(-3), "Sun");
  assert.strictEqual(runInLoadedContext(ctx, `nextWaiverRun(0, null, 3)`), null);
  assert.strictEqual(runInLoadedContext(ctx, `nextWaiverRun(0, undefined, 3)`), null);
});

test("Next waivers: reads as '<day> <hour> ET' with a plain countdown", () => {
  const ctx = homeCtx();
  const pulse = (nowIso) => json(ctx, `waiverPulse(${at(nowIso)}, 2, 3)`);
  assert.strictEqual(pulse("2026-10-26T15:00:00Z").value, "Wed 3 AM ET");
  assert.strictEqual(pulse("2026-10-26T15:00:00Z").sub, "in 1 day, 16 hr");
  assert.strictEqual(pulse("2026-10-28T03:00:00Z").sub, "in 4 hr");
  assert.strictEqual(pulse("2026-10-28T06:30:00Z").sub, "in under an hour");
  assert.strictEqual(runInLoadedContext(ctx, `hourLabel(0) + "|" + hourLabel(12) + "|" + hourLabel(15)`), "12 AM|12 PM|3 PM");
});

const standingsFixture = [
  { rosterId: 1, username: "Alvin", teamName: "Alvin's Team" },
  { rosterId: 2, username: "Teddy", teamName: "Teddy Bears" },
  { rosterId: 3, username: "Bye", teamName: "Bye Guys" },
  { rosterId: 4, username: "Quinn", teamName: "Q" },
];
const matchupsFixture = [
  { roster_id: 1, matchup_id: 1, points: 98.2 },
  { roster_id: 2, matchup_id: 1, points: 101.3 },
  { roster_id: 3, matchup_id: null, points: 0 },
  { roster_id: 4, matchup_id: 2, points: 50 },
];

test("findMyMatchup: finds your game whichever side you're on, case-insensitively; a bye or a stranger comes back sensibly", () => {
  const ctx = homeCtx();
  ctx.__s = standingsFixture;
  ctx.__m = matchupsFixture;
  const mine = json(ctx, `(function () { const r = findMyMatchup(__m, __s, " teddy "); return { me: r.me.username, opp: r.opponent.username, a: r.mine.points, b: r.theirs.points }; })()`);
  assert.deepStrictEqual(mine, { me: "Teddy", opp: "Alvin", a: 101.3, b: 98.2 });
  const bye = json(ctx, `(function () { const r = findMyMatchup(__m, __s, "bye"); return { opp: r.opponent, theirs: r.theirs }; })()`);
  assert.deepStrictEqual(bye, { opp: null, theirs: null });
  assert.strictEqual(runInLoadedContext(ctx, `findMyMatchup(__m, __s, "nobody")`), null);
  assert.strictEqual(runInLoadedContext(ctx, `findMyMatchup(__m, __s, null)`), null);
  assert.strictEqual(runInLoadedContext(ctx, `findMyMatchup([], __s, "Alvin").opponent`), null, "matchups not posted yet");
});

// ---- my team ---------------------------------------------------------------------------------------
test("matchupDisplayOrder: your game first, everyone else in their original order, nothing lost", () => {
  const ctx = homeCtx();
  const cards = [{ order: 0, users: ["a", "b"] }, { order: 1, users: ["c", "d"] }, { order: 2, users: ["e", "f"] }, { order: 3, users: ["g", "h"] }];
  const order = (me) => json(ctx, `matchupDisplayOrder(${JSON.stringify(cards)}, ${JSON.stringify(me)})`);
  assert.deepStrictEqual(order(null), [0, 1, 2, 3]);
  assert.deepStrictEqual(order(""), [0, 1, 2, 3]);
  assert.deepStrictEqual(order("E"), [2, 0, 1, 3]);
  assert.deepStrictEqual(order(" h "), [3, 0, 1, 2]);
  assert.deepStrictEqual(order("zzz"), [0, 1, 2, 3], "a name that's not in any game changes nothing");
});

function storageStub(initial) {
  const data = new Map(initial ? [["funtasy.myTeam", initial]] : []);
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
}

test("MyTeam: saved on this device, trimmed, matched without caring about case, and clearable", () => {
  const ctx = loadSiteModules(["config.js", "utils.js", "my-team.js"]);
  ctx.localStorage = storageStub();
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.get()`), null);
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.isMine("Alvin")`), false);
  runInLoadedContext(ctx, `MyTeam.set("  YuWillLose ")`);
  assert.strictEqual(ctx.localStorage.data.get("funtasy.myTeam"), "YuWillLose");
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.get()`), "YuWillLose");
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.isMine(" yuwilllose")`), true);
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.isMine("YuWillLose2")`), false);
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.isMine("")`), false);
  runInLoadedContext(ctx, `MyTeam.clear()`);
  assert.strictEqual(ctx.localStorage.data.size, 0);
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.get()`), null);
});

test("MyTeam: still works for the visit when the browser blocks storage", () => {
  const ctx = loadSiteModules(["config.js", "utils.js", "my-team.js"]);
  const boom = () => {
    throw new Error("blocked");
  };
  ctx.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  assert.doesNotThrow(() => runInLoadedContext(ctx, `MyTeam.set("Alvin")`));
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.get()`), "Alvin");
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.isMine("alvin")`), true);
  runInLoadedContext(ctx, `MyTeam.clear()`);
  assert.strictEqual(runInLoadedContext(ctx, `MyTeam.get()`), null);
  const bare = loadSiteModules(["config.js", "utils.js", "my-team.js"]);
  assert.strictEqual(runInLoadedContext(bare, `MyTeam.get()`), null, "no localStorage at all");
});

test("MyTeam picker list: every current manager from the weekly snapshot (or the ROS file before it exists), sorted, no repeats", () => {
  const ctx = loadSiteModules(["config.js", "utils.js", "my-team.js"]);
  const names = (snap, strength) => json(ctx, `MyTeam.managerNamesFromData(${JSON.stringify(snap)}, ${JSON.stringify(strength)})`);
  assert.deepStrictEqual(names({ rows: [{ teamName: "zed" }, { teamName: "Alvin" }, { username: "alvin" }, { teamName: " " }] }, { teams: { x: {} } }), ["Alvin", "zed"]);
  assert.deepStrictEqual(names({ rows: [{ username: "u2", teamName: "Team" }, { username: "u1" }], preseason: true }, null), ["u1", "u2"]);
  assert.deepStrictEqual(names(null, { teams: { b: {}, a: {} } }), ["a", "b"]);
  assert.deepStrictEqual(names(null, null), []);
});

test("MyTeam: changing it re-draws Home's team-aware pieces and tells the page", () => {
  const ctx = loadSiteModules(["config.js", "utils.js", "my-team.js"]);
  ctx.localStorage = storageStub();
  const events = [];
  ctx.CustomEvent = function (type, init) {
    this.type = type;
    this.detail = init && init.detail;
  };
  ctx.document.dispatchEvent = (e) => events.push([e.type, e.detail.username]);
  runInLoadedContext(ctx, `MyTeam.set("Alvin")`);
  runInLoadedContext(ctx, `MyTeam.clear()`);
  assert.deepStrictEqual(events, [["myteam:change", "Alvin"], ["myteam:change", null]]);
});

// ---- markup -------------------------------------------------------------------------------------------
test("Home markup: My Team and the tiles up top, Standings, then This Week and Last Week, Hot & Cold beside Power Rankings, records and activity last", () => {
  const html = read("index.html");
  const pos = (s) => {
    const i = html.indexOf(s);
    assert.ok(i >= 0, s);
    return i;
  };
  const order = ["my-team-card", "home-tiles", "featured-matchup-panel", "standings-body", "matchups-list", "last-week-matchups-list", "streaks-panel", "power-rankings-snapshot", "records-reach", "latest-records", "recent-activity-panel"];
  order.forEach((id, i) => i && assert.ok(pos(`id="${order[i - 1]}"`) < pos(`id="${id}"`), `${order[i - 1]} comes before ${id}`));
  assert.ok(!/<text[^>]*>(FUNTASY|TOOTBALL)/.test(html), "the hero no longer repeats the wordmark");
  ["sb-eyebrow", "sb-title", "sb-sub", "home-fresh", "pr-fresh", "latest-fresh", "reach-fresh", "matchups-fresh", "last-week-fresh", "last-week-foot", "featured-note", "ros-note", "standings-legend", "standings-list", "standings-more", "standings-panel"].forEach((id) =>
    assert.ok(html.includes(`id="${id}"`), id)
  );
  assert.ok(!/newsletter/i.test(html), "no newsletter anywhere on Home");
  assert.ok(!/id="sb-ticker"|id="standings-fresh"|id="hotcold-fresh"|class="panel-note"[^>]*>Click/.test(html), "the old pulse strip and chips are gone");
  assert.ok(!/<details class="panel last-week-panel"/.test(html), "Last Week is an open panel now, not a fold-away");
  assert.ok(!/Matchup Preview|Mockup|Option \d|Hot &amp; Cold \(/i.test(html), "no mockup titles or labels on the real page");
});

test("every page loads js/my-team.js after utils.js (so the star is in the top bar everywhere)", () => {
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length >= 10);
  pages.forEach((page) => {
    const html = read(page);
    const utils = html.indexOf('src="js/utils.js');
    const mine = html.indexOf('src="js/my-team.js');
    assert.ok(utils > 0 && mine > utils, `${page}: my-team.js should follow utils.js`);
    assert.ok(html.indexOf('src="js/config.js') < mine, `${page}: and config.js`);
  });
});

test("the Power Rankings page loads the Sleeper client so it can tell whether its snapshot is behind", () => {
  const html = read("power-rankings.html");
  assert.ok(html.indexOf("js/sleeper-api.js") > 0 && html.indexOf("js/sleeper-api.js") < html.indexOf("js/power-rankings.js"));
});

// ---- member-facing copy ------------------------------------------------------------------------------------
const BUILDER_WORDS = /data\/[\w-]+\.json|scripts\/[\w-]+\.js|js\/config|LEAGUE_ID|npm run|GitHub(?!\.io)|Run workflow|workflow|just ask|ask me|replace or delete|cached in your browser|see the footer/i;

function visibleHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ");
}

test("no page shows builder instructions to members (footers, empty states, notes)", () => {
  fs.readdirSync(ROOT)
    .filter((f) => f.endsWith(".html"))
    .forEach((page) => {
      const m = BUILDER_WORDS.exec(visibleHtml(read(page)));
      assert.ok(!m, `${page} mentions "${m && m[0]}"`);
    });
});

test("no script puts builder instructions in a string members can see", () => {
  // Strings only: comments are stripped first. config.js and the data-file constants
  // are the places file names legitimately live.
  const skip = new Set(["config.js", "sleeper-api.js", "deep-history.js", "manual-history.js"]);
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/[^\n]*/g, "$1");
  const hits = [];
  fs.readdirSync(path.join(ROOT, "js"))
    .filter((f) => f.endsWith(".js") && !skip.has(f))
    .forEach((f) => {
      const code = stripComments(read("js", f));
      for (const m of code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
        const text = m[2];
        if (/^[\w./-]*(FILE|\.json|\.js)$/.test(text) && !/\s/.test(text)) continue; // a bare path/constant, not prose
        if (BUILDER_WORDS.test(text) && /\s/.test(text)) hits.push(`${f}: ${text.slice(0, 90)}`);
      }
    });
  assert.deepStrictEqual(hits, []);
});

// ---- the Power Rankings page -------------------------------------------------------------------
test("Power Rankings page: a snapshot chip beside the table title, with no refresh instructions", () => {
  const ctx = loadSiteModules(["config.js", "utils.js", "power-rankings.js"]);
  const snapshot = {
    season: "2026", week: 6, generatedAt: "2026-10-20T11:03:00Z", playoffTeams: 6,
    rows: [{ rosterId: 1, teamName: "u1", record: "5-1", overallRecord: "50-16-1", powerRank: 1, prScore: 1.2, luckRank: 3, avgPpg: 140, stdDev: 20, playoffPct: 90, byePct: 50, rosRank: 1, boom: 4, bust: 1, finishDistribution: [50, 50] }],
  };
  ctx.__s = snapshot;
  const html = runInLoadedContext(ctx, `renderContent(__s, null, 7)`);
  assert.ok(html.includes("Snapshot · Through Week 6 · Oct 20 · updates with each ROS refresh"));
  assert.ok(html.includes("fresh-snap") && !html.includes("fresh-behind"));
  assert.ok(!/footer|script|data\//i.test(visibleHtml(html)));
  assert.ok(runInLoadedContext(ctx, `renderContent(__s, null, 9)`).includes("fresh-behind"), "week 9 is being played; week 6 is stale");
  assert.ok(!runInLoadedContext(ctx, `renderContent(__s, null, null)`).includes("fresh-behind"), "unknown NFL week: never alarm");
  assert.strictEqual((html.match(/fresh-chip/g) || []).length, 2, "one chip per panel");
});

test("Records page: a chip says which week the record dates and NEW badges run through", () => {
  const ctx = loadSiteModules(["config.js", "utils.js", "record-book.js", "record-defs.js", "records.js"]);
  runInLoadedContext(ctx, `rbShowHistoryFreshness({ asOf: { season: "2026", week: 5 }, records: {} })`);
  const html = ctx.document.getElementById("records-fresh").innerHTML;
  assert.ok(html.includes("2026 record dates · Through Week 5 · updates Tuesdays"));
  runInLoadedContext(ctx, `rbShowHistoryFreshness(null)`);
  assert.strictEqual(ctx.document.getElementById("records-fresh").innerHTML, "", "an older/missing history file shows no chip");
  assert.ok(read("records.html").includes('id="records-fresh"'));
});

test("Power Rankings hero says 'After Week N' so it can't contradict Home's current week", () => {
  const src = read("js", "power-rankings.js");
  assert.ok(src.includes("After Week ${snapshot.week}"));
});
