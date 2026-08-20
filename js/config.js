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
  NEWSLETTERS_FILE
  -----------------
  Path to the newsletter index. See data/newsletters.json.
*/
const NEWSLETTERS_FILE = "data/newsletters.json";

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
  POWER_RANK_CSV_HISTORY_FILE
  --------------------
  Historical Power Rank (and, for 2024+, PR Score) data recovered from
  past seasons that predate this site — see
  data/power-rank-csv-history.json. Graphed on each season's page.
*/
const POWER_RANK_CSV_HISTORY_FILE = "data/power-rank-csv-history.json";

/*
  LAST_FANTASY_WEEK
  ------------------
  The last NFL week that actually counts for this league's fantasy season.
  Most leagues stop at week 17 even though the NFL now plays an 18th week —
  change this if your league's schedule is different. Every chart, table,
  and stat on Teams/Season/Records ignores any week beyond this number.
*/
const LAST_FANTASY_WEEK = 17;
