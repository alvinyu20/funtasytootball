let SEASON_CHAIN = null;
let PLAYER_DIRECTORY = null;
let SEASON_AWARDS = null;

async function renderSeasonPage() {
  const errorBox = document.getElementById("season-error");
  try {
    const [seasonChain, playerDirectory, seasonAwards] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(SEASON_AWARDS_FILE, { seasons: {} }),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    SEASON_CHAIN = seasonChain;
    PLAYER_DIRECTORY = playerDirectory;
    SEASON_AWARDS = seasonAwards;

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
  const yearPills = [...SEASON_CHAIN]
    .reverse() // newest first
    .map((s) => {
      const year = s.league.season;
      const isActive = String(year) === String(selectedKey);
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
        progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : `Fetching ${season}…`;
      });

      const summary = DeepHistory.computeTotalSummary(SEASON_CHAIN, deepSeasons, PLAYER_DIRECTORY);

      progressBox.style.display = "none";
      content.style.display = "";
      content.innerHTML = renderSummary(summary);

      const leagueName = SEASON_CHAIN[SEASON_CHAIN.length - 1].league.name;
      document.title = (SITE_TITLE || leagueName || "League") + " — All-Time";
      document.getElementById("sb-title").textContent = "All-Time";
      document.getElementById("sb-sub").textContent = `${SEASON_CHAIN.length} season${SEASON_CHAIN.length === 1 ? "" : "s"} combined`;
      return;
    }

    const seasonEntry = getSelectedSeasonEntry();
    renderPicker(seasonEntry.league.season);

    content.style.display = "none";
    errorBox.style.display = "none";
    progressBox.style.display = "block";
    progressBox.textContent = `Loading ${seasonEntry.league.season}…`;

    const deep = await DeepHistory.fetchSeasonDeep(seasonEntry, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : `Fetching ${season}…`;
    });

    const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, PLAYER_DIRECTORY);

    progressBox.style.display = "none";
    content.style.display = "";
    content.innerHTML = renderSummary(summary);

    const leagueName = SEASON_CHAIN[SEASON_CHAIN.length - 1].league.name;
    document.title = (SITE_TITLE || leagueName || "League") + " — " + summary.season + " Season";
    document.getElementById("sb-title").textContent = summary.season + " Season";
    document.getElementById("sb-sub").textContent =
      summary.status === "complete" ? `${summary.weeksPlayed} weeks played` : `In progress · ${summary.weeksPlayed} weeks so far`;
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

function lineupRows(lineup) {
  return lineup
    .map(
      (p) => `
      <div class="draft-pick-row">
        <span>${escapeHtml(p.slot)}</span>
        <span class="pick-player">${escapeHtml(p.player)}</span>
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
          if (v == null) return `<td class="heat-cell empty">—</td>`;
          const { min, max } = ranges[col.key];
          const bg = heatColor(v, min, max);
          return `<td class="heat-cell" style="background:${bg}">${v.toFixed(1)}</td>`;
        })
        .join("");
      return `<tr><td class="team-cell">${escapeHtml(r.teamName)}</td>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="heatmap-table-wrap">
      <table class="stat-table">
        <thead><tr><th>Team</th>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="heatmap-note">Each column is colored independently — gold is that column's best, rust is its worst.</p>`;
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
          <details class="bracket-game${g.isChampionship ? " championship" : ""}">
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
      <div class="bracket-sidebar-value">⭐ ${escapeHtml(bracketData.champion.mvp.player)}</div>
      <div class="bracket-sidebar-sub">${bracketData.champion.mvp.points.toFixed(1)} pts</div>`
          : ""
      }
    </div>`
    : "";

  return `<div class="bracket-wrap"><div class="bracket">${columns}</div>${championSidebar}</div>`;
}

function renderAwardsSection(season) {
  if (!SEASON_AWARDS || !SEASON_AWARDS.seasons) return "";
  const yearAwards = SEASON_AWARDS.seasons[String(season)];
  if (!yearAwards) return "";
  const cards = Object.entries(yearAwards)
    .map(([category, award]) => {
      const winnerLabel = award.username || award.winnerName || "Unknown";
      return recordCard(category, escapeHtml(winnerLabel), award.detail ? escapeHtml(award.detail) : "");
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

function renderSummary(s) {
  const isTotal = s.season === "All-Time";
  const yearTag = (item) => (isTotal && item && item.season ? ` (${item.season})` : "");

  const standingsRows = s.standings
    .map(
      (t, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td class="team-cell">${escapeHtml(t.teamName)}${t.rosterId === s.championRosterId ? " 🏆" : ""}${isTotal && t.championships ? ` ${"🏆".repeat(Math.min(t.championships, 5))}` : ""}</td>
      <td>${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
      <td>${t.fpts.toFixed(1)}</td>
      <td>${t.fptsAgainst.toFixed(1)}</td>
      <td>${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}</td>
      <td>${luckBadge(t.luckPct)}</td>
    </tr>`
    )
    .join("");

  const weeklyTrendChart = Charts.lineChart(
    s.weeklyLeagueAvg.map((w) => ({ x: w.week, y: w.avg })),
    { formatter: (v) => v.toFixed(0) }
  );

  const teamAvgChart = Charts.barChart(
    s.teamAverages.map((t) => ({ label: t.teamName, value: t.average }))
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
      value: `${m.margin.toFixed(1)} pt`,
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

  const faabListHtml = s.top5FaabPickups
    ? renderRankList(s.top5FaabPickups, (p) => ({
        main: `${escapeHtml(p.player)}`,
        sub: `${escapeHtml(p.teamName)}${p.week ? ` · Week ${p.week}` : ""}`,
        value: `$${p.bid}`,
      }))
    : "";

  const POSITION_LABELS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DEF" };
  const bestByPositionCards = Object.entries(POSITION_LABELS)
    .map(([pos, label]) => {
      const x = s.bestByPosition[pos];
      if (!x) return "";
      return recordCard(`Best ${label} Week`, x.points.toFixed(1), `${escapeHtml(x.player)} · ${escapeHtml(x.teamName)} · Wk ${x.week}${yearTag(x)}`);
    })
    .join("");

  const draftCards = [
    s.bestValuePick && recordCard("Best Late-Round Steal", escapeHtml(s.bestValuePick.player), `Rd ${s.bestValuePick.round} Pick ${s.bestValuePick.pickNo} by ${escapeHtml(s.bestValuePick.teamName)} · ${s.bestValuePick.points.toFixed(1)} pts${yearTag(s.bestValuePick)}`),
    s.worstValuePick && recordCard("Biggest Draft Bust", escapeHtml(s.worstValuePick.player), `Rd ${s.worstValuePick.round} Pick ${s.worstValuePick.pickNo} by ${escapeHtml(s.worstValuePick.teamName)} · ${s.worstValuePick.points.toFixed(1)} pts${yearTag(s.worstValuePick)}`),
    s.pointsLeader && recordCard("Season Points Leader", escapeHtml(s.pointsLeader.player), `${s.pointsLeader.points.toFixed(1)} total points${yearTag(s.pointsLeader)}`),
  ]
    .filter(Boolean)
    .join("");

  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Final Standings</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <table class="stat-table">
        <thead><tr><th>#</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th><th>Overall</th><th>Luck</th></tr></thead>
        <tbody>${standingsRows}</tbody>
      </table>
      <p class="heatmap-note">"Overall" is the record if every team played every other team, every week. "Luck" is the gap between a team's real win % and their Overall win %.</p>
    </div></div>

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
      <span class="label">Weekly Scoring Trend</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>${isTotal ? "Average Score By Week Of Season (All Years)" : "League Average Score By Week"}</h2>
      ${weeklyTrendChart}
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Team Scoring</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>Average Score Per Week</h2>
      ${teamAvgChart}
    </div></div>

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
          <h2>Top 5 Luckiest Seasons</h2>
          ${luckiestListHtml}
        </div>
        <div class="panel">
          <h2>Top 5 Unluckiest Seasons</h2>
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

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Draft Standouts</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${draftCards || `<div class="empty-state">No draft data for this season.</div>`}</div>
    </div>

    ${
      s.top5FaabPickups && s.top5FaabPickups.length
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Waiver Wire</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">
        <h2>Top 5 Priciest FAAB Pickups</h2>
        ${faabListHtml}
      </div>
    </div>`
        : ""
    }

    ${renderAwardsSection(s.season)}
  `;
}

document.addEventListener("DOMContentLoaded", renderSeasonPage);
