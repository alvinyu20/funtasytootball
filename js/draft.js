let SEASON_CHAIN = null;
let PLAYER_DIRECTORY = null;
let LEAGUE_STATS = null;

async function renderDraftPage() {
  const errorBox = document.getElementById("draft-error");
  const progressBox = document.getElementById("progress-status");

  try {
    const [seasonChain, playerDirectory] = await Promise.all([SleeperAPI.getSeasonChain(LEAGUE_ID), SleeperAPI.getPlayerDirectory()]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load the league's seasons from Sleeper. Give it a minute and refresh the page.");
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
      const defaultSeason = pickDefaultSeason(seasonChain);
      if (defaultSeason) location.hash = `#${defaultSeason}`;
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
// Which season the page opens to when the visitor hasn't picked one via
// the URL hash. Prefers the newest season that actually has a draft on
// record — not strictly the newest *complete* season — since a current,
// in-progress season's draft already happened before Week 1: a visitor
// checking this page mid-season should land on this year's draft, not
// last year's. Falls back further back in time only for a season that
// genuinely has no draft picks logged yet (e.g. the upcoming season
// before its draft has actually run), and ultimately to the newest
// season in the chain if somehow none of them have draft data at all,
// so the page always has something to select rather than nothing.
function pickDefaultSeason(seasonChain) {
  if (!seasonChain.length) return null;
  const newestFirst = [...seasonChain].reverse();
  const withDraft = newestFirst.find((e) => buildDraftBoard(e.league.season));
  return (withDraft || seasonChain[seasonChain.length - 1]).league.season;
}

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
    <div class="scroll-hint-caption">← Scroll to see every team's board →</div>
    <div class="draft-board-wrap">
      <table class="draft-board">
        <thead><tr><td class="draft-round-label"></td>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---------------------------------------------------------------
// Three ways to read the same board. The grid is the real draft board (one
// column per team) and is the right view on a wide screen; on a phone it
// shows about two teams at a time, so the page opens on a list instead:
// "By round" (the pick order, round by round) or "By team" (each team's
// whole draft, top to bottom).
// ---------------------------------------------------------------
const DRAFT_VIEWS = ["grid", "round", "team"];
const DRAFT_VIEW_KEY = "funtasy.draftView";
const DRAFT_VIEW_LABELS = { grid: "Board", round: "By round", team: "By team" };

function defaultDraftView(viewportWidth) {
  return viewportWidth != null && viewportWidth <= 720 ? "round" : "grid";
}

function readDraftView() {
  let saved = null;
  try {
    saved = localStorage.getItem(DRAFT_VIEW_KEY);
  } catch (err) {
    // storage blocked: just use the default
  }
  if (DRAFT_VIEWS.includes(saved)) return saved;
  return defaultDraftView(typeof window !== "undefined" ? window.innerWidth : null);
}

function saveDraftView(view) {
  try {
    localStorage.setItem(DRAFT_VIEW_KEY, view);
  } catch (err) {
    // fine: the choice just lasts for this visit
  }
}

function draftViewToggleHtml(active) {
  return `
    <div class="view-toggle" role="tablist" aria-label="Draft board view">
      ${DRAFT_VIEWS.map(
        (v) => `<button type="button" role="tab" class="view-toggle-btn${v === active ? " active" : ""}" data-draft-view="${v}" aria-selected="${v === active ? "true" : "false"}">${DRAFT_VIEW_LABELS[v]}</button>`
      ).join("")}
    </div>`;
}

function draftListRowHtml(p, owner) {
  const gradeClass = p.grade === "S" ? " draft-cell-s-grade" : p.grade === "A" ? " draft-cell-a-grade" : "";
  return `
      <div class="draft-list-row${gradeClass}"${owner ? ` data-username="${escapeHtml(owner)}"` : ""}>
        <span class="draft-list-pick">${p.round}.${p.pickInRound}</span>
        <span class="draft-list-pos ${posClassFor(p.position)}">${escapeHtml(p.position || "")}</span>
        <span class="draft-list-player">${playerLinkHtml(p.playerId, escapeHtml(p.player))}</span>
        <span class="draft-list-grade">${gradeBadgeHtml(p.grade)}</span>
        ${owner ? `<span class="draft-list-owner">${escapeHtml(owner)}</span>` : ""}
      </div>`;
}

// By round: Round 1 pick 1 to the last pick, each round under its own heading.
function renderDraftByRound(board) {
  const byRound = new Map();
  board.allPicks.forEach((p) => {
    if (!byRound.has(p.round)) byRound.set(p.round, []);
    byRound.get(p.round).push(p);
  });
  return [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([round, picks]) => `
    <section class="draft-list-group">
      <h3 class="draft-list-heading">Round ${round}</h3>
      ${picks.sort((a, b) => (a.pickNo || 0) - (b.pickNo || 0)).map((p) => draftListRowHtml(p, p.ownerUsername)).join("")}
    </section>`
    )
    .join("");
}

// By team: every team's picks in round order. The first team is open; the rest fold away.
function renderDraftByTeam(board) {
  const me = typeof MyTeam !== "undefined" ? MyTeam.normalize(MyTeam.get()) : "";
  const names = board.columns.map((c) => c.username || c.teamName);
  const openIdx = Math.max(0, names.findIndex((n) => me && MyTeam.normalize(n) === me));
  return board.columns
    .map((col, i) => {
      const name = names[i];
      const picks = [...col.picks].sort((a, b) => (a.round || 0) - (b.round || 0));
      return `
    <details class="draft-list-group draft-team"${i === openIdx ? " open" : ""}>
      <summary><span class="draft-team-name" data-username="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="draft-team-count">${picks.length} picks</span></summary>
      ${picks.map((p) => draftListRowHtml(p, null)).join("")}
    </details>`;
    })
    .join("");
}

function draftViewBodyHtml(board, view) {
  if (view === "round") return `<div class="draft-list">${renderDraftByRound(board)}</div>`;
  if (view === "team") return `<div class="draft-list">${renderDraftByTeam(board)}</div>`;
  return renderDraftBoardTable(board);
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

  const view = readDraftView();
  content.innerHTML = `
    <div class="wrap">
      <div class="draft-legend">
        ${["QB", "RB", "WR", "TE", "K", "DEF"].map((pos) => `<span class="draft-legend-item"><span class="draft-legend-swatch ${posClassFor(pos)}"></span>${pos}</span>`).join("")}
        <span class="draft-legend-item"><span class="draft-cell-s-grade-sample"></span>S grade</span>
        <span class="draft-legend-item"><span class="draft-cell-a-grade-sample"></span>A grade</span>
      </div>
    </div>
    ${renderTopPicks(topPicksForBoard(board))}
    <div class="wrap-wide draft-view">
      ${draftViewToggleHtml(view)}
      <div id="draft-view-body">${draftViewBodyHtml(board, view)}</div>
    </div>`;

  content.querySelectorAll("[data-draft-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-draft-view");
      saveDraftView(next);
      renderSelectedDraft();
    });
  });
  initScrollAnimations();
}

document.addEventListener("DOMContentLoaded", renderDraftPage);
