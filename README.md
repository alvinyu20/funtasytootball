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
matchup results where available. Click any matchup to expand it and see
both teams' starting lineups (with each player's points) for that game.
The championship game gets a brighter gold outline so it stands out from
the rest of the bracket, and there's a sidebar next to the bracket showing
the champion and that game's Finals MVP (the winning team's
highest-scoring starter in the championship game itself). The 5th-place
game (if your league plays one) is left out of the bracket display and
out of Playoff Head-to-Head — "relevant" playoff games are only ones on
the genuine path to 1st or 3rd place, traced backward through Sleeper's
own bracket structure, so this adapts automatically to different bracket
sizes.

**History page champions** show the winning team's Sleeper username in
smaller, muted text right after the team name (skipped if they're the
same, so an unrenamed team doesn't show its name twice).

**Starting Lineup**, a dropdown next to Draft Picks on each season row in
Teams: whichever player filled each roster slot most often that season.
Slot assignment mirrors the Season page's scoring-by-slot table: QB pools
together dedicated-QB and SUPERFLEX-as-QB starts; RB/WR/TE each pool
their dedicated slot(s) with FLEX-as-that-position and SUPERFLEX-as-that-
position starts; FLEX and SUPERFLEX are decided last, from whoever's left
over once every other slot is claimed. "That season" means every regular-
season week, plus any playoff week that team was still alive for a top-3
finish — the 5th-place game and any games after elimination are excluded.
Each player is also tagged with how they were acquired that season —
Draft, Trade, Waivers, or Free Agency (falling back to "Roster" for
keeper/dynasty holdovers with no transaction that year). Note: Sleeper
sometimes logs an internal roster move (like activating someone off IR)
as a transaction that adds *and* drops the same player on the same roster
at once — those are explicitly ignored, so they don't wrongly overwrite a
drafted player's label. A player only counts as freshly re-acquired if
they were genuinely dropped by that roster at some point and later
actually added back.

**The scoring-by-slot table's heatmap** runs red (that column's worst) →
yellow (middle) → green (that column's best), scaled independently per
column same as before — just a different color scheme now.

**Season Extremes and the Top 5 Closest/Blowout lists** are tappable:
Highest Score and Lowest Score expand to show that one team's starting
lineup and each player's points for that week. The Top 5 lists expand to
show the full matchup — both teams' lineups — the same way playoff
bracket games do.

**Top 5 Priciest FAAB Pickups**, on each Season page (only shown for
seasons that actually used FAAB bidding — seasons that used plain waiver
priority instead simply won't have a bid amount to rank, so the section
stays hidden for those).

**Season Awards** — a manually-voted set of end-of-season awards (Best FA
Pickup, Worst Draft Pick, etc.) lives in `data/season-awards.json`, keyed
by year and category. Each Season page shows that year's winners if any
exist, and every manager's Teams page has a "Season Awards" trophy case
listing everything they've won. Only years that are also Sleeper-tracked
seasons on the site are shown — the data file can safely include years
further back than the site currently covers; those just won't render
until/unless that history gets added. A few winners from the data you
gave me (Trevor, Jeremy, Macklin, Chris — mostly 2017–2019) don't have a
Sleeper username on file, so they'll show as plain text without a link;
add them to the file's `winnerName`→`username` mapping if you want that
fixed. To add a new year, open the file and add a new entry under
`seasons` following the same shape.

**Overall Record and Luck**, shown on the Season page's Final Standings
and on each manager's Season By Season table on Teams: "Overall" is the
record a team would have if they'd played every other team every week
instead of just their actual schedule (their score compared against
everyone else's, each week) — **regular season only**, playoff weeks are
excluded from this calculation. "Luck" is their real win% minus that
Overall win%, so a team that keeps winning close games against weak
opponents while stronger teams beat each other up shows positive (green);
a team that's scoring well but running into buzzsaws every week shows
negative (red). The Total page's standings show the career version of
both, and adds a Top 5 Luckiest / Top 5 Unluckiest Seasons pair of lists
pulled from every individual team-season in the league's history.

**Championship / Runner-up / 3rd Place** are all tracked and shown on
Teams — 🏆, 🥈, and 🥉 respectively, both in the career summary and next
to each season in Season By Season. 3rd place comes from Sleeper's own
3rd-place bracket game where the league plays one.

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
