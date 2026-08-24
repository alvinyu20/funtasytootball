const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["utils.js", "sleeper-api.js", "deep-history.js"]);
const { DeepHistory } = ctx;

function fitModel(picks) {
  return DeepHistory.computeDraftGradeModel(picks);
}

test("draft grades: a player who scored zero points all season is always an F, regardless of VBD", () => {
  const model = fitModel([{ pickNo: 1, vbd: 50 }, { pickNo: 2, vbd: 40 }, { pickNo: 3, vbd: 30 }]);
  const grading = DeepHistory.gradeDraftPick(100, 1, model, 0, 1, "WR");
  assert.strictEqual(grading.grade, "F");
});

test("draft grades: K/DEF cap at B even with a strong z-score that would otherwise be S or A", () => {
  // Build a simple model where a residual of +100 over expected is clearly S/A territory.
  const picks = Array.from({ length: 20 }, (_, i) => ({ pickNo: i + 1, vbd: 100 - i * 4 }));
  const model = fitModel(picks);

  const kGrading = DeepHistory.gradeDraftPick(200, 10, model, 50, 1, "K");
  const defGrading = DeepHistory.gradeDraftPick(200, 11, model, 50, 1, "DEF");
  const wrGrading = DeepHistory.gradeDraftPick(200, 12, model, 50, 1, "WR");

  assert.ok(["S", "A"].includes(wrGrading.grade), "sanity check: this residual really is S/A territory for a normal position");
  assert.strictEqual(kGrading.grade, "B", "K should be capped at B even with an S/A-caliber residual");
  assert.strictEqual(defGrading.grade, "B", "DEF should be capped at B even with an S/A-caliber residual");
});

test("draft grades: a player unavailable for most of the season caps at B even with a great per-game rate", () => {
  const picks = Array.from({ length: 20 }, (_, i) => ({ pickNo: i + 1, vbd: 100 - i * 4 }));
  const model = fitModel(picks);

  const fullSeason = DeepHistory.gradeDraftPick(200, 10, model, 50, 1.0, "WR");
  const halfSeason = DeepHistory.gradeDraftPick(200, 10, model, 50, 0.3, "WR");

  assert.ok(["S", "A"].includes(fullSeason.grade), "sanity check: full availability really does earn S/A here");
  assert.strictEqual(halfSeason.grade, "B", "the same residual, but available for well under half the season, should cap at B");
});
