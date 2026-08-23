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
data in that file (currently 2021–2025; 2020 is intentionally omitted —
that data was never recovered). Note: `Pathieu` (2021–2022) and `paty23`
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
  season's actual results.
- **Recent Activity** — the last several trades and adds (waiver or free
  agent), pulled from this week's and last week's transactions.
- **From The Archives** — a rotating callout from `season-awards.json`,
  picked deterministically by the day of the year (stable within a day,
  different the next).

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
  opponent score faced across a single season.

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
