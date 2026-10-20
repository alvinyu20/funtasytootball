const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const { fixtureInput, fixtureManual, fixturePowerRanks } = require("./helpers/record-fixture.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "animations.js", "record-book.js", "record-defs.js", "records.js"]);
}

const evalJson = (ctx, code) => JSON.parse(runInLoadedContext(ctx, `JSON.stringify(${code})`));
const evalHtml = (ctx, code) => runInLoadedContext(ctx, code);

test("routes: '#category' and '#category/era' parse, unknown or empty hashes fall back to the landing page", () => {
  const ctx = setup();
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("#careers")`), { category: "careers", era: "all" });
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("#front-office/last3")`), { category: "front-office", era: "last3" });
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("#players/2024")`), { category: "players", era: "2024" });
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("#nonsense/2024")`), { category: null, era: "2024" });
  assert.deepStrictEqual(evalJson(ctx, `rbParseRoute("")`), { category: null, era: "all" });
  assert.strictEqual(evalHtml(ctx, `rbRouteHash("careers", "all")`), "#careers");
  assert.strictEqual(evalHtml(ctx, `rbRouteHash("careers", "last3")`), "#careers/last3");
  assert.strictEqual(evalHtml(ctx, `rbRouteHash(null, "2024")`), "#");
});

test("landing: six category rows, each linking to its page with its record count", () => {
  const ctx = setup();
  const html = evalHtml(ctx, `rbLandingHtml(RecordBook.countByCategory(), "all")`);
  assert.strictEqual((html.match(/class="rb-cat"/g) || []).length, 6);
  ["careers", "seasons", "matchups", "players", "streaks", "front-office"].forEach((id) => assert.ok(html.includes(`href="#${id}"`), id));
  assert.match(html, /Careers[\s\S]*25 records/);
  assert.match(html, /Front Office[\s\S]*19 records/);
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
        hasPartialSeason: facts.seasons.some((s) => c.seasonSet.has(s.season) && !s.regularComplete),
        rawPending: ${categoryId === "players"},
        noCompleteSeason: facts.seasons.filter((s) => c.seasonSet.has(s.season)).every((s) => !s.regularComplete),
        preSleeper: facts.seasons.filter((s) => s.source === "espn" && c.seasonSet.has(s.season)).map((s) => s.season),
      });
    })()`
  );
}

test("category page: header, season filter pills, grouped sections with counts and the three column headings", () => {
  const ctx = setup();
  const html = pageHtml(ctx, "careers", "all");
  assert.ok(html.includes(">Careers<"));
  assert.ok(html.includes("25 records"));
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

test("record rows: value, holder and an expandable top-10 list; lowlight records get the red accent", () => {
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
  assert.strictEqual((html.match(/Build Team Raw Stats/g) || []).length, 1);
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
  assert.match(ctx.document.getElementById("records-error").textContent, /Couldn't load any seasons/);
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
  // the "worst" extremes carry the red lowlight accent
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
