#!/usr/bin/env node
/*
  Builds the two small files that make the Teams, Records, Season, Draft,
  Trades, Rivalries, History and Home pages load fast:

    data/players-slim.json         the NFL player directory cut down to what
                                   the site reads (name parts, position, team)
                                   for every player a roster here could hold,
                                   plus anyone who ever appears in this league's
                                   history. About 80 KB zipped, instead of the
                                   ~2 MB (14 MB unzipped) full directory.
    data/sleeper-archive/index.json  one line per backed-up season (season,
                                   league id, previous league id, status), so
                                   the site can read every finished season from
                                   the backup in one parallel step.

  Both come straight from files already in the repo (data/sleeper-archive/),
  so this needs no network. The Sleeper Data Pipeline workflow runs it right
  after the weekly backup; run it by hand with

      node scripts/build-fast-data.js

  after a manual backup. The pages work without either file (they fall back
  to the full directory and to walking Sleeper's season chain live), just
  more slowly.
*/

const fs = require("node:fs");
const path = require("node:path");
const { loadSiteModules } = require("./lib/load-site-modules");

const ROOT = path.join(__dirname, "..");
const ARCHIVE_DIR = path.join(ROOT, "data", "sleeper-archive");
const SLIM_OUT = path.join(ROOT, "data", "players-slim.json");
const INDEX_OUT = path.join(ROOT, "data", "sleeper-archive", "index.json");

// Defensive positions, for a league that ever turns on IDP slots.
const IDP_POSITIONS = ["DL", "DE", "DT", "NT", "LB", "ILB", "OLB", "DB", "CB", "S", "SS", "FS"];
const NOT_A_POSITION = /FLEX|^BN$|^IR$|^TAXI$/;

// Positions beyond the standard skill positions that any season's lineup
// slots call for (roster_positions in each backed-up league).
function positionsFromArchives(archives) {
  const out = new Set();
  archives.forEach((a) => {
    ((a.league && a.league.roster_positions) || []).forEach((slot) => {
      if (slot === "IDP_FLEX") IDP_POSITIONS.forEach((p) => out.add(p));
      else if (!NOT_A_POSITION.test(slot)) {
        out.add(slot);
        if (["DL", "LB", "DB"].includes(slot)) IDP_POSITIONS.forEach((p) => out.add(p));
      }
    });
  });
  return [...out];
}

// Every player id that shows up anywhere in the backed-up league history:
// weekly lineups and benches, roster moves, draft picks and rosters.
function referencedPlayerIds(archives) {
  const ids = new Set();
  const add = (id) => {
    if (id != null && id !== "" && id !== "0") ids.add(String(id));
  };
  archives.forEach((a) => {
    (a.weeks || []).forEach((w) =>
      (w.matchups || []).forEach((m) => {
        (m.players || []).forEach(add);
        (m.starters || []).forEach(add);
        Object.keys(m.players_points || {}).forEach(add);
      })
    );
    (a.transactions || []).forEach((tx) => {
      Object.keys(tx.adds || {}).forEach(add);
      Object.keys(tx.drops || {}).forEach(add);
    });
    ((a.draft && a.draft.picks) || []).forEach((p) => add(p.player_id));
    (a.rosters || []).forEach((r) => {
      ["players", "reserve", "taxi", "keepers", "starters"].forEach((k) => (r[k] || []).forEach(add));
    });
  });
  return ids;
}

function buildSlimPlayers(players, archives, SleeperAPI) {
  return {
    players: SleeperAPI.slimPlayerDirectory(players, {
      positions: positionsFromArchives(archives),
      keepIds: [...referencedPlayerIds(archives)],
    }),
  };
}

function buildArchiveIndex(archives) {
  return archives
    .filter((a) => a && a.league && a.league.season != null && a.league.league_id != null)
    .map((a) => ({
      season: String(a.league.season),
      leagueId: String(a.league.league_id),
      previousLeagueId: a.league.previous_league_id ? String(a.league.previous_league_id) : null,
      status: a.league.status || null,
    }))
    .sort((x, y) => x.season.localeCompare(y.season));
}

function loadArchives() {
  return fs
    .readdirSync(ARCHIVE_DIR)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), "utf8")));
}

// Writes only when the content changed, so the weekly job commits real news.
function writeIfChanged(file, text) {
  let old = null;
  try {
    old = fs.readFileSync(file, "utf8");
  } catch (err) {
    // no previous file
  }
  if (old === text) return false;
  fs.writeFileSync(file, text);
  return true;
}

function main() {
  const archives = loadArchives();
  if (!archives.length) throw new Error("No season files in data/sleeper-archive/ — run scripts/backup-sleeper-data.js first.");
  const playersFile = path.join(ARCHIVE_DIR, "players.json");
  if (!fs.existsSync(playersFile)) throw new Error("data/sleeper-archive/players.json is missing — run scripts/backup-sleeper-data.js first.");
  const players = JSON.parse(fs.readFileSync(playersFile, "utf8"));
  const { SleeperAPI } = loadSiteModules(["sleeper-api.js"]);

  const slim = buildSlimPlayers(players, archives, SleeperAPI);
  const slimText = JSON.stringify(slim) + "\n";
  const wroteSlim = writeIfChanged(SLIM_OUT, slimText);
  console.log(`${path.relative(ROOT, SLIM_OUT)}: ${Object.keys(slim.players).length} of ${Object.keys(players).length} players, ${Math.round(slimText.length / 1024)} KB${wroteSlim ? "" : " (unchanged)"}`);

  const index = buildArchiveIndex(archives);
  const wroteIndex = writeIfChanged(INDEX_OUT, JSON.stringify(index, null, 1) + "\n");
  console.log(`${path.relative(ROOT, INDEX_OUT)}: ${index.length} seasons (${index.map((e) => `${e.season} ${e.status}`).join(", ")})${wroteIndex ? "" : " (unchanged)"}`);
}

if (require.main === module) main();

module.exports = { buildSlimPlayers, buildArchiveIndex, referencedPlayerIds, positionsFromArchives };
