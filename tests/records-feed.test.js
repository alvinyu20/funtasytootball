const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { loadSiteModules: loadForScripts } = require("../scripts/lib/load-site-modules");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const replayLib = require("../scripts/lib/records-replay");
const { fixtureInput } = require("./helpers/record-fixture.js");

// ---- helpers ---------------------------------------------------------------------------------
function engine() {
  return loadForScripts(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "record-book.js", "record-defs.js"]);
}

// The fixture league, shaped like data/sleeper-archive/<year>.json.
function fixtureBase(ctx, extra) {
  const input = fixtureInput();
  const archives = input.seasonChain.map((entry, i) => ({
    league: entry.league,
    rosters: entry.rosters,
    users: entry.users,
    bracket: entry.bracket,
    weeks: input.deepSeasons[i].weeks,
    transactions: [],
    draft: null,
  }));
  return { RecordBook: ctx.RecordBook, DeepHistory: ctx.DeepHistory, archives, playerDirectory: input.playerDirectory, manual: null, powerRanks: null, rawStats: null, ...extra };
}

// ---- time points and cut-offs ----------------------------------------------------------------
test("timePoints: every scored week of every season, oldest first, flagging each season's last week", () => {
  const base = fixtureBase(engine());
  const pts = replayLib.timePoints(base.archives);
  assert.deepStrictEqual(pts.map((p) => `${p.season}:${p.week}`), ["2022:1", "2022:2", "2022:3", "2022:4", "2022:5", "2023:1", "2023:2"]);
  assert.deepStrictEqual(pts.filter((p) => p.isLastWeek).map((p) => `${p.season}:${p.week}`), ["2022:5", "2023:2"]);
});

test("bracketAsOf: a round that hasn't been played yet has no winner or loser, so its teams can't be known", () => {
  const bracket = fixtureBase(engine()).archives[0].bracket;
  const wk4 = replayLib.bracketAsOf(bracket, 4, 4);
  const semi = wk4.find((g) => g.m === 1);
  const final = wk4.find((g) => g.m === 3);
  assert.strictEqual(semi.w, 1, "week 4's semifinals are decided");
  assert.strictEqual(final.w, null, "week 5's final is not");
  assert.strictEqual(final.p, 1, "but it is still the championship game");
  assert.strictEqual(replayLib.bracketAsOf(bracket, 4, 5).find((g) => g.m === 3).w, 1, "once week 5 is in, it is decided");
});

test("inputAt: the league as it stood after a given week", () => {
  const base = fixtureBase(engine());
  const [w1, w2, w3, w4, w5, y23w1] = replayLib.timePoints(base.archives);
  const mid = replayLib.inputAt(base, w3);
  assert.strictEqual(mid.seasonChain.length, 1, "2023 doesn't exist yet");
  assert.strictEqual(mid.seasonChain[0].league.status, "in_season", "2022 was still being played after week 3");
  assert.strictEqual(mid.deepSeasons[0].weeks.length, 3);

  const done = replayLib.inputAt(base, w5);
  assert.strictEqual(done.seasonChain[0].league.status, "complete", "its real status once its final week is in");
  assert.strictEqual(done.deepSeasons[0].weeks.length, 5);

  const next = replayLib.inputAt(base, y23w1);
  assert.strictEqual(next.seasonChain.length, 2);
  assert.strictEqual(next.seasonChain[0].league.status, "complete", "earlier seasons stay as they were");
  assert.strictEqual(next.deepSeasons[1].weeks.length, 1);
});

test("no champion until the final has been played", () => {
  const ctx = engine();
  const base = fixtureBase(ctx);
  const pts = replayLib.timePoints(base.archives);
  const champions = (point) => {
    const facts = ctx.RecordBook.buildFacts(replayLib.inputAt(base, point));
    return facts.teamSeasons.filter((t) => t.season === "2022" && t.isChampion).length;
  };
  assert.strictEqual(champions(pts[3]), 0, "after the semifinals");
  assert.strictEqual(champions(pts[4]), 1, "after the final");
});

test("power rankings and raw stats are cut off at the same week", () => {
  const base = fixtureBase(engine());
  const power = { seasons: { 2022: { ranks: { a: { pre: 1, weekly: [1, 2, 3, 4, 5] } }, playoffOdds: { a: [10, 20, 30, 40, 50] } }, 2023: { ranks: { a: { weekly: [1] } } } } };
  const cut = replayLib.powerRanksAsOf(power, 0, base.archives, 3);
  assert.deepStrictEqual(cut.seasons[2022].ranks.a.weekly, [1, 2, 3]);
  assert.deepStrictEqual(cut.seasons[2022].playoffOdds.a, [10, 20, 30]);
  assert.strictEqual(cut.seasons[2023], undefined, "a later season doesn't exist yet");
  const raw = { seasons: { 2022: { 1: { u1: [1] }, 2: { u1: [2] }, 3: { u1: [3] } } } };
  assert.deepStrictEqual(Object.keys(replayLib.rawStatsAsOf(raw, 0, base.archives, 2).seasons[2022]), ["1", "2"]);
});

// ---- deciding what counts as a new record ----------------------------------------------------
const top = (holder, raw, when, extra) => ({ holder, name: holder, raw, when: when == null ? null : when, valueText: String(raw), detail: "", ...extra });
const snap = (...tops) => ({ status: "ok", tops });
const desc = { dir: "desc" };
const asc = { dir: "asc" };

test("changeBetween: a record with nothing before it is new", () => {
  assert.strictEqual(replayLib.changeBetween(desc, null, snap(top("A", 10, 1))).kind, "new");
  assert.strictEqual(replayLib.changeBetween(desc, { status: "empty", tops: [] }, snap(top("A", 10, 1))).kind, "new");
  assert.strictEqual(replayLib.changeBetween(desc, snap(top("A", 10, 1)), { status: "empty", tops: [] }), null);
});

test("changeBetween: someone else beating the mark breaks it; the old holder is named", () => {
  const c = replayLib.changeBetween(desc, snap(top("A", 10, 1)), snap(top("B", 12, 2)));
  assert.strictEqual(c.kind, "broke");
  assert.strictEqual(c.subject.holder, "B");
  assert.strictEqual(c.previous.holder, "A");
  const low = replayLib.changeBetween(asc, snap(top("A", 10, 1)), snap(top("B", 8, 2)));
  assert.strictEqual(low.kind, "broke", "lower is better for an ascending record");
});

test("changeBetween: a holder adding to a running total is not a new record, but a fresh performance by the holder is", () => {
  assert.strictEqual(replayLib.changeBetween(desc, snap(top("A", 41)), snap(top("A", 42))), null, "career wins 41 -> 42");
  const own = replayLib.changeBetween(desc, snap(top("A", 10, 1)), snap(top("A", 12, 2)));
  assert.strictEqual(own.kind, "broke-own");
  assert.strictEqual(own.previous.raw, 10, "compared with their own old mark");
});

test("changeBetween: matching the old mark is not setting a new one, and the lead can change hands without a better number", () => {
  assert.strictEqual(replayLib.changeBetween(desc, snap(top("A", 10, 1)), snap(top("A", 10, 1), top("B", 10, 2))), null, "B tied it");
  assert.strictEqual(replayLib.changeBetween(desc, snap(top("A", 10, 1)), snap(top("B", 10, 2))), null, "an equal value is a tie even if the first holder dropped out");
  const slipped = replayLib.changeBetween(desc, snap(top("A", 60)), snap(top("B", 58)));
  assert.strictEqual(slipped.kind, "took-over", "A slipped below B");
  assert.strictEqual(replayLib.changeBetween(desc, snap(top("A", 60, 1)), snap(top("A", 58, 2))), null, "the same holder with a worse number is nothing new");
});

// ---- replaying a league ----------------------------------------------------------------------
test("replay: dates each time the single-week high score was set, newest first", () => {
  const ctx = engine();
  const { events, asOf, points } = replayLib.replay(fixtureBase(ctx));
  assert.strictEqual(points, 7);
  assert.deepStrictEqual(asOf, { season: "2023", week: 2 });
  const high = events.filter((e) => e.id === "highest-team-score").map((e) => `${e.season} wk${e.week} ${e.kind} ${e.holder} ${e.value}${e.previous ? " <- " + e.previous.holder + " " + e.previous.value : ""}`);
  assert.deepStrictEqual(high, [
    "2022 wk3 broke b 130.0 <- a 120.0",
    "2022 wk2 broke a 120.0 <- c 110.0",
    "2022 wk1 new c 110.0",
  ]);
});

test("replay: a season record shows up the week the regular season ends, not before", () => {
  const { events } = replayLib.replay(fixtureBase(engine()));
  const wins = events.filter((e) => e.id === "most-wins-season");
  assert.deepStrictEqual(wins.map((e) => `${e.season} wk${e.week} ${e.holder}`), ["2022 wk4 a"], "a's 3-0 appears once week 4 (the first playoff week) is in the books");
});

test("replay: running averages and percentages are left out of the feed", () => {
  const ctx = engine();
  const { events } = replayLib.replay(fixtureBase(ctx));
  const rateIds = new Set(JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.DEFS.filter((d) => d.rate).map((d) => d.id))`)));
  assert.ok(rateIds.size >= 10);
  ["best-win-pct", "luckiest-career", "lineup-efficiency", "faab-roi", "highest-combined-average", "best-drafter-qb"].forEach((id) => assert.ok(rateIds.has(id), id));
  assert.deepStrictEqual(events.filter((e) => rateIds.has(e.id)), []);
});

test("replay: the last week's records are exactly what the Records page shows for All seasons", () => {
  const ctx = engine();
  const base = fixtureBase(ctx);
  const pts = replayLib.timePoints(base.archives);
  const last = ctx.RecordBook.buildFacts(replayLib.inputAt(base, pts[pts.length - 1]));
  const full = ctx.RecordBook.buildFacts(fixtureInput());
  const key = (facts, id) => {
    ctx.__f = facts;
    return runInLoadedContext(ctx, `(function () {
      const def = RecordBook.DEFS.find((d) => d.id === ${JSON.stringify(id)});
      const cat = RecordBook.CATEGORIES.find((c) => c.id === def.cat);
      return JSON.stringify(RecordBook.compute(def, RecordBook.context(__f, "all", !cat.history)).entries.map((e) => [e.name, e.valueText]));
    })()`);
  };
  const ids = ["highest-team-score", "most-wins-season", "biggest-blowout", "most-lopsided-head-to-head", "most-championship-starts", "most-playoff-meetings"];
  ids.forEach((id) => {
    assert.ok(ctx.RecordBook.DEFS.some((d) => d.id === id), `${id} exists`);
    const text = key(full, id);
    assert.ok(text.length > 4, `${id} has entries to compare`);
    assert.strictEqual(key(last, id), text, id);
  });
});

// ---- the committed feed file -----------------------------------------------------------------
test("data/records-feed.json: newest first, complete events, nothing from the running-average records", () => {
  const file = path.join(__dirname, "..", "data", "records-feed.json");
  const feed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(feed.asOf && feed.asOf.season && feed.asOf.week);
  assert.ok(feed.events.length >= 10 && feed.events.length <= 60);
  const ctx = engine();
  const defs = new Map(JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.DEFS.map((d) => [d.id, { rate: !!d.rate, cat: d.cat }]))`)));
  let prev = null;
  feed.events.forEach((e) => {
    ["id", "title", "category", "categoryTitle", "season", "week", "kind", "holder", "value"].forEach((f) => assert.ok(e[f] !== undefined && e[f] !== "", `${e.id} missing ${f}`));
    assert.ok(defs.has(e.id), `${e.id} is a real record`);
    assert.strictEqual(defs.get(e.id).rate, false, `${e.id} is a running average`);
    assert.strictEqual(defs.get(e.id).cat, e.category);
    const when = Number(e.season) * 100 + e.week;
    if (prev != null) assert.ok(when <= prev, "newest first");
    prev = when;
  });
});

// ---- Home page list --------------------------------------------------------------------------
function homeCtx() {
  return loadSiteModules(["config.js", "utils.js", "dashboard.js"]);
}
const sampleEvent = (over) => ({
  id: "highest-team-score", title: "Highest Team Score", category: "matchups", categoryTitle: "Matchups", season: "2026", week: 5,
  kind: "broke", holder: "Alvin", value: "212.4", detail: "vs Teddy · 2026 Wk 5", previous: { holder: "Teddy", value: "205.1" }, ...over,
});

test("Latest Records: shows the newest ten with the date, record, holder, value and category, each linking to its record", () => {
  const ctx = homeCtx();
  const events = Array.from({ length: 14 }, (_, i) => sampleEvent({ id: `rec-${i}`, title: `Record ${i}`, week: 14 - i }));
  ctx.__feed = { asOf: { season: "2026", week: 5 }, events };
  const html = runInLoadedContext(ctx, `latestRecordsHtml(__feed)`);
  assert.strictEqual((html.match(/class="lr-item"/g) || []).length, 10);
  assert.ok(html.includes("Record 0") && html.includes("Record 9") && !html.includes("Record 10"));
  assert.ok(html.includes('href="records.html#matchups/all/rec-0"'));
  assert.ok(html.includes("212.4") && html.includes(">Matchups<") && html.includes("Week 14"));
  assert.ok(html.includes("Through 2026 Week 5"));
});

test("Latest Records: says what happened to the old mark", () => {
  const ctx = homeCtx();
  const note = (e) => runInLoadedContext(ctx, `latestRecordNote(${JSON.stringify(e)})`);
  assert.strictEqual(note(sampleEvent()), "Broke Teddy’s 205.1");
  assert.strictEqual(note(sampleEvent({ kind: "broke-own" })), "Topped their own 205.1");
  assert.strictEqual(note(sampleEvent({ kind: "took-over" })), "Took the lead from Teddy");
  assert.strictEqual(note(sampleEvent({ kind: "new", previous: null })), "New on the books");
});

test("Latest Records: names are escaped, and an empty or missing feed says so instead of breaking", () => {
  const ctx = homeCtx();
  ctx.__feed = { events: [sampleEvent({ holder: "<img src=x onerror=alert(1)>", detail: "" })] };
  const html = runInLoadedContext(ctx, `latestRecordsHtml(__feed)`);
  assert.ok(!html.includes("<img"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(runInLoadedContext(ctx, `latestRecordsHtml(null)`).includes("No record changes tracked yet"));
  assert.ok(runInLoadedContext(ctx, `latestRecordsHtml({ events: [] })`).includes("No record changes tracked yet"));
});

test("Home page markup has the Latest Records panel and loads the feed", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(html.includes('id="latest-records"'));
  assert.ok(fs.readFileSync(path.join(__dirname, "..", "js", "dashboard.js"), "utf8").includes("fetchJsonSafe(RECORDS_FEED_FILE"));
});

// ---- linking straight to a record -------------------------------------------------------------
test("records route: a third part names one record to open", () => {
  const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "animations.js", "record-book.js", "record-defs.js", "records.js"]);
  const route = JSON.parse(runInLoadedContext(ctx, `JSON.stringify(rbParseRoute("#players/all/most-playoff-starts"))`));
  assert.deepStrictEqual(route, { category: "players", era: "all", record: "most-playoff-starts" });
  assert.strictEqual(JSON.parse(runInLoadedContext(ctx, `JSON.stringify(rbParseRoute("#players/2024"))`)).record, null);
  assert.strictEqual(JSON.parse(runInLoadedContext(ctx, `JSON.stringify(rbParseRoute("#nonsense/all/x"))`)).record, null);
});

// ---- ties, then a takeover -------------------------------------------------------------------
test("carryReign: a challenger who ties the record and passes it a week later still takes the lead", () => {
  const week1 = snap(top("A", 10));
  const tie = snap(top("A", 10), top("B", 10));
  assert.strictEqual(replayLib.changeBetween(desc, week1, tie), null, "tying isn't a record");
  const reign = replayLib.carryReign(week1, tie);
  assert.deepStrictEqual(reign.tops.map((t) => t.holder), ["A"], "B has only tied; A still reigns");
  const pass = replayLib.changeBetween(desc, reign, snap(top("B", 11)));
  assert.strictEqual(pass.kind, "broke");
  assert.strictEqual(pass.subject.holder, "B");
  assert.strictEqual(pass.previous.holder, "A");
  // while the holder keeps adding to a running total the reign follows their number
  const grown = replayLib.carryReign(reign, snap(top("A", 12)));
  assert.strictEqual(grown.tops[0].raw, 12);
  assert.strictEqual(replayLib.changeBetween(desc, grown, snap(top("A", 13))), null);
  // a record that goes blank is remembered, not forgotten
  assert.strictEqual(replayLib.carryReign(reign, { status: "empty", tops: [] }), reign);
});

test("whenScope: what a record's `when` stands for", () => {
  const w = replayLib.whenScope;
  assert.strictEqual(w(null), "since", "a running total has no single moment");
  assert.strictEqual(w(202414), "week");
  assert.strictEqual(w(2024), "season");
  assert.strictEqual(w(202400), "season", "Best Player Season is stamped season*100");
  assert.strictEqual(w(2024037), "draft");
});

test("eventDate: the replay's date, except for a record already on the books when the replay starts", () => {
  const at = { season: "2020", week: 1 };
  const d = replayLib.eventDate;
  assert.deepStrictEqual(d("week", 202414, { season: "2024", week: 14 }, false, false), { season: "2024", week: 14 });
  assert.deepStrictEqual(d("season", 2023, { season: "2023", week: 15 }, false, true), { season: "2023", week: null }, "a season record has no week");
  assert.deepStrictEqual(d("draft", 2023037, { season: "2023", week: 17 }, false, false), { season: "2023", week: null });
  // already there at the start: use the record's own date
  assert.deepStrictEqual(d("season", 2018, at, true, true), { season: "2018", week: null }, "a 2018 season");
  assert.deepStrictEqual(d("week", 202001, at, true, false), { season: "2020", week: 1 });
  assert.deepStrictEqual(d("draft", 2019037, at, true, true), { season: "2019", week: null });
  assert.deepStrictEqual(d("since", null, at, true, true), { season: "2020", week: null, before: true }, "a career total that started out ahead, counting pre-Sleeper seasons");
  assert.deepStrictEqual(d("since", null, at, true, false), { season: "2020", week: 1 }, "a Sleeper-only total really did start in week 1");
  assert.deepStrictEqual(d("since", null, { season: "2022", week: 9 }, false, true), { season: "2022", week: 9 });
});

// ---- when each record's current holder got there ----------------------------------------------
test("replay: `current` says when the present holder took over, and flags anything from the newest weeks as NEW", () => {
  const ctx = engine();
  const { current, events } = replayLib.replay(fixtureBase(ctx));
  const high = current["highest-team-score"];
  assert.deepStrictEqual({ holder: high.holder, scope: high.scope, season: high.season, week: high.week, kind: high.kind }, { holder: "b", scope: "week", season: "2022", week: 3, kind: "broke" });
  assert.strictEqual(high.when, 202203);
  assert.strictEqual(high.isNew, false, "2022 wk 3 is more than three scored weeks before 2023 wk 2");
  // a running total has no `when` of its own, only the week its leader got there
  const wins = current["career-wins"];
  assert.strictEqual(wins.scope, "since");
  assert.strictEqual(wins.when, null);
  // the newest weeks are NEW
  const newest = Object.entries(current).filter(([, c]) => c.season === "2023" && c.week === 2);
  assert.ok(newest.length > 0 && newest.every(([, c]) => c.isNew), "something was set in the last week and it is flagged");
  // the opening standings of a career total are "before" the weekly history, not week 1 of it
  const start = events.find((e) => e.id === "career-wins" && e.kind === "new");
  assert.strictEqual(start.date.before, true);
  assert.strictEqual(start.scope, "since");
  // running averages have no date
  assert.strictEqual(current["best-win-pct"], undefined);
  assert.ok(events.length > 0);
});

// ---- Records in Reach --------------------------------------------------------------------------
const { reachItems } = require("../scripts/lib/records-reach");

test("reachItems: active managers close to a career total or a live streak are listed, closest first", () => {
  const ctx = engine();
  const base = fixtureBase(ctx);
  const pts = replayLib.timePoints(base.archives);
  const facts = ctx.RecordBook.buildFacts(replayLib.inputAt(base, pts[pts.length - 1]));
  const items = reachItems(ctx.RecordBook, facts);
  assert.ok(Array.isArray(items));
  items.forEach((r) => {
    ["id", "title", "category", "categoryTitle", "kind", "challenger", "current", "holder", "record", "gap"].forEach((f) => assert.ok(r[f] !== undefined, `${r.id} has ${f}`));
    assert.notStrictEqual(r.challenger, r.holder, "nobody chases themselves");
    assert.ok(["total", "streak"].includes(r.kind));
  });
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].ratio <= items[i].ratio, "closest first");
});

// A tiny league built to have known gaps: totals of 21 and 20 championships-style counts are not
// possible in a fixture, so the thresholds are tested on a stand-in engine.
function fakeEngine(defs, results, facts) {
  return {
    CATEGORIES: [{ id: "careers", title: "Careers", history: true }],
    FORMATS: { int: (n) => String(Math.round(n)), dec1: (n) => n.toFixed(1) },
    DEFS: defs,
    context: () => ({ name: (k) => k.toUpperCase() }),
    compute: (def) => results[def.id],
  };
}
const factsFor = (keys) => ({ latest: { season: "2026", week: 5 }, teamSeasons: keys.map((key) => ({ season: "2026", key })) });
const okResult = (key, name, raw) => ({ status: "ok", entries: [{ key, name, raw, valueText: String(raw) }] });

test("reachItems: totals need to be within 5% (or one, for small counts); retired managers and the leader are skipped", () => {
  const def = (id, rows, over) => ({ id, title: id, cat: "careers", section: "x", fmt: "int", grows: true, compute: () => ({ rows }), ...over });
  const defs = [
    def("big-close", [{ key: "a", raw: 1000 }, { key: "b", raw: 960 }, { key: "c", raw: 900 }]),
    def("big-far", [{ key: "a", raw: 1000 }, { key: "b", raw: 900 }]),
    def("small-one-behind", [{ key: "a", raw: 5 }, { key: "b", raw: 4 }]),
    def("small-two-behind", [{ key: "a", raw: 5 }, { key: "b", raw: 3 }]),
    def("retired", [{ key: "a", raw: 100 }, { key: "z", raw: 99 }]),
    def("level", [{ key: "a", raw: 100 }, { key: "b", raw: 100 }]),
  ];
  const results = {
    "big-close": okResult("a", "A", 1000), "big-far": okResult("a", "A", 1000), "small-one-behind": okResult("a", "A", 5),
    "small-two-behind": okResult("a", "A", 5), retired: okResult("a", "A", 100), level: okResult("a", "A", 100),
  };
  const items = reachItems(fakeEngine(defs, results), factsFor(["a", "b", "c"]));
  assert.deepStrictEqual(items.map((i) => i.id), ["big-close", "small-one-behind"].sort((x, y) => items.findIndex((i) => i.id === x) - items.findIndex((i) => i.id === y)));
  assert.deepStrictEqual(items.map((i) => i.id).sort(), ["big-close", "small-one-behind"]);
  const close = items.find((i) => i.id === "big-close");
  assert.deepStrictEqual({ challenger: close.challenger, holder: close.holder, gap: close.gap, current: close.current, record: close.record, kind: close.kind }, { challenger: "B", holder: "A", gap: "40", current: "960", record: "1000", kind: "total" });
});

test("reachItems: a live streak counts when it is within three of the record and at least three long", () => {
  const live = (rows) => ({ id: "s", title: "S", cat: "careers", section: "x", fmt: "int", live: () => rows });
  const run = (rows, record) => reachItems(fakeEngine([{ ...live(rows), id: "s" }], { s: okResult("a", "A", record) }), factsFor(["a", "b", "c"]));
  assert.strictEqual(run([{ key: "b", raw: 7 }], 9).length, 1, "2 away");
  assert.strictEqual(run([{ key: "b", raw: 6 }], 9).length, 1, "3 away");
  assert.strictEqual(run([{ key: "b", raw: 5 }], 9).length, 0, "4 away");
  assert.strictEqual(run([{ key: "b", raw: 2 }], 4).length, 0, "too short to be exciting");
  assert.strictEqual(run([{ key: "a", raw: 8 }], 9).length, 0, "the holder's own streak");
  assert.strictEqual(run([{ key: "b", raw: 7 }], 9)[0].kind, "streak");
  assert.strictEqual(reachItems(fakeEngine([], {}), { latest: null, teamSeasons: [] }).length, 0);
});

test("the live streaks: only runs that reach the newest week of a season in progress", () => {
  const ctx = engine();
  const base = fixtureBase(ctx);
  const pts = replayLib.timePoints(base.archives);
  const facts = ctx.RecordBook.buildFacts(replayLib.inputAt(base, pts[pts.length - 1]));
  ctx.__facts = facts;
  const live = JSON.parse(runInLoadedContext(ctx, `(function () {
    const def = RecordBook.DEFS.find((d) => d.id === "longest-win-streak");
    return JSON.stringify(def.live(RecordBook.context(__facts, "all", true)).map((r) => [facts_name(r.key), r.raw]).sort());
    function facts_name(k) { return __facts.managers.get(k).username; }
  })()`));
  // b won weeks 2-3 of 2022 and both 2023 weeks (streaks cross seasons, playoffs aside); c won 2023 week 2 only;
  // a lost both 2023 weeks and d lost week 2, so neither is on a streak
  assert.deepStrictEqual(live, [["b", 4], ["c", 1]], "a and d are not on a win streak any more");
  // a finished season has nothing live
  const done = ctx.RecordBook.buildFacts(replayLib.inputAt(base, pts[4]));
  ctx.__done = done;
  assert.strictEqual(runInLoadedContext(ctx, `RecordBook.DEFS.find((d) => d.id === "longest-win-streak").live(RecordBook.context(__done, "all", true)).length`), 0);
});

// ---- the committed data files ------------------------------------------------------------------
test("data/records-history.json: a timeline per record, newest first, tied to real records", () => {
  const history = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "records-history.json"), "utf8"));
  assert.ok(history.asOf && history.asOf.season);
  const ids = new Set(JSON.parse(runInLoadedContext(engine(), `JSON.stringify(RecordBook.DEFS.map((d) => d.id))`)));
  const rates = new Set(JSON.parse(runInLoadedContext(engine(), `JSON.stringify(RecordBook.DEFS.filter((d) => d.rate).map((d) => d.id))`)));
  const entries = Object.entries(history.records);
  assert.ok(entries.length > 80);
  entries.forEach(([id, h]) => {
    assert.ok(ids.has(id), `${id} is a real record`);
    assert.ok(!rates.has(id), `${id} is a running average`);
    assert.ok(h.events.length >= 1 && h.events.length <= 12);
    let prev = Infinity;
    h.events.forEach((e) => {
      ["season", "week", "kind", "holder", "value"].forEach((f) => assert.ok(e[f] !== undefined && e[f] !== "", `${id} event missing ${f}`));
      const when = Number(e.season) * 100 + e.week;
      assert.ok(when <= prev, `${id} newest first`);
      prev = when;
    });
    if (h.current) {
      assert.ok(["week", "season", "draft", "since"].includes(h.current.scope), id);
      assert.strictEqual(typeof h.current.isNew, "boolean");
    }
  });
  // the records added in this batch are in there
  ["blockbuster-trades", "biggest-upset", "highest-scoring-benched-player", "fewest-wins-champion", "most-last-place-finishes"].forEach((id) => assert.ok(history.records[id], id));
});

test("data/records-feed.json: Records in Reach, closest first, each pointing at a real record", () => {
  const feed = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "records-feed.json"), "utf8"));
  assert.ok(Array.isArray(feed.reach));
  assert.ok(feed.reach.length <= 6);
  const ids = new Set(JSON.parse(runInLoadedContext(engine(), `JSON.stringify(RecordBook.DEFS.map((d) => d.id))`)));
  feed.reach.forEach((r) => {
    assert.ok(ids.has(r.id));
    assert.notStrictEqual(r.challenger, r.holder);
  });
  for (let i = 1; i < feed.reach.length; i++) assert.ok(feed.reach[i - 1].ratio <= feed.reach[i].ratio);
});

// ---- the Home panel ----------------------------------------------------------------------------
const sampleReach = (over) => ({ id: "career-points", title: "Career Points", category: "careers", categoryTitle: "Careers", kind: "total", challenger: "Teddy", current: "12,307.4", holder: "Anthony", record: "12,345.6", gap: "38.2", ratio: 0.003, ...over });

test("Records in Reach: who is chasing what, with the gap, linking to the record", () => {
  const ctx = homeCtx();
  ctx.__feed = { reach: [sampleReach(), sampleReach({ id: "longest-win-streak", title: "Longest Win Streak", category: "streaks", categoryTitle: "Streaks & Milestones", kind: "streak", current: "7", record: "9", gap: "2" })] };
  const html = runInLoadedContext(ctx, `recordsInReachHtml(__feed)`);
  assert.strictEqual((html.match(/class="lr-item"/g) || []).length, 2);
  assert.ok(html.includes("Teddy") && html.includes("Career Points") && html.includes("38.2") && html.includes("behind"));
  assert.ok(html.includes("Chasing Anthony’s 12,345.6"));
  assert.ok(html.includes("Streak still alive") && html.includes("Anthony’s record is 9"));
  assert.ok(html.includes('href="records.html#careers/all/career-points"'));
});

test("Records in Reach: empty or missing means no panel content, and names are escaped", () => {
  const ctx = homeCtx();
  assert.strictEqual(runInLoadedContext(ctx, `recordsInReachHtml(null)`), "");
  assert.strictEqual(runInLoadedContext(ctx, `recordsInReachHtml({ reach: [] })`), "");
  assert.strictEqual(runInLoadedContext(ctx, `recordsInReachHtml({ events: [] })`), "", "an older feed file without a reach list");
  ctx.__feed = { reach: [sampleReach({ challenger: "<b>x</b>" })] };
  const html = runInLoadedContext(ctx, `recordsInReachHtml(__feed)`);
  assert.ok(!html.includes("<b>x"));
  assert.ok(html.includes("&lt;b&gt;"));
});

test("Home page markup has a Records in Reach panel that starts hidden", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(html, /id="records-reach-panel"[^>]*display: none/);
  assert.ok(html.includes('id="records-reach"'));
});
