/*
  ============================================================
  TEST HELPER: loads the site's own JS files, unmodified, into
  a shared Node vm context — mirroring how a browser's <script>
  tags all share one global scope (`window`), which is how
  every file in js/ is actually written (no module system, no
  bundler, cross-file references are just bare globals).

  This exists specifically so tests run against the REAL site
  source, not a hand-copied duplicate of the logic that could
  silently drift out of sync with it.
  ============================================================
*/

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/*
  A note for anyone adding tests against this harness: objects and
  arrays created BY CODE RUNNING INSIDE the vm context belong to a
  different JS realm than the host test file, with their own separate
  Object/Array prototypes. assert.deepStrictEqual is realm-aware and
  correctly refuses to treat these as equal to a plain {} or []
  literal written in the test file itself, even when every property
  matches — it'll report "same structure but not reference-equal"
  rather than passing. This isn't a bug in the site code or the
  harness; it's a real consequence of testing real vm-loaded code.
  Assert on individual primitive fields/lengths instead of the whole
  object/array when a function under test returns something built
  inside the vm context.
*/
const JS_DIR = path.join(__dirname, "..", "..", "js");

// Top-level declarations in each file that a test might need to reach
// from outside the vm context. Only const-declared names need this —
// function declarations (escapeHtml, mapWithConcurrency, etc.) already
// become properties of the context object automatically, the same way
// they'd become properties of `window` in a real browser. const/let
// declarations don't: they live in an internal "script scope" that
// isn't otherwise reachable from outside the vm at all, which is a
// real, easy-to-miss gotcha specific to this loading approach.
const KNOWN_EXPORTS = {
  "charts.js": ["Charts", "MULTI_LINE_COLORS"],
  "deep-history.js": ["DeepHistory"],
  "sleeper-api.js": ["SleeperAPI"],
  "manual-history.js": ["ManualHistory"],
};

/*
  Loads the given js/*.js files, in the order given, into one shared
  vm context, and returns that context — same as loading them via
  <script> tags in the order they appear in a real page's <head>.

  Pass filenames only (e.g. "utils.js"), not full paths. Order matters:
  list a file's own dependencies before the file itself, matching the
  order that file's real HTML page loads them in.
*/
function loadSiteModules(filenames) {
  const context = {
    console,
    // A few browser globals the site's code touches that don't exist in
    // Node by default. Deliberately minimal — just enough for the pure
    // computation functions under test to run; nothing here should ever
    // need to behave like a real browser beyond that.
    window: undefined,
    document: (function () {
      const elementsById = new Map();
      function fakeElement() {
        return { innerHTML: "", textContent: "", style: {}, className: "" };
      }
      return {
        addEventListener: () => {},
        getElementById(id) {
          if (!elementsById.has(id)) elementsById.set(id, fakeElement());
          return elementsById.get(id);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
      };
    })(),
    location: { hash: "" },
    localStorage: {
      _data: {},
      getItem(k) {
        return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null;
      },
      setItem(k, v) {
        this._data[k] = String(v);
      },
      removeItem(k) {
        delete this._data[k];
      },
    },
    fetch: async () => {
      throw new Error("fetch() was called during a test — site logic under test should be pure/synchronous, or the test should provide its own fetch stub via context.fetch before loading modules that need it.");
    },
  };
  vm.createContext(context);

  for (const filename of filenames) {
    const filePath = path.join(JS_DIR, filename);
    const source = fs.readFileSync(filePath, "utf8");
    try {
      vm.runInContext(source, context, { filename: filePath });
    } catch (err) {
      throw new Error(`Failed loading ${filename} into the test context: ${err.message}`);
    }
    for (const exportName of KNOWN_EXPORTS[filename] || []) {
      vm.runInContext(`globalThis.${exportName} = ${exportName};`, context, { filename: `${filePath} (export promotion)` });
    }
  }

  return context;
}

/*
  Runs arbitrary code inside an already-loaded context — needed to set a
  page-controller file's own top-level `let` state (SEASON_CHAIN,
  MANUAL_HISTORY, LEAGUE_STATS, etc.) from a test. Directly assigning
  `context.SEASON_CHAIN = ...` from outside does NOT work for this, for
  the same underlying reason reading a const export needs the promotion
  trick above: these variables live in the vm's internal script scope,
  not as properties of the context object itself. Running an assignment
  AS CODE inside that same context, though, resolves correctly against
  the existing binding, since it's executing in the same scope the
  original `let`/`const` declaration created.
*/
function runInLoadedContext(context, code) {
  return vm.runInContext(code, context);
}

module.exports = { loadSiteModules, runInLoadedContext };
