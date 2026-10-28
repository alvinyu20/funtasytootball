const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js"]);
}

test("sparklinePoints: empty input returns an empty string (caller skips rendering the <svg> entirely)", () => {
  const ctx = setup();
  assert.strictEqual(ctx.sparklinePoints([], 100, 28, 3), "");
});

test("sparklinePoints: a single value plots one point at the horizontal start, without dividing by zero", () => {
  const ctx = setup();
  const points = ctx.sparklinePoints([5], 100, 28, 3);
  assert.strictEqual(points, "3.0,25.0", "one value, no x-step, and a finite (not NaN) y from the zero-range fallback");
});

test("sparklinePoints: the highest value plots at the top (smallest y) and the lowest at the bottom (largest y)", () => {
  const ctx = setup();
  const points = ctx.sparklinePoints([2, 8, 4], 100, 28, 3)
    .split(" ")
    .map((p) => p.split(",").map(Number));
  const ys = points.map((p) => p[1]);
  assert.ok(ys[1] < ys[0] && ys[1] < ys[2], "the middle value (8, the max) should have the smallest y coordinate");
});

test("sparklinePoints: flat input (all equal values) doesn't divide by zero and centers the line", () => {
  const ctx = setup();
  const points = ctx.sparklinePoints([6, 6, 6], 100, 28, 3)
    .split(" ")
    .map((p) => p.split(",").map(Number));
  const ys = points.map((p) => p[1]);
  assert.ok(ys.every((y) => Number.isFinite(y)), "no NaN/Infinity from a zero range");
  assert.ok(ys.every((y) => y === ys[0]), "a flat series should plot as a flat line");
});

test("sparklinePoints: x coordinates are evenly spaced from pad to width-pad", () => {
  const ctx = setup();
  const points = ctx.sparklinePoints([1, 2, 3, 4], 100, 28, 3)
    .split(" ")
    .map((p) => p.split(",").map(Number));
  const xs = points.map((p) => p[0]);
  assert.strictEqual(xs[0], 3, "first point starts at the left padding");
  assert.strictEqual(xs[xs.length - 1], 97, "last point ends at width - padding");
});
