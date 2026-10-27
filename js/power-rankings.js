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

// "Snapshot · Through Week 6 · Oct 13 · updates with each ROS refresh". Amber when the
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

function renderContent(snapshot, lastWeekRanks, nflWeek, extras) {
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

// "+8.1" / "-3.0" / "0.0": the sign always shows except on zero (and on a
// -0.04 that rounds to zero, which would otherwise print "-0.0").
function signed1(n) {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return "0.0";
  return (r > 0 ? "+" : "") + r.toFixed(1);
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

function renderRoadAheadPanel(sos, chip) {
  const rows = [...sos.rows].filter((r) => r.ahead).sort((a, b) => b.ahead.delta - a.ahead.delta || a.teamName.localeCompare(b.teamName));
  if (!rows.length) return "";
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.ahead.delta)), 0.1);
  const span = sos.remaining ? `Weeks ${sos.remaining.fromWeek}-${sos.remaining.toWeek} · ${sos.remaining.games} games` : "";

  const body = rows
    .map((r) => {
      const d = r.ahead.delta;
      const width = Math.round((Math.abs(d) / maxAbs) * 50 * 100) / 100;
      const title = `${r.teamName}: remaining opponents average ${r.ahead.oppPpg.toFixed(1)} PPG (${signed1(d)} vs the league's ${sos.leagueAvgPpg.toFixed(1)})`;
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
      ? `<strong>Worth knowing:</strong> ${escapeHtml(hardest.teamName)}${hardest.record ? ` (${escapeHtml(hardest.record)})` : ""} has the toughest remaining slate at ${hardest.ahead.oppPpg.toFixed(1)} PPG per opponent; ${escapeHtml(easiest.teamName)} has the easiest.`
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
      <p class="heatmap-note">Each team's remaining regular-season games, with every opponent rated by its points per game so far. Bars show the distance from the league average of ${sos.leagueAvgPpg.toFixed(1)} PPG. It's a proxy, not a projection.</p>
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

  // Steadiest and wildest, by the gap between best and worst week; one week
  // of data can't say either.
  const weeksPlayed = Math.max(...rows.map((r) => r.scores.filter((s) => s != null).length));
  const spread = (r) => r.high - r.low;
  const steady = [...rows].sort((a, b) => spread(a) - spread(b) || b.avg - a.avg)[0];
  const wild = [...rows].sort((a, b) => spread(b) - spread(a) || b.avg - a.avg)[0];
  const takeaway =
    weeksPlayed >= 2 && steady !== wild
      ? `<strong>Takeaway:</strong> ${escapeHtml(steady.teamName)} has been the steadiest (${Math.round(spread(steady))} point spread between best and worst week), while ${escapeHtml(wild.teamName)} swings ${Math.round(spread(wild))} points.`
      : "";

  return `
    <div class="yard-divider"><span class="tick"></span><div class="line"></div><span class="label">Consistency</span><div class="line"></div></div>
    <div class="wrap"><div class="panel">
      <div class="panel-head"><h2>Every Week, One Dot</h2>${chip}</div>
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
      ${takeaway ? `<p class="pr-takeaway">${takeaway}</p>` : ""}
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

  // Biggest strength and deepest hole across every team and slot.
  let best = null;
  let worst = null;
  rows.forEach((r) =>
    cols.forEach((c) => {
      const v = r.cells[c.key];
      if (v == null) return;
      if (!best || v > best.v) best = { v, team: r.teamName, col: c };
      if (!worst || v < worst.v) worst = { v, team: r.teamName, col: c };
    })
  );
  const parts = [];
  if (best && best.v > 0) parts.push(`Biggest strength: ${escapeHtml(best.team)}'s ${escapeHtml(slotLabel(best.col))} at ${signed1(best.v)} points per game above the league average for that slot.`);
  if (worst && worst.v < 0) parts.push(`Deepest hole: ${escapeHtml(worst.team)}'s ${escapeHtml(slotLabel(worst.col))} at ${signed1(worst.v)}.`);

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
      ${parts.length ? `<p class="pr-takeaway"><strong>Takeaway:</strong> ${parts.join(" ")}</p>` : ""}
      <p class="heatmap-note">One fixed color scale for every cell: blue is a strength, orange is a hole, and a colored cell means the same thing for every team and every slot. Each cell is the team's average in that starter slot minus the league's average for that slot; vs Avg is the sum across all slots (total points per game vs the league average). Regular-season weeks only.</p>
    </div></div>`;
}

function renderExtrasSections(snapshot, extras, chip) {
  if (!extrasMatchSnapshot(extras, snapshot)) return "";
  return renderSosSection(extras.sos, chip) + renderScoreStrips(extras.scores, chip) + renderSlotHeatmap(extras.slots, chip);
}

document.addEventListener("DOMContentLoaded", renderPowerRankings);
