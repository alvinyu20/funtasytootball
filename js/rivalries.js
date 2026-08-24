let LEAGUE_STATS = null;

async function renderRivalriesPage() {
  const errorBox = document.getElementById("rivalries-error");
  const progressBox = document.getElementById("progress-status");
  const pickerBox = document.getElementById("rivalry-picker");

  try {
    const [seasonChain, playerDirectory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }
    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Rivalries";

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    LEAGUE_STATS = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);

    if (LEAGUE_STATS.managers.length < 2) {
      document.getElementById("rivalry-content").innerHTML = `<div class="wrap"><div class="empty-state">Need at least 2 managers with history to compare.</div></div>`;
      return;
    }

    const sortedManagers = [...LEAGUE_STATS.managers].sort((a, b) => (a.username || a.teamName).localeCompare(b.username || b.teamName));
    const selectA = document.getElementById("rivalry-select-a");
    const selectB = document.getElementById("rivalry-select-b");
    const optionsHtml = sortedManagers.map((m) => `<option value="${escapeHtml(m.userId)}">${escapeHtml(m.username || m.teamName)}</option>`).join("");
    selectA.innerHTML = optionsHtml;
    selectB.innerHTML = optionsHtml;

    const validIds = new Set(sortedManagers.map((m) => m.userId));
    let [initA, initB] = parseHash();
    if (!validIds.has(initA) || !validIds.has(initB) || initA === initB) {
      initA = sortedManagers[0].userId;
      initB = sortedManagers[1] ? sortedManagers[1].userId : sortedManagers[0].userId;
    }
    selectA.value = initA;
    selectB.value = initB;

    pickerBox.style.display = "flex";
    renderRivalry(initA, initB);
    window.location.hash = `${selectA.value}-vs-${selectB.value}`;

    function onChange() {
      window.location.hash = `${selectA.value}-vs-${selectB.value}`;
      renderRivalry(selectA.value, selectB.value);
    }
    selectA.addEventListener("change", onChange);
    selectB.addEventListener("change", onChange);
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load rivalry data — " + err.message;
    errorBox.style.display = "block";
  }
}

function parseHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const parts = hash.split("-vs-");
  return [parts[0], parts[1]];
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function recordCardHtml(label, value, detail) {
  return `
    <div class="record-card">
      <p class="record-label">${escapeHtml(label)}</p>
      <p class="record-value">${value}</p>
      ${detail ? `<p class="record-detail">${detail}</p>` : ""}
    </div>`;
}

function renderRivalry(userIdA, userIdB) {
  const content = document.getElementById("rivalry-content");
  if (userIdA === userIdB) {
    content.innerHTML = `<div class="wrap"><div class="empty-state">Pick two different managers.</div></div>`;
    return;
  }
  const mgrA = LEAGUE_STATS.managers.find((m) => m.userId === userIdA);
  const mgrB = LEAGUE_STATS.managers.find((m) => m.userId === userIdB);
  const nameA = escapeHtml(mgrA.username || mgrA.teamName);
  const nameB = escapeHtml(mgrB.username || mgrB.teamName);
  const games = (LEAGUE_STATS.pairGameLog[pairKey(userIdA, userIdB)] || [])
    .slice()
    .sort((x, y) => Number(y.season) - Number(x.season) || y.week - x.week);

  if (!games.length) {
    content.innerHTML = `<div class="wrap"><div class="empty-state">${nameA} and ${nameB} haven't played each other yet.</div></div>`;
    return;
  }

  let winsA = 0,
    winsB = 0,
    ties = 0,
    playoffWinsA = 0,
    playoffWinsB = 0,
    playoffTies = 0;
  let closest = null;
  let blowout = null;

  games.forEach((g) => {
    const aIsA = g.aUserId === userIdA;
    const scoreA = aIsA ? g.aScore : g.bScore;
    const scoreB = aIsA ? g.bScore : g.aScore;
    if (scoreA > scoreB) {
      winsA += 1;
      if (g.isPlayoff) playoffWinsA += 1;
    } else if (scoreB > scoreA) {
      winsB += 1;
      if (g.isPlayoff) playoffWinsB += 1;
    } else {
      ties += 1;
      if (g.isPlayoff) playoffTies += 1;
    }
    const margin = Math.abs(scoreA - scoreB);
    const marginEntry = { margin, season: g.season, week: g.week, isPlayoff: g.isPlayoff };
    if (!closest || margin < closest.margin) closest = marginEntry;
    if (!blowout || margin > blowout.margin) blowout = marginEntry;
  });

  const gameRows = games
    .map((g) => {
      const aIsA = g.aUserId === userIdA;
      const scoreA = aIsA ? g.aScore : g.bScore;
      const scoreB = aIsA ? g.bScore : g.aScore;
      const result = scoreA > scoreB ? nameA : scoreB > scoreA ? nameB : "Tie";
      return `
    <tr>
      <td data-label="Season">${escapeHtml(String(g.season))}</td>
      <td data-label="Week">Wk ${g.week}${g.isPlayoff ? " (Playoffs)" : ""}</td>
      <td data-label="${nameA}">${scoreA.toFixed(1)}</td>
      <td data-label="${nameB}">${scoreB.toFixed(1)}</td>
      <td data-label="Result">${result}</td>
    </tr>`;
    })
    .join("");

  const playoffNote = playoffWinsA + playoffWinsB + playoffTies ? ` · Playoffs: ${playoffWinsA}-${playoffWinsB}${playoffTies ? "-" + playoffTies : ""}` : "";

  content.innerHTML = `
    <div class="wrap"><div class="panel">
      <div class="rivalry-series-score">
        <div class="rivalry-series-name">${nameA}</div>
        <div class="rivalry-series-record">${winsA}-${winsB}${ties ? "-" + ties : ""}</div>
        <div class="rivalry-series-name">${nameB}</div>
      </div>
      <p class="rivalry-series-vs" style="text-align:center;">${games.length} meeting${games.length === 1 ? "" : "s"} all-time${playoffNote}</p>
    </div></div>

    <div class="wrap"><div class="records-grid">
      ${closest ? recordCardHtml("Closest Meeting", `${closest.margin.toFixed(1)} pts`, `${closest.season} Wk ${closest.week}${closest.isPlayoff ? " · Playoffs" : ""}`) : ""}
      ${blowout ? recordCardHtml("Biggest Blowout", `${blowout.margin.toFixed(1)} pts`, `${blowout.season} Wk ${blowout.week}${blowout.isPlayoff ? " · Playoffs" : ""}`) : ""}
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Full Game Log</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="heatmap-table-wrap">
        <table class="stat-table responsive-stack">
          <thead><tr><th>Season</th><th>Week</th><th>${nameA}</th><th>${nameB}</th><th>Result</th></tr></thead>
          <tbody>${gameRows}</tbody>
        </table>
      </div>
    </div></div>
  `;
}

document.addEventListener("DOMContentLoaded", renderRivalriesPage);
