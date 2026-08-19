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
- `newsletters.html` / `js/newsletters.js` — lists issues from
  `data/newsletters.json`; clicking one opens its full text on the same page
- `js/sleeper-api.js` — every call to Sleeper's API lives here
- `css/styles.css` — the whole visual design (edit `:root` at the top to
  retheme colors/fonts)

## Known limitations / ideas for later

- Champion detection relies on Sleeper's playoff bracket data (`p: 1` game).
  Leagues with unusual playoff formats may need a manual override — ask me
  and I'll add one.
- No per-player box scores yet (just team totals) — happy to add a roster/
  player-level view if you want it.
- Newsletters are added by hand today. If you want it hands-off, I can set
  up a GitHub Action that runs weekly, pulls that week's results, and drafts
  a newsletter automatically — just ask.
