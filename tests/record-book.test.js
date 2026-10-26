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
  assert.strictEqual(info.counts.careers, 26);
  assert.strictEqual(info.counts.seasons, 27);
  assert.strictEqual(info.counts.matchups, 17);
  assert.strictEqual(info.counts.streaks, 16);
  assert.strictEqual(info.counts["front-office"], 27);
  assert.strictEqual(info.counts.players, 61);
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

// ---- Draft records leave out a season that isn't over --------------------------------------
// Draft picks in the fixture's 2022 (complete) and 2023 (still being played) drafts. Each pick's
// value is gradingVbd - expectedVbd.
const DRAFT_STATS = `
  const pick = (season, player, pickNo, vbd, expected, extra) => Object.assign({ season, player, playerId: "x", position: "QB", round: 1, pickNo, pickInRound: pickNo, isKeeper: false, gradingVbd: vbd, expectedVbd: expected }, extra || {});
  input.stats = { draftGradeModel: null, managers: [
    { userId: "u1", seasons: [{ draftPicks: [pick("2022", "Steal 22", 1, 10, 5), pick("2023", "Steal 23", 2, 80, 5)] }] },
    { userId: "u2", seasons: [{ draftPicks: [pick("2022", "Bust 22", 3, -5, 10), pick("2023", "Bust 23", 4, -60, 10)] }] },
  ] };`;

test("draft records: a draft class does not count while its season is still being played", () => {
  const ctx = setup();
  const best = run(ctx, "greatest-draft-pick", "all", DRAFT_STATS);
  assert.deepStrictEqual(top(best), ["a:+5.0"], "the 2023 pick (+75) is ignored until 2023 is over");
  assert.match(best.entries[0].detail, /Steal 22/);
  const worst = run(ctx, "biggest-draft-bust", "all", DRAFT_STATS);
  assert.deepStrictEqual(top(worst), ["b:" + "\u221215.0"], "the 2023 bust (-70) is ignored too");
  assert.match(worst.entries[0].detail, /Bust 22/);
});

test("draft records: picking only the season in progress leaves them empty", () => {
  const ctx = setup();
  ["greatest-draft-pick", "biggest-draft-bust", "best-career-drafter", "best-draft-season", "worst-draft-season", "best-drafter-qb", "best-drafter-rb", "best-drafter-wr", "best-drafter-te", "best-drafter-k", "best-drafter-dst"].forEach((id) => {
    const res = run(ctx, id, "2023", DRAFT_STATS);
    assert.strictEqual(res.status, "empty", id);
  });
  assert.deepStrictEqual(top(run(ctx, "greatest-draft-pick", "2022", DRAFT_STATS)), ["a:+5.0"]);
});

test("draft records: the class joins as soon as its season is marked complete", () => {
  const ctx = setup();
  const done = DRAFT_STATS + 'input.seasonChain[1].league.status = "complete";';
  assert.deepStrictEqual(top(run(ctx, "greatest-draft-pick", "all", done)), ["a:+75.0", "a:+5.0"]);
  assert.deepStrictEqual(top(run(ctx, "greatest-draft-pick", "2023", done)), ["a:+75.0"]);
});

test("draft records: every Draft-section record is flagged so the page can explain the wait", () => {
  const ctx = setup();
  const defs = JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.DEFS.filter((d) => d.section === "Draft").map((d) => [d.id, !!d.needsFinishedSeason]))`));
  assert.ok(defs.length >= 6);
  defs.forEach(([id, flagged]) => assert.ok(flagged, id));
});

// ---- Starters by position, Superflex, postseason starts ------------------------------------
// Week 1 of 2022: roster 1 (a) now also starts an RB and a kicker, in a lineup of QB / SUPER_FLEX / K.
const LINEUP_MUTATE = `
  input.playerDirectory.rb1 = { position: "RB", first_name: "Rae", last_name: "Back" };
  input.playerDirectory.k1 = { position: "K", first_name: "Kay", last_name: "Kicker" };
  input.playerDirectory.d1 = { position: "DEF", first_name: "Dee", last_name: "Fense" };
  input.seasonChain[0].league.roster_positions = ["QB", "SUPER_FLEX", "K", "DEF"];
  const m = input.deepSeasons[0].weeks[0].matchups[0];
  m.players = ["q1", "rb1", "k1", "d1", "bench"];
  m.starters = ["q1", "rb1", "k1", "d1"];
  m.players_points = { q1: 100, rb1: -1.5, k1: 0, d1: 12, bench: -9 };
`;

test("starters by position: the best and worst week for a position come from starters only", () => {
  const ctx = setup();
  const hi = run(ctx, "highest-qb-starter", "all", LINEUP_MUTATE);
  assert.deepStrictEqual(top(hi)[0], "Quinn Two:130.0");
  assert.match(hi.entries[0].detail, /for b · 2022 Wk 3/);
  const lo = run(ctx, "lowest-qb-starter", "all", LINEUP_MUTATE);
  assert.deepStrictEqual(top(lo)[0], "Quinn Four:60.0");
  assert.ok(lo.entries[0].detail.includes("2023 Wk 2"));
  // the benched player's -9 never counts, and each position only sees its own players
  assert.deepStrictEqual(top(run(ctx, "lowest-rb-starter", "all", LINEUP_MUTATE)), ["Rae Back:" + "−1.5"]);
  assert.deepStrictEqual(top(run(ctx, "lowest-k-starter", "all", LINEUP_MUTATE)), ["Kay Kicker:0.0"]);
  assert.deepStrictEqual(top(run(ctx, "highest-dst-starter", "all", LINEUP_MUTATE)), ["Dee Fense:12.0"]);
  assert.strictEqual(run(ctx, "highest-te-starter", "all", LINEUP_MUTATE).status, "empty", "no TE ever started");
});

test("lowest SUPERFLEX starter reads the lineup slot, not the player's position", () => {
  const ctx = setup();
  const res = run(ctx, "lowest-superflex-starter", "all", LINEUP_MUTATE);
  assert.deepStrictEqual(top(res), ["Rae Back:" + "−1.5"], "an RB in the SUPER_FLEX slot");
  assert.match(res.entries[0].detail, /^RB for a/);
  // with no SUPER_FLEX slot in the league there is nothing to rank
  assert.strictEqual(run(ctx, "lowest-superflex-starter", "all").status, "empty");
});

test("every position has a highest and a lowest scoring starter record", () => {
  const ctx = setup();
  const ids = JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.DEFS.filter((d) => d.section === "Starters by Position").map((d) => d.id))`));
  ["qb", "rb", "wr", "te", "k", "dst"].forEach((p) => {
    assert.ok(ids.includes(`highest-${p}-starter`), p);
    assert.ok(ids.includes(`lowest-${p}-starter`), p);
  });
  assert.ok(ids.includes("lowest-superflex-starter"));
  assert.strictEqual(ids.length, 13);
});

// 2022 week 4 also has a consolation game between two non-playoff rosters (5 and 6).
const CONSOLATION_MUTATE = `
  input.seasonChain[0].rosters.push({ roster_id: 5, owner_id: "u5", settings: {} }, { roster_id: 6, owner_id: "u6", settings: {} });
  input.seasonChain[0].users.push({ user_id: "u5", display_name: "e" }, { user_id: "u6", display_name: "f" });
  input.playerDirectory.q5 = { position: "QB", first_name: "Quinn", last_name: "Five" };
  input.playerDirectory.q6 = { position: "QB", first_name: "Quinn", last_name: "Six" };
  const wk4 = input.deepSeasons[0].weeks[3].matchups;
  wk4.push(
    { roster_id: 5, matchup_id: 9, points: 77, players: ["q5"], starters: ["q5"], players_points: { q5: 77 } },
    { roster_id: 6, matchup_id: 9, points: 66, players: ["q6"], starters: ["q6"], players_points: { q6: 66 } }
  );
`;

test("championship starts: only the two finalists' lineups in the title game", () => {
  const ctx = setup();
  const res = run(ctx, "most-championship-starts", "all", CONSOLATION_MUTATE);
  assert.deepStrictEqual(top(res).sort(), ["Quinn One:1 start", "Quinn Three:1 start"], "a (champion) vs c (runner-up); the third-place game doesn't count");
  assert.strictEqual(res.entries[0].rank, 1);
  assert.strictEqual(res.tied, 1);
});

test("playoff starts: the road to 1st and 3rd place counts, the consolation bracket does not", () => {
  const ctx = setup();
  const res = run(ctx, "most-playoff-starts", "all", CONSOLATION_MUTATE);
  assert.deepStrictEqual(top(res).sort(), ["Quinn Four:2 starts", "Quinn One:2 starts", "Quinn Three:2 starts", "Quinn Two:2 starts"]);
  assert.ok(!top(res).some((t) => /Five|Six/.test(t)), "the week-4 consolation game between rosters 5 and 6 is ignored");
});

// ---- Head to Head ----------------------------------------------------------------------------
test("most lopsided head to head: ranked by the gap in wins, leader named first", () => {
  const ctx = setup();
  const res = run(ctx, "most-lopsided-head-to-head", "all");
  assert.deepStrictEqual(top(res).slice(0, 3), ["b vs d:+3 wins", "a vs d:+2 wins", "a vs c:+1 win"]);
  assert.match(res.entries[0].detail, /b leads 3-0 · 3 meetings/);
  assert.ok(!top(res).some((t) => /^(a vs b|b vs c|c vs d)/.test(t)), "pairs that are dead even have no gap to rank");
});

test("combined points average per head to head: both scores added, needs enough meetings for the era", () => {
  const ctx = setup();
  assert.deepStrictEqual(top(run(ctx, "highest-combined-average", "all")).slice(0, 2), ["a vs d:212.5", "c vs d:200.0"]);
  const lowest = run(ctx, "lowest-combined-average", "all");
  assert.deepStrictEqual(top(lowest)[0], "b vs d:166.7");
  assert.strictEqual(lowest.entries[0].detail, "3 meetings");
  // a pair that has met once never qualifies for a two-season era (needs 2)
  const single = run(ctx, "highest-combined-average", "2023");
  assert.strictEqual(single.status, "empty", "one season of 2023 has a single meeting per pair");
});

test("regular-season and playoff meetings are counted separately and tie in rank", () => {
  const ctx = setup();
  const reg = run(ctx, "most-regular-season-meetings", "all");
  assert.strictEqual(reg.entries[0].valueText, "2 meetings");
  assert.strictEqual(reg.entries[0].rank, 1);
  assert.strictEqual(reg.tied, 3, "a-b, a-c, b-d and c-d have all met twice in the regular season");
  assert.match(reg.entries.find((e) => e.name === "a vs c").detail, /a 1-1 c in the regular season/);
  const po = run(ctx, "most-playoff-meetings", "all");
  assert.strictEqual(po.entries[0].valueText, "1 meeting");
  assert.deepStrictEqual(po.entries.map((e) => e.name).sort(), ["a vs c", "a vs d", "b vs c", "b vs d"], "only the pairs that met in the playoff bracket");
});

// ---- Best drafter, one record per position ----------------------------------------------------
test("best drafter by position: one record per position, defenses called D/ST, keepers left out", () => {
  const ctx = setup();
  const stats = `
    const pick = (season, player, pos, vbd, extra) => Object.assign({ season, player, playerId: "x", position: pos, round: 1, pickNo: 1, pickInRound: 1, isKeeper: false, gradingVbd: vbd, expectedVbd: 5 }, extra || {});
    input.stats = { draftGradeModel: null, managers: [
      { userId: "u1", seasons: [{ draftPicks: [pick("2022", "QB A", "QB", 15), pick("2022", "DEF A", "DEF", 25), pick("2022", "QB keeper", "QB", 95, { isKeeper: true })] }] },
      { userId: "u2", seasons: [{ draftPicks: [pick("2022", "QB B", "QB", 9), pick("2022", "DEF B", "DEF", 1)] }] },
    ] };`;
  assert.deepStrictEqual(top(run(ctx, "best-drafter-qb", "all", stats)), ["a:+10.0", "b:+4.0"], "a's keeper pick is excluded from the average");
  assert.deepStrictEqual(top(run(ctx, "best-drafter-dst", "all", stats)), ["a:+20.0", "b:" + "−4.0"]);
  assert.strictEqual(run(ctx, "best-drafter-te", "all", stats).status, "empty");
  const titles = JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.DEFS.filter((d) => /^best-drafter-/.test(d.id)).map((d) => d.title))`));
  assert.deepStrictEqual(titles, ["Best QB Drafter", "Best RB Drafter", "Best WR Drafter", "Best TE Drafter", "Best K Drafter", "Best D/ST Drafter"]);
  assert.ok(!JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.DEFS.map((d) => d.id))`)).includes("best-drafter-by-position"));
});

// ---- Playoff Picture, Last Place, Head to Head streaks, upsets, benched, trades, kickers -----------
// Like run(), but `factsCode` can rewrite the facts after they are built (e.g. to decide who made the
// playoffs) and `inputCode` still tweaks the raw input first.
function runFacts(ctx, id, era, factsCode, inputCode) {
  return JSON.parse(
    runInLoadedContext(
      ctx,
      `(function () {
        const input = ${JSON.stringify(fixtureInput())};
        ${inputCode || ""}
        const facts = RecordBook.buildFacts(input);
        ${factsCode || ""}
        const def = RecordBook.DEFS.find((d) => d.id === ${JSON.stringify(id)});
        return JSON.stringify(RecordBook.compute(def, RecordBook.context(facts, ${JSON.stringify(era)})));
      })()`
    )
  );
}
const WITH_ESPN = `input.manual = ${JSON.stringify(fixtureManual())};`;
const WITH_POWER = `input.powerRanks = ${JSON.stringify(fixturePowerRanks())};`;

test("longest head to head win streak: runs across seasons and the playoffs, a tie ends it", () => {
  const ctx = setup();
  const res = run(ctx, "longest-head-to-head-streak", "all");
  assert.deepStrictEqual(top(res), ["b over d:3 straight wins", "a over c:2 straight wins", "a over d:2 straight wins"]);
  assert.strictEqual(res.entries[0].detail, "2022 Wk 2 – 2023 Wk 2 · ongoing", "b beat d in the regular season, the third-place game and again in 2023");
  assert.strictEqual(res.entries[1].detail, "2022 Wk 2–5", "a beat c in week 2 and in the title game");
  assert.strictEqual(res.entries[1].rank, 2);
  assert.strictEqual(res.entries[2].rank, 2);
  // one-game "streaks" are not records: a-b, b-c and c-d have only ever traded wins
  assert.ok(!top(res).some((t) => /a over b|b over a|b over c|c over b|c over d|d over c/.test(t)));
  // a finished season: nothing is still going
  assert.ok(!run(ctx, "longest-head-to-head-streak", "2022").entries.some((e) => /ongoing/.test(e.detail)));
  // a tie in b-d's third-place game ends their streak
  const tied = run(ctx, "longest-head-to-head-streak", "all", `const m = input.deepSeasons[0].weeks[4].matchups[3]; m.points = 80; m.players_points.q4 = 80;`);
  assert.ok(!top(tied).some((t) => /b over d/.test(t)));
  assert.deepStrictEqual(top(tied), ["a over c:2 straight wins", "a over d:2 straight wins"]);
});

test("closest rivalry: smallest average winning margin across meetings, with the record in the detail", () => {
  const ctx = setup();
  const res = run(ctx, "closest-rivalry", "all");
  assert.deepStrictEqual(top(res), ["a vs b:15.0 pts", "a vs c:18.3 pts", "a vs d:22.5 pts", "b vs d:23.3 pts", "c vs d:30.0 pts", "b vs c:32.5 pts"]);
  assert.strictEqual(res.entries[0].detail, "a 1-1 b · 2 meetings");
  assert.strictEqual(run(ctx, "closest-rivalry", "2023").status, "empty", "one season gives each pair a single meeting, short of the two needed");
});

test("biggest upset: the Power Rank going into the game, so Week 1 and games with no prior ranking are left out", () => {
  const ctx = setup();
  const res = run(ctx, "biggest-upset", "all", WITH_POWER);
  assert.deepStrictEqual(top(res), ["c:3 spots", "b:1 spot", "c:1 spot"]);
  assert.strictEqual(res.entries[0].detail, "#4 c beat #1 b 95.0–90.0 · 2022 Wk 4 (playoffs)", "week-3 ranks: c was 4th, b 1st");
  assert.strictEqual(res.entries[1].detail, "#3 b beat #2 c 130.0–70.0 · 2022 Wk 3");
  assert.strictEqual(res.entries[2].detail, "#3 c beat #2 a 85.0–70.0 · 2023 Wk 2");
  assert.strictEqual(res.entries[1].rank, 2);
  assert.strictEqual(res.entries[2].rank, 2);
  assert.strictEqual(run(ctx, "biggest-upset", "all").status, "empty", "no Power Rank history, no upsets");
});

const MISS_FIELD = `facts.teamSeasons.forEach((ts) => { if (ts.season === "2022") { const made = ts.key === "u:u1" || ts.key === "u:u2"; ts.playoffApp = made && ts.key === "u:u2"; ts.bye = ts.key === "u:u1"; } });`;

test("playoff picture: best record to miss, worst record to make, fewest wins by a champion", () => {
  const ctx = setup();
  // ESPN 2019 had e (3-10) miss; in 2022 all four teams made the bracket
  assert.deepStrictEqual(top(run(ctx, "best-record-miss-playoffs", "all", WITH_ESPN)), ["e:3-10"]);
  assert.deepStrictEqual(top(run(ctx, "worst-record-make-playoffs", "all", WITH_ESPN)).slice(0, 3), ["d:0-3", "c:1-2", "b:7-6"]);
  assert.deepStrictEqual(top(run(ctx, "fewest-wins-champion", "all", WITH_ESPN)), ["a:3 wins", "a:9 wins"]);
  assert.strictEqual(run(ctx, "fewest-wins-champion", "all", WITH_ESPN).entries[0].detail, "2022 · 3-0 in the regular season");
  // only a (first-round bye) and b make it: c and d missed
  assert.deepStrictEqual(top(runFacts(ctx, "best-record-miss-playoffs", "2022", MISS_FIELD)), ["c:1-2", "d:0-3"], "a bye counts as making it, so a is not a miss");
  assert.deepStrictEqual(top(runFacts(ctx, "worst-record-make-playoffs", "2022", MISS_FIELD)), ["b:2-1", "a:3-0"]);
  assert.strictEqual(runFacts(ctx, "best-record-miss-playoffs", "2022", MISS_FIELD).entries[0].detail, "2022 · 280.0 points scored");
});

test("playoff picture: waits for a finished season and a known playoff field", () => {
  const ctx = setup();
  ["best-record-miss-playoffs", "worst-record-make-playoffs", "fewest-wins-champion"].forEach((id) => {
    assert.strictEqual(run(ctx, id, "2023").status, "empty", `${id}: 2023 is still being played`);
    const def = JSON.parse(runInLoadedContext(ctx, `JSON.stringify(RecordBook.DEFS.find((d) => d.id === ${JSON.stringify(id)}).needsFinishedSeason)`));
    assert.strictEqual(def, true, id);
  });
  // even if a team in the unfinished 2023 season is already marked as a playoff team, the season has not ended
  const early = `facts.teamSeasons.forEach((ts) => { if (ts.season === "2023" && ts.key === "u:u1") ts.playoffApp = true; });`;
  ["best-record-miss-playoffs", "worst-record-make-playoffs"].forEach((id) => assert.strictEqual(runFacts(ctx, id, "2023", early).status, "empty", id));
  // a finished season in which nobody is marked as a playoff team has no field to judge
  const none = `facts.teamSeasons.forEach((ts) => { ts.playoffApp = false; ts.bye = false; });`;
  assert.strictEqual(runFacts(ctx, "best-record-miss-playoffs", "2022", none).status, "empty");
});

test("most last-place finishes: worst regular-season record each finished season, fewest points breaking a tie", () => {
  const ctx = setup();
  const res = run(ctx, "most-last-place-finishes", "all", WITH_ESPN);
  assert.deepStrictEqual(top(res).sort(), ["d:1", "e:1"], "d was 0-3 in 2022, e 3-10 in 2019; 2023 is not over");
  assert.strictEqual(res.entries.find((e) => e.name === "d").detail, "2022");
  assert.strictEqual(res.entries.find((e) => e.name === "e").detail, "2019");
  // d and c both 1-2: d scored fewer points, so d is last
  const close = `facts.teamSeasons.forEach((ts) => { if (ts.season === "2022" && ts.key === "u:u4") { ts.wins = 1; ts.losses = 2; } });`;
  assert.deepStrictEqual(top(runFacts(ctx, "most-last-place-finishes", "2022", close)), ["d:1"]);
  // identical record and points: both share last place
  const dead = close.replace("ts.losses = 2;", "ts.losses = 2; ts.pf = 280;");
  assert.deepStrictEqual(top(runFacts(ctx, "most-last-place-finishes", "2022", dead)).sort(), ["c:1", "d:1"]);
  assert.strictEqual(run(ctx, "most-last-place-finishes", "2023").status, "empty", "regular season still in progress");
});

test("highest scoring benched player: only rostered players who did not start, with what it cost the manager", () => {
  const ctx = setup();
  const bench = `
    const w1 = input.deepSeasons[0].weeks[0].matchups;
    // a (won 100-90) benches a 55-point player; d (lost 80-110) benches a 20-pointer and a 0
    w1[0].players.push("bench1"); w1[0].players_points.bench1 = 55;
    w1[3].players.push("bench2", "bench3"); w1[3].players_points.bench2 = 20; w1[3].players_points.bench3 = 0;
    input.playerDirectory.bench1 = { position: "RB", first_name: "Big", last_name: "Bench" };
    input.playerDirectory.bench2 = { position: "RB", first_name: "Small", last_name: "Bench" };
    input.playerDirectory.bench3 = { position: "RB", first_name: "Zero", last_name: "Bench" };`;
  const res = run(ctx, "highest-scoring-benched-player", "all", bench);
  assert.deepStrictEqual(top(res), ["Big Bench:55.0", "Small Bench:20.0"], "starters and zero-point players are not listed");
  assert.strictEqual(res.entries[0].detail, "benched by a · 2022 Wk 1 · they won anyway");
  assert.strictEqual(res.entries[1].detail, "benched by d · 2022 Wk 1 · they lost by 30.0");
  assert.strictEqual(run(ctx, "highest-scoring-benched-player", "all").status, "empty", "the fixture has no bench");
});

const TRADES = `
  const names = { p1: "Pat One", p2: "Pat Two", p3: "Pat Three", p4: "Pat Four", p5: "Pat Five", p6: "Pat Six", p7: "Pat Seven", p8: "Pat Eight", p9: "Pat Nine" };
  Object.entries(names).forEach(([id, n]) => (input.playerDirectory[id] = { first_name: n.split(" ")[0], last_name: n.split(" ")[1] }));
  input.deepSeasons[0].transactions = [
    { type: "trade", status: "complete", leg: 2, roster_ids: [1, 2], adds: { p1: 1, p2: 1, p3: 2 }, drops: { p1: 2, p2: 2, p3: 1 }, draft_picks: [{ round: 1 }] },
    { type: "trade", status: "complete", leg: 3, roster_ids: [3, 4], adds: { p4: 3, p5: 3, p6: 4 }, drops: { p4: 4, p5: 4, p6: 3 }, draft_picks: [{ round: 1 }, { round: 2 }] },
    { type: "trade", status: "complete", leg: 1, roster_ids: [1, 3], adds: { p7: 1 }, drops: { p7: 3 }, draft_picks: [] },
    { type: "trade", status: "failed", leg: 2, roster_ids: [1, 4], adds: { p8: 1, p9: 1 }, drops: { p8: 4, p9: 4 }, draft_picks: [] },
    { type: "trade", status: "complete", leg: 2, roster_ids: [2, 4], adds: {}, drops: {}, draft_picks: [{ round: 3 }] },
  ];`;

test("blockbuster trades: most players in one completed trade, draft picks break ties", () => {
  const ctx = setup();
  const res = run(ctx, "blockbuster-trades", "all", TRADES);
  assert.deepStrictEqual(top(res), ["c & d:3 players", "a & b:3 players", "a & c:1 player"], "the failed trade and the picks-only trade are not blockbusters");
  assert.strictEqual(res.entries[0].rank, 1);
  assert.strictEqual(res.entries[1].rank, 1, "same player count shares the rank; the extra pick only orders them");
  assert.strictEqual(res.entries[2].rank, 3);
  assert.strictEqual(res.entries[0].detail, "2022 Wk 3 · c sent Pat Six · d sent Pat Four, Pat Five · 2 picks also moved");
  assert.strictEqual(res.entries[0].when, 202203);
  assert.strictEqual(run(ctx, "blockbuster-trades", "2023", TRADES).status, "empty", "the trades were in 2022");
});

test("earliest kicker and defense drafted: every pick counts, graded or not, once the season is over", () => {
  const ctx = setup();
  const stats = `
    const pick = (season, player, pos, pickNo, vbd) => ({ season, player, playerId: "x", position: pos, round: 8, pickNo, pickInRound: 5, isKeeper: false, gradingVbd: vbd, vbd, expectedVbd: 5 });
    input.stats = { draftGradeModel: null, managers: [
      { userId: "u1", seasons: [{ draftPicks: [pick("2022", "Kick A", "K", 95, 10), pick("2022", "Def A", "DEF", 120, 4), pick("2022", "QB A", "QB", 1, 20)] }] },
      { userId: "u2", seasons: [{ draftPicks: [pick("2022", "Kick B", "K", 70, null), pick("2022", "Def B", "DEF", 85, 8)] }] },
      { userId: "u3", seasons: [{ draftPicks: [pick("2023", "Kick Future", "K", 40, 3), pick("2023", "Def Future", "DEF", 30, 3)] }] },
    ] };`;
  const kick = run(ctx, "earliest-kicker-drafted", "all", stats);
  assert.deepStrictEqual(top(kick), ["b:Pick #70", "a:Pick #95"], "b's pick has no grade yet still counts; 2023's draft waits for its season to end");
  assert.strictEqual(kick.entries[0].detail, "Kick B · 8.05 · 2022");
  assert.deepStrictEqual(top(run(ctx, "earliest-defense-drafted", "all", stats)), ["b:Pick #85", "a:Pick #120"]);
  assert.strictEqual(run(ctx, "earliest-kicker-drafted", "2023", stats).status, "empty");
  const flags = JSON.parse(runInLoadedContext(ctx, `JSON.stringify(["earliest-kicker-drafted", "earliest-defense-drafted"].map((id) => RecordBook.DEFS.find((d) => d.id === id).needsFinishedSeason))`));
  assert.deepStrictEqual(flags, [true, true]);
});
