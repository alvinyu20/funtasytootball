let LEAGUE_STATS = null;

async function renderTeams() {
  const errorBox = document.getElementById("teams-error");
  const progressBox = document.getElementById("progress-status");

  try {
    const [seasonChain, playerDirectory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
    ]);

    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Teams";
    document.getElementById("sb-sub").textContent = `${seasonChain.length} season${seasonChain.length === 1 ? "" : "s"} of history`;

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    LEAGUE_STATS = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);

    renderFromHash();
    window.addEventListener("hashchange", renderFromHash);
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load team history — " + err.message;
    errorBox.style.display = "block";
  }
}

function renderFromHash() {
  const userId = decodeURIComponent(location.hash.replace(/^#/, ""));
  const listView = document.getElementById("teams-list-view");
  const detailView = document.getElementById("teams-detail-view");
  const manager = userId ? LEAGUE_STATS.managers.find((m) => m.userId === userId) : null;

  if (manager) {
    listView.style.display = "none";
    detailView.style.display = "";
    detailView.innerHTML = renderManagerDetail(manager);
  } else {
    detailView.style.display = "none";
    listView.style.display = "";
    listView.innerHTML = LEAGUE_STATS.managers
      .map(
        (m, i) => `
      <a class="leaderboard-row" href="#${encodeURIComponent(m.userId)}">
        <span class="rank">${i + 1}</span>
        <span class="name">${escapeHtml(m.username || m.teamName)}</span>
        <span class="record">${m.careerWins}-${m.careerLosses}${m.careerTies ? "-" + m.careerTies : ""}</span>
        <span class="rings">${m.championships ? "🏆".repeat(Math.min(m.championships, 5)) : "—"}</span>
      </a>`
      )
      .join("");
  }
}

function renderManagerDetail(m) {
  const winPct = m.careerWins + m.careerLosses + m.careerTies > 0
    ? (m.careerWins / (m.careerWins + m.careerLosses + m.careerTies) * 100).toFixed(1)
    : "0.0";

  const chips = m.mostRostered.length
    ? m.mostRostered
        .map((p) => `<span class="player-chip">${escapeHtml(p.name)}<span class="count">${p.weeksRostered} wks</span></span>`)
        .join("")
    : `<span class="empty-state">No roster data yet.</span>`;

  const h2hRows = m.headToHead.length
    ? m.headToHead
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

  const seasonRows = [...m.seasons]
    .sort((a, b) => b.season - a.season)
    .map((s) => {
      const resultBadge = s.isChampion ? "🏆 Champion" : s.isRunnerUp ? "🥈 Runner-up" : "";
      const picksHtml = s.draftPicks.length
        ? s.draftPicks
            .map(
              (p) => `
          <div class="draft-pick-row">
            <span>Rd ${p.round}, Pick ${p.pickNo}</span>
            <span class="pick-player">${escapeHtml(p.player)} ${p.position ? `(${escapeHtml(p.position)})` : ""}</span>
            <span class="pick-points">${p.points.toFixed(1)} pts</span>
          </div>`
            )
            .join("")
        : `<div class="empty-state">No draft data for this season.</div>`;

      return `
        <tr>
          <td class="team-cell">${s.season}</td>
          <td>${s.rank}</td>
          <td>${s.wins}-${s.losses}${s.ties ? "-" + s.ties : ""}</td>
          <td>${s.fpts.toFixed(1)}</td>
          <td>${s.fptsAgainst.toFixed(1)}</td>
          <td>${resultBadge}</td>
        </tr>
        <tr>
          <td colspan="6" style="border-bottom: 1px solid var(--turf-line); padding-top:0;">
            <details class="draft-details">
              <summary>Draft picks (${s.draftPicks.length})</summary>
              ${picksHtml}
            </details>
          </td>
        </tr>`;
    })
    .join("");

  return `
    <a class="back-link" href="#">&larr; All teams</a>
    <div class="scoreboard" style="margin-top:16px;">
      <p class="scoreboard-eyebrow">TEAM PROFILE</p>
      <h1 class="scoreboard-title">${escapeHtml(m.username || m.teamName)}</h1>
      <p class="scoreboard-sub">${escapeHtml(m.teamName)}</p>
      <div class="scoreboard-ticker">
        <div class="ticker-stat"><span class="label">Career Record</span><span class="value">${m.careerWins}-${m.careerLosses}${m.careerTies ? "-" + m.careerTies : ""}</span></div>
        <div class="ticker-stat"><span class="label">Win %</span><span class="value">${winPct}%</span></div>
        <div class="ticker-stat"><span class="label">Championships</span><span class="value">${m.championships}</span></div>
        <div class="ticker-stat"><span class="label">Runner-ups</span><span class="value">${m.runnerUps}</span></div>
        <div class="ticker-stat"><span class="label">Career PF</span><span class="value">${m.careerPF.toFixed(1)}</span></div>
      </div>
    </div>

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
      <span class="label">Season By Season</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">
        <table class="stat-table">
          <thead><tr><th>Year</th><th>Rank</th><th>Record</th><th>PF</th><th>PA</th><th>Result</th></tr></thead>
          <tbody>${seasonRows}</tbody>
        </table>
      </div>
    </div>`;
}

document.addEventListener("DOMContentLoaded", renderTeams);
