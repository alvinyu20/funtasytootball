let LEAGUE_STATS = null;
let SEASON_AWARDS = null;
let TRACKED_SEASON_YEARS = null;

async function renderTeams() {
  const errorBox = document.getElementById("teams-error");
  const progressBox = document.getElementById("progress-status");

  try {
    const [seasonChain, playerDirectory, seasonAwards, manualHistory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(SEASON_AWARDS_FILE, { seasons: {} }),
      fetchJsonSafe(MANUAL_HISTORY_FILE, { seasons: [] }),
    ]);

    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    SEASON_AWARDS = seasonAwards;
    TRACKED_SEASON_YEARS = new Set(seasonChain.map((s) => String(s.league.season)));

    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Teams";
    const totalSeasonCount = seasonChain.length + ((manualHistory && manualHistory.seasons) || []).length;
    document.getElementById("sb-sub").textContent = `${totalSeasonCount} season${totalSeasonCount === 1 ? "" : "s"} of history`;

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    LEAGUE_STATS = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);

    // Fold ESPN-era (pre-Sleeper) totals and season-by-season entries
    // into any manager who's also played in the Sleeper era — same
    // merge helper history.js uses for Career Records, so the two
    // pages can't disagree with each other about someone's numbers.
    // Keyed by looking each Sleeper manager's own username up in the
    // manual data, so a name that only ever appears in the ESPN-era
    // data (never continued into Sleeper) simply has nothing to merge
    // onto and is naturally excluded — no separate allow-list needed.
    const manualStatsByTeam = ManualHistory.computeManagerStats(manualHistory);
    // Same idea for playoff head-to-head — ESPN-era playoff games,
    // keyed by team name (see computeHeadToHeadPlayoffs' own comment for
    // why name rather than user_id), merged into each Sleeper manager's
    // existing headToHeadPlayoffs list by matching opponent name.
    const manualH2HPlayoffs = ManualHistory.computeHeadToHeadPlayoffs(manualHistory);
    LEAGUE_STATS.managers.forEach((m) => {
      if (!m.username) return;
      const manualForThisManager = manualStatsByTeam.get(m.username);
      if (manualForThisManager) {
        ManualHistory.mergeIntoManager(m, manualForThisManager.totals);
        m.seasons = [...m.seasons, ...manualForThisManager.seasons];
      }
      ManualHistory.mergeHeadToHeadPlayoffs(m, manualH2HPlayoffs.get(m.username));
    });

    renderManagerPicker();
    renderFromHash();
    window.addEventListener("hashchange", () => {
      renderManagerPicker();
      renderFromHash();
    });
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load team history — " + err.message;
    errorBox.style.display = "block";
  }
}

function renderManagerPicker() {
  const picker = document.getElementById("manager-picker");
  const selectedUserId = decodeURIComponent(location.hash.replace(/^#/, ""));
  picker.innerHTML = LEAGUE_STATS.managers
    .map((m) => {
      const isActive = m.userId === selectedUserId;
      const overallWins = m.careerRegularSeasonWins + m.careerPlayoffWins;
      const overallLosses = m.careerRegularSeasonLosses + m.careerPlayoffLosses;
      const overallTies = m.careerRegularSeasonTies + m.careerPlayoffTies;
      const totalGames = overallWins + overallLosses + overallTies;
      const winPct = totalGames > 0 ? (overallWins / totalGames) * 100 : 0;
      const bySeasonAsc = [...(m.seasons || [])]
        // A still-in-progress season's win total is a partial number
        // that will keep changing — including it would make the
        // sparkline's most recent point look like a real dip or spike
        // that hasn't actually happened yet. ESPN-era (manual) seasons
        // have no isSeasonComplete field at all; treating that as
        // "complete" is correct, since every one of them is already
        // historical by definition.
        .filter((s) => s.isSeasonComplete !== false)
        .sort((a, b) => a.season - b.season);
      const points = sparklinePoints(
        bySeasonAsc.map((s) => s.wins),
        100,
        28,
        3
      );
      return `
      <a class="career-card${isActive ? " active" : ""}" href="#${encodeURIComponent(m.userId)}">
        <div class="career-card-name">${escapeHtml(m.username || m.teamName || "Unknown")}</div>
        ${points ? `<svg class="career-spark" viewBox="0 0 100 28" preserveAspectRatio="none"><polyline points="${points}" /></svg>` : ""}
        <div class="career-card-stat">${winPct.toFixed(1)}% win rate</div>
      </a>`;
    })
    .join("");
}

function renderFromHash() {
  const userId = decodeURIComponent(location.hash.replace(/^#/, ""));
  const emptyView = document.getElementById("teams-empty-view");
  const detailView = document.getElementById("teams-detail-view");
  const manager = userId ? LEAGUE_STATS.managers.find((m) => m.userId === userId) : null;

  if (manager) {
    emptyView.style.display = "none";
    detailView.style.display = "";
    detailView.innerHTML = renderManagerDetail(manager);
    initScrollAnimations();
    initAnimatedDropdowns();
  } else {
    detailView.style.display = "none";
    emptyView.style.display = "";
  }
}

function renderManagerDetail(m) {
  const overallWins = m.careerRegularSeasonWins + m.careerPlayoffWins;
  const overallLosses = m.careerRegularSeasonLosses + m.careerPlayoffLosses;
  const overallTies = m.careerRegularSeasonTies + m.careerPlayoffTies;
  const winPct = overallWins + overallLosses + overallTies > 0
    ? (overallWins / (overallWins + overallLosses + overallTies) * 100).toFixed(1)
    : "0.0";

  const chips = m.mostRostered.length
    ? m.mostRostered
        .map((p) => `<span class="player-chip">${escapeHtml(p.name)}<span class="count">${p.weeksRostered} wks</span></span>`)
        .join("")
    : `<span class="empty-state">No roster data yet.</span>`;

  const myAwards = [];
  if (SEASON_AWARDS && SEASON_AWARDS.seasons && m.username) {
    Object.entries(SEASON_AWARDS.seasons).forEach(([year, categories]) => {
      if (TRACKED_SEASON_YEARS && !TRACKED_SEASON_YEARS.has(String(year))) return;
      Object.entries(categories).forEach(([category, award]) => {
        if (award.username === m.username) {
          myAwards.push({ year, category, detail: award.detail });
        }
      });
    });
  }
  myAwards.sort((a, b) => b.year - a.year);
  const awardsRows = myAwards
    .map(
      (a) => `
      <div class="ledger-row">
        <span class="year">${escapeHtml(a.year)}</span>
        <div>
          <div class="champ-name">${escapeHtml(a.category)}</div>
          ${a.detail ? `<div class="champ-sub">${escapeHtml(a.detail)}</div>` : ""}
        </div>
      </div>`
    )
    .join("");

  function renderH2hRows(list) {
    return list.length
      ? list
          .map((h) => {
            const total = h.wins + h.losses + h.ties;
            const pct = total ? ((h.wins / total) * 100).toFixed(0) : "0";
            return `
        <tr>
          <td class="team-cell">${escapeHtml(h.opponentName)}</td>
          <td>${h.wins}-${h.losses}${h.ties ? "-" + h.ties : ""}</td>
          <td>${pct}%</td>
        </tr>`;
          })
          .join("")
      : "";
  }
  const h2hRows = renderH2hRows(m.headToHead);
  const h2hPlayoffRows = renderH2hRows(m.headToHeadPlayoffs);

  const seasonsDesc = [...m.seasons].sort((a, b) => b.season - a.season);
  function resultBadgeFor(s) {
    return s.isChampion ? "🏆" : s.isRunnerUp ? "🥈" : s.isThirdPlace ? "🥉" : "";
  }

  // General season-by-season info — its own standalone section, no
  // nested draft/lineup dropdowns anymore (those are their own
  // sections below, one dropdown per year, so someone comparing draft
  // picks across years isn't scrolling past a wall of unrelated stats
  // to get from one year to the next).
  const seasonSummaryRows = seasonsDesc
    .map((s) => {
      const badge = s.isChampion ? " 🏆" : s.isRunnerUp ? " 🥈" : s.isThirdPlace ? " 🥉" : "";
      return `
      <tr>
        <td data-label="Year">${s.season}${badge}</td>
        <td data-label="Rank">${s.rank}</td>
        <td data-label="Record">${s.wins}-${s.losses}${s.ties ? "-" + s.ties : ""}</td>
        <td data-label="PF">${s.fpts.toFixed(1)}</td>
        <td data-label="PA">${s.fptsAgainst.toFixed(1)}</td>
        <td data-label="Overall">${s.overallWins}-${s.overallLosses}${s.overallTies ? "-" + s.overallTies : ""}</td>
        <td data-label="Luck">${s.luckPct != null ? luckBadge(s.luckPct) : "—"}</td>
      </tr>`;
    })
    .join("");

  // Draft Picks — one dropdown per year.
  const draftPicksRows = seasonsDesc
    .map((s) => {
      const picksHtml = s.draftPicks.length
        ? `
          <table class="stat-table compact-mobile">
            <thead><tr><th>Pick</th><th>Player</th><th>Points</th><th>Grade</th></tr></thead>
            <tbody>
              ${s.draftPicks
                .map(
                  (p) => `
              <tr>
                <td data-label="Pick">${p.round}.${p.pickInRound}</td>
                <td class="team-cell" data-label="Player">${escapeHtml(p.player)}${p.position ? ` <span class="muted-inline">(${escapeHtml(p.position)})</span>` : ""}</td>
                <td data-label="Points">${p.points.toFixed(1)} pts${p.vbd != null ? ` <span class="muted-inline">· ${p.vbd >= 0 ? "+" : ""}${p.vbd.toFixed(1)} VBD</span>` : ""}</td>
                <td data-label="Grade">${gradeBadgeHtml(p.grade)}</td>
              </tr>`
                )
                .join("")}
            </tbody>
          </table>`
        : `<div class="empty-state">No draft data for this season.</div>`;

      return `
        <details class="draft-details">
          <summary>${resultBadgeFor(s)} ${s.season} — ${s.draftPicks.length} pick${s.draftPicks.length === 1 ? "" : "s"}</summary>
          <div class="draft-details-content heatmap-table-wrap stay-scrollable">${picksHtml}</div>
        </details>`;
    })
    .join("");

  // Most Common Lineup — one dropdown per year. "Most common" since
  // this is which player logged the most starts at each roster slot
  // that season, not a single date's actual lineup.
  const lineupRows = seasonsDesc
    .map((s) => {
      const lineupHtml =
        s.startingLineup && s.startingLineup.slots.length
          ? `
          <table class="stat-table compact-mobile">
            <thead><tr><th>Slot</th><th>Player</th><th>Starts</th></tr></thead>
            <tbody>
              ${s.startingLineup.slots
                .map(
                  (slot) => `
              <tr>
                <td data-label="Slot">${escapeHtml(slot.slot)}</td>
                <td class="team-cell" data-label="Player">${slot.player ? escapeHtml(slot.player) : "—"}${slot.acquisition ? ` <span class="acquisition-tag">${escapeHtml(slot.acquisition)}</span>` : ""}</td>
                <td data-label="Starts">${slot.starts ? `${slot.starts} gm${slot.starts === 1 ? "" : "s"}` : "—"}</td>
              </tr>`
                )
                .join("")}
            </tbody>
          </table>`
          : `<div class="empty-state">No lineup data for this season.</div>`;

      return `
        <details class="draft-details">
          <summary>${resultBadgeFor(s)} ${s.season} — ${s.startingLineup ? s.startingLineup.weeksCounted : 0} games</summary>
          <div class="draft-details-content heatmap-table-wrap stay-scrollable">${lineupHtml}</div>
        </details>`;
    })
    .join("");

  return `
    <a class="back-link" href="#">&larr; All teams</a>
    <div class="scoreboard" style="margin-top:16px;">
      <p class="scoreboard-eyebrow">TEAM PROFILE</p>
      <h1 class="scoreboard-title">${escapeHtml(m.username || m.teamName)}</h1>
      <p class="scoreboard-sub">${escapeHtml(m.teamName)}</p>
      <div class="scoreboard-ticker">
        <div class="ticker-stat"><span class="label">Overall Record</span><span class="value">${overallWins}-${overallLosses}${overallTies ? "-" + overallTies : ""}</span></div>
        <div class="ticker-stat"><span class="label">Win %</span><span class="value" data-count-up>${winPct}%</span></div>
        <div class="ticker-stat"><span class="label">Regular Season</span><span class="value">${m.careerRegularSeasonWins}-${m.careerRegularSeasonLosses}${m.careerRegularSeasonTies ? "-" + m.careerRegularSeasonTies : ""}</span></div>
        <div class="ticker-stat"><span class="label">Playoff Record</span><span class="value">${m.careerPlayoffWins}-${m.careerPlayoffLosses}${m.careerPlayoffTies ? "-" + m.careerPlayoffTies : ""}</span></div>
        <div class="ticker-stat"><span class="label">Championship Games</span><span class="value">${m.championships}-${m.runnerUps}</span></div>
        <div class="ticker-stat"><span class="label">Playoff Appearances</span><span class="value" data-count-up>${m.playoffAppearances}</span></div>
        <div class="ticker-stat"><span class="label">Byes</span><span class="value" data-count-up>${m.byes}</span></div>
        <div class="ticker-stat"><span class="label">Winning Seasons</span><span class="value" data-count-up>${m.winningSeasons}</span></div>
        <div class="ticker-stat"><span class="label">Losing Seasons</span><span class="value" data-count-up>${m.losingSeasons}</span></div>
        <div class="ticker-stat"><span class="label">3rd Place</span><span class="value" data-count-up>${m.thirdPlaceFinishes}</span></div>
        <div class="ticker-stat"><span class="label">1st Pick</span><span class="value" data-count-up>${m.firstPicks}</span></div>
      </div>
    </div>

    ${
      m.mostRostered.length
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Player Representative</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel player-rep-card">
        ${playerPhotoHtml(m.mostRostered[0].playerId, m.mostRostered[0].name, "player-photo-lg")}
        <div>
          <div class="player-rep-name">${escapeHtml(m.mostRostered[0].name)}</div>
          <div class="player-rep-detail">Rostered ${m.mostRostered[0].weeksRostered} weeks — more than anyone else on this team, ever.</div>
        </div>
      </div>
    </div>`
        : ""
    }

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Most Rostered Players</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">
        <div class="chip-row">${chips}</div>
      </div>
    </div>

    ${
      myAwards.length
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Season Awards</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">${awardsRows}</div>
    </div>`
        : ""
    }

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Head-to-Head Records</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">
        <table class="stat-table">
          <thead><tr><th>Opponent</th><th>Record</th><th>Win %</th></tr></thead>
          <tbody>${h2hRows || `<tr><td colspan="3" class="empty-state">No matchups recorded yet.</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Playoff Head-to-Head</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">
        <table class="stat-table">
          <thead><tr><th>Opponent</th><th>Record</th><th>Win %</th></tr></thead>
          <tbody>${h2hPlayoffRows || `<tr><td colspan="3" class="empty-state">No playoff matchups recorded yet.</td></tr>`}</tbody>
        </table>
      </div>
    </div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Season By Season</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">
        <div class="heatmap-table-wrap stay-scrollable">
          <table class="stat-table compact-mobile">
            <thead><tr><th>Year</th><th>Rank</th><th>Record</th><th>PF</th><th>PA</th><th>Overall</th><th>Luck</th></tr></thead>
            <tbody>${seasonSummaryRows}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Draft Picks</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">${draftPicksRows}</div>
    </div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Most Common Lineup</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">${lineupRows}</div>
    </div>`;
}

document.addEventListener("DOMContentLoaded", renderTeams);
