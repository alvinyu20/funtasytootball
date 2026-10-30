/*
  Power Rankings page. (Small helpers it shares with Home -- num1, signed1, ordinal,
  playoffBarHtml and friends -- live in utils.js.) Deliberately does NOT calculate anything here —
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
      throw new Error("The first Power Rankings land after Week 1 is final \u2014 check back then.");
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

    const [powerRankHistory, nflState, extras] = await Promise.all([
      fetchJsonSafe(POWER_RANK_HISTORY_FILE, { seasons: {} }),
      nflStatePromise,
      fetchJsonSafe(POWER_RANKINGS_EXTRAS_FILE, null),
    ]);
    const seasonHistory = (powerRankHistory.seasons && powerRankHistory.seasons[String(snapshot.season)]) || {};
    const lastWeekRanks = seasonHistory[String(snapshot.week - 1)] || null;
    const sameSeason = nflState && String(nflState.season) === String(snapshot.season);

    content.style.display = "";
    content.innerHTML = renderContent(snapshot, lastWeekRanks, sameSeason ? nflState.week : null, extras);
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

// A rank move in words-free form, shown beside a team's name: ▲2 for a climb,
// ▼1 for a drop, nothing at all when the rank held, NEW for a team that had no
// rank last week.
function deltaBadge(row, lastWeekRanks) {
  if (!lastWeekRanks || lastWeekRanks[row.teamName] == null) {
    return `<span class="muted-inline">NEW</span>`;
  }
  const diff = lastWeekRanks[row.teamName] - row.powerRank; // positive = moved up (rank number decreased)
  if (diff > 0) return `<span class="luck-positive">▲${formatRank(diff)}</span>`;
  if (diff < 0) return `<span class="luck-negative">▼${formatRank(Math.abs(diff))}</span>`;
  return "";
}

/*
  ---- Power Rankings table ---------------------------------------------------
  Two drawings of the same rows: a wide table (from 1100px up) and a tap-to-open
  list for anything narrower. Both show the same numbers in plain rank order, and
  the page decides which one is visible with CSS alone. The phone list carries
  nothing the table does not.
*/

// Luck: actual win % minus all-play win %, in percentage points. The same
// number (and the same formula) Home's standings show.
function rowLuckPct(row) {
  const ap = parseRecordString(row.overallRecord);
  const games = (row.wins || 0) + (row.losses || 0) + (row.ties || 0);
  if (!ap || !games) return null;
  const apGames = ap.w + ap.l + ap.t;
  if (!apGames) return null;
  return ((row.wins || 0) / games - ap.w / apGames) * 100;
}

function luckHtml(row) {
  const luck = rowLuckPct(row);
  if (luck == null) return `<span class="luck-neutral">—</span>`;
  const rounded = Math.round(luck * 10) / 10;
  const cls = rounded > 0 ? "luck-positive" : rounded < 0 ? "luck-negative" : "luck-neutral";
  return `<span class="${cls}">${signed1(luck)}%</span>`;
}

function minMax(values) {
  const v = values.filter(Number.isFinite);
  return v.length ? { min: Math.min(...v), max: Math.max(...v) } : { min: 0, max: 0 };
}

// Where a value sits between the league's lowest and highest, 0-100.
function spanPct(value, span) {
  if (!Number.isFinite(value) || span.max === span.min) return 50;
  return round2(clamp(((value - span.min) / (span.max - span.min)) * 100, 0, 100));
}

// A bar that never vanishes for the lowest team: 10-100% of the track.
function ppgBarWidth(ppg, span) {
  if (!Number.isFinite(ppg)) return 0;
  if (span.max === span.min) return 100;
  return round2(10 + 90 * spanPct(ppg, span) / 100);
}

function powerNameHtml(row, lastWeekRanks) {
  const move = deltaBadge(row, lastWeekRanks);
  return `<span class="pr-name"><span class="pr-name-text" data-username="${escapeHtml(row.username || row.teamName)}">${escapeHtml(row.teamName)}</span>${move ? `<span class="pr-move">${move}</span>` : ""}</span>`;
}

function rosText(row) {
  return row.rosRank != null ? "#" + row.rosRank : "—";
}

function tableLegendHtml(byeTeams, withDots) {
  return `<p class="pr-legend">
    ${byeTeams ? `<span class="pr-key"><i class="pr-swatch bye"></i>Bye</span>` : ""}
    <span class="pr-key"><i class="pr-swatch playoffs"></i>${byeTeams ? "Playoffs, no bye" : "Playoffs"}</span>
    <span class="pr-key"><i class="pr-swatch miss"></i>Miss</span>
    ${withDots ? `<span class="pr-key"><i class="pr-dot-key"></i>Dots show how close PR Scores are</span>` : ""}
  </p>`;
}

function renderBoardRow(row, ctx) {
  return `
      <tr class="pr-board-row">
        <td class="pr-rank">#${formatRank(row.powerRank)}</td>
        <td class="pr-team">${powerNameHtml(row, ctx.lastWeekRanks)}</td>
        <td class="pr-score"><span class="pr-score-num">${Number.isFinite(row.prScore) ? row.prScore.toFixed(2) : "—"}</span><span class="pr-line"><i class="pr-dot" style="left:${spanPct(row.prScore, ctx.scoreSpan)}%"></i></span></td>
        <td class="pr-record"><span class="pr-rec">${escapeHtml(row.record)}</span><span class="pr-ovr">${escapeHtml(row.overallRecord)} Ovr</span></td>
        <td class="pr-luck">${luckHtml(row)}</td>
        <td class="pr-ppg"><span class="pr-ppg-num">${num1(row.avgPpg)}</span><span class="pr-ppg-track"><i style="width:${ppgBarWidth(row.avgPpg, ctx.ppgSpan)}%"></i></span></td>
        <td class="pr-sd">${num1(row.stdDev)}</td>
        <td class="pr-chance">${playoffBarHtml(row, ctx.byeTeams)}<span class="pr-pct">${num1(row.playoffPct)}%</span></td>
        <td class="pr-ros">${rosText(row)}</td>
      </tr>`;
}

function renderPhoneItem(row, ctx) {
  const id = `pr-detail-${String(row.rosterId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ap = parseRecordString(row.overallRecord);
  return `
      <div class="pr-phone-item">
        <button type="button" class="pr-phone-row" aria-expanded="false" aria-controls="${id}">
          <span class="pr-phone-rank">#${formatRank(row.powerRank)}</span>
          <span class="pr-phone-name">${powerNameHtml(row, ctx.lastWeekRanks)}</span>
          <span class="pr-phone-score">${Number.isFinite(row.prScore) ? row.prScore.toFixed(2) : "—"}</span>
          <span class="pr-phone-rec">${escapeHtml(row.record)}</span>
          ${playoffBarHtml(row, ctx.byeTeams)}
          <span class="pr-phone-pct">${num1(row.playoffPct)}%<i class="pr-chevron" aria-hidden="true"></i></span>
        </button>
        <div class="pr-phone-detail" id="${id}" hidden>
          <dl class="pr-detail-grid">
            <div><dt>Avg PPG</dt><dd>${num1(row.avgPpg)}</dd></div>
            <div><dt>Luck</dt><dd>${luckHtml(row)}</dd></div>
            <div><dt>ROS rank</dt><dd>${rosText(row)}</dd></div>
            <div><dt>Std dev</dt><dd>${num1(row.stdDev)}</dd></div>
            <div><dt>Ovr</dt><dd>${ap ? escapeHtml(row.overallRecord) : "—"}</dd></div>
          </dl>
        </div>
      </div>`;
}

function renderPowerTable(snapshot, lastWeekRanks) {
  const rows = snapshot.rows;
  const byeTeams = snapshot.byeTeams || 0;
  const ctx = {
    lastWeekRanks,
    byeTeams,
    scoreSpan: minMax(rows.map((r) => r.prScore)),
    ppgSpan: minMax(rows.map((r) => r.avgPpg)),
  };
  const ranked = [...rows].sort((a, b) => a.powerRank - b.powerRank || a.prScore - b.prScore);
  const tableBody = ranked.map((r) => renderBoardRow(r, ctx)).join("");
  const phoneBody = ranked.map((r) => renderPhoneItem(r, ctx)).join("");

  return `
    <div class="pr-board-wrap">
      <table class="pr-board">
        <thead>
          <tr>
            <th class="pr-rank">Rank</th><th class="pr-team">Team</th><th class="pr-score">PR Score</th><th class="pr-record">Record</th>
            <th class="pr-luck">Luck</th><th class="pr-ppg">Avg PPG</th><th class="pr-sd">Std Dev</th><th class="pr-chance">${byeTeams ? "Bye · Playoffs · Out" : "Playoffs · Out"}</th><th class="pr-ros">ROS</th>
          </tr>
        </thead>
        <tbody>${tableBody}</tbody>
      </table>
      ${tableLegendHtml(byeTeams, true)}
    </div>
    <div class="pr-phone">${phoneBody}
      ${tableLegendHtml(byeTeams, false)}
    </div>`;
}

// Opens or closes one team's extra numbers in the phone list.
function togglePhoneRow(button) {
  const detail = document.getElementById(button.getAttribute("aria-controls"));
  if (!detail) return;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", open ? "true" : "false");
  detail.hidden = !open;
  const item = button.closest(".pr-phone-item");
  if (item) item.classList.toggle("open", open);
}

/*
  ---- Finish probability grid ----------------------------------------------
  One row per team, one column per final rank, ordered by expected finish so
  the grid reads top to bottom as a ranking. Every cell shows its chance as a
  whole number; anything under 1% keeps a decimal and a faint tile, and only a
  chance that truly never came up in the simulation is a dash.
*/

// How many simulated seasons the snapshot came from (older snapshots did not
// say; they were all 1,000).
function simRunsOf(snapshot) {
  return Number.isFinite(snapshot.simRuns) && snapshot.simRuns > 0 ? snapshot.simRuns : 1000;
}

// Average final rank implied by a team's finish distribution (percentages).
function expectedFinish(dist) {
  if (!Array.isArray(dist) || !dist.length) return null;
  const total = dist.reduce((s, p) => s + (Number.isFinite(p) ? p : 0), 0);
  if (!(total > 0)) return null;
  return dist.reduce((s, p, i) => s + (i + 1) * (Number.isFinite(p) ? p : 0), 0) / total;
}

// Which of the six shades a chance belongs to ("none" for a true zero).
function oddsShade(pct) {
  if (!Number.isFinite(pct) || pct <= 0) return "none";
  if (pct < 1) return "u1";
  if (pct < 5) return "s1";
  if (pct < 10) return "s5";
  if (pct < 20) return "s10";
  if (pct < 35) return "s20";
  return "s35";
}

// The number printed in a cell: whole percent, one decimal under 1%, "<0.1"
// for the rare sliver below that, a dash for nothing.
function oddsLabel(pct) {
  const shade = oddsShade(pct);
  if (shade === "none") return "—";
  if (shade === "u1") return pct < 0.1 ? "<0.1" : Math.min(0.9, Math.round(pct * 10) / 10).toFixed(1);
  return String(Math.round(pct));
}

function trimPct(pct) {
  return String(Math.round(pct * 100) / 100);
}

function renderOddsTable(snapshot) {
  const n = snapshot.rows.length;
  const playoffTeams = snapshot.playoffTeams > 0 && snapshot.playoffTeams < n ? snapshot.playoffTeams : 0; // last column that still makes the playoffs
  const byeLine = playoffTeams && snapshot.byeTeams > 0 && snapshot.byeTeams < playoffTeams ? snapshot.byeTeams : 0; // last column with a bye
  const runs = simRunsOf(snapshot);
  const runsText = runs.toLocaleString("en-US");

  const sorted = snapshot.rows
    .map((r) => ({ r, exp: expectedFinish(r.finishDistribution) }))
    .sort((a, b) => (a.exp == null) - (b.exp == null) || a.exp - b.exp || a.r.powerRank - b.r.powerRank);

  const edgeClass = (rank) => `${byeLine && rank === byeLine ? " bye-edge" : ""}${playoffTeams && rank === playoffTeams ? " playoff-edge" : ""}`;

  const zoneRow = playoffTeams
    ? `<tr class="pr-zone-row"><th></th>${byeLine ? `<th colspan="${byeLine}" class="zone zone-bye">Bye</th>` : ""}<th colspan="${playoffTeams - byeLine}" class="zone zone-playoffs">Playoffs</th><th colspan="${n - playoffTeams}" class="zone zone-out">Out</th><th colspan="2"></th></tr>`
    : "";
  const rankCols = Array.from({ length: n }, (_, i) => `<th class="rk">${i + 1}</th>`).join("");
  const header = `${zoneRow}<tr><th class="pr-odds-team">Final rank →</th>${rankCols}<th class="pr-odds-exp">Exp.</th><th class="pr-odds-playoffs">Playoffs</th></tr>`;

  const body = sorted
    .map(({ r, exp }) => {
      const dist = r.finishDistribution || [];
      const peak = Math.max(0, ...dist.filter(Number.isFinite));
      const bestIdx = peak > 0 ? dist.findIndex((p) => p === peak) : -1;
      const cells = Array.from({ length: n }, (_, i) => {
        const pct = Number.isFinite(dist[i]) ? dist[i] : null;
        const shade = oddsShade(pct);
        const title = pct == null ? "" : ` title="${escapeHtml(r.teamName)} · ${ordinal(i + 1)} place · ${trimPct(pct)}%"`;
        return `<td class="odds-cell ${shade}${i === bestIdx ? " best" : ""}${edgeClass(i + 1)}"${title}>${pct == null ? "—" : oddsLabel(pct)}</td>`;
      }).join("");
      return `<tr><td class="pr-odds-team"><span class="pr-name"><span class="pr-name-text" data-username="${escapeHtml(r.username || r.teamName)}">${escapeHtml(r.teamName)}</span></span></td>${cells}<td class="pr-odds-exp">${exp == null ? "—" : exp.toFixed(1)}</td><td class="pr-odds-playoffs">${num1(r.playoffPct)}%</td></tr>`;
    })
    .join("");

  const legend = `<p class="pr-legend odds-legend">
    <span class="pr-legend-label">Chance</span>
    <span class="pr-key"><i class="odds-key none">—</i>None in ${runsText} runs</span>
    <span class="pr-key"><i class="odds-key u1"></i>Under 1</span>
    <span class="pr-key"><i class="odds-key s1"></i>1–5</span>
    <span class="pr-key"><i class="odds-key s5"></i>5–10</span>
    <span class="pr-key"><i class="odds-key s10"></i>10–20</span>
    <span class="pr-key"><i class="odds-key s20"></i>20–35</span>
    <span class="pr-key"><i class="odds-key s35"></i>35+</span>
    <span class="pr-key"><i class="odds-key ring"></i>Most likely finish</span>
  </p>`;

  return `
    <div class="heatmap-table-wrap stay-scrollable">
      <table class="pr-odds">
        <thead>${header}</thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${legend}
    <p class="heatmap-note">Each row is a team's chance of finishing in each final spot, from a ${runsText}-run simulation of the rest of the season. Teams are ordered by expected finish (Exp.).</p>`;
}

// "Snapshot · Through Week 6 · Oct 13 · updates with each ROS refresh". Blue when the
// NFL calendar has moved on by more than the one week a snapshot normally lags.
function snapshotChip(snapshot, nflWeek) {
  return freshnessChipHtml({
    label: "Snapshot",
    through: snapshot.week,
    current: nflWeek,
    date: snapshot.generatedAt,
    note: "updates with each ROS refresh",
    title: "Built after each week's final game, so it never mixes in a half-played week",
  });
}

// Chance to win the title. Every nonzero chance is shown, so "possible" and
// "impossible" stay apart: one decimal, "<0.1%" under a twentieth of a percent.
function titleLabel(pct) {
  if (!Number.isFinite(pct) || pct <= 0) return "\u2014";
  if (pct < 0.05) return "<0.1%";
  return `${num1(pct)}%`;
}

function hasTitleOdds(snapshot) {
  return snapshot.rows.length > 0 && snapshot.rows.every((r) => Number.isFinite(r.titlePct));
}

// Championship Odds: the same simulation as the playoff odds, played on through
// the real playoff bracket. Needs a snapshot that carries titlePct.
function renderTitleOdds(snapshot, chip) {
  if (!hasTitleOdds(snapshot)) return "";
  const byeTeams = snapshot.byeTeams || 0;
  const runs = (snapshot.titleSimRuns || simRunsOf(snapshot)).toLocaleString("en-US");
  const sorted = [...snapshot.rows].sort((a, b) => b.titlePct - a.titlePct || a.powerRank - b.powerRank);
  const top = Math.max(0.0001, sorted[0].titlePct);
  const body = sorted
    .map(
      (r, i) => `
      <tr class="pr-title-row" data-username="${escapeHtml(r.username || r.teamName)}">
        <td class="rank" data-label="#">${i + 1}</td>
        <td class="team-cell" data-label="Team"><span class="pr-name-text" data-username="${escapeHtml(r.username || r.teamName)}">${escapeHtml(r.teamName)}</span></td>
        <td class="pr-title-cell" data-label="Title"><span class="pr-title-pct">${titleLabel(r.titlePct)}</span><span class="pr-title-bar" aria-hidden="true"><i style="width:${Math.max(r.titlePct > 0 ? 2 : 0, (100 * r.titlePct) / top).toFixed(1)}%"></i></span></td>
        <td data-label="Playoffs">${num1(r.playoffPct)}%</td>
        ${byeTeams ? `<td data-label="Bye">${r.byePct == null ? "\u2014" : num1(r.byePct) + "%"}</td>` : ""}
        <td data-label="Record">${escapeHtml(r.record)}</td>
        <td data-label="Avg PPG">${num1(r.avgPpg)}</td>
      </tr>`
    )
    .join("");
  return `
    <div class="wrap"><div class="panel">
      <div class="panel-head"><h2>Championship Odds</h2>${chip}</div>
      <div class="heatmap-table-wrap stay-scrollable">
        <table class="stat-table compact-mobile pr-title-table">
          <thead><tr><th>#</th><th>Team</th><th>Title</th><th>Playoffs</th>${byeTeams ? "<th>Bye</th>" : ""}<th>Record</th><th>Avg PPG</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p class="heatmap-note">Chance to win the championship, from a ${runs}-run simulation: the rest of the regular season is played on the real schedule, then the real playoff bracket (${snapshot.playoffTeams} teams${byeTeams ? `, the top ${byeTeams} get a bye` : ""}). Team strength comes from the FantasyPros ROS power scores, the same as the playoff odds above.</p>
    </div></div>`;
}

// MVP Race: the five players most likely to win the league MVP (most points
// above a replacement-level player at the position over the regular season),
// from data/power-rankings-extras.json. Ranked by where the race is projected
// to end; the percentage is the simulated chance of finishing first.
function mvpSparkHtml(weekly) {
  const max = Math.max(1, ...weekly, 40);
  return `<span class="mvp-spark" aria-hidden="true">${weekly.map((w) => `<i style="height:${Math.max(3, Math.round((52 * Math.min(w, max)) / max))}px"${w > 0 ? "" : ' class="zero"'}></i>`).join("")}</span>`;
}

function mvpChanceLabel(pct) {
  if (!Number.isFinite(pct) || pct <= 0) return "\u2014";
  if (pct < 0.05) return "<0.1%";
  return pct >= 1 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

function renderMvpRace(extras, snapshot, chip) {
  const race = extras && extras.mvpRace;
  if (!race || !race.rows || !race.rows.length || !extrasMatchSnapshot(extras, snapshot)) return "";
  const cards = race.rows
    .slice(0, 5)
    .map(
      (r, i) => `
      <div class="mvp-card${i === 0 ? " lead" : ""}">
        <div class="mvp-card-top"><span class="mvp-rank">${i + 1}</span><span class="mvp-pos">${escapeHtml(r.position)}</span></div>
        ${playerLinkHtml(r.playerId, playerPhotoHtml(r.playerId, r.player, "player-photo-sm"))}
        <div class="mvp-name">${playerLinkHtml(r.playerId, escapeHtml(r.player))}</div>
        <div class="mvp-owner">${escapeHtml(r.owner || "free agent")}</div>
        <div class="mvp-par"><b>${Math.round(r.par)}</b><span> pts</span><small>above repl. · ${r.wins.toFixed(1)} W</small></div>
        ${mvpSparkHtml(r.weekly)}
        <div class="mvp-foot"><span>Projected final</span><b>${Math.round(r.projectedPar)}</b></div>
        <div class="mvp-foot"><span>Chance of #1</span><b class="mvp-chance">${mvpChanceLabel(r.chance)}</b></div>
      </div>`
    )
    .join("");
  const more = race.rows.slice(5);
  const moreRows = more
    .map(
      (r, i) => `
      <tr>
        <td class="rank" data-label="#">${i + 6}</td>
        <td class="team-cell" data-label="Player">${playerLinkHtml(r.playerId, escapeHtml(r.player))} <span class="muted-inline">(${escapeHtml(r.position)})</span></td>
        <td data-label="Rostered by">${escapeHtml(r.owner || "free agent")}</td>
        <td data-label="Pts above repl.">${Math.round(r.par)}</td>
        <td data-label="Projected">${Math.round(r.projectedPar)}</td>
        <td data-label="Chance of #1">${mvpChanceLabel(r.chance)}</td>
      </tr>`
    )
    .join("");
  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">MVP Race</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="panel-head"><h2>League MVP Candidates</h2>${chip}</div>
      <div class="mvp-grid">${cards}</div>
      ${
        more.length
          ? `<div class="heatmap-table-wrap stay-scrollable mvp-more"><table class="stat-table compact-mobile">
        <thead><tr><th>#</th><th>Also in the race</th><th>Rostered by</th><th>Pts above repl.</th><th>Projected</th><th>Chance of #1</th></tr></thead>
        <tbody>${moreRows}</tbody></table></div>`
          : ""
      }
      <p class="heatmap-note">Points above a replacement-level player at his position, in games he played, over the regular season (Weeks 1\u2013${race.throughWeek + race.remainingWeeks}). W is wins: about ${Math.round(race.pointsPerWin || 85.8)} season points make one win in this league. Projected final adds the remaining ${race.remainingWeeks} weeks at his pace, pulled toward what the position's top players average, and the percentage is how often he finished first in ${Number(race.sims).toLocaleString("en-US")} simulated finishes (which include byes and season-ending injuries). Early in the season these chances are wide open.</p>
    </div></div>`;
}

function renderContent(snapshot, lastWeekRanks, nflWeek, extras) {
  const chip = snapshotChip(snapshot, nflWeek);
  const season = snapshot.season != null && snapshot.week != null ? `<span class="pr-season-tag">${escapeHtml(snapshot.season)} · After Week ${escapeHtml(snapshot.week)}</span>` : "";
  return `
    <div class="wrap"><div class="panel">
      <div class="panel-head"><h2>Power Rankings${season}</h2>${chip}</div>
      ${renderPowerTable(snapshot, lastWeekRanks)}
      <p class="heatmap-note">Weighted composite of record, Ovr (all-play) record, scoring average, simulated playoff odds, and ROS rank. Lower PR Score is better. Luck is actual win % minus Ovr win %.</p>
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Playoff Odds</span>
      <div class="line"></div>
    </div>
    ${renderTitleOdds(snapshot, chip)}
    <div class="wrap"><div class="panel">
      <div class="panel-head"><h2>Finish Probability By Rank</h2>${chip}</div>
      ${renderOddsTable(snapshot)}
    </div></div>
    ${renderMvpRace(extras, snapshot, chip)}
    ${renderExtrasSections(snapshot, extras, chip)}
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
      <div class="panel-head"><h2>Preseason Power Rankings</h2>${freshnessChipHtml({ label: "Preseason", note: "updates once Week 1 is final", tone: "snap" })}</div>
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

/*
  ---- Strength of Schedule, Weekly Scores, Lineup Slots ---------------------
  Drawn from data/power-rankings-extras.json, which scripts/update-power-rankings.js
  writes next to the snapshot (what each number means: scripts/lib/pr-extras.js).
  Like the rest of this page nothing is calculated here beyond ordering, ranks
  already in the file and the sentences under each chart.
*/

const SLOT_SCALE = 10; // points per game above/below the league's slot average that fills a cell completely
const SLOT_SHORT_LABELS = { SUPER_FLEX: "SFLX", SUPERFLEX: "SFLX" };

// The extras only belong on the page if they were built for the same week of
// the same season as the snapshot above them.
function extrasMatchSnapshot(extras, snapshot) {
  return !!extras && String(extras.season) === String(snapshot.season) && extras.week === snapshot.week;
}

// Position along an axis as a percentage, kept inside the track.
function axisPct(value, min, max) {
  return Math.round(Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) * 100) / 100;
}

// Round-number axis around the data: step 10/25/50 picked by the caller.
function niceAxis(values, step, pad) {
  const min = Math.floor((Math.min(...values) - pad) / step) * step;
  const max = Math.ceil((Math.max(...values) + pad) / step) * step;
  const ticks = [];
  for (let t = min; t <= max; t += step) ticks.push(t);
  return { min, max, ticks };
}

function tickLabelsHtml(axis) {
  return axis.ticks.map((t) => `<span class="axis-tick" style="left:${axisPct(t, axis.min, axis.max)}%">${t}</span>`).join("");
}

// A schedule's rank (1 = hardest) in words.
function scheduleWord(rank, n) {
  if (rank === 1) return "the hardest schedule";
  if (rank === n) return "the easiest schedule";
  if (rank <= n / 3) return "a tough schedule";
  if (rank > (n * 2) / 3) return "an easy schedule";
  return "a middling schedule";
}

// How many spots a team has to move between PA/G and true SOS to be called out.
function sosFlipThreshold(n) {
  return Math.max(3, Math.round(n / 3));
}

function usernameAttr(name) {
  return name ? ` data-username="${escapeHtml(name)}"` : "";
}

function renderSosPanel(sos, chip) {
  const rows = [...sos.rows].filter((r) => r.trueSos != null && r.paPerGame != null).sort((a, b) => a.trueRank - b.trueRank || a.teamName.localeCompare(b.teamName));
  if (rows.length < 2) return "";
  const n = rows.length;
  const threshold = sosFlipThreshold(n);
  const axis = niceAxis(rows.flatMap((r) => [r.paPerGame, r.trueSos]), 10, 3);

  const body = rows
    .map((r) => {
      const moved = Math.abs(r.paRank - r.trueRank);
      const a = axisPct(r.paPerGame, axis.min, axis.max);
      const b = axisPct(r.trueSos, axis.min, axis.max);
      const title = `${r.teamName}: points against ${r.paPerGame.toFixed(1)} per game (#${r.paRank}), true SOS ${r.trueSos.toFixed(1)} (#${r.trueRank})`;
      return `
      <div class="sos-row${moved >= threshold ? " flip" : ""}" title="${escapeHtml(title)}">
        <span class="sos-name"${usernameAttr(r.teamName)}>${escapeHtml(r.teamName)}</span>
        <span class="sos-track">
          <span class="sos-link" style="left:${Math.min(a, b)}%;width:${Math.abs(a - b)}%"></span>
          <span class="sos-dot ring" style="left:${a}%"></span>
          <span class="sos-dot fill" style="left:${b}%"></span>
        </span>
        <span class="sos-ranks">#${r.paRank} → #${r.trueRank}</span>
      </div>`;
    })
    .join("");

  // The biggest mover between the two rankings (the larger raw gap breaks a tie).
  const flip = [...rows].sort((x, y) => Math.abs(y.paRank - y.trueRank) - Math.abs(x.paRank - x.trueRank) || Math.abs(y.trueSos - y.paPerGame) - Math.abs(x.trueSos - x.paPerGame))[0];
  const takeaway =
    Math.abs(flip.paRank - flip.trueRank) >= threshold
      ? `<strong>Biggest flip:</strong> ${escapeHtml(flip.teamName)} looks like ${scheduleWord(flip.paRank, n)} by PA/G (#${flip.paRank}) but has actually faced ${scheduleWord(flip.trueRank, n)} (#${flip.trueRank}).`
      : `<strong>No big flips:</strong> true SOS and points against per game tell nearly the same story so far.`;

  return `
    <div class="panel">
      <div class="panel-head"><h2>Schedule Faced So Far</h2>${chip}</div>
      <div class="sos-plot">
        <div class="sos-row sos-axis">
          <span class="sos-name">Hardest first</span>
          <span class="sos-ticks">${tickLabelsHtml(axis)}</span>
          <span class="sos-ranks">PA/G → True</span>
        </div>
        ${body}
      </div>
      <p class="pr-legend"><span class="pr-key"><i class="sos-dot ring"></i>Old "SOS" (really points against per game)</span><span class="pr-key"><i class="sos-dot fill"></i>True SOS (opponents' other games)</span></p>
      <p class="pr-takeaway">${takeaway}</p>
      <p class="heatmap-note">The SOS column on Home and Seasons is points against per game. True SOS is, for each game, the opponent's average score in all of its other games, averaged over the season — average opponent PPG, hardest first. Highlighted rows move ${threshold}+ spots between the two.</p>
    </div>`;
}

// How the Road Ahead rates an opponent: mostly by FantasyPros rest-of-season
// strength (when the file says it used it), the rest by points per game so far.
function roadAheadNote(sos) {
  const w = sos.remaining && Number.isFinite(sos.remaining.rosWeight) ? sos.remaining.rosWeight : 0;
  const rated = w > 0
    ? `every opponent rated ${Math.round(w * 100)}% on its FantasyPros rest-of-season strength and ${Math.round((1 - w) * 100)}% on its points per game so far, both put on the points-per-game scale`
    : "every opponent rated by its points per game so far";
  return `Each team's remaining regular-season games, with ${rated}. Bars show the distance from the league average of ${sos.leagueAvgPpg.toFixed(1)} PPG. It's a proxy, not a projection.`;
}

function renderRoadAheadPanel(sos, chip) {
  const rows = [...sos.rows].filter((r) => r.ahead).sort((a, b) => b.ahead.delta - a.ahead.delta || a.teamName.localeCompare(b.teamName));
  if (!rows.length) return "";
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.ahead.delta)), 0.1);
  const span = sos.remaining ? `Weeks ${sos.remaining.fromWeek}-${sos.remaining.toWeek} · ${sos.remaining.games} games` : "";

  const body = rows
    .map((r) => {
      const d = r.ahead.delta;
      const width = Math.round((Math.abs(d) / maxAbs) * 50 * 100) / 100;
      const title = `${r.teamName}: remaining opponents rate ${r.ahead.oppPpg.toFixed(1)} PPG (${signed1(d)} vs the league's ${sos.leagueAvgPpg.toFixed(1)})`;
      return `
      <div class="road-row" title="${escapeHtml(title)}">
        <span class="road-name"${usernameAttr(r.teamName)}>${escapeHtml(r.teamName)}</span>
        <span class="road-track"><span class="road-bar ${d >= 0 ? "hard" : "easy"}" style="width:${width}%"></span></span>
        <span class="road-val">${signed1(d)}</span>
      </div>`;
    })
    .join("");

  const hardest = rows[0];
  const easiest = rows[rows.length - 1];
  const takeaway =
    rows.length > 1
      ? `<strong>Worth knowing:</strong> ${escapeHtml(hardest.teamName)}${hardest.record ? ` (${escapeHtml(hardest.record)})` : ""} has the toughest remaining slate, with opponents rating ${hardest.ahead.oppPpg.toFixed(1)} PPG on average; ${escapeHtml(easiest.teamName)} has the easiest.`
      : "";

  return `
    <div class="panel">
      <div class="panel-head"><h2>Road Ahead</h2>${span ? `<span class="muted-inline">${span}</span>` : chip}</div>
      <div class="road-plot">
        <div class="road-row road-axis"><span class="road-name"></span><span class="road-track"><span class="road-side easier">← easier</span><span class="road-side harder">harder →</span></span><span class="road-val"></span></div>
        ${body}
      </div>
      <p class="pr-legend"><span class="pr-key"><i class="pr-swatch hard"></i>Harder than the league average</span><span class="pr-key"><i class="pr-swatch easy"></i>Easier</span></p>
      ${takeaway ? `<p class="pr-takeaway">${takeaway}</p>` : ""}
      <p class="heatmap-note">${roadAheadNote(sos)}</p>
    </div>`;
}

function renderSosSection(sos, chip) {
  if (!sos || !sos.rows || !sos.rows.length) return "";
  const left = renderSosPanel(sos, chip);
  const right = renderRoadAheadPanel(sos, chip);
  if (!left && !right) return "";
  return `
    <div class="yard-divider"><span class="tick"></span><div class="line"></div><span class="label">Strength of Schedule</span><div class="line"></div></div>
    <div class="section-grid${left && right ? "" : " section-grid-solo"}">${left}${right}</div>`;
}

function renderScoreStrips(scores, chip) {
  const rows = [...(scores && scores.rows ? scores.rows : [])].filter((r) => r.avg != null).sort((a, b) => b.avg - a.avg || a.teamName.localeCompare(b.teamName));
  if (!rows.length) return "";
  const all = rows.flatMap((r) => r.scores.filter((s) => s != null));
  const range = Math.max(...all) - Math.min(...all);
  const axis = niceAxis(all, range > 200 ? 50 : 25, 5);
  const league = axisPct(scores.leagueAvgPpg, axis.min, axis.max);
  const gridHtml = axis.ticks.map((t) => `<span class="strip-grid" style="left:${axisPct(t, axis.min, axis.max)}%"></span>`).join("");

  const body = rows
    .map((r) => {
      const played = r.scores.map((s, i) => ({ week: i + 1, pts: s })).filter((x) => x.pts != null);
      const dots = played.map((x) => `<span class="strip-dot" style="left:${axisPct(x.pts, axis.min, axis.max)}%" title="Week ${x.week} · ${x.pts.toFixed(1)}"></span>`).join("");
      const lo = axisPct(r.low, axis.min, axis.max);
      const hi = axisPct(r.high, axis.min, axis.max);
      const title = `${r.teamName} — average ${r.avg.toFixed(1)}: ${played.map((x) => `Wk ${x.week} ${x.pts.toFixed(1)}`).join(", ")}`;
      return `
      <div class="strip-row" title="${escapeHtml(title)}">
        <span class="strip-name"${usernameAttr(r.teamName)}>${escapeHtml(r.teamName)}</span>
        <span class="strip-track">
          ${gridHtml}
          <span class="strip-league" style="left:${league}%"></span>
          <span class="strip-span" style="left:${lo}%;width:${hi - lo}%"></span>
          ${dots}
          <span class="strip-avg" style="left:${axisPct(r.avg, axis.min, axis.max)}%"></span>
        </span>
        <span class="strip-range">${Math.round(r.low)} · ${Math.round(r.high)}</span>
      </div>`;
    })
    .join("");

  return `
    <div class="yard-divider"><span class="tick"></span><div class="line"></div><span class="label">Consistency</span><div class="line"></div></div>
    <div class="wrap"><div class="panel">
      ${chip ? `<div class="panel-head panel-head-chip">${chip}</div>` : ""}
      <div class="strip-plot">
        <div class="strip-row strip-axis">
          <span class="strip-name">Team · by avg PPG</span>
          <span class="strip-track">${tickLabelsHtml(axis)}</span>
          <span class="strip-range">Low · High</span>
        </div>
        ${body}
      </div>
      <p class="pr-legend">
        <span class="pr-key"><i class="strip-dot"></i>One week's score</span>
        <span class="pr-key"><i class="strip-avg"></i>Team average</span>
        <span class="pr-key"><i class="strip-league"></i>League avg ${scores.leagueAvgPpg.toFixed(1)}</span>
      </p>
      <p class="heatmap-note">Std Dev, Boom and Bust squeeze every score into one number; this just shows them. Overlapping dots mean similar scores — hover a row for the exact weekly numbers. Regular-season weeks only.</p>
    </div></div>`;
}

function slotLabel(col) {
  return SLOT_SHORT_LABELS[col.key] || col.label || col.key;
}

function renderSlotHeatmap(slots, chip) {
  const rows = [...(slots && slots.rows ? slots.rows : [])].sort((a, b) => b.total - a.total || a.teamName.localeCompare(b.teamName));
  if (!rows.length || !slots.columns || !slots.columns.length) return "";
  const cols = slots.columns;

  const head = `<tr><th>Team</th>${cols.map((c) => `<th>${escapeHtml(slotLabel(c))}</th>`).join("")}<th>vs Avg</th></tr>`;
  const body = rows
    .map((r) => {
      const cells = cols
        .map((c) => {
          const v = r.cells[c.key];
          if (v == null) return `<td class="heat-cell empty">—</td>`;
          const avg = slots.leagueAvg && slots.leagueAvg[c.key] != null ? ` (league ${slots.leagueAvg[c.key].toFixed(1)})` : "";
          const title = `${r.teamName} ${slotLabel(c)}: ${(v + (slots.leagueAvg ? slots.leagueAvg[c.key] || 0 : 0)).toFixed(1)} PPG${avg}`;
          return `<td class="heat-cell" style="background:${divergingHeatColor(v, SLOT_SCALE)}" title="${escapeHtml(title)}">${signed1(v)}</td>`;
        })
        .join("");
      const cls = r.total > 0 ? "luck-positive" : r.total < 0 ? "luck-negative" : "luck-neutral";
      return `<tr><td class="team-cell"${usernameAttr(r.teamName)}>${escapeHtml(r.teamName)}</td>${cells}<td class="slot-total"><span class="${cls}">${signed1(r.total)}</span></td></tr>`;
    })
    .join("");

  const legend = [-10, -6.7, -3.3, 0, 3.3, 6.7, 10]
    .map((v) => `<span class="slot-key" style="background:${divergingHeatColor(v, SLOT_SCALE)}">${v === 0 ? "0" : signed1(v).replace(".0", "")}</span>`)
    .join("");

  return `
    <div class="yard-divider"><span class="tick"></span><div class="line"></div><span class="label">Lineups</span><div class="line"></div></div>
    <div class="wrap"><div class="panel">
      <div class="panel-head"><h2>Where Each Lineup Is Strong Or Thin</h2>${chip}</div>
      <div class="heatmap-table-wrap stay-scrollable">
        <table class="stat-table compact-mobile sticky-cols-1 slot-table">
          <thead>${head}</thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div class="slot-legend">${legend}<span class="slot-legend-note">Points per game vs league average for that slot. The scale is fixed at ±${SLOT_SCALE} and saturates beyond it.</span></div>
      <p class="heatmap-note">One fixed color scale for every cell: yellow is a strength, blue is a hole, and a colored cell means the same thing for every team and every slot. Each cell is the team's average in that starter slot minus the league's average for that slot; vs Avg is the sum across all slots (total points per game vs the league average). Regular-season weeks only.</p>
    </div></div>`;
}

function renderExtrasSections(snapshot, extras, chip) {
  if (!extrasMatchSnapshot(extras, snapshot)) return "";
  return renderSosSection(extras.sos, chip) + renderScoreStrips(extras.scores, chip) + renderSlotHeatmap(extras.slots, chip);
}

document.addEventListener("DOMContentLoaded", renderPowerRankings);
// One listener for the whole page: tapping a team in the phone list opens its extra numbers.
document.addEventListener("click", (e) => {
  const button = e.target && e.target.closest ? e.target.closest(".pr-phone-row") : null;
  if (button) togglePhoneRow(button);
});
