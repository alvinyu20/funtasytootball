async function renderPowerRankings() {
  const errorBox = document.getElementById("pr-error");
  const progressBox = document.getElementById("progress-status");
  const content = document.getElementById("pr-content");

  try {
    const [seasonChain, playerDirectory, teamStrength, powerRankHistory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(TEAM_STRENGTH_FILE, { teams: {} }),
      fetchJsonSafe(POWER_RANK_HISTORY_FILE, { seasons: {} }),
    ]);

    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    const currentSeasonEntry = seasonChain[seasonChain.length - 1];
    const leagueName = currentSeasonEntry.league.name;
    document.title = (SITE_TITLE || leagueName || "League") + " — Power Rankings";

    progressBox.style.display = "block";
    progressBox.textContent = `Loading ${currentSeasonEntry.league.season}…`;
    const deep = await DeepHistory.fetchSeasonDeep(currentSeasonEntry, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    if (!deep.weeks.length) {
      document.getElementById("sb-title").textContent = `${currentSeasonEntry.league.season} Season`;
      document.getElementById("sb-sub").textContent = "No games played yet";
      content.style.display = "";
      content.innerHTML = `<div class="wrap"><div class="empty-state">Power Rankings need at least one played week — check back once the season's underway.</div></div>`;
      return;
    }

    const teamStrengthTeams = teamStrength && teamStrength.teams ? teamStrength.teams : {};
    const pr = DeepHistory.computePowerRankings(currentSeasonEntry, deep, playerDirectory, teamStrengthTeams, 1000);

    document.getElementById("sb-title").textContent = `${pr.season} · Week ${pr.week}`;
    document.getElementById("sb-sub").textContent = `${pr.rows.length} teams · ${pr.playoffTeams} make the playoffs${pr.byeTeams ? `, top ${pr.byeTeams} get a bye` : ""}`;

    const seasonHistory = (powerRankHistory.seasons && powerRankHistory.seasons[String(pr.season)]) || {};
    const lastWeekRanks = seasonHistory[String(pr.week - 1)] || null;

    content.style.display = "";
    content.innerHTML = renderContent(pr, lastWeekRanks);
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load power rankings — " + err.message;
    errorBox.style.display = "block";
  }
}

function formatRank(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function deltaBadge(row, lastWeekRanks) {
  if (!lastWeekRanks || lastWeekRanks[row.teamName] == null) {
    return `<span class="muted-inline">NEW</span>`;
  }
  const diff = lastWeekRanks[row.teamName] - row.powerRank; // positive = moved up (rank number decreased)
  if (diff > 0) return `<span class="luck-positive">▲${formatRank(diff)}</span>`;
  if (diff < 0) return `<span class="luck-negative">▼${formatRank(Math.abs(diff))}</span>`;
  return `<span class="muted-inline">–</span>`;
}

function renderPowerTable(pr, lastWeekRanks) {
  const rows = pr.rows
    .map(
      (r) => `
    <tr>
      <td class="rank" data-label="Rank">#${formatRank(r.powerRank)}</td>
      <td data-label="Δ">${deltaBadge(r, lastWeekRanks)}</td>
      <td class="team-cell">${escapeHtml(r.teamName)}</td>
      <td data-label="PR Score">${r.prScore.toFixed(2)}</td>
      <td data-label="Record">${r.record}</td>
      <td data-label="Overall">${r.overallRecord}</td>
      <td data-label="Luck">#${formatRank(r.luckRank)}</td>
      <td data-label="Avg PPG">${r.avgPpg.toFixed(1)}</td>
      <td data-label="Std Dev">${r.stdDev.toFixed(1)}</td>
      <td data-label="Playoff%">${r.playoffPct.toFixed(1)}%</td>
      <td data-label="Bye%">${r.byePct != null ? r.byePct.toFixed(1) + "%" : "—"}</td>
      <td data-label="ROS">${r.rosRank != null ? "#" + r.rosRank : "—"}</td>
      <td data-label="Boom">${r.boom}</td>
      <td data-label="Bust">${r.bust}</td>
    </tr>`
    )
    .join("");

  return `
    <div class="heatmap-table-wrap">
      <table class="stat-table responsive-stack">
        <thead>
          <tr>
            <th>Rank</th><th>Δ</th><th>Team</th><th>PR Score</th><th>Record</th><th>Overall</th>
            <th>Luck</th><th>Avg PPG</th><th>Std Dev</th><th>Playoff%</th><th>Bye%</th><th>ROS</th><th>Boom</th><th>Bust</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function probCell(pct, rank) {
  const label = ordinal(rank);
  if (pct < 1) return `<td class="heat-cell empty" data-label="${label}">${pct < 0.05 ? "—" : pct.toFixed(1) + "%"}</td>`;
  const bg = interpolateColor("#6B5A2E", "#E8B23D", Math.min(1, pct / 100));
  return `<td class="heat-cell" data-label="${label}" style="background:${bg}">${pct.toFixed(1)}%</td>`;
}

function renderOddsTable(pr) {
  const n = pr.rows.length;
  const header = Array.from({ length: n }, (_, i) => `<th>${i + 1}</th>`).join("");
  const rows = pr.rows
    .map((r) => `<tr><td class="team-cell">${escapeHtml(r.teamName)}</td>${r.finishDistribution.map((pct, i) => probCell(pct, i + 1)).join("")}</tr>`)
    .join("");
  return `
    <div class="heatmap-table-wrap">
      <table class="stat-table responsive-stack">
        <thead><tr><th>Team</th>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="heatmap-note">Probability of finishing in each final position, from 1,000 simulated seasons — columns are final rank (1st, 2nd, …).</p>`;
}

function renderHistorySnippet(pr) {
  const obj = {};
  pr.rows.forEach((r) => {
    obj[r.teamName] = formatRank(r.powerRank);
  });
  const snippet = JSON.stringify(obj, null, 2);
  return `
    <div class="panel">
      <h2>Save This Week's Ranks</h2>
      <p class="heatmap-note">To track week-over-week movement (the Δ column), add this under <code>seasons["${pr.season}"]["${pr.week}"]</code> in <code>data/power-rank-history.json</code> — or just ask Claude to do it.</p>
      <pre class="code-snippet">${escapeHtml(snippet)}</pre>
    </div>`;
}

function renderContent(pr, lastWeekRanks) {
  return `
    <div class="wrap"><div class="panel">
      <h2>Power Rankings</h2>
      ${renderPowerTable(pr, lastWeekRanks)}
      <p class="heatmap-note">Weighted composite of record, all-play record, scoring average, simulated playoff odds, and ROS rank. Lower PR Score is better.</p>
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Playoff Odds</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>Finish Probability By Rank</h2>
      ${renderOddsTable(pr)}
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Keep History</span>
      <div class="line"></div>
    </div>
    <div class="wrap">${renderHistorySnippet(pr)}</div>
  `;
}

document.addEventListener("DOMContentLoaded", renderPowerRankings);
