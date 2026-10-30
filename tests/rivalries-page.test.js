/*
  The Rivalries page's shell: rivalries.html, css/rivalries.css and how js/rivalries.js hooks into them.
  The page is drawn by script, so a renamed id or a script out of order would leave it blank; these catch that.
*/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const html = read("rivalries.html");
const script = read("js/rivalries.js");
const css = read("css/rivalries.css");

const idsInHtml = () => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
// ids that the script writes into markup it builds itself (the top card), so they are not in the page file
const DRAWN_BY_SCRIPT = new Set(["riv-this"]);

test("every id the script looks up is in the page, so nothing is drawn into thin air", () => {
  const wanted = new Set([...script.matchAll(/(?:getElementById|setHtml)\(\s*"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]));
  assert.ok(wanted.size >= 20, "found the ids the script uses");
  const have = idsInHtml();
  const missing = [...wanted].filter((id) => !have.has(id) && !DRAWN_BY_SCRIPT.has(id));
  assert.deepStrictEqual(missing, []);
  assert.ok(script.includes('id="riv-this"'), "the top card is where riv-this comes from");
});

test("every id in the page is unique", () => {
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(all.filter((id, i) => all.indexOf(id) !== i), []);
});

test("the jump-to links scroll with data-jump, never by hash, because the hash carries the open rivalry", () => {
  const links = [...html.matchAll(/<a href="#([^"]+)" data-jump="([^"]+)">([^<]+)<\/a>/g)];
  assert.deepStrictEqual(links.map((m) => m[3]), ["This rivalry", "Compare", "League map", "Streaks and records"]);
  const have = idsInHtml();
  links.forEach(([, href, jump]) => {
    assert.strictEqual(href, jump, "the href is only a fallback for the same place");
    assert.ok(have.has(jump) || DRAWN_BY_SCRIPT.has(jump), `${jump} exists`);
  });
  assert.ok(/closest\("\[data-jump\]"\)/.test(script) && /e\.preventDefault\(\)/.test(script), "the click is handled without changing the URL");
  const hashWrites = script.match(/location\.hash\s*=|history\.(?:replaceState|pushState)/g) || [];
  assert.ok(hashWrites.length >= 1, "the open pair is still written to the hash (so the page can be shared)");
});

test("scripts load in dependency order, with the number crunching before the page", () => {
  const order = [...html.matchAll(/<script src="js\/([a-z-]+)\.js(?:\?v=[0-9a-f]+)?"><\/script>/g)].map((m) => m[1]);
  assert.deepStrictEqual(order, ["nav", "config", "utils", "my-team", "sleeper-api", "deep-history", "manual-history", "history-data", "rivalries-data", "rivalries"]);
  assert.ok(!/js\/(?:teams-data|record-book|charts)\.js/.test(html), "nothing the page doesn't use");
});

test("the stylesheet is its own file: rivalries.css loads after styles.css, on this page only", () => {
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="css\/([a-z-]+)\.css/g)].map((m) => m[1]);
  assert.deepStrictEqual(sheets, ["styles", "rivalries"]);
  assert.ok(/<body class="page-rivalries">/.test(html));
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".html") && x !== "rivalries.html")) {
    assert.ok(!read(f).includes("rivalries.css"), `${f} does not need the Rivalries styles`);
  }
});

test("the old Rivalries markup is gone: no hotlist, no old content block, no old class names in the page or script", () => {
  for (const [name, src] of [["rivalries.html", html], ["js/rivalries.js", script]]) {
    assert.ok(!/rivalry-content|hot-rivalr|rivalry-score|rivalry-playoff-badge|rivalry-hotlist/.test(src), `${name} still has the old page in it`);
  }
});

test("the bottom sheet is a real dialog: labeled, modal, hidden until opened, and closable from the backdrop and a button", () => {
  const sheet = html.match(/<div class="riv-sheet"[^>]*>/)[0];
  assert.match(sheet, /role="dialog"/);
  assert.match(sheet, /aria-modal="true"/);
  assert.match(sheet, /aria-label="[^"]+"/);
  assert.match(sheet, /\shidden(?=[\s>])/);
  assert.ok(/<div class="riv-sheet-backdrop" data-sheet-close>/.test(html));
  assert.ok(/<button type="button" class="riv-sheet-x" data-sheet-close aria-label="Close">/.test(html), "the close button has a name a screen reader can say");
  assert.ok(/\.riv-sheet\[hidden\] \{ display: none; \}/.test(css), "hidden really hides it, whatever display it is given");
  assert.ok(/"Escape"/.test(script), "Escape closes it");
});

test("the picker's two selects are labeled, and the swap button is a button", () => {
  assert.ok(/<select id="rivalry-select-a" aria-label="First manager">/.test(html));
  assert.ok(/<select id="rivalry-select-b" aria-label="Second manager">/.test(html));
  assert.ok(/<button type="button" id="rivalry-swap"[^>]*aria-label="[^"]+"/.test(html));
});

test("the phone layout rules are there: the sheet and the long log are phone-only, and the map scrolls sideways", () => {
  const phone = css.slice(css.indexOf("@media (max-width: 720px)"));
  assert.ok(phone.length > 500, "a phone block exists");
  assert.match(phone, /\.riv-log \.riv-extra \{ display: none; \}/, "older meetings wait behind the button on a phone");
  assert.match(phone, /\.riv-log-panel\.is-open \.riv-extra \{ display: grid; \}/);
  assert.match(phone, /\.riv-jump \{ display: none; \}/, "the jump bar is a desktop thing");
  assert.match(css, /\.riv-map-scroll \{ overflow-x: auto;/);
  assert.ok(!/\.riv-extra/.test(css.slice(0, css.indexOf("@media (max-width: 720px)"))), "off a phone every meeting is simply shown");
  assert.match(css, /@media \(max-width: 900px\)/, "a tablet step between the two");
});

test("the sheet's copy of the top card is the only thing that may share the page's markup, so its id must not repeat", () => {
  // heroHtml leaves the id off in sheet mode; the page copy and the sheet copy cannot both be #riv-this
  assert.ok(/const idAttr = sheet \? "" : ` id="riv-this"`;/.test(script));
});

test("the page's win/loss colors are the shared yellow/blue tokens", () => {
  assert.match(css, /\.riv-s\.won \{[^}]*color: var\(--good\)/);
  assert.match(css, /\.riv-mg\.good \{ color: var\(--good\); \}/);
  assert.match(css, /\.riv-mg\.bad \{ color: var\(--bad\); \}/);
  assert.match(css, /\.riv-sq\.w \{ background: var\(--good\); \}/);
  assert.match(css, /\.riv-sq\.l \{ background: var\(--bad\); \}/);
});
