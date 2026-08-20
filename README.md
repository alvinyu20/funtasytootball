# Your League Site

A static site that pulls live standings, matchups, and history straight from
Sleeper's public API — no server, no database, no hosting bill. Newsletters
live as simple files you (or I) add to over the season.

## 1. Set your league ID (required)

Open `js/config.js` and replace the placeholder:

```js
const LEAGUE_ID = "YOUR_LEAGUE_ID_HERE";
```

Find your league ID in the URL when your league is open on sleeper.com or in
the app — it's the long number, e.g. `sleeper.com/leagues/1124825374950838272`
→ ID is `1124825374950838272`. You only ever need the **current** season's
ID — the site walks backward through past seasons automatically.

Open `index.html` in a browser to check it locally before deploying (double-
click the file, or use a local server like `npx serve`).

## 1b. Last week of your fantasy season (already set to 17)

`js/config.js` also has:

```js
const LAST_FANTASY_WEEK = 17;
```

This caps every fetch, chart, and stat at that week — set for week 18 to be
excluded, since it isn't part of your fantasy season. Change this number if
your league's schedule is ever different.

## 2. Deploy to GitHub Pages (free)

If you haven't already, create a free account at github.com and a new empty
repository (no README/license needed — this folder already has one).

From inside this folder, run:

```bash
git init
git add .
git commit -m "Initial site"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Then on GitHub: open your repo → **Settings** → **Pages** → under "Build and
deployment," set Source to **Deploy from a branch**, branch **main**, folder
**/(root)** → Save.

Give it a minute, then your site is live at:

```
https://YOUR_USERNAME.github.io/YOUR_REPO/
```

## 3. Keep it updated

**Stats & standings:** nothing to do — every page pulls fresh data from
Sleeper on every visit.

**Newsletters:** message me with the week's highlights (or ask me to
summarize the week from your league's data) and I'll draft the write-up.
Add it as a new entry at the top of `data/newsletters.json`:

```json
{
  "slug": "week-4-recap",
  "issue": "Week 4",
  "title": "A Title For The Week",
  "date": "2026-09-29",
  "summary": "One line shown in the list preview.",
  "content": "The full recap text. Use \n\n for paragraph breaks."
}
```

Then push it:

```bash
git add .
git commit -m "Add week 4 newsletter"
git push
```

The new issue shows up automatically — no other wiring needed.

**Pre-Sleeper seasons:** fill in `data/manual-history.json` with your old
years (champion, and optionally the full standings table), commit, and push.
They'll merge into the History page's champions ledger and, if you included
`standings`, get their own table there too.

## How it works

- `index.html` / `js/dashboard.js` — current standings + this week's matchups
- `history.html` / `js/history.js` — walks every past season via Sleeper's
  `previous_league_id` chain, builds an all-time champions ledger and career
  win/loss/points records per manager, and merges in `manual-history.json`
- `teams.html` / `js/teams.js` — a manager leaderboard (listed by Sleeper
  username); click into any team for its season-by-season record,
  head-to-head record against every other manager, most-rostered players,
  and full draft history per season
- `season.html` / `js/season.js` — pick any year (or "TOTAL" for every
  season combined) for a deep dive: final standings, a playoff bracket,
  a weekly league-scoring trend line, each team's scoring average, a
  heatmapped table of average score per week by starting-lineup slot,
  that season's highest/lowest scores, its top 5 closest and top 5 most
  lopsided matchups, the single best weekly performance at each position,
  and draft standouts (best steal, biggest bust, points leader). Teams are
  shown by Sleeper username here too.
- `records.html` / `js/records.js` — league-wide fun stats: highest/lowest
  scores, biggest blowout, closest game, win/lose streaks, best late-round
  steal, biggest draft bust, most trades, most waiver adds, and more
- `newsletters.html` / `js/newsletters.js` — lists issues from
  `data/newsletters.json`; clicking one opens its full text on the same page
- `js/sleeper-api.js` — every call to Sleeper's API lives here
- `js/deep-history.js` — the heavier engine behind Teams, Season, and
  Records: pulls every season's weekly scores, starting lineups,
  waiver/trade activity, and draft board, then computes career, league-wide,
  and single-season stats
- `js/charts.js` — small dependency-free bar/stacked-bar/line chart
  renderers used on the Season page
- `css/styles.css` — the whole visual design (edit `:root` at the top to
  retheme colors/fonts)

Note: the Teams page shows each manager's **Sleeper username**; every other
page (History, Records, Season, the Home dashboard) shows the **custom team
name** they've set in Sleeper instead. Say the word if you'd rather make
that consistent one way or the other everywhere.

### About the Teams, Season, and Records pages

These pages pull a lot more data than the rest of the site — every week's
scores and lineups, every trade and waiver claim, and the full draft board.
To keep that fast:

- **Finished seasons are cached in the visitor's browser** (`localStorage`)
  after the first load, since a completed season's data never changes.
  Repeat visits skip straight to the cache.
- **The current, in-progress season is always fetched fresh.**
- The full NFL player directory (~5MB, used to turn player IDs into names
  and positions) is also cached and only re-fetched once a week.
- The Season page only fetches the ONE year you're viewing, so it's fast
  even on a first visit — Teams and Records need every season at once
  (for career totals), so those two are the ones with a longer first load.

First-ever visit to Teams or Records may take several seconds for a
league with many seasons — there's a status line showing progress while
it works. Every visit after that is fast.

**Draft value stats** (best late-round steal / biggest bust) compare a
player's total points that season to which round they were drafted in
*that same season* — not across years, and not against a "true" ADP.

**The scoring-by-slot table** on the Season page reads that season's own
`roster_positions` from Sleeper, so it adjusts automatically if your league
changes its lineup format year to year. Every column is rank-based, not
tied to a literal roster slot: for a given position, every player who
started that week — whether in a dedicated slot or in FLEX/SUPERFLEX — is
pooled together and sorted by score. The top scorers fill the numbered
dedicated columns (RB1 is always that team's highest-scoring RB that week,
period), and whoever's left over is by definition playing on the flex
line: FLEX always shows that position's weakest starter, and if the same
position fills both FLEX and SUPERFLEX in the same week, FLEX gets the
lower of the two and SUPERFLEX gets the higher one — regardless of which
literal slot each player was actually dragged into.

**The "TOTAL" pill** on the Season page combines every season into one
view — same sections as an individual year, but cumulative. A couple of
these needed their own definition: the weekly trend chart shows the
average score at each week-*of-season* across every year (so "Week 1"
means "every year's Week 1, averaged"), and the scoring-by-slot table
pools every season's lineups together per person rather than per
roster (roster IDs reset each year; people don't). If your league ever
changed its number of RB/WR/etc. slots, the Total table uses the largest
count seen in any season, so e.g. an RB3 column only fills in for the
years that slot actually existed.

**Head-to-head records** live on each manager's Teams page — click into
anyone to see their all-time record against every opponent they've faced,
plus a separate table for playoff meetings only (any matchup at or after
that season's `playoff_week_start`).

**The playoff bracket** on each Season page is read directly from
Sleeper's own bracket data, with scores filled in from that round's actual
matchup results where available.

**Overall Record and Luck**, shown on the Season page's Final Standings
and on each manager's Season By Season table on Teams: "Overall" is the
record a team would have if they'd played every other team every week
instead of just their actual schedule (their score compared against
everyone else's, each week). "Luck" is their real win% minus that Overall
win%, so a team that keeps winning close games against weak opponents
while stronger teams beat each other up shows positive (green); a team
that's scoring well but running into buzzsaws every week shows negative
(red). The Total page's standings show the career version of both, and
adds a Top 5 Luckiest / Top 5 Unluckiest Seasons pair of lists pulled from
every individual team-season in the league's history.

## Known limitations / ideas for later

- Champion detection relies on Sleeper's playoff bracket data (`p: 1` game).
  Leagues with unusual playoff formats may need a manual override — ask me
  and I'll add one.
- No week-by-week starting lineup browser yet (e.g. "show me Team X's exact
  Week 3 2022 lineup") — the site currently uses that data for aggregate
  stats (most-rostered players) rather than a full lineup viewer. Ask if
  you want that added.
- Win/lose streaks are computed across season boundaries (a streak can
  carry from the end of one season into the start of the next).
- Newsletters are added by hand today. If you want it hands-off, I can set
  up a GitHub Action that runs weekly, pulls that week's results, and drafts
  a newsletter automatically — just ask.
