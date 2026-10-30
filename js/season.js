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

    progressBox.style.display = "block";
    progressBox.textContent = "Scoring the awards…";
    summary.metrics = buildSeasonMetrics(await getMetricsAnalysis(), seasonEntry.league.season);
    applyMetricsToRecap(summary);

    progressBox.style.display = "none";
    content.style.display = "";
    CURRENT_METRICS = summary.metrics;
    content.innerHTML = renderSummary(summary);
    initMetricFilters(content);
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

function recordCard(label, value, detail) {
  return `
    <div class="record-card">
      <p class="record-label">${escapeHtml(label)}</p>
      <p class="record-value">${value}</p>
      ${detail ? `<p class="record-detail">${detail}</p>` : ""}
    </div>`;
}

function recordCardWithPhoto(label, playerId, playerName, detail, badge) {
  return `
    <div class="record-card record-card-photo">
      ${playerLinkHtml(playerId, playerPhotoHtml(playerId, playerName, "player-photo-sm"))}
      <div>
        <p class="record-label">${escapeHtml(label)}${badge ? ` ${badge}` : ""}</p>
        <p class="record-value record-value-photo">${playerLinkHtml(playerId, escapeHtml(playerName))}</p>
        ${detail ? `<p class="record-detail">${detail}</p>` : ""}
      </div>
    </div>`;
}

function lineupRows(lineup) {
  return lineup
    .map(
      (p) => `
      <div class="draft-pick-row">
        <span>${escapeHtml(p.slot)}</span>
        <span class="pick-player">${playerLinkHtml(p.playerId, escapeHtml(p.player))}</span>
        <span class="pick-points">${p.points.toFixed(1)}</span>
      </div>`
    )
    .join("");
}

function lineupSectionsHtml(sections) {
  return sections
    .filter((s) => s.lineup && s.lineup.length)
    .map((s) => `<div class="bracket-lineup-team-name">${escapeHtml(s.teamName)}</div>${lineupRows(s.lineup)}`)
    .join("");
}

// Same as recordCard, but expandable to reveal one team's starting lineup
// for that week. Falls back to a plain (non-expandable) card if there's
// no lineup data to show.
function expandableRecordCard(label, value, detail, lineupSections) {
  const hasLineup = lineupSections.some((s) => s.lineup && s.lineup.length);
  if (!hasLineup) return recordCard(label, value, detail);
  return `
    <details class="record-card record-card-expandable">
      <summary>
        <span class="record-label">${escapeHtml(label)}</span>
        <span class="record-value">${value}</span>
        ${detail ? `<span class="record-detail">${detail}</span>` : ""}
      </summary>
      <div class="bracket-lineup-section">${lineupSectionsHtml(lineupSections)}</div>
    </details>`;
}

function renderPositionTable(positionTable) {
  if (!positionTable.columns.length || !positionTable.rows.length) {
    return `<div class="empty-state">No lineup data available for this season.</div>`;
  }

  // Standardize each column independently: min/max computed only within that column.
  const ranges = {};
  positionTable.columns.forEach((col) => {
    const values = positionTable.rows.map((r) => r.cells[col.key]).filter((v) => v != null);
    ranges[col.key] = { min: Math.min(...values), max: Math.max(...values) };
  });

  const header = positionTable.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");

  const rows = positionTable.rows
    .map((r) => {
      const cells = positionTable.columns
        .map((col) => {
          const v = r.cells[col.key];
          if (v == null) return `<td class="heat-cell empty" data-label="${escapeHtml(col.label)}">—</td>`;
          const { min, max } = ranges[col.key];
          const bg = heatColor(v, min, max);
          return `<td class="heat-cell" data-label="${escapeHtml(col.label)}" style="background:${bg}">${v.toFixed(1)}</td>`;
        })
        .join("");
      return `<tr><td class="team-cell">${escapeHtml(r.teamName)}</td>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="heatmap-table-wrap stay-scrollable">
      <table class="stat-table compact-mobile">
        <thead><tr><th>Team</th>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="heatmap-note">Each column is colored independently — yellow is that column's best, blue is its worst.</p>`;
}

function renderFaabList(items, isTotal) {
  if (!items.length) return `<div class="empty-state">Not enough games played yet.</div>`;
  return `<div class="rank-list">${items
    .map((p, i) => {
      const row = `
      <span class="rank-num">${i + 1}</span>
      ${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.player, "player-photo-sm"))}
      <span class="desc">${playerLinkHtml(p.playerId, escapeHtml(p.player))}<span class="sub">${escapeHtml(p.username || p.teamName)}${p.week ? ` · Week ${p.week}` : ""}${
        isTotal && p.season ? ` · ${p.season}` : ""
      }</span></span>
      <span class="val">$${p.bid}</span>`;
      if (!p.competingBids || !p.competingBids.length) {
        return `<div class="rank-list-row faab-row">${row}</div>`;
      }
      const bidsHtml = p.competingBids
        .map(
          (b) => `
        <div class="injury-detail-row">
          <span class="injury-detail-name">${escapeHtml(b.username || b.teamName)}</span>
          <span class="injury-detail-pts">$${b.bid}</span>
        </div>`
        )
        .join("");
      // Not a <details>/<summary> here — the player photo is a <div>
      // (block-level), which <summary> can't legally contain. A plain
      // clickable row + JS toggle (see initAnimatedDropdowns in animations.js) sidesteps that.
      return `
      <div class="rank-list-item-toggle">
        <div class="rank-list-row faab-row toggleable" data-faab-toggle>${row}</div>
        <div class="injury-detail-list" style="display:none;">
          <div class="muted-inline" style="padding: 4px 4px 2px;">Other bids that week</div>
          ${bidsHtml}
        </div>
      </div>`;
    })
    .join("")}</div>`;
}

function bidLabel(w) {
  if (w.bid == null) return "Free Agent";
  return w.bid === 0 ? "$0 waiver" : `$${w.bid} waiver`;
}

function renderWaiverValueList(items, isTotal) {
  if (!items.length) return `<div class="empty-state">Not enough games played yet.</div>`;
  return `<div class="rank-list">${items
    .map((w, i) => {
      const sign = w.relativeValue >= 0 ? "+" : "";
      const row = `
      <span class="rank-num">${i + 1}</span>
      ${playerLinkHtml(w.playerId, playerPhotoHtml(w.playerId, w.player, "player-photo-sm"))}
      <span class="desc">${playerLinkHtml(w.playerId, escapeHtml(w.player))} <span class="muted-inline">(${escapeHtml(w.position)})</span><span class="sub">${escapeHtml(
        w.username || w.teamName
      )} · Week ${w.week} · ${bidLabel(w)}${isTotal && w.season ? ` · ${w.season}` : ""} · ${w.pickupPPG.toFixed(1)} PPG vs ${w.positionMeanPPG.toFixed(
        1
      )} avg ${escapeHtml(w.position)} over ${w.activeWeeks} wk${w.activeWeeks === 1 ? "" : "s"}</span></span>
      <span class="val">${sign}${w.relativeValue.toFixed(1)}</span>`;
      if (!w.competingBids || !w.competingBids.length) {
        return `<div class="rank-list-row faab-row">${row}</div>`;
      }
      const bidsHtml = w.competingBids
        .map(
          (b) => `
        <div class="injury-detail-row">
          <span class="injury-detail-name">${escapeHtml(b.username || b.teamName)}</span>
          <span class="injury-detail-pts">$${b.bid}</span>
        </div>`
        )
        .join("");
      return `
      <div class="rank-list-item-toggle">
        <div class="rank-list-row faab-row toggleable" data-faab-toggle>${row}</div>
        <div class="injury-detail-list" style="display:none;">
          <div class="muted-inline" style="padding: 4px 4px 2px;">Other bids that week</div>
          ${bidsHtml}
        </div>
      </div>`;
    })
    .join("")}</div>`;
}

function renderInjuryList(items, isTotal) {
  if (!items.length) return `<div class="empty-state">No significant injuries recorded.</div>`;
  return `<div class="rank-list">${items
    .map(
      (p, i) => `
    <div class="rank-list-row faab-row">
      <span class="rank-num">${i + 1}</span>
      ${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.player, "player-photo-sm"))}
      <span class="desc">${playerLinkHtml(p.playerId, escapeHtml(p.player))}<span class="sub">${escapeHtml(p.position)} · ${p.weeksInjured} week${p.weeksInjured === 1 ? "" : "s"}${
        isTotal ? ` · ${escapeHtml(String(p.season))}` : ""
      }</span></span>
      <span class="val">${p.pointsLost.toFixed(1)} pts lost</span>
    </div>`
    )
    .join("")}</div>`;
}

function renderTeamInjuryLuckList(teams, playerInjuries) {
  if (!teams.length) return `<div class="empty-state">No injury data recorded for this season.</div>`;
  return `<div class="rank-list">${teams
    .map((t, i) => {
      const summary = `
      <span class="rank-num">${i + 1}</span>
      <span class="desc">${escapeHtml(t.username || t.teamName)}</span>
      <span class="val">${t.pointsLost.toFixed(1)} pts lost</span>`;
      const teamPlayers = (playerInjuries || []).filter((p) => p.rosterId === t.rosterId).sort((a, b) => b.pointsLost - a.pointsLost);
      if (!teamPlayers.length) {
        return `<div class="rank-list-row">${summary}</div>`;
      }
      const playersHtml = teamPlayers
        .map(
          (p) => `
        <div class="injury-detail-row">
          ${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.player, "player-photo-xs"))}
          <span class="injury-detail-name">${playerLinkHtml(p.playerId, escapeHtml(p.player))} <span class="muted-inline">(${escapeHtml(p.position)})</span></span>
          <span class="injury-detail-pts">${p.pointsLost.toFixed(1)} pts lost</span>
        </div>`
        )
        .join("");
      return `
      <details class="rank-list-item">
        <summary class="rank-list-row">${summary}</summary>
        <div class="injury-detail-list">${playersHtml}</div>
      </details>`;
    })
    .join("")}</div>`;
}

function renderRankList(items, describe, getLineupSections) {
  if (!items.length) return `<div class="empty-state">Not enough games played yet.</div>`;
  return `<div class="rank-list">${items
    .map((item, i) => {
      const d = describe(item);
      const summary = `
      <span class="rank-num">${i + 1}</span>
      <span class="desc">${d.main}<span class="sub">${d.sub}</span></span>
      <span class="val">${d.value}</span>`;

      const sections = getLineupSections ? getLineupSections(item) : null;
      const hasLineup = sections && sections.some((s) => s.lineup && s.lineup.length);
      if (!hasLineup) {
        return `<div class="rank-list-row">${summary}</div>`;
      }
      return `
      <details class="rank-list-item">
        <summary class="rank-list-row">${summary}</summary>
        <div class="bracket-lineup-section">${lineupSectionsHtml(sections)}</div>
      </details>`;
    })
    .join("")}</div>`;
}

function renderBracket(bracketData) {
  if (!bracketData || !bracketData.rounds.length) {
    return `<div class="empty-state">No bracket yet — check back once the playoffs start.</div>`;
  }

  const columns = bracketData.rounds
    .map((round) => {
      const games = round.games
        .map((g) => {
          const label = g.specialLabel ? `<span class="bracket-game-label">${escapeHtml(g.specialLabel)}</span>` : "";
          const teamRow = (team) => `
          <span class="bracket-team ${team.isWinner ? "winner" : ""}">
            <span>${escapeHtml(team.name)}</span>
            ${team.score != null ? `<span class="bracket-score">${team.score.toFixed(1)}</span>` : ""}
          </span>`;
          const hasLineups = g.team1.lineup.length || g.team2.lineup.length;
          const lineupSection = hasLineups
            ? `<div class="bracket-lineup-section">${lineupSectionsHtml([
                { teamName: g.team1.name, lineup: g.team1.lineup },
                { teamName: g.team2.name, lineup: g.team2.lineup },
              ])}</div>`
            : "";
          return `
          <details class="bracket-game${g.isChampionship ? " championship" : ""}${hasLineups ? "" : " no-lineup"}">
            <summary>${label}${teamRow(g.team1)}${teamRow(g.team2)}</summary>
            ${lineupSection}
          </details>`;
        })
        .join("");
      return `
      <div class="bracket-round">
        <div class="bracket-round-label">${escapeHtml(round.label)}</div>
        ${games}
      </div>`;
    })
    .join("");

  const championSidebar = bracketData.champion
    ? `
    <div class="bracket-sidebar">
      <div class="bracket-sidebar-label">Champion</div>
      <div class="bracket-sidebar-value">🏆 ${escapeHtml(bracketData.champion.name)}</div>
      ${
        bracketData.champion.mvp
          ? `
      <div class="bracket-sidebar-label" style="margin-top:20px;">Finals MVP</div>
      <div class="player-rep-card" style="gap:12px; margin-top:8px;">
        ${playerLinkHtml(bracketData.champion.mvp.playerId, playerPhotoHtml(bracketData.champion.mvp.playerId, bracketData.champion.mvp.player, "player-photo-sm"))}
        <div>
          <div class="bracket-sidebar-value" style="font-size:15px;">${playerLinkHtml(bracketData.champion.mvp.playerId, escapeHtml(bracketData.champion.mvp.player))}</div>
          <div class="bracket-sidebar-sub">${bracketData.champion.mvp.points.toFixed(1)} pts</div>
        </div>
      </div>`
          : ""
      }
    </div>`
    : "";

  return `<div class="bracket-wrap"><div class="bracket">${columns}</div>${championSidebar}</div>`;
}

/*
  The pre-Sleeper (ESPN-era) equivalent of renderSummary() — deliberately
  much lighter, since only final standings and a partial playoff bracket
  exist for these seasons, not week-by-week matchup, waiver, or draft
  data to build the richer view from. Reuses renderBracket() as-is
  rather than a second bracket implementation.
*/
function renderManualSeasonSummary(season) {
  const standingsRows = [...season.standings]
    .sort((a, b) => a.standing - b.standing)
    .map((row) => {
      const medalEmoji = row.medal === "gold" ? "🏆" : row.medal === "silver" ? "🥈" : row.medal === "bronze" ? "🥉" : "";
      const games = row.wins + row.losses + (row.ties || 0);
      const avgPerWeek = games > 0 ? row.pointsFor / games : null;
      // Luck (actual win % vs. all-play "Overall Record" win %) is only
      // computable for a season that has that all-play record on file
      // (see row.overallRecord in data/manual-history.json) — same
      // formula the Sleeper-era seasons already use.
      const luckPct = row.overallRecord
        ? DeepHistory.luckPercent(row.wins, row.losses, row.ties || 0, row.overallRecord.wins, row.overallRecord.losses, row.overallRecord.ties || 0)
        : null;
      return `
        <tr>
          <td data-label="#">${row.standing}</td>
          <td class="team-cell" data-label="Team">${escapeHtml(row.team)}</td>
          <td data-label="Record">${row.wins}-${row.losses}${row.ties ? "-" + row.ties : ""}</td>
          <td data-label="PF">${row.pointsFor.toFixed(1)}</td>
          <td data-label="PA">${row.pointsAgainst.toFixed(1)}</td>
          <td data-label="Avg/Wk">${avgPerWeek != null ? avgPerWeek.toFixed(1) : "—"}</td>
          <td data-label="Luck">${luckPct != null ? luckBadge(luckPct) : "—"}</td>
          <td data-label="">${medalEmoji}</td>
        </tr>`;
    })
    .join("");

  const bracketData = ManualHistory.buildBracketData(season);
  // The manual data only stores the Finals MVP's name/position, not a
  // Sleeper player_id (there's no per-player data for these seasons) —
  // so resolve a photo the same way the Season Awards cards do: match
  // the free-text name against the full player directory.
  if (bracketData.champion && bracketData.champion.mvp && !bracketData.champion.mvp.playerId) {
    bracketData.champion.mvp.playerId = findPlayerIdByName(bracketData.champion.mvp.player, getPlayerNameIndex());
  }

  const hasLuckData = season.standings.some((row) => row.overallRecord);

  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Playoff Bracket</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      ${renderBracket(bracketData)}
      <p class="heatmap-note">Scores for the Quarterfinals and Semifinals aren't on record for this season — only the Finals score and MVP are known.</p>
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Final Standings</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="heatmap-table-wrap stay-scrollable">
        <table class="stat-table compact-mobile">
          <thead><tr><th>#</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th><th>Avg/Wk</th><th>Luck</th><th></th></tr></thead>
          <tbody>${standingsRows}</tbody>
        </table>
      </div>
      <p class="heatmap-note">From this league's ESPN era (before the move to Sleeper) — full weekly matchup, waiver, and draft data isn't available for this season, only final standings and the playoff bracket above.${
        hasLuckData
          ? ' "Luck" is the gap between a team\'s real win % and their all-play "Overall Record" win % (if every team played every other team, every week).'
          : ""
      }</p>
    </div></div>

    ${renderPowerRankHistorySection(season.year)}`;
}

let REPLAY_TIMER = null;
let REPLAY_WEEK_INDEX = 0;
let REPLAY_SNAPSHOTS = [];
const REPLAY_ROW_HEIGHT = 36;

// Deterministic hash so the SAME season always gets the SAME phrasing on
// repeat visits (not randomized fresh every page load), while different
// seasons naturally land on different variants.
function seasonSeed(season) {
  let hash = 0;
  const str = String(season);
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash;
}

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

function championshipNarrative(c) {
  const seed = seasonSeed(c.teamName + "|" + (c.runnerUpName || ""));
  const teamName = `<strong>${escapeHtml(c.teamName)}</strong>`;
  const runnerUp = c.runnerUpName ? `<strong>${escapeHtml(c.runnerUpName)}</strong>` : "the field";

  const introText = c.regularSeasonRecord
    ? RECAP_INTRO_VARIANTS[seed % RECAP_INTRO_VARIANTS.length](escapeHtml(c.regularSeasonRecord), c.seed)
    : "";

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
  if (c.mvpDraftRound) {
    return RECAP_MVP_DRAFT_VARIANTS[seed % RECAP_MVP_DRAFT_VARIANTS.length](player, c.mvpDraftRound);
  }
  return RECAP_MVP_VARIANTS[seed % RECAP_MVP_VARIANTS.length](player);
}

function buildSeasonRecordHighlights(records, season) {
  if (!records) return [];
  const seasonStr = String(season);
  const matches = (entry) => entry && String(entry.season) === seasonStr;
  const name = (entry, field) => escapeHtml(entry[`${field}Username`] || entry[field] || "Unknown");
  const highlights = [];

  if (matches(records.mostRegularSeasonPoints)) {
    const r = records.mostRegularSeasonPoints;
    highlights.push(
      `<strong>${escapeHtml(r.username || r.teamName)}</strong> put up the highest-scoring regular season in league history${
        r.topScorer ? `, powered by <strong>${playerLinkHtml(r.topScorer.playerId, escapeHtml(r.topScorer.player))}</strong>` : ""
      }.`
    );
  }
  if (matches(records.fewestRegularSeasonPoints)) {
    const r = records.fewestRegularSeasonPoints;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> had the lowest-scoring regular season in league history.`);
  }
  if (matches(records.highestWeekScore)) {
    const r = records.highestWeekScore;
    highlights.push(
      `<strong>${escapeHtml(r.username || r.teamName)}</strong> put up the highest single-week score in league history${
        r.topScorer ? `, led by <strong>${playerLinkHtml(r.topScorer.playerId, escapeHtml(r.topScorer.player))}</strong>` : ""
      }.`
    );
  }
  if (matches(records.lowestWeekScore)) {
    const r = records.lowestWeekScore;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> turned in the lowest single-week score in league history.`);
  }
  if (matches(records.biggestBlowout)) {
    const r = records.biggestBlowout;
    highlights.push(`<strong>${name(r, "winner")}</strong> handed <strong>${name(r, "loser")}</strong> the biggest blowout in league history.`);
  }
  if (matches(records.closestGame)) {
    const r = records.closestGame;
    highlights.push(`<strong>${name(r, "winner")}</strong> and <strong>${name(r, "loser")}</strong> played the closest game in league history.`);
  }
  if (matches(records.mostBenchPointsLeft)) {
    const r = records.mostBenchPointsLeft;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> left more points on the bench in a single week than anyone else, ever.`);
  }
  if (matches(records.mostConsistentSeason)) {
    const r = records.mostConsistentSeason;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> was the most consistent scoring team of any season in league history.`);
  }
  if (matches(records.leastConsistentSeason)) {
    const r = records.leastConsistentSeason;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> was the most boom-or-bust team of any season in league history.`);
  }
  if (matches(records.toughestSchedule)) {
    const r = records.toughestSchedule;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> faced the toughest schedule of any season in league history.`);
  }
  if (matches(records.easiestSchedule)) {
    const r = records.easiestSchedule;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> had the easiest schedule of any season in league history.`);
  }
  if (matches(records.bestValuePick)) {
    const r = records.bestValuePick;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> landed the best draft steal in league history: <strong>${playerLinkHtml(r.playerId, escapeHtml(r.player))}</strong>.`);
  }
  if (matches(records.worstValuePick)) {
    const r = records.worstValuePick;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> had the biggest draft bust in league history: <strong>${playerLinkHtml(r.playerId, escapeHtml(r.player))}</strong>.`);
  }

  return highlights;
}

function seasonStatCard(label, stat, subFormatter) {
  if (!stat) return "";
  return `
    <div class="recap-player-card">
      ${playerLinkHtml(stat.playerId, playerPhotoHtml(stat.playerId, stat.player, "player-photo-lg"))}
      <div class="recap-player-label">${escapeHtml(label)}</div>
      <div class="recap-player-name">${playerLinkHtml(stat.playerId, escapeHtml(stat.player))}</div>
      <div class="recap-player-sub">${escapeHtml(subFormatter(stat))}</div>
    </div>`;
}

function renderChampionshipRecap(recap, allTimeRecords, seasonStats) {
  const c = recap && recap.champion;
  const stats = seasonStats || {};
  const hasSeasonStats = stats.bestValuePick || stats.worstValuePick || stats.pointsLeader || stats.leagueMvp;
  if (!c && !hasSeasonStats) return "";

  const highlights = c ? buildSeasonRecordHighlights(allTimeRecords, recap.season) : [];
  const season = recap ? recap.season : stats.pointsLeader ? stats.pointsLeader.season : "";

  const mvpHtml =
    c && c.seasonMVP
      ? `
    <div class="recap-player-card">
      ${playerLinkHtml(c.seasonMVP.playerId, playerPhotoHtml(c.seasonMVP.playerId, c.seasonMVP.player, "player-photo-lg"))}
      <div class="recap-player-label">Champion's Ace</div>
      <div class="recap-player-name">${playerLinkHtml(c.seasonMVP.playerId, escapeHtml(c.seasonMVP.player))}</div>
    </div>`
      : "";

  const statCardsHtml = [
    seasonStatCard("League MVP", stats.leagueMvp, (s) => `${s.wins.toFixed(1)} wins above replacement`),
    seasonStatCard("Season Points Leader", stats.pointsLeader, (s) => `${s.points.toFixed(1)} total points`),
    seasonStatCard(
      "Best Draft Steal",
      stats.bestValuePick,
      (s) => `${s.round}.${s.pickInRound} by ${s.username || s.teamName} · ${s.points.toFixed(1)} pts`
    ),
    seasonStatCard(
      "Biggest Draft Bust",
      stats.worstValuePick,
      (s) => `${s.round}.${s.pickInRound} by ${s.username || s.teamName} · ${s.points.toFixed(1)} pts`
    ),
  ].join("");

  const championHeaderHtml = c
    ? `
      <div class="recap-eyebrow">🏆 ${escapeHtml(String(recap.season))} Champion</div>
      <div class="recap-champ-name">${escapeHtml(c.teamName)}</div>
      <p class="recap-narrative">${championshipNarrative(c)} ${championshipMvpNarrative(c)}</p>`
    : `<div class="recap-eyebrow">${escapeHtml(String(season))} Season</div>`;

  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Season Summary</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      ${championHeaderHtml}
      ${mvpHtml || statCardsHtml ? `<div class="recap-players">${mvpHtml}${statCardsHtml}</div>` : ""}
      ${
        highlights.length
          ? `
      <div class="recap-highlights">
        <div class="recap-player-label">Records Set This Season</div>
        <ul class="recap-highlight-list">${highlights.map((h) => `<li>${h}</li>`).join("")}</ul>
      </div>`
          : ""
      }
    </div></div>`;
}

// Turns computeStandingsHistory()'s week-by-week snapshots (each one a
// full sorted standings list) into the {name, color, points} series
// shape Charts.multiLineChart expects for a bump chart — one line per
// team, y = that week's rank (its position in the sorted snapshot + 1).
// This is the static, all-at-once counterpart to the animated replay:
// the same data, shaped for scanning the whole season's story in one
// look instead of pressing play.
function standingsHistoryToRankSeries(standingsHistory) {
  const rosterOrder = standingsHistory[0].standings.map((s) => s.rosterId);
  return rosterOrder.map((rosterId, i) => {
    const first = standingsHistory[0].standings.find((s) => s.rosterId === rosterId);
    const points = standingsHistory.map((snap) => {
      const rank = snap.standings.findIndex((s) => s.rosterId === rosterId) + 1;
      return { x: `W${snap.week}`, y: rank || null };
    });
    return {
      name: (first && (first.username || first.teamName)) || "Unknown",
      color: MULTI_LINE_COLORS[i % MULTI_LINE_COLORS.length],
      points,
    };
  });
}

function renderStandingsReplaySection(standingsHistory, playoffTeams) {
  if (!standingsHistory || standingsHistory.length < 2) return "";

  const bumpChart = Charts.multiLineChart(standingsHistoryToRankSeries(standingsHistory), {
    invertY: true,
    rankMode: true,
    formatter: (v) => v.toFixed(0),
    playoffCutoff: playoffTeams || null,
  });

  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Standings Over Time</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="chart-tabs">
        <button type="button" class="chart-tab" data-chart-tab="replay">Replay</button>
        <button type="button" class="chart-tab active" data-chart-tab="chart">Rank Chart</button>
      </div>
      <div class="chart-tab-panel" data-chart-panel="replay" style="display:none;">
        <div class="replay-controls">
          <button class="replay-btn" id="replay-play-btn" type="button">▶ Play</button>
          <input type="range" class="replay-slider" id="replay-slider" min="1" max="${standingsHistory.length}" value="1" />
          <span class="replay-week-label" id="replay-week-label">Week ${standingsHistory[0].week}</span>
        </div>
        <div class="replay-bars" id="replay-bars" data-playoff-teams="${playoffTeams || ""}"></div>
        <p class="heatmap-note">Rank through each regular-season week, sorted by wins (PF breaks ties).${playoffTeams ? ` The dashed line marks the top ${playoffTeams} — this season's playoff cutoff.` : ""}</p>
      </div>
      <div class="chart-tab-panel" data-chart-panel="chart">
        ${bumpChart}
        <p class="heatmap-note">Every team's rank each week, all at once.${playoffTeams ? ` The gold band marks the top ${playoffTeams} — this season's playoff cutoff.` : ""}</p>
      </div>
    </div></div>`;
}

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

// Finds each team's own "clinched" week (odds reach ~100% and never drop
// back below that for the rest of the season) or "eliminated" week (odds
// reach ~0% and never rise back above that) in a season's Playoff Odds
// dataset — one entry per team that has reached either state, so every
// team's own moment can be shown when hovering their own line (see the
// annotations' data-series wiring in Charts.multiLineChart), rather than
// only ever showing the single earliest clinch/elimination in the whole
// league. A team still undecided in the data on hand (e.g. an
// in-progress wild-card race) simply has no entry.
function findPlayoffOddsAnnotations(playoffOddsDataset) {
  const annotations = [];

  Object.entries(playoffOddsDataset || {}).forEach(([team, weekly]) => {
    for (let i = 0; i < weekly.length; i++) {
      if (weekly[i] != null && weekly[i] >= 99.5 && weekly.slice(i).every((v) => v != null && v >= 99.5)) {
        // "down": this point sits near the top of the chart (99.5%+), so
        // the label needs room below it.
        annotations.push({ seriesName: team, pointIndex: i, label: `Clinched — Wk ${i + 1}`, color: "var(--good)", direction: "down" });
        break;
      }
    }
    for (let i = 0; i < weekly.length; i++) {
      if (weekly[i] != null && weekly[i] <= 0.5 && weekly.slice(i).every((v) => v != null && v <= 0.5)) {
        // "up": this point sits near the bottom of the chart (0.5% or
        // less), so the label needs room above it.
        annotations.push({ seriesName: team, pointIndex: i, label: `Eliminated — Wk ${i + 1}`, color: "var(--bad)", direction: "up" });
        break;
      }
    }
  });

  return annotations;
}

function renderPowerRankHistorySection(season) {
  if (!POWER_RANK_CSV_HISTORY || !POWER_RANK_CSV_HISTORY.seasons) return "";
  const yearData = POWER_RANK_CSV_HISTORY.seasons[String(season)];
  if (!yearData || !yearData.ranks) return "";

  function toSeries(dataset) {
    const entries = Object.entries(dataset);
    return entries.map(([key, team], i) => ({
      name: team.label || key,
      color: MULTI_LINE_COLORS[i % MULTI_LINE_COLORS.length],
      points: [...(team.pre != null ? [{ x: "Pre", y: team.pre }] : []), ...team.weekly.map((v, wi) => ({ x: `W${wi + 1}`, y: v }))],
    }));
  }

  // Playoff Odds has no "Pre" value (tracking starts at Week 1) and is
  // stored as a flat array per team rather than {pre, weekly}.
  function toFlatSeries(dataset) {
    const entries = Object.entries(dataset);
    return entries.map(([key, weekly], i) => ({
      name: key,
      color: MULTI_LINE_COLORS[i % MULTI_LINE_COLORS.length],
      points: weekly.map((v, wi) => ({ x: `W${wi + 1}`, y: v })),
    }));
  }

  const hasUnknowns = Object.keys(yearData.ranks).some((k) => k.startsWith("unknown-"));
  // Two teams on the same PR Score share their places (6th and 7th are both 6.5), the way the Power Rankings page shows it.
  const rankLabel = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

  // Only seasons with all three datasets get all three tabs — a season
  // missing Power Score or Playoff Odds data just doesn't offer that tab,
  // rather than showing an empty chart.
  const tabs = [
    {
      key: "rank",
      label: "Power Rank By Week",
      chart: Charts.multiLineChart(toSeries(yearData.ranks), { invertY: true, rankMode: true, formatter: rankLabel }),
      note: `Rank 1 (best) is plotted at the top.${hasUnknowns ? " Some teams from this season couldn't be matched to a manager and are labeled by their preseason rank." : ""}`,
    },
    yearData.scores && {
      key: "score",
      label: "Power Score History",
      chart: Charts.multiLineChart(toSeries(yearData.scores), { invertY: true, formatter: (v) => v.toFixed(2) }),
      note: "Raw weighted PR Score each week — lower is better, same as the rank chart.",
    },
    yearData.playoffOdds && {
      key: "odds",
      label: "Playoff Odds History",
      chart: Charts.multiLineChart(toFlatSeries(yearData.playoffOdds), {
        formatter: (v) => v.toFixed(1) + "%",
        annotations: findPlayoffOddsAnnotations(yearData.playoffOdds),
      }),
      note: "Simulated chance of making the playoffs each week — higher is better, unlike the other two charts.",
    },
  ].filter(Boolean);

  const tabButtons = tabs
    .map((t, i) => `<button type="button" class="chart-tab${i === 0 ? " active" : ""}" data-chart-tab="${t.key}">${escapeHtml(t.label)}</button>`)
    .join("");
  const tabPanels = tabs
    .map(
      (t, i) => `
    <div class="chart-tab-panel" data-chart-panel="${t.key}"${i === 0 ? "" : ' style="display:none;"'}>
      ${t.chart}
      <p class="heatmap-note">${t.note}</p>
    </div>`
    )
    .join("");

  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Power Rank History</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="chart-tabs">${tabButtons}</div>
      ${tabPanels}
    </div></div>`;
}

let PLAYER_NAME_INDEX_CACHE = null;
function getPlayerNameIndex() {
  if (!PLAYER_NAME_INDEX_CACHE) PLAYER_NAME_INDEX_CACHE = buildPlayerNameIndex(PLAYER_DIRECTORY);
  return PLAYER_NAME_INDEX_CACHE;
}

function awardCard(label, winnerLabel, detail, playerId) {
  if (!playerId) {
    return `
      <div class="record-card">
        <p class="record-label">${escapeHtml(label)}</p>
        <p class="record-value award-winner-value">${escapeHtml(winnerLabel)}</p>
        ${detail ? `<p class="record-detail">${escapeHtml(detail)}</p>` : ""}
      </div>`;
  }
  return `
    <div class="record-card record-card-photo">
      ${playerLinkHtml(playerId, playerPhotoHtml(playerId, detail || winnerLabel, "player-photo-sm"))}
      <div>
        <p class="record-label">${escapeHtml(label)}</p>
        <p class="record-value award-winner-value">${escapeHtml(winnerLabel)}</p>
        ${detail ? `<p class="record-detail">${playerLinkHtml(playerId, escapeHtml(detail))}</p>` : ""}
      </div>
    </div>`;
}

function renderAwardsSection(season) {
  if (!SEASON_AWARDS || !SEASON_AWARDS.seasons) return "";
  const yearAwards = SEASON_AWARDS.seasons[String(season)];
  if (!yearAwards) return "";
  const nameIndex = getPlayerNameIndex();
  const cards = Object.entries(yearAwards)
    .map(([category, award]) => {
      const winnerLabel = award.username || award.winnerName || "Unknown";
      const playerId = award.detail ? findPlayerIdByName(award.detail, nameIndex) : null;
      return awardCard(category, winnerLabel, award.detail, playerId);
    })
    .join("");
  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Season Awards</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${cards}</div>
    </div>`;
}

// The title over the standings table. A season still in progress isn't "final" yet.
function standingsLabel(s) {
  if (s.season === "All-Time" || s.status === "complete") return "Final Standings";
  return s.weeksPlayed ? `Standings \u00b7 Through Week ${s.weeksPlayed}` : "Standings";
}

// ---------------------------------------------------------------
// MVP, draft awards, pickups and injury luck (all from Metrics)
// ---------------------------------------------------------------
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

// The recap card up top and the old "Draft Standouts" read the new steal / bust
// and the new League MVP, so the page never shows two different answers.
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
  return `<div class="season-pills metric-pills" role="group" aria-label="Filter by position">${METRIC_POSITIONS.map(
    (pos) => `<button type="button" class="season-pill${pos === active ? " active" : ""}" data-metric-group="${group}" data-metric-value="${pos}" aria-pressed="${pos === active}">${pos}</button>`
  ).join("")}</div>`;
}

function mvpRowsHtml(list, withSeason) {
  if (!list || !list.length) return `<div class="empty-state">Not enough games played yet.</div>`;
  return `<div class="rank-list">${list
    .map(
      (r, i) => `
    <div class="rank-list-row faab-row">
      <span class="rank-num">${i + 1}</span>
      ${playerLinkHtml(r.playerId, playerPhotoHtml(r.playerId, r.player, "player-photo-sm"))}
      <span class="desc">${playerLinkHtml(r.playerId, escapeHtml(r.player))} <span class="muted-inline">(${escapeHtml(r.position)})</span><span class="sub">${
        r.owner ? `${escapeHtml(r.owner)} · ` : ""
      }${withSeason && r.season ? `${escapeHtml(String(r.season))}${r.inProgress ? " (in progress)" : ""} · ` : ""}${r.ppg.toFixed(1)} PPG over ${r.gamesPlayed} games${r.swung ? ` · swung ${r.swung} result${r.swung === 1 ? "" : "s"}` : ""}</span></span>
      <span class="val">${r.wins.toFixed(1)} W <span class="muted-inline">· ${r.par.toFixed(0)} pts</span></span>
    </div>`
    )
    .join("")}</div>`;
}

function draftValueRowsHtml(list, withSeason) {
  if (!list || !list.length) return `<div class="empty-state">Nothing to show.</div>`;
  return `<div class="rank-list">${list
    .map(
      (r, i) => `
    <div class="rank-list-row faab-row">
      <span class="rank-num">${i + 1}</span>
      ${playerLinkHtml(r.playerId, playerPhotoHtml(r.playerId, r.player, "player-photo-sm"))}
      <span class="desc">${playerLinkHtml(r.playerId, escapeHtml(r.player))} <span class="muted-inline">(${escapeHtml(r.position || "")})</span><span class="sub">${r.round}.${r.pickInRound} (#${r.pickNo}) by ${escapeHtml(
        r.username || "Unknown"
      )}${withSeason ? ` · ${escapeHtml(String(r.season))}` : ""} · ${r.value.toFixed(0)} vs ${r.typical.toFixed(0)} typical${r.injuredWeeks >= 3 ? ` · ${r.injuredWeeks} wks injured` : ""}</span></span>
      <span class="val">${r.valueOverSlot >= 0 ? "+" : ""}${r.valueOverSlot.toFixed(0)} ${gradeBadgeHtml(r.grade)}</span>
    </div>`
    )
    .join("")}</div>`;
}

function wireCostLabel(r) {
  if (r.type === "free_agent") return "Free agent";
  return r.bid > 0 ? `$${r.bid}` : "$0 waiver";
}

function wireRowsHtml(list, withSeason) {
  if (!list || !list.length) return `<div class="empty-state">No pickups at this position.</div>`;
  return `<div class="rank-list">${list
    .map(
      (r, i) => `
    <div class="rank-list-row faab-row">
      <span class="rank-num">${i + 1}</span>
      ${playerLinkHtml(r.playerId, playerPhotoHtml(r.playerId, r.player, "player-photo-sm"))}
      <span class="desc">${playerLinkHtml(r.playerId, escapeHtml(r.player))} <span class="muted-inline">(${escapeHtml(r.position)})</span><span class="sub">${escapeHtml(r.username)} · Week ${r.week}${
        withSeason ? ` · ${escapeHtml(String(r.season))}` : ""
      } · ${wireCostLabel(r)} · started ${r.startedWeeks} of ${r.heldWeeks} games${r.finishRank ? ` · finished ${escapeHtml(r.position)}${r.finishRank}` : ""}${
        r.swung ? ` · swung ${r.swung} result${r.swung === 1 ? "" : "s"}` : ""
      }</span></span>
      <span class="val">+${r.value.toFixed(0)}</span>
    </div>`
    )
    .join("")}</div>`;
}

function filterByPosition(list, pos) {
  return (pos === "All" ? list : list.filter((r) => r.position === pos)).slice(0, WIRE_LIST_SIZE);
}

function renderAwardsMetricsSection(s) {
  const m = s.metrics;
  if (!m) return "";
  const label = `<div class="yard-divider"><span class="tick"></span><div class="line"></div><span class="label">MVP &amp; Draft Awards</span><div class="line"></div></div>`;

  if (m.kind === "total") {
    const rows = [...m.awards]
      .reverse()
      .filter((a) => a.mvp.All.length)
      .map((a) => ({ ...a.mvp.All[0], season: a.season, inProgress: !a.complete }));
    return `${label}
    <div class="wrap">
      <div class="panel">
        <h2>League MVP By Season</h2>
        ${mvpRowsHtml(rows, true)}
        <p class="heatmap-note">The player with the most points above a replacement-level player at his position over the regular season, in games he played, shown in wins (1 win is about ${m.constants.pointsPerWin.toFixed(0)} season points in this league). Picks only count where the season is over.</p>
      </div>
      <div class="section-grid" style="margin-top:24px;">
        <div class="panel"><h2>Biggest Draft Steals Of All Time</h2>${draftValueRowsHtml(m.steals, true)}</div>
        <div class="panel"><h2>Biggest Draft Busts Of All Time</h2>${draftValueRowsHtml(m.busts, true)}</div>
      </div>
      <div class="panel" style="margin-top:24px;"><h2>Most Cursed Picks Of All Time</h2>${draftValueRowsHtml(m.cursed, true)}
        <p class="heatmap-note">Picks that missed three or more weeks to the injury report and still came in below their slot. Not counted as busts.</p>
      </div>
    </div>`;
  }

  const a = m.awards;
  const mvpList = a.mvp.All;
  const aceHtml = a.championsAce
    ? `<div class="records-grid" style="margin-top:20px;">${recordCardWithPhoto("Champion's Ace", a.championsAce.playerId, a.championsAce.player, `${a.championsAce.points.toFixed(1)} points as a starter for ${escapeHtml(a.championsAce.team || "the champion")}, playoffs included`)}</div>`
    : "";
  const draftHtml = a.complete
    ? `
      <div class="section-grid section-grid-even" style="margin-top:24px;">
        <div class="panel"><h2>Biggest Steals</h2>${draftValueRowsHtml(a.steals)}</div>
        <div class="panel"><h2>Biggest Busts</h2>${draftValueRowsHtml(a.busts)}
          <p class="heatmap-note">Picks who missed two or fewer weeks to the injury report.</p></div>
      </div>
      ${a.cursed.length ? `<div class="panel" style="margin-top:24px;"><h2>Cursed Picks</h2>${draftValueRowsHtml(a.cursed)}<p class="heatmap-note">Missed three or more weeks to the injury report and still came in below their slot. Not counted as busts.</p></div>` : ""}`
    : `<div class="panel" style="margin-top:24px;"><h2>Draft Awards</h2><div class="empty-state">Steals, busts and cursed picks are handed out when the season ends.</div></div>`;
  return `${label}
    <div class="wrap">
      <div class="panel">
        <h2>League MVP${a.complete ? "" : ` · Through Week ${a.regularWeeks}`}</h2>
        ${metricPillsHtml("mvp", "All")}
        <div id="metric-mvp-list">${mvpRowsHtml(mvpList)}</div>
        <p class="heatmap-note">Points above a replacement-level player at his position, in games he played, over the regular season. Shown in wins (about ${m.constants.pointsPerWin.toFixed(0)} season points per win in this league), with how many results he swung for the teams that started him. A QB leading is normal in SuperFlex.</p>
        ${aceHtml}
      </div>
      ${draftHtml}
    </div>`;
}

function renderWireMetricsSection(s) {
  const m = s.metrics;
  if (!m) return "";
  const isTotal = m.kind === "total";
  const pickups = m.wire.pickups;
  if (!pickups.length) return "";
  const faabHtml = s.top5FaabPickups && s.top5FaabPickups.length ? `<div class="panel"><h2>Top 5 Priciest FAAB Pickups${isTotal ? " Of All Time" : ""}</h2>${renderFaabList(s.top5FaabPickups, isTotal)}</div>` : "";
  const managers = !isTotal
    ? `
      <div class="panel" style="margin-top:24px;">
        <h2>Wire Standings</h2>
        <div class="heatmap-table-wrap stay-scrollable">
          <table class="stat-table compact-mobile">
            <thead><tr><th>#</th><th>Manager</th><th>Wire Value</th><th>Claims</th><th>Hits</th><th>FAAB</th><th>Swung</th></tr></thead>
            <tbody>${m.wire.managers
              .map(
                (t, i) => `<tr data-username="${escapeHtml(t.username || "")}"><td class="rank">${i + 1}</td><td class="team-cell">${escapeHtml(t.username || "")}</td><td>${t.value.toFixed(0)}</td><td>${t.claims}</td><td>${t.hits}</td><td>$${t.faab}</td><td>${t.swung}</td></tr>`
              )
              .join("")}</tbody>
          </table>
        </div>
        <p class="heatmap-note">Wire Value adds up each manager's pickups that paid off. A "hit" is a pickup worth 15 or more points. FAAB is dollars spent on claims.</p>
      </div>`
    : "";
  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Waiver Wire</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">
        <h2>Top 5 Best Pickups${isTotal ? " Of All Time" : ""}</h2>
        ${metricPillsHtml("wire", "All")}
        <div id="metric-wire-list">${wireRowsHtml(filterByPosition(pickups, "All"), isTotal)}</div>
        <p class="heatmap-note">Wire Value is points above a replacement-level player at the position in the games the claiming team started him, from the claim until he left that roster, playoff games included. Waivers and free agents count the same. Kickers and defenses count ${Math.round(Metrics.WIRE_LOW_IMPACT_FACTOR * 100)}% as much, so they appear only when truly outstanding.</p>
      </div>
      ${managers}
      ${faabHtml ? `<div style="margin-top:24px;">${faabHtml}</div>` : ""}
    </div>`;
}

function injuryTeamRowsHtml(teams) {
  if (!teams.length) return `<div class="empty-state">No injury data recorded for this season.</div>`;
  return `<div class="rank-list">${teams
    .map((t, i) => {
      const sub = `${t.resultsLost} result${t.resultsLost === 1 ? "" : "s"} lost · ${t.resultsGifted} gifted`;
      const summary = `
      <span class="rank-num">${i + 1}</span>
      <span class="desc">${escapeHtml(t.username || "")}<span class="sub">${sub}</span></span>
      <span class="val">${t.pointsLost.toFixed(1)} pts lost</span>`;
      const players = (t.players || []).filter((p) => p.pointsLost > 0.05);
      if (!players.length) return `<div class="rank-list-row">${summary}</div>`;
      const playersHtml = players
        .map(
          (p) => `
        <div class="injury-detail-row">
          ${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.player, "player-photo-xs"))}
          <span class="injury-detail-name">${playerLinkHtml(p.playerId, escapeHtml(p.player))} <span class="muted-inline">(${escapeHtml(p.position || "")})</span></span>
          <span class="injury-detail-pts">${p.pointsLost.toFixed(1)} pts lost</span>
        </div>`
        )
        .join("");
      return `
      <details class="rank-list-item">
        <summary class="rank-list-row">${summary}</summary>
        <div class="injury-detail-list">${playersHtml}</div>
      </details>`;
    })
    .join("")}</div>`;
}

function injuryPlayerRowsHtml(items, withSeason) {
  if (!items.length) return `<div class="empty-state">No significant injuries recorded.</div>`;
  return `<div class="rank-list">${items
    .map(
      (p, i) => `
    <div class="rank-list-row faab-row">
      <span class="rank-num">${i + 1}</span>
      ${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.player, "player-photo-sm"))}
      <span class="desc">${playerLinkHtml(p.playerId, escapeHtml(p.player))}<span class="sub">${escapeHtml(p.position || "")} · ${escapeHtml(p.username || "")} · ${p.weeks} week${p.weeks === 1 ? "" : "s"}${
        withSeason ? ` · ${escapeHtml(String(p.season))}` : ""
      }</span></span>
      <span class="val">${p.pointsLost.toFixed(1)} pts lost</span>
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
    ? `<div class="rank-list">${m.injury.topTeamSeasons
        .map(
          (t, i) => `
        <div class="rank-list-row"><span class="rank-num">${i + 1}</span><span class="desc">${escapeHtml(t.username || "")}<span class="sub">${escapeHtml(String(t.season))} · ${t.resultsLost} results lost · ${t.resultsGifted} gifted</span></span><span class="val">${t.pointsLost.toFixed(1)} pts lost</span></div>`
        )
        .join("")}</div>`
    : injuryTeamRowsHtml(m.injury.teams);
  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Injury Luck</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">
        <h2>Top 5 Most Costly Player Injuries${isTotal ? " Of All Time" : ""}</h2>
        ${injuryPlayerRowsHtml(topPlayers, isTotal)}
        <p class="heatmap-note">"Points lost" is what an injury took out of the team's best possible lineup: each week a player is on the injury report, compare the best lineup with him at what he would reasonably have scored (his own healthy average blended with what a pick at his draft slot normally returns) against the best lineup the team could actually field. A bench player who stepped in cushions the loss.</p>
      </div>
      <div class="panel" style="margin-top:24px;">
        <h2>${isTotal ? "Top 5 Team Seasons With The Worst Injury Luck" : "Injury Luck Ranking"}</h2>
        ${teamsHtml}
        <p class="heatmap-note">${
          isTotal
            ? "Points lost to injuries, with the games that would have flipped to wins (results lost) and the games a team won that would have flipped had its opponent's injuries not happened (gifted)."
            : "Worst luck first. \"Results lost\" are losses that become wins with the lost points added back; \"gifted\" are wins that would have flipped without the opponent's injuries. Each week an injury is charged to the team holding the player; if nobody holds him (he was dropped), to the last team that did. Click a team to see which players cost it the most."
        }</p>
      </div>
    </div>`;
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

function renderSummary(s) {
  const isTotal = s.season === "All-Time";
  const yearTag = (item) => (isTotal && item && item.season ? ` (${item.season})` : "");

  const avgByStandingsKey = new Map();
  (s.teamAverages || []).forEach((t) => {
    const key = t.rosterId != null ? t.rosterId : t.userId;
    if (key != null) avgByStandingsKey.set(key, t.average);
  });

  const standingsRows = s.standings
    .map(
      (t, i) => `
    <tr>
      <td class="rank" data-label="#">${i + 1}</td>
      <td class="team-cell">${escapeHtml(t.teamName)}${t.rosterId === s.championRosterId ? " 🏆" : t.rosterId === s.runnerUpRosterId ? " 🥈" : t.rosterId === s.thirdPlaceRosterId ? " 🥉" : ""}${isTotal && t.championships ? ` ${"🏆".repeat(Math.min(t.championships, 5))}` : ""}</td>
      <td data-label="Record">${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
      <td data-label="PF">${t.fpts.toFixed(1)}</td>
      <td data-label="PA">${t.fptsAgainst.toFixed(1)}</td>
      <td data-label="Avg/Wk">${avgByStandingsKey.has(t.rosterId) ? avgByStandingsKey.get(t.rosterId).toFixed(1) : "—"}</td>
      <td data-label="Overall">${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}</td>
      <td data-label="Luck">${luckBadge(t.luckPct)}</td>
      ${isTotal ? "" : `<td data-label="SOS">${t.avgOpponentPF != null ? t.avgOpponentPF.toFixed(1) : "—"}</td>`}
    </tr>`
    )
    .join("");

  const weeklyTrendChart = Charts.lineChart(
    s.weeklyLeagueAvg.map((w) => ({ x: w.week, y: w.avg })),
    { formatter: (v) => v.toFixed(0) }
  );

  const positionTableHtml = renderPositionTable(s.positionTable);

  const extremeCards = [
    s.highestWeekScore &&
      expandableRecordCard(
        "Highest Score",
        s.highestWeekScore.points.toFixed(1),
        `${escapeHtml(s.highestWeekScore.teamName)} · Week ${s.highestWeekScore.week}${yearTag(s.highestWeekScore)}`,
        [{ teamName: s.highestWeekScore.teamName, lineup: s.highestWeekScore.lineup }]
      ),
    s.lowestWeekScore &&
      expandableRecordCard(
        "Lowest Score",
        s.lowestWeekScore.points.toFixed(1),
        `${escapeHtml(s.lowestWeekScore.teamName)} · Week ${s.lowestWeekScore.week}${yearTag(s.lowestWeekScore)}`,
        [{ teamName: s.lowestWeekScore.teamName, lineup: s.lowestWeekScore.lineup }]
      ),
  ]
    .filter(Boolean)
    .join("");

  const matchupLineupSections = (m) => [
    { teamName: m.winner, lineup: m.winnerLineup },
    { teamName: m.loser, lineup: m.loserLineup },
  ];
  const closestListHtml = renderRankList(
    s.top5Closest,
    (m) => ({
      main: `${escapeHtml(m.winner)} def. ${escapeHtml(m.loser)}`,
      sub: `Week ${m.week}${yearTag(m)} · ${m.winnerPts.toFixed(1)} - ${m.loserPts.toFixed(1)}`,
      value: `${m.margin.toFixed(2)} pt`,
    }),
    matchupLineupSections
  );
  const blowoutListHtml = renderRankList(
    s.top5Blowouts,
    (m) => ({
      main: `${escapeHtml(m.winner)} over ${escapeHtml(m.loser)}`,
      sub: `Week ${m.week}${yearTag(m)} · ${m.winnerPts.toFixed(1)} - ${m.loserPts.toFixed(1)}`,
      value: `${m.margin.toFixed(1)} pt`,
    }),
    matchupLineupSections
  );

  const luckiestListHtml = isTotal
    ? renderRankList(s.top5Luckiest, (t) => ({
        main: `${escapeHtml(t.teamName)} · ${t.season}`,
        sub: `Record ${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""} · Overall ${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}`,
        value: luckBadge(t.luckPct),
      }))
    : "";
  const unluckiestListHtml = isTotal
    ? renderRankList(s.top5Unluckiest, (t) => ({
        main: `${escapeHtml(t.teamName)} · ${t.season}`,
        sub: `Record ${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""} · Overall ${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}`,
        value: luckBadge(t.luckPct),
      }))
    : "";

  const POSITION_LABELS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DEF" };
  const bestByPositionCards = Object.entries(POSITION_LABELS)
    .map(([pos, label]) => {
      const x = s.bestByPosition[pos];
      if (!x) return "";
      return recordCardWithPhoto(`Best ${label} Week`, x.playerId, x.player, `${x.points.toFixed(1)} pts · ${escapeHtml(x.teamName)} · Wk ${x.week}${yearTag(x)}`);
    })
    .join("");

  return `
    ${isTotal ? "" : renderChampionshipRecap(s.championshipRecap, s.allTimeRecords, { bestValuePick: s.bestValuePick, worstValuePick: s.worstValuePick, pointsLeader: s.pointsLeader, leagueMvp: s.leagueMvp })}

    ${
      s.bracket
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Playoff Bracket</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      ${renderBracket(s.bracket)}
    </div></div>`
        : ""
    }

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">${escapeHtml(standingsLabel(s))}</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="heatmap-table-wrap stay-scrollable">
        <table class="stat-table compact-mobile sticky-cols-2">
          <thead><tr><th>#</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th><th>Avg/Wk</th><th>Overall</th><th>Luck</th>${isTotal ? "" : "<th>SOS</th>"}</tr></thead>
          <tbody>${standingsRows}</tbody>
        </table>
      </div>
      <p class="heatmap-note">"Overall" is the record if every team played every other team, every week. "Luck" is the gap between a team's real win % and their Overall win %.${isTotal ? "" : " \"SOS\" is average regular-season opponent score faced — higher means a tougher schedule."}</p>
    </div></div>

    ${isTotal ? "" : renderStandingsReplaySection(s.standingsHistory, s.playoffTeams)}

    ${
      isTotal
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Weekly Scoring Trend</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>Average Score By Week Of Season (All Years)</h2>
      ${weeklyTrendChart}
    </div></div>`
        : ""
    }

    ${isTotal ? "" : renderPowerRankHistorySection(s.season)}

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">By Starting Slot</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>Average Score Per Week, By Lineup Slot</h2>
      ${positionTableHtml}
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Season Extremes</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${extremeCards || `<div class="empty-state">No games played yet.</div>`}</div>
    </div>

    <div class="wrap">
      <div class="section-grid" style="margin-top:20px;">
        <div class="panel">
          <h2>Top 5 Closest Matchups</h2>
          ${closestListHtml}
        </div>
        <div class="panel">
          <h2>Top 5 Biggest Blowouts</h2>
          ${blowoutListHtml}
        </div>
      </div>
    </div>

    ${
      isTotal
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Luck</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="section-grid">
        <div class="panel">
          <h2>Top 10 Luckiest Seasons</h2>
          ${luckiestListHtml}
        </div>
        <div class="panel">
          <h2>Top 10 Unluckiest Seasons</h2>
          ${unluckiestListHtml}
        </div>
      </div>
    </div>`
        : ""
    }

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Best By Position</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${bestByPositionCards || `<div class="empty-state">No lineup data available.</div>`}</div>
    </div>

    ${renderAwardsMetricsSection(s)}

    ${renderWireMetricsSection(s)}

    ${renderInjuryMetricsSection(s)}

    ${renderAwardsSection(s.season)}
  `;
}

document.addEventListener("DOMContentLoaded", renderSeasonPage);
