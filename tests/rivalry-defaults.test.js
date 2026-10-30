/*
  Rivalries opens on something meaningful instead of a random pair: a link,
  then your own hottest rivalry, then this week's featured matchup, then the
  league's hottest. Also: how "hot" a rivalry is and the ranking of the league's pairs.
*/
const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

const setup = () => loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "rivalries-data.js", "rivalries.js"]);
const json = (c, code) => JSON.parse(runInLoadedContext(c, `JSON.stringify(${code})`));

const managers = [
  { userId: "u1", username: "alvin", teamName: "A" },
  { userId: "u2", username: "beth", teamName: "B" },
  { userId: "u3", username: "carl", teamName: "C" },
  { userId: "u4", username: "dana", teamName: "D" },
];

// A game between two user ids. `a` is the first id passed.
const game = (aId, bId, aScore, bScore, season, extra) => ({ aUserId: aId, bUserId: bId, aScore, bScore, season: String(season), week: 3, isPlayoff: false, ...extra });
const series = (aId, bId, results, season) => results.map(([x, y], i) => game(aId, bId, x, y, (season || 2024) - (i % 3)));

test("rivalryHeat: nothing played is 0; more meetings beat fewer; an even series beats a sweep of the same length", () => {
  const c = setup();
  assert.strictEqual(c.rivalryHeat([], "u1", 2026), 0);
  const even = series("u1", "u2", [[100, 90], [90, 100], [100, 90], [90, 100]]);
  const sweep = series("u1", "u2", [[100, 90], [100, 90], [100, 90], [100, 90]]);
  assert.ok(c.rivalryHeat(even, "u1", 2026) > c.rivalryHeat(sweep, "u1", 2026));
  const longer = series("u1", "u2", [[100, 90], [90, 100], [100, 90], [90, 100], [100, 90], [90, 100]]);
  assert.ok(c.rivalryHeat(longer, "u1", 2026) > c.rivalryHeat(even, "u1", 2026));
});

test("rivalryHeat: playoff games and recent games add heat; who is listed first doesn't change the answer", () => {
  const c = setup();
  const base = [game("u1", "u2", 100, 90, 2020), game("u2", "u1", 100, 90, 2020)];
  const withPlayoff = [game("u1", "u2", 100, 90, 2020, { isPlayoff: true }), game("u2", "u1", 100, 90, 2020)];
  const recent = [game("u1", "u2", 100, 90, 2026), game("u2", "u1", 100, 90, 2026)];
  assert.ok(c.rivalryHeat(withPlayoff, "u1", 2026) > c.rivalryHeat(base, "u1", 2026));
  assert.ok(c.rivalryHeat(recent, "u1", 2026) > c.rivalryHeat(base, "u1", 2026));
  assert.strictEqual(c.rivalryHeat(base, "u1", 2026), c.rivalryHeat(base, "u2", 2026));
});

test("hottestRivalries: hottest first, records oriented to the first id, unknown managers skipped, limit respected", () => {
  const c = setup();
  c.__LOG__ = {
    "u1|u2": series("u1", "u2", [[100, 90], [90, 100], [100, 90], [90, 100], [100, 90]]),
    "u1|u3": series("u1", "u3", [[100, 90]]),
    "u2|u3": series("u2", "u3", [[100, 90], [90, 100]]),
    "u1|ghost": series("u1", "ghost", [[100, 90], [90, 100], [100, 90]]),
    "u3|u4": [],
  };
  c.__MGR__ = managers;
  const rows = json(c, "hottestRivalries(__LOG__, __MGR__)");
  assert.deepStrictEqual(rows.map((r) => `${r.a}|${r.b}`), ["u1|u2", "u2|u3", "u1|u3"]);
  assert.deepStrictEqual([rows[0].winsA, rows[0].winsB, rows[0].meetings, rows[0].nameA, rows[0].nameB], [3, 2, 5, "alvin", "beth"]);
  assert.strictEqual(json(c, "hottestRivalries(__LOG__, __MGR__, 1)").length, 1);
});

test("hottestRivalries: a tie in heat is settled the same way every visit (more meetings, then name)", () => {
  const c = setup();
  const one = series("u1", "u2", [[100, 90]]);
  c.__LOG__ = { "u3|u4": series("u3", "u4", [[100, 90]]), "u1|u2": one };
  c.__MGR__ = managers;
  const first = json(c, "hottestRivalries(__LOG__, __MGR__)").map((r) => r.a);
  const second = json(c, "hottestRivalries(__LOG__, __MGR__)").map((r) => r.a);
  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(first, ["u1", "u3"], "alvin/beth sorts before carl/dana");
});

test("hottestRivalries: when two pairs are equally hot, the one with more meetings goes first (not just whoever sorts first by name)", () => {
  const c = setup();
  const old = (a, b, results) => results.map(([x, y]) => game(a, b, x, y, 2020));
  c.__LOG__ = {
    "u1|u2": old("u1", "u2", [[100, 90], [90, 100]]), // 2 meetings, dead even: heat 3
    "u3|u4": old("u3", "u4", [[100, 90], [100, 90], [100, 90], [100, 90], [100, 90], [100, 90]]), // 6 meetings, swept: heat 3
    "u1|u3": [game("u1", "u3", 100, 90, 2026)], // only here to make 2026 the newest season, so 2020 isn't "recent"
  };
  c.__MGR__ = managers;
  const rows = json(c, "hottestRivalries(__LOG__, __MGR__)");
  assert.strictEqual(rows[0].heat, rows[1].heat, "setup: the two pairs really are tied on heat");
  assert.deepStrictEqual(rows.slice(0, 2).map((r) => r.a + "|" + r.b), ["u3|u4", "u1|u2"]);
});

// Two pairs have met (alvin/beth and carl/dana); carl/dana is the hotter one.
function pickOpening(overrides) {
  const c = setup();
  const log = { "u1|u2": series("u1", "u2", [[100, 90]]), "u3|u4": series("u3", "u4", [[100, 90]]) };
  const hot = [{ a: "u3", b: "u4" }, { a: "u1", b: "u2" }];
  c.__ARGS__ = { hashPair: [], validIds: new Set(["u1", "u2", "u3", "u4"]), me: "", managers, featured: null, pairGameLog: log, hot, fallback: ["u1", "u2"], ...overrides };
  return json(c, "pickOpeningPair(__ARGS__)");
}

test("pickOpeningPair: a link to a real pair always wins", () => {
  const r = pickOpening({ hashPair: ["u2", "u4"], me: "alvin", featured: { a: "u1", b: "u2" } });
  assert.deepStrictEqual(r, { a: "u2", b: "u4", reason: "" });
});

test("pickOpeningPair: a link with an unknown or repeated manager is ignored", () => {
  assert.notStrictEqual(pickOpening({ hashPair: ["u2", "nobody"] }).reason, "");
  assert.notStrictEqual(pickOpening({ hashPair: ["u2", "u2"] }).reason, "");
});

test("pickOpeningPair: your team's hottest rivalry comes next, you listed first, case-insensitively", () => {
  const mine = pickOpening({ me: "  ALVIN " });
  assert.deepStrictEqual(mine, { a: "u1", b: "u2", reason: "Your hottest rivalry" });
  const asB = pickOpening({ me: "beth" });
  assert.deepStrictEqual(asB, { a: "u2", b: "u1", reason: "Your hottest rivalry" });
});

test("pickOpeningPair: then this week's featured matchup, but only if those two have actually met", () => {
  const met = pickOpening({ featured: { a: "u1", b: "u2" } });
  assert.deepStrictEqual(met, { a: "u1", b: "u2", reason: "This week's featured matchup" });
  const never = pickOpening({ featured: { a: "u1", b: "u3" } });
  assert.strictEqual(never.reason, "The league's hottest rivalry", "never-met pair would open on an empty page");
});

test("pickOpeningPair: then the league's hottest; with nothing on record it uses the fallback and never throws", () => {
  assert.deepStrictEqual(pickOpening({}), { a: "u3", b: "u4", reason: "The league's hottest rivalry" });
  assert.deepStrictEqual(pickOpening({ hot: [], pairGameLog: {} }), { a: "u1", b: "u2", reason: "" });
  assert.deepStrictEqual(pickOpening({ me: "someone-not-in-league", hot: [] }), { a: "u1", b: "u2", reason: "" });
});
