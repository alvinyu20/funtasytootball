/*
  Good is yellow, bad is blue, everywhere. The site used to say good/bad with
  green/red (and, for a day, blue/orange); this keeps green/red from creeping back: no green- or red-hued color in
  the stylesheet or the page scripts, apart from a short list of colors that are
  identity rather than judgment (the WR position color, the mascot's toot puff,
  the team line palette in charts.js).
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const jsFiles = fs.readdirSync(path.join(ROOT, "js")).filter((f) => f.endsWith(".js"));

// Colors that name a thing, not a verdict.
const IDENTITY = new Set([
  "#4F8F6B" /* --pos-wr, the WR color on the draft board */,
  "#8FBF9E" /* the mascot's toot puff */,
  "#2F5A47" /* --odds-s1 and #4A5E39 --odds-s5: the low end of the finish-probability grid's ramp (how likely, not good or bad) */,
  "#4A5E39",
]);
const CATEGORICAL_PALETTE_FILES = new Set(["charts.js"]); // team line colors: a different team, a different color

function hue(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  if (d === 0) return { h: 0, s, v: max };
  let h;
  if (max === r / 255) h = ((g - b) / 255 / d) % 6;
  else if (max === g / 255) h = (b - r) / 255 / d + 2;
  else h = (r - g) / 255 / d + 4;
  return { h: (h * 60 + 360) % 360, s, v: max };
}
const isGreenOrRed = ({ h, s, v }) => s > 0.25 && v > 0.3 && ((h >= 80 && h <= 170) || h >= 345 || h <= 12);

function judgmentColors(source) {
  const found = [];
  for (const m of source.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    if (isGreenOrRed(hue(r, g, b)) && !IDENTITY.has("#" + m[1].toUpperCase())) found.push("#" + m[1]);
  }
  for (const m of source.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    if (isGreenOrRed(hue(+m[1], +m[2], +m[3]))) found.push(m[0]);
  }
  if (/\bhsla?\(/.test(source)) found.push("an hsl() color");
  return found;
}

test("the color checker itself: it flags greens and reds and lets blues, yellows, golds and neutrals through", () => {
  assert.deepStrictEqual(judgmentColors("a{color:#5CB85C} b{color:#D9534F} c{color:rgba(88, 196, 127, .4)} d{color:hsl(120, 60%, 40%)}"), ["#5CB85C", "#D9534F", "rgba(88, 196, 127", "an hsl() color"]);
  assert.deepStrictEqual(judgmentColors("a{color:#4EA8DD} b{color:#F0A340} c{color:#E8B23D} d{color:#1C4036} e{color:rgba(255,255,255,0.04)} f{color:#4F8F6B}"), []);
});

test("no green or red left in the stylesheet", () => {
  assert.deepStrictEqual(judgmentColors(read("css/styles.css")), []);
});

test("no green or red left in the Rivalries stylesheet", () => {
  assert.deepStrictEqual(judgmentColors(read("css/rivalries.css")), []);
});

test("no green or red left in the page scripts (the team line palette in charts.js is the one exception)", () => {
  for (const f of jsFiles) {
    if (CATEGORICAL_PALETTE_FILES.has(f)) continue;
    assert.deepStrictEqual(judgmentColors(read(`js/${f}`)), [], `js/${f}`);
  }
});

test("good and bad are one pair of tokens, and every good/bad style uses them", () => {
  const css = read("css/styles.css");
  assert.match(css, /--good: #F0A340;/);
  assert.match(css, /--bad: #4EA8DD;/);
  assert.match(css, /\.luck-positive \{ color: var\(--good\);/);
  assert.match(css, /\.luck-negative \{ color: var\(--bad\);/);
  assert.match(css, /\.matchup-status\.st-progress \{ color: var\(--good\); \}/);
  assert.match(css, /\.result-leads \{ color: var\(--good\);/);
  assert.match(css, /\.fresh-live \{ color: var\(--good\);/);
  assert.match(css, /\.fresh-behind \{ color: var\(--bad\);/, "a chip that is behind is the bad color, not a second yellow");
  assert.match(css, /\.rb-row\.rb-low \{ border-left-color: var\(--bad\); \}/, "a record's lowlight accent is the bad color");
  assert.match(css, /\.tm-luck b\.up \{ color: var\(--good\); \}/, "Teams: a lucky season is the good color");
  assert.match(css, /\.tm-luck b\.down \{ color: var\(--bad\); \}/, "Teams: an unlucky season is the bad color");
  assert.match(css, /\.tm-rank\.in \{ color: var\(--good\)/, "Teams: inside the playoff spots is yellow");
  assert.match(css, /\.tm-rank\.out \{ color: var\(--bad\)/, "Teams: outside the playoff spots is blue");
});

test("no page text still explains a heatmap as green and red", () => {
  for (const f of jsFiles) {
    const src = read(`js/${f}`);
    assert.ok(!/\bgreen is\b|\bred is\b|Green is your|green -> yellow -> red/i.test(src), `js/${f} still describes green/red`);
  }
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".html"))) {
    assert.ok(!/green is|red is/i.test(read(f)), `${f} still describes green/red`);
  }
});

test("the yellow/blue legend wording is on the pages that color by best and worst", () => {
  assert.ok(read("js/season.js").includes("yellow is that column's best, blue is its worst"));
  assert.ok(read("js/player.js").includes("yellow is their best, blue is their worst"));
});

test("playoff odds chart callouts: clinched is the good color and eliminated is the bad color", () => {
  const src = read("js/season.js");
  assert.match(src, /Clinched — Wk \$\{i \+ 1\}`, color: "var\(--good\)"/);
  assert.match(src, /Eliminated — Wk \$\{i \+ 1\}`, color: "var\(--bad\)"/);
});
