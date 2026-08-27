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
      return `<a class="season-pill ${isActive ? "active" : ""}" href="#${encodeURIComponent(m.userId)}">${escapeHtml(m.username || m.teamName)}</a>`;
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

  const seasonRows = [...m.seasons]
    .sort((a, b) => b.season - a.season)
    .map((s) => {
      const resultBadge = s.isChampion ? "🏆 Champion" : s.isRunnerUp ? "🥈 Runner-up" : s.isThirdPlace ? "🥉 3rd Place" : "";
      const picksHtml = s.draftPicks.length
        ? s.draftPicks
            .map(
              (p) => `
          <div class="draft-pick-row">
            <span>${p.round}.${p.pickInRound}</span>
            <span class="pick-player">${escapeHtml(p.player)} ${p.position ? `(${escapeHtml(p.position)})` : ""}</span>
            <span class="pick-points">${p.points.toFixed(1)} pts${p.vbd != null ? ` <span class="muted-inline">· ${p.vbd >= 0 ? "+" : ""}${p.vbd.toFixed(1)} VBD</span>` : ""} ${gradeBadgeHtml(p.grade)}</span>
          </div>`
            )
            .join("")
        : `<div class="empty-state">No draft data for this season.</div>`;

      const lineupHtml = s.startingLineup && s.startingLineup.slots.length
        ? s.startingLineup.slots
            .map(
              (slot) => `
          <div class="draft-pick-row">
            <span>${escapeHtml(slot.slot)}</span>
            <span class="pick-player">${slot.player ? escapeHtml(slot.player) : "—"}${slot.acquisition ? `<span class="acquisition-tag">${escapeHtml(slot.acquisition)}</span>` : ""}</span>
            <span class="pick-points">${slot.starts ? `${slot.starts} gm${slot.starts === 1 ? "" : "s"}` : ""}</span>
          </div>`
            )
            .join("")
        : `<div class="empty-state">No lineup data for this season.</div>`;

      return `
        <div class="season-card">
          <div class="season-card-header">
            <span class="season-card-year">${s.season}</span>
            ${resultBadge ? `<span class="season-card-result">${resultBadge}</span>` : ""}
          </div>
          <div class="season-card-stats">
            <div class="season-stat"><span class="season-stat-label">Rank</span><span class="season-stat-value">${s.rank}</span></div>
            <div class="season-stat"><span class="season-stat-label">Record</span><span class="season-stat-value">${s.wins}-${s.losses}${
        s.ties ? "-" + s.ties : ""
      }</span></div>
            <div class="season-stat"><span class="season-stat-label">PF</span><span class="season-stat-value">${s.fpts.toFixed(1)}</span></div>
            <div class="season-stat"><span class="season-stat-label">PA</span><span class="season-stat-value">${s.fptsAgainst.toFixed(1)}</span></div>
            <div class="season-stat"><span class="season-stat-label">Overall</span><span class="season-stat-value">${s.overallWins}-${
        s.overallLosses
      }${s.overallTies ? "-" + s.overallTies : ""}</span></div>
            <div class="season-stat"><span class="season-stat-label">Luck</span><span class="season-stat-value">${s.luckPct != null ? luckBadge(s.luckPct) : "—"}</span></div>
          </div>
          <details class="draft-details">
            <summary>Starting lineup (${s.startingLineup ? s.startingLineup.weeksCounted : 0} games)</summary>
            <div class="draft-details-content">${lineupHtml}</div>
          </details>
          <details class="draft-details">
            <summary>Draft picks (${s.draftPicks.length})</summary>
            <div class="draft-details-content">${picksHtml}</div>
          </details>
        </div>`;
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
        <div class="season-cards">${seasonRows}</div>
      </div>
    </div>`;
}

document.addEventListener("DOMContentLoaded", renderTeams);
