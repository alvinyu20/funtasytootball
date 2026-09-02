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
    initRandomPlayerButton();
    renderFromHash();
    window.addEventListener("hashchange", renderFromHash);
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load player data — " + err.message;
    errorBox.style.display = "block";
  }
}

function initRandomPlayerButton() {
  const btn = document.getElementById("player-random-btn");
  btn.addEventListener("click", () => {
    const currentId = decodeURIComponent(location.hash.replace(/^#/, ""));
    const randomId = pickRandomPlayerId(PLAYER_INDEX, currentId);
    if (!randomId) return; // no data loaded yet (or none on record) -- nothing to jump to
    if (`#${encodeURIComponent(randomId)}` === location.hash) {
      // Only reachable when there's exactly one player total (the only
      // case pickRandomPlayerId can't avoid repeating) -- hashchange
      // wouldn't fire for setting the hash to what it already is.
      renderFromHash();
    } else {
      location.hash = encodeURIComponent(randomId);
    }
  });
}

// Picks a random player id from the index. When there's more than one
// player on record, deliberately never returns currentId — landing on
// the SAME player you're already viewing would make a repeat click
// feel like the button silently did nothing.
function pickRandomPlayerId(index, currentId) {
  const ids = Object.keys(index || {});
  if (!ids.length) return null;
  if (ids.length === 1) return ids[0];
  let randomId = currentId;
  while (randomId === currentId) {
    randomId = ids[Math.floor(Math.random() * ids.length)];
  }
  return randomId;
}

// How well a player's name matches a search query, low number = best
// match. 0: the full name starts with the query (e.g. "Christian" for
// "chr"). 1: some OTHER word in the name starts with it (e.g. "Amari
// Cooper" for "coo" — the last name, not the first, starts the match).
// 2: the query shows up anywhere else in the name (e.g. "Kelce" for
// "c" — matches, but only mid-word). null: no match at all. Without
// this, a plain substring search ranks "Travis Kelce" above every
// player whose actual first or last name starts with "C", since
// "Kelce" happens to contain a "c" — technically a match, just not the
// one anyone typing "c" is looking for.
function nameMatchRank(name, q) {
  const lower = name.toLowerCase();
  if (lower.startsWith(q)) return 0;
  if (lower.split(/[\s'-]+/).some((word) => word.startsWith(q))) return 1;
  if (lower.includes(q)) return 2;
  return null;
}

// Matches ranked by nameMatchRank first (closest match wins), then by
// how much of their career they've actually been rostered for as a
// tiebreaker within the same rank — a simple, good-enough popularity
// signal since the search universe here is only ever players who've
// started at least once, not the full NFL.
function searchPlayers(query) {
  const q = query.trim().toLowerCase();
  if (!q || !PLAYER_INDEX) return [];
  return Object.entries(PLAYER_INDEX)
    .map(([id, p]) => [id, p, nameMatchRank(p.name, q)])
    .filter(([, , rank]) => rank != null)
    .sort((a, b) => a[2] - b[2] || b[1].totals.gamesOwned - a[1].totals.gamesOwned)
    .slice(0, 8)
    .map(([id, p]) => [id, p]);
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
      <div class="player-stat-card player-stat-card-split">
        <div class="player-stat-split-row"><span class="player-stat-split-value">${t.gamesStarted}</span><span class="player-stat-split-label">Started</span></div>
        <div class="player-stat-split-row"><span class="player-stat-split-value">${t.gamesBenched}</span><span class="player-stat-split-label">Benched</span></div>
        <div class="player-stat-split-row"><span class="player-stat-split-value">${t.gamesFA || 0}</span><span class="player-stat-split-label">FA</span></div>
      </div>
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
      ${renderOwnershipHistory(player)}
    </div></div>`;
}

// Aggregates a player's ownership spans by owner — the same manager's
// multiple non-contiguous spans (see buildPlayerIndex's span-splitting
// logic) collapse into one row with combined totals, rather than
// showing their career with this player broken up into pieces. PPG is
// re-derived from the summed totals rather than averaging each span's
// own PPG, so a long low-scoring span and a short high-scoring span
// combine correctly instead of being weighted as if they were equal
// samples.
function cumulativeOwnershipRows(spans) {
  const byOwner = new Map();
  spans.forEach((s) => {
    if (!byOwner.has(s.ownerId)) {
      byOwner.set(s.ownerId, { ownerName: s.ownerName, gamesOwned: 0, gamesStarted: 0, gamesPlayed: 0, totalPoints: 0 });
    }
    const agg = byOwner.get(s.ownerId);
    agg.gamesOwned += s.gamesOwned;
    agg.gamesStarted += s.gamesStarted;
    agg.gamesPlayed += s.gamesPlayed || 0;
    agg.totalPoints += s.totalPoints;
  });
  return [...byOwner.values()]
    .map((agg) => ({ ...agg, ppg: agg.gamesPlayed > 0 ? agg.totalPoints / agg.gamesPlayed : 0 }))
    .sort((a, b) => b.gamesOwned - a.gamesOwned);
}

function renderOwnershipHistory(player) {
  const spanPpgs = player.spans.map((s) => s.ppg);
  const spanPpgMin = Math.min(...spanPpgs);
  const spanPpgMax = Math.max(...spanPpgs);
  const spanRows = player.spans
    .map(
      (s) => `
    <tr>
      <td class="team-cell" data-label="Owner">${escapeHtml(s.ownerName)}</td>
      <td data-label="Span">${escapeHtml(formatSpanRange(s))}</td>
      <td data-label="Games Owned">${s.gamesOwned}</td>
      <td data-label="Games Started">${s.gamesStarted}</td>
      <td class="heat-cell" data-label="PPG" style="background:${heatColor(s.ppg, spanPpgMin, spanPpgMax)}">${s.ppg.toFixed(1)}</td>
    </tr>`
    )
    .join("");

  const cumulative = cumulativeOwnershipRows(player.spans);
  const cumulativePpgs = cumulative.map((agg) => agg.ppg);
  const cumulativePpgMin = Math.min(...cumulativePpgs);
  const cumulativePpgMax = Math.max(...cumulativePpgs);
  const cumulativeRows = cumulative
    .map(
      (agg) => `
    <tr>
      <td class="team-cell" data-label="Owner">${escapeHtml(agg.ownerName)}</td>
      <td data-label="Games Owned">${agg.gamesOwned}</td>
      <td data-label="Games Started">${agg.gamesStarted}</td>
      <td class="heat-cell" data-label="PPG" style="background:${heatColor(agg.ppg, cumulativePpgMin, cumulativePpgMax)}">${agg.ppg.toFixed(1)}</td>
    </tr>`
    )
    .join("");

  return `
    <div class="chart-tabs">
      <button type="button" class="chart-tab active" data-chart-tab="by-span">By Span</button>
      <button type="button" class="chart-tab" data-chart-tab="cumulative">Cumulative</button>
    </div>
    <div class="chart-tab-panel" data-chart-panel="by-span">
      <div class="heatmap-table-wrap stay-scrollable">
        <table class="stat-table compact-mobile ownership-table">
          <thead><tr><th>Owner</th><th>Span</th><th><span class="full-label">Games Owned</span><span class="short-label">Owned</span></th><th><span class="full-label">Games Started</span><span class="short-label">Started</span></th><th>PPG</th></tr></thead>
          <tbody>${spanRows}</tbody>
        </table>
      </div>
      <p class="heatmap-note">Sorted oldest to newest. The same manager can appear more than once if they owned, lost, and later re-acquired this player. PPG is colored relative to this player's own spans — green is their best, red is their worst.</p>
    </div>
    <div class="chart-tab-panel" data-chart-panel="cumulative" style="display:none;">
      <div class="heatmap-table-wrap stay-scrollable">
        <table class="stat-table compact-mobile ownership-table">
          <thead><tr><th>Owner</th><th><span class="full-label">Games Owned</span><span class="short-label">Owned</span></th><th><span class="full-label">Games Started</span><span class="short-label">Started</span></th><th>PPG</th></tr></thead>
          <tbody>${cumulativeRows}</tbody>
        </table>
      </div>
      <p class="heatmap-note">Every span for the same manager combined into one line, sorted by games owned. PPG is colored relative to this player's own owners — green is their best, red is their worst.</p>
    </div>`;
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
  const gamesFA = t.gamesFA || 0;
  return `
    <div class="chart-tabs">
      <button type="button" class="chart-tab" data-chart-tab="owned">Owned (${t.gamesOwned})</button>
      <button type="button" class="chart-tab active" data-chart-tab="all">All (${t.gamesOwned + gamesFA})</button>
      <button type="button" class="chart-tab" data-chart-tab="starts">Starts (${t.gamesStarted})</button>
    </div>
    <div class="chart-tab-panel" data-chart-panel="owned" style="display:none;">
      ${careerArcSvg(player, "owned")}
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
      <span><span class="career-arc-legend-swatch fa"></span>Free agent (All view only)</span>
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

  const visible = weekly
    .map((w, i) => ({ ...w, i, span: findSpan(w.season, w.week) }))
    .filter((w) => {
      if (mode === "starts") return !!w.started;
      // "owned" excludes FA weeks; "owned: undefined" (older cached
      // data from before the FA feature existed) is treated as owned,
      // matching what it always implicitly meant back then.
      if (mode === "owned") return w.owned !== 0;
      return true; // "all" -- owned and FA weeks both
    });
  if (!visible.length) {
    const emptyMessage = mode === "starts" ? "No starts on record yet." : mode === "all" ? "No games on record yet." : "No owned games on record yet.";
    return `<div class="empty-state">${emptyMessage}</div>`;
  }

  const dataMax = Math.max(...weekly.map((w) => w.points));
  const yMax = Math.max(35, Math.ceil(dataMax / 5) * 5);
  const padL = 44,
    padR = 20,
    padT = 34,
    padB = 26,
    H = 316;
  // The chart's width is driven by how many points there are, not
  // squeezed to fit whatever container it's in — a long career on a
  // narrow phone screen used to mean every dot, band label, and axis
  // tick shrank down together until they were illegible. Instead, each
  // point gets a fixed, always-legible amount of space; a career long
  // enough to need more room than the panel has just becomes wider
  // than it, and the wrapping div (see below) lets that be explored by
  // scrolling sideways rather than shrinking to fit. The 700 floor
  // matches roughly what a short career already filled comfortably, so
  // this doesn't change anything for the common case.
  const minPxPerPoint = 32;
  const W = Math.max(700, padL + padR + (visible.length - 1) * minPxPerPoint);
  const innerW = W - padL - padR,
    innerH = H - padT - padB;
  const step = visible.length > 1 ? innerW / (visible.length - 1) : 0;
  const x = (i) => padL + i * step;
  const y = (v) => padT + innerH - (v / yMax) * innerH;
  // Only worth telling someone to scroll when the chart could plausibly
  // be wider than a typical phone screen -- a short career already
  // fits comfortably and doesn't need the hint.
  const isPannable = visible.length > 12;

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
  let crampedCount = 0;
  while (cursor < visible.length) {
    const span = visible[cursor].span;
    let end = cursor;
    while (end + 1 < visible.length && visible[end + 1].span === span) end++;
    const x0 = Math.max(padL, x(cursor) - step / 2);
    const x1 = Math.min(W - padR, x(end) + step / 2);
    const bandW = x1 - x0;
    const color = span ? ownerColors.get(span.ownerId) : "#5A5A52";
    bandsHtml += `<rect x="${x0.toFixed(1)}" y="${padT}" width="${bandW.toFixed(1)}" height="${innerH}" fill="${color}" opacity="0.12"></rect>`;
    // A free-agent stretch keeps the neutral gray band but gets no text
    // label at all -- the legend already explains what an unlabeled
    // gray band means, and a career with several such stretches would
    // otherwise print "UNOWNED" repeatedly, adding noise rather than
    // information.
    if (span) {
      const label = span.ownerName.toUpperCase();
      // The chart's labels use a monospace font (10px IBM Plex Mono),
      // so character count is a reliable stand-in for rendered width --
      // ~6.2px/char is the standard ratio for that pairing. When a
      // band's too narrow for its own label, alternate that label's
      // vertical position among the other cramped ones, so two short
      // consecutive spans (a player bouncing between rosters) don't
      // print their names directly on top of each other.
      const isCramped = label.length * 6.2 + 12 > bandW;
      const labelY = isCramped && crampedCount % 2 === 1 ? padT + 27 : padT + 15;
      if (isCramped) crampedCount++;
      bandsHtml += `<text x="${(x0 + 6).toFixed(1)}" y="${labelY}" font-family="IBM Plex Mono, monospace" font-size="10" font-weight="600" fill="${color}">${escapeHtml(
        label
      )}</text>`;
    }
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
    <div class="career-arc-scroll">
      <div class="career-arc-wrap" style="min-width:${W}px;">
        <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMinYMin meet" role="img">
          <title>${escapeHtml(player.name)}'s career scoring arc</title>
          ${bandsHtml}
          ${gridHtml}
          ${xAxisHtml}
          <path fill="none" stroke="#EDEAE0" stroke-width="1.5" opacity="0.6" d="${linePath}"></path>
          ${dotsHtml}
        </svg>
      </div>
    </div>
    ${isPannable ? `<div class="career-arc-swipe-hint">← Swipe to explore the full career →</div>` : ""}`;
}

document.addEventListener("DOMContentLoaded", renderPlayers);
