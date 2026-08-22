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

## Draft Pick Grades — a bell curve, fit from your own draft history

Every draft pick with a computed VBD now gets a letter grade (A+ through
F), shown as a small colored badge wherever a pick is displayed: the
Season Summary's Best Draft Steal / Biggest Draft Bust, the Records
page, and every pick in a manager's season-by-season draft history on
the Teams page.

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
   deviations of the historical residuals. That z-score is the actual
   bell curve: most picks land close to expectation (B range), with
   A+/F reserved for picks that beat or missed by a lot.
   - z ≥ +1.5 → A+, +1.0 → A, +0.5 → B+, -0.5 → B, -1.0 → C, -1.5 → D,
     below that → F

Verified this end-to-end with a synthetic multi-season league where a
late-round pick was deliberately made to massively overperform and an
early-round pick to massively underperform — they graded A+ and F
respectively, exactly as expected. Also checked the grade distribution
against 2,000 simulated picks with normally-distributed outcomes: the
resulting split (≈38% B, tapering symmetrically to ≈6% at each tail)
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
