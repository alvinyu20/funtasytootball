/*
  ============================================================
  SITE CONFIG — edit this file to personalize the site.
  ============================================================

  LEAGUE_ID
  ---------
  Your CURRENT Sleeper league ID (the site walks backwards
  through past seasons automatically using Sleeper's own
  "previous_league_id" links, so you only need this one).

  How to find it: open your league on sleeper.com or in the
  app. The URL looks like:
    https://sleeper.com/leagues/1124825374950838272
  The long number at the end is your league ID. Paste it below
  as a string (keep the quotes).
*/
const LEAGUE_ID = "1389677682723127296";

/*
  SITE_TITLE
  ----------
  Shown in the nav bar and browser tab. If left blank, the site
  will use the league name Sleeper has on file instead.
*/
const SITE_TITLE = "";

/*
  MANUAL_HISTORY_FILE
  --------------------
  Path to seasons that happened BEFORE this league existed on
  Sleeper (e.g. old ESPN/Yahoo years). See data/manual-history.json
  for the format — fill that file in and it'll automatically
  merge into the History page, listed oldest-appropriate among
  the Sleeper-tracked seasons.
*/
const MANUAL_HISTORY_FILE = "data/manual-history.json";

/*
  SEASON_AWARDS_FILE
  --------------------
  Path to manually-voted "Season End Awards" (Best FA Pickup, Worst Draft
  Pick, etc.) — see data/season-awards.json for the format and how to add
  new years.
*/
const SEASON_AWARDS_FILE = "data/season-awards.json";

/*
  TEAM_STRENGTH_FILE
  --------------------
  Path to manually-entered "Rest of Season" team strength rankings, pulled
  from FantasyPros' League Analyzer (My Playbook) — see
  data/team-strength.json for the format. Update it any time you check
  FantasyPros; the Home page shows whatever's in there.
*/
const TEAM_STRENGTH_FILE = "data/team-strength.json";

/*
  POWER_RANK_HISTORY_FILE
  --------------------
  Weekly Power Rank snapshots, used to show week-over-week movement on
  the Power Rankings page — see data/power-rank-history.json.
*/
const POWER_RANK_HISTORY_FILE = "data/power-rank-history.json";

/*
  POWER_RANKINGS_SNAPSHOT_FILE
  --------------------
  The actual Power Rankings + Playoff Odds table the Power Rankings
  page displays — see data/power-rankings-snapshot.json. This is a
  saved snapshot, not something the page calculates itself: run
  `node scripts/update-power-rankings.js` (after updating
  TEAM_STRENGTH_FILE with fresh ROS ranks) to regenerate it, once a
  week's games are all done. See that script's own comments for why.
*/
const POWER_RANKINGS_SNAPSHOT_FILE = "data/power-rankings-snapshot.json";

/*
  POWER_RANK_CSV_HISTORY_FILE
  --------------------
  Historical Power Rank (and, for 2024+, PR Score) data recovered from
  past seasons that predate this site — see
  data/power-rank-csv-history.json. Graphed on each season's page.
*/
const POWER_RANK_CSV_HISTORY_FILE = "data/power-rank-csv-history.json";

/*
  INJURIES_FILE
  --------------------
  Historical weekly injury reports (skill positions, "Out"/"Doubtful"
  only), sourced from nflverse (CC-BY 4.0) and cross-referenced to
  Sleeper player IDs via the DynastyProcess ID crosswalk — see
  data/injuries.json. Powers the "injury luck" ranking on the Season
  page. This is a periodic manual refresh, not a live feed — re-run the
  pipeline occasionally to pick up the current season as it progresses.
*/
const INJURIES_FILE = "data/injuries.json";

/*
  TEAM_RAW_STATS_FILE
  --------------------
  Box-score totals (passing yards, receptions, TDs...) summed over each
  manager's submitted starting lineup, week by week — see
  data/team-raw-stats.json and scripts/build-team-raw-stats.js. Powers the
  "Team Raw Stats" records on the Records page. It doesn't exist until the
  "Build Team Raw Stats" workflow has run once; until then those records
  show a "waiting on data" state instead of numbers.
*/
const TEAM_RAW_STATS_FILE = "data/team-raw-stats.json";

/*
  RECORDS_FEED_FILE
  --------------------
  The Home page's "Latest Records" list: every moment a Record Book record
  was set or broken, newest first — see data/records-feed.json and
  scripts/build-records-feed.js. The "Build Records Feed" workflow rebuilds
  it every Tuesday; run `node scripts/build-records-feed.js` to do it by hand.
*/
const RECORDS_FEED_FILE = "data/records-feed.json";

/*
  RECORDS_HISTORY_FILE
  --------------------
  For the Records page: when each record's current holder got there (the
  "Set 2024 Wk 14" line and the NEW badge) and who held it before (the
  timeline in each record's dropdown) — see data/records-history.json. Built
  by the same weekly "Build Records Feed" run. Without it the page simply
  leaves those extras out.
*/
const RECORDS_HISTORY_FILE = "data/records-history.json";

/*
  PLAYERS_SLIM_FILE
  --------------------
  The NFL player directory the pages actually load: every fantasy-relevant
  player (and anyone who has ever appeared in this league) with just the
  five fields the site reads — name parts, position, team. About 80 KB
  instead of the ~2 MB (14 MB unzipped) full directory Sleeper serves, which
  also never fit in the browser's storage, so every page had to re-download
  it. Built by scripts/build-fast-data.js after the weekly Sleeper backup;
  if the file is missing the site falls back to the full directory.
*/
const PLAYERS_SLIM_FILE = "data/players-slim.json";

/*
  SLEEPER_ARCHIVE_INDEX_FILE
  --------------------
  A tiny list of the seasons in data/sleeper-archive/ (season, league id,
  previous league id, status) so the site can read every finished season
  from the backup in one parallel step instead of walking Sleeper's
  previous_league_id chain one live request at a time. Built by
  scripts/build-fast-data.js; if it's missing the site walks the chain live
  like it always did.
*/
const SLEEPER_ARCHIVE_INDEX_FILE = "data/sleeper-archive/index.json";

/*
  PLAYER_INDEX_FILE
  --------------------
  Precomputed player ownership history (Sleeper era only) — who owned
  every started player, when, and their career high — see
  data/player-index.json and scripts/build-player-index.js. Powers the
  NFL Player search page. Regenerate with `node scripts/build-player-index.js`.
*/
const PLAYER_INDEX_FILE = "data/player-index.json";

/*
  WAIVER_CLEAR_HOUR_ET
  --------------------
  The hour (Eastern Time, 24-hour clock) that waivers clear on your league's
  waiver day. Sleeper doesn't publish this, so it's measured from the league's
  own history: about 90% of completed waiver claims in 2023-2026 processed
  around 3 AM ET. The Home page's "Next waivers" countdown uses it together
  with the league's waiver day from Sleeper.
*/
const WAIVER_CLEAR_HOUR_ET = 3;

/*
  LAST_FANTASY_WEEK
  ------------------
  The last NFL week that actually counts for this league's fantasy season.
  Most leagues stop at week 17 even though the NFL now plays an 18th week —
  change this if your league's schedule is different. Every chart, table,
  and stat on Teams/Season/Records ignores any week beyond this number.
*/
const LAST_FANTASY_WEEK = 17;
