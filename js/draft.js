let SEASON_CHAIN = null;
let PLAYER_DIRECTORY = null;
let LEAGUE_STATS = null;

async function renderDraftPage() {
  const errorBox = document.getElementById("draft-error");
  const progressBox = document.getElementById("progress-status");

  try {
    const [seasonChain, playerDirectory] = await Promise.all([SleeperAPI.getSeasonChain(LEAGUE_ID), SleeperAPI.getPlayerDirectory()]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }
    SEASON_CHAIN = seasonChain;
    PLAYER_DIRECTORY = playerDirectory;

    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Draft Board";
    document.getElementById("sb-title").textContent = "Draft Board";
    document.getElementById("sb-sub").textContent = "Every pick, every season, color-coded by position.";

    renderSeasonPicker();

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    // Grades need the league-wide draft-value curve, which only comes from
    // computeStats — same reason the Records/Teams pages do this same
    // full-history fetch rather than a lighter per-season one.
    LEAGUE_STATS = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);

    if (!location.hash) {
      const defaultEntry = [...seasonChain].reverse().find((e) => e.league.status === "complete") || seasonChain[seasonChain.length - 1];
      if (defaultEntry) location.hash = `#${defaultEntry.league.season}`;
    }

    renderSeasonPicker();
    renderSelectedDraft();
    window.addEventListener("hashchange", () => {
      renderSeasonPicker();
      renderSelectedDraft();
    });
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load draft data — " + err.message;
    errorBox.style.display = "block";
  }
}

function renderSeasonPicker() {
  const picker = document.getElementById("draft-season-picker");
  const selected = decodeURIComponent(location.hash.replace(/^#/, ""));
  picker.innerHTML = [...SEASON_CHAIN]
    .reverse()
    .map((entry) => String(entry.league.season))
    .map((season) => `<a class="season-pill ${season === selected ? "active" : ""}" href="#${encodeURIComponent(season)}">${escapeHtml(season)}</a>`)
    .join("");
}

// Reshapes computeStats' per-manager draftPicks lists into a proper
// draft-board grid for one season: columns are teams (fixed by their
// Round 1 draft slot, matching how a real draft board reads — snake
// order shows up as pick order alternating across rows, not columns
// swapping teams), rows are rounds.
function buildDraftBoard(season) {
  const managersWithPicks = LEAGUE_STATS.managers
    .map((m) => {
      const s = m.seasons.find((se) => String(se.season) === String(season));
      return s && s.draftPicks.length ? { userId: m.userId, username: m.username, teamName: m.teamName, picks: s.draftPicks } : null;
    })
    .filter(Boolean);
  if (!managersWithPicks.length) return null;

  const withRound1 = managersWithPicks
    .map((m) => ({ ...m, round1Pick: m.picks.find((p) => p.round === 1) }))
    .filter((m) => m.round1Pick)
    .sort((a, b) => a.round1Pick.pickInRound - b.round1Pick.pickInRound);
  // Anyone somehow missing a Round 1 pick (an incomplete/odd draft record)
  // still gets a column, just appended at the end rather than silently
  // dropped from the board.
  const round1UserIds = new Set(withRound1.map((m) => m.userId));
  const withoutRound1 = managersWithPicks.filter((m) => !round1UserIds.has(m.userId));
  const columns = [...withRound1, ...withoutRound1];

  const allPicks = managersWithPicks.flatMap((m) => m.picks.map((p) => ({ ...p, ownerUsername: m.username || m.teamName })));
  const maxRound = Math.max(1, ...allPicks.map((p) => p.round || 1));
  const rounds = [];
  for (let r = 1; r <= maxRound; r++) {
    rounds.push({
      round: r,
      cells: columns.map((col) => col.picks.find((p) => p.round === r) || null),
    });
  }
  return { columns, rounds, allPicks: [...allPicks].sort((a, b) => (a.pickNo || 0) - (b.pickNo || 0)) };
}

function posClassFor(position) {
  const known = ["QB", "RB", "WR", "TE", "K", "DEF"];
  return `pos-${(known.includes(position) ? position : "other").toLowerCase()}`;
}

// Best 5 picks of the draft board, ranked by letter grade first (S
// before A before B, ...) and then by VBD as a tiebreaker within the
// same grade, since a whole handful of picks commonly share a grade.
// Ungraded picks (no player points on record, or graded on too few
// picks league-wide to mean anything) are excluded rather than sorting
// to the bottom, since an ungraded pick isn't a "worse" pick, just an
// unranked one.
function topPicksForBoard(board) {
  return [...board.allPicks]
    .filter((p) => p.grade)
    .sort((a, b) => GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade) || (b.vbd || 0) - (a.vbd || 0))
    .slice(0, 5);
}

function renderTopPicks(picks) {
  if (!picks.length) return "";
  const rows = picks
    .map(
      (p) => `
    <tr>
      <td data-label="Pick">${p.round}.${p.pickInRound}</td>
      <td class="team-cell player-cell" data-label="Player">${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.player, "player-photo-xs"))}<span>${playerLinkHtml(p.playerId, escapeHtml(p.player))}${
        p.position ? ` <span class="muted-inline">(${escapeHtml(p.position)})</span>` : ""
      }</span></td>
      <td data-label="Drafted By">${escapeHtml(p.ownerUsername)}</td>
      <td data-label="Grade">${gradeBadgeHtml(p.grade)}</td>
      <td data-label="Points">${p.points.toFixed(1)} pts${p.vbd != null ? ` <span class="muted-inline">· ${p.vbd >= 0 ? "+" : ""}${p.vbd.toFixed(1)} VBD</span>` : ""}</td>
    </tr>`
    )
    .join("");
  return `
    <div class="wrap">
      <div class="panel">
        <h2>Top 5 Picks</h2>
        <div class="heatmap-table-wrap stay-scrollable">
          <table class="stat-table compact-mobile">
            <thead><tr><th>Pick</th><th>Player</th><th>Drafted By</th><th>Grade</th><th>Points</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function renderDraftCell(pick) {
  if (!pick) return `<td class="draft-cell draft-cell-empty"></td>`;
  const gradeClass = pick.grade === "S" ? " draft-cell-s-grade" : pick.grade === "A" ? " draft-cell-a-grade" : "";
  return `
    <td class="draft-cell ${posClassFor(pick.position)}${gradeClass}" data-player-id="${escapeHtml(pick.playerId || "")}">
      <div class="draft-cell-pick">${pick.round}.${pick.pickInRound}</div>
      <div class="draft-cell-player">${playerLinkHtml(pick.playerId, escapeHtml(pick.player))}</div>
      <div class="draft-cell-meta"><span class="draft-cell-pos">${escapeHtml(pick.position || "")}</span>${gradeBadgeHtml(pick.grade)}</div>
    </td>`;
}

function renderDraftBoardTable(board) {
  const header = board.columns.map((c) => `<th>${escapeHtml(c.username || c.teamName)}</th>`).join("");
  const rows = board.rounds
    .map((r) => `<tr><td class="draft-round-label">Rd ${r.round}</td>${r.cells.map(renderDraftCell).join("")}</tr>`)
    .join("");
  return `
    <div class="draft-board-wrap">
      <table class="draft-board">
        <thead><tr><td class="draft-round-label"></td>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderSelectedDraft() {
  const content = document.getElementById("draft-content");
  const season = decodeURIComponent(location.hash.replace(/^#/, ""));
  const entry = SEASON_CHAIN.find((e) => String(e.league.season) === season);
  document.getElementById("sb-sub").textContent = entry
    ? `${season} Season — every pick, color-coded by position.`
    : "Every pick, every season, color-coded by position.";

  const board = buildDraftBoard(season);
  content.style.display = "";
  if (!board) {
    content.innerHTML = `
      <div class="wrap">
        <div class="empty-state">No draft data recorded for ${escapeHtml(season)}.</div>
      </div>`;
    return;
  }

  content.innerHTML = `
    <div class="wrap">
      <div class="draft-legend">
        ${["QB", "RB", "WR", "TE", "K", "DEF"].map((pos) => `<span class="draft-legend-item"><span class="draft-legend-swatch ${posClassFor(pos)}"></span>${pos}</span>`).join("")}
        <span class="draft-legend-item"><span class="draft-cell-s-grade-sample"></span>S grade</span>
        <span class="draft-legend-item"><span class="draft-cell-a-grade-sample"></span>A grade</span>
      </div>
    </div>
    ${renderTopPicks(topPicksForBoard(board))}
    <div class="wrap-wide">${renderDraftBoardTable(board)}</div>`;

  initScrollAnimations();
}

document.addEventListener("DOMContentLoaded", renderDraftPage);
