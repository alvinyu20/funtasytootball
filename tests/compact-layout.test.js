/*
  The compact layout for Home, History and Teams: less vertical air between and
  inside panels, a Standings table with one line per team, smaller (but still
  leading) type at the top of the Teams profile, and nothing left behind by the
  pieces that were removed (CSS for the Home tiles, the Teams highlight boxes,
  the Power Rankings tier bars).
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");

// The declarations of the first rule whose selector list contains `selector` exactly.
function rule(selector, from = 0) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(css))) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((x) => x.trim());
    if (sels.includes(selector)) return m[2];
  }
  return null;
}
const px = (decls, prop) => {
  const m = decls && decls.match(new RegExp(`(?<![-\\w])${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? Number(m[1]) : null;
};

test("Home, History and Teams share a tighter page rhythm: 16px between panels, panels padded ~14/18, 48px at the foot", () => {
  assert.match(rule("main.home"), /gap:\s*16px/);
  assert.match(rule("main.history"), /gap:\s*16px/);
  assert.match(rule("#teams-index-view, #teams-detail-view") || rule("#teams-detail-view"), /gap:\s*16px/);
  for (const sel of ["main.home", "main.history", "main.teams"]) assert.strictEqual(px(rule(sel), "padding-bottom"), 48, sel);
  for (const sel of [".page-home .panel", ".page-history .panel", ".page-teams .panel"]) {
    const d = rule(sel);
    assert.ok(/padding:\s*14px 18px 16px/.test(d), `${sel} is padded 14/18/16`);
  }
  for (const page of ["home", "history", "teams"]) {
    assert.ok(px(rule(`.page-${page} .panel h2`), "font-size") <= 20, `${page}: panel headings are 20px at most`);
    assert.strictEqual(px(rule(`.page-${page} .panel-head h2`), "margin-bottom") ?? 0, 0, `${page}: a heading inside a panel head adds no margin of its own`);
  }
});

test("Standings is one line per team: the username, the Ovr record and PF / PA sit beside the main figure instead of under it", () => {
  assert.match(rule(".hs-team .username-sub"), /display:\s*inline;/);
  assert.match(rule(".hs-sub"), /display:\s*inline;/);
  assert.match(rule(".hs-diff"), /display:\s*inline-block/);
  assert.match(rule(".hs-table .hs-team"), /white-space:\s*nowrap/);
  assert.ok(px(rule(".hs-table td"), "padding") <= 6 || /padding:\s*[3-6]px/.test(rule(".hs-table td")), "rows are ~6px padded top and bottom");
  const src = fs.readFileSync(path.join(ROOT, "js", "dashboard.js"), "utf8");
  const row = src.slice(src.indexOf("function standingsRowHtml"), src.indexOf("// The compact list"));
  assert.ok(!/<br/.test(row), "the row's markup has no line breaks");
});

test("Standings: the Bye / Playoff dividers are thin dashed rules with no text of their own (the Legend names them)", () => {
  const tr = rule(".hs-table tr.hs-line td");
  assert.match(tr, /padding:\s*0\s*;/, "no padding around the line");
  assert.match(tr, /font-size:\s*0/, "nothing readable in the row");
  assert.match(tr, /border-top:\s*2px dashed/);
  assert.match(rule("div.hs-line"), /border-top:\s*2px dashed/);
  assert.ok(!/hs-line td > span|hs-line\s*>\s*span/.test(css), "no label span styling left over");
  assert.match(rule(".hs-key-line"), /border-top:\s*2px dashed/, "the Legend swatch is the same dashed line");
  const src = fs.readFileSync(path.join(ROOT, "js", "dashboard.js"), "utf8");
  const line = src.slice(src.indexOf("const lineHtml"), src.indexOf("body.innerHTML = rows.map"));
  assert.ok(!/<span>/.test(line), "the divider markup has no label span");
});

test("Standings dividers: gold for the playoff line (table, list and Legend swatch), plain for the bye line, and no extra margin around the list divider", () => {
  assert.match(rule(".hs-table tr.hs-line.playoffs td"), /border-color:\s*var\(--gold\)/);
  assert.match(rule("div.hs-line.playoffs"), /border-color:\s*var\(--gold\)/);
  assert.match(rule(".hs-key-line.playoffs"), /border-color:\s*var\(--gold\)/);
  assert.match(rule(".hs-key-line"), /border-top:\s*2px dashed var\(--chalk-dim\)/, "the bye line stays the dim chalk color");
  assert.match(rule("div.hs-line"), /margin:\s*0\s*;/, "the phone divider adds no vertical space of its own");
  assert.match(rule("div.hs-line"), /height:\s*0/);
});

test("a panel head that holds only a freshness chip right-aligns it (the chip is all that is left once the title is gone)", () => {
  assert.match(rule(".panel-head.panel-head-chip"), /justify-content:\s*flex-end/);
});

test("Teams hero: with a Player Representative the bar is name | titles | photo on one row", () => {
  assert.match(rule(".tm-hero.has-rep"), /grid-template-columns:\s*minmax\(0, 1fr\) auto auto/);
  assert.match(rule(".tm-hero.has-rep"), /grid-template-areas:\s*"main titles rep"/);
});

test("My Team card: the avatar is a round picture beside the name, and the name is smaller than before", () => {
  assert.match(rule(".mt-head"), /display:\s*flex/);
  assert.ok(px(rule(".mt-avatar .player-photo-wrap.mt-avatar-img"), "width") >= 54);
  assert.match(rule(".mt-name"), /font-size:\s*clamp\(26px, 3\.4vw, 36px\)/);
});

test("Teams profile: the hero name, record tiles and section headings are smaller, but the name is still the biggest type up top", () => {
  const heroName = rule(".tm-hero-name").match(/font-size:\s*clamp\((\d+)px,\s*[\d.]+vw,\s*(\d+)px\)/);
  assert.ok(heroName && Number(heroName[2]) <= 48 && Number(heroName[2]) >= 40, "the name tops out at 40-48px (it was 66px)");
  const big = px(rule(".tm-tile.big b"), "font-size");
  const small = px(rule(".tm-tile.small b"), "font-size");
  assert.ok(big <= 36 && small <= 28 && big > small, "record numbers are smaller, big tiles still above small ones");
  assert.ok(big < Number(heroName[2]), "no tile number out-shouts the team name");
  const sec = rule(".tm-sec-head h2").match(/clamp\((\d+)px,\s*[\d.]+vw,\s*(\d+)px\)/);
  assert.ok(sec && Number(sec[2]) <= 32, "section headings top out at 32px (they were 42px)");
});

test("nothing is left behind by the removed pieces", () => {
  const SCRIPT_DIRS = ["js", "scripts"].flatMap((d) => {
    const dir = path.join(ROOT, d);
    return fs.readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  });
  [
    "seasonHighlights", "teamsHighlightsHtml", "powerTiers", "tierOddsRange", "PR_TIER_GAP", "buildPulseCells",
    "homeTileCells", "pulseCellHtml", "latestFinalMatchups", "WAIVER_CLEAR_HOUR_ET", "liveSummary",
  ].forEach((name) => assert.ok(!SCRIPT_DIRS.some((src) => src.includes(name)), `${name} is gone from the scripts`));
  assert.ok(!/home-tiles|pulse-cell/.test(css), "Home tile CSS");
  assert.ok(!/tm-hl\b|tm-highlights/.test(css), "Teams highlight-box CSS");
  assert.ok(!/pr-tier|pr-phone-tier/.test(css), "Power Rankings tier-bar CSS");
  assert.ok(!/tc-leader/.test(css), "History live-card leader text CSS");
  assert.ok(!/\.tm-tile p/.test(css), "Teams tile descriptor CSS");
});
