let PLAYER_INDEX = null;

async function renderPlayers() {
  const errorBox = document.getElementById("player-error");
  const progressBox = document.getElementById("progress-status");

  try {
    progressBox.style.display = "block";
    progressBox.textContent = "Loading player index…";
    const data = await fetchJsonSafe(PLAYER_INDEX_FILE, { players: {} });
    progressBox.style.display = "none";

    PLAYER_INDEX = data.players || {};
    const playerCount = Object.keys(PLAYER_INDEX).length;
    document.title = (SITE_TITLE || "League") + " — NFL Players";
    document.getElementById("sb-sub").textContent = playerCount
      ? `${playerCount} player${playerCount === 1 ? "" : "s"} who've started for a team, Sleeper era`
      : "No player data yet — run scripts/build-player-index.js to generate it.";

    initPlayerSearch();
    renderFromHash();
    window.addEventListener("hashchange", renderFromHash);
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load player data — " + err.message;
    errorBox.style.display = "block";
  }
}

// Substring match against every eligible player's name, ranked by how
// much of their career they've actually been rostered for — a simple,
// good-enough relevance signal since the search universe here is only
// ever players who've started at least once, not the full NFL.
function searchPlayers(query) {
  const q = query.trim().toLowerCase();
  if (!q || !PLAYER_INDEX) return [];
  return Object.entries(PLAYER_INDEX)
    .filter(([, p]) => p.name.toLowerCase().includes(q))
    .sort((a, b) => b[1].totals.gamesOwned - a[1].totals.gamesOwned)
    .slice(0, 8);
}

function initPlayerSearch() {
  const input = document.getElementById("player-search");
  const results = document.getElementById("player-search-results");

  function renderResults(matches) {
    if (!matches.length) {
      results.style.display = "none";
      results.innerHTML = "";
      return;
    }
    results.innerHTML = matches
      .map(
        ([id, p]) => `
      <a class="player-search-result" href="#${encodeURIComponent(id)}">
        <span class="player-search-result-name">${escapeHtml(p.name)}</span>
        <span class="player-search-result-meta">${escapeHtml(p.position || "")} · ${p.totals.gamesOwned} games</span>
      </a>`
      )
      .join("");
    results.style.display = "block";
  }

  input.addEventListener("input", () => renderResults(searchPlayers(input.value)));
  input.addEventListener("focus", () => {
    if (input.value.trim()) renderResults(searchPlayers(input.value));
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".player-search-wrap")) {
      results.style.display = "none";
    }
  });
  results.addEventListener("click", () => {
    results.style.display = "none";
    input.value = "";
  });
}

function renderFromHash() {
  const playerId = decodeURIComponent(location.hash.replace(/^#/, ""));
  const emptyView = document.getElementById("player-empty-view");
  const detailView = document.getElementById("player-detail-view");
  const player = playerId && PLAYER_INDEX ? PLAYER_INDEX[playerId] : null;

  if (player) {
    emptyView.style.display = "none";
    detailView.style.display = "";
    detailView.innerHTML = renderPlayerDetail(playerId, player);
    initScrollAnimations();
    initChartTabs();
  } else {
    detailView.style.display = "none";
    emptyView.style.display = "";
  }
}

function formatSpanRange(s) {
  const start = `${s.startSeason} Wk${s.startWeek}`;
  const end = `${s.endSeason} Wk${s.endWeek}`;
  return start === end ? start : `${start} – ${end}`;
}

function renderPlayerDetail(playerId, player) {
  const t = player.totals;
  const high = player.careerHigh;

  const spansRows = player.spans
    .map(
      (s) => `
    <tr>
      <td class="team-cell" data-label="Owner">${escapeHtml(s.ownerName)}</td>
      <td data-label="Span">${escapeHtml(formatSpanRange(s))}</td>
      <td data-label="Games Owned">${s.gamesOwned}</td>
      <td data-label="Games Started">${s.gamesStarted}</td>
      <td data-label="PPG">${s.ppg.toFixed(1)}</td>
    </tr>`
    )
    .join("");

  return `
    <div class="player-header">
      ${playerPhotoHtml(playerId, player.name, "player-photo-lg")}
      <div>
        <div class="player-header-name">${escapeHtml(player.name)}</div>
        ${player.position ? `<div class="player-header-position">${escapeHtml(player.position.toUpperCase())}</div>` : ""}
      </div>
    </div>

    <div class="player-stat-strip">
      <div class="player-stat-card"><div class="player-stat-value gold">${t.owners}</div><div class="player-stat-label">owner${t.owners === 1 ? "" : "s"}</div></div>
      <div class="player-stat-card"><div class="player-stat-value">${t.gamesOwned}</div><div class="player-stat-label">games rostered</div></div>
      <div class="player-stat-card"><div class="player-stat-value">${t.gamesStarted} / ${t.gamesBenched}</div><div class="player-stat-label">started / benched</div></div>
      <div class="player-stat-card"><div class="player-stat-value">${t.totalPoints.toFixed(1)}</div><div class="player-stat-label">total points</div></div>
      <div class="player-stat-card"><div class="player-stat-value">${t.ppg.toFixed(1)}</div><div class="player-stat-label">career ppg</div></div>
    </div>

    ${
      high
        ? `
    <div class="player-high-callout">
      <div>
        <div class="player-high-eyebrow">Career high</div>
        <div class="player-high-detail">${escapeHtml(String(high.season))} Wk ${high.week} · owned by ${escapeHtml(high.ownerName)} · ${high.started ? "started" : "benched"}</div>
      </div>
      <div class="player-high-value">${high.points.toFixed(1)}</div>
    </div>`
        : ""
    }

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Career Arc</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      ${renderCareerArc(player)}
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Ownership History</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="heatmap-table-wrap stay-scrollable">
        <table class="stat-table compact-mobile">
          <thead><tr><th>Owner</th><th>Span</th><th>Games Owned</th><th>Games Started</th><th>PPG</th></tr></thead>
          <tbody>${spansRows}</tbody>
        </table>
      </div>
      <p class="heatmap-note">Sorted oldest to newest. The same manager can appear more than once if they owned, lost, and later re-acquired this player.</p>
    </div></div>`;
}

// "2021:05" (zero-padded week) so plain string comparison sorts
// chronologically, including across a season boundary.
function seasonWeekKey(season, week) {
  return `${season}:${String(week).padStart(2, "0")}`;
}

// Finds which ownership span a given (season, week) falls inside.
// Spans count in the single digits to low dozens even for a long
// career, so a linear scan per lookup is effectively free — no need
// for anything cleverer.
function buildSpanLookup(spans) {
  return function (season, week) {
    const key = seasonWeekKey(season, week);
    return spans.find((s) => seasonWeekKey(s.startSeason, s.startWeek) <= key && key <= seasonWeekKey(s.endSeason, s.endWeek)) || null;
  };
}

function renderCareerArc(player) {
  const t = player.totals;
  return `
    <div class="chart-tabs">
      <button type="button" class="chart-tab active" data-chart-tab="all">All (${t.gamesOwned})</button>
      <button type="button" class="chart-tab" data-chart-tab="starts">Starts (${t.gamesStarted})</button>
    </div>
    <div class="chart-tab-panel" data-chart-panel="all">
      ${careerArcSvg(player, "all")}
    </div>
    <div class="chart-tab-panel" data-chart-panel="starts" style="display:none;">
      ${careerArcSvg(player, "starts")}
    </div>
    <div class="career-arc-legend">
      <span><span class="career-arc-legend-dot filled"></span>Started</span>
      <span><span class="career-arc-legend-dot hollow"></span>Benched</span>
      <span><span class="career-arc-legend-dot ring"></span>Career high</span>
      <span><span class="career-arc-legend-swatch"></span>Owner span</span>
    </div>`;
}

/*
  The Career Arc chart: one point per game (not literal calendar time),
  colored background bands for each ownership span, filled dots for
  starts and hollow-ring dots for benched weeks, one larger ringed dot
  for the single career-high game, and a season-labeled x-axis. The
  y-axis is always a clean multiple-of-5 scale from 0 up — standardized
  across every player rather than auto-fit to each one's own range, so
  a glance at the axis alone tells you roughly how good a week was
  without needing to check the scale first. It only expands past 0-35
  when a player's own career high actually clears 35.

  Deliberately its own function rather than an extension of
  Charts.multiLineChart — this chart mixes variable-width labeled
  bands, per-point dot styling, and a single highlighted point in ways
  that don't fit the shared multi-series line chart's model.
*/
function careerArcSvg(player, mode) {
  const weekly = player.weekly || [];
  if (!weekly.length) return `<div class="empty-state">No weekly data on record.</div>`;

  const findSpan = buildSpanLookup(player.spans);
  const ownerColors = new Map();
  player.spans.forEach((s) => {
    if (!ownerColors.has(s.ownerId)) ownerColors.set(s.ownerId, MULTI_LINE_COLORS[ownerColors.size % MULTI_LINE_COLORS.length]);
  });

  const visible = weekly.map((w, i) => ({ ...w, i, span: findSpan(w.season, w.week) })).filter((w) => (mode === "starts" ? w.started : true));
  if (!visible.length) return `<div class="empty-state">No starts on record yet.</div>`;

  const dataMax = Math.max(...weekly.map((w) => w.points));
  const yMax = Math.max(35, Math.ceil(dataMax / 5) * 5);
  const padL = 44,
    padR = 20,
    padT = 34,
    padB = 26,
    W = 1000,
    H = 316;
  const innerW = W - padL - padR,
    innerH = H - padT - padB;
  const step = visible.length > 1 ? innerW / (visible.length - 1) : 0;
  const x = (i) => padL + i * step;
  const y = (v) => padT + innerH - (v / yMax) * innerH;

  // Bands are computed against the currently-VISIBLE (filtered)
  // sequence, so switching to "Starts" naturally narrows — or, for a
  // span where the player was only ever benched, fully removes — that
  // span's band, rather than showing a band with no points in it.
  //
  // The half-step extension on each side (so a band visually surrounds
  // its points rather than edge-aligning to them) would push the very
  // first and very last band past the chart's actual plot area — off
  // the left/right edge of the SVG canvas entirely for the first/last
  // point — clipping the owner-name label. Clamp both edges to the
  // plot area's own bounds (padL / W-padR) rather than the raw
  // half-step math.
  let bandsHtml = "";
  let cursor = 0;
  while (cursor < visible.length) {
    const span = visible[cursor].span;
    let end = cursor;
    while (end + 1 < visible.length && visible[end + 1].span === span) end++;
    const x0 = Math.max(padL, x(cursor) - step / 2);
    const x1 = Math.min(W - padR, x(end) + step / 2);
    const bandW = x1 - x0;
    const color = span ? ownerColors.get(span.ownerId) : "#5A5A52";
    const label = span ? span.ownerName : "Unowned";
    bandsHtml += `<rect x="${x0.toFixed(1)}" y="${padT}" width="${bandW.toFixed(1)}" height="${innerH}" fill="${color}" opacity="0.12"></rect>`;
    bandsHtml += `<text x="${(x0 + 6).toFixed(1)}" y="${padT + 15}" font-family="IBM Plex Mono, monospace" font-size="10" font-weight="600" fill="${color}">${escapeHtml(
      label.toUpperCase()
    )}</text>`;
    cursor = end + 1;
  }

  let gridHtml = "";
  for (let v = 0; v <= yMax; v += 5) {
    gridHtml += `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="#2A4A36" stroke-width="1" opacity="${v === 0 ? 0.85 : 0.5}"></line>`;
    gridHtml += `<text x="${padL - 8}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="10" fill="#9BAE9F">${v}</text>`;
  }

  // Same "computed against the visible sequence" reasoning as the
  // bands above — a season the player never started in simply
  // shouldn't get an x-axis label on the Starts view.
  let xAxisHtml = "";
  let sCursor = 0;
  while (sCursor < visible.length) {
    const season = visible[sCursor].season;
    let end = sCursor;
    while (end + 1 < visible.length && visible[end + 1].season === season) end++;
    if (sCursor > 0) {
      xAxisHtml += `<line x1="${x(sCursor).toFixed(1)}" y1="${padT}" x2="${x(sCursor).toFixed(1)}" y2="${(padT + innerH).toFixed(1)}" stroke="#EDEAE0" stroke-width="1" stroke-dasharray="3,3" opacity="0.25"></line>`;
    }
    xAxisHtml += `<text x="${x(sCursor).toFixed(1)}" y="${padT + innerH + 18}" font-family="IBM Plex Mono, monospace" font-size="10" fill="#9BAE9F">${escapeHtml(String(season))}</text>`;
    sCursor = end + 1;
  }

  const highKey = player.careerHigh ? seasonWeekKey(player.careerHigh.season, player.careerHigh.week) : null;
  const linePath = visible.map((w, idx) => `${idx === 0 ? "M" : "L"}${x(idx).toFixed(1)},${y(w.points).toFixed(1)}`).join(" ");

  let dotsHtml = "";
  visible.forEach((w, idx) => {
    const color = w.span ? ownerColors.get(w.span.ownerId) : "#5A5A52";
    const isHigh = highKey && seasonWeekKey(w.season, w.week) === highKey;
    const cx = x(idx).toFixed(1);
    const cy = y(w.points).toFixed(1);
    if (isHigh) {
      dotsHtml += `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="#EDEAE0" stroke-width="2" opacity="0.85"></circle>`;
    }
    dotsHtml += `<circle cx="${cx}" cy="${cy}" r="${isHigh ? 5.5 : 4}" fill="${w.started ? color : "#14261C"}" stroke="${color}" stroke-width="1.5"><title>${escapeHtml(
      String(w.season)
    )} Wk ${w.week}: ${w.points.toFixed(1)} pts (${w.started ? "started" : "benched"})</title></circle>`;
  });

  return `
    <div class="career-arc-wrap">
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMinYMin meet" role="img">
        <title>${escapeHtml(player.name)}'s career scoring arc</title>
        ${bandsHtml}
        ${gridHtml}
        ${xAxisHtml}
        <path fill="none" stroke="#EDEAE0" stroke-width="1.5" opacity="0.6" d="${linePath}"></path>
        ${dotsHtml}
      </svg>
    </div>`;
}

document.addEventListener("DOMContentLoaded", renderPlayers);
