/*
  ============================================================
  SLEEPER DATA BACKUP
  ============================================================
  Walks this league's full season history on Sleeper's public API
  (the same "previous_league_id" chain js/sleeper-api.js uses) and
  saves the raw response data as JSON files in data/sleeper-archive/,
  one file per season, plus the NFL player directory. This is insurance,
  not a live data source for the site itself: if Sleeper's public API
  ever goes away, changes shape, or a league becomes inaccessible,
  everything this site has ever shown is otherwise gone with it, since
  nothing is currently stored anywhere except live, on-demand calls to
  Sleeper's own servers.

  Run manually:
    node scripts/backup-sleeper-data.js

  Also wired up to run automatically on a schedule via
  .github/workflows/backup-sleeper-data.yml, since GitHub Actions runs
  on infrastructure with normal internet access (unlike some sandboxed
  environments, which may not be able to reach Sleeper's API directly).

  Node 18+ required (relies on the built-in global fetch — no
  dependencies to install).
*/

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(REPO_ROOT, "js", "config.js");
const OUTPUT_DIR = path.join(REPO_ROOT, "data", "sleeper-archive");
const SLEEPER_BASE = "https://api.sleeper.app/v1";

// js/config.js is written as browser-facing <script>-tag JS (plain
// `const X = ...`, no module.exports), so it isn't directly
// require()-able here. Reading the two values this script needs out of
// its text keeps config.js as the single source of truth — no
// duplicated, driftable constants between the live site and this
// script — without needing to change its format or add a build step.
function readConfig() {
  const text = fs.readFileSync(CONFIG_PATH, "utf8");
  const leagueIdMatch = text.match(/const LEAGUE_ID\s*=\s*"([^"]*)"/);
  const lastWeekMatch = text.match(/const LAST_FANTASY_WEEK\s*=\s*(\d+)/);
  if (!leagueIdMatch) throw new Error("Couldn't find LEAGUE_ID in js/config.js");
  if (!lastWeekMatch) throw new Error("Couldn't find LAST_FANTASY_WEEK in js/config.js");
  return { leagueId: leagueIdMatch[1], lastFantasyWeek: Number(lastWeekMatch[1]) };
}

async function sleeperGet(pathSuffix) {
  const res = await fetch(`${SLEEPER_BASE}${pathSuffix}`);
  if (!res.ok) throw new Error(`Sleeper API error ${res.status} on ${pathSuffix}`);
  return res.json();
}

// Mirrors SleeperAPI.getSeasonChain in js/sleeper-api.js exactly (same
// walk direction, same per-season fields, same guard against an
// accidental infinite loop) so the backup reflects the same season set
// the live site itself would build.
async function getSeasonChain(startLeagueId) {
  const seasons = [];
  let currentId = startLeagueId;
  let guard = 0;

  while (currentId && currentId !== "0" && guard < 40) {
    guard++;
    let league;
    try {
      league = await sleeperGet(`/league/${currentId}`);
    } catch (err) {
      console.warn(`Stopped walking season chain at ${currentId}: ${err.message}`);
      break;
    }
    if (!league) break;

    const [rosters, users, bracket] = await Promise.all([
      sleeperGet(`/league/${currentId}/rosters`).catch(() => []),
      sleeperGet(`/league/${currentId}/users`).catch(() => []),
      sleeperGet(`/league/${currentId}/winners_bracket`).catch(() => []),
    ]);

    seasons.push({ league, rosters, users, bracket });
    currentId = league.previous_league_id;
  }

  return seasons.reverse(); // oldest -> newest
}

// Fetches every week's matchups (until Sleeper returns an empty week,
// same stopping rule the live site uses) and every week's transactions
// for one season, plus the draft and its picks. Deliberately kept as
// close to Sleeper's own raw response shape as possible — no
// filtering down to "weeks with a score" the way the live site's own
// deep-history.js does for rendering, since the point of a backup is
// to keep the actual source material, not a derived view of it.
async function fetchSeasonRaw(seasonEntry, lastFantasyWeek) {
  const leagueId = seasonEntry.league.league_id;

  const weeks = [];
  for (let week = 1; week <= lastFantasyWeek; week++) {
    let matchups;
    try {
      matchups = await sleeperGet(`/league/${leagueId}/matchups/${week}`);
    } catch (err) {
      break;
    }
    if (!matchups || matchups.length === 0) break;
    weeks.push({ week, matchups });
  }

  const transactions = [];
  for (const { week } of weeks) {
    try {
      const tx = await sleeperGet(`/league/${leagueId}/transactions/${week}`);
      if (Array.isArray(tx)) transactions.push(...tx);
    } catch (err) {
      // one week's transactions failing shouldn't sink the whole season backup
    }
  }

  let draft = null;
  try {
    const drafts = await sleeperGet(`/league/${leagueId}/drafts`);
    if (drafts && drafts.length > 0) {
      const picks = await sleeperGet(`/draft/${drafts[0].draft_id}/picks`);
      draft = { draftId: drafts[0].draft_id, picks };
    }
  } catch (err) {
    draft = null;
  }

  return {
    league: seasonEntry.league,
    rosters: seasonEntry.rosters,
    users: seasonEntry.users,
    bracket: seasonEntry.bracket,
    weeks,
    transactions,
    draft,
    backedUpAt: new Date().toISOString(),
  };
}

async function main() {
  const { leagueId, lastFantasyWeek } = readConfig();
  console.log(`Walking season chain from league ${leagueId}...`);
  const chain = await getSeasonChain(leagueId);
  if (chain.length === 0) {
    throw new Error(
      `Found 0 seasons for league ${leagueId} — this almost certainly means the league ID is wrong or Sleeper's API is unreachable right now, not that the league is genuinely empty. Stopping here rather than continuing with a backup that would be misleadingly incomplete.`
    );
  }
  console.log(`Found ${chain.length} season(s): ${chain.map((s) => s.league.season).join(", ")}`);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (const seasonEntry of chain) {
    const season = seasonEntry.league.season;
    const isComplete = seasonEntry.league.status === "complete";
    const outPath = path.join(OUTPUT_DIR, `${season}.json`);

    // A completed season's data can never change on Sleeper's end, so
    // once it's backed up there's no need to ever re-fetch it — keeps
    // repeat runs fast and avoids hammering Sleeper's API for no
    // reason. Only the current, still-in-progress season (and any
    // season backed up for the first time) actually needs a fresh
    // fetch.
    if (isComplete && fs.existsSync(outPath)) {
      console.log(`${season}: already backed up (season complete) — skipping.`);
      continue;
    }

    console.log(`${season}: fetching...`);
    const raw = await fetchSeasonRaw(seasonEntry, lastFantasyWeek);
    fs.writeFileSync(outPath, JSON.stringify(raw));
    console.log(`${season}: saved (${raw.weeks.length} weeks, ${raw.transactions.length} transactions).`);
  }

  // The NFL player directory (player ID -> name/position/team) is what
  // makes archived rosters, draft picks, and transactions actually
  // readable later, rather than a list of bare IDs. It's the same file
  // regardless of league, so it's kept as a single, overwritten
  // snapshot rather than one per season.
  console.log("Fetching player directory...");
  const players = await sleeperGet(`/players/nfl`);
  fs.writeFileSync(path.join(OUTPUT_DIR, "players.json"), JSON.stringify(players));
  console.log(`Player directory saved (${Object.keys(players).length} players).`);

  console.log("Backup complete.");
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
