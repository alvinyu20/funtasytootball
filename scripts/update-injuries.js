/*
  ============================================================
  INJURY DATA PIPELINE
  ============================================================
  Rebuilds data/injuries.json from nflverse's public weekly injury
  reports and weekly roster data (for IR/PUP/NFI status), cross-
  referenced to Sleeper player IDs. Previously a manual, occasional
  refresh; this automates it the same way scripts/backup-sleeper-data.js
  automates the Sleeper backup.

  Data sources (all public, no API key needed):
    - https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv
      Weekly injury report status (Out/Doubtful/Questionable) per player per week.
    - https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_{season}.csv
      Weekly roster status (ACT/RES/etc, where RES covers IR/PUP/NFI) —
      also conveniently includes nflverse's own gsis_id -> sleeper_id
      mapping for the large majority of skill-position players, verified
      directly against real 2023 data at ~93% coverage on its own.
    - https://github.com/DynastyProcess/data/raw/master/files/db_playerids.csv
      A second gsis_id -> sleeper_id crosswalk, used only as a fallback
      for whatever the roster file's own mapping doesn't cover — closes
      the gap to effectively full coverage (verified: the one single
      2023 case the roster mapping alone missed, this crosswalk resolved).

  Run manually:
    node scripts/update-injuries.js

  Also runs automatically on a schedule via
  .github/workflows/update-injuries.yml.

  Node 18+ required (built-in global fetch — no dependencies).
*/

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const OUTPUT_PATH = path.join(REPO_ROOT, "data", "injuries.json");
const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const START_SEASON = 2015;

// ---------------------------------------------------------------------
// Minimal RFC4180-ish CSV parser (no dependency). Verified directly
// against Python's csv module on real nflverse data: identical row
// count (5,599) on a file where naive line-counting would be wrong,
// since some fields contain embedded newlines inside quotes.
// ---------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // skip
      } else field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseCsvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.length === header.length)
    .map((r) => {
      const obj = {};
      header.forEach((h, i) => (obj[h] = r[i]));
      return obj;
    });
}

async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) return null; // this season's file doesn't exist (yet, or at all) — not an error
    throw new Error(`Unexpected ${res.status} fetching ${url}`);
  }
  const text = await res.text();
  return parseCsvToObjects(text);
}

async function main() {
  const currentYear = new Date().getFullYear();

  console.log("Fetching DynastyProcess ID crosswalk (fallback only, used where nflverse's own roster mapping doesn't cover a player)...");
  const dpRows = (await fetchCsv("https://github.com/DynastyProcess/data/raw/master/files/db_playerids.csv")) || [];
  const dpGsisToSleeper = new Map();
  for (const row of dpRows) {
    if (row.gsis_id && row.sleeper_id) dpGsisToSleeper.set(row.gsis_id, row.sleeper_id);
  }
  console.log(`DynastyProcess crosswalk: ${dpGsisToSleeper.size} gsis_id -> sleeper_id mappings.`);

  // player_id (Sleeper) -> { name, position, weeks: { season: { week: status } } }
  const players = {};

  for (let season = START_SEASON; season <= currentYear; season++) {
    console.log(`\n${season}:`);

    const [injuryRows, rosterRows] = await Promise.all([
      fetchCsv(`https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`),
      fetchCsv(`https://github.com/nflverse/nflverse-data/releases/download/weekly_rosters/roster_weekly_${season}.csv`),
    ]);

    if (!injuryRows && !rosterRows) {
      console.log(`  no data available for ${season} yet — stopping here (seasons are checked in order, so nothing later would exist either).`);
      break;
    }

    // This season's own roster-derived crosswalk, checked before falling
    // back to the DynastyProcess one — nflverse's own mapping is the
    // more authoritative, current source when it has an entry.
    const seasonGsisToSleeper = new Map();
    if (rosterRows) {
      for (const row of rosterRows) {
        if (row.gsis_id && row.sleeper_id) seasonGsisToSleeper.set(row.gsis_id, row.sleeper_id);
      }
    }
    function resolveSleeperId(gsisId) {
      return seasonGsisToSleeper.get(gsisId) || dpGsisToSleeper.get(gsisId) || null;
    }

    let injuryEntries = 0;
    let resEntries = 0;
    let unresolved = 0;

    if (injuryRows) {
      for (const row of injuryRows) {
        if (!SKILL_POSITIONS.has(row.position)) continue;
        if (row.report_status !== "Out" && row.report_status !== "Doubtful") continue;
        const sleeperId = resolveSleeperId(row.gsis_id);
        if (!sleeperId) {
          unresolved++;
          continue;
        }
        if (!players[sleeperId]) players[sleeperId] = { name: row.full_name, position: row.position, weeks: {} };
        if (!players[sleeperId].weeks[season]) players[sleeperId].weeks[season] = {};
        players[sleeperId].weeks[season][row.week] = row.report_status;
        injuryEntries++;
      }
    }

    if (rosterRows) {
      for (const row of rosterRows) {
        if (!SKILL_POSITIONS.has(row.position)) continue;
        if (row.status !== "RES") continue;
        const sleeperId = resolveSleeperId(row.gsis_id);
        if (!sleeperId) {
          unresolved++;
          continue;
        }
        if (!players[sleeperId]) players[sleeperId] = { name: row.full_name, position: row.position, weeks: {} };
        if (!players[sleeperId].weeks[season]) players[sleeperId].weeks[season] = {};
        // RES (IR/PUP/NFI) is the more severe, more definitive signal —
        // takes priority over a same-week "Out" from the injury report
        // if both exist, by simply being applied second here.
        players[sleeperId].weeks[season][row.week] = "RES";
        resEntries++;
      }
    }

    console.log(`  ${injuryEntries} Out/Doubtful entries, ${resEntries} RES (IR/PUP/NFI) entries, ${unresolved} rows dropped (no sleeper_id resolvable)`);
  }

  const output = {
    asOf: new Date().toISOString().slice(0, 10),
    source:
      "nflverse (CC-BY 4.0): weekly injury reports (Out/Doubtful) + weekly roster status (RES=IR/PUP/NFI), cross-referenced to Sleeper player IDs via nflverse's own sleeper_id field, with DynastyProcess's crosswalk as a fallback",
    statuses_included: ["Out", "Doubtful", "RES"],
    players,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  console.log(`\nWrote ${Object.keys(players).length} players to ${OUTPUT_PATH}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Injury pipeline failed:", err);
    process.exit(1);
  });
}

module.exports = { parseCsv, parseCsvToObjects };
