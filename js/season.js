let SEASON_CHAIN = null;
let PLAYER_DIRECTORY = null;
let SEASON_AWARDS = null;
let POWER_RANK_CSV_HISTORY = null;
let INJURIES_DATA = null;
let MANUAL_HISTORY = null;
let ALL_TIME_STATS_CACHE = null; // computed lazily, once per page load — see getAllTimeStats()
let ALL_DEEP_SEASONS = null; // every season's weekly data, fetched once per page load
let METRICS_CACHE = null; // Metrics.analyze() over every season, built once per page load
let CURRENT_METRICS = null; // the metrics behind the season currently on screen (the filter pills redraw from it)

/*
  Powers the Season Summary's "records set this season" callouts, the
  draft grade model, and the injury luck model — all three need every
  pick/season in league history to fit meaningfully, not just the one
  season being viewed. Kept separate from the fast single-season fetch
  and only triggered when a completed season is actually being
  displayed (the only time any of these are used). Cached for the rest
  of this page visit so switching between completed seasons doesn't redo
  the work each time.
*/
async function getAllDeepSeasons() {
  if (!ALL_DEEP_SEASONS) ALL_DEEP_SEASONS = await DeepHistory.buildAll(SEASON_CHAIN, () => {});
  return ALL_DEEP_SEASONS;
}

async function getAllTimeStats() {
  if (ALL_TIME_STATS_CACHE) return ALL_TIME_STATS_CACHE;
  const deepSeasons = await getAllDeepSeasons();
  ALL_TIME_STATS_CACHE = DeepHistory.computeStats(SEASON_CHAIN, deepSeasons, PLAYER_DIRECTORY, INJURIES_DATA);
  return ALL_TIME_STATS_CACHE;
}

// The MVP, draft awards, pickups, trades and injury luck all come from
// Metrics, which looks across every season (draft grades compare a pick with
// similar picks in league history), so it is built once from all of them.
async function getMetricsAnalysis() {
  if (METRICS_CACHE) return METRICS_CACHE;
  const deepSeasons = await getAllDeepSeasons();
  METRICS_CACHE = Metrics.analyze(SEASON_CHAIN, deepSeasons, PLAYER_DIRECTORY, INJURIES_DATA);
  return METRICS_CACHE;
}

async function renderSeasonPage() {
  const errorBox = document.getElementById("season-error");
  try {
    const [seasonChain, playerDirectory, seasonAwards, powerRankCsvHistory, injuriesData, manualHistory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(SEASON_AWARDS_FILE, { seasons: {} }),
      fetchJsonSafe(POWER_RANK_CSV_HISTORY_FILE, { seasons: {} }),
      fetchJsonSafe(INJURIES_FILE, { players: {} }),
      fetchJsonSafe(MANUAL_HISTORY_FILE, { seasons: [] }),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load the league's seasons from Sleeper. Give it a minute and refresh the page.");
    }

    SEASON_CHAIN = seasonChain;
    PLAYER_DIRECTORY = playerDirectory;
    SEASON_AWARDS = seasonAwards;
    POWER_RANK_CSV_HISTORY = powerRankCsvHistory;
    INJURIES_DATA = injuriesData;
    MANUAL_HISTORY = manualHistory;

    await renderSelectedSeason();
    window.addEventListener("hashchange", renderSelectedSeason);
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't load season data — " + err.message;
    errorBox.style.display = "block";
  }
}

// The Seasons page's own shapes of the season (js/season-data.js): standings rows, the grid, the bracket.
function buildSeasonView(summary, seasonEntry, deep) {
  const standings = SeasonData.standingsRows(summary, seasonEntry, deep);
  // A bracket only once the playoffs have started (before that Sleeper's bracket is all placeholders).
  const start = (seasonEntry.league.settings && seasonEntry.league.settings.playoff_week_start) || null;
  const playoffsStarted = summary.status === "complete" || (!!start && ((deep && deep.weeks) || []).some((w) => w.week >= start && (w.matchups || []).some((m) => (m.points || 0) > 0)));
  const bracket = playoffsStarted ? SeasonData.bracketModel(seasonEntry, deep, summary) : null;
  const champRow = bracket && bracket.champion ? standings.find((r) => r.rosterId === bracket.champion.rosterId) || null : null;
  return {
    standings,
    grid: SeasonData.seasonGrid(summary, seasonEntry, deep),
    bracket,
    champRow,
    playoffStart: (seasonEntry.league.settings && seasonEntry.league.settings.playoff_week_start) || null,
  };
}

function isTotalSelected() {
  return decodeURIComponent(location.hash.replace(/^#/, "")) === "total";
}

function getSelectedSeasonEntry() {
  const hashYear = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (hashYear && hashYear !== "total") {
    const match = SEASON_CHAIN.find((s) => String(s.league.season) === hashYear);
    if (match) return match;
  }
  return SEASON_CHAIN[SEASON_CHAIN.length - 1]; // default to most recent
}

function renderPicker(selectedKey) {
  const picker = document.getElementById("season-picker");
  const totalPill = `<a class="season-pill ${selectedKey === "total" ? "active" : ""}" href="#total">TOTAL</a>`;

  const sleeperYears = SEASON_CHAIN.map((s) => String(s.league.season));
  const manualYears = ((MANUAL_HISTORY && MANUAL_HISTORY.seasons) || []).map((s) => String(s.year));
  const allYears = [...new Set([...sleeperYears, ...manualYears])].sort((a, b) => Number(b) - Number(a)); // newest first

  const yearPills = allYears
    .map((year) => {
      const isActive = year === String(selectedKey);
      return `<a class="season-pill ${isActive ? "active" : ""}" href="#${year}">${year}</a>`;
    })
    .join("");
  picker.innerHTML = totalPill + yearPills;
}

async function renderSelectedSeason() {
  const errorBox = document.getElementById("season-error");
  const content = document.getElementById("season-content");
  const progressBox = document.getElementById("progress-status");

  try {
    if (isTotalSelected()) {
      renderPicker("total");
      content.style.display = "none";
      errorBox.style.display = "none";
      progressBox.style.display = "block";

      const deepSeasons = await DeepHistory.buildAll(SEASON_CHAIN, (season, status) => {
        progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
      });

      const summary = DeepHistory.computeTotalSummary(SEASON_CHAIN, deepSeasons, PLAYER_DIRECTORY, INJURIES_DATA, ManualHistory.computeAllSeasonLuck(MANUAL_HISTORY));
      progressBox.textContent = "Scoring the awards…";
      summary.metrics = buildTotalMetrics(await getMetricsAnalysis());

      progressBox.style.display = "none";
      content.style.display = "";
      CURRENT_METRICS = summary.metrics;
      content.innerHTML = renderSummary(summary);
      initMetricFilters(content);
      initStandingsToggles(content);
      stopReplay();
      initAnimatedDropdowns();
      initScrollAnimations();
      initChartHoverLinking();
      initSectionReveal(content);

      const leagueName = SEASON_CHAIN[SEASON_CHAIN.length - 1].league.name;
      document.title = (SITE_TITLE || leagueName || "League") + " — All-Time";
      document.getElementById("sb-title").textContent = "All-Time";
      document.getElementById("sb-sub").textContent = `${SEASON_CHAIN.length} season${SEASON_CHAIN.length === 1 ? "" : "s"} combined`;
      return;
    }

    // A pre-Sleeper (manual-entry) year, e.g. an ESPN-era season — checked
    // by year not being present in the live Sleeper chain at all, so a
    // year that happens to exist in both would always prefer the richer
    // Sleeper data. Renders a lighter standings + bracket view instead of
    // the full season pipeline, since no week-by-week data exists for
    // these seasons to build that richer view from in the first place.
    const hashYear = decodeURIComponent(location.hash.replace(/^#/, ""));
    const isSleeperYear = SEASON_CHAIN.some((s) => String(s.league.season) === hashYear);
    const manualSeason = !isSleeperYear ? ManualHistory.findSeason(MANUAL_HISTORY, hashYear) : null;
    if (manualSeason) {
      renderPicker(String(manualSeason.year));
      errorBox.style.display = "none";
      progressBox.style.display = "none";
      content.style.display = "";
      content.innerHTML = renderManualSeasonSummary(manualSeason);
      initStandingsToggles(content);
      stopReplay(); // in case a running replay timer was left over from a previously-viewed Sleeper season
      initChartTabs(); // no-op unless this ESPN-era year also has Power Rank History data (see data/power-rank-csv-history.json)
      initScrollAnimations();
      initChartHoverLinking();
      initSectionReveal(content);

      const leagueName2 = SEASON_CHAIN[SEASON_CHAIN.length - 1].league.name;
      document.title = (SITE_TITLE || leagueName2 || "League") + " — " + manualSeason.year + " Season";
      document.getElementById("sb-title").textContent = manualSeason.year + " Season";
      document.getElementById("sb-sub").textContent = "Pre-Sleeper season (ESPN) · limited historical data available";
      return;
    }

    const seasonEntry = getSelectedSeasonEntry();
    renderPicker(seasonEntry.league.season);

    content.style.display = "none";
    errorBox.style.display = "none";
    progressBox.style.display = "block";
    progressBox.textContent = `Loading ${seasonEntry.league.season}…`;

    const deep = await DeepHistory.fetchSeasonDeep(seasonEntry, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });

    let allTimeStats = null;
    if (seasonEntry.league.status === "complete") {
      progressBox.style.display = "block";
      progressBox.textContent = "Checking league records…";
      allTimeStats = await getAllTimeStats();
    }

    const injuriesForSeason = allTimeStats ? DeepHistory.extractInjuriesForSeason(INJURIES_DATA, seasonEntry.league.season) : null;
    const summary = DeepHistory.computeSeasonSummary(
      seasonEntry,
      deep,
      PLAYER_DIRECTORY,
      allTimeStats ? allTimeStats.draftGradeModel : null,
      allTimeStats ? allTimeStats.expectedPPGModel : null,
      injuriesForSeason
    );
    if (allTimeStats) summary.allTimeRecords = allTimeStats.records;
    summary.view = buildSeasonView(summary, seasonEntry, deep);

    progressBox.style.display = "block";
    progressBox.textContent = "Scoring the awards…";
    summary.metrics = buildSeasonMetrics(await getMetricsAnalysis(), seasonEntry.league.season);
    applyMetricsToRecap(summary);

    progressBox.style.display = "none";
    content.style.display = "";
    CURRENT_METRICS = summary.metrics;
    content.innerHTML = renderSummary(summary);
    initMetricFilters(content);
    initStandingsToggles(content);
    initBumpFocus(content);
    initStandingsReplay(summary.standingsHistory, summary.playoffTeams);
    initChartTabs();
    initAnimatedDropdowns();
    initScrollAnimations();
    initChartHoverLinking();
    initSectionReveal(content);

    const leagueName = SEASON_CHAIN[SEASON_CHAIN.length - 1].league.name;
    document.title = (SITE_TITLE || leagueName || "League") + " — " + summary.season + " Season";
    document.getElementById("sb-title").textContent = summary.season + " Season";
    document.getElementById("sb-sub").textContent =
      summary.status === "complete" ? `${summary.weeksPlayed} weeks played` : `In progress \u00b7 through Week ${summary.weeksPlayed}`;
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load that view — " + err.message;
    errorBox.style.display = "block";
  }
}

// ===============================================================================================
// Shared bits
// ===============================================================================================

const SN_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const fmt1 = (n) => (n == null || isNaN(n) ? "–" : Number(n).toFixed(1));
const fmt0 = (n) => (n == null || isNaN(n) ? "–" : Math.round(Number(n)).toLocaleString("en-US"));
const signed = (n, digits = 0) => {
  if (n == null || isNaN(n)) return "–";
  const r = Number(n).toFixed(digits);
  return Number(r) > 0 ? `+${r}` : Number(r) === 0 ? (0).toFixed(digits) : r;
};
const toneOf = (n, dead = 0) => (n > dead ? "good" : n < -dead ? "bad" : "flat");

// A section: the yard-line label the rest of the site uses, then the content.
function snSection(id, label, inner) {
  if (!inner) return "";
  return `
    <section class="sn-section" id="${id}">
      <div class="yard-divider">
        <span class="tick"></span><div class="line"></div>
        <span class="label">${escapeHtml(label)}</span>
        <div class="line"></div>
      </div>
      <div class="wrap sn-wrap">${inner}</div>
    </section>`;
}

function snPanel(title, inner, opts = {}) {
  const side = opts.side ? `<span class="sn-panel-side">${opts.side}</span>` : "";
  return `
    <div class="panel sn-panel${opts.cls ? " " + opts.cls : ""}">
      ${title || side ? `<div class="sn-panel-head">${title ? `<h2>${title}</h2>` : ""}${side}</div>` : ""}
      ${inner}
    </div>`;
}

function snTile(label, main, sub, tone) {
  return `<div class="sn-tile${tone ? " sn-tile-" + tone : ""}"><p class="sn-tile-label">${escapeHtml(label)}</p><p class="sn-tile-main">${main}</p>${sub ? `<p class="sn-tile-sub">${sub}</p>` : ""}</div>`;
}

// A player's headshot (an initial when there is none), linked to his page. size: "sm" 40px, "md" 52px, "lg" 72px.
function snPhoto(playerId, name, size = "sm") {
  return playerLinkHtml(playerId, playerPhotoHtml(playerId, name, `player-photo-sm sn-photo sn-photo-${size}`));
}

function posChip(pos) {
  const p = escapeHtml(pos || "");
  return `<span class="sn-pos sn-pos-${p.toLowerCase()}">${p}</span>`;
}

function weekChip(week, extra) {
  return `<span class="sn-chip">Wk ${week}</span>${extra || ""}`;
}

// The luck pill: the site's percent, shaded by size (yellow lucky, blue unlucky).
function luckPill(pct) {
  if (pct == null || isNaN(pct)) return `<span class="sn-luck sn-luck-0">–</span>`;
  const band = pct >= 10 ? 2 : pct >= 3 ? 1 : pct <= -10 ? -2 : pct <= -3 ? -1 : 0;
  return `<span class="sn-luck sn-luck-${band < 0 ? "m" + -band : band}">${signed(pct, 1)}%</span>`;
}

function finishBadge(finish) {
  if (!finish) return "";
  return `<span class="sn-finish sn-finish-${finish.kind}">${escapeHtml(finish.label)}</span>`;
}

// ---- lineups behind a game or a score (kept from the old cards: tap to see who started) ----------

function lineupRows(lineup) {
  return lineup
    .map(
      (p) => `
      <div class="sn-lineup-row">
        <span class="sn-lineup-slot">${escapeHtml(p.slot)}</span>
        <span class="sn-lineup-name">${playerLinkHtml(p.playerId, escapeHtml(p.player))}</span>
        <span class="sn-lineup-pts">${p.points.toFixed(1)}</span>
      </div>`
    )
    .join("");
}

function lineupSectionsHtml(sections) {
  return sections
    .filter((s) => s.lineup && s.lineup.length)
    .map((s) => `<div class="sn-lineup-team"><div class="sn-lineup-head">${escapeHtml(s.teamName)}</div>${lineupRows(s.lineup)}</div>`)
    .join("");
}

const hasLineups = (sections) => (sections || []).some((s) => s.lineup && s.lineup.length);

// ===============================================================================================
// Final Standings (mockup page 1)
// ===============================================================================================

// The title over the standings table. A season still in progress isn't "final" yet.
function standingsLabel(s) {
  if (s.season === "All-Time" || s.status === "complete") return "Final Standings";
  return s.weeksPlayed ? `Standings · Through Week ${s.weeksPlayed}` : "Standings";
}

/*
  rows: SeasonData.standingsRows shape. kind "season" has Exp. W and Schedule; "total" and
  "manual" leave out what they do not have. A phone keeps # / Team / Rec / PF / Luck and puts the rest in
  a line under the team that a tap opens.
*/
function standingsTableHtml(rows, opts = {}) {
  if (!rows || !rows.length) return `<div class="empty-state">No standings yet.</div>`;
  const kind = opts.kind || "season";
  const hasExp = rows.some((r) => r.expWins != null);
  const hasSched = kind === "season" && rows.some((r) => r.sched != null);
  const hasAllPlay = rows.some((r) => r.allPlay);
  const hasLuck = rows.some((r) => r.luckPct != null);
  const cut = opts.playoffTeams && opts.playoffTeams < rows.length ? opts.playoffTeams : null;
  const cols = 6 + (hasAllPlay ? 1 : 0) + (hasExp ? 1 : 0) + (hasLuck ? 1 : 0) + (hasSched ? 1 : 0) + 1;

  const head = `<tr>
      <th class="sn-c-rank">#</th><th class="sn-c-team">Team</th><th class="sn-num">Rec</th><th class="sn-num">PF</th>
      <th class="sn-num sn-opt">PA</th><th class="sn-num sn-opt">Diff</th><th class="sn-num sn-opt">Pts/G</th>
      ${hasAllPlay ? `<th class="sn-num sn-opt">All-play</th>` : ""}${hasExp ? `<th class="sn-num sn-opt">Exp. W</th>` : ""}
      ${hasLuck ? `<th class="sn-num">Luck</th>` : ""}${hasSched ? `<th class="sn-num sn-opt">Schedule</th>` : ""}
    </tr>`;

  const schedText = (r) => (r.schedRank == null ? "" : r.schedRank === 1 ? "toughest" : r.schedRank === r.schedOf ? "easiest" : `#${r.schedRank}`);
  const body = rows
    .map((r, i) => {
      const inPlayoffs = cut != null ? i < cut : false;
      const titles = r.titles ? `<span class="sn-titles" title="${r.titles} title${r.titles === 1 ? "" : "s"}">${"🏆".repeat(Math.min(r.titles, 5))}</span>` : "";
      const more = [
        `PA ${fmt1(r.pa)}`,
        `Diff ${signed(r.diff)}`,
        r.ppg != null ? `${fmt1(r.ppg)} a game` : null,
        r.allPlay ? `All-play ${r.allPlay}` : null,
        r.expWins != null ? `Exp. W ${fmt1(r.expWins)}` : null,
        hasSched && r.sched != null ? `Schedule ${fmt1(r.sched)} (${schedText(r)})` : null,
      ].filter(Boolean);
      return `
      <tr class="sn-st-row${i === cut - 1 ? " sn-cut" : ""}${inPlayoffs ? " sn-in" : ""}" data-sn-toggle>
        <td class="sn-c-rank">${r.rank}</td>
        <td class="sn-c-team"><span class="sn-team"><span class="sn-team-name" data-username="${escapeHtml(r.username || r.name)}">${escapeHtml(r.name)}</span>${titles}${finishBadge(r.finish)}</span></td>
        <td class="sn-num sn-strong">${escapeHtml(r.record)}</td>
        <td class="sn-num">${fmt1(r.pf)}</td>
        <td class="sn-num sn-opt sn-dim">${fmt1(r.pa)}</td>
        <td class="sn-num sn-opt sn-tone-${toneOf(r.diff)}">${signed(r.diff)}</td>
        <td class="sn-num sn-opt">${fmt1(r.ppg)}</td>
        ${hasAllPlay ? `<td class="sn-num sn-opt"><span class="sn-two">${r.allPlay ? escapeHtml(r.allPlay) : "–"}<small>${r.allPlayPct != null ? `${Math.round(r.allPlayPct * 100)}% win rate` : ""}</small></span></td>` : ""}
        ${hasExp ? `<td class="sn-num sn-opt">${fmt1(r.expWins)}</td>` : ""}
        ${hasLuck ? `<td class="sn-num">${luckPill(r.luckPct)}</td>` : ""}
        ${hasSched ? `<td class="sn-num sn-opt"><span class="sn-two">${fmt1(r.sched)}<small class="${r.schedRank === 1 ? "sn-tone-bad" : ""}">${schedText(r)}</small></span></td>` : ""}
      </tr>
      <tr class="sn-st-more" aria-hidden="true"><td colspan="${cols}"><span class="sn-more-line">${more.map(escapeHtml).join(" · ")}</span></td></tr>`;
    })
    .join("");

  return `
    <div class="sn-table-wrap">
      <table class="sn-table sn-standings">
        <thead>${head}</thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// The standings rows for the All-Time page (no schedule, titles instead of a finish).
function totalStandingsRows(s) {
  const avgBy = new Map((s.teamAverages || []).map((t) => [t.userId != null ? t.userId : t.rosterId, t.average]));
  return s.standings.map((t, i) => {
    const gp = (t.wins || 0) + (t.losses || 0) + (t.ties || 0);
    const apGames = (t.overallWins || 0) + (t.overallLosses || 0) + (t.overallTies || 0);
    const apPct = apGames ? ((t.overallWins || 0) + 0.5 * (t.overallTies || 0)) / apGames : null;
    return {
      rank: i + 1,
      name: t.teamName,
      username: t.username || t.teamName,
      record: SeasonData.recordOf(t.wins, t.losses, t.ties),
      pf: t.fpts,
      pa: t.fptsAgainst,
      diff: (t.fpts || 0) - (t.fptsAgainst || 0),
      ppg: avgBy.has(t.userId) ? avgBy.get(t.userId) : avgBy.has(t.rosterId) ? avgBy.get(t.rosterId) : gp ? t.fpts / gp : null,
      allPlay: apGames ? SeasonData.recordOf(t.overallWins, t.overallLosses, t.overallTies) : null,
      allPlayPct: apPct,
      expWins: apPct != null ? apPct * gp : null,
      luckPct: t.luckPct,
      titles: t.championships || 0,
      finish: null,
    };
  });
}

// ===============================================================================================
// Season Grid (mockup page 3)
// ===============================================================================================

function seasonGridHtml(grid) {
  if (!grid || !grid.rows.length) return "";
  const po = grid.playoffCols;
  const weekHead = grid.weeks.map((w) => `<th class="sn-g-h">W${w.week}</th>`).join("");
  const poHead = po.length ? `<th class="sn-g-gap" aria-hidden="true"></th>${po.map((c) => `<th class="sn-g-h" title="Week ${c.week}">${escapeHtml(c.label)}</th>`).join("")}` : "";
  const cell = (x) => {
    if (!x) return `<td class="sn-g-c"><span class="sn-g sn-g-none"></span></td>`;
    const cls = x.top ? "sn-g-top" : x.bottom ? "sn-g-low" : x.result === "W" ? "sn-g-win" : x.result === "T" ? "sn-g-tie" : "sn-g-loss";
    return `<td class="sn-g-c"><span class="sn-g ${cls}" title="${fmt1(x.pts)} · ${x.result === "W" ? "won" : x.result === "T" ? "tied" : "lost"}">${Math.round(x.pts)}</span></td>`;
  };
  const poCell = (x) => {
    if (!x) return `<td class="sn-g-c"><span class="sn-g sn-g-none"></span></td>`;
    if (x.bye) return `<td class="sn-g-c"><span class="sn-g sn-g-bye">bye</span></td>`;
    return `<td class="sn-g-c"><span class="sn-g ${x.won ? "sn-g-pwin" : "sn-g-ploss"}${x.game === "final" && x.won ? " sn-g-champ" : ""}" title="${fmt1(x.pts)} · ${x.won ? "won" : "lost"}">${Math.round(x.pts)}</span></td>`;
  };
  const rows = grid.rows
    .map(
      (r) => `
      <tr>
        <th class="sn-g-team" scope="row"><span data-username="${escapeHtml(r.username)}">${escapeHtml(r.name)}</span></th>
        ${r.cells.map(cell).join("")}
        ${po.length ? `<td class="sn-g-gap" aria-hidden="true"></td>${r.playoffs.map(poCell).join("")}` : ""}
        <td class="sn-g-num sn-strong">${fmt1(r.avg)}</td>
        <td class="sn-g-num sn-dim">${fmt1(r.spread)}</td>
      </tr>`
    )
    .join("");
  const foot = `
      <tr class="sn-g-foot"><th scope="row">League avg</th>${grid.weeks.map((w) => `<td>${Math.round(w.avg)}</td>`).join("")}${po.length ? `<td class="sn-g-gap"></td>${po.map(() => "<td></td>").join("")}` : ""}<td></td><td></td></tr>
      <tr class="sn-g-foot sn-g-foot-top"><th scope="row">Top scorer</th>${grid.weeks.map((w) => `<td title="${escapeHtml(w.topName)}">${escapeHtml(w.topTag)}</td>`).join("")}${po.length ? `<td class="sn-g-gap"></td>${po.map(() => "<td></td>").join("")}` : ""}<td></td><td></td></tr>`;

  const t = grid.tiles;
  const tiles = [
    t.mostTop && snTile("Most weeks on top", `${t.mostTop.count} week${t.mostTop.count === 1 ? "" : "s"}`, `${escapeHtml(t.mostTop.names.join(" and "))} had the league's top score ${t.mostTop.count === 1 ? "once" : `${t.mostTop.count} times`}`, "good"),
    t.steadiest && snTile("Most consistent", escapeHtml(t.steadiest.name), `spread of ${fmt1(t.steadiest.spread)}${t.wildest ? ` · wildest: ${escapeHtml(t.wildest.name)} at ${fmt1(t.wildest.spread)}` : ""}`),
  ].filter(Boolean);

  return `
    <div class="panel sn-panel sn-grid-panel">
      <div class="sn-panel-head"><h2>Every Score, Every Week</h2>
        <span class="sn-key"><i class="sn-g sn-g-win"></i>win <i class="sn-g sn-g-top"></i>week's top <i class="sn-g sn-g-low"></i>week's lowest</span>
      </div>
      <div class="sn-table-wrap sn-grid-wrap">
        <table class="sn-grid">
          <thead><tr><th class="sn-g-team"></th>${weekHead}${poHead}<th class="sn-g-h">Avg</th><th class="sn-g-h">Spread</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot>${foot}</tfoot>
        </table>
      </div>
    </div>
    ${tiles.length ? `<div class="sn-tiles sn-tiles-${tiles.length}">${tiles.join("")}</div>` : ""}`;
}

// ===============================================================================================
// The playoff bracket (mockup page 6)
// ===============================================================================================

function bracketGameHtml(item, lineups) {
  if (item.kind === "bye") {
    return `
      <div class="sn-bk-game sn-bk-bye${item.route ? " sn-bk-route" : ""}">
        <div class="sn-bk-label">Bye</div>
        <div class="sn-bk-team sn-bk-win"><span class="sn-bk-seed">${item.seed || ""}</span><span class="sn-bk-name">${escapeHtml(item.name)}</span><span class="sn-bk-score"></span></div>
        <div class="sn-bk-foot">${item.seed ? `seed ${item.seed} rests` : "rests"}</div>
      </div>`;
  }
  const decided = item.teams.some((t) => t.won);
  const team = (t) => `
      <div class="sn-bk-team${t.won ? " sn-bk-win" : decided ? " sn-bk-lose" : ""}">
        <span class="sn-bk-seed">${t.seed || ""}</span>
        <span class="sn-bk-name">${escapeHtml(t.name)}</span>
        <span class="sn-bk-score">${t.score != null ? fmt1(t.score) : ""}</span>
      </div>`;
  const foot = item.margin != null && item.winnerName ? `<div class="sn-bk-foot">${escapeHtml(item.winnerName)} by ${fmt1(item.margin)}</div>` : "";
  const cls = `sn-bk-game${item.route ? " sn-bk-route" : ""}${item.final ? " sn-bk-final" : ""}${item.third ? " sn-bk-third" : ""}`;
  const inner = `<div class="sn-bk-label">${escapeHtml(item.label)}</div>${item.teams.map(team).join("")}${foot}`;
  if (!hasLineups(lineups)) return `<div class="${cls}">${inner}</div>`;
  return `<details class="${cls} sn-bk-open"><summary>${inner}</summary><div class="sn-lineups">${lineupSectionsHtml(lineups)}</div></details>`;
}

// Finds the old bracket's lineups for a game in the new model (matched by the two names).
function bracketLineupsFor(oldBracket, item) {
  if (!oldBracket || item.kind !== "game") return null;
  const names = item.teams.map((t) => t.name).sort().join("|");
  for (const round of oldBracket.rounds || []) {
    for (const g of round.games) {
      if ([g.team1.name, g.team2.name].sort().join("|") === names && (!!g.isChampionship === !!item.final)) {
        return [
          { teamName: g.team1.name, lineup: g.team1.lineup || [] },
          { teamName: g.team2.name, lineup: g.team2.lineup || [] },
        ];
      }
    }
  }
  return null;
}

// "Who has won, by seed": every champion on record, by their regular-season seed.
function seedTitlesHtml(year) {
  if (typeof HistoryData === "undefined" || !SEASON_CHAIN) return "";
  let podiums;
  let ledger;
  try {
    ledger = HistoryData.buildLedger(SEASON_CHAIN, MANUAL_HISTORY);
    podiums = HistoryData.podiumsBySeed(ledger);
  } catch (e) {
    return "";
  }
  const champs = ledger.filter((s) => s.champion);
  if (!champs.length) return "";
  const thisYear = champs.find((s) => String(s.year) === String(year));
  const rows = podiums.rows.filter((r) => r.seed <= 6 || r.title > 0);
  const first = champs[0].year;
  const last = champs[champs.length - 1].year;
  return `
    <div class="sn-seeds">
      <h3>Who has won, by seed</h3>
      <p class="sn-sub">regular-season seed of each champion, ${first} to ${last}</p>
      ${rows
        .map(
          (r) => `
        <div class="sn-seed-row">
          <span class="sn-seed-label">Seed ${r.seed}</span>
          <span class="sn-dots">${r.title ? Array.from({ length: r.title }, (_, i) => `<i class="sn-dot${thisYear && thisYear.champion.seed === r.seed && i === r.title - 1 ? " sn-dot-now" : ""}${r.seed === 1 ? " sn-dot-gold" : ""}"></i>`).join("") : `<span class="sn-dim">–</span>`}</span>
          <span class="sn-seed-n">${r.title} title${r.title === 1 ? "" : "s"}</span>
        </div>`
        )
        .join("")}
    </div>`;
}

function bracketHtml(model, opts = {}) {
  if (!model || !model.columns.length) return `<div class="empty-state">No bracket yet — check back once the playoffs start.</div>`;
  const cols = model.columns
    .map(
      (col) => `
      <div class="sn-bk-col">
        <div class="sn-bk-round">${escapeHtml(col.label)}${col.week ? ` · Week ${col.week}` : ""}</div>
        <div class="sn-bk-items">${col.items.filter((x) => !x.third).map((x) => bracketGameHtml(x, bracketLineupsFor(opts.oldBracket, x))).join("")}</div>
        ${col.items.filter((x) => x.third).map((x) => `<div class="sn-bk-thirdwrap">${bracketGameHtml(x, bracketLineupsFor(opts.oldBracket, x))}</div>`).join("")}
      </div>`
    )
    .join("");

  const c = model.champion;
  let champCard = "";
  if (c) {
    const mvp = opts.finalsMvp;
    champCard = `
      <div class="sn-champ-card">
        <p class="sn-eyebrow">${escapeHtml(String(opts.year || ""))} Champion</p>
        <p class="sn-champ-name${String(c.name).length > 11 ? " sn-long" : ""}">${escapeHtml(c.name)}</p>
        ${SeasonData.championStory(c) ? `<p class="sn-champ-story">${escapeHtml(SeasonData.championStory(c))}</p>` : ""}
        ${mvp ? `<div class="sn-champ-mvp">${playerLinkHtml(mvp.playerId, playerPhotoHtml(mvp.playerId, mvp.player, "player-photo-sm"))}<span><span class="sn-tile-label">Finals MVP</span><b>${playerLinkHtml(mvp.playerId, escapeHtml(mvp.player))}</b> <span class="sn-dim">${fmt1(mvp.points)} pts</span></span></div>` : ""}
      </div>`;
  }
  const seeds = seedTitlesHtml(opts.year);
  return `
    <div class="sn-bracket-layout">
      <div class="panel sn-panel sn-bracket-panel"><div class="sn-bracket" style="--cols:${model.columns.length}">${cols}</div></div>
      ${champCard || seeds ? `<div class="sn-bracket-side">${champCard}${seeds ? `<div class="panel sn-panel">${seeds}</div>` : ""}</div>` : ""}
    </div>`;
}

// Kept for anything that still hands over the old bracket shape: draws it with the new bracket.
function renderBracket(bracketData, opts = {}) {
  const model = SeasonData.legacyBracket(bracketData, opts.standings || []);
  return bracketHtml(model, { ...opts, oldBracket: bracketData, finalsMvp: bracketData && bracketData.champion ? bracketData.champion.mvp : null });
}

// ===============================================================================================
// Points by starting slot (mockup page 8, without the league-average row and the notes)
// ===============================================================================================

function renderPositionTable(positionTable) {
  const t = SeasonData.slotTable(positionTable);
  if (!t) return `<div class="empty-state">No lineup data available for this season.</div>`;
  const head = t.columns.map((c) => `<th class="sn-num">${escapeHtml(c.label)}</th>`).join("");
  const rows = t.rows
    .map((r) => {
      const cells = r.cells
        .map((x, i) => {
          if (!x) return `<td class="sn-num" data-label="${escapeHtml(t.columns[i].label)}"><span class="sn-slot sn-slot-none">–</span></td>`;
          const cls = x.best ? " sn-slot-best" : x.worst ? " sn-slot-worst" : "";
          return `<td class="sn-num" data-label="${escapeHtml(t.columns[i].label)}"><span class="sn-slot${cls}"><b>${x.v.toFixed(1)}</b><small class="sn-tone-${toneOf(x.gap, 0.05)}">${signed(x.gap, 1)}</small></span></td>`;
        })
        .join("");
      return `
      <tr>
        <th class="sn-slot-team" scope="row"><span data-username="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span></th>
        ${cells}
        <td class="sn-num"><span class="sn-slot sn-slot-total"><b>${r.total.toFixed(1)}</b><small class="sn-tone-${toneOf(r.totalGap, 0.05)}">${signed(r.totalGap, 1)}</small></span></td>
        <td class="sn-c-chip">${r.strongest ? `<span class="sn-gap-chip sn-gap-good">${escapeHtml(r.strongest.label)} ${signed(r.strongest.gap, 1)}</span>` : ""}</td>
        <td class="sn-c-chip">${r.weakest ? `<span class="sn-gap-chip sn-gap-bad">${escapeHtml(r.weakest.label)} ${signed(r.weakest.gap, 1)}</span>` : ""}</td>
      </tr>`;
    })
    .join("");
  return `
    <div class="sn-table-wrap">
      <table class="sn-table sn-slots">
        <thead><tr><th class="sn-slot-team">Team</th>${head}<th class="sn-num">Total</th><th class="sn-c-chip">Strongest</th><th class="sn-c-chip">Weakest</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ===============================================================================================
// Season Summary (mockup page 13)
// ===============================================================================================

const RECAP_INTRO_VARIANTS = [
  (record, seed) => `went ${record} in the regular season${seed ? ` as the #${seed} seed` : ""}, then `,
  (record, seed) => `put together a ${record} regular season${seed ? ` (the #${seed} seed)` : ""}, then `,
  (record, seed) => `finished the regular season ${record}${seed ? `, locking up the #${seed} seed` : ""}, then `,
  (record, seed) => `cruised to a ${record} record in the regular season${seed ? ` as the #${seed} seed` : ""}, then `,
];

const RECAP_RUN_VARIANTS = {
  1: [(r) => `won the championship over ${r}`, (r) => `took home the title with a win over ${r}`],
  2: [
    (r) => `rolled through the playoffs and beat ${r} in the Championship`,
    (r) => `powered through two playoff rounds, finishing off ${r} in the Championship`,
    (r) => `made quick work of the playoffs, beating ${r} for the title`,
  ],
  default: [
    (r, n) => `ran the table through a ${n}-round playoff bracket, capping it off with a win over ${r} in the Championship`,
    (r, n) => `battled through ${n} rounds of playoffs before beating ${r} to win it all`,
    (r, n) => `survived a grueling ${n}-round playoff run, sealing the title against ${r} in the Championship`,
  ],
};

// Deterministic hash so the SAME season always gets the SAME phrasing on repeat visits.
function seasonSeed(season) {
  let hash = 0;
  const str = String(season);
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash;
}

function championshipNarrative(c) {
  const seed = seasonSeed(c.teamName + "|" + (c.runnerUpName || ""));
  const teamName = `<strong>${escapeHtml(c.teamName)}</strong>`;
  const runnerUp = c.runnerUpName ? `<strong>${escapeHtml(c.runnerUpName)}</strong>` : "the field";
  const introText = c.regularSeasonRecord ? RECAP_INTRO_VARIANTS[seed % RECAP_INTRO_VARIANTS.length](escapeHtml(c.regularSeasonRecord), c.seed) : "";
  const roundsKey = !c.roundsPlayed || c.roundsPlayed <= 1 ? 1 : c.roundsPlayed === 2 ? 2 : "default";
  const runVariants = RECAP_RUN_VARIANTS[roundsKey];
  const runText = runVariants[seed % runVariants.length](runnerUp, c.roundsPlayed);
  return `${teamName} ${introText}${runText}.`;
}

const RECAP_MVP_DRAFT_VARIANTS = [
  (player, round) => `${player}, a Round ${round} pick, was the engine behind it all — the team's top performer from the draft all the way to the championship.`,
  (player, round) => `${player} proved to be a steal in Round ${round}, turning into the team's top performer all year.`,
  (player, round) => `Drafted in Round ${round}, ${player} developed into the team's offensive centerpiece from day one.`,
];
const RECAP_MVP_VARIANTS = [
  (player) => `${player} was the engine behind it all — the team's top performer all season long.`,
  (player) => `${player} carried the load all year as the team's clear top scorer.`,
  (player) => `No player meant more to this team's season than ${player}, its top scorer from Week 1 through the championship.`,
];

function championshipMvpNarrative(c) {
  if (!c.seasonMVP) return "";
  const seed = seasonSeed(c.teamName + "|" + c.seasonMVP.player);
  const player = playerLinkHtml(c.seasonMVP.playerId, `<strong>${escapeHtml(c.seasonMVP.player)}</strong>`);
  if (c.mvpDraftRound) return RECAP_MVP_DRAFT_VARIANTS[seed % RECAP_MVP_DRAFT_VARIANTS.length](player, c.mvpDraftRound);
  return RECAP_MVP_VARIANTS[seed % RECAP_MVP_VARIANTS.length](player);
}

/*
  League records this season set, as table rows: { tag, tone, who, detail }. Tone "good" is an honor
  (gold tag), "bad" a roast (blue tag).
*/
function buildSeasonRecordHighlights(records, season) {
  if (!records) return [];
  const seasonStr = String(season);
  const matches = (entry) => entry && String(entry.season) === seasonStr;
  const who = (r) => escapeHtml(r.username || r.teamName || "Unknown");
  const name = (entry, field) => escapeHtml(entry[`${field}Username`] || entry[field] || "Unknown");
  const pts = (n) => (n != null && !isNaN(n) ? Number(n).toFixed(1) : null);
  const out = [];
  const add = (tag, tone, whoHtml, detail) => out.push({ tag, tone, who: whoHtml, detail });

  if (matches(records.mostRegularSeasonPoints)) {
    const r = records.mostRegularSeasonPoints;
    add("Highest scoring season", "good", who(r), `${pts(r.total) ? `${pts(r.total)} points for` : "The most regular-season points ever"}${r.topScorer ? `, powered by ${playerLinkHtml(r.topScorer.playerId, escapeHtml(r.topScorer.player))}` : ""}`);
  }
  if (matches(records.fewestRegularSeasonPoints)) add("Lowest scoring season", "bad", who(records.fewestRegularSeasonPoints), "The fewest regular-season points ever");
  if (matches(records.highestWeekScore)) {
    const r = records.highestWeekScore;
    add("Highest single week", "good", who(r), `${pts(r.points) ? `${pts(r.points)} points` : "The most points in a week ever"}${r.week ? ` in Week ${r.week}` : ""}${r.topScorer ? `, led by ${playerLinkHtml(r.topScorer.playerId, escapeHtml(r.topScorer.player))}` : ""}`);
  }
  if (matches(records.lowestWeekScore)) {
    const r = records.lowestWeekScore;
    add("Lowest single week", "bad", who(r), `${pts(r.points) ? `${pts(r.points)} points` : "The fewest points in a week ever"}${r.week ? ` in Week ${r.week}` : ""}`);
  }
  if (matches(records.biggestBlowout)) {
    const r = records.biggestBlowout;
    add("Biggest blowout", "good", `${name(r, "winner")} over ${name(r, "loser")}`, r.margin != null ? `A margin of ${Number(r.margin).toFixed(1)}${r.week ? ` in Week ${r.week}` : ""}` : "The widest margin ever");
  }
  if (matches(records.closestGame)) {
    const r = records.closestGame;
    add("Closest game", "good", `${name(r, "winner")} over ${name(r, "loser")}`, r.margin != null ? `Decided by ${Number(r.margin).toFixed(2)}${r.week ? ` in Week ${r.week}` : ""}` : "The narrowest margin ever");
  }
  if (matches(records.mostBenchPointsLeft)) add("Most points left on the bench", "bad", who(records.mostBenchPointsLeft), "More than anyone in a single week, ever");
  if (matches(records.mostConsistentSeason)) add("Most consistent season", "good", who(records.mostConsistentSeason), "The steadiest scoring of any season");
  if (matches(records.leastConsistentSeason)) add("Most boom or bust", "bad", who(records.leastConsistentSeason), "The wildest scoring of any season");
  if (matches(records.toughestSchedule)) {
    const r = records.toughestSchedule;
    add("Toughest schedule", "bad", who(r), r.avgOpponentPF != null ? `Opponents averaged ${Number(r.avgOpponentPF).toFixed(1)} points, the hardest of any season` : "The hardest schedule of any season");
  }
  if (matches(records.easiestSchedule)) {
    const r = records.easiestSchedule;
    add("Easiest schedule", "good", who(r), r.avgOpponentPF != null ? `Opponents averaged ${Number(r.avgOpponentPF).toFixed(1)} points, the softest of any season` : "The softest schedule of any season");
  }
  if (matches(records.bestValuePick)) add("Best draft steal", "good", who(records.bestValuePick), `${playerLinkHtml(records.bestValuePick.playerId, escapeHtml(records.bestValuePick.player))}, the best value pick ever`);
  if (matches(records.worstValuePick)) add("Biggest draft bust", "bad", who(records.worstValuePick), `${playerLinkHtml(records.worstValuePick.playerId, escapeHtml(records.worstValuePick.player))}, the costliest pick ever`);
  return out;
}

function summaryTile(label, name, sub, opts = {}) {
  if (!name) return "";
  const photo = opts.player ? snPhoto(opts.player.playerId, opts.player.player, opts.wide ? "lg" : "md") : "";
  return `
    <div class="sn-sum-tile${opts.wide ? " sn-sum-wide" : ""}${opts.accent ? " sn-sum-accent" : ""}${photo ? " sn-has-photo" : ""}">
      ${photo}
      <div class="sn-sum-text">
        <p class="sn-tile-label">${escapeHtml(label)}</p>
        <p class="sn-sum-name${opts.tone ? " sn-name-" + opts.tone : ""}">${name}</p>
        ${sub ? `<p class="sn-tile-sub">${sub}</p>` : ""}
      </div>
    </div>`;
}

function renderChampionshipRecap(recap, allTimeRecords, seasonStats, extras = {}) {
  const c = recap && recap.champion;
  const stats = seasonStats || {};
  const hasSeasonStats = stats.bestValuePick || stats.worstValuePick || stats.pointsLeader || stats.leagueMvp;
  if (!c && !hasSeasonStats) return "";
  const season = recap ? recap.season : stats.pointsLeader ? stats.pointsLeader.season : extras.season || "";
  const highlights = c ? buildSeasonRecordHighlights(allTimeRecords, season) : [];
  const ace = extras.championsAce;
  const link = (p) => playerLinkHtml(p.playerId, escapeHtml(p.player));

  let champCard = "";
  if (c) {
    const champRow = extras.champRow;
    const chips = [
      c.regularSeasonRecord ? `${escapeHtml(c.regularSeasonRecord)} regular season` : null,
      c.seed ? `#${c.seed} seed` : null,
      champRow ? `${fmt1(champRow.pf)} points for` : null,
      champRow && champRow.allPlay ? `all-play ${escapeHtml(champRow.allPlay)}` : null,
    ].filter(Boolean);
    const fs = extras.finalScore;
    const finalLine =
      fs && fs.length === 2 && fs[0].score != null && fs[1].score != null
        ? `
        <div class="sn-final">
          <div class="sn-final-side"><b>${escapeHtml(fs[0].name)}</b><small>${fs[0].seed ? `seed ${fs[0].seed}` : ""}${extras.champBye ? " · bye in round 1" : ""}</small></div>
          <div class="sn-final-score"><b>${fmt1(fs[0].score)}</b><span>Final</span><b class="sn-dim">${fmt1(fs[1].score)}</b></div>
          <div class="sn-final-side sn-right" data-no-mine><b>${escapeHtml(fs[1].name)}</b><small>${fs[1].seed ? `seed ${fs[1].seed} · ` : ""}runner-up</small></div>
        </div>`
        : "";
    champCard = `
      <div class="sn-champ-big">
        <p class="sn-eyebrow">${escapeHtml(String(recap.season))} Champion</p>
        <p class="sn-champ-huge">${escapeHtml(c.teamName)}</p>
        ${chips.length ? `<div class="sn-chips">${chips.map((x) => `<span class="sn-gold-chip">${x}</span>`).join("")}</div>` : ""}
        <p class="sn-narrative">${championshipNarrative(c)} ${championshipMvpNarrative(c)}</p>
        ${finalLine}
      </div>`;
  }

  const tiles = [
    stats.leagueMvp && summaryTile("League MVP", link(stats.leagueMvp), `${stats.leagueMvp.wins.toFixed(1)} wins above replacement${stats.leagueMvp.owner ? ` · ${escapeHtml(stats.leagueMvp.owner)}` : ""}`, { player: stats.leagueMvp }),
    stats.pointsLeader && summaryTile("Season points leader", link(stats.pointsLeader), `${stats.pointsLeader.points.toFixed(1)} total points`, { player: stats.pointsLeader }),
    ace && summaryTile("Champion's ace", link(ace), `${ace.points.toFixed(1)} points as a starter for ${escapeHtml(ace.team || "the champion")}, playoffs included`, { wide: true, accent: true, tone: "gold", player: ace }),
    stats.bestValuePick && summaryTile("Best draft steal", link(stats.bestValuePick), `Round ${stats.bestValuePick.round}, pick ${stats.bestValuePick.pickInRound} by ${escapeHtml(stats.bestValuePick.username || stats.bestValuePick.teamName)} · ${stats.bestValuePick.points.toFixed(1)} pts`, { tone: "good", player: stats.bestValuePick }),
    stats.worstValuePick && summaryTile("Biggest draft bust", link(stats.worstValuePick), `Round ${stats.worstValuePick.round}, pick ${stats.worstValuePick.pickInRound} by ${escapeHtml(stats.worstValuePick.username || stats.worstValuePick.teamName)} · ${stats.worstValuePick.points.toFixed(1)} pts`, { tone: "bad", player: stats.worstValuePick }),
  ].filter(Boolean);

  const records = highlights.length
    ? snPanel(
        "Records Set This Season",
        `<div class="sn-records">${highlights
          .map(
            (h) => `
          <div class="sn-record-row">
            <span class="sn-tag sn-tag-${h.tone}">${escapeHtml(h.tag)}</span>
            <span class="sn-record-who">${h.who}</span>
            <span class="sn-record-detail">${h.detail}</span>
          </div>`
          )
          .join("")}</div>`,
        { side: `All-time league records set in ${escapeHtml(String(season))}`, cls: "sn-records-panel" }
      )
    : "";

  return snSection(
    "sn-summary",
    "Season Summary",
    `
      <div class="sn-summary${c ? "" : " sn-summary-nochamp"}">
        ${champCard}
        ${tiles.length ? `<div class="sn-sum-tiles">${tiles.join("")}</div>` : ""}
      </div>
      ${records}`
  );
}

// ===============================================================================================
// Standings Over Time (mockup page 14)
// ===============================================================================================

// Turns computeStandingsHistory()'s snapshots into one rank series per team (the replay and tests use it).
function standingsHistoryToRankSeries(standingsHistory) {
  const rosterOrder = standingsHistory[0].standings.map((s) => s.rosterId);
  return rosterOrder.map((rosterId, i) => {
    const first = standingsHistory[0].standings.find((s) => s.rosterId === rosterId);
    const points = standingsHistory.map((snap) => {
      const rank = snap.standings.findIndex((s) => s.rosterId === rosterId) + 1;
      return { x: `W${snap.week}`, y: rank || null };
    });
    return { name: (first && (first.username || first.teamName)) || "Unknown", color: MULTI_LINE_COLORS[i % MULTI_LINE_COLORS.length], points };
  });
}

// The bump chart: gray lines for everyone, three teams in color, every line labeled at its end.
function bumpChartSvg(model, playoffTeams) {
  const n = model.teams;
  const W = 1000;
  const rowH = 34;
  const top = 22;
  const left = 40;
  const right = 230;
  const H = top + rowH * (n - 1) + 40;
  const xs = model.weeks.map((_, i) => left + ((W - left - right) * i) / Math.max(1, model.weeks.length - 1));
  const y = (rank) => top + (rank - 1) * rowH;
  const story = new Map(model.stories.map((s) => [s.rosterId, s]));
  const band = playoffTeams && playoffTeams < n ? `<rect class="sn-bump-band" x="0" y="${y(1) - rowH / 2}" width="${W}" height="${rowH * playoffTeams}"></rect><line class="sn-bump-cut" x1="0" x2="${W}" y1="${y(playoffTeams) + rowH / 2}" y2="${y(playoffTeams) + rowH / 2}"></line>` : "";
  const ranksAxis = Array.from({ length: n }, (_, i) => `<text class="sn-bump-axis" x="10" y="${y(i + 1) + 4}">${i + 1}</text>`).join("");
  const weeksAxis = model.weeks.map((w, i) => `<text class="sn-bump-axis" x="${xs[i]}" y="${H - 8}" text-anchor="middle">W${w}</text>`).join("");
  const ordered = [...model.lines].sort((a, b) => (story.has(a.rosterId) ? 1 : 0) - (story.has(b.rosterId) ? 1 : 0));
  const lines = ordered
    .map((l) => {
      const s = story.get(l.rosterId);
      const tone = s ? s.tone : "gray";
      const pts = l.ranks.map((r, i) => (r != null ? `${xs[i]},${y(r)}` : null)).filter(Boolean).join(" ");
      const dots = l.ranks.map((r, i) => (r != null ? `<circle cx="${xs[i]}" cy="${y(r)}" r="${s ? 5 : 3}"></circle>` : "")).join("");
      const lastI = l.ranks.length - 1;
      return `<g class="sn-bump-line sn-bump-${tone}" data-bump="${escapeHtml(String(l.rosterId))}"><polyline points="${pts}"></polyline>${dots}<text class="sn-bump-label" x="${xs[lastI] + 16}" y="${y(l.ranks[lastI]) + 4}"><tspan class="sn-bump-name">${escapeHtml(l.name)}</tspan><tspan class="sn-bump-rec" dx="8">${escapeHtml(l.record)}</tspan></text></g>`;
    })
    .join("");
  return `<svg class="sn-bump" viewBox="0 0 ${W} ${H}" role="img" aria-label="Every team's rank after each week">${band}${ranksAxis}${weeksAxis}${lines}</svg>`;
}

function renderStandingsReplaySection(standingsHistory, playoffTeams, summary) {
  if (!standingsHistory || standingsHistory.length < 2) return "";
  const model = SeasonData.bumpModel(standingsHistory, summary || null);
  const legend = model
    ? `<div class="sn-bump-legend">${model.stories.map((s) => `<span class="sn-legend-item"><i class="sn-swatch sn-swatch-${s.tone}"></i>${escapeHtml(s.name)}, ${escapeHtml(s.note)}</span>`).join("")}<span class="sn-legend-item"><i class="sn-swatch sn-swatch-gray"></i>everyone else</span></div>`
    : "";
  return `
      <div class="panel sn-panel">
        <div class="sn-panel-head sn-head-wrap">
          ${legend}
          <div class="chart-tabs sn-tabs">
            <button type="button" class="chart-tab active" data-chart-tab="chart">Rank Chart</button>
            <button type="button" class="chart-tab" data-chart-tab="replay">Replay</button>
          </div>
        </div>
        <div class="chart-tab-panel" data-chart-panel="replay" style="display:none;">
          <div class="replay-controls">
            <button class="replay-btn" id="replay-play-btn" type="button">▶ Play</button>
            <input type="range" class="replay-slider" id="replay-slider" min="1" max="${standingsHistory.length}" value="1" />
            <span class="replay-week-label" id="replay-week-label">Week ${standingsHistory[0].week}</span>
          </div>
          <div class="replay-bars" id="replay-bars" data-playoff-teams="${playoffTeams || ""}"></div>
        </div>
        <div class="chart-tab-panel" data-chart-panel="chart">
          <div class="sn-bump-wrap">${model ? bumpChartSvg(model, playoffTeams) : ""}</div>
        </div>
      </div>`;
}

let REPLAY_TIMER = null;
let REPLAY_WEEK_INDEX = 0;
let REPLAY_SNAPSHOTS = [];
const REPLAY_ROW_HEIGHT = 36;

function initStandingsReplay(standingsHistory, playoffTeams) {
  if (REPLAY_TIMER) {
    clearInterval(REPLAY_TIMER);
    REPLAY_TIMER = null;
  }
  if (!standingsHistory || standingsHistory.length < 2) return;
  REPLAY_SNAPSHOTS = standingsHistory;
  REPLAY_WEEK_INDEX = 0;
  const container = document.getElementById("replay-bars");
  if (!container) return;
  const rosterOrder = standingsHistory[0].standings.map((s) => s.rosterId);
  container.style.height = `${REPLAY_ROW_HEIGHT * rosterOrder.length}px`;
  const playoffLine =
    playoffTeams && playoffTeams < rosterOrder.length
      ? `<div class="replay-playoff-line" style="top:${playoffTeams * REPLAY_ROW_HEIGHT}px;"><span class="replay-playoff-line-label">Playoff Line</span></div>`
      : "";
  container.innerHTML =
    playoffLine +
    rosterOrder
      .map(
        (rid) => `
      <div class="replay-row" id="replay-row-${rid}" style="top:0px;">
        <span class="replay-rank"></span>
        <span class="replay-team-name"></span>
        <span class="replay-record"></span>
      </div>`
      )
      .join("");
  renderReplayWeek(0);
  const slider = document.getElementById("replay-slider");
  const playBtn = document.getElementById("replay-play-btn");
  slider.oninput = () => {
    stopReplay();
    REPLAY_WEEK_INDEX = Number(slider.value) - 1;
    renderReplayWeek(REPLAY_WEEK_INDEX);
  };
  playBtn.onclick = () => {
    if (REPLAY_TIMER) {
      stopReplay();
      return;
    }
    if (REPLAY_WEEK_INDEX >= REPLAY_SNAPSHOTS.length - 1) REPLAY_WEEK_INDEX = 0;
    playBtn.textContent = "⏸ Pause";
    REPLAY_TIMER = setInterval(() => {
      REPLAY_WEEK_INDEX += 1;
      if (REPLAY_WEEK_INDEX >= REPLAY_SNAPSHOTS.length) {
        stopReplay();
        REPLAY_WEEK_INDEX = REPLAY_SNAPSHOTS.length - 1;
        return;
      }
      renderReplayWeek(REPLAY_WEEK_INDEX);
    }, 900);
  };
}

function stopReplay() {
  if (REPLAY_TIMER) {
    clearInterval(REPLAY_TIMER);
    REPLAY_TIMER = null;
  }
  const playBtn = document.getElementById("replay-play-btn");
  if (playBtn) playBtn.textContent = "▶ Play";
}

function renderReplayWeek(index) {
  const snapshot = REPLAY_SNAPSHOTS[index];
  if (!snapshot) return;
  snapshot.standings.forEach((s, rank) => {
    const row = document.getElementById(`replay-row-${s.rosterId}`);
    if (!row) return;
    row.style.top = `${rank * REPLAY_ROW_HEIGHT}px`;
    row.querySelector(".replay-rank").textContent = `${rank + 1}.`;
    row.querySelector(".replay-team-name").textContent = s.username || s.teamName;
    row.querySelector(".replay-record").textContent = `${s.wins}-${s.losses}${s.ties ? "-" + s.ties : ""}`;
  });
  const weekLabel = document.getElementById("replay-week-label");
  if (weekLabel) weekLabel.textContent = `Week ${snapshot.week}`;
  const slider = document.getElementById("replay-slider");
  if (slider) slider.value = index + 1;
}

// ===============================================================================================
// Power Rank History (mockup page 15)
// ===============================================================================================

// Each team's own clinched / eliminated moment in a season's Playoff Odds (kept for the tests and the
// odds grid's result chips agree with it).
function findPlayoffOddsAnnotations(playoffOddsDataset) {
  const annotations = [];
  Object.entries(playoffOddsDataset || {}).forEach(([team, weekly]) => {
    for (let i = 0; i < weekly.length; i++) {
      if (weekly[i] != null && weekly[i] >= 99.5 && weekly.slice(i).every((v) => v != null && v >= 99.5)) {
        annotations.push({ seriesName: team, pointIndex: i, label: `Clinched — Wk ${i + 1}`, color: "var(--good)", direction: "down" });
        break;
      }
    }
    for (let i = 0; i < weekly.length; i++) {
      if (weekly[i] != null && weekly[i] <= 0.5 && weekly.slice(i).every((v) => v != null && v <= 0.5)) {
        annotations.push({ seriesName: team, pointIndex: i, label: `Eliminated — Wk ${i + 1}`, color: "var(--bad)", direction: "up" });
        break;
      }
    }
  });
  return annotations;
}

// Two teams on the same PR Score share their places (6th and 7th are both 6.5).
const rankLabel = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function renderPowerRankHistorySection(season) {
  if (!POWER_RANK_CSV_HISTORY || !POWER_RANK_CSV_HISTORY.seasons) return "";
  const yearData = POWER_RANK_CSV_HISTORY.seasons[String(season)];
  if (!yearData || !yearData.ranks) return "";
  const grid = SeasonData.rankGrid(yearData.ranks);
  if (!grid) return "";
  const hasUnknowns = Object.keys(yearData.ranks).some((k) => k.startsWith("unknown-"));

  const weekHead = Array.from({ length: grid.weeks }, (_, i) => `<th class="sn-g-h">W${i + 1}</th>`).join("");
  const rankRows = grid.rows
    .map(
      (r) => `
      <tr>
        <th class="sn-g-team" scope="row"><span data-username="${escapeHtml(r.key)}">${escapeHtml(r.name)}</span></th>
        ${grid.hasPre ? `<td class="sn-g-c">${r.pre ? `<span class="sn-pr sn-pr-${r.pre.band}">${rankLabel(r.pre.v)}</span>` : ""}</td>` : ""}
        ${r.cells.map((x) => `<td class="sn-g-c">${x ? `<span class="sn-pr sn-pr-${x.band}">${rankLabel(x.v)}</span>` : `<span class="sn-pr sn-pr-none"></span>`}</td>`).join("")}
        <td class="sn-g-num">${r.move == null ? "" : r.move > 0 ? `<span class="sn-tone-good">▲ ${rankLabel(r.move)}</span>` : r.move < 0 ? `<span class="sn-tone-bad">▼ ${rankLabel(-r.move)}</span>` : `<span class="sn-dim">even</span>`}</td>
      </tr>`
    )
    .join("");
  const rankPanel = snPanel(
    "Power Rank By Week",
    `<div class="sn-table-wrap sn-grid-wrap"><table class="sn-grid sn-pr-grid"><thead><tr><th class="sn-g-team"></th>${grid.hasPre ? `<th class="sn-g-h">Pre</th>` : ""}${weekHead}<th class="sn-g-h">${grid.hasPre ? "vs Pre" : ""}</th></tr></thead><tbody>${rankRows}</tbody></table></div>${hasUnknowns ? `<p class="sn-note">Some teams from this season couldn't be matched to a manager and are labeled by their preseason rank.</p>` : ""}`,
    { side: "1 is best · sorted by latest rank" }
  );

  // Power Score History: every team on one chart (lower is better), hover a line to pick a team out.
  let scorePanel = "";
  const sc = yearData.scores ? SeasonData.scoreCards(yearData.scores) : null;
  if (sc) {
    const nameOf = new Map(grid.rows.map((r) => [r.key, r.name]));
    const series = sc.cards.map((c, i) => ({ name: nameOf.get(c.key) || c.name, color: MULTI_LINE_COLORS[i % MULTI_LINE_COLORS.length], points: c.pts }));
    scorePanel = snPanel("Power Score History", `<div class="sn-line-chart">${Charts.multiLineChart(series, { invertY: true, formatter: (v) => v.toFixed(2) })}</div>`, {
      side: "lower is better · hover a line to pick out a team",
    });
  }

  let oddsPanel = "";
  const og = yearData.playoffOdds ? SeasonData.oddsGrid(yearData.playoffOdds, grid.rows.map((r) => r.key)) : null;
  if (og) {
    const nameOf = new Map(grid.rows.map((r) => [r.key, r.name]));
    const head = Array.from({ length: og.weeks }, (_, i) => `<th class="sn-g-h">W${i + 1}</th>`).join("");
    const rows = og.rows
      .map(
        (r) => `
      <tr>
        <th class="sn-g-team" scope="row"><span data-username="${escapeHtml(r.key)}">${escapeHtml(nameOf.get(r.key) || r.key)}</span></th>
        ${r.cells.map((x) => `<td class="sn-g-c">${x ? `<span class="sn-odds sn-odds-${x.band}">${x.label}</span>` : `<span class="sn-odds sn-odds-none"></span>`}</td>`).join("")}
        <td class="sn-g-res">${r.result ? `<span class="sn-res sn-res-${r.result.kind}">${r.result.kind === "in" ? "Clinched" : "Out"} W${r.result.week}</span>` : ""}</td>
      </tr>`
      )
      .join("");
    oddsPanel = snPanel("Playoff Odds, Week By Week", `<div class="sn-table-wrap sn-grid-wrap"><table class="sn-grid sn-odds-grid"><thead><tr><th class="sn-g-team"></th>${head}<th class="sn-g-h">Result</th></tr></thead><tbody>${rows}</tbody></table></div>`, {
      side: "chance of making the playoffs, in percent",
    });
  }

  return snSection("sn-power", "Power Rank History", rankPanel + scorePanel + oddsPanel);
}

// ===============================================================================================
// Season Awards (mockup page 20)
// ===============================================================================================

let PLAYER_NAME_INDEX_CACHE = null;
function getPlayerNameIndex() {
  if (!PLAYER_NAME_INDEX_CACHE) PLAYER_NAME_INDEX_CACHE = buildPlayerNameIndex(PLAYER_DIRECTORY);
  return PLAYER_NAME_INDEX_CACHE;
}

// An award is a roast when its name says worst or injury, an honor otherwise.
const awardTone = (category) => (/worst|injur|bust|drop/i.test(category) ? "roast" : "honor");

function awardCard(label, winnerLabel, detail, playerId) {
  const tone = awardTone(label);
  return `
    <div class="sn-award sn-award-${tone}">
      <div class="sn-award-top"><span class="sn-tile-label">${escapeHtml(label)}</span><span class="sn-award-tag">${tone === "roast" ? "Roast" : "Honor"}</span></div>
      <p class="sn-award-winner">${escapeHtml(winnerLabel)}</p>
      ${detail ? `<div class="sn-award-player">${playerId ? snPhoto(playerId, detail, "md") : ""}<p class="sn-award-detail">${playerId ? playerLinkHtml(playerId, escapeHtml(detail)) : escapeHtml(detail)}</p></div>` : ""}
    </div>`;
}

function renderAwardsSection(season) {
  if (!SEASON_AWARDS || !SEASON_AWARDS.seasons) return "";
  const yearAwards = SEASON_AWARDS.seasons[String(season)];
  if (!yearAwards) return "";
  const nameIndex = getPlayerNameIndex();
  const entries = Object.entries(yearAwards);
  const cards = entries
    .map(([category, award]) => {
      const winnerLabel = award.username || award.winnerName || "Unknown";
      const detail = award.detail ? String(award.detail).split(",")[0] : null;
      const playerId = detail ? findPlayerIdByName(detail, nameIndex) : null;
      return awardCard(category, winnerLabel, award.detail, playerId);
    })
    .join("");
  const tally = new Map();
  entries.forEach(([, a]) => {
    const w = a.username || a.winnerName;
    if (w) tally.set(w, (tally.get(w) || 0) + 1);
  });
  const strip = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return snSection(
    "sn-awards",
    "Season Awards",
    `<div class="sn-award-grid">${cards}</div>
     ${strip.length ? `<div class="panel sn-panel sn-tally"><span class="sn-tally-title">Awards collected</span>${strip.map(([w, n]) => `<span class="sn-tally-chip"><b>${n}</b> ${escapeHtml(w)}</span>`).join("")}</div>` : ""}`
  );
}

// ===============================================================================================
// MVP, draft awards, pickups and injury luck (all from Metrics; mockup pages 17 to 19)
// ===============================================================================================

const METRIC_POSITIONS = ["All", "QB", "RB", "WR", "TE", "K", "DEF"];
const WIRE_LIST_SIZE = 5;

function buildSeasonMetrics(analysis, season) {
  return {
    kind: "season",
    season: String(season),
    awards: analysis.awards(season),
    wire: analysis.wire(season),
    injury: analysis.injury(season),
    constants: analysis.constants(),
  };
}

function buildTotalMetrics(analysis) {
  const seasons = analysis.contexts.map((c) => c.season);
  const awards = seasons.map((s) => analysis.awards(s)).filter(Boolean);
  const done = awards.filter((a) => a.complete);
  const byValue = (field, dir) => done.flatMap((a) => a[field]).sort((a, b) => dir * (a.valueOverSlot - b.valueOverSlot)).slice(0, 5);
  const injuries = seasons.map((s) => analysis.injury(s));
  return {
    kind: "total",
    awards,
    steals: byValue("steals", -1),
    busts: byValue("busts", 1),
    cursed: byValue("cursed", 1),
    wire: { pickups: seasons.flatMap((s) => analysis.wire(s).pickups).sort((a, b) => b.value - a.value) },
    injury: {
      topPlayers: injuries.flatMap((i) => i.playerInjuries).sort((a, b) => b.pointsLost - a.pointsLost).slice(0, 5),
      topTeamSeasons: injuries.flatMap((i) => i.teams).sort((a, b) => b.pointsLost - a.pointsLost).slice(0, 5),
    },
    constants: analysis.constants(),
  };
}

// The recap card up top reads the new steal / bust and the new League MVP, so the page never shows two answers.
function applyMetricsToRecap(summary) {
  const awards = summary.metrics && summary.metrics.awards;
  if (!awards) return;
  const asPick = (r) =>
    r && {
      player: r.player,
      playerId: r.playerId,
      round: r.round,
      pickInRound: r.pickInRound,
      teamName: r.username,
      username: r.username,
      points: r.totalPoints,
      vbd: null,
      season: r.season,
    };
  summary.bestValuePick = awards.complete ? asPick(awards.steals[0]) || null : null;
  summary.worstValuePick = awards.complete ? asPick(awards.busts[0]) || null : null;
  summary.leagueMvp = awards.mvp.All[0] || null;
}

function metricPillsHtml(group, active) {
  return `<div class="season-pills metric-pills sn-pills" role="group" aria-label="Filter by position">${METRIC_POSITIONS.map(
    (pos) => `<button type="button" class="season-pill${pos === active ? " active" : ""}" data-metric-group="${group}" data-metric-value="${pos}" aria-pressed="${pos === active}">${pos}</button>`
  ).join("")}</div>`;
}

// The MVP table: player, PPG, games, results swung, wins added and points above replacement.
function mvpRowsHtml(list, withSeason) {
  if (!list || !list.length) return `<div class="empty-state">Not enough games played yet.</div>`;
  return `
    <div class="sn-table-wrap">
      <table class="sn-table sn-mvp">
        <thead><tr><th class="sn-c-rank">#</th><th>Player</th>${withSeason ? `<th class="sn-num">Season</th>` : ""}<th class="sn-num sn-opt">PPG</th><th class="sn-num sn-opt">Games</th><th class="sn-num sn-opt">Swung</th><th class="sn-num sn-gold-head">Wins added</th><th class="sn-num sn-opt">Pts above repl.</th></tr></thead>
        <tbody>${list
          .map(
            (r, i) => `
          <tr${i === 0 ? ' class="sn-first"' : ""}>
            <td class="sn-c-rank">${i + 1}</td>
            <td><span class="sn-player">${snPhoto(r.playerId, r.player)}${posChip(r.position)}<span class="sn-two">${playerLinkHtml(r.playerId, escapeHtml(r.player))}<small>${r.owner ? `<span data-username="${escapeHtml(r.owner)}">${escapeHtml(r.owner)}</span>` : ""}<span class="sn-ph-only"> · ${r.ppg.toFixed(1)} PPG over ${r.gamesPlayed} games${r.swung ? ` · swung ${r.swung} result${r.swung === 1 ? "" : "s"}` : ""}</span></small></span></span></td>
            ${withSeason ? `<td class="sn-num">${escapeHtml(String(r.season))}${r.inProgress ? `<small class="sn-live"> (in progress)</small>` : ""}</td>` : ""}
            <td class="sn-num sn-opt">${r.ppg.toFixed(1)}</td>
            <td class="sn-num sn-opt">${r.gamesPlayed}</td>
            <td class="sn-num sn-opt">${r.swung || 0}</td>
            <td class="sn-num"><span class="sn-wins">${r.wins.toFixed(1)} W</span></td>
            <td class="sn-num sn-opt">${r.par.toFixed(0)} pts</td>
          </tr>`
          )
          .join("")}</tbody>
      </table>
    </div>`;
}

// Steals, busts and cursed picks: same row shape, the gap to a typical pick and the grade chip.
function draftValueRowsHtml(list, withSeason) {
  if (!list || !list.length) return `<div class="empty-state">Nothing to show.</div>`;
  return `<div class="sn-list">${list
    .map(
      (r, i) => `
    <div class="sn-li rank-list-row">
      <span class="sn-li-rank">${i + 1}</span>
      ${snPhoto(r.playerId, r.player)}
      <span class="sn-li-main">
        <span class="sn-li-title">${playerLinkHtml(r.playerId, escapeHtml(r.player))} <span class="sn-pos-mini">${escapeHtml(r.position || "")}</span></span>
        <span class="sn-li-sub">by <span data-username="${escapeHtml(r.username || "")}">${escapeHtml(r.username || "Unknown")}</span>${withSeason ? ` · ${escapeHtml(String(r.season))}` : ""}</span>
        <span class="sn-li-meta">Rd ${r.round}, pick ${r.pickInRound} (#${r.pickNo}) · ${r.value.toFixed(0)} vs ${r.typical.toFixed(0)} typical${r.injuredWeeks >= 3 ? ` · ${r.injuredWeeks} wks injured` : ""}</span>
      </span>
      <span class="sn-li-end"><span class="sn-gap sn-gap-${r.valueOverSlot >= 0 ? "good" : "bad"}">${r.valueOverSlot >= 0 ? "+" : ""}${r.valueOverSlot.toFixed(0)}</span>${gradeBadgeHtml(r.grade)}</span>
    </div>`
    )
    .join("")}</div>`;
}

// One line on what "wins added" means: the MVP table's unit.
function mvpNote(m) {
  const ppw = m && m.constants && m.constants.pointsPerWin;
  return `<p class="sn-note">Points above a replacement-level player at his position, in games he played, over the regular season.${ppw ? ` About ${ppw.toFixed(0)} season points make one win in this league.` : ""}</p>`;
}

function aceCardHtml(ace) {
  if (!ace) return "";
  return `
    <div class="sn-ace">
      <div class="sn-ace-top">${snPhoto(ace.playerId, ace.player, "xl")}<p class="sn-eyebrow">Champion's Ace</p></div>
      <p class="sn-ace-name">${playerLinkHtml(ace.playerId, escapeHtml(ace.player))}</p>
      <p class="sn-ace-pts"><b>${ace.points.toFixed(1)}</b><span>points as a starter</span></p>
      <p class="sn-ace-sub">For ${escapeHtml(ace.team || "the champion")}, playoffs included.</p>
    </div>`;
}

function renderAwardsMetricsSection(s) {
  const m = s.metrics;
  if (!m) return "";

  if (m.kind === "total") {
    const rows = [...m.awards]
      .reverse()
      .filter((a) => a.mvp.All.length)
      .map((a) => ({ ...a.mvp.All[0], season: a.season, inProgress: !a.complete }));
    return snSection(
      "sn-mvp",
      "MVP & Draft Awards",
      `
      ${snPanel("League MVP By Season", mvpRowsHtml(rows, true) + mvpNote(m))}
      <div class="sn-three">
        ${snPanel('<span class="sn-tone-good">Biggest Draft Steals Of All Time</span>', draftValueRowsHtml(m.steals, true))}
        ${snPanel('<span class="sn-tone-bad">Biggest Draft Busts Of All Time</span>', draftValueRowsHtml(m.busts, true))}
        ${snPanel('<span class="sn-tone-bad">Most Cursed Picks Of All Time</span>', draftValueRowsHtml(m.cursed, true) + `<p class="sn-note">Missed three or more weeks to the injury report and still came in below their slot. Not counted as busts.</p>`)}
      </div>`
    );
  }

  const a = m.awards;
  const mvpPanel = snPanel(`League MVP${a.complete ? "" : ` · Through Week ${a.regularWeeks}`}`, `<div id="metric-mvp-list">${mvpRowsHtml(a.mvp.All)}</div>${mvpNote(m)}`, { side: metricPillsHtml("mvp", "All"), cls: "sn-mvp-panel" });
  const draftHtml = a.complete
    ? `
      <div class="sn-three">
        ${snPanel('<span class="sn-tone-good">Biggest Steals</span>', draftValueRowsHtml(a.steals))}
        ${snPanel('<span class="sn-tone-bad">Biggest Busts</span>', draftValueRowsHtml(a.busts) + `<p class="sn-note">Picks who missed two or fewer weeks to the injury report.</p>`)}
        ${a.cursed.length ? snPanel('<span class="sn-tone-bad">Cursed Picks</span>', draftValueRowsHtml(a.cursed) + `<p class="sn-note">Missed three or more weeks to the injury report and still came in below their slot. Not counted as busts.</p>`) : ""}
      </div>`
    : snPanel("Draft Awards", `<div class="empty-state">Steals, busts and cursed picks are handed out when the season ends.</div>`);
  return snSection(
    "sn-mvp",
    "MVP & Draft Awards",
    `
      <div class="sn-mvp-layout${a.championsAce ? "" : " sn-mvp-solo"}">
        ${mvpPanel}
        ${aceCardHtml(a.championsAce)}
      </div>
      ${draftHtml}`
  );
}

function wireCostLabel(r) {
  if (r.type === "free_agent") return "free agent";
  return r.bid > 0 ? `$${r.bid} claim` : "$0 waiver";
}

function wireRowsHtml(list, withSeason) {
  if (!list || !list.length) return `<div class="empty-state">No pickups at this position.</div>`;
  return `<div class="sn-list">${list
    .map(
      (r, i) => `
    <div class="sn-li rank-list-row">
      <span class="sn-li-rank">${i + 1}</span>
      ${snPhoto(r.playerId, r.player)}
      ${posChip(r.position)}
      <span class="sn-li-main">
        <span class="sn-li-title">${playerLinkHtml(r.playerId, escapeHtml(r.player))} <span class="sn-li-owner" data-username="${escapeHtml(r.username)}">${escapeHtml(r.username)}</span></span>
        <span class="sn-li-meta">Week ${r.week}${withSeason ? ` · ${escapeHtml(String(r.season))}` : ""} · ${wireCostLabel(r)}</span>
        <span class="sn-li-meta">started ${r.startedWeeks} of ${r.heldWeeks} games${r.finishRank ? ` · finished ${escapeHtml(r.position)}${r.finishRank}` : ""}</span>
      </span>
      <span class="sn-li-end sn-li-big"><b>+${r.value.toFixed(0)}</b>${r.swung ? `<small>swung ${r.swung} result${r.swung === 1 ? "" : "s"}</small>` : ""}</span>
    </div>`
    )
    .join("")}</div>`;
}

function filterByPosition(list, pos) {
  return (pos === "All" ? list : list.filter((r) => r.position === pos)).slice(0, WIRE_LIST_SIZE);
}

function faabCardsHtml(items, isTotal) {
  if (!items || !items.length) return "";
  return `<div class="sn-faab">${items
    .map((p) => {
      const bids = p.competingBids && p.competingBids.length ? `<div class="sn-faab-bids"><span class="sn-dim">Other bids:</span> ${p.competingBids.map((b) => `${escapeHtml(b.username || b.teamName)} $${b.bid}`).join(" · ")}</div>` : "";
      return `
      <div class="sn-faab-card">
        <div class="sn-faab-top"><p class="sn-faab-bid">$${p.bid}</p>${snPhoto(p.playerId, p.player, "md")}</div>
        <p class="sn-faab-name">${playerLinkHtml(p.playerId, escapeHtml(p.player))}</p>
        <p class="sn-faab-sub"><span data-username="${escapeHtml(p.username || p.teamName)}">${escapeHtml(p.username || p.teamName)}</span>${p.week ? ` · Week ${p.week}` : ""}${isTotal && p.season ? ` · ${p.season}` : ""}</p>
        ${bids}
      </div>`;
    })
    .join("")}</div>`;
}

function renderWireMetricsSection(s) {
  const m = s.metrics;
  if (!m) return "";
  const isTotal = m.kind === "total";
  const pickups = m.wire.pickups;
  if (!pickups.length) return "";
  const best = snPanel(`Top 5 Best Pickups${isTotal ? " Of All Time" : ""}`, `<div id="metric-wire-list">${wireRowsHtml(filterByPosition(pickups, "All"), isTotal)}</div>`, { side: metricPillsHtml("wire", "All") });
  const standings = !isTotal
    ? snPanel(
        "Wire Standings",
        `<div class="sn-table-wrap"><table class="sn-table sn-wire">
          <thead><tr><th class="sn-c-rank">#</th><th>Manager</th><th class="sn-num sn-gold-head">Value</th><th class="sn-num">Claims</th><th class="sn-num sn-opt">Hits</th><th class="sn-num sn-opt">Hit rate</th><th class="sn-num">FAAB</th><th class="sn-num sn-opt">Swung</th></tr></thead>
          <tbody>${m.wire.managers
            .map(
              (t, i) => `<tr data-username="${escapeHtml(t.username || "")}"><td class="sn-c-rank">${i + 1}</td><td class="sn-c-team">${escapeHtml(t.username || "")}</td><td class="sn-num"><span class="sn-val${i === 0 ? " sn-val-top" : ""}">${t.value.toFixed(0)}</span></td><td class="sn-num">${t.claims}</td><td class="sn-num sn-opt">${t.hits}</td><td class="sn-num sn-opt sn-dim">${t.claims ? Math.round((100 * t.hits) / t.claims) : 0}%</td><td class="sn-num">$${t.faab}</td><td class="sn-num sn-opt">${t.swung}</td></tr>`
            )
            .join("")}</tbody></table></div>`
      )
    : "";
  const faab = s.top5FaabPickups && s.top5FaabPickups.length ? `<div class="sn-subhead"><h3>Priciest FAAB Pickups${isTotal ? " Of All Time" : ""}</h3><span class="sn-panel-side">dollars bid on one claim</span></div>${faabCardsHtml(s.top5FaabPickups, isTotal)}` : "";
  return snSection("sn-wire", "Waiver Wire", `<div class="sn-two-col${standings ? "" : " sn-solo"}">${best}${standings}</div>${faab}`);
}

function injuryTeamRowsHtml(teams) {
  if (!teams.length) return `<div class="empty-state">No injury data recorded for this season.</div>`;
  const row = (t, i) => {
    const net = (t.resultsGifted || 0) - (t.resultsLost || 0);
    const cells = `
      <span class="sn-c-rank">${i + 1}</span>
      <span class="sn-inj-team" data-username="${escapeHtml(t.username || "")}">${escapeHtml(t.username || "")}</span>
      <span class="sn-inj-n"><span class="sn-cnt sn-cnt-bad">${t.resultsLost}</span></span>
      <span class="sn-inj-n"><span class="sn-cnt sn-cnt-good">${t.resultsGifted}</span></span>
      <span class="sn-inj-n"><span class="sn-net sn-net-${net > 0 ? "good" : net < 0 ? "bad" : "flat"}">${net > 0 ? "+" : ""}${net}</span></span>
      <span class="sn-inj-pts">${t.pointsLost.toFixed(1)}</span>`;
    const players = (t.players || []).filter((p) => p.pointsLost > 0.05);
    if (!players.length) return `<div class="sn-inj-row rank-list-row">${cells}<span class="sn-inj-caret"></span></div>`;
    const playersHtml = players
      .map(
        (p) => `
        <div class="sn-inj-detail">
          ${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.player, "player-photo-xs"))}
          ${posChip(p.position)}
          <span>${playerLinkHtml(p.playerId, escapeHtml(p.player))}</span>
          <span class="sn-inj-detail-pts">${p.pointsLost.toFixed(1)} pts lost</span>
        </div>`
      )
      .join("");
    return `<details class="sn-inj-item"><summary class="sn-inj-row rank-list-row">${cells}<span class="sn-inj-caret">›</span></summary><div class="sn-inj-details">${playersHtml}</div></details>`;
  };
  return `
    <div class="sn-inj-table">
      <div class="sn-inj-row sn-inj-head"><span class="sn-c-rank"></span><span>Team</span><span class="sn-inj-n">Results lost</span><span class="sn-inj-n">Gifted</span><span class="sn-inj-n sn-gold-head">Net</span><span class="sn-inj-pts">Points lost</span><span></span></div>
      ${teams.map(row).join("")}
    </div>`;
}

function injuryPlayerRowsHtml(items, withSeason) {
  if (!items.length) return `<div class="empty-state">No significant injuries recorded.</div>`;
  return `<div class="sn-list">${items
    .map(
      (p, i) => `
    <div class="sn-li rank-list-row">
      <span class="sn-li-rank">${i + 1}</span>
      ${snPhoto(p.playerId, p.player)}
      ${posChip(p.position)}
      <span class="sn-li-main">
        <span class="sn-li-title">${playerLinkHtml(p.playerId, escapeHtml(p.player))}</span>
        <span class="sn-li-sub"><span data-username="${escapeHtml(p.username || "")}">${escapeHtml(p.username || "")}</span>${withSeason ? ` · ${escapeHtml(String(p.season))}` : ""}</span>
      </span>
      <span class="sn-li-end sn-li-big sn-big-bad"><b>${p.pointsLost.toFixed(1)}</b><small>pts lost · ${p.weeks} wk${p.weeks === 1 ? "" : "s"} out</small></span>
    </div>`
    )
    .join("")}</div>`;
}

function renderInjuryMetricsSection(s) {
  const m = s.metrics;
  if (!m) return "";
  const isTotal = m.kind === "total";
  const topPlayers = isTotal ? m.injury.topPlayers : m.injury.playerInjuries.slice(0, 5);
  const teamsHtml = isTotal
    ? `<div class="sn-list">${m.injury.topTeamSeasons
        .map(
          (t, i) => `
        <div class="sn-li rank-list-row"><span class="sn-li-rank">${i + 1}</span><span class="sn-li-main"><span class="sn-li-title" data-username="${escapeHtml(t.username || "")}">${escapeHtml(t.username || "")}</span><span class="sn-li-sub">${escapeHtml(String(t.season))} · ${t.resultsLost} results lost · ${t.resultsGifted} gifted</span></span><span class="sn-li-end sn-li-big sn-big-bad"><b>${t.pointsLost.toFixed(1)}</b><small>pts lost</small></span></div>`
        )
        .join("")}</div>`
    : injuryTeamRowsHtml(m.injury.teams);
  return snSection(
    "sn-injury",
    "Injury Luck",
    `<div class="sn-two-col sn-inj-layout">
      ${snPanel(`Most Costly Injuries${isTotal ? " Of All Time" : ""}`, injuryPlayerRowsHtml(topPlayers, isTotal), { side: "top 5 players" })}
      ${snPanel(isTotal ? "Worst Injury Luck, Team Seasons" : "Injury Luck Ranking", teamsHtml, { side: isTotal ? "" : "most points lost first · tap a team" })}
    </div>`
  );
}

// Position pills redraw their list in place from the metrics on screen.
function initMetricFilters(root) {
  if (!root || root.dataset.metricFilters) return;
  root.dataset.metricFilters = "1";
  root.addEventListener("click", (e) => {
    const pill = e.target.closest("[data-metric-group]");
    if (!pill || !CURRENT_METRICS) return;
    const group = pill.getAttribute("data-metric-group");
    const pos = pill.getAttribute("data-metric-value");
    pill.parentElement.querySelectorAll("[data-metric-group]").forEach((b) => {
      const on = b === pill;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (group === "mvp") {
      const list = CURRENT_METRICS.awards.mvp[pos] || [];
      root.querySelector("#metric-mvp-list").innerHTML = mvpRowsHtml(list);
    } else if (group === "wire") {
      root.querySelector("#metric-wire-list").innerHTML = wireRowsHtml(filterByPosition(CURRENT_METRICS.wire.pickups, pos), CURRENT_METRICS.kind === "total");
    }
  });
}

// On a phone a standings row opens the line of numbers the narrow table leaves out.
function initStandingsToggles(root) {
  if (!root || root.dataset.snToggles) return;
  root.dataset.snToggles = "1";
  root.addEventListener("click", (e) => {
    const row = e.target.closest("[data-sn-toggle]");
    if (!row || e.target.closest("a")) return;
    const next = row.nextElementSibling;
    if (!next || !next.classList.contains("sn-st-more")) return;
    const open = !row.classList.contains("sn-open");
    row.classList.toggle("sn-open", open);
    next.setAttribute("aria-hidden", open ? "false" : "true");
  });
}

// The bump chart: a tap on a line (or its name) lights that team and grays the rest; again to undo.
function initBumpFocus(root) {
  if (!root || root.dataset.snBump) return;
  root.dataset.snBump = "1";
  root.addEventListener("click", (e) => {
    const g = e.target.closest("[data-bump]");
    const svg = e.target.closest(".sn-bump");
    if (!svg) return;
    const key = g ? g.getAttribute("data-bump") : null;
    const same = svg.getAttribute("data-focus") === key;
    svg.querySelectorAll("[data-bump]").forEach((x) => x.classList.toggle("sn-bump-on", !same && x.getAttribute("data-bump") === key));
    if (!key || same) svg.removeAttribute("data-focus");
    else svg.setAttribute("data-focus", key);
  });
}

// ===============================================================================================
// Season Extremes and Best By Position (mockup page 16)
// ===============================================================================================

function extremeHeadline(label, rec, tone, yearTag) {
  if (!rec) return "";
  const sections = [{ teamName: rec.teamName, lineup: rec.lineup }];
  const inner = `
      <span class="sn-ext-big sn-tone-${tone}">${rec.points.toFixed(1)}</span>
      <span class="sn-ext-text">
        <span class="sn-tile-label">${escapeHtml(label)}</span>
        <span class="sn-ext-who" data-username="${escapeHtml(rec.teamName)}">${escapeHtml(rec.teamName)}</span>
        <span class="sn-dim">Week ${rec.week}${yearTag(rec)}${hasLineups(sections) ? " · tap for lineup" : ""}</span>
      </span>`;
  if (!hasLineups(sections)) return `<div class="sn-ext sn-ext-${tone}">${inner}</div>`;
  return `<details class="sn-ext sn-ext-${tone}"><summary>${inner}</summary><div class="sn-lineups">${lineupSectionsHtml(sections)}</div></details>`;
}

function matchupListHtml(items, opts) {
  if (!items || !items.length) return `<div class="empty-state">Not enough games played yet.</div>`;
  return `<div class="sn-list">${items
    .map((m, i) => {
      const sections = [
        { teamName: m.winner, lineup: m.winnerLineup },
        { teamName: m.loser, lineup: m.loserLineup },
      ];
      const row = `
        <span class="sn-li-rank">${i + 1}</span>
        <span class="sn-li-main">
          <span class="sn-li-title"><b data-username="${escapeHtml(m.winner)}">${escapeHtml(m.winner)}</b> <span class="sn-dim">${opts.verb}</span> <span data-username="${escapeHtml(m.loser)}">${escapeHtml(m.loser)}</span></span>
          <span class="sn-li-meta">${m.winnerPts.toFixed(1)} to ${m.loserPts.toFixed(1)}</span>
        </span>
        <span class="sn-li-end">${weekChip(m.week)}${opts.yearTag(m) ? `<span class="sn-chip">${escapeHtml(String(m.season))}</span>` : ""}<span class="sn-margin sn-margin-${opts.tone}">${m.margin.toFixed(opts.digits)} pt</span></span>`;
      if (!hasLineups(sections)) return `<div class="sn-li rank-list-row">${row}</div>`;
      return `<details class="sn-li-item"><summary class="sn-li rank-list-row">${row}</summary><div class="sn-lineups">${lineupSectionsHtml(sections)}</div></details>`;
    })
    .join("")}</div>`;
}

function bestByPositionHtml(best, opts) {
  const cards = SN_POSITIONS.map((pos) => {
    const x = best && best[pos];
    if (!x) return "";
    const playoff = opts.playoffStart && x.week >= opts.playoffStart && !opts.isTotal;
    return `
      <div class="sn-bp">
        <span class="sn-bp-photo">${snPhoto(x.playerId, x.player, "lg")}<span class="sn-bp-pos">${pos}</span></span>
        <span class="sn-bp-main">
          <span class="sn-bp-name">${playerLinkHtml(x.playerId, escapeHtml(x.player))}</span>
          <span class="sn-dim">for <span data-username="${escapeHtml(x.teamName)}">${escapeHtml(x.teamName)}</span></span>
          <span class="sn-bp-chips"><span class="sn-chip">Week ${x.week}</span>${opts.isTotal && x.season ? `<span class="sn-chip">${escapeHtml(String(x.season))}</span>` : ""}${playoff ? `<span class="sn-chip sn-chip-gold">Playoffs</span>` : ""}</span>
        </span>
        <span class="sn-bp-pts"><b>${x.points.toFixed(1)}</b><small>points</small></span>
      </div>`;
  }).join("");
  return cards ? `<div class="sn-bp-grid">${cards}</div>` : `<div class="empty-state">No lineup data available.</div>`;
}

// ===============================================================================================
// The pre-Sleeper (ESPN-era) seasons: standings, the bracket and any Power Rank History there is
// ===============================================================================================

function manualStandingsRows(season) {
  const medal = { gold: { kind: "champion", label: "Champion" }, silver: { kind: "runnerup", label: "Runner-up" }, bronze: { kind: "third", label: "3rd place" } };
  return [...season.standings]
    .sort((a, b) => a.standing - b.standing)
    .map((row) => {
      const games = row.wins + row.losses + (row.ties || 0);
      const o = row.overallRecord;
      const apGames = o ? o.wins + o.losses + (o.ties || 0) : 0;
      const apPct = apGames ? (o.wins + 0.5 * (o.ties || 0)) / apGames : null;
      const luckPct = o ? DeepHistory.luckPercent(row.wins, row.losses, row.ties || 0, o.wins, o.losses, o.ties || 0) : null;
      return {
        rank: row.standing,
        name: row.team,
        username: row.team,
        record: SeasonData.recordOf(row.wins, row.losses, row.ties),
        pf: row.pointsFor,
        pa: row.pointsAgainst,
        diff: row.pointsFor - row.pointsAgainst,
        ppg: games > 0 ? row.pointsFor / games : null,
        allPlay: o ? SeasonData.recordOf(o.wins, o.losses, o.ties) : null,
        allPlayPct: apPct,
        expWins: apPct != null ? apPct * games : null,
        luckPct,
        finish: medal[row.medal] || (row.playoffAppearance ? null : { kind: "missed", label: "Missed" }),
      };
    });
}

function renderManualSeasonSummary(season) {
  const bracketData = ManualHistory.buildBracketData(season);
  // Only the Finals MVP's name is on record for these seasons: find his photo / page by name.
  if (bracketData.champion && bracketData.champion.mvp && !bracketData.champion.mvp.playerId) {
    bracketData.champion.mvp.playerId = findPlayerIdByName(bracketData.champion.mvp.player, getPlayerNameIndex());
  }
  const playoffTeams = season.standings.filter((r) => r.playoffAppearance).length || null;
  return `
    ${snSection("sn-bracket", "Playoff Bracket", renderBracket(bracketData, { standings: season.standings, year: season.year }))}
    ${snSection("sn-standings", "Final Standings", snPanel("", standingsTableHtml(manualStandingsRows(season), { kind: "manual", playoffTeams })))}
    ${renderPowerRankHistorySection(season.year)}`;
}

// ===============================================================================================
// The whole page
// ===============================================================================================

function renderSummary(s) {
  const isTotal = s.season === "All-Time";
  const yearTag = (item) => (isTotal && item && item.season ? ` · ${item.season}` : "");
  const v = s.view || {};

  // ---- standings ----
  const rows = isTotal ? totalStandingsRows(s) : v.standings || SeasonData.standingsRows(s, null, null);
  if (!isTotal && !v.standings) {
    // no bracket or weekly data handed over (a test, say): still mark the podium from the summary
    const podium = { [s.championRosterId]: { kind: "champion", label: "Champion" }, [s.runnerUpRosterId]: { kind: "runnerup", label: "Runner-up" }, [s.thirdPlaceRosterId]: { kind: "third", label: "3rd place" } };
    rows.forEach((r) => {
      if (podium[r.rosterId] && s.status === "complete") r.finish = podium[r.rosterId];
    });
  }
  const standingsHtml = snPanel("", standingsTableHtml(rows, { kind: isTotal ? "total" : "season", playoffTeams: isTotal ? null : s.playoffTeams }), { cls: "sn-standings-panel" });

  // ---- extremes ----
  const extremes = `
      <div class="sn-ext-pair">
        ${extremeHeadline(isTotal ? "Highest score ever" : "Highest score of the season", s.highestWeekScore, "good", yearTag)}
        ${extremeHeadline(isTotal ? "Lowest score ever" : "Lowest score of the season", s.lowestWeekScore, "bad", yearTag)}
      </div>
      <div class="sn-two-col">
        ${snPanel("Closest Matchups", matchupListHtml(s.top5Closest, { verb: "beat", tone: "good", digits: 2, yearTag }), { side: "decided by the least" })}
        ${snPanel("Biggest Blowouts", matchupListHtml(s.top5Blowouts, { verb: "beat", tone: "bad", digits: 1, yearTag }), { side: "decided by the most" })}
      </div>
      <div class="sn-subhead"><h3>Best Single Week By Position</h3><span class="sn-panel-side">${isTotal ? "any team, any season" : "any team, any week, regular season or playoffs"}</span></div>
      ${bestByPositionHtml(s.bestByPosition, { isTotal, playoffStart: v.playoffStart })}`;

  // ---- luck lists (All-Time) ----
  const luckRows = (list) =>
    `<div class="sn-list">${(list || [])
      .map(
        (t, i) => `<div class="sn-li rank-list-row"><span class="sn-li-rank">${i + 1}</span><span class="sn-li-main"><span class="sn-li-title"><span data-username="${escapeHtml(t.teamName)}">${escapeHtml(t.teamName)}</span> <span class="sn-chip">${escapeHtml(String(t.season))}</span></span><span class="sn-li-meta">Record ${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""} · all-play ${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}</span></span><span class="sn-li-end">${luckPill(t.luckPct)}</span></div>`
      )
      .join("") || `<div class="empty-state">Not enough games played yet.</div>`}</div>`;

  const trend = isTotal && s.weeklyLeagueAvg && s.weeklyLeagueAvg.length ? snPanel("Average Score By Week Of Season (All Years)", Charts.lineChart(s.weeklyLeagueAvg.map((w) => ({ x: w.week, y: w.avg })), { formatter: (x) => x.toFixed(0) })) : "";

  return `
    ${isTotal ? "" : renderChampionshipRecap(s.championshipRecap, s.allTimeRecords, { bestValuePick: s.bestValuePick, worstValuePick: s.worstValuePick, pointsLeader: s.pointsLeader, leagueMvp: s.leagueMvp }, { season: s.season, championsAce: s.metrics && s.metrics.awards ? s.metrics.awards.championsAce : null, champRow: v.champRow, finalScore: v.bracket && v.bracket.champion ? v.bracket.champion.finalScore : null, champBye: v.bracket && v.bracket.champion ? v.bracket.champion.path.some((p) => p.bye) : false })}

    ${snSection("sn-standings", standingsLabel(s), standingsHtml)}

    ${!isTotal && (v.bracket || (!s.view && s.bracket)) ? snSection("sn-bracket", "Playoff Bracket", v.bracket ? bracketHtml(v.bracket, { year: s.season, oldBracket: s.bracket, finalsMvp: s.bracket && s.bracket.champion ? s.bracket.champion.mvp : null }) : renderBracket(s.bracket, { year: s.season })) : ""}

    ${!isTotal && v.grid ? snSection("sn-grid", "Season Grid", seasonGridHtml(v.grid)) : ""}

    ${isTotal ? "" : snSection("sn-over-time", "Standings Over Time", renderStandingsReplaySection(s.standingsHistory, s.playoffTeams, s))}

    ${trend ? snSection("sn-trend", "Weekly Scoring Trend", trend) : ""}

    ${isTotal ? "" : renderPowerRankHistorySection(s.season)}

    ${snSection("sn-slots", "Points By Starting Slot", snPanel("", renderPositionTable(s.positionTable), { cls: "sn-slots-panel" }))}

    ${snSection("sn-extremes", "Season Extremes", extremes)}

    ${isTotal ? snSection("sn-luck", "Luck", `<div class="sn-two-col">${snPanel("Top 10 Luckiest Seasons", luckRows(s.top5Luckiest))}${snPanel("Top 10 Unluckiest Seasons", luckRows(s.top5Unluckiest))}</div>`) : ""}

    ${renderAwardsMetricsSection(s)}

    ${renderWireMetricsSection(s)}

    ${renderInjuryMetricsSection(s)}

    ${renderAwardsSection(s.season)}
  `;
}

document.addEventListener("DOMContentLoaded", renderSeasonPage);
