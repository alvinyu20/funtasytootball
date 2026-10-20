/*
  Cache-busting for the site's own CSS and JS.

  GitHub Pages serves every file with `Cache-Control: max-age=600`, so for
  ten minutes after a deploy a browser is free to keep using the old
  js/*.js and css/styles.css it already has. A normal refresh only
  re-checks the HTML page itself, which is why visitors saw a half-updated
  site (new page, old script) until they hard-refreshed or opened an
  incognito window (an empty cache).

  The fix is to make a changed file look like a different file. This script
  appends `?v=<hash of the file's contents>` to every local
  <script src="js/..."> and <link href="css/..."> in the root *.html pages.
  The hash only changes when the file's contents change, so:
    - an edited file gets a new URL, and every browser fetches it fresh;
    - an untouched file keeps its URL and stays cached.

  Usage:
    npm run stamp          rewrite the HTML pages in place
    npm run stamp -- --check   exit 1 (and list the pages) if any are stale

  `npm test` runs the same check, so forgetting to stamp after editing a
  js/ or css/ file shows up as a failing test instead of a stale site.
*/

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");

// `src="js/foo.js"` / `href="css/styles.css"`, optionally already carrying a
// `?v=...` stamp. Only local js/ and css/ files — Google Fonts and anything
// else absolute is left alone.
const ASSET_REF = /\b(src|href)="((?:js|css)\/[^"?#]+\.(?:js|css))(?:\?v=[0-9a-zA-Z]*)?"/g;

function hashOf(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 10);
}

// Returns `html` with every local asset reference stamped with the hash of
// that asset's current contents. `readAsset(relPath)` returns the file's
// bytes, or throws if it doesn't exist (a typo'd path should fail loudly).
function stampHtml(html, readAsset) {
  return html.replace(ASSET_REF, (_match, attr, rel) => `${attr}="${rel}?v=${hashOf(readAsset(rel))}"`);
}

function rootHtmlFiles(root) {
  return fs.readdirSync(root).filter((f) => f.endsWith(".html")).sort();
}

// Stamps every root HTML page. Returns the names of pages that were (or, in
// check mode, would be) changed.
function stampSite(root = ROOT, { check = false } = {}) {
  const readAsset = (rel) => {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) throw new Error(`Referenced asset not found: ${rel}`);
    return fs.readFileSync(file);
  };
  const changed = [];
  for (const name of rootHtmlFiles(root)) {
    const file = path.join(root, name);
    const before = fs.readFileSync(file, "utf8");
    const after = stampHtml(before, readAsset);
    if (after !== before) {
      changed.push(name);
      if (!check) fs.writeFileSync(file, after);
    }
  }
  return changed;
}

module.exports = { stampHtml, stampSite, hashOf, ASSET_REF };

if (require.main === module) {
  const check = process.argv.includes("--check");
  const changed = stampSite(ROOT, { check });
  if (check) {
    if (changed.length) {
      console.error(`Stale asset versions in: ${changed.join(", ")}\nRun \`npm run stamp\` to fix.`);
      process.exit(1);
    }
    console.log("Asset versions are up to date.");
  } else {
    console.log(changed.length ? `Stamped ${changed.length} page(s): ${changed.join(", ")}` : "Nothing to change — already up to date.");
  }
}
