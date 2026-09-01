const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["utils.js"]);
const { escapeHtml, gradeBadgeHtml, heatColor } = ctx;

test("escapeHtml: neutralizes HTML-significant characters", () => {
  assert.strictEqual(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.strictEqual(escapeHtml('"quotes" & <tags>'), "&quot;quotes&quot; &amp; &lt;tags&gt;");
});

test("escapeHtml: leaves plain text completely unchanged", () => {
  assert.strictEqual(escapeHtml("yulovesyou"), "yulovesyou");
  assert.strictEqual(escapeHtml("Puka Nacua"), "Puka Nacua");
});

test("escapeHtml: handles non-string input without throwing", () => {
  assert.doesNotThrow(() => escapeHtml(null));
  assert.doesNotThrow(() => escapeHtml(undefined));
  assert.doesNotThrow(() => escapeHtml(42));
});

test("gradeBadgeHtml: every grade in the standard S-F scale renders without throwing", () => {
  for (const grade of ["S", "A", "B", "C", "D", "F"]) {
    assert.doesNotThrow(() => gradeBadgeHtml(grade), `grade "${grade}" should render cleanly`);
  }
});

test("heatColor: returns a semi-transparent rgba color, not an opaque rgb one, so the heatmap reads as a soft tint rather than a hard block of color", () => {
  const color = heatColor(50, 0, 100);
  assert.match(color, /^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
});

test("heatColor: the alpha channel is a low, muted value (well under fully opaque), matching 'a bit see through'", () => {
  const color = heatColor(50, 0, 100);
  const alpha = Number(color.match(/,\s*([\d.]+)\)$/)[1]);
  assert.ok(alpha > 0 && alpha <= 0.5, `expected a muted alpha between 0 and 0.5, got ${alpha}`);
});

test("heatColor: the lowest value in range gets the red end of the scale, the highest gets green, by default", () => {
  const low = heatColor(0, 0, 100);
  const high = heatColor(100, 0, 100);
  // Red end: R channel should clearly dominate. Green end: G channel should clearly dominate.
  const [lr, lg] = low.match(/[\d.]+/g).map(Number);
  const [hr, hg] = high.match(/[\d.]+/g).map(Number);
  assert.ok(lr > lg, "the low end of the default scale should be red-dominant");
  assert.ok(hg > hr, "the high end of the default scale should be green-dominant");
});

test("heatColor: a middle value lands on the yellow midpoint, roughly balanced between red and green channels", () => {
  const mid = heatColor(50, 0, 100);
  const [r, g, b] = mid.match(/[\d.]+/g).map(Number);
  assert.ok(Math.abs(r - g) < 40, "red and green channels should be reasonably close at the midpoint (yellow)");
  assert.ok(b < r && b < g, "blue should be the lowest channel at a yellow midpoint");
});

test("heatColor: swapping the low/high hex arguments inverts which end is 'good' -- used for metrics like Rank where lower is better", () => {
  // Green passed as the LOW color, red as the HIGH color -- inverts the usual direction.
  const lowValueColor = heatColor(1, 1, 10, "#5CB85C", "#E8C13D", "#D9534F");
  const highValueColor = heatColor(10, 1, 10, "#5CB85C", "#E8C13D", "#D9534F");
  const [, lg] = lowValueColor.match(/[\d.]+/g).map(Number);
  const [hr] = highValueColor.match(/[\d.]+/g).map(Number);
  assert.ok(lg > 100, "the LOW value (e.g. rank 1) should land on the green end when colors are swapped");
  assert.ok(hr > 100, "the HIGH value (e.g. last place) should land on the red end when colors are swapped");
});

test("heatColor: when every value in range is identical (max === min), falls back to the neutral midpoint color rather than dividing by zero", () => {
  assert.doesNotThrow(() => heatColor(5, 5, 5));
  const color = heatColor(5, 5, 5);
  assert.match(color, /^rgba\(/);
});
