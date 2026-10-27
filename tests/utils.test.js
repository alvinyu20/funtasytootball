const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["utils.js"]);
const { escapeHtml, gradeBadgeHtml, heatColor, divergingHeatColor, HEAT_LOW, HEAT_MID, HEAT_HIGH } = ctx;

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

const channels = (color) => color.match(/[\d.]+/g).map(Number); // [r, g, b, alpha]

test("heatColor: returns an rgba color, opaque by default because the scale's own colors are already the muted shades that sit on the panels", () => {
  const color = heatColor(50, 0, 100);
  assert.match(color, /^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
  assert.strictEqual(channels(color)[3], 1);
});

test("heatColor: a lower alpha can still be asked for, for a see-through tint", () => {
  assert.strictEqual(channels(heatColor(50, 0, 100, undefined, undefined, undefined, 0.4))[3], 0.4);
});

test("heatColor: the lowest value in range gets the orange end of the scale, the highest gets blue, by default", () => {
  const [lr, , lb] = channels(heatColor(0, 0, 100));
  const [hr, , hb] = channels(heatColor(100, 0, 100));
  assert.ok(lr > lb, "the low end of the default scale should be orange-dominant");
  assert.ok(hb > hr, "the high end of the default scale should be blue-dominant");
  // exactly the site's three scale colors at the ends and in the middle
  assert.deepStrictEqual(channels(heatColor(0, 0, 100)).slice(0, 3), [0x7c, 0x5d, 0x31]);
  assert.deepStrictEqual(channels(heatColor(50, 0, 100)).slice(0, 3), [0x1c, 0x40, 0x36]);
  assert.deepStrictEqual(channels(heatColor(100, 0, 100)).slice(0, 3), [0x33, 0x6b, 0x7a]);
});

test("heatColor: a middle value lands on the dark neutral, so only the extremes pull the eye", () => {
  const [r, g, b] = channels(heatColor(50, 0, 100));
  assert.ok(r < 60 && g < 80 && b < 80, "the midpoint is a dark shade, not a bright one");
});

test("heatColor: a value a quarter of the way up sits between the orange end and the neutral", () => {
  const [r] = channels(heatColor(25, 0, 100));
  assert.ok(r > 0x1c && r < 0x7c, `red channel ${r} should be between the neutral and the orange end`);
});

test("heatColor: swapping the low/high hex arguments inverts which end is 'good' -- used for metrics like Rank where lower is better", () => {
  // Blue passed as the LOW color, orange as the HIGH color -- inverts the usual direction.
  const lowValueColor = heatColor(1, 1, 10, HEAT_HIGH, HEAT_MID, HEAT_LOW);
  const highValueColor = heatColor(10, 1, 10, HEAT_HIGH, HEAT_MID, HEAT_LOW);
  const [lr, , lb] = channels(lowValueColor);
  const [hr, , hb] = channels(highValueColor);
  assert.ok(lb > lr, "the LOW value (e.g. rank 1) should land on the blue end when colors are swapped");
  assert.ok(hr > hb, "the HIGH value (e.g. last place) should land on the orange end when colors are swapped");
});

test("divergingHeatColor: zero is the neutral, +limit is the full blue, -limit the full orange, and it saturates beyond the limit", () => {
  const rgb = (c) => c.match(/\d+/g).map(Number);
  assert.deepStrictEqual(rgb(divergingHeatColor(0, 10)), [0x1c, 0x40, 0x36]);
  assert.deepStrictEqual(rgb(divergingHeatColor(10, 10)), [0x33, 0x6b, 0x7a]);
  assert.deepStrictEqual(rgb(divergingHeatColor(-10, 10)), [0x7c, 0x5d, 0x31]);
  assert.deepStrictEqual(rgb(divergingHeatColor(25, 10)), rgb(divergingHeatColor(10, 10)), "beyond +limit stays at the full blue");
  assert.deepStrictEqual(rgb(divergingHeatColor(-99, 10)), rgb(divergingHeatColor(-10, 10)), "beyond -limit stays at the full orange");
  const [r5, , b5] = rgb(divergingHeatColor(5, 10));
  const [r0, , b0] = rgb(divergingHeatColor(0, 10));
  assert.ok(b5 > b0 && r5 < 0x7c, "half-way up is between the neutral and the full blue");
});

test("the site's heat scale in utils.js is the same trio as the CSS tokens", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "css", "styles.css"), "utf8");
  assert.ok(css.includes(`--heat-low: ${HEAT_LOW};`));
  assert.ok(css.includes(`--heat-mid: ${HEAT_MID};`));
  assert.ok(css.includes(`--heat-high: ${HEAT_HIGH};`));
});

test("gradeBadgeHtml: best grade is blue, worst is orange, never green or red, and every grade gets its own shade", () => {
  const bg = (g) => gradeBadgeHtml(g).match(/background:rgb\((\d+), (\d+), (\d+)\)/).slice(1).map(Number);
  const [sr, , sb] = bg("S");
  const [fr, , fb] = bg("F");
  assert.ok(sb > sr, "S is blue-dominant");
  assert.ok(fr > fb, "F is orange-dominant");
  const shades = new Set(["S", "A", "B", "C", "D", "F"].map((g) => bg(g).join(",")));
  assert.strictEqual(shades.size, 6);
  assert.ok(!gradeBadgeHtml("S").includes("hsl("));
});

test("heatColor: when every value in range is identical (max === min), falls back to the neutral midpoint color rather than dividing by zero", () => {
  assert.doesNotThrow(() => heatColor(5, 5, 5));
  const color = heatColor(5, 5, 5);
  assert.match(color, /^rgba\(/);
});
