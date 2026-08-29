/*
  ============================================================
  PLAYER INDEX PIPELINE
  ============================================================
  Builds data/player-index.json: for every NFL player who's ever
  started at least one game for a roster in this league's Sleeper-era
  history, a full ownership timeline — every stretch of consecutive
  weeks the same manager had them, who owned them at their single
  highest-scoring week, and the week-by-week score/started data the
  Player page's "Career Arc" chart draws from.

  Powers the NFL Player search page. Scoped to the Sleeper era only —
  this league's pre-Sleeper (ESPN-era) seasons have no player-level
  data on record (see data/manual-history.json), so there's nothing
  for this pipeline to include from them.

  Data sources, in preference order:
    - data/sleeper-archive/{season}.json — this league's own backed-up
      weekly matchup data (see scripts/backup-sleeper-data.js). Preferred
      because it's faster, doesn't hammer Sleeper's API again, and a
      completed season's data can never change anyway.
    - A live Sleeper API fetch, for any season the archive doesn't have
      yet — most commonly the current, still-in-progress season, or a
      first-ever run before any backup has happened.

  Run manually:
    node scripts/build-player-index.js

  Also runs automatically on a schedule via
  .github/workflows/build-player-index.yml.

  Node 18+ required (built-in global fetch — no dependencies).
*/

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(REPO_ROOT, "js", "config.js");
const ARCHIVE_DIR = path.join(REPO_ROOT, "data", "sleeper-archive");
const OUTPUT_PATH = path.join(REPO_ROOT, "data", "player-index.json");
const SLEEPER_BASE = "https://api.sleeper.app/v1";

// js/config.js is written as browser-facing <script>-tag JS, not
// require()-able here — see the identical note in
// scripts/backup-sleeper-data.js, which this mirrors on purpose so the
// two pipelines can't quietly drift onto different league IDs.
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

// Identical walk to backup-sleeper-data.js / js/sleeper-api.js's
// getSeasonChain — same season set, same order, on purpose.
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

    const [rosters, users] = await Promise.all([sleeperGet(`/league/${currentId}/rosters`).catch(() => []), sleeperGet(`/league/${currentId}/users`).catch(() => [])]);

    seasons.push({ league, rosters, users });
    currentId = league.previous_league_id;
  }

  return seasons.reverse(); // oldest -> newest
}

// Prefers this league's own archived copy of a season (see
// scripts/backup-sleeper-data.js) over a fresh Sleeper fetch. Falls
// back to a live fetch — same week-walking rule the backup script and
// the live site both use — only for a season the archive doesn't have.
async function loadSeasonWeeks(seasonEntry, lastFantasyWeek) {
  const season = seasonEntry.league.season;
  const archivePath = path.join(ARCHIVE_DIR, `${season}.json`);
  if (fs.existsSync(archivePath)) {
    try {
      const archived = JSON.parse(fs.readFileSync(archivePath, "utf8"));
      if (Array.isArray(archived.weeks)) return archived.weeks;
    } catch (err) {
      console.warn(`${season}: archive file unreadable (${err.message}) — fetching live instead.`);
    }
  }

  const weeks = [];
  for (let week = 1; week <= lastFantasyWeek; week++) {
    let matchups;
    try {
      matchups = await sleeperGet(`/league/${seasonEntry.league.league_id}/matchups/${week}`);
    } catch (err) {
      break;
    }
    if (!matchups || matchups.length === 0) break;
    weeks.push({ week, matchups });
  }
  return weeks;
}

function loadArchivedPlayerDirectory() {
  const archivePath = path.join(ARCHIVE_DIR, "players.json");
  if (!fs.existsSync(archivePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(archivePath, "utf8"));
  } catch (err) {
    return null;
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

// A manager's team name, same precedence order teamName() in
// js/sleeper-api.js already uses (custom team name if they've set one,
// else their Sleeper display name) — kept identical so a player page
// never shows a different name for the same manager than every other
// page on the site does.
function teamNameFor(user, rosterId) {
  if (user && user.metadata && user.metadata.team_name) return user.metadata.team_name;
  if (user && user.display_name) return user.display_name;
  return `Team ${rosterId ?? "?"}`;
}

/*
  Core of the pipeline. Takes the season chain (for league/roster/user
  metadata) and each season's raw weekly matchup data, and returns
  {playerId: {...}} for every player who's started at least once.

  The trickiest piece is turning a player's scattered weekly
  appearances into clean ownership SPANS — a manager's own continuous
  stretch of owning them. Two things break a span: the owner changing,
  or a gap (the player wasn't on ANY roster in the league that week —
  released, or never picked up). Both need to start a new span even if
  the SAME manager owns them again later, so "left, someone else had
  them, came back" always shows as two separate rows, never one.

  Detecting a "gap" needs a consistent sense of "the very next week"
  that holds up across a season boundary (week 14 of one season is
  immediately followed by week 1 of the next, not something week-number
  arithmetic alone would know). Rather than reasoning about season
  lengths, every (season, week) pair across the whole chain first gets
  a single global, strictly-increasing index — after that, "were these
  two owned weeks actually back-to-back" is just "do their global
  indices differ by exactly 1", regardless of where a season boundary
  falls.
*/
function buildPlayerIndex(seasonChain, seasonWeeksList, playerDirectory) {
  const globalIndexOf = new Map(); // "season:week" -> global index
  seasonChain.forEach((seasonEntry, idx) => {
    (seasonWeeksList[idx] || []).forEach((w) => {
      const key = `${seasonEntry.league.season}:${w.week}`;
      if (!globalIndexOf.has(key)) globalIndexOf.set(key, globalIndexOf.size);
    });
  });

  const managerNames = new Map(); // userId -> most recently seen team name
  const perPlayer = new Map(); // playerId -> [{season, week, globalIndex, ownerId, points, started}]

  seasonChain.forEach((seasonEntry, idx) => {
    const season = seasonEntry.league.season;
    const usersById = new Map((seasonEntry.users || []).map((u) => [u.user_id, u]));
    const rosterOwner = new Map(); // roster_id -> {userId, name}
    (seasonEntry.rosters || []).forEach((r) => {
      const user = usersById.get(r.owner_id);
      const ownerId = r.owner_id || `roster-${r.roster_id}`; // an unclaimed roster still needs a stable identity
      const name = teamNameFor(user, r.roster_id);
      rosterOwner.set(r.roster_id, { userId: ownerId, name });
      managerNames.set(ownerId, name); // later seasons overwrite earlier ones -> most recent name wins, same as the rest of the site
    });

    (seasonWeeksList[idx] || []).forEach((w) => {
      const globalIndex = globalIndexOf.get(`${season}:${w.week}`);
      (w.matchups || []).forEach((m) => {
        const owner = rosterOwner.get(m.roster_id);
        if (!owner) return;
        const pointsMap = m.players_points || {};
        const starterSet = new Set(m.starters || []);
        (m.players || []).forEach((pid) => {
          if (!pid || pid === "0") return;
          if (!perPlayer.has(pid)) perPlayer.set(pid, []);
          perPlayer.get(pid).push({
            season,
            week: w.week,
            globalIndex,
            ownerId: owner.userId,
            points: pointsMap[pid] || 0,
            started: starterSet.has(pid),
          });
        });
      });
    });
  });

  const players = {};
  perPlayer.forEach((weeklyEntries, playerId) => {
    const startedCount = weeklyEntries.filter((e) => e.started).length;
    if (startedCount === 0) return; // scope: only players who've started at least once

    const spans = [];
    let current = null;
    weeklyEntries.forEach((entry) => {
      const isConsecutive = !!current && entry.globalIndex === current._lastGlobalIndex + 1;
      const sameOwner = !!current && entry.ownerId === current.ownerId;
      if (current && isConsecutive && sameOwner) {
        current.gamesOwned += 1;
        if (entry.started) current.gamesStarted += 1;
        current.totalPoints += entry.points;
        current.endSeason = entry.season;
        current.endWeek = entry.week;
        current._lastGlobalIndex = entry.globalIndex;
      } else {
        if (current) spans.push(current);
        current = {
          ownerId: entry.ownerId,
          startSeason: entry.season,
          startWeek: entry.week,
          endSeason: entry.season,
          endWeek: entry.week,
          gamesOwned: 1,
          gamesStarted: entry.started ? 1 : 0,
          totalPoints: entry.points,
          _lastGlobalIndex: entry.globalIndex,
        };
      }
    });
    if (current) spans.push(current);

    spans.forEach((s) => {
      s.ownerName = managerNames.get(s.ownerId) || "Unknown";
      s.ppg = s.gamesOwned > 0 ? round1(s.totalPoints / s.gamesOwned) : 0;
      s.totalPoints = round1(s.totalPoints);
      delete s._lastGlobalIndex;
    });

    let careerHigh = null;
    weeklyEntries.forEach((e) => {
      if (!careerHigh || e.points > careerHigh.points) {
        careerHigh = {
          points: round1(e.points),
          season: e.season,
          week: e.week,
          ownerId: e.ownerId,
          ownerName: managerNames.get(e.ownerId) || "Unknown",
          started: e.started,
        };
      }
    });

    const distinctOwners = new Set(spans.map((s) => s.ownerId)).size;
    const totalGamesOwned = weeklyEntries.length;
    const totalPoints = weeklyEntries.reduce((sum, e) => sum + e.points, 0);
    const info = (playerDirectory && playerDirectory[playerId]) || {};

    players[playerId] = {
      name: info.full_name || `${info.first_name || ""} ${info.last_name || ""}`.trim() || "Unknown Player",
      position: info.position || null,
      spans,
      careerHigh,
      totals: {
        owners: distinctOwners,
        gamesOwned: totalGamesOwned,
        gamesStarted: startedCount,
        gamesBenched: totalGamesOwned - startedCount,
        totalPoints: round1(totalPoints),
        ppg: totalGamesOwned > 0 ? round1(totalPoints / totalGamesOwned) : 0,
      },
      // Week-by-week, for the Career Arc chart. Deliberately doesn't
      // repeat ownerId/ownerName per week — the chart derives "who
      // owned this game" by matching (season, week) against `spans`
      // client-side, since spans are few and this keeps the file
      // considerably smaller across a long career.
      weekly: weeklyEntries.map((e) => ({ season: e.season, week: e.week, points: round1(e.points), started: e.started ? 1 : 0 })),
    };
  });

  return players;
}

async function main() {
  const { leagueId, lastFantasyWeek } = readConfig();
  console.log(`Walking season chain from league ${leagueId}...`);
  const chain = await getSeasonChain(leagueId);
  if (chain.length === 0) {
    throw new Error(`Found 0 seasons for league ${leagueId} — this almost certainly means the league ID is wrong or Sleeper's API is unreachable right now.`);
  }
  console.log(`Found ${chain.length} season(s): ${chain.map((s) => s.league.season).join(", ")}`);

  console.log("Loading each season's weekly matchup data (archive first, live fallback)...");
  const seasonWeeksList = [];
  for (const seasonEntry of chain) {
    const weeks = await loadSeasonWeeks(seasonEntry, lastFantasyWeek);
    seasonWeeksList.push(weeks);
    console.log(`${seasonEntry.league.season}: ${weeks.length} week(s) loaded.`);
  }

  console.log("Loading player directory...");
  let playerDirectory = loadArchivedPlayerDirectory();
  if (!playerDirectory) {
    console.log("No archived player directory found locally — fetching live...");
    playerDirectory = await sleeperGet(`/players/nfl`);
  }

  console.log("Building player index...");
  const players = buildPlayerIndex(chain, seasonWeeksList, playerDirectory);
  const playerCount = Object.keys(players).length;
  console.log(`Indexed ${playerCount} player(s) who've started at least once in this league's Sleeper-era history.`);

  const output = {
    _instructions:
      "Precomputed player ownership history, Sleeper era only — see scripts/build-player-index.js. Regenerate by running that script (reads data/sleeper-archive/ first, falls back to a live Sleeper fetch for any season not yet archived). Only includes players who've started at least one game for a roster in this league's history; the NFL Player page's search is scoped to exactly this set. Each player's `spans` is their ownership timeline (one entry per continuous stretch with the same manager — the same manager can appear in more than one span if they owned, lost, and later re-acquired the player). `weekly` is every week someone in the league had them rostered, for the Career Arc chart; a week nobody in the league owned them simply has no entry, rather than a special placeholder.",
    generatedAt: new Date().toISOString(),
    players,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  console.log(`Saved ${OUTPUT_PATH} (${playerCount} players).`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Player index build failed:", err);
    process.exit(1);
  });
}

module.exports = { buildPlayerIndex, teamNameFor, round1 };
