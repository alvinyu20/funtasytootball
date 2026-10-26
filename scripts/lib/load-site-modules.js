/*
  Loads the site's own browser scripts (js/*.js — plain globals, no module
  system) into a Node vm context so build scripts can run the REAL
  Record Book and DeepHistory code instead of keeping a copy of it.

  Same idea as tests/helpers/site-env.js, trimmed to what a build script
  needs. `const`-declared globals (RecordBook, DeepHistory...) don't become
  properties of the context on their own, so they're promoted explicitly.
*/

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const JS_DIR = path.join(__dirname, "..", "..", "js");
const PROMOTE = { "deep-history.js": ["DeepHistory"], "sleeper-api.js": ["SleeperAPI"], "record-book.js": ["RecordBook"] };

function loadSiteModules(filenames) {
  const context = {
    console,
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    location: { hash: "" },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async () => {
      throw new Error("The build scripts run offline — no fetch() allowed.");
    },
  };
  vm.createContext(context);
  filenames.forEach((filename) => {
    const file = path.join(JS_DIR, filename);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
    (PROMOTE[filename] || []).forEach((name) => vm.runInContext(`globalThis.${name} = ${name};`, context));
  });
  return context;
}

module.exports = { loadSiteModules };
