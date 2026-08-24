# Sleeper Data Archive

This folder is a raw backup of everything this site has ever pulled
from Sleeper's public API for this league — one JSON file per season
(`2023.json`, `2024.json`, etc.), plus `players.json`, the NFL player
ID directory.

**This is not something the live site reads from.** The site itself
always talks to Sleeper directly, live, exactly as it always has —
this folder exists purely as insurance. If Sleeper's public API ever
goes away, changes shape, or a season becomes inaccessible for any
reason, everything this site has ever shown is otherwise gone with it,
since nothing is stored anywhere else. This folder — and, because it's
a normal part of the git repo, its entire commit history — is the
backup.

It's populated two ways:

- **Automatically**, on a weekly schedule, via
  `.github/workflows/backup-sleeper-data.yml` — no action needed once
  that's deployed.
- **Manually**, any time, by running `node scripts/backup-sleeper-data.js`
  yourself (needs Node 18+, no other setup), or by clicking "Run
  workflow" on the Actions tab of the repo on GitHub.

Completed seasons are only ever fetched once — they can't change on
Sleeper's end, so re-fetching them on every run would just be wasted
API calls. Only the current, in-progress season (and any season this
hasn't backed up yet) gets fetched fresh each time.

If this folder is empty, no backup has run yet.
