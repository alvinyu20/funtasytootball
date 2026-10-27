const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const { fixtureInput, fixtureManual, fixturePowerRanks } = require("./helpers/record-fixture.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "animations.js", "record-book.js", "record-defs.js", "records.js"]);
}

const evalJson = (ctx, code) => JSON.parse(runInLoadedContext(ctx, `JSON.stringify(${code})`));
const evalHtml = (ctx, code) => runInLoadedContext(ctx, code);

test("routes: '#category' and '#category/era' parse, unknown or empty hashes fall back to the landing page", () => {
  const ctx = setup();
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("#careers")`), { category: "careers", era: "all", record: null });
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("#front-office/last3")`), { category: "front-office", era: "last3", record: null });
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("#players/2024")`), { category: "players", era: "2024", record: null });
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("#nonsense/2024")`), { category: null, era: "2024", record: null });
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("")`), { category: null, era: "all", record: null });
  assert.strictEqual(evalHtml(ctx, `rbRouteHash("careers", "all")`), "#careers");
  assert.strictEqual(evalHtml(ctx, `rbRouteHash("careers", "last3")`), "#careers/last3");
  assert.strictEqual(evalHtml(ctx, `rbRouteHash(null, "2024")`), "#");
});

test("landing: six category rows, each linking to its page with its record count", () => {
  const ctx = setup();
  const html = evalHtml(ctx, `rbLandingHtml(RecordBook.countByCategory(), "all")`);
  assert.strictEqual((html.match(/class="rb-cat"/g) || []).length, 6);
  ["careers", "seasons", "matchups", "players", "streaks", "front-office"].forEach((id) => assert.ok(html.includes(`href="#${id}"`), id));
  assert.match(html, /Careers[\s\S]*26 records/);
  assert.match(html, /Front Office[\s\S]*27 records/);
  assert.ok(html.includes("Winning, scoring and hardware"));
});

test("landing: singular count reads '1 record'", () => {
  const ctx = setup();
  const html = evalHtml(ctx, `rbLandingHtml({ careers: 1 }, "all")`);
  assert.match(html, /1 record</);
});

// Draws a category exactly the way rbRenderView does: Careers and Seasons see the
// pre-Sleeper seasons, every other category is Sleeper-only.
function pageHtml(ctx, categoryId, era, mutate) {
  return evalHtml(
    ctx,
    `(function () {
      const input = ${JSON.stringify(fixtureInput())};
      ${mutate || ""}
      const facts = RecordBook.buildFacts(input);
      const category = RecordBook.CATEGORIES.find((x) => x.id === ${JSON.stringify(categoryId)});
      const sleeperOnly = !category.history;
      const eras = RecordBook.eras(facts, sleeperOnly);
      const c = RecordBook.context(facts, ${JSON.stringify(era)}, sleeperOnly);
      return rbCategoryHtml({
        category, sections: RecordBook.computeCategory(category.id, c), eras, era: ${JSON.stringify(era)}, seasons: c.seasons,
        ...rbSeasonFlags(facts, c),
        rawPending: ${categoryId === "players"},
        preSleeper: facts.seasons.filter((s) => s.source === "espn" && c.seasonSet.has(s.season)).map((s) => s.season),
      });
    })()`
  );
}

test("category page: header, season filter pills, grouped sections with counts and the three column headings", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "careers", "all");
  assert.ok(html.includes(">Careers<"));
  assert.ok(html.includes("26 records"));
  // pills: All, Last 3, then newest season first, with the active one marked
  assert.match(html, /season-pill active" href="#careers" aria-current="true">All seasons</);
  assert.ok(html.includes('href="#careers/last3"'));
  assert.ok(html.indexOf('href="#careers/2023"') < html.indexOf('href="#careers/2022"'));
  // sections in definition order with their own counts
  assert.ok(html.indexOf(">Winning<") < html.indexOf(">Scoring<"));
  assert.match(html, /Winning<\/span><span class="rb-section-count">9 records/);
  assert.ok(html.includes("Record Holder") && html.includes("Record Value"));
  assert.ok(html.includes('href="#"'), "back link to the landing page");
});

test("category page: the season filter keeps its place in each pill's link and marks the selected era", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "seasons", "2022");
  assert.match(html, /season-pill active" href="#seasons\/2022" aria-current="true">2022</);
  assert.ok(html.includes("Showing <strong>2022</strong>"));
});

test("record rows: value, holder and an expandable top-10 list; lowlight records get the orange accent", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "careers", "all");
  const win = html.slice(html.indexOf('data-record="career-wins"'));
  assert.match(win.slice(0, 900), /rb-holder-name">b/);
  assert.match(win.slice(0, 1200), /rb-value">4</);
  assert.ok(win.includes('class="rb-top"'));
  assert.match(html, /<details class="rb-row rb-low" data-record="career-losses"/);
  assert.match(html, /<details class="rb-row" data-record="career-wins"/);
});

test("top-10 list: entries sharing a rank are shown as T1, T1, 3 rather than 1, 1, 3", () => {
  const ctx = setup();
  const html = evalHtml(
    ctx,
    `rbTopListHtml({ entries: [
      { rank: 1, name: "A", valueText: "5", detail: "" }, { rank: 1, name: "B", valueText: "5", detail: "" }, { rank: 3, name: "C", valueText: "3", detail: "" },
    ] })`
  );
  assert.deepStrictEqual(
    [...html.matchAll(/rb-top-rank">([^<]*)</g)].map((m) => m[1]),
    ["T1", "T1", "3"]
  );
});

test("record rows: records that need the raw-stats file show 'Awaiting data' (not expandable) plus a single explanatory banner", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "players", "all");
  assert.match(html, /rb-row rb-static" data-record="raw-career-pass_yd"[\s\S]*?Awaiting data/);
  assert.ok(!/<details[^>]*raw-career-pass_yd/.test(html));
  assert.strictEqual((html.match(/Team Raw Stats records/g) || []).length, 1);
  assert.ok(!/GitHub|Actions|workflow/i.test(html), "no builder instructions on a page members read");
});

test("record rows: when only an unfinished season is selected, season records say they unlock later", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "seasons", "2023");
  assert.ok(html.includes("Unlocks after the regular season"));
  assert.ok(!html.includes("No qualifying entries"));
  assert.ok(html.includes("single-season records unlock once its regular season ends"));
});

test("record rows: names are escaped, a tie shows '+N tied', and a headline overrides the first entry", () => {
  const ctx = setup();
  const html = evalHtml(
    ctx,
    `(function () {
      const def = { id: "x", title: "T <i>", desc: "d & d" };
      const result = { status: "ok", tied: 2, note: "n <b>", entries: [{ rank: 1, name: "<script>", playerId: null, valueText: "5", detail: "x" }, { rank: 1, name: "B", playerId: "123", valueText: "5", detail: "" }] };
      return rbRowHtml(def, result) + "|" + rbRowHtml(def, { ...result, headline: { name: "Leader", valueText: "11,155", detail: "current leader" } });
    })()`
  );
  const [plain, headlined] = html.split("|");
  assert.ok(!plain.includes("<script>") && plain.includes("&lt;script&gt;"));
  assert.ok(plain.includes("T &lt;i&gt;") && plain.includes("d &amp; d") && plain.includes("n &lt;b&gt;"));
  assert.ok(plain.includes("+2 tied"));
  assert.ok(plain.includes('href="player.html#123"'), "player names link to the player page");
  assert.ok(headlined.includes("Leader") && headlined.includes("11,155") && !headlined.includes("+2 tied"));
});

async function renderPage(hash, withData = true, withManual = false) {
  const ctx = setup();
  const input = fixtureInput();
  ctx.__INPUT__ = input;
  ctx.__MANUAL__ = withManual ? fixtureManual() : null;
  ctx.__CALLS__ = [];
  runInLoadedContext(
    ctx,
    `
    location.hash = ${JSON.stringify(hash)};
    SleeperAPI.getSeasonChain = async () => ${withData ? "__INPUT__.seasonChain" : "[]"};
    SleeperAPI.getPlayerDirectory = async () => __INPUT__.playerDirectory;
    DeepHistory.buildAll = async () => __INPUT__.deepSeasons;
    DeepHistory.computeStats = () => ({ managers: [] });
    fetchJsonSafe = async (file) => (file === MANUAL_HISTORY_FILE ? __MANUAL__ : null);
    initAnimatedDropdowns = () => { __CALLS__.push("initAnimatedDropdowns"); };
    `
  );
  await ctx.renderRecords();
  return ctx;
}

test("renderRecords: the landing page is drawn from the static definitions and the subtitle summarizes the data once it loads", async () => {
  const ctx = await renderPage("");
  const root = ctx.document.getElementById("records-root").innerHTML;
  assert.strictEqual((root.match(/class="rb-cat"/g) || []).length, 6);
  const total = runInLoadedContext(ctx, "RecordBook.DEFS.length");
  assert.ok(total >= 138, "every record is counted in the subtitle");
  assert.ok(ctx.document.getElementById("sb-sub").textContent.startsWith(`${total} records · 2022–2023 · 2 seasons`));
});

test("renderRecords: a category URL renders that category for the era in the hash and re-arms the smooth open/close animation", async () => {
  const ctx = await renderPage("#careers/2022");
  const root = ctx.document.getElementById("records-root").innerHTML;
  assert.ok(root.includes("Careers") && root.includes("Showing <strong>2022</strong>"));
  assert.ok(ctx.__CALLS__.includes("initAnimatedDropdowns"), "rows are <details>, which animate through initAnimatedDropdowns");
});

test("renderRecords: an unknown season in the URL falls back to All seasons", async () => {
  const ctx = await renderPage("#careers/1999");
  assert.ok(ctx.document.getElementById("records-root").innerHTML.includes("Showing <strong>2022–2023</strong>"));
});

test("renderRecords: with no seasons it shows the error instead of an empty page", async () => {
  const ctx = await renderPage("#careers", false);
  assert.match(ctx.document.getElementById("records-root").innerHTML, /Couldn't load league records/);
  assert.match(ctx.document.getElementById("records-error").textContent, /Couldn't load the league's seasons/);
});

const MANUAL = `input.manual = ${JSON.stringify(fixtureManual())};`;

test("naming: no category page says All-Play anywhere", () => {
  const ctx = setup();
  RecordBookIds.forEach((id) => {
    const html = pageHtml(ctx, id, "all", MANUAL);
    assert.ok(!/all-play/i.test(html), `${id} page should say Overall Record, not All-Play`);
  });
  const careers = pageHtml(ctx, "careers", "all", MANUAL);
  assert.ok(careers.includes("Career Overall Wins") && careers.includes("Best Overall Record") && careers.includes("Overall Record Titles"));
  assert.ok(pageHtml(ctx, "seasons", "all", MANUAL).includes("Most Overall Wins in a Season"));
});
const RecordBookIds = ["careers", "seasons", "matchups", "players", "streaks", "front-office"];

test("luck records show percentages on the page", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "seasons", "2022", MANUAL);
  const lucky = html.slice(html.indexOf('data-record="luckiest-season"'));
  assert.match(lucky.slice(0, 1000), /rb-value">\+22\.2%</);
  const unlucky = html.slice(html.indexOf('data-record="unluckiest-season"'));
  assert.match(unlucky.slice(0, 1000), /rb-value">\u221222\.2%</);
  assert.ok(!/wins</.test(lucky.slice(0, 1000)), "luck is no longer shown in wins");
});

test("Careers and Seasons offer the pre-Sleeper seasons as filters; the other categories don't", () => {
  const ctx = setup();
  ["careers", "seasons"].forEach((id) => {
    const html = pageHtml(ctx, id, "all", MANUAL);
    assert.ok(html.includes(`href="#${id}/2019"`), `${id} has a 2019 pill`);
    assert.ok(html.indexOf(`href="#${id}/2022"`) < html.indexOf(`href="#${id}/2019"`), "newest first");
    assert.ok(html.includes("Showing <strong>2019–2023</strong>"));
  });
  ["matchups", "players", "streaks", "front-office"].forEach((id) => {
    const html = pageHtml(ctx, id, "all", MANUAL);
    assert.ok(!html.includes(`href="#${id}/2019"`), `${id} stays Sleeper-only`);
    assert.ok(html.includes("Showing <strong>2022–2023</strong>"));
  });
});

test("pre-Sleeper note appears only where those seasons are included, and says what they cover", () => {
  const ctx = setup();
  const careers = pageHtml(ctx, "careers", "all", MANUAL);
  assert.ok(careers.includes("Pre-Sleeper seasons (2019)"));
  assert.ok(careers.includes("Overall Record where it was kept (2017 on)"));
  // Picking a Sleeper-era season only drops the note.
  assert.ok(!pageHtml(ctx, "careers", "2022", MANUAL).includes("Pre-Sleeper seasons"));
  assert.ok(!pageHtml(ctx, "streaks", "all", MANUAL).includes("Pre-Sleeper seasons"));
  // Without any manual history there is nothing to note.
  assert.ok(!pageHtml(ctx, "careers", "all").includes("Pre-Sleeper seasons"));
});

test("renderRecords: loads manual history, offers 2019 for Careers, and the subtitle counts all seasons", async () => {
  const ctx = await renderPage("#careers/2019", true, true);
  const root = ctx.document.getElementById("records-root").innerHTML;
  assert.ok(root.includes("Showing <strong>2019</strong>"));
  assert.ok(root.includes("Pre-Sleeper seasons (2019)"));
  assert.match(ctx.document.getElementById("sb-sub").textContent, /2019–2023 · 3 seasons of league history/);
  // The same URL on a Sleeper-only category falls back to All seasons (2019 isn't offered there).
  const streaks = await renderPage("#streaks/2019", true, true);
  assert.ok(streaks.document.getElementById("records-root").innerHTML.includes("Showing <strong>2022–2023</strong>"));
});

test("Seasons page has a Power Rankings & Playoff Odds section with the seven new records", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "seasons", "2022", `input.powerRanks = ${JSON.stringify(fixturePowerRanks())};`);
  assert.match(html, /Power Rankings &amp; Playoff Odds<\/span><span class="rb-section-count">7 records/);
  ["Most Weeks at #1 in a Season", "Most Weeks in a Row at #1", "Most Weeks in Last Place in a Season", "Most Weeks in a Row in Last Place", "Highest Power Ranking Score", "Lowest Power Ranking Score", "Earliest to Clinch a Playoff Berth"].forEach((t) =>
    assert.ok(html.includes(">" + t + "<"), t)
  );
  const clinch = html.slice(html.indexOf('data-record="earliest-playoff-clinch"'));
  assert.match(clinch.slice(0, 1200), /rb-value">Week 2</);
  // the "worst" extremes carry the orange lowlight accent
  assert.match(html, /<details class="rb-row rb-low" data-record="highest-pr-score"/);
  assert.match(html, /<details class="rb-row rb-low" data-record="most-weeks-last-pr"/);
  assert.match(html, /<details class="rb-row" data-record="lowest-pr-score"/);
});

test("renderRecords: power rankings history is loaded and feeds the Seasons page", async () => {
  const ctx = setup();
  const input = fixtureInput();
  ctx.__INPUT__ = input;
  ctx.__POWER__ = fixturePowerRanks();
  runInLoadedContext(
    ctx,
    `
    location.hash = "#seasons/2022";
    SleeperAPI.getSeasonChain = async () => __INPUT__.seasonChain;
    SleeperAPI.getPlayerDirectory = async () => __INPUT__.playerDirectory;
    DeepHistory.buildAll = async () => __INPUT__.deepSeasons;
    DeepHistory.computeStats = () => ({ managers: [] });
    fetchJsonSafe = async (file) => (file === POWER_RANK_CSV_HISTORY_FILE ? __POWER__ : null);
    initAnimatedDropdowns = () => {};
    `
  );
  await ctx.renderRecords();
  const root = ctx.document.getElementById("records-root").innerHTML;
  assert.ok(root.includes("Earliest to Clinch a Playoff Berth"));
  assert.match(root.slice(root.indexOf('data-record="most-weeks-first-pr"')).slice(0, 1000), /rb-holder-name">a/);
});

// ---- Draft records and the season in progress --------------------------------------------
const DRAFT_PAGE_STATS = `
  const pick = (season, player, pickNo, vbd) => ({ season, player, playerId: "x", position: "QB", round: 1, pickNo, pickInRound: pickNo, isKeeper: false, gradingVbd: vbd, expectedVbd: 5 });
  input.stats = { draftGradeModel: null, managers: [
    { userId: "u1", seasons: [{ draftPicks: [pick("2022", "Steal 22", 1, 10), pick("2023", "Steal 23", 2, 80)] }] },
  ] };`;
const draftRow = (html, id) => (html.match(new RegExp(`data-record="${id}"[\\s\\S]*?(?=data-record=|$)`)) || [""])[0];

test("Front Office, season in progress only: Draft records say they unlock after the season ends, and the rest keep their own wording", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "front-office", "2023", DRAFT_PAGE_STATS);
  const row = draftRow(html, "greatest-draft-pick");
  assert.ok(row.includes("Unlocks after the season ends"), row.slice(0, 300));
  assert.ok(!row.includes("No qualifying entries"));
  assert.ok(!/<details[^>]*greatest-draft-pick/.test(html), "nothing to expand");
  assert.ok(html.includes("Draft records leave out the current season"));
  assert.strictEqual((html.match(/Unlocks after the season ends/g) || []).length, 13, "all thirteen Draft records");
});

test("Front Office, all seasons: Draft records use the finished drafts only and the banner explains the missing season", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "front-office", "all", DRAFT_PAGE_STATS);
  const row = draftRow(html, "greatest-draft-pick");
  assert.ok(/<details[^>]*greatest-draft-pick/.test(html));
  assert.ok(row.includes("Steal 22") && !row.includes("Steal 23"), "2023's pick is not eligible");
  assert.ok(html.includes("Draft records leave out the current season"));
});

test("Front Office, a finished season: no Draft banner", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "front-office", "2022", DRAFT_PAGE_STATS);
  assert.ok(!html.includes("Draft records leave out the current season"));
  assert.ok(!html.includes("Unlocks after the season ends"));
});

test("the Draft banner only appears on pages that actually have Draft records", () => {
  const ctx = setup();
  assert.ok(!pageHtml(ctx, "seasons", "all").includes("Draft records leave out"));
});

// ---- Head to Head, Starters by Position, Postseason Starts, drafter split --------------------
const sectionRows = (html, title) => {
  const start = html.indexOf(`<span>${title}</span>`);
  assert.ok(start >= 0, `${title} section is on the page`);
  const end = html.indexOf("</section>", start);
  return (html.slice(start, end).match(/data-record="([^"]+)"/g) || []).map((m) => m.slice(13, -1));
};

test("Matchups page: a Head to Head section after the existing two", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "matchups", "all");
  assert.deepStrictEqual(sectionRows(html, "Head to Head"), ["most-lopsided-head-to-head", "highest-combined-average", "lowest-combined-average", "most-regular-season-meetings", "most-playoff-meetings", "longest-head-to-head-streak", "closest-rivalry"]);
  const order = ["Scoring", "Margins &amp; Drama", "Head to Head"].map((t) => html.indexOf(`<span>${t}</span>`));
  assert.ok(order[0] < order[1] && order[1] < order[2]);
});

test("Players & Lineups page: Starters by Position and Postseason Starts follow Player Performances", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "players", "all");
  const rows = sectionRows(html, "Starters by Position");
  assert.strictEqual(rows.length, 13);
  assert.ok(rows.includes("lowest-superflex-starter") && rows.includes("highest-dst-starter"));
  assert.deepStrictEqual(sectionRows(html, "Postseason Starts"), ["most-championship-starts", "most-playoff-starts"]);
  const at = (t) => html.indexOf(`<span>${t}</span>`);
  assert.ok(at("Player Performances") < at("Starters by Position") && at("Starters by Position") < at("Postseason Starts") && at("Postseason Starts") < at("Position Crowns"));
});

test("Front Office page: Best Drafter by Position is six records, one per position", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "front-office", "all");
  assert.ok(!html.includes("best-drafter-by-position"));
  ["Best QB Drafter", "Best RB Drafter", "Best WR Drafter", "Best TE Drafter", "Best K Drafter", "Best D/ST Drafter"].forEach((t) => assert.ok(html.includes(t.replace("/", "/")), t));
});

// ---- Playoff Picture, Margins & Drama, Hardware, Trades and Draft additions -------------------
test("Seasons page: a Playoff Picture section between Luck & Schedule and the Power Rankings records", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "seasons", "all");
  assert.deepStrictEqual(sectionRows(html, "Playoff Picture"), ["best-record-miss-playoffs", "worst-record-make-playoffs", "fewest-wins-champion"]);
  const at = (t) => html.indexOf(`<span>${t}</span>`);
  assert.ok(at("Luck &amp; Schedule") < at("Playoff Picture") && at("Playoff Picture") < at("Power Rankings &amp; Playoff Odds"));
});

test("Seasons page, season in progress: Playoff Picture rows unlock after the season ends and the banner says so", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "seasons", "2023");
  assert.strictEqual((html.match(/Unlocks after the season ends/g) || []).length, 3, "the three Playoff Picture records");
  assert.ok(html.includes("Playoff Picture records leave out the current season"));
  assert.ok(!html.includes("Draft records leave out"), "no Draft records on this page");
  const finished = pageHtml(ctx, "seasons", "2022");
  assert.ok(!finished.includes("Playoff Picture records leave out"));
  assert.ok(!finished.includes("Unlocks after the season ends"));
});

test("Front Office page, season in progress: both banners are separate and only the Draft rows mention drafts", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "front-office", "2023");
  assert.ok(html.includes("Draft records leave out the current season"));
  assert.ok(!html.includes("Playoff Picture records leave out"), "Playoff Picture lives on the Seasons page");
  assert.deepStrictEqual(sectionRows(html, "Trades").includes("blockbuster-trades"), true);
  const draft = sectionRows(html, "Draft");
  assert.ok(draft.includes("earliest-kicker-drafted") && draft.includes("earliest-defense-drafted"));
});

test("new records land in their sections", () => {
  const ctx = setup();
  assert.ok(sectionRows(pageHtml(ctx, "matchups", "all"), "Margins &amp; Drama").includes("biggest-upset"));
  assert.ok(sectionRows(pageHtml(ctx, "careers", "all"), "Hardware").includes("most-last-place-finishes"));
  assert.ok(sectionRows(pageHtml(ctx, "players", "all"), "Player Performances").includes("highest-scoring-benched-player"));
});

// ---- history extras: "Set ..." line, NEW badge, record timeline ---------------------------------
function pageHtmlWith(ctx, categoryId, era, history) {
  return evalHtml(
    ctx,
    `(function () {
      const facts = RecordBook.buildFacts(${JSON.stringify(fixtureInput())});
      const category = RecordBook.CATEGORIES.find((x) => x.id === ${JSON.stringify(categoryId)});
      const sleeperOnly = !category.history;
      const c = RecordBook.context(facts, ${JSON.stringify(era)}, sleeperOnly);
      return rbCategoryHtml({
        category, sections: RecordBook.computeCategory(category.id, c), eras: RecordBook.eras(facts, sleeperOnly), era: ${JSON.stringify(era)}, seasons: c.seasons,
        history: ${JSON.stringify(history)}, ...rbSeasonFlags(facts, c),
      });
    })()`
  );
}
const HIGH_HISTORY = (over) => ({
  records: {
    "highest-team-score": {
      current: { holder: "b", when: 202203, scope: "week", season: "2022", week: 3, kind: "broke", isNew: true, ...(over && over.current) },
      events: [
        { season: "2022", week: 3, kind: "broke", holder: "b", value: "130.0", previous: { holder: "a", value: "120.0" } },
        { season: "2022", week: 2, kind: "broke", holder: "a", value: "120.0", previous: { holder: "c", value: "110.0" } },
        { season: "2022", week: 1, kind: "new", holder: "c", value: "110.0", previous: null },
      ],
      more: 0,
      ...(over && over.rest),
    },
  },
});
const rowOf = (html, id) => (html.match(new RegExp(`data-record="${id}"[\\s\\S]*?(?=data-record=|$)`)) || [""])[0];

test("rbSetLabel: worded to match what the record's date means", () => {
  const ctx = setup();
  const label = (cur) => evalHtml(ctx, `rbSetLabel(${JSON.stringify(cur)})`);
  assert.strictEqual(label({ scope: "week", season: "2024", week: 14 }), "Set 2024 Wk 14");
  assert.strictEqual(label({ scope: "since", season: "2024", week: 3 }), "Leading since 2024 Wk 3");
  assert.strictEqual(label({ scope: "season", season: "2024", week: 15 }), "Set in 2024");
  assert.strictEqual(label({ scope: "draft", season: "2024", week: null }), "Set in the 2024 draft");
  assert.strictEqual(label({ scope: "since", season: "2020", week: null, before: true }), "Leading since before 2020");
});

test("rbEventWhen: timeline dates follow the record's scope", () => {
  const ctx = setup();
  const when = (e) => evalHtml(ctx, `rbEventWhen(${JSON.stringify(e)})`);
  assert.strictEqual(when({ scope: "week", season: "2024", week: 14 }), "2024 Wk 14");
  assert.strictEqual(when({ scope: "season", season: "2018", week: null }), "2018");
  assert.strictEqual(when({ scope: "draft", season: "2025", week: null }), "2025 draft");
  assert.strictEqual(when({ scope: "since", season: "2020", week: null, before: true }), "Before 2020");
});

test("a record with history shows when it was set, a NEW badge for recent ones, and a timeline of past holders", () => {
  const ctx = setup();
  const html = pageHtmlWith(ctx, "matchups", "all", HIGH_HISTORY());
  const row = rowOf(html, "highest-team-score");
  assert.ok(row.includes("Set 2022 Wk 3"));
  assert.ok(row.includes('class="rb-new"'));
  assert.ok(row.includes("Record history"));
  assert.ok(row.includes("Broke a’s 120.0") && row.includes("Broke c’s 110.0") && row.includes("New on the books"));
  assert.ok(row.indexOf("2022 Wk 3") < row.indexOf("2022 Wk 2") && row.indexOf("2022 Wk 2") < row.indexOf("2022 Wk 1"), "newest first");
  assert.ok(!rowOf(html, "biggest-blowout").includes("rb-set"), "records without history are untouched");
  const old = rowOf(pageHtmlWith(ctx, "matchups", "all", HIGH_HISTORY({ current: { isNew: false } })), "highest-team-score");
  assert.ok(old.includes("Set 2022 Wk 3") && !old.includes("rb-new"), "no NEW badge on an older record");
});

test("history extras only show when they still describe the holder on the page, and only for All seasons", () => {
  const ctx = setup();
  const none = (html) => !rowOf(html, "highest-team-score").includes("rb-set") && !rowOf(html, "highest-team-score").includes("Record history");
  assert.ok(none(pageHtmlWith(ctx, "matchups", "all", HIGH_HISTORY({ current: { holder: "zzz" } }))), "someone else holds it now");
  assert.ok(none(pageHtmlWith(ctx, "matchups", "all", HIGH_HISTORY({ current: { when: 202305 } }))), "the same name but a different performance");
  assert.ok(none(pageHtmlWith(ctx, "matchups", "2022", HIGH_HISTORY())), "a single-season view is not the all-time book");
  assert.ok(none(pageHtmlWith(ctx, "matchups", "all", null)), "no history file at all");
  assert.ok(none(pageHtmlWith(ctx, "matchups", "all", { records: { "highest-team-score": { current: null, events: [] } } })), "a record with no dated holder");
});

test("the timeline shows the six newest changes and counts the rest; names are escaped", () => {
  const ctx = setup();
  const events = Array.from({ length: 9 }, (_, i) => ({ season: "2022", week: 3, kind: "broke", holder: i === 0 ? "<img src=x onerror=1>" : `P${i}`, value: String(130 - i), previous: { holder: "Z", value: "1" } }));
  const row = rowOf(pageHtmlWith(ctx, "matchups", "all", HIGH_HISTORY({ rest: { events, more: 4 } })), "highest-team-score");
  assert.strictEqual((row.match(/class="rb-hist-when"/g) || []).length, 6);
  assert.ok(row.includes("…and 7 earlier changes."), "3 more in this list plus 4 not kept in the file");
  assert.ok(!row.includes("<img"));
  assert.ok(row.includes("&lt;img"));
});

test("records page loads the history file and still works without it", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "js", "records.js"), "utf8");
  assert.ok(src.includes("fetchJsonSafe(RECORDS_HISTORY_FILE"));
  assert.ok(fs.readFileSync(path.join(__dirname, "..", "js", "config.js"), "utf8").includes('RECORDS_HISTORY_FILE = "data/records-history.json"'));
});
