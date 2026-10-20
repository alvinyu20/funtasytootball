const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { stampHtml, stampSite, hashOf, ASSET_REF } = require("../scripts/stamp-asset-versions");

const ROOT = path.join(__dirname, "..");

function tempSite(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test("stampHtml: adds a content hash to local script and stylesheet references only", () => {
  const html = [
    '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />',
    '<link rel="stylesheet" href="css/styles.css" />',
    '<script src="js/app.js"></script>',
    '<script src="https://cdn.example.com/x.js"></script>',
  ].join("\n");
  const bytes = { "css/styles.css": "body{}", "js/app.js": "run();" };
  const out = stampHtml(html, (rel) => Buffer.from(bytes[rel]));

  assert.ok(out.includes(`href="css/styles.css?v=${hashOf(Buffer.from("body{}"))}"`));
  assert.ok(out.includes(`src="js/app.js?v=${hashOf(Buffer.from("run();"))}"`));
  assert.ok(out.includes('href="https://fonts.googleapis.com/css2?family=Inter"'), "Google Fonts link is untouched");
  assert.ok(out.includes('src="https://cdn.example.com/x.js"'), "absolute URLs are untouched");
});

test("stampHtml: restamping is idempotent and replaces an out-of-date stamp", () => {
  const read = () => Buffer.from("v2");
  const once = stampHtml('<script src="js/app.js?v=oldoldold"></script>', read);
  assert.strictEqual(once, `<script src="js/app.js?v=${hashOf(Buffer.from("v2"))}"></script>`);
  assert.strictEqual(stampHtml(once, read), once);
});

test("stampHtml: a file whose contents differ gets a different version, an unchanged one keeps its version", () => {
  assert.notStrictEqual(hashOf(Buffer.from("a")), hashOf(Buffer.from("b")));
  assert.strictEqual(hashOf(Buffer.from("same")), hashOf(Buffer.from("same")));
});

test("stampSite: rewrites pages in place, reports them, and --check mode reports without writing", () => {
  const dir = tempSite({
    "index.html": '<script src="js/a.js"></script>',
    "other.html": "<p>no assets here</p>",
    "js/a.js": "one",
  });

  const stale = stampSite(dir, { check: true });
  assert.deepStrictEqual(stale, ["index.html"]);
  assert.strictEqual(fs.readFileSync(path.join(dir, "index.html"), "utf8"), '<script src="js/a.js"></script>', "check mode must not write");

  assert.deepStrictEqual(stampSite(dir), ["index.html"]);
  assert.deepStrictEqual(stampSite(dir, { check: true }), [], "nothing stale after stamping");

  // Editing the script makes the page stale again.
  fs.writeFileSync(path.join(dir, "js/a.js"), "two");
  assert.deepStrictEqual(stampSite(dir, { check: true }), ["index.html"]);
});

test("stampSite: a reference to a file that doesn't exist fails loudly instead of stamping garbage", () => {
  const dir = tempSite({ "index.html": '<script src="js/missing.js"></script>' });
  assert.throws(() => stampSite(dir), /Referenced asset not found: js\/missing\.js/);
});

test("the real site's pages all carry up-to-date ?v= stamps (run `npm run stamp` after editing any js/ or css/ file)", () => {
  const stale = stampSite(ROOT, { check: true });
  assert.deepStrictEqual(stale, [], `Stale asset versions in: ${stale.join(", ")} — run \`npm run stamp\``);
});

test("every local script and stylesheet in the real site is stamped (none slipped through unversioned)", () => {
  const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  assert.ok(pages.length > 0);
  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    const unstamped = [...html.matchAll(/\b(?:src|href)="((?:js|css)\/[^"]+)"/g)].map((m) => m[1]).filter((ref) => !/\?v=[0-9a-f]{10}$/.test(ref));
    assert.deepStrictEqual(unstamped, [], `${page} has unversioned local assets`);
    assert.ok(new RegExp(ASSET_REF.source).test(html) || !/(?:src|href)="(?:js|css)\//.test(html));
  }
});

test("fetchJsonSafe revalidates on every load so data files updated by the workflows show up without a hard refresh", async () => {
  const { loadSiteModules, runInLoadedContext } = require("./helpers/site-env");
  const ctx = loadSiteModules(["utils.js"]);
  let seen;
  ctx.fetch = async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ hello: "world" }) };
  };
  const out = await runInLoadedContext(ctx, `fetchJsonSafe("data/x.json", null)`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), { hello: "world" });
  assert.strictEqual(seen.url, "data/x.json");
  assert.strictEqual(seen.init && seen.init.cache, "no-cache");
});
