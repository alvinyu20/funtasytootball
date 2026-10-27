# Your League Site

A static site that pulls live standings, matchups, and history straight from
Sleeper's public API — no server, no database, no hosting bill.

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
- `records.html` / `js/records.js` — the Record Book: six categories
  (Careers, Seasons, Matchups, Players & Lineups, Streaks & Milestones,
  Front Office), each a list of records you can click open for its top 10,
  filterable by All seasons, Last 3 seasons, or any single season (see
  "Record Book" below)
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
To keep that fast (see "Fast First Load" below for the details):

- **Finished seasons come from the repo's own backup** (`data/sleeper-archive/`),
  not from Sleeper. One small same-origin file per season, all downloaded at once.
- **The current, in-progress season is always fetched live** from Sleeper, so
  scores, lineups and moves are as fresh as Sleeper's.
- **Player names and positions** come from a small file
  (`data/players-slim.json`), not Sleeper's 14 MB player directory.
- The Season page only fetches the ONE year you're viewing; Teams and Records
  need every season at once (for career totals), and the others use the same
  shared loading.

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
plus a separate table for playoff meetings only. "Playoff" here means
genuinely on the path to 1st or 3rd place — the 5th-place game, and any
other consolation-bracket game, are excluded, no matter how big or small
the league's bracket is.

Each Team Profile shows: **Overall Record** (Regular Season + Playoff
combined — this is what Win % is based on, not Sleeper's own win/loss
counter, since that one also counts any consolation-bracket games a team
played), **Regular Season record** and **Playoff record** separately,
**Championship Games** (career championship-game record, wins vs.
runner-up finishes), **Playoff Appearances**, **Byes** (first-round
playoff byes — detected directly from the bracket structure, works for
any bracket size), **Winning/Losing Seasons** (years finished above vs.
below .500), and **1st Pick** (number of times they've had the very
first pick of the draft).

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

**Rest-of-Season team strength** on the Home page's standings table
(the "ROS" column) is manually entered in `data/team-strength.json`,
since FantasyPros doesn't have a free, live API suitable for an ongoing
site like this one. Whenever you check FantasyPros' League Analyzer,
open that file (right on GitHub, no need to touch anything else) and
update each team's rank under their Sleeper username, plus the `asOf`
date. Teams with no entry just show "—" — exactly what you'll see before
the draft, when there's nothing to rank yet.

**Power Rank History**, on each Season page — a chart of every team's
Power Rank, Power Score (2024+), and Playoff Odds (2024+) week by week,
recovered from your old tracking spreadsheets and put in
`data/power-rank-csv-history.json`. Only shows up for years that have
data in that file (2019–2025 are the recovered years, with scores and
odds from 2021; the **current season is rebuilt by the Power Rankings
Update workflow whenever you push a new `data/team-strength.json`**, see
"Current-season Power Rank History" and "Power Rankings Run Only When You
Say So" below). Note: `Pathieu` (2021–2022) and `paty23`
(2023+) are two different people, both named Patrick — Pathieu left the
league and paty23 joined afterward — so they're kept as separate entries
in the data, not merged into one.

**2022 chart bug, fixed**: 2022 is the one year with no "Pre" (preseason)
value in its Power Rank data. That missing value was silently getting
treated as `0` by the charting code, which corrupted the Y-axis scale
for every chart on that season's page. Fixed at the source, and the
chart code itself is now hardened so a gap in any team's data breaks
that one line cleanly instead of skewing the whole chart.

**Mobile, round two**: the Playoff Bracket now stacks its rounds
vertically on narrow screens (round 1, then round 2, then the
championship, top to bottom) instead of requiring a horizontal scroll
through rounds. Final Standings now uses the same one-card-per-team
pattern as the other wide tables.

**Season page order**: Playoff Bracket now comes before Final Standings
on each Season page (the reverse of how it used to read).

**Top 5 Priciest FAAB Pickups Of All Time** now also appears on the
Total tab (Seasons page), merging every season's top 5 into one
all-time list, with the season shown alongside each entry.

**Chart colors**: the 10-team line charts (Power Rank/Score/Playoff Odds
History) use a color palette generated by spacing hues evenly around the
color wheel and deliberately interleaving the assignment order, so any
two teams that end up next to each other in the legend are always at
least 72° apart in hue — not just "10 colors that are technically
different," but 10 colors chosen so adjacent ones don't get confused for
each other.

**Mobile**: the widest tables (Position/Lineup Slot breakdown, Power
Rankings, and the Playoff Odds distribution) now collapse into one card
per team on narrow screens instead of requiring horizontal scrolling —
each stat shows as a labeled row within that team's card. Standings and
other narrower tables were left as-is; they already fit comfortably.

**Player Representative**, on each Team Profile — a headshot of whoever's
been on that team the most (the #1 entry from Most Rostered Players).
**Finals MVP photos** now show up in the Season page's playoff bracket
sidebar too. Both use Sleeper's player headshot CDN
(`sleepercdn.com/content/nfl/players/<id>.jpg`) — this isn't in Sleeper's
official docs, but it's a well-established, widely-used pattern (the
same one powering Player Cards in the Sleeper app). Since it's
undocumented and not every player has a photo (team defenses, for one),
any image that fails to load falls back to a simple initial-letter tile
instead of a broken-image icon.

## Bringing In the ESPN Era (2015–2019)

Added the league's pre-Sleeper history from a supplied CSV, plus
hand-entered playoff bracket results, across History, Teams, and
Season.

**A real data problem, caught before it corrupted anything.** The
CSV's column labeled "Gold(1), Silver(2), or Bronze (3)" doesn't
actually hold the medal — cross-checking every value against the
bracket results in the request showed that column is really a
"reached the finals" flag (both finalists show 1, regardless of who
won), and the true medal sits in a separate, unlabeled trailing
column the header row doesn't name at all. Verified this conclusion
directly against three independent known results before trusting it,
then confirmed all 5 seasons' medal winners match the given bracket
text exactly once corrected. Also resolved an apparent inconsistency
between the CSV's playoff win/loss columns and the bracket text before
writing any data: those columns only count championship-bracket games
(quarterfinal/semifinal/final), never the 3rd-place consolation game —
confirmed this against three separate cases (tduchow 2015, sofarrsogood
2016, hmart92 2016) where a team's bracket result only makes sense
under that reading.

**New shared engine**, `js/manual-history.js` — turns
`data/manual-history.json` into the exact shapes the site's existing
rendering code already expects (`renderBracket`'s input shape, and the
same per-season card shape `teams.js` already renders), so no second,
parallel UI needed to be built. The "only Sleeper-era users" rule
requested for Career Records and the Teams page falls out naturally
from *how* the merge is keyed — every Sleeper manager's own username is
looked up in the manual data, not the other way around, so a name that
only ever appears in the ESPN-era data (never continued into Sleeper)
has nothing to merge onto and is automatically excluded, with no
separate allow-list to maintain.

**History page** — Trophy Room and the Champions Ledger now link every
year, including the ESPN ones, to a real season page (previously
manual entries rendered as inert, unlinked cards, since no page existed
yet for them to link to). Career Records now folds in ESPN-era
totals for anyone who also played in the Sleeper era.

**Teams page** — Team Profile's career ticker and the Season-by-Season
card list both incorporate ESPN-era data for Sleeper-era managers,
interleaved in the same newest-first order as their Sleeper seasons.
Manual season cards correctly show empty (not broken) draft-pick and
starting-lineup sections, since no per-player data exists for these
years, and a fixed, honest "—" for the Luck stat rather than crashing
on it or showing a misleading 0.0% — there's no week-by-week data to
compute luck from for these seasons at all.

**Season page** — 2015–2019 now appear in the season picker,
interleaved with the live Sleeper years. Selecting one of them renders
a deliberately lighter view (final standings, then the playoff
bracket) instead of the full season pipeline, since no week-by-week
matchup, waiver, or draft data exists for these years to build that
richer view from. The bracket reuses `renderBracket()` completely
rather than a second implementation — quarterfinal and semifinal games
correctly show no score (not available in the source data), while the
3rd-place game and Finals (with its MVP) show full detail.

Caught and fixed a real UX bug surfaced by this reuse: every bracket
game shows a static "▾ tap for lineups" hint via CSS, regardless of
whether there's actually anything to expand — harmless for Sleeper
seasons where most games have lineup data, but every single game on
every ESPN-era season would have shown this misleading hint with
nothing behind it. Fixed by marking lineup-less games with a `.no-lineup`
class and suppressing the hint (and the pointer cursor) for them
specifically.

**Testing.** Two real vm-testing gotchas surfaced and got documented in
the test harness itself for whoever writes the next test here: reading
a `let`-declared page-controller variable (like `season.js`'s own
`SEASON_CHAIN`) from outside the vm context doesn't work the same way
reading a file's `const` export does — needed a second harness helper,
`runInLoadedContext`, to set it correctly, by running an assignment as
code inside the same context rather than as a property write from
outside. And `assert.deepStrictEqual` on a whole object built by code
running inside the vm will report a false failure ("same structure but
not reference-equal") against a plain object literal in the test file,
since they belong to different JS realms with different `Object`/`Array`
prototypes — fixed by asserting on individual primitive fields instead.

46 tests total now. Beyond the new engine and season-view tests, this
work was checked well beyond unit tests: rendered the actual Teams and
History pages in a real browser with real, hand-verified merged data
(a fake Sleeper season merged with yulovesyou's real 5 years of ESPN
history) and confirmed every displayed number — 63-27 overall, 70.0%
win rate, 10-2 playoff record, 8,534.8 career points, 4 championships —
against independent hand arithmetic, not just that the page rendered
without error.

## Automated Regression Tests, and Automating the Injuries Pipeline

Two things requested together, both about making "this keeps working
correctly" less dependent on remembering to check by hand.

**A real, checked-in test suite** in `tests/`, run via `npm test`
(plain `node --test tests/*.test.js` underneath — Node's own built-in
test runner, so this adds zero dependencies). 31 tests across 6 files,
covering the areas that have needed the most careful, hard-won
debugging over the life of this project: the waiver value algorithm
(drop detection, the pickup-week roster-snapshot timing gap, duration
weighting vs. one hot week, position-relative scoring, injury exclusion,
non-standard transaction types, trades correctly excluded), draft
grading (zero-point players, the K/DEF cap, the games-played cap),
chart rendering (label collision avoidance, leader detection in both
directions, rank mode), the new archive-first fetch/fallback logic, and
the injury pipeline's CSV parser.

Getting the test *infrastructure* itself right surfaced a real, easy-to
-miss JavaScript gotcha worth documenting: this site's `js/*.js` files
are plain global `<script>`-tag files with no module system (by
design — no build step), so testing them for real means loading the
actual, unmodified files rather than a hand-copied duplicate of their
logic that could quietly drift out of sync. That's done via Node's
`vm` module, running each file's real source in a shared context —
mirroring how a browser shares one global scope (`window`) across
multiple `<script>` tags. First attempt at this seemed to work
(`escapeHtml` loaded and ran fine) but `DeepHistory`, `Charts`, and
`SleeperAPI` all came back `undefined` from outside the vm context.
The cause: top-level `function` and `var` declarations become
properties of the global object automatically (same as they would on
`window` in a browser) — but top-level `const`/`let` don't. They live
in an internal "script scope" that's invisible from outside the vm
entirely, which is exactly how all three of those are declared. Fixed
by explicitly promoting each file's known top-level export onto the
global object right after loading it — confirmed the fix with a
minimal, isolated repro before trusting it in the real harness.

Didn't just assume the tests were meaningful — proved it, twice.
Deliberately reverted the duration-weighting fix (`relativeValue =
relativeValuePerWeek * activeWeeksCount` back to just
`relativeValuePerWeek`) and confirmed exactly one test failed while the
other six in that file correctly stayed green; then separately broke
the CSV parser's quote-handling and confirmed exactly the three
quote-related tests failed while the rest of the parser's tests stayed
correctly isolated and unaffected. A test suite that can't fail isn't
proof of anything — this is what actually being confident in it looks
like.

Wired to `.github/workflows/tests.yml`, running automatically on every
push and pull request (plus on demand), so a change that breaks
something gets caught right when it's made.

**The injuries pipeline is now automated the same way the Sleeper
backup already was** — previously a manual, easy-to-forget refresh,
now `scripts/update-injuries.js` plus
`.github/workflows/update-injuries.yml` (weekly, Tuesdays, timed for
after the injury-report cycle following Monday Night Football).
Rebuilds `data/injuries.json` from nflverse's public weekly injury
reports and weekly roster data (for IR/PUP/NFI status via a `RES`
roster designation), cross-referenced to Sleeper player IDs — nflverse's
own roster data conveniently includes a `sleeper_id` mapping directly,
used first, with the DynastyProcess ID crosswalk as a fallback only for
whatever that doesn't cover.

Unlike the Sleeper backup script, this one's data sources (nflverse and
DynastyProcess, both distributed via GitHub) are actually reachable
from this environment, so this wasn't verified against a mock — it was
run for real, against real data, right here: 1,492 players resolved
across 2015–2026, the roster file's own Sleeper ID mapping alone
covered roughly 93% of real 2023 injury/RES rows on its own, and the
DynastyProcess fallback resolved the specific remaining case checked by
hand. The hand-rolled CSV parser (no dependency, so no `csv-parse`
package) was checked against Python's own `csv` module on that same
real data and produced an identical row count on a file where naive
newline-splitting would have silently miscounted rows, since some
fields contain embedded newlines inside quotes.

Confirmed the new `data/injuries.json`'s shape lines up exactly with
what `DeepHistory.extractInjuriesForSeason` already expects
(`players[sleeperId].weeks[season][week]`) by reading that function's
real code side by side with the pipeline's output — this needed no
changes to the site's own consuming code at all, only to how the file
gets produced.

## History, Teams & Draft Grade Refinements

**History page — Career Records rebuilt.** "Career Record" is now
**Regular Season Record**, with a genuine **Playoff Record** column
alongside it, plus a combined **Win %**. Getting this right required
switching the page to reuse `computeStats`'s already-correct data
instead of the page's own lighter-weight aggregation — the old approach
couldn't reliably tell a genuine playoff game apart from a regular
season game or a consolation-bracket game, since Sleeper's raw
`roster.settings.wins/losses` lumps all of those together. This also let
championship counting get simpler and more robust: `computeStats` tracks
it by matching roster IDs within each season directly, not by
cross-season name matching, so the earlier rename-losing-a-championship
class of bug can't happen here at all. Verified with a synthetic 4-team
league with a real bracket — regular season and playoff records came
back cleanly separated and correct.

**Teams page — "All Managers" replaced with a picker.** Every manager is
now a clickable pill in the header, same pattern as the season-year
picker on the Season page. No one is shown by default — just a "pick a
manager" prompt until you choose someone.

**Draft grades now use a genuine gradient.** Instead of 5 discrete color
bands, each of the 7 possible grades (A+ through F) gets its own
computed color along a smooth green → yellow → red spectrum, so a B+ and
a B actually look different rather than sharing a color.

**Draft grades for players who scored zero points, fixed.** A drafted
player who never appeared in a single matchup all season (e.g. hurt all
year) previously fell through a gap: there was no way to compute their
VBD, so they got no grade at all instead of the F they deserve. Fixed at
the source — scoring exactly zero points is now graded F outright,
regardless of whether a VBD or a grading curve could be computed for
them. Verified with a real drafted-but-never-played player through the
full pipeline.

**Teams page's Season By Season table, fixed for mobile.** This table
was missing the `responsive-stack` treatment every other table on the
site already uses, so it was rendering cramped on phones instead of as
readable stacked cards. It also has an unusual shape — two table rows
per season (the stat line, then an expandable row for lineup/draft-pick
details) — so the standard treatment needed a small adaptation: the two
rows now visually join into one card instead of stacking as two separate
boxes, and the `<details>`/`<summary>` content renders as normal text
instead of being awkwardly squeezed into the usual label/value row
format.

## Wiring the Backup Into the Live Site

Explicitly flagged last time as "worth a separate conversation" rather
than bundled in — this is that conversation. In direct answer to "any
other performance/risk considerations," the single highest-value one
was staring right at the backup that had just been built: it was
sitting in the repo, but the live site never actually read from it,
so it provided zero runtime benefit and zero actual resilience.

**`fetchSeasonDeep` now checks three places, in order, for a completed
season**: the browser's own `localStorage` cache (unchanged, still
fastest when present), then this site's own `data/sleeper-archive/`
backup, and only then falls back to a live, many-request fetch from
Sleeper. This one change addresses several things that were raised as
risks together, not separately:

- **Resilience** — a completed season now renders correctly even if
  Sleeper's API is down, slow, or rate-limiting, as long as it's been
  backed up.
- **Performance** — a same-origin static file replaces what was
  previously up to dozens of sequential live API calls (one per week's
  matchups, one per week's transactions, plus the draft) for every
  completed season, every time the cache was empty.
- **A real, growing risk that hadn't been called out before**: every
  completed season's full raw data was accumulating in `localStorage`
  indefinitely, and browsers cap that at a few MB per origin. As this
  league adds more seasons, that cap was on a real, if slow, collision
  course with itself — eventually caching would silently start
  failing (the existing code already catches that error gracefully,
  but the practical effect would have been every visit quietly
  reverting to a full live fetch again, right as the league's history
  — and thus the live-fetch cost — kept growing). Archive-sourced
  seasons are deliberately *not* cached in `localStorage` at all now,
  since a fast static file doesn't need it — freeing that quota
  entirely for whatever hasn't been backed up yet.

Applied the identical pattern to `SleeperAPI.getPlayerDirectory()` —
if the live 5MB player fetch fails, it now falls back to this site's
own archived copy rather than taking down the whole site's ability to
render anything at all.

Both changes were resolved as a genuine question, not assumed: does
the archive-sourced data actually match the shape every downstream
consumer (`computeStats`, grades, VBD, everything) expects? Verified
directly in a real browser with real `fetch()` calls against a local
server, not just reasoned through — confirmed the archive path
produces the identical `{leagueId, season, weeks, scheduleWeeks,
transactions, draft}` shape the live-fetch path always has, including
correctly re-deriving which weeks actually have a score versus which
are just pre-generated future schedule shells; confirmed a season with
no archive file yet correctly falls through to the live-fetch path
rather than silently returning nothing; and confirmed the player
directory fallback engages correctly when Sleeper is genuinely
unreachable.

The progress messages users see while a page loads now distinguish
"loaded from cache," "loaded from backup," and "fetching" — applied
consistently across all seven pages that show this message, not left
inconsistent between them.

## Sleeper Data Backup: Insurance Against the API Disappearing

A direct question worth a direct, honest answer: yes, this site pulls
everything live from Sleeper's public API, from every visitor's own
browser, on every page load — confirmed by re-reading `js/sleeper-api.js`
rather than going from memory. There is no server and no database.
The only "storage" that exists is `localStorage`, which is per-browser
and per-device (completed seasons get cached there so repeat visits
don't re-fetch a decade of history, but that cache means nothing to
anyone who clears their browser data or opens the site somewhere new)
— and Sleeper's own servers, which are the *only* place any of this
data actually lives in any durable sense. If Sleeper's public API ever
goes away, changes shape, or this league becomes inaccessible on
Sleeper's platform for any reason, every draft grade, every waiver
pickup, every season's worth of matchup history this site has ever
shown becomes unrecoverable, all at once. That's a real, structural
risk, not a hypothetical one — it's just been invisible because
nothing has gone wrong yet.

Built a real answer, not just a description of the problem: a
[`scripts/backup-sleeper-data.js`](scripts/backup-sleeper-data.js)
script that walks this league's full season history (the exact same
`previous_league_id` chain the live site itself walks) and saves the
raw API responses — rosters, users, every week's matchups, every
week's transactions, the draft and its picks, the bracket — as JSON
files in `data/sleeper-archive/`, plus the player ID directory needed
to make any of it readable later. Wired to a GitHub Actions workflow
([`.github/workflows/backup-sleeper-data.yml`](.github/workflows/backup-sleeper-data.yml))
that runs it automatically every week and commits whatever changed —
once this is deployed, it requires no ongoing manual effort at all, and
because it's a normal part of the git repo, the *commit history* of
this folder is itself a running backup, not just the latest snapshot.

**A limitation worth being direct about**: this sandbox's network
access doesn't reach Sleeper's API domain, so the backup script's
actual execution has never touched real Sleeper data — it's been
verified end to end (season-chain walking in the correct oldest-to-
newest order, per-season fetching, the file output structure, the
skip-completed-seasons logic, and fail-fast behavior on an unreachable
API or bad league ID) against a local mock server built specifically
to mimic Sleeper's real response shapes, not against Sleeper itself.
The mock testing gives real confidence in the script's *logic*; it
can't substitute for the script's first real run. GitHub Actions runs
on infrastructure with ordinary internet access, so this isn't a
problem once it's deployed and runs for real — but that first real run
is genuinely the first time this code will have touched live Sleeper
data, and is worth checking once it happens (either by waiting for the
Monday schedule, or triggering it immediately via "Run workflow" on
the repo's Actions tab).

One thing to check if the automated commit step ever fails: repos
sometimes default their Actions permissions to read-only, which would
block the workflow's `git push`. The workflow requests write access
itself (`permissions: contents: write`), which is normally sufficient
— but if commits aren't showing up, check Settings → Actions →
General → Workflow permissions on the repo.

Also caught and fixed one real bug along the way: YAML parses a bare,
unquoted `on:` key as the boolean `true` rather than the string "on"
under YAML 1.1 rules — a well-known trap specifically for GitHub
Actions files. GitHub's own parser handles this correctly in practice,
but since that can't be verified against GitHub's live infrastructure
from here, quoted it explicitly (`"on":`) to remove the ambiguity
entirely rather than relying on it being fine.

This backup is intentionally *not* wired into the live site itself —
the site still always talks to Sleeper directly, exactly as before.
That's a deliberate scope decision, not an oversight: whether the site
should also read from these backups (as a fallback if Sleeper's API is
down, or even as the primary source for old completed seasons, which
would also make those pages load faster) is a real product decision
with real tradeoffs, worth a separate conversation rather than being
bundled into "can we back this up."

## Toot Effect: Fixed Overlap With the Wordmark

The redesigned toot's wavy lines ran out to x=230 in the SVG's own
coordinate space, but the wordmark text starts at x=222 — so the tail
end of the middle wave was rendering directly behind the "F", not just
visually close to it. Confirmed this precisely (not just by eye) by
temporarily overlaying a marker line at the text's actual x-position
before making any change, then compressed the whole toot horizontally
so it now ends around x=212, leaving genuine clear space before the
text rather than a tight-but-technically-fine gap. Reverified at both
full and mobile-realistic scale, then once more directly in the actual
rendered `index.html`, same as every other pass on this logo.

## Toot Effect Redesign

The original toot was three plain curved lines — functional, but read
more like generic motion/speed lines than an actual cartoon toot.
Redesigned with the same visual-iteration workflow as the logo itself
(render, look, adjust, rather than guess at coordinates blind): a
small cluster of soft overlapping "puff" circles right at the exit
point, feeding into three wavy, dissipating lines that fan out and
lose coherence as they travel — the standard cartoon-gas visual
language, distinct from straight speed lines. Verified at both full
size and a small mobile-realistic scale before touching the real site,
then re-verified once more directly in the actual rendered `index.html`
to confirm the integrated version matches the approved design exactly.

## Home Page Mascot Logo, Newsletter Spacing Fix

**New mascot logo** replacing the plain "FUNTASY TOOTBALL" text on the
Home page hero specifically — not the nav bar brand, which every other
page still uses unchanged. A hand-built inline SVG: a football with a
recognizably football-like pointed tip (laces, two bright cartoon
eyes) whose other end becomes a cartoon butt (two rounded cheeks, a
crack line, subtle light/dark shading for dimension), with a few small
motion-line "toots" trailing behind it, next to a two-line wordmark
("FUNTASY" / "TOOTBALL") in the site's own display font and color
tokens. Wider than it is tall on purpose, per the request, so it reads
as a proper wide banner lockup rather than a small icon.

Built and refined through direct visual iteration rather than guessing
at SVG coordinates blind: found an available headless Chromium binary
already in the sandbox, rendered each draft, and actually looked at
the screenshots before deciding what to change. First draft's football
body read as a shapeless blob and had a single stray-looking eye;
second pass fixed the silhouette with sharper pointed-tip curves and
added a second eye; confirmed the final version holds up at both a
full desktop size and a small mobile-realistic size before it ever
touched the real site.

Accessibility-conscious implementation: the page's actual `<h1>`
(which `dashboard.js` already populates with the real league name from
Sleeper) is kept in the DOM and still gets that text set exactly as
before — just visually hidden via a standard clip-based
`.visually-hidden` utility, with the new logo, marked
`aria-hidden="true"`, standing in visually alongside it. Screen readers
and search engines still see a normal, meaningful heading; sighted
users see the mascot. Verified the final integration by screenshotting
the actual rendered `index.html` (not just the standalone logo file) at
both desktop and mobile widths, confirming zero horizontal overflow at
mobile width and that the SVG's responsive sizing behaves correctly
inside the real scoreboard panel.

**Newsletter callout spacing fixed.** `.scoreboard` has zero bottom
margin by design (`margin: 28px auto 0`), and the immediately
following container had zero top margin either — so there was
genuinely no gap at all between the hero and the newsletter callout
below it, not just a visually-tight one. Added `margin-top: 36px` to
the callout itself, matching the site's own established spacing
convention for "the element right after the scoreboard" (the same
36px already used by `.yard-divider` on every other page), rather than
picking an arbitrary new number. Verified with a direct screenshot of
the real rendered spacing, with the (sandbox-only, network-related)
error banner hidden to match what production actually shows once
Sleeper's API is reachable.

## Bracket Side-By-Side, Attempt Three: Verified in an Actual Browser

Two rounds of fixes for this same bug had each looked correct on
careful reading and still didn't work on the real device — reasoning
about CSS cascade and flex mechanics by hand had reached its limit.
This time, verified against a real Chromium engine instead of
continuing to guess: found an available `chrome-headless-shell` binary
in the sandbox, drove it via Puppeteer, and rendered the actual bracket
markup at the exact 390px viewport width from the reported screenshot.

That surfaced the real, definitive chain of causes:

1. First measurement showed `.bracket` itself collapsing to roughly
   half its expected width. Cause: `.bracket-wrap` has
   `align-items: flex-start` from the desktop rule, never overridden on
   mobile — once `flex-direction` switches to `column`, `align-items`
   governs the *horizontal* axis, and `flex-start` means children
   shrink-to-fit instead of stretching to fill the available width.
   Fixed by adding `align-items: stretch` to the mobile override.

2. After that, each game card still rendered at full width (100% of
   its now-correctly-sized parent) instead of ~50%. A targeted
   ancestor-chain measurement, then a check of literally every CSS rule
   in the stylesheet that matches these elements (queried directly via
   `document.styleSheets`, to rule out a rule I might be missing on a
   read-through), showed the actual cause: the mobile `.bracket-round`
   override sets `display: flex` and `flex-wrap: wrap`, but never
   resets `flex-direction` — so the desktop rule's
   `flex-direction: column` was cascading straight through. With the
   main axis still vertical, `flex-basis` was controlling each item's
   *height*, not width, and wrapping never triggered at all since
   height is unbounded. Fixed with an explicit `flex-direction: row`
   in the mobile override.

Verified end to end this time, not just reasoned through: two-game
rounds now share the same `top` and sit at different `left` positions
(confirmed genuinely side by side, not just narrower), a single-game
round still correctly expands to fill its row, the desktop layout
(1024px viewport) is byte-for-byte unaffected, every real username from
the reported screenshot — including the longest, "JoeSifBoreDough" —
fits without needing its truncation fallback to even engage, and the
full page has zero horizontal overflow at mobile width.

## Bracket Side-By-Side: The Real Bug

The grid-based fix from the previous round looked structurally sound
on re-inspection — correct selector, correct specificity, correctly
ordered after the desktop rule — but didn't actually work, per a
screenshot showing quarterfinal and semifinal matchups still stacked.

Found the real cause: `.bracket-team` (and by extension its ancestors,
`<summary>` and the game's `<details>`) is a flex container, and flex
items default to `min-width: auto`, which means they refuse to shrink
below their own content's natural width unless explicitly told
otherwise. A long username like "evangonnerman" or "JoeSifBoreDough"
(both visible in the reported screenshot) was silently keeping that
whole nested chain wide enough that two could never actually sit side
by side — regardless of whether the grid track math around them was
correct, which it was. This is exactly why the ellipsis truncation
added on the team name in the previous round never visibly did
anything either: text-overflow can't engage until its container is
actually permitted to shrink smaller than the text in the first place.

Fixed two ways at once: switched from grid `auto-fit` to an explicit
flex-wrap layout with a forced `flex: 1 1 calc(50% - 5px)` basis (more
predictable than relying on `auto-fit`'s implicit column-count
computation), and set `min-width: 0` through the *entire* nested chain
— details, summary, `.bracket-team`, and the name span itself — not
just at the top level. A single game (the Championship) still grows
via `flex-grow` to fill its row when there's no sibling to share space
with.

## Career Records, Draft Replay Removal, Bracket Mobile Layout, Season Card Redesign

**Career Records (History page)** now uses the same compact-mobile
treatment as Final Standings and the lineup-slot heatmap from the
previous round — stays a real, scrollable table on mobile instead of
stacking into cards.

**Draft Replay removed entirely.** The board simply shows every pick
immediately now, which was already effectively the default state
after the last round of fixes anyway. Removed the four replay
functions, three state variables, the `data-pick-no` attribute nothing
else used, and the now-dead CSS (hidden/on-clock/pop-in states, two
keyframe animations) — kept the unrelated S-grade pulse. Verified zero
dangling references to any of it afterward.

**Playoff Bracket: matchups sit side by side on mobile instead of
stacked.** `.bracket-round` switched from a flex column to
`grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))` — a
2-game round (like a semifinal) naturally lands two per row, and a
1-game round (the Championship) just as naturally expands to fill the
row, with no special-casing needed for either case. Verified the
actual width math across five real device widths rather than eyeballing
it: comfortably fits two columns from 360px up, with a single-column
fallback only on the narrowest 320px devices. The "no horizontal
scroll" requirement turned out to already be satisfied by existing
code — traced this down before touching anything, so the actual fix
here is narrowly the side-by-side layout, not a rewrite of behavior
that was already correct.

**Teams page Season By Season redesigned as cards, not patched for
mobile.** Concluded a mobile CSS tweak was the wrong tool here: each
season is a stat summary plus two nested expandable dropdowns
(starting lineup, draft picks) — genuinely closer to "one self-
contained card" than to tabular data meant for cross-row comparison,
which is what the compact-mobile treatment is built for. Replaced the
table (and the two-`<tr>`-per-season structure it required to fit an
expandable row) with a proper card list: a compact responsive stat
grid up top, feeding into the same two dropdowns, functionally
unchanged. Applies at every screen size, not just mobile, since the
card format is a better fit for this specific data regardless of
viewport. Tested against realistic data including edge cases —
champion badge, no badge, empty draft/lineup states — and confirmed
the dropdown animation logic (which targets `<details>` generically)
needed no changes to keep working. Cleaned up the CSS that existed
specifically to make the old two-row table structure behave on mobile,
since none of it is needed anymore.

## Layout Round: Draft Width, Nav Drawer, Mobile-Compact Tables, Header Font

**Draft board no longer needs horizontal scroll on desktop.** Added a
new `.wrap-wide` container (up to 1600px, scales with viewport) used
specifically for the draft board, plus a modest cell width reduction.
Verified with actual arithmetic, not just "looks about right": a
10-team board needs roughly 1103px, which comfortably fits even a
fairly modest 1280px-wide browser window with real margin to spare.

**Top nav rebuilt as a hamburger + slide-out drawer**, replacing the
horizontal link list on every page — with ten sections now, the nav's
own centered max-width meant it would stay cramped at *any* browser
window size, not just on mobile, so a responsive breakpoint wouldn't
have actually fixed it. Required restructuring the nav markup on all
ten pages; did this via a script rather than by hand specifically to
guarantee every page kept its own correct "active" link through the
transformation, and verified this directly afterward rather than
assuming the script worked. New `js/nav.js` (small, dependency-free,
loaded on every page) handles the toggle; verified the full
interaction lifecycle directly — opens on click, closes on second
click, closes on backdrop click, and closes on nav-link click (this
last one matters even for links, since Season and Draft switch content
via URL hash without a real page reload).

**Final Standings and the lineup-slot heatmap no longer eat a screen's
worth of vertical space on mobile.** Both previously used the site's
existing "stack every row into a tall card" mobile pattern, which is
great for avoiding horizontal scroll but genuinely expensive
vertically for a many-column table — a 10-team, 9-column standings
table was turning into roughly ten stacked cards, each several rows
tall. Built an alternative treatment (`compact-mobile` /
`stay-scrollable`) that keeps these two tables as compact, real
tables that scroll horizontally instead, at a smaller mobile-specific
font/padding — trading a bit of horizontal scroll for a lot less
vertical scroll, which is the right trade for a table this wide.
Scoped narrowly on purpose: Power Rankings, Rivalries, and Teams'
Season-By-Season table all still use the original stacking behavior,
since only these two specific tables were flagged.

**Header font swapped from Anton to Oswald.** The earlier
color-softening pass wasn't enough because the real issue wasn't
color — Anton only ships in one very heavy weight, so there was no
lighter version to soften into. Oswald keeps the same condensed,
sporty character but has real weight options; landed on 600 (semi-
bold) via one shared `--font-display-weight` variable, applied
consistently across all 18 header usages site-wide, rather than
tuning each individually.

## Duration-Weighted Waiver Value, and Capping K/DEF Draft Grades

**The position-relative redesign had a real flaw**: a pure per-week
rate, with no weight for how long it was sustained, let a single hot
week from a Week 14 pickup outrank a whole season of solid, steady
production — exactly backwards from "a pickup should matter more the
longer they actually contributed." It also explains a symptom that
had been reported: a 5th-place entry sitting at +0.0, most likely a
tiny, noisy sample that got lucky enough to edge out sustained
performers for a spot in the list.

Fixed by making the ranking metric **cumulative** rather than a bare
rate: the per-week z-score multiplied by how many weeks it was
sustained for. This isn't an ad-hoc tweak — summing each individual
week's own z-score against the position average is mathematically
identical to (rate × weeks), since both the average and the spread
being divided into are constants. Verified directly with the scenario
this was built to fix: a player at a modest, sustained rate for 13
weeks against a one-week outlier at a much hotter rate — the one-week
spike has the higher *per-week* number, exactly as expected, but the
sustained performer now wins on the *cumulative* score that actually
determines the ranking. Display updated to show both the cumulative
score and the underlying rate-vs-position-average with a weeks count,
so the reasoning behind a ranking is visible, not just the final
number.

**Draft grades for K/DEF are now capped at B.** Reusing the exact
pattern already established for the "unavailable most of the season"
cap rather than inventing a new mechanism: K/DEF get pooled into the
same pick-number model as every skill position for simplicity, but
their real VBD distribution is much narrower — a modestly-above-
expectation kicker or defense can post a residual that looks S/A-
worthy against a model shaped mostly by skill positions, even though
neither position is especially differentiated or draft-relevant.
Verified directly: a K and a DEF with the same strong z-score (0.94,
which would ordinarily land solidly in A territory) both correctly cap
at B, while a WR with an even stronger z-score in the same test is
completely unaffected and still reaches S. Applied to both places a
pick gets graded — the shared computation the new Draft page reads
from, and the Season page's separate Best-Steal/Biggest-Bust
computation — so the cap is consistent everywhere grades appear.

## Waiver Value Redesign: Position-Relative Instead of Raw Points

With real 2023 numbers in hand (194.15 total points, 18.4 in Week 1,
never dropped, WR4 overall in raw points that season) the math checked
out — the previous Top 5 (QB, RB, QB, TE, RB, zero WRs) wasn't a bug,
it was raw points-above-replacement structurally favoring
high-scoring positions in a SuperFlex league, where the replacement-
level QB still puts up bigger raw numbers than an excellent WR simply
because QBs score more per game across the board.

Redesigned the metric to rank pickups by **standard deviations above
the mean points-per-game for their own position**, among that season's
starter-caliber pool, instead of raw points above a replacement floor.
This is what makes a dominant WR season and a hot streaming-QB week
comparable on the same scale — each pickup is judged against the
spread of players at their own position, not against everyone
regardless of position.

Implementation: extracted the shared starter-pool simulation (the
greedy slot-fill that both the old replacement-level function and the
new one depend on) into one helper, so `computeReplacementLevels`
(still used by draft grades) and the new `computePositionValueStats`
are guaranteed to agree on who counts as a "starter" at each position,
rather than risking two separate simulations drifting apart over time.
`computeReplacementLevels` itself is completely unchanged behaviorally
— verified directly that `computeVBD` (draft grades) still produces
identical output through the refactored code path.

Verified the core claim with a realistic SuperFlex test: a dominant
WR at 13.5 PPG (matching the real Week 2–14 rate) against a solid-but-
unspectacular streaming QB at 20 PPG in a stacked 12-QB pool — despite
the QB's raw PPG being 6.5 points higher, the WR's z-score comes out
higher, because 13.5 is further above a tight WR average than 20 is
above a wide QB average. Also reconfirmed the active-weeks window
mechanics (drop detection, injury exclusion, pickup-week exemption)
are completely untouched by this change and still work correctly —
only the final ranking metric changed, not how a pickup's counted
weeks are determined.

Display updated to show the z-score (e.g. "+2.1σ") as the primary
number, with the pickup's own PPG and their position's average PPG
shown alongside for context, and the panel's description text rewritten
to explain the new methodology in plain terms.

## Draft Page Follow-Ups

**Fixed the actual root cause of the board looking hidden/cut off**:
the replay feature defaulted to `revealedCount = 0` on page load,
meaning the board started completely hidden every time — which is
almost certainly what read as "cut off." Changed the default to fully
revealed (replay is opt-in, not the default view) and added a "Show
All" button for jumping back to that state after using replay.

**Found and fixed the real "right side cut off" bug**: `.draft-board`
had `width: 100%`, which forces a table to compress its columns to fit
the container rather than expand to its natural content width — this
meant the table could never actually exceed its wrapper, so the
wrapper's `overflow-x: auto` never had anything to scroll. Switched to
`width: max-content; min-width: 100%`, which lets the table grow past
its container when there are enough columns, correctly triggering
horizontal scroll instead of compressing/clipping.

**S grade is now visibly a tier above A**, not the same treatment:
thicker glow with actual blur (not just an outline), a star badge, and
a slow pulse, versus A's original modest ring. Caught and fixed a real
interaction bug in the process — the glow was initially still visible
through `.draft-cell-hidden` during replay, which would have spoiled
an upcoming pick's grade before it was actually revealed.

## New Draft Page, Third Nacua Investigation, Header Readability

**New Draft page** (`draft.html` / `js/draft.js`), added to the nav on
every page. Shows the full draft board for any season, color-coded by
position (a left-border accent per cell, using the site's existing
`--pos-*` position colors) and highlighting every S/A-grade pick with a
gold glow. Reuses `computeStats`' already-tested per-manager draft
pick data rather than a new computation — grades, positions, and VBD
all come from the same league-wide model already used on
Records/Teams. Columns are fixed per team by their Round 1 draft slot
(not by "who's on the clock this round"), which is what makes a snake
draft actually readable as a grid — verified directly with a 4-team
snake-draft test confirming Round 2's reversal correctly lands each
team's pick in their own column instead of scrambling positions.

**Animated draft replay**, also on the new Draft page — matches the
existing play/pause-button-plus-slider convention from the Season
page's "Standings Over Time" replay rather than inventing a new
pattern. Steps or auto-plays through the draft pick by pick in actual
order; each newly-revealed pick pops in, and the next slot to be
filled pulses gold with an "on the clock" indicator. Tested the
core reveal-tracking and labeling logic directly (which picks are
visible at a given step, what the label says at the start / midway /
after the last pick) before touching any rendering.

**A third round on the Puka Nacua investigation.** New specifics this
time — a concrete external VBD reference point, and confirmation he
was picked up after Week 1 and never dropped — ruled out both earlier
fixes as the cause (nothing to drop, and the pickup-week exemption
already covers a Week 2 add). Extensive re-review of the value-added
math itself, including `computeReplacementLevels` line by line, didn't
turn up a bug there. What it did turn up: the transaction filter only
ever accepted `tx.type === "waiver"` or `"free_agent"` — but Sleeper
has other transaction types too (e.g. a commissioner manually
processing a late or disputed claim), and any of those still
represents a genuine pickup. If this specific transaction used a
different type label, it would've been silently skipped entirely, not
just ranked low. Broadened the filter to accept any non-trade
transaction, and switched the FAAB-vs-free-agent distinction to key off
whether a bid amount is actually present rather than the exact type
label, which is more robust. Verified against the exact unusual-type
scenario, confirmed trades are still correctly excluded, and
reconfirmed the earlier Kyren Williams fix still holds.

Being direct about the limits here: this is a real, verified gap, and
it may or may not be the full explanation for this specific case —
without live access to this league's actual 2023 transaction data,
that can't be confirmed with certainty. If the issue persists after
this, the most useful thing to check would be the exact transaction
type Sleeper recorded for that specific pickup.

**Header readability.** Softened the two most common header styles
site-wide — `.scoreboard-title` (every page's main title) and
`.panel h2` (used in essentially every section) — from full-bright
chalk to a new, slightly muted intermediate tone, plus both newsletter
headers. Worth flagging: the display font (Anton) only ships in one
very heavy weight, so literal "unbolding" via `font-weight` isn't
actually possible without switching fonts entirely — this addresses
the readability complaint by softening brightness/contrast instead,
which is a related but different fix from true unbolding.

## Tier 2 Motion & Interactivity, Plus Dropdowns Everywhere

**Every dropdown on the site now animates**, not just the ones on the
Season page. There turned out to be four different expandable patterns
across the codebase (injury rows, bracket games, expandable record
cards, and Teams page's draft-pick/lineup details — which had never
been wired up for animation at all). Rather than hardcode each one's
specific class name, the logic was generalized to work on *any*
`<details>` element, finding its content generically as "whatever
comes right after `<summary>`" — more robust, and automatically covers
any dropdown added later without needing to update a class list.
Verified all four real structures resolve correctly, including the
tricky edge case of a bracket game with no lineup data at all (nothing
after the summary to animate — left with its native, un-animated
toggle rather than crashing).

**Bump chart for Power Rankings.** Rather than a separate chart type,
`multiLineChart` gained a `rankMode` option — Y positions become
evenly-spaced integer rank slots (a gridline at literally every rank,
not just three fractional reference lines) with larger "node" dots,
while reusing all the tested end-label and leader-highlight logic from
Tier 1. Verified rank 1 correctly lands at the very top, and — just as
importantly — confirmed the *existing* non-rank-mode charts (Score
History, Playoff Odds) are completely unaffected by the change.

**Linked hover across every multi-line chart.** Hovering a line, one of
its dots, or its end label dims every other series in the chart and
emphasizes that one — the specific "linked small multiples" technique
from NYT's own graphics work, since every line already shares one set
of axes. Tagged every line, dot, and label with a shared `data-series`
attribute, and added invisible wider "hover-catcher" paths so a thin
line is actually easy to point at. Built with event delegation
specifically to avoid a flicker bug reasoned through in advance —
moving the pointer between two elements of the same line (say, the
hover-catcher path and one of its own dots) doesn't toggle the
highlight off and back on.

**Scroll-triggered section reveals for the Season Summary.** Each
top-level section fades and slides gently into place as it's scrolled
to, rather than the whole long page just being "there" on load —
turning a wall of stats into something closer to being told to you
section by section. Scoped specifically to the Season page's own
content container, not applied globally, so it can't accidentally
affect unrelated panels elsewhere.

**A real correctness issue caught along the way**: the Power Rank tabs
toggle chart panels via `display:none`, and a `display:none` toggle
isn't reliably treated the same as "scrolled into view" by
`IntersectionObserver` across browsers — so a chart on a newly-selected
tab might never trigger its own draw-in animation. Fixed by directly
re-triggering the draw-in on every tab switch instead of leaving it to
chance, rather than shipping something that might silently not work in
some browsers.

**One bug in my own work, caught and fixed before shipping**: an early
edit meant to be a no-op accidentally left a duplicate, misplaced copy
of the hover-linking function in `animations.js`. Caught via careful
review before this went out — removed the duplicate, verified every
function in the file now appears exactly once.

## Tier 1 Motion & Interactivity — Charts, Numbers, Dropdowns

The first pass on the design proposal's Tier 1 list, grounded in the
actual NYT graphics-team principles researched for that proposal (not
generic "add animation" trend-chasing): a visible annotation layer
instead of hidden tooltips, direct labeling over legends, and motion
used with real purpose.

**Multi-line charts (Power Rank By Week, Score History, Playoff Odds)
now label lines directly instead of using a separate legend below the
chart.** Straight from Archie Tse's own rule as NYT's Graphics
Director — a legend the reader has to cross-reference gets skipped; a
label sitting right at the end of the line doesn't. Labels use a
standard collision-avoidance pass (sorted top to bottom, pushed apart
wherever two lines would otherwise end close enough to overlap — tested
directly: three teams ending within 0.2 of each other still land at
least 13px apart) and truncate long names with an ellipsis. The current
leader (lowest value for rank-style data, highest for percentage-style
data like playoff odds — verified correct for both) gets a bolder line
and a star-marked label, so the single most important fact in the chart
is visible by default, not something you have to hover to find.

**Charts draw themselves in on scroll.** Line charts measure their own
real SVG path length (`getTotalLength()`) and reveal via a
stroke-dashoffset animation rather than a faked/approximated length; bar
charts grow via a CSS custom property (`--bar-w`) set by the existing
server-side template, so the JS side only has to toggle one class rather
than know each bar's target width. Both automatically respect
`prefers-reduced-motion` — the CSS-driven versions inherit the site's
existing global rule that disables all transitions, verified via the
control-flow logic directly.

**Headline numbers count up when scrolled into view** — Records page
cards, the Home page's Top Score / Closest Game, and Teams page career
stats (the simple ones; record-style stats like "10-4" were deliberately
left alone, since only the leading number would animate and the rest
would look inconsistent). Built a small parser that splits rendered text
into prefix/number/suffix so "$33", "+119.0 pts", and "1,532.4" all
animate correctly while non-numeric content like a player's name is
safely left untouched — tested against 12 cases covering every format
actually used on the site, all passing.

**Dropdowns (injury/FAAB/waiver detail rows) animate open and closed**
instead of snapping instantly, via a measured max-height transition —
covers both the native `<details>` pattern and the custom JS-toggle
pattern the FAAB rows use. Explicitly checks for reduced-motion
preference and skips straight to the final state rather than risking a
wait on a `transitionend` event that a disabled transition would never
fire.

Wired into every page that has the relevant content: Season (all four:
charts, dropdowns, count-up), Records (count-up), Home (count-up), and
Teams (count-up).

## Waiver Value: A Second Bug, Found From Specific Details

The details provided — waiver pickup at $33, never dropped, started as
part of the regular lineup — ruled out the drop-detection fix above as
the cause and pointed at something more precise: this exact profile
(never dropped, so nothing should be capping the window early) still
wasn't showing up. Re-examining the drop-detection check with that in
mind found it: the check ran starting on the **pickup week itself**,
comparing the transaction's recorded roster against that week's own
weekly-matchup roster snapshot. If those two data points have any
timing mismatch on the very first week — plausible, since waiver
processing and a week's matchup roster snapshot aren't necessarily
generated at the identical moment — the check would immediately break
on its first iteration, before counting a single week, silently
dropping an entirely legitimate pickup from the list altogether. That
matches the actual symptom exactly: not a low ranking, but complete
absence, despite being a real, productive, never-dropped starter.

Fixed by trusting the transaction record for the pickup week itself
(the transaction data already confirms the add happened that week — no
need to double-check it against a snapshot that might lag by a cycle),
and only requiring the roster-match check for weeks *after* the pickup,
which is both when a genuine later drop actually needs detecting and
when the snapshot has had time to catch up. Verified by reproducing the
exact reported scenario — a waiver pickup with a same-week roster
snapshot gap, never dropped, elite every week after — and confirming
the entry now appears with the correct full window and value. Also
re-confirmed both earlier fixes (drop detection, injury exclusion)
still work correctly alongside this one.

## Waiver Value: A Real Over-Crediting Bug

Investigating a specific report — Kyren Williams correctly made the Top
5 after the last fix, but Puka Nacua (2023) still didn't, despite being
one of the most dominant fantasy WRs of that season — surfaced a
genuine, separate bug: the "value added" window ran from a pickup
straight through to the end of the season *regardless of whether the
manager who made the pickup still had the player*. A manager who added
a player and dropped them a week later was getting credited for
everything that player did afterward on someone else's roster — exactly
backwards, and it can crowd a legitimately correct entry (from whoever
actually carried the player through their big stretch) out of the Top 5
with an inflated, bogus one.

Fixed by tracking who actually rostered the player each week and
stopping a pickup's counted window the moment that specific manager no
longer has them (dropped or traded away) — not just running to the end
of the season on autopilot. Verified directly: a synthetic case with a
player added by one manager for 2 weeks, dropped, then added by a
second manager who kept them for the rest of a dominant season — the
first manager's entry now correctly caps at 2 weeks instead of
claiming credit for all 14, and the second manager's entry correctly
reflects only the weeks they actually had the player. Confirmed this
coexists correctly with the injury-exclusion fix from before.

Worth being direct about: this is a real, meaningful bug and the fix is
verified to work correctly — but without live access to this league's
actual 2023 transaction history, it can't be confirmed with certainty
that this fully explains Puka Nacua's specific case, only that this
class of bug is now fixed. If he still doesn't show up correctly after
this, the most useful next step would be checking the actual week he
was added, whether he was ever dropped and re-added, and by whom.

## Waiver Value Algorithm Redesign + Home Page Newsletter Link

**Best Waiver Pickups, redesigned around a specific report.** The
original version had the same flaw the draft-grade fix solved earlier
in the project, just in a different spot: it summed a pickup's raw
points across the *entire* pickup-to-end-of-season window, so a player
who missed time within that window (injury, bye weeks) had their total
dragged down even if their per-game rate when actually playing was
elite — exactly the 2023 Kyren Williams pattern (an early-season ankle
injury, then a dominant stretch once healthy) that prompted this fix.
Redesigned to count only weeks the player actually played fully (not
significantly injured, using the same injury data as everywhere else on
the site), compared against replacement level for that *same* number of
weeks rather than the full window. Verified with a synthetic version of
exactly this pattern: a pickup injured for 3 weeks then elite for 11
straight now correctly ranks above a merely-solid, never-injured
alternative — and confirmed the fix is precisely targeted, since a
never-injured pickup's value is completely unchanged by it. Also now
excludes DEF/K from consideration entirely, and the same fix was wired
into the Total (all-time) view's internal computation, not just the
per-season one.

**Latest newsletter link added to the Home Page**, near the top, right
below the title — a small callout card linking straight to the most
recent issue. Renders nothing (not an empty box) if there are no
newsletters yet.

## Third Round: Attribution Bug, Season Page Reorganization, Waiver Value

**A real injury-attribution bug, found and fixed.** A specific report —
Malik Nabers missing from hmart92's injury list despite being drafted
and started early — traced to a gap the last round's fix didn't cover:
if a manager drops a player the *same week* an injury is first flagged
(a very common pattern — an injury often happens mid-game, and a
manager can cut the player before the next weekly snapshot), the
"first injured week" lookup finds nobody rostering them that exact week
and silently drops the attribution entirely. Fixed by searching
backward from the first injured week for the most recent actual owner.
Reproduced the exact scenario, confirmed the fix, and additionally
verified a genuine trade correctly attributes to the new owner rather
than the original drafter. One related edge case is a known,
accepted limitation rather than a fix: if a player gets hurt, fully
recovers, then gets hurt *again* later under different ownership, the
whole season still attributes to the first owner — a much rarer
combination of events than what was reported.

**Expand indicator added.** Every expandable row (injury dropdown,
FAAB competing bids, waiver value pickups) now shows a small arrow that
rotates when opened, so it's clear the row is tappable.

**Season page reorganized**, per specific feedback on redundant or
misplaced charts:
- "League Average Score By Week" is now Total-only — a single season's
  own weekly trend wasn't especially useful on its own.
- "Average Score Per Week" (the per-team bar chart) is gone entirely;
  that data is now a column directly in the Final Standings table
  instead of a separate chart. This needed care since the Total view
  and per-season view key their team data differently (a stable user ID
  across all seasons vs. a roster ID specific to one season) — verified
  the join works correctly for both.
- Power Rank By Week / Power Score History / Playoff Odds History are
  now one tabbed panel instead of three simultaneous charts, and a
  season only gets tabs for data it actually has (an older season with
  only rank data tracked shows just the one tab, not two empty ones).

**FAAB pickups now show competing bids.** Sleeper returns losing waiver
bids too, not just the winner — this data was already being fetched
and simply discarded at the point of use. Recovered it: every FAAB
pickup with other bidders that week is now expandable to show who else
was bidding and for how much.

**New: Top 5 Best Waiver Pickups by value added.** A genuinely
different question from "priciest FAAB pickup" — this ranks by how
much a pickup actually turned out to be *worth*, cheap or free
included. Reuses the same replacement-level idea as VBD elsewhere on
the site (points above what a replacement-level player at that
position would provide), windowed to "from the week they were picked
up through the end of the regular season" rather than the whole season,
so a Week 12 pickup is judged over the weeks they actually had. Shows
the waiver price and competing bids, or "Free Agent" if there was no
bidding at all. Verified with a deliberately adversarial test case: a
free pickup that became a league-winner correctly outranks an
expensive bust, with both values checked against hand calculations.

**One real bug caught and fixed along the way**: the first version of
both the FAAB-competing-bids and waiver-value expandable rows used
`<details>/<summary>`, matching the pattern used for the injury
dropdown — but `<summary>` can't legally contain the block-level `<div>`
the player-photo helper returns, which the HTML validator caught
immediately. Rather than risk modifying that widely-shared function,
rebuilt both as a plain clickable row with a small JS toggle instead,
and confirmed zero validation errors as a result.

## Injury Detail Dropdown, Pick Number Format, and Grade Overhaul

**Injury Luck now shows the individual players behind each team's
number.** Every team in the season's Injury Luck ranking is now
expandable — click it to see exactly which players cost them points and
how much each one did, with photos. A team with zero injury impact
doesn't get a pointless empty dropdown; only teams with at least one
significant injury are expandable.

**Draft picks display as "round.pick" now** — "Rd 2, Pick 17" is "2.7"
in a 10-team league. Computed from the pick's position within its own
round (`overallPick − (round−1) × teamCount`), so the format adapts
automatically if league size changes across seasons — verified against
the exact 10-team, pick 17, round 2 → "2.7" example.

**Draft Pick Grades were substantially reworked** — see the dedicated
section below for the full picture: a new S/A/B/C/D/F scale (no
pluses) verified to produce a real bell curve where B+C together make
up the majority, plus a fix so injuries no longer unfairly tank a
grade while still capping the top grades for anyone who wasn't
available for most of the season.

## Second Round of Fixes + First Newsletter

**Injury Luck attribution, fixed.** A real gap: if a manager drops an
injured player (very common — nobody wants a dead roster spot), the old
logic looked up the roster owner separately for *each* injured week,
so weeks after the drop went either unattributed or, worse, credited to
whoever (if anyone) picked up an already-injured player afterward. Now
the whole injury stint is attributed once, to whoever had the player
rostered when the injury began — dropping them afterward doesn't let a
manager off the hook for the loss, since they're the one who took the
injury risk in the first place. Verified against the exact scenario
reported: a player drafted, injured, and dropped mid-injury — the
team-level total now correctly matches the player's full loss across
every injured week, not just the ones before the drop.

**A real mobile CSS bug, found and fixed.** "Everything narrower than
The Locker Room" had a precise cause: `.wrap`'s padding plus `.panel`'s
own padding were stacking to ~42px of horizontal inset on mobile, while
`.scoreboard` (which has no wrapping container at all) sits at just 18px
with its box touching the screen edges directly. That's the whole gap —
one section had padding stacked two layers deep, the other didn't have
a second layer to stack. Trimmed `.wrap`, `.section-grid`, and `.panel`'s
mobile padding so panel boxes now land close to the same edge position
as the scoreboard, on every page, not just Teams (these are shared,
site-wide classes).

**First real newsletter issue** — a Preseason hype piece, added at
`data/newsletters.json`. Leans on what's genuinely new on the site this
year (VBD, Draft Grades, Injury Luck) as a fun hook, and keeps anything
about specific managers framed as open questions rather than claims
about real outcomes that haven't happened yet — the site can tell you
who actually had the best draft once the season's underway; a preseason
hype piece shouldn't try to guess for them.

## Follow-up Fixes

**Injury Luck — a real gap in the data, found and fixed.** Two notable
2025 injuries (Joe Burrow, Malik Nabers) were missing from the Top 5
list, which turned out to be a genuine flaw in the original data source,
not a fluke. The weekly injury report only tracks "will this player play
the *upcoming* game" — once a player is placed on injured reserve for an
extended stretch, the report stops generating new rows for them
entirely, since there's no week-to-week game-status decision left to
report. Traced this against both players' real 2025 data and confirmed
it directly: Nabers' actual season-ending injury never once produced an
"Out"/"Doubtful" row, and Burrow's showed only 2 weeks of "Out" despite
being out for far longer.

The fix: a second nflverse dataset (`weekly_rosters`) tracks each
player's actual roster status per week, including a `RES`
(Reserve/IR/PUP/NFI) designation — a direct, reliable signal for "this
player wasn't available," independent of the weekly report's
limitations. Rebuilt the full 11-year pipeline to union both signals
(weekly injury report *and* roster status), verified directly against
real data that Burrow now correctly shows weeks 3–12 and Nabers weeks
5–18, and reinstalled the corrected `data/injuries.json` (now 285KB,
still a lightweight periodic-refresh file like the rest of `data/*.json`).

**Injury Luck is now regular-season only.** Both the "healthy weeks"
baseline and the injured-weeks point total stop at the season's playoff
cutoff — fixed at the source in `computeInjuryLuck`, plus the same fix
in the model-fitting step so the underlying expected-PPG curve itself is
built from regular-season production only. Tested a case with an injury
window deliberately straddling the regular season/playoff boundary to
confirm only the regular-season weeks count.

**A real mobile layout bug, found and fixed.** The empty space some
sections showed on mobile turned out to be a genuine CSS bug, not a
vague inconsistency: `.trophy-grid` used `auto-fill` instead of
`auto-fit` in its grid sizing, which reserves invisible empty column
tracks even when there's no content for them — so a leftover single card
on the last row would render at half-width with dead space beside it
rather than expanding to fill it. `.recap-players` (the Season MVP /
Draft Steal / Draft Bust card row) had the same underlying problem via a
different mechanism — a hardcoded fixed width on a flex child, which
doesn't grow to fill space the way a proper grid column does. Both are
now `auto-fit` grids matching the pattern already used correctly
elsewhere on the site (`.records-grid`), so a lone card now expands to
fill its row instead of leaving a visible gap.

**Smaller cleanups**: removed the redundant "🏆 Award" badge from the
Season Awards list on the Teams page (the section header already makes
it obvious), and removed the grade badge specifically from Best Draft
Steal / Biggest Draft Bust in the Season tab — since those are, by
definition, the most extreme picks in either direction, the grade is
essentially always A+/F and doesn't add information there (still shown
everywhere else, like the Records page and the Teams page draft-pick
history, where it genuinely varies).

## Injury Luck — a new external data source, brought in responsibly

Every completed season now has an **Injury Luck** section: the top 5
most significant individual player injuries, and a full team ranking by
how many points each roster lost to injury (worst luck first). The Total
tab shows the all-time top 5 injuries and the top 5 single-season
injury-luck outcomes across league history.

**Where the data comes from.** Unlike everything else on the site, this
needed data Sleeper doesn't have — Sleeper only exposes a player's
*current* injury status, not a historical record. After confirming that
(and separately confirming Pro-Football-Reference's terms of service
explicitly prohibit this kind of use), the actual source is
[nflverse](https://github.com/nflverse/nflverse-data) — a real,
actively-maintained, CC-BY 4.0 licensed open dataset with weekly injury
reports back to 2009. This isn't secondhand — the pipeline was verified
by actually downloading real files: real 2015–2025 injury reports,
cross-referenced to real Sleeper player IDs via the DynastyProcess ID
crosswalk (100% match rate after narrowing to skill positions), filtered
to "Out"/"Doubtful" designations (the statuses that reliably mean a
player didn't play, unlike "Questionable" which usually still suits up),
and condensed into a 121KB `data/injuries.json`. This is a periodic
manual refresh like the other `data/*.json` files, not a live feed —
re-run the pipeline occasionally to pick up the current season.

**How "points lost" is calculated.** The interesting part: a player hurt
in Week 1 has no track record yet, so naively using "their own average"
would be meaningless off a tiny (or zero) sample. This uses shrinkage —
blending the player's own healthy-week average with a baseline,
weighted by how many healthy games they'd actually logged:

```
expectedPPG = (gamesPlayed × ownAvg + k × baselinePPG) / (gamesPlayed + k)
```

A player hurt in Week 1 (zero healthy games) gets a pure-baseline
expectation; a player hurt in Week 12 after 10 strong healthy games is
judged almost entirely on their own established level. `k` (currently 4)
controls how many games of "trust the baseline" that represents. The
baseline itself reuses the same idea as the Draft Grade curve — expected
value decays log-linearly with draft position — but fit **per position**
on raw points per game rather than VBD, since a 1st-round QB and a
1st-round RB have very different expected point totals even at similar
draft-relative value. Undrafted pickups (waiver adds, trade
acquisitions) are treated as a very late "pick" for baseline purposes —
a low starting assumption that gets overridden fast by their own
production once they have any games logged.

For each week a player was significantly injured, "points lost" is
`max(0, expectedPPG − actualPoints)` — so a player who was on the injury
report but still played well that week correctly contributes zero,
rather than being counted as a loss. Verified this whole pipeline with
tests built specifically to stress the tricky cases: a truly-zero-games
early injury judged purely on baseline (checked against a hand
calculation), a late-season injury judged on the player's own real
level, a "hurt but still balled out" week correctly excluded, and an
undrafted player still gradable via the fallback.

## Draft Pick Grades — a bell curve, fit from your own draft history

Every draft pick with a computed VBD gets a letter grade (**S, A, B, C,
D, F** — no pluses), shown as a small colored badge wherever a pick is
displayed: the Records page, and every pick in a manager's
season-by-season draft history on the Teams page. (Not shown on the
Season Summary's Best Draft Steal / Biggest Draft Bust specifically —
those are, by definition, the most extreme picks in either direction,
so the grade there is basically always S/F and doesn't add information.)

**How it works:** a pick's raw VBD alone isn't quite fair — a 1st-round
pick and a 14th-round pick shouldn't be held to the same bar. So the
grade is based on how a pick's VBD compares to what *that pick slot*
should reasonably produce:

1. **Fit an expected-VBD curve from the league's own draft history.**
   Every graded pick ever made (any season, any manager) feeds a
   log-linear regression: `expected VBD = intercept + slope × ln(pick
   number)`. This is the standard shape for "value by draft position" —
   value drops fast in the first round or two, then levels out — and
   fitting it from your own history means it reflects your league's
   actual scoring and roster settings automatically, the same way VBD
   itself does. Uses overall pick number rather than round, so it stays
   meaningful even across seasons where the league size changed.
2. **Grade by z-score.** For each pick, the gap between its actual VBD
   and the curve's expectation at that slot is measured in standard
   deviations of the historical residuals — z ≥ +1.5 → S, +0.75 → A,
   0 → B, -0.75 → C, -1.5 → D, below that → F. Computed the actual
   normal-distribution percentages for these cutoffs before picking
   them: S and F are rare (~6.7% each), while B and C together make up
   ~55% — a genuine majority, matching the request that "most grades
   will be Bs and Cs."

**Injuries don't punish a grade — but being unavailable still caps it.**
A player hurt in Week 1 shouldn't be graded on a season of zeros just
because they never got the chance to play. Grading uses each player's
own *healthy-week* average, prorated across the full regular season,
rather than their raw total — so the grade reflects how good they
actually were when they played, not how many games the injury cost
them. But that cuts both ways: a great per-game rate in a tiny sample
still can't claim the top grades. If a player was healthy for less than
half the regular season, their grade is capped at B regardless of how
elite their rate was in the games they did play — being genuinely
available matters, not just being good when healthy. (A player who
scored zero points all season is still an automatic F either way —
there's no "healthy rate" to credit if they never played at all.)

Verified this against realistic scenarios built specifically to stress
it: a player who was excellent for a few games before a season-ending
injury correctly avoided the F/D their raw total would've implied, and
correctly landed at the B cap rather than S/A. A player with only a
minor injury who was otherwise available all season correctly still
reached S, uncapped. Also checked the grade distribution against 2,000
simulated picks with normally-distributed outcomes: the resulting split
matched the theoretical bell-curve percentages almost exactly.

Needs a reasonable amount of draft history to fit a meaningful curve —
if there isn't enough yet, picks simply show without a grade rather
than guessing from too little data.

## Value Based Drafting (VBD) — self-computed, no external data source

The site now computes a genuine **Value Based Drafting** score for every
player, every season — points scored above "replacement level" (what a
team could get for free off the wire) at that player's position. This is
what actually lets a QB's 300 points and a WR's 180 points get compared
fairly: raw points always favor QBs, since they score more no matter how
replaceable they are in a given league.

**No external data source, and no hardcoded assumptions about your
league's settings.** Earlier research looked at pulling VBD from
Pro-Football-Reference, but their terms of service explicitly prohibit
automated access, and even if they didn't, a static GitHub Pages site
can't fetch cross-origin from a site with no public API anyway. The
better path turned out to be self-contained: your own Sleeper data
already has every rostered player's points *computed under your league's
actual scoring rules that season* — that's the only real ingredient VBD
needs.

**How replacement level is determined — adaptively, every season:**
`DeepHistory.computeReplacementLevels()` simulates who'd actually win a
starting lineup slot leaguewide that year, greedily filling every team's
required slots (dedicated positions first, then FLEX, then SUPER_FLEX —
reusing the exact same slot-eligibility map the bench-points optimizer
already uses) with whoever's most valuable at the margin. Replacement
level at a position is the weakest player who still won a starting slot.
Since this runs fresh against `league.roster_positions` and the team
count for *that specific season*, it automatically adapts if your league
adds SUPER_FLEX, goes TE Premium, changes roster size, or anything else
— nothing about the algorithm is hardcoded to one year's settings.
Verified with tests confirming the exact same player pool produces
different (and correct) replacement levels when roster settings change,
and that scoring changes like a TE Premium bonus shift VBD accordingly
with zero code changes needed.

**The one real limitation, same as before:** this only knows about
players who were actually rostered somewhere in your league that season
— not the full NFL universe. For grading trades and draft picks between
your own managers, that's rarely a real gap; you don't need to know
about a player nobody in your league ever touched.

**Where VBD shows up:**
- **Best Draft Steal / Biggest Draft Bust** — now ranked by VBD instead
  of raw points, on the Season Summary, the Records page, and the
  Season page's Draft Standouts (for in-progress seasons and the Total
  tab). Verified this fixes exactly the scenario it was built for: a
  late-round QB with *more* raw points than a late-round WR, where QB is
  a deep position and WR is scarce — raw points picks the QB, VBD
  correctly picks the WR.
- **Trade History** — every traded player shows their VBD for that
  season, so a trade's value is visible in hindsight (a note on the page
  clarifies this is the player's whole-season value, not a snapshot from
  the moment of the trade — computing true point-in-time value would need
  data this site doesn't have).
- **Teams page draft picks** — every draft pick in a manager's
  season-by-season history now shows its VBD alongside raw points.

There were two separate, nearly-identical computations of best/worst
draft value already in the codebase (the same duplication that caused
the earlier player-photo bug) — both were updated to VBD consistently
this time, rather than fixing one and letting them diverge again.

## Bug Fixes & Mobile Polish

**Best Draft Steal / Biggest Draft Bust photos, fixed.** There turned out
to be two separate, nearly-identical computations of these stats in the
codebase — one feeding the Records page (fixed a while back), and a
second, separate one specifically feeding the Season Summary that never
got the same fix. That second one is what was actually showing on the
Season Summary, which is why the photos never worked there even though
the underlying logic looked right at a glance. Also hardened
`playerPhotoHtml()` itself so a missing player ID never even attempts to
load a broken image URL in the first place.

**Playoff Picture removed from the Home page** — its dashed cutoff line
now lives directly in the Standings table instead, as a divider row
between the last playoff team and the first team out. Caught a genuine
CSS specificity bug while wiring this up (the table's own default cell
styling would have silently overridden the dashed-line styling) and
fixed it with a properly-scoped selector.

**Season Awards winner names** now display at a normal text size — they
were previously using the same oversized "big stat number" styling as
things like point totals and dollar amounts, which looks fine for a
number but oversized for a username.

**Mobile text sizes reduced broadly** — the site's larger display-font
elements (scoreboard title, record card values, rivalry/trophy text,
table cells, matchup cards, and several others) are noticeably smaller
below 720px now, so more fits on screen without feeling like a wall of
oversized headlines. This is a `body`-level base size drop plus targeted
reductions on the specific elements that were the worst offenders, not a
uniform scale-everything-down approach — different components were
intentionally reduced by different amounts based on how oversized they
actually looked.

## Player Photos, Everywhere Sensible

Player headshots now show up in several more places: **Top 5 Priciest
FAAB Pickups**, **Best By Position**, **Trade History** (every player on
both sides of a trade), and **Season Awards**. Draft Standouts (Season
Points Leader, Best Draft Steal, Biggest Draft Bust) moved out of their
own section and into the **Season Summary** at the top of the page —
with photos — for completed seasons; in-progress seasons and the Total
tab still show them in their old spot, since Season Summary only applies
once a champion's been crowned. The Season Summary section is now also
resilient to the champion recap failing to compute (e.g. missing bracket
data) — the draft/points cards still show up instead of the whole
section disappearing.

Season Awards is the one that needed real work: the data only ever
stored a player's *name* as free text (e.g. "Todd Gurley, 16th"), never
an ID, so there's no direct link to a photo. A small matching step
normalizes both sides (strips punctuation, strips a trailing draft-pick
suffix) and looks for an exact match in the player directory — enough to
correctly handle things like "Jaxon Smith Njigba" matching "Jaxon
Smith-Njigba" despite the missing hyphen. If there's no confident match
(team defenses, name typos, players not in Sleeper's directory), the
award still displays normally, just without a photo — a wrong guess
would be worse than no photo at all, so it never guesses.

## Season Summary

**Always uses usernames**, not custom Sleeper team names — the champion,
runner-up, and every name in the "Records Set This Season" list. The
Records page and Trade History keep showing team names where they
already did (that wasn't part of what was asked to change), but every
record that can feed a Season Summary highlight now also carries the
matching username alongside it, so the Summary never has to guess.

**The wording varies year to year** — both the playoff-run sentence and
the MVP sentence are pulled from a small pool of phrasings, chosen by a
deterministic hash of that season's data. Same season always reads the
same way on repeat visits (not re-randomized on every page load), but
different seasons naturally land on different phrasing.

**Career Records championship count, fixed**: this was matching a
season's champion back to a manager by comparing team-name *strings* —
if someone renamed their team between two championship seasons, only
one of those titles would get counted. It's keyed by Sleeper's stable
user ID now, so a rename between title runs can't drop a championship.
Verified with a test reproducing exactly that scenario (same manager,
different team name, two separate championship seasons) — both titles
now count. The Career Records table also switched to usernames.

At the top of every **completed** season's page — a short, high-level
recap of the champion's run, with no scores or matchup-by-matchup
detail: their regular-season record and seed, a plain-language sentence
about their playoff run ("ran the table through a 3-round playoff
bracket, capping it off with a win over X in the Championship"), and one
highlighted player — the **Season MVP**, whoever scored the most points
on the champion's roster across the *entire* season (not just the
playoffs). If that player was actually drafted by the same team, it says
so ("a Round 4 pick who was the engine behind it all"), tying the story
back to the draft; otherwise it just credits them as the team's top
performer. Only a player photo is shown here — no team/manager avatars.

Below that, a **"Records Set This Season"** list — any of the site's
all-time records (highest-scoring regular season ever, highest single
week, biggest blowout, best/worst draft pick, and several others) that
happened to be set in the specific season being viewed, naming the
contributing player where there is one (e.g. "JoeSifBoreDough put up the
highest-scoring regular season in league history, powered by Player X").
This section only appears when something was actually set that year —
most seasons won't show it.

Checking "was a record set this season" needs the *whole* league's
history, not just the one season being viewed, so this triggers one
extra one-time fetch of every other season (only for completed seasons,
since that's the only time this section shows) — cached for the rest of
the visit, so switching between completed seasons after the first one is
instant.

This is composed from the season's own data — record, points, draft
picks — not written by an AI. There's no live model call in this static
site, so think of it as a structured recap built from real numbers
rather than free-form prose.

## Home Page

Six new sections, all live/computed — nothing manual to maintain:

- **Featured Matchup** — the week's game between the two teams with the
  best combined win total, shown prominently above the standings.
- **Power Rankings** snapshot — top 3 from the real Power Rankings
  algorithm (same Monte Carlo engine as the full page), with the same
  week-over-week movement arrows, linking through to the full page.
- **Playoff Picture** — current standings with a dashed line at the
  actual playoff cutoff (from the league's own `playoff_teams` setting),
  so who's in and who's out is obvious at a glance.
- **Hot & Cold** — win/loss streaks of 2+ games, computed from this
  season's finished weeks.
- **Recent Activity** — the last several trades and adds (waiver or free
  agent), pulled from this week's and last week's transactions.
- ~~From The Archives~~ — a daily callout from `season-awards.json`. It was
  removed from Home (the awards file still feeds the Season and Teams pages).

Streaks and the Power Rankings snapshot need this season's full weekly
history, which the Home page didn't fetch before — it now pulls the
current season's data the same way the Season and Power Rankings pages
do, but only that one season (not all of league history), and this
fetch runs *after* the fast stuff (standings, matchups, playoff picture)
is already on screen, so the page doesn't feel slower to load overall.

## Trade History, Rivalries, Trophy Room & Standings Replay

**Trade History** (`trades.html`) — every trade in league history,
newest first, with a season filter. Each side of a trade shows exactly
what they gave up and received: players (with position shown in muted
text next to each name), draft picks, and FAAB, parsed straight from
Sleeper's trade transaction data. Multi-team trades are supported (any
number of sides, not just 2).

**Rivalries** (`rivalries.html`) — pick any two managers to see their
full head-to-head history: series record (including a separate playoff
record if they've met in the postseason), the closest and most lopsided
meeting between just the two of them, and a complete game-by-game log.
Shareable — the URL updates as you pick managers (`#userIdA-vs-userIdB`),
so a specific matchup can be bookmarked or sent to someone.

**Trophy Room**, at the top of the History page — a visual grid of every
champion with their Sleeper avatar (or an initial-letter tile for
pre-Sleeper manual entries, which don't have one). Click a card to jump
to that season's page. The site also now guards, both at the data-fetch
layer and in the Trophy Room specifically, against an un-replaced
`data/manual-history.json` template entry (one still saying
"REPLACE_WITH...") ever rendering on the live site.

**Standings Over Time**, on each Season page — an animated replay of the
regular-season standings, week by week: rank, team, and record, with
rows sliding smoothly into their new position as the standings change.
A dashed line marks that season's actual playoff cutoff (pulled from the
league's own `playoff_teams` setting), so you can watch teams cross in
and out of a playoff spot in real time. Press play and watch it unfold,
or scrub the slider to jump to any week directly. Playoff weeks
themselves are excluded from the replay, since "climbing the standings"
stops making sense once the bracket takes over. Needs at least 2 weeks
of regular-season data to show up.

**Strength of Schedule**, as a new "SOS" column on each Season page's
Final Standings — each team's average regular-season opponent score,
right alongside Record/PF/PA/Overall/Luck (not shown on the Total tab,
since a single-season "toughness" number doesn't carry over meaningfully
across years). This reuses the same regular-season-only computation as
the Records-page Toughest/Easiest Schedule cards — fixed those, too,
while wiring this up: they were previously (incorrectly) including
playoff matchups in the average, which don't really represent "schedule"
in the usual sense.

## Points Left on Bench, Consistency & Strength of Schedule

Three new Records categories, all computed from data the site already
has — no new manual input needed:

- **Biggest Bench Blunder** / **Career Bench Waste** — for every
  team-week, the site solves for the highest-scoring *legal* lineup that
  could have been set from the full roster (bench included), and
  compares it to what was actually started. The single worst week ever
  shows on Records; each manager's running career total shows too. The
  solver fills the most restrictive slots first (dedicated QB/RB/WR/TE/
  K/DEF), then FLEX, then SUPER_FLEX — the correct approach for this
  kind of nested slot-eligibility problem, and it works for any
  roster_positions layout, not just one specific league format.
- **Mr. Reliable** / **Feast Or Famine** — the most and least consistent
  single-season scoring performances, by weekly-score standard
  deviation.
- **Toughest/Easiest Schedule** — the highest and lowest average
  opponent score faced across a single season. (That number is exactly
  Points Against per game, which is also what Home's and Seasons' "SOS"
  column shows. For the current season, the Power Rankings page now has a
  truer version; see "Strength of Schedule, Weekly Scores, Lineup Slots and
  a Yellow/Blue Color Scheme" below.)

## Power Rankings

`power-rankings.html` / `js/power-rankings.js` — a weekly composite
ranking ported from your Python/Colab script, generalized to work with
any number of teams (not just 10). It combines, into one weighted "PR
Score" (lower is better): actual record, all-play "Overall" record,
scoring average, simulated playoff odds, and ROS rank — same weights as
your script (4/4/5/3/4). Also included: Luck Rank, scoring std-dev,
boom/bust counts, and a full Monte Carlo playoff-odds breakdown (1,000
simulated seasons, using your ROS power score to seed each team's
simulated scoring range) showing the probability of finishing in every
possible final position, not just make/miss playoffs.

**`data/team-strength.json`** now stores a `pt` (power score, ~0-100)
alongside `rank` for each team — the Monte Carlo sim needs it as a
FantasyPros League Analyzer shows both.

**`data/power-rank-history.json`** tracks weekly snapshots so the page
can show week-over-week movement (the Δ column). There's no backend to
auto-save this the way your Colab script wrote to a CSV, so the page
prints a ready-to-paste JSON snippet each week — add it to the file (or
ask Claude to) and next week's Δ will populate.

A few things I changed while porting, worth knowing about:
- **`current_week` is no longer manual input** — the site figures out how
  many weeks have actually been played by checking for real scores, so
  there's nothing to update by hand each week.
- **Boom/bust and the position-scoring pieces reuse this site's existing
  (more careful) lineup-slot logic** rather than the original script's
  hardcoded slot indices — notably, SUPERFLEX is only treated as a second
  QB when it's actually a QB that week, not assumed by position.
- **Playoff/bye team counts come from your league's own settings**
  (`playoff_teams`), not hardcoded to 6/2 — this is what makes it work
  whether you're at 10 teams or 12.
- While in here, I also fixed a subtle data issue that affects every page
  on the site: Sleeper generates each season's full schedule upfront, so
  the matchups endpoint isn't empty for future weeks — it just has no
  score yet. The site now explicitly checks for real scores to tell
  "played" from "scheduled," which is what makes the Monte Carlo sim's
  remaining schedule possible, and doubles as a safety fix for every
  other weekly stat on the site.

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

## Record Book

The Records page is a landing page with six categories. Click one for its
list of records (record, record holder, record value), click a record to
open its top 10, and use the season pills at the top to switch between
**All seasons**, **Last 3 seasons**, or one season. The address bar follows
along (`records.html#careers/last3`, `#front-office/2024`), so any view can
be bookmarked or shared.

How it's built:

- `js/record-defs.js` is the list of records — title, description,
  section, number format, and the one small function that produces each
  record's ranked rows. Adding a record means adding an entry there.
- `js/record-book.js` is the engine. It first boils the league down to
  plain "facts" (one row per manager-season, per manager-week, per game,
  per roster move, per draft pick...), narrows them to the selected
  season range, and ranks each record's rows into a top 10 (ties share a
  rank and are called out).
- `js/records.js` draws the landing, category and row views.

Conventions worth knowing:

- **Careers and Seasons include the pre-Sleeper (ESPN, 2015–19) years**
  from `data/manual-history.json`, and those years get their own season
  pills. That era only has season totals, so it feeds the records totals
  can answer (wins, points, playoffs, titles, and Overall Record where it
  was kept — 2017 on). Records built on weekly scores (high-score weeks,
  schedule strength, vs-the-median...) and the other four categories
  (Matchups, Players & Lineups, Streaks & Milestones, Front Office) are
  Sleeper era (2020+) only. The switch is the `history: true` flag on a
  category in `record-book.js`.
- Career records add up every season in the range; season records only
  use seasons whose regular season is finished; rate-style career records
  (win %, efficiency...) need at least three seasons in the range (or all
  of them, if fewer).
- Regular season = weeks before `playoff_week_start`. Playoff results
  count only games on the road to 1st or 3rd place.
- The Seasons page's "Power Rankings & Playoff Odds" section reads
  `data/power-rank-csv-history.json` (the same file behind each season's
  Power Rank History charts): weeks at #1 / in last place, longest runs at
  each (a run stays inside one season), highest and lowest Power Ranking
  Score (lower is better, so "highest" is the worst a team has rated), and
  Earliest to Clinch a Playoff Berth — the first week playoff odds reach
  99.5% and stay there, the same moment the Season page's Playoff Odds
  chart labels "Clinched". Season-long ones wait for a finished regular
  season; the 2026 numbers appear once the weekly Power Rankings workflow
  has written 2026 into that file.
- "Overall Record" = every week's score against every other team in the
  league (what older versions called all-play).
- Luck = real win % minus Overall Record win % — the same Luck shown on the
  Home and Season pages (`DeepHistory.luckPercent`), shown as a percentage.
- Blowout = won by 30+; narrow win = won by 5 or less.
- Waiver, FAAB and trade "value" = points a player actually produced in the
  acquiring team's starting lineup minus what a replacement-level player
  would have produced; draft pick value = value over the pick slot's
  expected value that season.
- **Draft records wait for the season to be over.** A pick is judged on how
  its player did across the whole year, so a season still being played
  (league status not "complete") is left out of every Draft record — it can't
  hold a record, a bust or a "worst draft season" yet. Pick a season in
  progress and the Draft rows read "Unlocks after the season ends"; on All
  seasons / Last 3 a banner says the current draft is being held back. The rule
  lives in `ctx.draftPicks()` (`js/record-book.js`), so any new Draft record
  gets it automatically; give it `needsFinishedSeason: true` in
  `js/record-defs.js` so the page can word the wait correctly.

- **Starters by Position** (Players & Lineups): the highest and lowest single
  week ever from a starter at QB, RB, WR, TE, K and D/ST, plus the lowest week
  from the SUPERFLEX slot (2022 on). Starters only, in any lineup slot; a TE or
  WR who started on a bye or inactive scores 0.0, which is why the lowest-TE
  record is a big tie. A starter's slot comes from his index in Sleeper's
  `starters` list, which follows `league.roster_positions`.
- **Head to Head** (Matchups): built from every counted meeting between two
  managers (regular season plus the games on the road to 1st/3rd place, the
  same as the Rivalries page). *Most Lopsided* ranks by the gap in wins;
  *Combined Points Average* adds both teams' scores per meeting and needs 5
  meetings (3 for a 3 to 4 season view, 2 for a single season); *Most Regular
  Season / Playoff Meetings* count each separately.
- **Postseason Starts** (Players & Lineups): starts in the championship game
  (either finalist) and in playoff games on the road to 1st or 3rd place, so the
  third-place game counts and the consolation bracket does not. The engine
  marks the title game `final` on `games`, `weekTeams` and `playerRows`.
- **Best Drafter** is one record per position (QB, RB, WR, TE, K, D/ST); it
  needs 3 picks at the position (1 in a single-season view).
- **Playoff Picture** (Seasons, its own section): *Best Record to Miss the
  Playoffs*, *Worst Record to Make the Playoffs* and *Fewest Wins by a
  Champion*. "Made the playoffs" = Sleeper's playoff field (or, for the ESPN
  years, the `playoffAppearance` flag in `manual-history.json`); a first-round
  bye counts as making it. Regular-season record only. Like Draft records,
  these leave out the season in progress, because who makes the playoffs and
  who wins them isn't settled until it's over (`needsFinishedSeason: true`; the
  page shows a banner and "Unlocks after the season ends").
- **Most Last-Place Finishes** (Careers, Hardware): finishing with the worst
  regular-season record in a season (fewest points scored breaks a tie in
  win %). Counts a season only once its regular season is done.
- **Head to Head, more** (Matchups): *Longest Head-to-Head Win Streak* (a tie
  ends the streak, 2 wins minimum, the streak carries across seasons and shows
  "ongoing" if it's still alive) and *Closest Rivalry* (smallest average margin
  across all meetings, same minimum-meetings rule as Combined Points Average).
- **Biggest Upset** (Matchups, Margins & Drama): the winner's Power Ranking
  versus the loser's going into the game. Power Rankings are published after
  each week's games, so it uses the *previous* week's ranking; Week 1 (no prior
  ranking) and seasons without ranking data (before 2019) are skipped. Gap =
  winner's rank minus loser's rank ("9 spots" = #10 beat #1).
- **Highest-Scoring Benched Player** (Players & Lineups): the most points a
  player scored while sitting on a manager's bench, with whether the manager
  won anyway.
- **Blockbuster Trades** (Front Office, Trades): the most players changing
  teams in one trade; draft picks break ties.
- **Earliest Kicker / Defense Drafted** (Front Office, Draft): the earliest
  overall pick spent on a K or D/ST. Reads every draft slot (not just graded
  picks) and waits for the season to be over like the rest of Draft.
- **Ride or Die is not included.** It needs to know a player was on a bye (the
  streak should skip those weeks), but Sleeper records a bye as the same 0.0 as
  a benched or inactive player and the repo has no NFL team schedule per week,
  so a bye can't be told apart from a real zero. Adding a weekly NFL team/bye
  table would make it possible.

### Record dates, NEW badges and the timeline (Records page)

On **All seasons** every record shows when its current holder got there under
their name ("Set 2024 Wk 14", "Set in 2024" for a season-long record, "Set in the
2024 draft", "Leading since 2024 Wk 3" for a record that isn't a single moment,
"Leading since before 2020" for something already on the books when the
league's saved history begins). A **NEW** badge marks any record set in the
newest 3 scored weeks (it stays through the offseason until the next season's
scoring weeks push it out). Opening a record also shows **Record history**: who
held it and when, newest first (the latest 6, with "...and N earlier changes").
All of it comes from `data/records-history.json`, and it only shows on the
All seasons view (a single season or Last 3 would need its own history). A date
or timeline is shown only when the file's current holder matches the one the
page is showing, so a stale file can never label the wrong person.

## Latest Records (Home page)

The Home page lists the 5 most recently set records, from
`data/records-feed.json`. The Record Book can only say what the records are
*now*, so `scripts/build-records-feed.js` rebuilds it as it stood after every
scored week of every season (`scripts/lib/records-replay.js`): it cuts the saved
archive off at that week, runs the real engine, and compares each record's top
spot with the week before. It takes about 20 seconds, reads only files already
in the repo, and the "Build Records Feed" workflow reruns it Tuesdays at 12:30
UTC, after the Sleeper backup, power rankings and raw stats have refreshed. It
writes two files: `data/records-feed.json` (this list and Records in Reach) and
`data/records-history.json` (the Records page's dates, NEW badges and timelines),
and the workflow commits both. Run `node scripts/build-records-feed.js` by hand
after changing which records exist.

The replay tracks each record's *reign* (the last holders it recognized), so a
tie followed by someone passing both is still logged as a takeover, and a holder
just extending their own mark isn't a new event.

### Records in Reach (Home page)

Beside Latest Records, a short list (5 on screen) of active managers closing in on a
record they don't hold. Only managers who played in the latest season count. The
feed lists every manager within range, with each record's closest chaser flagged
`primary`; everyone sees the closest chaser per record (sorted by how close, gap
relative to the record), and once a manager picks "My team" their own chases come
first.

- *Career totals* (records flagged `grows: true` in `js/record-defs.js`, such as
  Career Wins or Most Trades): in reach when the gap is within 5% of the record,
  or 1 when the record is 20 or less.
- *Streaks* (weekly streak records with a `live(ctx)` function): in reach when
  a streak that is still alive in the newest week is within 3 of the record and
  at least 3 long.

The panel hides itself when nothing qualifies (for example in the offseason with
no live streaks and nobody close). The rules live in `scripts/lib/records-reach.js`.

What counts as "set": a new performance beating the old mark (*broke*, or
*topped their own*), someone passing the leader on a running total such as
career wins (*broke*), or the lead changing hands (*took the lead*). A holder
just adding to their own career total, a tie, and every running average or
percentage (flagged `rate: true` in `js/record-defs.js`, e.g. Lineup Efficiency,
FAAB ROI, Luckiest Career) don't count, since those leaders swap nearly every
week. Season-long records are dated the first playoff week, when the engine
decides the regular season is over. Each item links to its row in the Record
Book (`records.html#players/all/most-playoff-starts` opens that record).

**Team Raw Stats** (passing yards, receptions, TDs... summed over submitted
starting lineups) need box-score numbers Sleeper's matchup data doesn't
carry. `scripts/build-team-raw-stats.js` fetches them week by week from
Sleeper's stats endpoint into `data/team-raw-stats.json`. Until that file
exists those records show "Awaiting data". Run it once from the Actions tab
("Build Team Raw Stats" -> Run workflow) — after that it refreshes itself
every Tuesday. Or run `node scripts/build-team-raw-stats.js` locally and
commit the result.

## Fast First Load (Slim Players, Backup-Based Season Chain)

Teams, Records, Season, Draft, Trades, Rivalries, History and the Home page used
to take around **9 seconds** to show anything on a phone-speed connection, and
reloading didn't help. Measured here with a simulated 8 Mbps / 120 ms phone
connection against this league's real data, they now take about **3 seconds**
(Records on a fast connection: 4.3 s -> 1.6 s), and the data pulled from Sleeper
on a visit dropped from about 2 MB to about 60 KB. Three causes, three fixes:

1. **The player directory.** Every page downloaded Sleeper's full NFL player
   directory (14 MB unzipped, about 2 MB over the wire) on every visit. The code
   meant to cache it in the browser, but 14 MB never fits in `localStorage`, so
   the cache write silently failed and the "repeat visits are fast" promise
   never held for it. The pages only ever read five fields from it (`full_name`,
   `first_name`, `last_name`, `position`, `team`; checked by running every page
   against a directory that logs what is touched). `scripts/build-fast-data.js`
   now writes `data/players-slim.json`: those five fields for every QB/RB/WR/TE/K/DEF/FB
   (plus any position a lineup slot calls for, and **anyone who has ever appeared in
   this league's lineups, rosters, draft or transactions, at any position**).
   About 4,400 players, 80 KB zipped. If the file is missing the site falls back
   to the full directory, now trimmed to the same fields so the browser cache
   works.
2. **The season chain.** To list the seasons, the site walked Sleeper's
   `previous_league_id` chain one season at a time, four live requests each
   (about 28 requests in a row). Every finished season is already in
   `data/sleeper-archive/`, so `SleeperAPI.getSeasonChain` now reads those from
   the backup, all at once, using `data/sleeper-archive/index.json` (a list of the
   seasons). Only the current league is requested from Sleeper. Details worth
   knowing: a backup saved before its season finished (status not "complete") is
   ignored in favor of a live fetch; each backup file is downloaded once per page
   and shared with the per-season loader; and because Sleeper shows a manager's
   *current* display name and avatar even on old seasons, those two fields are
   refreshed from the live current league onto the backed-up seasons (team names
   stay per season).
3. **The season in progress.** Its weeks were fetched one at a time (17 requests
   in a row, since Sleeper lists every future week as an empty schedule) and its
   transactions four at a time. Week 1 is now fetched first (a season that hasn't
   started still costs one request), then the other weeks six at a time, trimmed
   at the first empty or failed week exactly as before. The draft board loads
   alongside instead of after.

`scripts/build-fast-data.js` runs in the weekly "Sleeper Data Pipeline" workflow
right after the backup, and commits `data/players-slim.json` and
`data/sleeper-archive/index.json` with it. Run it by hand after a manual
backup: `node scripts/build-fast-data.js`. `npm test` checks that both files are
current, that the slim list covers every player in the archive, and that award
photos still match the same players.

Things to know:

- **A brand-new player can show as "Unknown Player" until the next Tuesday.**
  The slim list is rebuilt weekly with the backup. A player Sleeper added to its
  directory after the last run (a fresh practice-squad signing, say) and that a
  manager then picks up mid-week has no name in the list yet. Running the pipeline
  from the Actions tab refreshes it right away; a daily refresh could be added if
  this ever bites.
- **Old seasons are as fresh as their last backup.** That was already true of
  the per-season data; it is now true of each season's standings, rosters and
  playoff bracket too. They can't change after a season is complete.
- **Not measured against the real sites.** The timings come from a simulated
  network (this environment can't reach Sleeper or GitHub Pages) using gzip sizes
  of your actual files; real numbers will differ, but the drop in requests and
  bytes doesn't depend on the simulation.

## Fresh & Finished: Freshness Chips, a Week-First Home, and "My Team"

Four changes that came out of a review of the live site.

**1. Freshness chips.** Every panel whose numbers come from a weekly
snapshot now carries a small tag saying which week it covers and how it
updates — e.g. `Snapshot · Through Week 6 · Oct 20 · updates with each ROS refresh`
(Power Rankings panels; the others say `updates Tuesdays`).
"Through Week N" always means the last *finished* week, so it can sit
next to Home's "Week 7" (the week being played) without contradicting it.
A chip turns blue (the site's "bad" color; it was amber until yellow became "good") when the data is more than one finished week behind
the NFL calendar (the Sleeper week), or — for ROS ranks — more than 10
days old. The helper is `freshnessChipHtml` in
`js/utils.js` (styles: `.fresh-chip` in `css/styles.css`). Chips are on:
Home (Standings, ROS ranks, Hot & Cold, Power Rankings, Latest Records,
Records in Reach, This Week / Last Week), the Power Rankings page and the
Records page (record dates).

**Why Standings and Power Rankings used to disagree.** Sleeper's roster
Record and Points For only count a week once it is final, but the weekly
matchup data already holds the half-played week's scores. Home built
*Overall, Luck, Avg/Wk and SOS* from the weekly data (so they included the
half-played week) and *Record and PF* from the roster (so they didn't):
one row could read 4-1 with an Overall of 49 games. Home now cuts
everything built from weekly data (Overall, Luck, Avg/Wk, SOS and Hot &
Cold streaks) at the same week the Record covers (`completedWeekCount`,
`onlyCompletedWeeks` in `js/dashboard.js`). The Season page's table for the
*current* season still uses every week with points — it is a different
view and was left alone.

**2. Member-facing copy.** Anything written for whoever builds the site
(file names, script names, "ask for a draft", "cached in your browser")
was replaced or removed. `tests/fresh-home.test.js` scans every page's
visible text and every user-facing string in `js/` for those phrases, so
they can't creep back.

**3. Home leads with the week.** Order: league pulse strip → This Week's
Matchups (with Featured Matchup and Hot & Cold beside them) → Standings →
Power Rankings + Recent Activity → Latest Records + Records in Reach (5
each) → Last Week's Matchups
(collapsed on phones). The pulse strip replaces the big wordmark (the nav
already carries it): the week, when waivers run next, the week's top score
and closest game (both from the last *finished* week), and your own
matchup. (An earlier version also showed "games on now" and a newsletter
card; both were removed in the next round, below.)
- *Next waivers* uses the league's waiver day from Sleeper and
  `WAIVER_CLEAR_HOUR_ET` in `js/config.js` (3 AM ET, measured from about
  90% of the league's completed claims in 2023–2026; Sleeper doesn't
  publish the hour).

**4. My team.** The star in the top bar (every page) opens a picker of
the league's managers. The choice is saved in that browser only
(`localStorage`, key `funtasy.myTeam`) — there is no login. Once picked:
your matchup is pinned first (This Week and Last Week) with a "Your
matchup" label and shown in the pulse strip; your row gets a gold edge and
a YOU tag in every table (the odds heatmap, Season/Teams/Rivalries/Draft
tables, Records lists…) and your name is tinted anywhere it appears on its
own; your Records in Reach come first. `js/my-team.js` finds your rows by
looking for your username as the whole text of a cell or label (Home's
Standings cells carry `data-username` because they show team names), and
keeps up with content a page draws later. To make a new list highlight
automatically, just render usernames; to highlight a cell that shows
something else, give it `data-username="..."`.

Records in Reach now lists *every* manager within range of a record
(flagged `primary` for each record's closest chaser), so your own chase
shows even when someone else is closer on that record. Everyone else sees
only the closest chaser per record, five at a time. `data/records-feed.json`
is rebuilt by the Tuesday workflow (or `node scripts/build-records-feed.js`).

## Finished Games Only, Newsletters Out, and a Mobile & Layout Pass

**Newsletters are gone.** The Newsletters page, its nav link on every page,
the Home callout, `js/newsletters.js` and `data/newsletters.json` were
removed, and the "games on now" indicator went with them. Older sections
below that mention newsletters or live games describe things that no
longer exist. If you are updating an existing repo from a zip, delete
`newsletters.html`, `js/newsletters.js` and `data/newsletters.json` by hand
(unzipping on top of a repo doesn't remove files).

**A matchup only counts once it is final.** A half-played week already has
partial scores in Sleeper's data, and those used to leak into Seasons, Head
to Head, Records, Teams and the player pages. One rule now decides which
weeks are finished, `DeepHistory.completedThroughWeek` in
`js/deep-history.js`:
- Sleeper's clock: the week in progress is `nflState.week`, so everything
  before it is final (Sleeper moves it on early Tuesday, once Monday night
  is over).
- Regular season: the rosters' win/loss records only count a week once it
  is final, so the most games any roster has played is a second opinion;
  the smaller of the two wins. It can hide a week a little late but never
  show one early.
- Playoffs: records stop moving, so the clock alone decides.
- Seasons Sleeper marks complete count everything; seasons not yet drafted
  count nothing; with no information at all, nothing counts (the cautious
  choice).

The live pages apply it in `fetchSeasonDeep`. The build scripts apply the
same function (via `scripts/lib/finished-weeks.js`, which loads the site's
own file rather than keeping a copy): the records replay, `build-team-raw-
stats.js` and `build-player-index.js`. `backup-sleeper-data.js` now records
`nflWeek` (the clock at the time of the backup) in each season's saved
entry so offline builds know which week was in progress; archives saved
before this change fall back to the rosters' records. Two things to know:
- The player index and team raw stats pick the rule up the next time their
  workflows run, and `nflWeek` appears in the archive after the next backup.
- The "remaining games" simulator behind Power Rankings still treats the
  in-progress week as remaining, which is what you want for a forecast.

**Matchup cards (Home).** Each card has a status label: *Final*, *In
progress* or *Upcoming* (Sleeper has no projections, so there is no
"Projected"). A finished game marks the winner `W +margin` and the loser
`L`; a game in progress says who leads and by how much; nothing is marked
before kickoff. A manager with no team name is shown once instead of
twice. Featured Matchup now uses the same status and result wording as the
cards beside it, and the footnote ("picked for the best combined record on
the slate") is true: the pick is `featuredMatchupPair` in `js/utils.js`,
which the Rivalries page also reads so they always agree.

**Phones.** The Draft Board has a view switch: *Board* (the grid, still
the default on wide screens), *By round* and *By team* (the default on a
phone, remembered per browser as `funtasy.draftView`). Tables use a thin
themed scrollbar instead of the bright native one. Standings, Power
Rankings and the odds heatmap keep their first column(s) pinned while you
pan (`sticky-cols-1` / `sticky-cols-2` on the table); the odds heatmap
draws a gold line after the last playoff spot and fits through that column
at 390px. Home's Standings keeps Team pinned and tucks PA, Avg/Wk and
Overall behind a "Show all columns" button on phones so Luck, ROS and SOS are on screen.

**Rivalries and Players.** Rivalries opens on, in order: a link, your own
hottest rivalry (if you picked a team), this week's featured matchup (if
those two have met), then the league's hottest rivalry, and says which in an
"Opening on:" line. There is a swap button and a Common Rivalries list (a
folded panel on phones). "Hot" is `rivalryHeat` in `js/rivalries.js`: more
meetings, an even series, playoff games and recent games all add heat;
ties are settled by meetings then name so the order never changes between
visits. Closest Meeting and Biggest Blowout collapse into one card when
they are the same game. Players opens on three leaderboards from the
existing index: Most Rostered (ties on games fall to starts, then owners,
because many players have been on a roster every week), Best Career, and
Trending (points over the last three finished weeks).

**Layout.** Stacked cards always have a 24px gap (`.panel + .panel` and
the wrap rules, with grids exempt because their own gap does the spacing);
Season labels an in-progress year "Standings · Through Week N" instead of
"Final Standings"; From the Archives is gone from Home. From 1000px up the
nav is a persistent tab bar; the hamburger stays on tablets and phones.

## Current-season Power Rank History (and From the Archives removed)

**The current season was missing its three Power Rank charts.** The Season
page draws them from `data/power-rank-csv-history.json`, and the weekly
script (`scripts/update-power-rankings.js`) does rebuild that file's entry
for the in-progress year. The workflow's commit step, though, only staged
the snapshot and `power-rank-history.json`, so the rebuilt file was thrown
away every Tuesday and 2026 never appeared. The workflow now stages all
three files (`.github/workflows/update-power-rankings.yml`; a test checks
that every file the script writes is in that `git add`). **Copy the updated
workflow file into your repo along with the rest.**

A second bug would have made the charts wrong once they showed up: the
script re-runs `computePowerRankings` once per finished week, but that
function reads each team's record from the rosters, which hold *today's*
record, so every past week was ranked on the latest record and its playoff
simulation counted later weeks twice. `rostersAsOfWeek` in the script now
rebuilds each roster's record and points as of the week being computed
(regular season only, ties counted, cents kept). The newest week reuses the
result the snapshot was just built from, so the chart ends exactly on the
Power Rankings page (the odds simulation is random, so a second run would
differ slightly).

2026 was seeded now from the committed archive (Weeks 1–5, matching the
Oct 13 snapshot), so the charts show immediately. The next Power Rankings
run (a pushed `team-strength.json` or Run workflow) rebuilds the whole entry
through the latest finished week. Because 2026
data now exists, the Records feed also picks up this season's Power
Ranking records (Highest / Lowest Power Ranking Score) on its next build.

**From the Archives is removed from Home** (markup, renderer and styles).
`data/season-awards.json` stays: the Season and Teams pages still use it.

## Strength of Schedule, Weekly Scores, Lineup Slots and a Yellow/Blue Color Scheme

Three sections now sit under the Power Rankings table and the Finish
Probability heatmap: **Strength of Schedule** (two panels), **Every Week, One
Dot** and **Where Each Lineup Is Strong Or Thin**. They came from the mockup
PDF; the numbers on the page are computed from the real games (Week 5 as of
the first build; the mockups were Week 7, so nothing matches them digit for
digit).

**Where the numbers come from.** `scripts/update-power-rankings.js` now writes
a fourth file next to the snapshot, `data/power-rankings-extras.json`, using
the pure functions in `scripts/lib/pr-extras.js`. The page only reads it, same
rule as the rest of the page (no live calculation, never a half-played week).
The file carries the snapshot's season and week, and the page drops the
sections entirely if they don't match the snapshot above them. The workflow's
`git add` lists the new file (a test checks that every file the script writes
is staged, and that the committed file has the snapshot's week). **Copy the
updated `update-power-rankings.yml` into your repo with the rest.**

- **Schedule Faced So Far.** The old SOS column is really Points Against per
  game (the average score the team's opponents put up against it), so it
  just repeats PA/G. *True SOS* is, for every game a team played, the
  opponent's average score in all of its **other** games (this game left out),
  averaged over the season. Hardest first; a hollow ring marks the old PA/G
  number, the filled dot the true one, with both ranks on the right. Rows that
  move 4+ spots between the two are tinted (the threshold is a third of the
  league, never under 3). The sentence underneath names the biggest flip.
  True SOS needs two finished weeks (an opponent needs another game to be
  averaged), so Week 1 shows only the Road Ahead panel.
- **Road Ahead.** The rest of each team's regular-season schedule from
  Sleeper, with every opponent rated by its points per game so far, shown as
  distance from the league average (blue bar = harder than average, yellow =
  easier). It's a proxy, not a projection; the on-page note says so.
- **Every Week, One Dot.** One dot per finished regular-season week, a white bar
  for the team's average, a dashed line for the league average, and
  low / high on the right. Sorted by average, the average equals the Power
  Rankings table's Avg PPG. Hover a row for every week's score. The sentence
  underneath names the steadiest team and the wildest, by the gap between best
  and worst week.
- **Lineup slot heatmap.** For each starter slot (QB, RB1, RB2, WR1, WR2, TE,
  FLEX, SFLX, K, DEF in the league's own lineup order) the team's average
  minus the league's average for that slot, plus the sum across the slots in a
  "vs Avg" column. It reuses `DeepHistory.buildPositionTable`, the same slot
  labelling as Seasons' By Starting Slot (the best RB goes in RB1 even if he
  started in FLEX). One fixed color scale, saturating at +/-10 points per game,
  so a color means the same thing in every cell.

All three sections use regular-season weeks only, to agree with the table's
Avg PPG, and the "My team" highlight picks up the matching row in each. On a
phone the schedule and score rows put the name and the numbers on one line
with the plot under them; the slot table scrolls sideways with Team pinned.

**Yellow is good, blue is bad, everywhere.** The heatmap colors are the
mockup's: blue `#336B7A` for the weak end, a dark neutral `#1C4036` that melts
into the panel, and yellow `#7C5D31` for the strong end (sampled from its
legend). One scale now covers every heatmap on the site (`heatColor` in
`js/utils.js`, with `--heat-low/-mid/-high` in the stylesheet; Rank still runs
the other way round so rank 1 is yellow). The rest of the green/red is swapped
for a single pair of tokens, `--good #F0A340` and `--bad #4EA8DD`: luck and the
up/down arrows, "in progress" and live labels, grade badges (yellow to pale to
blue), a record's lowlight accent, the
playoff-odds chart's Clinched / Eliminated callouts, and the legend sentences
under the heatmaps. Left alone on purpose, because they say *who*, not *good
or bad*: the WR color on the draft board, the mascot's toot puff, the team
line colors in the charts, and the error message's rust color. A test
(`tests/color-scheme.test.js`) fails if a green- or red-hued color comes back
anywhere else.

(The first version of this had it the other way round, blue good and orange
bad. It was flipped on 2026-10-27 at the user's request: the same two colors,
just swapped, so only the meaning moved.)

## Power Rankings Run Only When You Say So

The Power Rankings Update workflow (`.github/workflows/update-power-rankings.yml`)
no longer has a Tuesday schedule. It runs in exactly two cases:

1. **You push a change to `data/team-strength.json`** (the weekly FantasyPros
   ROS ranks). That is the normal weekly step: type in the ranks, bump
   `asOf`, commit, push. Do it after Monday night's game is final and
   Sleeper has rolled to the next week (early Tuesday). Run earlier, it just
   rebuilds the previous week. If the ranks didn't change, still change
   `asOf`: GitHub only starts the run when the file itself changed.
2. **You press "Run workflow"** on that workflow in the repo's Actions tab
   (`workflow_dispatch`). Use it after copying new site code into the repo, or
   when the ranks didn't move. Delete that one line from the workflow if you
   never want the button.

Each run rewrites four files: the snapshot, `power-rank-history.json`,
`power-rank-csv-history.json` and `power-rankings-extras.json`, from live
Sleeper results. The workflow's own commit doesn't start another run
(GitHub ignores pushes made with its built-in token), and a push that only
touches other files, including this zip's code, never starts one either.
A test (`update-power-rankings.test.js`) fails if a `schedule:`/`cron:` line
comes back or if any other file is added to the trigger list.

What this changes on the site: the Power Rankings page, the Home Power Rankings
panel, the Season page's Power Rank charts and the three Strength of Schedule
sections only move when one of those two things happens, and their chips say
`updates with each ROS refresh`. They turn blue once they are more than one
finished week behind Sleeper's calendar. Everything else (Standings, matchups,
Seasons, Records dates) is unchanged; the other workflows keep their Tuesday
schedules, including the Records feed (which reads the Power Rank charts' file,
so Power Ranking records follow whatever the last Power Rankings run wrote).

## Why Visitors Used To Need A Hard Refresh (Cache-Busting)

GitHub Pages tells browsers they may keep any file for 10 minutes
(`Cache-Control: max-age=600`). A normal refresh only re-checks the HTML
page itself, so for up to ten minutes after a deploy a browser could pair
the new page with the old `js/*.js` and `css/styles.css` it had kept — or show
old numbers from `data/*.json`. A hard refresh or an incognito window (empty
cache) skipped that, which is why those "fixed" it.

Two fixes, neither needing a build step on the server:

- **Versioned scripts and styles.** Every `<script src="js/...">` and
  `<link href="css/...">` carries `?v=<hash of that file's contents>`. Edit
  a file and its URL changes, so every browser fetches it fresh; leave it
  alone and the URL (and the browser's cached copy) stays put.
  `scripts/stamp-asset-versions.js` writes the hashes. **After editing any
  file in `js/` or `css/`, run `npm run stamp`** (or ask me — I do it before
  every zip). `npm test` fails with a clear message if the stamps are stale,
  so a forgotten stamp can't silently ship. A brand-new page just needs plain
  `<script src="js/whatever.js">` tags; the stamp script fills in the rest.
- **Data files always revalidate.** `fetchJsonSafe` (used for everything under
  `data/`) now fetches with `cache: "no-cache"`: the browser asks the server
  "changed?" each time. Unchanged files return a tiny 304 and are reused;
  a file a workflow just committed (power rankings, injuries, records,
  raw stats) downloads immediately.

What this can't fix: the HTML page itself is still cached by GitHub Pages
for up to ten minutes, and a deploy takes a minute or two to publish. So
right after a push, someone who opens a page they visited in the last ten
minutes can still briefly see the old *page* — but a normal refresh will
pick up the new one, and it will no longer be mismatched with stale
scripts or data. Browser-stored data (`localStorage`) has its own expiry: the
NFL player directory is kept up to a week, and a live-fetched completed season
up to a day.

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
- Sleeper doesn't publish projections, so a game that hasn't finished shows
  as "In progress" or "Upcoming" rather than "Projected".
