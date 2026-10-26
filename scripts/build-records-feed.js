#!/usr/bin/env node
/*
  Builds the two data files behind the Record Book's "history" features:

    data/records-feed.json     the Home page's "Latest Records" list (the newest
                               record changes) and "Records in Reach" (who is
                               closing in on a record they don't hold yet)
    data/records-history.json  for the Records page: when each record's current
                               holder got there ("Set 2024 Wk 14", NEW badges)
                               and the timeline of who held it before

  It replays the league's saved history (data/sleeper-archive/) one scored
  week at a time, runs the real Record Book on each week's snapshot, and
  writes down every moment a record was set or broken, newest first. See
  scripts/lib/records-replay.js for how the replay works.

  Usage:  node scripts/build-records-feed.js [--keep 60] [--out data/records-feed.json]
                                             [--history-out data/records-history.json]

  It reads only files already in the repo (no network), so it can run any
  time after the Sleeper data backup has refreshed the archive; the
  "Build Records Feed" workflow does that every Tuesday. A full replay takes
  a minute or two, which is why this is a script and not something the Home
  page does on every visit.
*/

const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules } = require("./lib/load-site-modules");
const { replay } = require("./lib/records-replay");
const { reachItems } = require("./lib/records-reach");

const ROOT = path.join(__dirname, "..");
const DEFAULT_KEEP = 60;
// Per record, how many past holders the Records page's timeline can show.
const HISTORY_KEEP = 12;

// The Home feed keeps just what it shows (the replay's extra dating fields stay out of it).
const FEED_FIELDS = ["id", "title", "category", "categoryTitle", "section", "season", "week", "kind", "holder", "playerId", "value", "detail", "previous"];
const feedEvent = (e) => Object.fromEntries(FEED_FIELDS.map((f) => [f, e[f]]));

// One record's story, newest first, as the Records page's timeline reads it.
function historyFor(events, current) {
  const records = {};
  const byId = new Map();
  events.forEach((e) => {
    if (!byId.has(e.id)) byId.set(e.id, []);
    byId.get(e.id).push(e);
  });
  byId.forEach((list, id) => {
    records[id] = {
      current: current[id] || null,
      events: list.slice(0, HISTORY_KEEP).map((e) => {
        const out = { season: e.date.season, week: e.date.week, kind: e.kind, scope: e.scope, holder: e.holder, value: e.value, previous: e.previous };
        if (e.date.before) out.before = true;
        return out;
      }),
      more: Math.max(0, list.length - HISTORY_KEEP),
    };
  });
  return records;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  } catch (err) {
    return fallback;
  }
}

function loadArchives() {
  const dir = path.join(ROOT, "data", "sleeper-archive");
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
}

function buildFeed({ keep = DEFAULT_KEEP, quiet = false } = {}) {
  const ctx = loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "deep-history.js", "record-book.js", "record-defs.js"]);
  const base = {
    RecordBook: ctx.RecordBook,
    DeepHistory: ctx.DeepHistory,
    archives: loadArchives(),
    playerDirectory: readJson("data/sleeper-archive/players.json", {}),
    manual: readJson("data/manual-history.json", null),
    powerRanks: readJson("data/power-rank-csv-history.json", null),
    rawStats: readJson("data/team-raw-stats.json", null),
  };
  const started = Date.now();
  const { events, current, asOf, points, finalFacts } = replay(base, (i, total, point) => {
    if (!quiet && (i % 10 === 0 || i === total - 1)) process.stdout.write(`\r  replaying ${point.season} week ${point.week} (${i + 1}/${total})   `);
  });
  if (!quiet) process.stdout.write("\n");
  const stamp = new Date().toISOString();
  const reach = finalFacts ? reachItems(base.RecordBook, finalFacts).map((r) => ({ ...r, ratio: Math.round(r.ratio * 10000) / 10000 })) : [];
  return {
    feed: { generatedAt: stamp, asOf, events: events.slice(0, keep).map(feedEvent), reach },
    history: { generatedAt: stamp, asOf, records: historyFor(events, current) },
    totalEvents: events.length,
    points,
    seconds: (Date.now() - started) / 1000,
  };
}

if (require.main === module) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const out = path.resolve(ROOT, arg("--out", "data/records-feed.json"));
  const historyOut = path.resolve(ROOT, arg("--history-out", "data/records-history.json"));
  const { feed, history, totalEvents, points, seconds } = buildFeed({ keep: Number(arg("--keep", DEFAULT_KEEP)) });
  // Keep the old timestamp when nothing changed, so the weekly workflow only commits real news.
  const keepStamp = (file, next, pick) => {
    try {
      const old = JSON.parse(fs.readFileSync(file, "utf8"));
      if (JSON.stringify(pick(old)) === JSON.stringify(pick(next))) next.generatedAt = old.generatedAt;
    } catch (err) {
      // no previous file (or unreadable): write a fresh one
    }
  };
  keepStamp(out, feed, (f) => [f.asOf, f.events, f.reach]);
  keepStamp(historyOut, history, (h) => [h.asOf, h.records]);
  fs.writeFileSync(out, JSON.stringify(feed, null, 1) + "\n");
  fs.writeFileSync(historyOut, JSON.stringify(history) + "\n");
  console.log(`Replayed ${points} weeks in ${seconds.toFixed(1)}s: ${totalEvents} record changes, kept the newest ${feed.events.length} -> ${path.relative(ROOT, out)}`);
  console.log(`  timelines for ${Object.keys(history.records).length} records -> ${path.relative(ROOT, historyOut)}`);
  feed.reach.forEach((r) => console.log(`  in reach: ${r.challenger} is ${r.gap} behind ${r.holder} on ${r.title} (${r.current} vs ${r.record})`));
  feed.events.slice(0, 12).forEach((e) =>
    console.log(`  ${e.season} wk ${String(e.week).padStart(2)}  ${e.kind.padEnd(9)} ${e.title} — ${e.holder} ${e.value}${e.previous ? `  (was ${e.previous.holder} ${e.previous.value})` : ""}`)
  );
}

module.exports = { buildFeed };
