# Sleeper Data Archive

This folder is a raw backup of everything this site has ever pulled
from Sleeper's public API for this league — one JSON file per season
(`2023.json`, `2024.json`, etc.), plus `players.json`, the NFL player
ID directory.

**The live site now reads from this folder for finished seasons.** A
completed season can't change on Sleeper's end, so the pages load each
finished season from here (one same-origin file) instead of making a chain of
live requests to Sleeper, which is what makes the Teams, Records, Season,
Draft, Trades, Rivalries, History and Home pages open quickly. The season in
progress is still fetched live from Sleeper every time. A season file is only
trusted once its saved copy says the season was finished; a copy saved
mid-season is ignored in favor of a live fetch until the weekly backup
refreshes it.

It is also insurance: if Sleeper's public API ever goes away, changes shape,
or a season becomes inaccessible for any reason, everything this site has ever
shown would otherwise be gone with it. This folder — and, because it's a
normal part of the git repo, its entire commit history — is the backup.

Two small files in the site are built from this folder after each backup
(`node scripts/build-fast-data.js`): `index.json` here (a list of the
seasons, so they can all be loaded at once) and `data/players-slim.json`
(`players.json` cut down to the fields the site reads).

It's populated two ways:

- **Automatically**, on a weekly schedule, via the "Sleeper Data Pipeline"
  workflow (`.github/workflows/sleeper-data-pipeline.yml`) — no action needed
  once that's deployed.
- **Manually**, any time, by running `node scripts/backup-sleeper-data.js`
  yourself (needs Node 18+, no other setup), or by clicking "Run
  workflow" on the Actions tab of the repo on GitHub.

Completed seasons are only ever fetched once — they can't change on
Sleeper's end, so re-fetching them on every run would just be wasted
API calls. Only the current, in-progress season (and any season this
hasn't backed up yet) gets fetched fresh each time.

If this folder is empty, no backup has run yet.
