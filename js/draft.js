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
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : `Fetching ${season}…`;
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

  const allPicks = managersWithPicks.flatMap((m) => m.picks);
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

function renderDraftCell(pick) {
  if (!pick) return `<td class="draft-cell draft-cell-empty"></td>`;
  const gradeClass = pick.grade === "S" ? " draft-cell-s-grade" : pick.grade === "A" ? " draft-cell-a-grade" : "";
  return `
    <td class="draft-cell ${posClassFor(pick.position)}${gradeClass}" data-player-id="${escapeHtml(
    pick.playerId || ""
  )}" data-pick-no="${pick.pickNo}">
      <div class="draft-cell-pick">${pick.round}.${pick.pickInRound}</div>
      <div class="draft-cell-player">${escapeHtml(pick.player)}</div>
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
    ${renderDraftReplaySection(board)}
    <div class="wrap">${renderDraftBoardTable(board)}</div>`;

  initDraftReplay(board);

  initScrollAnimations();
}

let DRAFT_REPLAY_TIMER = null;
let DRAFT_REPLAY_PICKS = [];
let DRAFT_REPLAY_INDEX = 0; // how many picks are currently revealed

function renderDraftReplaySection(board) {
  return `
    <div class="wrap"><div class="panel">
      <h2>Draft Replay</h2>
      <div class="replay-controls">
        <button class="replay-btn" id="draft-replay-play-btn" type="button">▶ Play</button>
        <input type="range" class="replay-slider" id="draft-replay-slider" min="0" max="${board.allPicks.length}" value="${board.allPicks.length}" />
        <button class="replay-btn" id="draft-replay-show-all-btn" type="button">Show All</button>
        <span class="replay-week-label" id="draft-replay-label"></span>
      </div>
      <p class="heatmap-note">Step or play through the draft pick by pick, in the order it actually happened — or just browse the full board below.</p>
    </div></div>`;
}

function initDraftReplay(board) {
  stopDraftReplay();
  DRAFT_REPLAY_PICKS = board.allPicks;
  DRAFT_REPLAY_INDEX = DRAFT_REPLAY_PICKS.length; // start fully revealed — replay is opt-in, not the default view

  const slider = document.getElementById("draft-replay-slider");
  const playBtn = document.getElementById("draft-replay-play-btn");
  const showAllBtn = document.getElementById("draft-replay-show-all-btn");
  if (!slider || !playBtn || !DRAFT_REPLAY_PICKS.length) return;

  renderDraftReplayState(DRAFT_REPLAY_INDEX);

  slider.oninput = () => {
    stopDraftReplay();
    DRAFT_REPLAY_INDEX = Number(slider.value);
    renderDraftReplayState(DRAFT_REPLAY_INDEX);
  };
  showAllBtn.onclick = () => {
    stopDraftReplay();
    DRAFT_REPLAY_INDEX = DRAFT_REPLAY_PICKS.length;
    renderDraftReplayState(DRAFT_REPLAY_INDEX);
  };
  playBtn.onclick = () => {
    if (DRAFT_REPLAY_TIMER) {
      stopDraftReplay();
      return;
    }
    if (DRAFT_REPLAY_INDEX >= DRAFT_REPLAY_PICKS.length) DRAFT_REPLAY_INDEX = 0; // restart from the beginning if replaying after reaching the end
    playBtn.textContent = "⏸ Pause";
    DRAFT_REPLAY_TIMER = setInterval(() => {
      DRAFT_REPLAY_INDEX += 1;
      if (DRAFT_REPLAY_INDEX > DRAFT_REPLAY_PICKS.length) {
        stopDraftReplay();
        DRAFT_REPLAY_INDEX = DRAFT_REPLAY_PICKS.length;
        return;
      }
      renderDraftReplayState(DRAFT_REPLAY_INDEX);
    }, 500);
  };
}

function stopDraftReplay() {
  if (DRAFT_REPLAY_TIMER) {
    clearInterval(DRAFT_REPLAY_TIMER);
    DRAFT_REPLAY_TIMER = null;
  }
  const playBtn = document.getElementById("draft-replay-play-btn");
  if (playBtn) playBtn.textContent = "▶ Play";
}

function renderDraftReplayState(revealedCount) {
  const slider = document.getElementById("draft-replay-slider");
  const label = document.getElementById("draft-replay-label");
  if (slider) slider.value = revealedCount;

  const revealedPickNos = new Set(DRAFT_REPLAY_PICKS.slice(0, revealedCount).map((p) => p.pickNo));
  document.querySelectorAll(".draft-cell[data-pick-no]").forEach((cell) => {
    const pickNo = Number(cell.dataset.pickNo);
    const shouldShow = revealedPickNos.has(pickNo);
    const wasShown = cell.classList.contains("draft-cell-revealed");
    cell.classList.toggle("draft-cell-revealed", shouldShow);
    cell.classList.toggle("draft-cell-hidden", !shouldShow);
    cell.classList.remove("draft-cell-on-clock");
    if (shouldShow && !wasShown) {
      // Restart the pop-in animation cleanly even if it's still
      // mid-transition from a fast scrub — remove the class, force a
      // reflow, then re-add it, same technique used for the chart
      // draw-in and dropdown animations elsewhere on the site.
      cell.classList.remove("draft-cell-pop-in");
      void cell.offsetWidth;
      cell.classList.add("draft-cell-pop-in");
    }
  });

  if (label) {
    if (revealedCount >= DRAFT_REPLAY_PICKS.length) {
      label.textContent = "Draft complete";
    } else {
      const next = DRAFT_REPLAY_PICKS[revealedCount];
      const nextCell = document.querySelector(`.draft-cell[data-pick-no="${next.pickNo}"]`);
      if (nextCell) nextCell.classList.add("draft-cell-on-clock");
      label.textContent = `On the clock: Pick ${next.round}.${next.pickInRound} (${next.teamName || next.username})`;
    }
  }
}

document.addEventListener("DOMContentLoaded", renderDraftPage);
