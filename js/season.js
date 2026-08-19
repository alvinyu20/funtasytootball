let SEASON_CHAIN = null;
let PLAYER_DIRECTORY = null;

const POSITION_SEGMENTS = [
  { key: "QB", label: "QB", color: "var(--pos-qb)" },
  { key: "RB", label: "RB", color: "var(--pos-rb)" },
  { key: "WR", label: "WR", color: "var(--pos-wr)" },
  { key: "TE", label: "TE", color: "var(--pos-te)" },
  { key: "K", label: "K", color: "var(--pos-k)" },
  { key: "DEF", label: "DEF", color: "var(--pos-def)" },
  { key: "OTHER", label: "Other", color: "var(--pos-other)" },
];

async function renderSeasonPage() {
  const errorBox = document.getElementById("season-error");
  try {
    const [seasonChain, playerDirectory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    SEASON_CHAIN = seasonChain;
    PLAYER_DIRECTORY = playerDirectory;

    await renderSelectedSeason();
    window.addEventListener("hashchange", renderSelectedSeason);
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't load season data — " + err.message;
    errorBox.style.display = "block";
  }
}

function getSelectedSeasonEntry() {
  const hashYear = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (hashYear) {
    const match = SEASON_CHAIN.find((s) => String(s.league.season) === hashYear);
    if (match) return match;
  }
  return SEASON_CHAIN[SEASON_CHAIN.length - 1]; // default to most recent
}

function renderPicker(selectedYear) {
  const picker = document.getElementById("season-picker");
  picker.innerHTML = [...SEASON_CHAIN]
    .reverse() // newest first
    .map((s) => {
      const year = s.league.season;
      const isActive = String(year) === String(selectedYear);
      return `<a class="season-pill ${isActive ? "active" : ""}" href="#${year}">${year}</a>`;
    })
    .join("");
}

async function renderSelectedSeason() {
  const errorBox = document.getElementById("season-error");
  const content = document.getElementById("season-content");
  const progressBox = document.getElementById("progress-status");

  try {
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
    errorBox.textContent = "Couldn't load that season — " + err.message;
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

function renderSummary(s) {
  const standingsRows = s.standings
    .map(
      (t, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td class="team-cell">${escapeHtml(t.teamName)}${t.rosterId === s.championRosterId ? " 🏆" : ""}</td>
      <td>${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
      <td>${t.fpts.toFixed(1)}</td>
      <td>${t.fptsAgainst.toFixed(1)}</td>
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

  const positionChart = Charts.stackedBarChart(
    s.positionRows.map((r) => ({ label: r.label, segments: r.segments })),
    POSITION_SEGMENTS
  );

  const extremeCards = [
    s.highestWeekScore && recordCard("Highest Score", s.highestWeekScore.points.toFixed(1), `${escapeHtml(s.highestWeekScore.teamName)} · Week ${s.highestWeekScore.week}`),
    s.lowestWeekScore && recordCard("Lowest Score", s.lowestWeekScore.points.toFixed(1), `${escapeHtml(s.lowestWeekScore.teamName)} · Week ${s.lowestWeekScore.week}`),
    s.biggestBlowout && recordCard("Biggest Blowout", `${s.biggestBlowout.margin.toFixed(1)} pts`, `${escapeHtml(s.biggestBlowout.winner)} over ${escapeHtml(s.biggestBlowout.loser)} · Wk ${s.biggestBlowout.week}`),
    s.closestGame && recordCard("Closest Game", `${s.closestGame.margin.toFixed(1)} pts`, `${escapeHtml(s.closestGame.winner)} over ${escapeHtml(s.closestGame.loser)} · Wk ${s.closestGame.week}`),
  ]
    .filter(Boolean)
    .join("");

  const draftCards = [
    s.bestValuePick && recordCard("Best Late-Round Steal", escapeHtml(s.bestValuePick.player), `Rd ${s.bestValuePick.round} Pick ${s.bestValuePick.pickNo} by ${escapeHtml(s.bestValuePick.teamName)} · ${s.bestValuePick.points.toFixed(1)} pts`),
    s.worstValuePick && recordCard("Biggest Draft Bust", escapeHtml(s.worstValuePick.player), `Rd ${s.worstValuePick.round} Pick ${s.worstValuePick.pickNo} by ${escapeHtml(s.worstValuePick.teamName)} · ${s.worstValuePick.points.toFixed(1)} pts`),
    s.pointsLeader && recordCard("Season Points Leader", escapeHtml(s.pointsLeader.player), `${s.pointsLeader.points.toFixed(1)} total points`),
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
        <thead><tr><th>#</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th></tr></thead>
        <tbody>${standingsRows}</tbody>
      </table>
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Weekly Scoring Trend</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>League Average Score By Week</h2>
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
      <span class="label">By Position</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>Scoring By Position, By Team</h2>
      ${positionChart}
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Season Extremes</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${extremeCards || `<div class="empty-state">No games played yet.</div>`}</div>
    </div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Draft Standouts</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${draftCards || `<div class="empty-state">No draft data for this season.</div>`}</div>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", renderSeasonPage);
