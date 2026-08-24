const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

const ctx = loadSiteModules(["utils.js"]);
const { escapeHtml, gradeBadgeHtml } = ctx;

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
