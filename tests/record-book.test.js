const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");
const { fixtureInput, fixtureManual, fixturePowerRanks } = require("./helpers/record-fixture.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "record-book.js", "record-defs.js"]);
}

// Builds facts from the fixture (optionally tweaked by `mutate`, a function
// body string that receives `input`) and runs one record for an era,
// returning plain, JSON-safe data so nothing cross-realm leaks into asserts.
function run(ctx, id, era, mutate) {
  return JSON.parse(
    runInLoadedContext(
      ctx,
      `(function () {
        const input = ${JSON.stringify(fixtureInput())};
        ${mutate || ""}
        const facts = RecordBook.buildFacts(input);
        const def = RecordBook.DEFS.find((d) => d.id === ${JSON.stringify(id)});
        return JSON.stringify(RecordBook.compute(def, RecordBook.context(facts, ${JSON.stringify(era)})));
      })()`
    )
  );
}

const top = (res) => res.entries.map((e) => `${e.name}:${e.valueText}`);

test("naming: records talk about Overall Record, never All-Play", () => {
  const ctx = setup();
  const text = JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.DEFS.map((d) => d.title + " " + d.desc))`)).join("\n");
  assert.ok(!/all-play/i.test(text), "no visible 'All-Play' wording");
  const titles = JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.DEFS.map((d) => d.title))`));
  ["Career Overall Wins", "Career Overall Losses", "Best Overall Record", "Overall Record Titles", "Best Overall Record Season", "Most Overall Wins in a Season", "Most Overall Losses in a Season"].forEach((t) => assert.ok(titles.includes(t), t));
});

test("definitions: six categories, every record has a title, description, section and a known category", () => {
  const ctx = setup();
  const info = JSON.parse(
    runInLoadedContext(
      ctx,
      `JSON.stringify({
        cats: RecordBook.CATEGORIES.map((c) => c.id),
        bad: RecordBook.DEFS.filter((d) => !d.title || !d.desc || !d.section || !RecordBook.CATEGORIES.some((c) => c.id === d.cat)).map((d) => d.id),
        dup: RecordBook.DEFS.map((d) => d.id).filter((id, i, a) => a.indexOf(id) !== i),
        counts: RecordBook.countByCategory(),
      })`
    )
  );
  assert.deepStrictEqual(info.cats, ["careers", "seasons", "matchups", "players", "streaks", "front-office"]);
  assert.deepStrictEqual(info.bad, []);
  assert.deepStrictEqual(info.dup, []);
  assert.strictEqual(info.counts.careers, 25);
  assert.strictEqual(info.counts.seasons, 24);
  assert.strictEqual(info.counts.matchups, 9);
  assert.strictEqual(info.counts.streaks, 16);
  assert.strictEqual(info.counts["front-office"], 19);
});

test("number formats: signed values use a real minus sign, percentages and money are formatted", () => {
  const ctx = setup();
  const out = JSON.parse(
    runInLoadedContext(
      ctx,
      `JSON.stringify({
        a: RecordBook.FORMATS.signed1(-4), b: RecordBook.FORMATS.signed1(3.14), c: RecordBook.FORMATS.pct1(0.7857),
        d: RecordBook.FORMATS.usd(99), e: RecordBook.FORMATS.int(2096.9), f: RecordBook.FORMATS.wins(-4), g: RecordBook.FORMATS.signed1(0),
        h: RecordBook.FORMATS.signedPct1(0.2222), i: RecordBook.FORMATS.signedPct1(-0.08), j: RecordBook.FORMATS.signedPct1(0),
      })`
    )
  );
  assert.strictEqual(out.a, "−4.0");
  assert.strictEqual(out.b, "+3.1");
  assert.strictEqual(out.c, "78.6%");
  assert.strictEqual(out.d, "$99");
  assert.strictEqual(out.e, "2,097");
  assert.strictEqual(out.f, "−4.0 wins");
  assert.strictEqual(out.g, "0.0");
  assert.strictEqual(out.h, "+22.2%");
  assert.strictEqual(out.i, "\u22128.0%");
  assert.strictEqual(out.j, "0.0%");
});

test("eras: All, Last 3, then each season newest first; seasons without scored weeks aren't offered", () => {
  const ctx = setup();
  const eras = JSON.parse(
    runInLoadedContext(
      ctx,
      `(function () {
        const input = ${JSON.stringify(fixtureInput())};
        input.seasonChain.push({ league: { season: "2024", league_id: "L24", status: "pre_draft", roster_positions: ["QB"], settings: { playoff_week_start: 4 } }, rosters: [], users: [], bracket: [] });
        input.deepSeasons.push({ weeks: [], transactions: [], draft: null });
        return JSON.stringify(RecordBook.eras(RecordBook.buildFacts(input)));
      })()`
    )
  );
  assert.deepStrictEqual(
    eras.map((e) => e.id),
    ["all", "last3", "2023", "2022"]
  );
  assert.strictEqual(eras[0].label, "All seasons");
  assert.strictEqual(eras[1].label, "Last 3 seasons");
});

test("Career Wins sums every season in the era, and a single-season era narrows it", () => {
  const ctx = setup();
  assert.deepStrictEqual(top(run(ctx, "career-wins", "all")).slice(0, 2), ["b:4", "a:3"]);
  assert.deepStrictEqual(top(run(ctx, "career-wins", "2022")).slice(0, 2), ["a:3", "b:2"]);
  // "Last 3" of a two-season league is both seasons.
  assert.deepStrictEqual(top(run(ctx, "career-wins", "last3")), top(run(ctx, "career-wins", "all")));
});

test("ranking: equal values share a rank and the leader's tie count is reported", () => {
  const ctx = setup();
  const res = JSON.parse(
    runInLoadedContext(
      ctx,
      `(function () {
        const facts = RecordBook.buildFacts(${JSON.stringify(fixtureInput())});
        const def = { id: "x", fmt: "int", dir: "desc", compute: () => ({ rows: [{ key: "u:u1", raw: 5 }, { key: "u:u2", raw: 5 }, { key: "u:u3", raw: 3 }] }) };
        return JSON.stringify(RecordBook.compute(def, RecordBook.context(facts, "all")));
      })()`
    )
  );
  assert.deepStrictEqual(res.entries.map((e) => e.rank), [1, 1, 3]);
  assert.strictEqual(res.tied, 1);
});

test("ranking: ascending records put the smallest value first and only the top ten are kept", () => {
  const ctx = setup();
  const res = JSON.parse(
    runInLoadedContext(
      ctx,
      `(function () {
        const facts = RecordBook.buildFacts(${JSON.stringify(fixtureInput())});
        const rows = [];
        for (let i = 0; i < 14; i++) rows.push({ key: "u:u" + (1 + (i % 4)), raw: 20 - i });
        const def = { id: "x", fmt: "int", dir: "asc", compute: () => ({ rows }) };
        return JSON.stringify(RecordBook.compute(def, RecordBook.context(facts, "all")));
      })()`
    )
  );
  assert.strictEqual(res.entries.length, 10);
  assert.strictEqual(res.entries[0].raw, 7);
});

test("season records ignore a season whose regular season isn't finished", () => {
  const ctx = setup();
  // b is 2-0 in the unfinished 2023, but the best finished season is a's 3-0 in 2022.
  const res = run(ctx, "most-wins-season", "all");
  assert.strictEqual(res.entries[0].name, "a");
  assert.strictEqual(res.entries[0].valueText, "3");
  assert.ok(!res.entries.some((e) => /2023/.test(e.detail)), "2023 must not appear in a season-long record yet");
  // ...and with only the unfinished season selected there's simply nothing to show.
  assert.strictEqual(run(ctx, "most-wins-season", "2023").status, "empty");
});

test("luck is a percentage: real win % minus Overall Record win %, the same Luck the Home and Season pages show", () => {
  const ctx = setup();
  // 2022: a went 3-0 (100%) with an Overall Record of 7-2 (77.8%) -> +22.2%; c went 1-2 (33.3%) at 5-4 (55.6%) -> -22.2%.
  const lucky = run(ctx, "luckiest-season", "2022");
  assert.strictEqual(lucky.entries[0].name, "a");
  assert.strictEqual(lucky.entries[0].valueText, "+22.2%");
  const unlucky = run(ctx, "unluckiest-season", "2022");
  assert.strictEqual(unlucky.entries[0].name, "c");
  assert.strictEqual(unlucky.entries[0].valueText, "\u221222.2%");
  // Career luck over one season is the same gap.
  assert.deepStrictEqual(top(run(ctx, "luckiest-career", "2022")).slice(0, 2), ["a:+22.2%", "b:+11.1%"]);
  assert.strictEqual(top(run(ctx, "unluckiest-career", "2022"))[0], "c:\u221222.2%");
  // And it agrees with DeepHistory.luckPercent exactly.
  const direct = JSON.parse(runInLoadedContext(ctx, "JSON.stringify(DeepHistory.luckPercent(3, 0, 0, 7, 2, 0))"));
  assert.ok(Math.abs(direct - 22.2222) < 0.001);
});

test("regular-season title goes to the best record; championships follow the bracket", () => {
  const ctx = setup();
  assert.deepStrictEqual(top(run(ctx, "regular-season-titles", "all")), ["a:1"]);
  assert.deepStrictEqual(top(run(ctx, "championships", "all")), ["a:1"]);
  assert.deepStrictEqual(top(run(ctx, "championship-appearances", "all")), ["a:1", "c:1"]);
});

test("playoff results only count games on the road to first or third place", () => {
  const ctx = setup();
  assert.deepStrictEqual(top(run(ctx, "playoff-wins", "all")).slice(0, 3), ["a:2", "b:1", "c:1"]);
  assert.deepStrictEqual(top(run(ctx, "playoff-appearances", "all")).length, 4);
});

test("the regular-season title follows the best record, and an exact tie on record and points shares it", () => {
  const ctx = setup();
  // b beats a in week 1 (101-100): b finishes 3-0 and a 2-1, so b alone has the title.
  const moved = run(
    ctx,
    "regular-season-titles",
    "2022",
    `input.deepSeasons[0].weeks[0].matchups.forEach((m) => { if (m.roster_id === 2) { m.points = 101; m.players_points.q2 = 101; } });`
  );
  assert.deepStrictEqual(top(moved), ["b:1"]);
  // Week 1 tied at 100-100: a and b both go T-W-W with 325 points, so the title is shared.
  const tied = run(
    ctx,
    "regular-season-titles",
    "2022",
    `input.deepSeasons[0].weeks[0].matchups.forEach((m) => { if (m.roster_id === 2) { m.points = 100; m.players_points.q2 = 100; } });`
  );
  assert.deepStrictEqual(top(tied), ["a:1", "b:1"]);
  assert.strictEqual(tied.tied, 1);
});

test("win streaks run across season boundaries", () => {
  const ctx = setup();
  const res = run(ctx, "longest-win-streak", "all");
  // b: lost 2022 wk1, then won 2022 wk2-3 and 2023 wk1-2 = four straight.
  assert.strictEqual(res.entries[0].name, "b");
  assert.strictEqual(res.entries[0].valueText, "4");
  assert.match(res.entries[0].detail, /4 weeks/);
});

test("Best Win Percentage needs min(3, seasons in era) seasons: both seasons count, a one-season era needs one", () => {
  const ctx = setup();
  // Era 'all' has 2 seasons, so everybody with 2 seasons qualifies.
  assert.strictEqual(run(ctx, "best-win-pct", "all").status, "ok");
  assert.strictEqual(run(ctx, "best-win-pct", "2022").entries[0].name, "a");
});

test("highest team score: weekly rows for every counted game, including the counted playoff games", () => {
  const ctx = setup();
  const res = run(ctx, "highest-team-score", "all");
  // 130 happens twice: b in 2022 wk 3 (regular season) and a in the wk 4 semifinal. The earlier one is listed first.
  assert.strictEqual(res.entries[0].valueText, "130.0");
  assert.strictEqual(res.entries[0].name, "b");
  assert.strictEqual(res.tied, 1);
  assert.strictEqual(res.entries[1].name, "a");
});

test("matchups: biggest blowout is the widest margin", () => {
  const ctx = setup();
  const res = run(ctx, "biggest-blowout", "2022");
  // 2022 wk3: b 130 over c 70 = 60.
  assert.strictEqual(res.entries[0].raw, 60);
});

test("team raw stats stay pending until the pipeline data exists, then rank managers by user id", () => {
  const ctx = setup();
  assert.strictEqual(run(ctx, "raw-career-pass_yd", "all").status, "pending");
  const res = run(
    ctx,
    "raw-career-pass_yd",
    "all",
    `input.rawStats = { stats: ["pass_yd","pass_td"], seasons: { "2022": { "1": { u1: [300, 2], u2: [250, 1] }, "2": { u1: [100, 0] } }, "2023": { "1": { u2: [200, 3] } } } };`
  );
  assert.deepStrictEqual(top(res), ["a:400", "b:450"].sort((x, y) => Number(y.split(":")[1]) - Number(x.split(":")[1])));
  assert.strictEqual(run(ctx, "raw-season-pass_td", "all", `input.rawStats = { stats: ["pass_yd","pass_td"], seasons: { "2022": { "1": { u1: [300, 2] } } } };`).entries[0].valueText, "2");
});

test("pre-Sleeper seasons join the totals when manual history is supplied and stay out when it isn't", () => {
  const ctx = setup();
  const manual = JSON.stringify(fixtureManual());
  const withManual = JSON.parse(
    runInLoadedContext(
      ctx,
      `(function () {
        const input = ${JSON.stringify(fixtureInput())};
        input.manual = ${manual};
        const facts = RecordBook.buildFacts(input);
        const def = RecordBook.DEFS.find((d) => d.id === "career-wins");
        return JSON.stringify({
          seasons: facts.seasons.map((s) => s.season + ":" + s.source),
          all: RecordBook.compute(def, RecordBook.context(facts, "all")).entries.map((e) => e.name + ":" + e.raw),
          sleeperOnly: RecordBook.compute(def, RecordBook.context(facts, "all", true)).entries.map((e) => e.name + ":" + e.raw),
          eras: RecordBook.eras(facts).map((e) => e.id),
          erasSleeper: RecordBook.eras(facts, true).map((e) => e.id),
          last3: RecordBook.context(facts, "last3").seasons,
          one: RecordBook.compute(def, RecordBook.context(facts, "2019")).entries.map((e) => e.name + ":" + e.raw),
        });
      })()`
    )
  );
  assert.deepStrictEqual(withManual.seasons, ["2019:espn", "2022:sleeper", "2023:sleeper"]);
  assert.deepStrictEqual(withManual.all.slice(0, 2), ["a:12", "b:11"]); // a 9+3, b 7+4
  assert.ok(withManual.all.includes("e:3"), "a departed ESPN-only manager appears in career records");
  assert.deepStrictEqual(withManual.sleeperOnly, ["b:4", "a:3", "c:2", "d:1"]);
  assert.deepStrictEqual(withManual.eras, ["all", "last3", "2023", "2022", "2019"]);
  assert.deepStrictEqual(withManual.erasSleeper, ["all", "last3", "2023", "2022"]);
  assert.deepStrictEqual(withManual.last3, ["2019", "2022", "2023"]);
  assert.deepStrictEqual(withManual.one, ["a:9", "b:7", "e:3"]);
  const without = JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.buildFacts(${JSON.stringify(fixtureInput())}).seasons.map((s) => s.season))`));
  assert.deepStrictEqual(without, ["2022", "2023"]);
});

test("pre-Sleeper seasons only feed records that season totals can answer; weekly-score records skip them", () => {
  const ctx = setup();
  const mutate = `input.manual = ${JSON.stringify(fixtureManual())};`;
  // High-Score Weeks and the strength-of-schedule records need weekly scores: 2019 contributes nothing.
  assert.ok(!top(run(ctx, "high-score-weeks", "all", mutate)).some((x) => x.startsWith("e:")));
  assert.strictEqual(run(ctx, "high-score-weeks", "2019", mutate).status, "empty");
  assert.strictEqual(run(ctx, "toughest-schedule", "2019", mutate).status, "empty");
  // Totals-based records do use it: 2019's 1,500 points is a's best season for points among 2019 rows.
  assert.strictEqual(run(ctx, "most-points-season", "2019", mutate).entries[0].name, "a");
  assert.strictEqual(run(ctx, "championships", "2019", mutate).entries[0].name, "a");
  assert.strictEqual(run(ctx, "playoff-wins", "2019", mutate).entries[0].raw, 2);
});

test("pre-Sleeper luck uses the Overall Record on file the same way: win % minus Overall win %", () => {
  const ctx = setup();
  const mutate = `input.manual = ${JSON.stringify(fixtureManual())};`;
  const res = run(ctx, "luckiest-season", "2019", mutate);
  assert.deepStrictEqual(top(res), ["a:+9.4%", "b:+2.6%"]);
  // The Overall Record records read the same data.
  assert.strictEqual(run(ctx, "most-allplay-wins-season", "2019", mutate).entries[0].valueText, "70");
  assert.strictEqual(run(ctx, "best-allplay-season", "2019", mutate).entries[0].name, "a");
});

const POWER = `input.powerRanks = ${JSON.stringify(fixturePowerRanks())};`;
const POWER_AND_MANUAL = `input.manual = ${JSON.stringify(fixtureManual())}; ${POWER}`;

test("power rankings: weeks at #1 and in last place are counted per season, and finished seasons only", () => {
  const ctx = setup();
  // 2022: a was #1 twice, b once; d was last twice, c once. 2023 isn't finished so b/a's #1 weeks there don't count yet.
  assert.deepStrictEqual(top(run(ctx, "most-weeks-first-pr", "2022", POWER)), ["a:2", "b:1"]);
  assert.deepStrictEqual(top(run(ctx, "most-weeks-last-pr", "2022", POWER)), ["d:2", "c:1"]);
  assert.strictEqual(run(ctx, "most-weeks-first-pr", "2023", POWER).status, "empty");
  assert.match(run(ctx, "most-weeks-first-pr", "2022", POWER).entries[0].detail, /2022 · 2 of 3 ranked weeks/);
});

test("power rankings: a run at #1 or last place is consecutive weeks inside one season", () => {
  const ctx = setup();
  const first = run(ctx, "longest-run-first-pr", "2022", POWER);
  assert.deepStrictEqual(top(first), ["a:2", "b:1"]);
  assert.match(first.entries[0].detail, /2 weeks · 2022 Wk 1–2/);
  assert.deepStrictEqual(top(run(ctx, "longest-run-last-pr", "2022", POWER)), ["d:2", "c:1"]);
  // d is last in weeks 1, 2 and c in week 3 ... a missing week breaks a run: drop a's week-2 rank and its run is only one week.
  const broken = run(ctx, "longest-run-first-pr", "2022", `${POWER} input.powerRanks.seasons[2022].ranks.a.weekly[1] = null;`);
  assert.strictEqual(broken.entries.find((e) => e.name === "a").raw, 1);
});

test("power rankings: pre-Sleeper seasons count, a name matching no manager becomes its own manager, and shared ranks count for both", () => {
  const ctx = setup();
  const first = run(ctx, "most-weeks-first-pr", "all", POWER_AND_MANUAL);
  assert.deepStrictEqual(top(first)[0], "a:5"); // 2019: all five weeks
  const last = run(ctx, "most-weeks-last-pr", "2019", POWER_AND_MANUAL);
  // ghost: last in weeks 1-4 and tied for last in week 5 = 5; b only ties in week 5 = 1.
  assert.deepStrictEqual(top(last), ["ghost:5", "b:1"]);
  // Without the manual history 2019 isn't a season at all, so none of it appears.
  assert.deepStrictEqual(top(run(ctx, "most-weeks-first-pr", "all", POWER)), ["a:2", "b:1"]);
});

test("power rankings: highest and lowest PR Score are single-week extremes (lower is better), in-progress weeks included", () => {
  const ctx = setup();
  const highest = run(ctx, "highest-pr-score", "all", POWER);
  assert.strictEqual(highest.entries[0].name, "d");
  assert.strictEqual(highest.entries[0].valueText, "9.50");
  assert.match(highest.entries[0].detail, /2022 Wk 2 · ranked #4/);
  const lowest = run(ctx, "lowest-pr-score", "all", POWER);
  assert.strictEqual(lowest.entries[0].name, "a");
  assert.strictEqual(lowest.entries[0].valueText, "3.00"); // 2023 wk 1, a season still in progress
  assert.strictEqual(run(ctx, "lowest-pr-score", "2022", POWER).entries[0].valueText, "4.50");
});

test("earliest playoff clinch: first week odds reach 99.5% and stay there; a later dip or an unfinished season doesn't count", () => {
  const ctx = setup();
  const res = run(ctx, "earliest-playoff-clinch", "all", POWER);
  assert.deepStrictEqual(top(res), ["a:Week 2", "b:Week 3"]);
  assert.match(res.entries[0].detail, /2022 · 1 week to spare/);
  assert.match(res.entries[1].detail, /2022 · clinched in the final week/);
  // c touched 99.9% in week 2 but fell back to 20%, so it never clinched; 2023 is unfinished.
  assert.ok(!top(res).some((x) => x.startsWith("c:") || x.startsWith("d:")));
  assert.strictEqual(run(ctx, "earliest-playoff-clinch", "2023", POWER).status, "empty");
});

test("earliest playoff clinch: a week the odds weren't recorded doesn't undo a clinch", () => {
  const ctx = setup();
  const res = run(ctx, "earliest-playoff-clinch", "2022", `${POWER} input.powerRanks.seasons[2022].playoffOdds.a = [60, 99.6, null];`);
  assert.deepStrictEqual(top(res)[0], "a:Week 2");
});
