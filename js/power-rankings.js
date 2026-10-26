/*
  Power Rankings page. Deliberately does NOT calculate anything here —
  it just reads and displays data/power-rankings-snapshot.json, which
  scripts/update-power-rankings.js writes. See that script's own
  comments for why this page isn't live: the ROS component needs
  FantasyPros data typed in by hand (there's no API for it), and
  recalculating on every page load risked doing so mid-week, using a
  partially-played week as if it were a finished one.
*/

async function renderPowerRankings() {
  const errorBox = document.getElementById("pr-error");
  const content = document.getElementById("pr-content");

  try {
    // The NFL week is only used to tell if the snapshot is running behind;
    // the page works fine without it.
    const nflStatePromise = typeof SleeperAPI !== "undefined" ? SleeperAPI.getNflState().catch(() => null) : Promise.resolve(null);
    const snapshot = await fetchJsonSafe(POWER_RANKINGS_SNAPSHOT_FILE, null);
    if (!snapshot || !snapshot.rows || !snapshot.rows.length) {
      throw new Error("The first Power Rankings land after Week 1 is final \u2014 check back Tuesday.");
    }

    document.title = (SITE_TITLE || "League") + " — Power Rankings";

    if (snapshot.preseason) {
      document.getElementById("sb-title").textContent = `${snapshot.season} Preseason`;
      document.getElementById("sb-sub").textContent = "Based on FantasyPros ROS ranks — the real table replaces this once Week 1 is done";
      content.style.display = "";
      content.innerHTML = renderPreseasonContent(snapshot);
      return;
    }

    document.getElementById("sb-title").textContent = `${snapshot.season} · After Week ${snapshot.week}`;
    document.getElementById("sb-sub").textContent = `${snapshot.rows.length} teams · ${snapshot.playoffTeams} make the playoffs${snapshot.byeTeams ? `, top ${snapshot.byeTeams} get a bye` : ""}`;

    const [powerRankHistory, nflState] = await Promise.all([fetchJsonSafe(POWER_RANK_HISTORY_FILE, { seasons: {} }), nflStatePromise]);
    const seasonHistory = (powerRankHistory.seasons && powerRankHistory.seasons[String(snapshot.season)]) || {};
    const lastWeekRanks = seasonHistory[String(snapshot.week - 1)] || null;
    const sameSeason = nflState && String(nflState.season) === String(snapshot.season);

    content.style.display = "";
    content.innerHTML = renderContent(snapshot, lastWeekRanks, sameSeason ? nflState.week : null);
  } catch (err) {
    console.error(err);
    errorBox.textContent = err.message && /first Power Rankings/.test(err.message) ? err.message : "Couldn't load the Power Rankings. Give it a minute and refresh the page.";
    errorBox.style.display = "block";
  }
}

function formatRank(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function formatGeneratedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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

function renderPowerTable(snapshot, lastWeekRanks) {
  const rows = snapshot.rows
    .map(
      (r) => `
    <tr>
      <td class="rank" data-label="Rank">#${formatRank(r.powerRank)}</td>
      <td class="team-cell"${r.username ? ` data-username="${escapeHtml(r.username)}"` : ""}>${escapeHtml(r.teamName)}</td>
      <td data-label="Δ">${deltaBadge(r, lastWeekRanks)}</td>
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

  // compact-mobile + stay-scrollable: on a phone this stays a real table
  // (same treatment as the Home page Standings) and pans sideways, rather
  // than the old one-card-per-team stack, which turned 14 columns into a
  // very tall wall of label/value rows.
  return `
    <div class="heatmap-table-wrap stay-scrollable">
      <table class="stat-table compact-mobile sticky-cols-2">
        <thead>
          <tr>
            <th>Rank</th><th>Team</th><th>Δ</th><th>PR Score</th><th>Record</th><th>Overall</th>
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

function renderOddsTable(snapshot) {
  const n = snapshot.rows.length;
  const line = snapshot.playoffTeams > 0 && snapshot.playoffTeams < n ? snapshot.playoffTeams : 0; // last column that still makes the playoffs
  const cut = (i) => (line && i + 1 === line ? " playoff-edge" : "");
  const header = Array.from({ length: n }, (_, i) => `<th class="${i + 1 <= line ? "in-playoffs" : ""}${cut(i)}">${i + 1}</th>`).join("");
  const rows = snapshot.rows
    .map((r) => {
      const cells = (r.finishDistribution || []).map((pct, i) => probCell(pct, i + 1).replace("<td class=\"", `<td class="${line && i + 1 === line ? "playoff-edge " : ""}`)).join("");
      return `<tr><td class="team-cell"${r.username ? ` data-username="${escapeHtml(r.username)}"` : ""}>${escapeHtml(r.teamName)}</td>${cells}</tr>`;
    })
    .join("");
  return `
    <div class="heatmap-table-wrap stay-scrollable">
      <table class="stat-table compact-mobile sticky-cols-1 odds-table">
        <thead><tr><th>Team</th>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="heatmap-note">Probability of finishing in each final position, from a 1,000-run simulation of the rest of the season — columns are final rank (1st, 2nd, …).${
      line ? ` The gold line after ${ordinal(line)} place is the playoff cutoff.` : ""
    }</p>`;
}

// "Snapshot · Through Week 6 · Oct 13 · updates Tuesdays". Amber when the
// NFL calendar has moved on by more than the one week a snapshot normally lags.
function snapshotChip(snapshot, nflWeek) {
  return freshnessChipHtml({
    label: "Snapshot",
    through: snapshot.week,
    current: nflWeek,
    date: snapshot.generatedAt,
    note: "updates Tuesdays",
    title: "Built after each week's final game, so it never mixes in a half-played week",
  });
}

function renderContent(snapshot, lastWeekRanks, nflWeek) {
  const chip = snapshotChip(snapshot, nflWeek);
  return `
    <div class="wrap"><div class="panel">
      <div class="panel-head"><h2>Power Rankings</h2>${chip}</div>
      ${renderPowerTable(snapshot, lastWeekRanks)}
      <p class="heatmap-note">Weighted composite of record, all-play record, scoring average, simulated playoff odds, and ROS rank. Lower PR Score is better.</p>
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Playoff Odds</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="panel-head"><h2>Finish Probability By Rank</h2>${chip}</div>
      ${renderOddsTable(snapshot)}
    </div></div>
  `;
}

function renderPreseasonContent(snapshot) {
  const rows = snapshot.rows
    .map(
      (r) => `
    <tr>
      <td class="rank" data-label="Rank">#${r.rank}</td>
      <td class="team-cell">${escapeHtml(r.username)}</td>
      <td data-label="Team Name">${escapeHtml(r.teamName || "—")}</td>
    </tr>`
    )
    .join("");
  return `
    <div class="wrap"><div class="panel">
      <div class="panel-head"><h2>Preseason Power Rankings</h2>${freshnessChipHtml({ label: "Preseason", note: "updates Tuesdays once games start", tone: "snap" })}</div>
      <div class="heatmap-table-wrap stay-scrollable">
        <table class="stat-table compact-mobile">
          <thead><tr><th>Rank</th><th>Team</th><th>Team Name</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <p class="heatmap-note">Based on FantasyPros Rest-of-Season expert consensus ranks — no games played yet, so there's nothing else (record, PR score, playoff odds) to show. This updates to the full table once Week 1 is complete.</p>
    </div></div>
  `;
}

document.addEventListener("DOMContentLoaded", renderPowerRankings);
