let SEASON_CHAIN = null;
let PLAYER_DIRECTORY = null;
let SEASON_AWARDS = null;
let POWER_RANK_CSV_HISTORY = null;
let ALL_TIME_STATS_CACHE = null; // computed lazily, once per page load — see getAllTimeStats()

/*
  Powers the Season Summary's "records set this season" callouts, and the
  draft grade model (which needs every pick in league history to fit a
  meaningful expected-VBD-by-pick curve). This needs every season's data,
  not just the one being viewed, so it's kept separate from the fast
  single-season fetch and only triggered when a completed season is
  actually being displayed (the only time either is used). Cached for the
  rest of this page visit so switching between completed seasons doesn't
  redo the work each time.
*/
async function getAllTimeStats() {
  if (ALL_TIME_STATS_CACHE) return ALL_TIME_STATS_CACHE;
  const deepSeasons = await DeepHistory.buildAll(SEASON_CHAIN, () => {});
  ALL_TIME_STATS_CACHE = DeepHistory.computeStats(SEASON_CHAIN, deepSeasons, PLAYER_DIRECTORY);
  return ALL_TIME_STATS_CACHE;
}

async function renderSeasonPage() {
  const errorBox = document.getElementById("season-error");
  try {
    const [seasonChain, playerDirectory, seasonAwards, powerRankCsvHistory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(SEASON_AWARDS_FILE, { seasons: {} }),
      fetchJsonSafe(POWER_RANK_CSV_HISTORY_FILE, { seasons: {} }),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    SEASON_CHAIN = seasonChain;
    PLAYER_DIRECTORY = playerDirectory;
    SEASON_AWARDS = seasonAwards;
    POWER_RANK_CSV_HISTORY = powerRankCsvHistory;

    await renderSelectedSeason();
    window.addEventListener("hashchange", renderSelectedSeason);
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't load season data — " + err.message;
    errorBox.style.display = "block";
  }
}

function isTotalSelected() {
  return decodeURIComponent(location.hash.replace(/^#/, "")) === "total";
}

function getSelectedSeasonEntry() {
  const hashYear = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (hashYear && hashYear !== "total") {
    const match = SEASON_CHAIN.find((s) => String(s.league.season) === hashYear);
    if (match) return match;
  }
  return SEASON_CHAIN[SEASON_CHAIN.length - 1]; // default to most recent
}

function renderPicker(selectedKey) {
  const picker = document.getElementById("season-picker");
  const totalPill = `<a class="season-pill ${selectedKey === "total" ? "active" : ""}" href="#total">TOTAL</a>`;
  const yearPills = [...SEASON_CHAIN]
    .reverse() // newest first
    .map((s) => {
      const year = s.league.season;
      const isActive = String(year) === String(selectedKey);
      return `<a class="season-pill ${isActive ? "active" : ""}" href="#${year}">${year}</a>`;
    })
    .join("");
  picker.innerHTML = totalPill + yearPills;
}

async function renderSelectedSeason() {
  const errorBox = document.getElementById("season-error");
  const content = document.getElementById("season-content");
  const progressBox = document.getElementById("progress-status");

  try {
    if (isTotalSelected()) {
      renderPicker("total");
      content.style.display = "none";
      errorBox.style.display = "none";
      progressBox.style.display = "block";

      const deepSeasons = await DeepHistory.buildAll(SEASON_CHAIN, (season, status) => {
        progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : `Fetching ${season}…`;
      });

      const summary = DeepHistory.computeTotalSummary(SEASON_CHAIN, deepSeasons, PLAYER_DIRECTORY);

      progressBox.style.display = "none";
      content.style.display = "";
      content.innerHTML = renderSummary(summary);
      stopReplay();

      const leagueName = SEASON_CHAIN[SEASON_CHAIN.length - 1].league.name;
      document.title = (SITE_TITLE || leagueName || "League") + " — All-Time";
      document.getElementById("sb-title").textContent = "All-Time";
      document.getElementById("sb-sub").textContent = `${SEASON_CHAIN.length} season${SEASON_CHAIN.length === 1 ? "" : "s"} combined`;
      return;
    }

    const seasonEntry = getSelectedSeasonEntry();
    renderPicker(seasonEntry.league.season);

    content.style.display = "none";
    errorBox.style.display = "none";
    progressBox.style.display = "block";
    progressBox.textContent = `Loading ${seasonEntry.league.season}…`;

    const deep = await DeepHistory.fetchSeasonDeep(seasonEntry, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : `Fetching ${season}…`;
    });

    let allTimeStats = null;
    if (seasonEntry.league.status === "complete") {
      progressBox.style.display = "block";
      progressBox.textContent = "Checking league records…";
      allTimeStats = await getAllTimeStats();
    }

    const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, PLAYER_DIRECTORY, allTimeStats ? allTimeStats.draftGradeModel : null);
    if (allTimeStats) summary.allTimeRecords = allTimeStats.records;

    progressBox.style.display = "none";
    content.style.display = "";
    content.innerHTML = renderSummary(summary);
    initStandingsReplay(summary.standingsHistory, summary.playoffTeams);

    const leagueName = SEASON_CHAIN[SEASON_CHAIN.length - 1].league.name;
    document.title = (SITE_TITLE || leagueName || "League") + " — " + summary.season + " Season";
    document.getElementById("sb-title").textContent = summary.season + " Season";
    document.getElementById("sb-sub").textContent =
      summary.status === "complete" ? `${summary.weeksPlayed} weeks played` : `In progress · ${summary.weeksPlayed} weeks so far`;
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load that view — " + err.message;
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

function recordCardWithPhoto(label, playerId, playerName, detail, badge) {
  return `
    <div class="record-card record-card-photo">
      ${playerPhotoHtml(playerId, playerName, "player-photo-sm")}
      <div>
        <p class="record-label">${escapeHtml(label)}${badge ? ` ${badge}` : ""}</p>
        <p class="record-value record-value-photo">${escapeHtml(playerName)}</p>
        ${detail ? `<p class="record-detail">${detail}</p>` : ""}
      </div>
    </div>`;
}

function lineupRows(lineup) {
  return lineup
    .map(
      (p) => `
      <div class="draft-pick-row">
        <span>${escapeHtml(p.slot)}</span>
        <span class="pick-player">${escapeHtml(p.player)}</span>
        <span class="pick-points">${p.points.toFixed(1)}</span>
      </div>`
    )
    .join("");
}

function lineupSectionsHtml(sections) {
  return sections
    .filter((s) => s.lineup && s.lineup.length)
    .map((s) => `<div class="bracket-lineup-team-name">${escapeHtml(s.teamName)}</div>${lineupRows(s.lineup)}`)
    .join("");
}

// Same as recordCard, but expandable to reveal one team's starting lineup
// for that week. Falls back to a plain (non-expandable) card if there's
// no lineup data to show.
function expandableRecordCard(label, value, detail, lineupSections) {
  const hasLineup = lineupSections.some((s) => s.lineup && s.lineup.length);
  if (!hasLineup) return recordCard(label, value, detail);
  return `
    <details class="record-card record-card-expandable">
      <summary>
        <span class="record-label">${escapeHtml(label)}</span>
        <span class="record-value">${value}</span>
        ${detail ? `<span class="record-detail">${detail}</span>` : ""}
      </summary>
      <div class="bracket-lineup-section">${lineupSectionsHtml(lineupSections)}</div>
    </details>`;
}

function renderPositionTable(positionTable) {
  if (!positionTable.columns.length || !positionTable.rows.length) {
    return `<div class="empty-state">No lineup data available for this season.</div>`;
  }

  // Standardize each column independently: min/max computed only within that column.
  const ranges = {};
  positionTable.columns.forEach((col) => {
    const values = positionTable.rows.map((r) => r.cells[col.key]).filter((v) => v != null);
    ranges[col.key] = { min: Math.min(...values), max: Math.max(...values) };
  });

  const header = positionTable.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");

  const rows = positionTable.rows
    .map((r) => {
      const cells = positionTable.columns
        .map((col) => {
          const v = r.cells[col.key];
          if (v == null) return `<td class="heat-cell empty" data-label="${escapeHtml(col.label)}">—</td>`;
          const { min, max } = ranges[col.key];
          const bg = heatColor(v, min, max);
          return `<td class="heat-cell" data-label="${escapeHtml(col.label)}" style="background:${bg}">${v.toFixed(1)}</td>`;
        })
        .join("");
      return `<tr><td class="team-cell">${escapeHtml(r.teamName)}</td>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="heatmap-table-wrap">
      <table class="stat-table responsive-stack">
        <thead><tr><th>Team</th>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="heatmap-note">Each column is colored independently — gold is that column's best, rust is its worst.</p>`;
}

function renderFaabList(items, isTotal) {
  if (!items.length) return `<div class="empty-state">Not enough games played yet.</div>`;
  return `<div class="rank-list">${items
    .map(
      (p, i) => `
    <div class="rank-list-row faab-row">
      <span class="rank-num">${i + 1}</span>
      ${playerPhotoHtml(p.playerId, p.player, "player-photo-sm")}
      <span class="desc">${escapeHtml(p.player)}<span class="sub">${escapeHtml(p.teamName)}${p.week ? ` · Week ${p.week}` : ""}${
        isTotal && p.season ? ` · ${p.season}` : ""
      }</span></span>
      <span class="val">$${p.bid}</span>
    </div>`
    )
    .join("")}</div>`;
}

function renderRankList(items, describe, getLineupSections) {
  if (!items.length) return `<div class="empty-state">Not enough games played yet.</div>`;
  return `<div class="rank-list">${items
    .map((item, i) => {
      const d = describe(item);
      const summary = `
      <span class="rank-num">${i + 1}</span>
      <span class="desc">${d.main}<span class="sub">${d.sub}</span></span>
      <span class="val">${d.value}</span>`;

      const sections = getLineupSections ? getLineupSections(item) : null;
      const hasLineup = sections && sections.some((s) => s.lineup && s.lineup.length);
      if (!hasLineup) {
        return `<div class="rank-list-row">${summary}</div>`;
      }
      return `
      <details class="rank-list-item">
        <summary class="rank-list-row">${summary}</summary>
        <div class="bracket-lineup-section">${lineupSectionsHtml(sections)}</div>
      </details>`;
    })
    .join("")}</div>`;
}

function renderBracket(bracketData) {
  if (!bracketData || !bracketData.rounds.length) {
    return `<div class="empty-state">No bracket yet — check back once the playoffs start.</div>`;
  }

  const columns = bracketData.rounds
    .map((round) => {
      const games = round.games
        .map((g) => {
          const label = g.specialLabel ? `<span class="bracket-game-label">${escapeHtml(g.specialLabel)}</span>` : "";
          const teamRow = (team) => `
          <span class="bracket-team ${team.isWinner ? "winner" : ""}">
            <span>${escapeHtml(team.name)}</span>
            ${team.score != null ? `<span class="bracket-score">${team.score.toFixed(1)}</span>` : ""}
          </span>`;
          const hasLineups = g.team1.lineup.length || g.team2.lineup.length;
          const lineupSection = hasLineups
            ? `<div class="bracket-lineup-section">${lineupSectionsHtml([
                { teamName: g.team1.name, lineup: g.team1.lineup },
                { teamName: g.team2.name, lineup: g.team2.lineup },
              ])}</div>`
            : "";
          return `
          <details class="bracket-game${g.isChampionship ? " championship" : ""}">
            <summary>${label}${teamRow(g.team1)}${teamRow(g.team2)}</summary>
            ${lineupSection}
          </details>`;
        })
        .join("");
      return `
      <div class="bracket-round">
        <div class="bracket-round-label">${escapeHtml(round.label)}</div>
        ${games}
      </div>`;
    })
    .join("");

  const championSidebar = bracketData.champion
    ? `
    <div class="bracket-sidebar">
      <div class="bracket-sidebar-label">Champion</div>
      <div class="bracket-sidebar-value">🏆 ${escapeHtml(bracketData.champion.name)}</div>
      ${
        bracketData.champion.mvp
          ? `
      <div class="bracket-sidebar-label" style="margin-top:20px;">Finals MVP</div>
      <div class="player-rep-card" style="gap:12px; margin-top:8px;">
        ${playerPhotoHtml(bracketData.champion.mvp.playerId, bracketData.champion.mvp.player, "player-photo-sm")}
        <div>
          <div class="bracket-sidebar-value" style="font-size:15px;">${escapeHtml(bracketData.champion.mvp.player)}</div>
          <div class="bracket-sidebar-sub">${bracketData.champion.mvp.points.toFixed(1)} pts</div>
        </div>
      </div>`
          : ""
      }
    </div>`
    : "";

  return `<div class="bracket-wrap"><div class="bracket">${columns}</div>${championSidebar}</div>`;
}

let REPLAY_TIMER = null;
let REPLAY_WEEK_INDEX = 0;
let REPLAY_SNAPSHOTS = [];
const REPLAY_ROW_HEIGHT = 36;

// Deterministic hash so the SAME season always gets the SAME phrasing on
// repeat visits (not randomized fresh every page load), while different
// seasons naturally land on different variants.
function seasonSeed(season) {
  let hash = 0;
  const str = String(season);
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return hash;
}

const RECAP_INTRO_VARIANTS = [
  (record, seed) => `went ${record} in the regular season${seed ? ` as the #${seed} seed` : ""}, then `,
  (record, seed) => `put together a ${record} regular season${seed ? ` (the #${seed} seed)` : ""}, then `,
  (record, seed) => `finished the regular season ${record}${seed ? `, locking up the #${seed} seed` : ""}, then `,
  (record, seed) => `cruised to a ${record} record in the regular season${seed ? ` as the #${seed} seed` : ""}, then `,
];

const RECAP_RUN_VARIANTS = {
  1: [(r) => `won the championship over ${r}`, (r) => `took home the title with a win over ${r}`],
  2: [
    (r) => `rolled through the playoffs and beat ${r} in the Championship`,
    (r) => `powered through two playoff rounds, finishing off ${r} in the Championship`,
    (r) => `made quick work of the playoffs, beating ${r} for the title`,
  ],
  default: [
    (r, n) => `ran the table through a ${n}-round playoff bracket, capping it off with a win over ${r} in the Championship`,
    (r, n) => `battled through ${n} rounds of playoffs before beating ${r} to win it all`,
    (r, n) => `survived a grueling ${n}-round playoff run, sealing the title against ${r} in the Championship`,
  ],
};

function championshipNarrative(c) {
  const seed = seasonSeed(c.teamName + "|" + (c.runnerUpName || ""));
  const teamName = `<strong>${escapeHtml(c.teamName)}</strong>`;
  const runnerUp = c.runnerUpName ? `<strong>${escapeHtml(c.runnerUpName)}</strong>` : "the field";

  const introText = c.regularSeasonRecord
    ? RECAP_INTRO_VARIANTS[seed % RECAP_INTRO_VARIANTS.length](escapeHtml(c.regularSeasonRecord), c.seed)
    : "";

  const roundsKey = !c.roundsPlayed || c.roundsPlayed <= 1 ? 1 : c.roundsPlayed === 2 ? 2 : "default";
  const runVariants = RECAP_RUN_VARIANTS[roundsKey];
  const runText = runVariants[seed % runVariants.length](runnerUp, c.roundsPlayed);

  return `${teamName} ${introText}${runText}.`;
}

const RECAP_MVP_DRAFT_VARIANTS = [
  (player, round) => `${player}, a Round ${round} pick, was the engine behind it all — the team's top performer from the draft all the way to the championship.`,
  (player, round) => `${player} proved to be a steal in Round ${round}, turning into the team's top performer all year.`,
  (player, round) => `Drafted in Round ${round}, ${player} developed into the team's offensive centerpiece from day one.`,
];
const RECAP_MVP_VARIANTS = [
  (player) => `${player} was the engine behind it all — the team's top performer all season long.`,
  (player) => `${player} carried the load all year as the team's clear top scorer.`,
  (player) => `No player meant more to this team's season than ${player}, its top scorer from Week 1 through the championship.`,
];

function championshipMvpNarrative(c) {
  if (!c.seasonMVP) return "";
  const seed = seasonSeed(c.teamName + "|" + c.seasonMVP.player);
  const player = `<strong>${escapeHtml(c.seasonMVP.player)}</strong>`;
  if (c.mvpDraftRound) {
    return RECAP_MVP_DRAFT_VARIANTS[seed % RECAP_MVP_DRAFT_VARIANTS.length](player, c.mvpDraftRound);
  }
  return RECAP_MVP_VARIANTS[seed % RECAP_MVP_VARIANTS.length](player);
}

function buildSeasonRecordHighlights(records, season) {
  if (!records) return [];
  const seasonStr = String(season);
  const matches = (entry) => entry && String(entry.season) === seasonStr;
  const name = (entry, field) => escapeHtml(entry[`${field}Username`] || entry[field] || "Unknown");
  const highlights = [];

  if (matches(records.mostRegularSeasonPoints)) {
    const r = records.mostRegularSeasonPoints;
    highlights.push(
      `<strong>${escapeHtml(r.username || r.teamName)}</strong> put up the highest-scoring regular season in league history${
        r.topScorer ? `, powered by <strong>${escapeHtml(r.topScorer.player)}</strong>` : ""
      }.`
    );
  }
  if (matches(records.fewestRegularSeasonPoints)) {
    const r = records.fewestRegularSeasonPoints;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> had the lowest-scoring regular season in league history.`);
  }
  if (matches(records.highestWeekScore)) {
    const r = records.highestWeekScore;
    highlights.push(
      `<strong>${escapeHtml(r.username || r.teamName)}</strong> put up the highest single-week score in league history${
        r.topScorer ? `, led by <strong>${escapeHtml(r.topScorer.player)}</strong>` : ""
      }.`
    );
  }
  if (matches(records.lowestWeekScore)) {
    const r = records.lowestWeekScore;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> turned in the lowest single-week score in league history.`);
  }
  if (matches(records.biggestBlowout)) {
    const r = records.biggestBlowout;
    highlights.push(`<strong>${name(r, "winner")}</strong> handed <strong>${name(r, "loser")}</strong> the biggest blowout in league history.`);
  }
  if (matches(records.closestGame)) {
    const r = records.closestGame;
    highlights.push(`<strong>${name(r, "winner")}</strong> and <strong>${name(r, "loser")}</strong> played the closest game in league history.`);
  }
  if (matches(records.mostBenchPointsLeft)) {
    const r = records.mostBenchPointsLeft;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> left more points on the bench in a single week than anyone else, ever.`);
  }
  if (matches(records.mostConsistentSeason)) {
    const r = records.mostConsistentSeason;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> was the most consistent scoring team of any season in league history.`);
  }
  if (matches(records.leastConsistentSeason)) {
    const r = records.leastConsistentSeason;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> was the most boom-or-bust team of any season in league history.`);
  }
  if (matches(records.toughestSchedule)) {
    const r = records.toughestSchedule;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> faced the toughest schedule of any season in league history.`);
  }
  if (matches(records.easiestSchedule)) {
    const r = records.easiestSchedule;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> had the easiest schedule of any season in league history.`);
  }
  if (matches(records.bestValuePick)) {
    const r = records.bestValuePick;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> landed the best draft steal in league history: <strong>${escapeHtml(r.player)}</strong>.`);
  }
  if (matches(records.worstValuePick)) {
    const r = records.worstValuePick;
    highlights.push(`<strong>${escapeHtml(r.username || r.teamName)}</strong> had the biggest draft bust in league history: <strong>${escapeHtml(r.player)}</strong>.`);
  }

  return highlights;
}

function seasonStatCard(label, stat, subFormatter) {
  if (!stat) return "";
  return `
    <div class="recap-player-card">
      ${playerPhotoHtml(stat.playerId, stat.player, "player-photo-lg")}
      <div class="recap-player-label">${escapeHtml(label)} ${gradeBadgeHtml(stat.grade)}</div>
      <div class="recap-player-name">${escapeHtml(stat.player)}</div>
      <div class="recap-player-sub">${escapeHtml(subFormatter(stat))}</div>
    </div>`;
}

function renderChampionshipRecap(recap, allTimeRecords, seasonStats) {
  const c = recap && recap.champion;
  const stats = seasonStats || {};
  const hasSeasonStats = stats.bestValuePick || stats.worstValuePick || stats.pointsLeader;
  if (!c && !hasSeasonStats) return "";

  const highlights = c ? buildSeasonRecordHighlights(allTimeRecords, recap.season) : [];
  const season = recap ? recap.season : stats.pointsLeader ? stats.pointsLeader.season : "";

  const mvpHtml =
    c && c.seasonMVP
      ? `
    <div class="recap-player-card">
      ${playerPhotoHtml(c.seasonMVP.playerId, c.seasonMVP.player, "player-photo-lg")}
      <div class="recap-player-label">Season MVP</div>
      <div class="recap-player-name">${escapeHtml(c.seasonMVP.player)}</div>
    </div>`
      : "";

  const statCardsHtml = [
    seasonStatCard("Season Points Leader", stats.pointsLeader, (s) => `${s.points.toFixed(1)} total points`),
    seasonStatCard(
      "Best Draft Steal",
      stats.bestValuePick,
      (s) => `Rd ${s.round} Pick ${s.pickNo} by ${s.username || s.teamName}${s.vbd != null ? ` · +${s.vbd.toFixed(1)} VBD` : ""}`
    ),
    seasonStatCard(
      "Biggest Draft Bust",
      stats.worstValuePick,
      (s) => `Rd ${s.round} Pick ${s.pickNo} by ${s.username || s.teamName}${s.vbd != null ? ` · ${s.vbd.toFixed(1)} VBD` : ""}`
    ),
  ].join("");

  const championHeaderHtml = c
    ? `
      <div class="recap-eyebrow">🏆 ${escapeHtml(String(recap.season))} Champion</div>
      <div class="recap-champ-name">${escapeHtml(c.teamName)}</div>
      <p class="recap-narrative">${championshipNarrative(c)} ${championshipMvpNarrative(c)}</p>`
    : `<div class="recap-eyebrow">${escapeHtml(String(season))} Season</div>`;

  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Season Summary</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      ${championHeaderHtml}
      ${mvpHtml || statCardsHtml ? `<div class="recap-players">${mvpHtml}${statCardsHtml}</div>` : ""}
      ${
        highlights.length
          ? `
      <div class="recap-highlights">
        <div class="recap-player-label">Records Set This Season</div>
        <ul class="recap-highlight-list">${highlights.map((h) => `<li>${h}</li>`).join("")}</ul>
      </div>`
          : ""
      }
    </div></div>`;
}

function renderStandingsReplaySection(standingsHistory, playoffTeams) {
  if (!standingsHistory || standingsHistory.length < 2) return "";
  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Standings Over Time</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="replay-controls">
        <button class="replay-btn" id="replay-play-btn" type="button">▶ Play</button>
        <input type="range" class="replay-slider" id="replay-slider" min="1" max="${standingsHistory.length}" value="1" />
        <span class="replay-week-label" id="replay-week-label">Week ${standingsHistory[0].week}</span>
      </div>
      <div class="replay-bars" id="replay-bars" data-playoff-teams="${playoffTeams || ""}"></div>
      <p class="heatmap-note">Rank through each regular-season week, sorted by wins (PF breaks ties).${playoffTeams ? ` The dashed line marks the top ${playoffTeams} — this season's playoff cutoff.` : ""}</p>
    </div></div>`;
}

function initStandingsReplay(standingsHistory, playoffTeams) {
  if (REPLAY_TIMER) {
    clearInterval(REPLAY_TIMER);
    REPLAY_TIMER = null;
  }
  if (!standingsHistory || standingsHistory.length < 2) return;

  REPLAY_SNAPSHOTS = standingsHistory;
  REPLAY_WEEK_INDEX = 0;

  const container = document.getElementById("replay-bars");
  if (!container) return;
  const rosterOrder = standingsHistory[0].standings.map((s) => s.rosterId);
  container.style.height = `${REPLAY_ROW_HEIGHT * rosterOrder.length}px`;

  const playoffLine =
    playoffTeams && playoffTeams < rosterOrder.length
      ? `<div class="replay-playoff-line" style="top:${playoffTeams * REPLAY_ROW_HEIGHT}px;"><span class="replay-playoff-line-label">Playoff Line</span></div>`
      : "";

  container.innerHTML =
    playoffLine +
    rosterOrder
      .map(
        (rid) => `
      <div class="replay-row" id="replay-row-${rid}" style="top:0px;">
        <span class="replay-rank"></span>
        <span class="replay-team-name"></span>
        <span class="replay-record"></span>
      </div>`
      )
      .join("");

  renderReplayWeek(0);

  const slider = document.getElementById("replay-slider");
  const playBtn = document.getElementById("replay-play-btn");
  slider.oninput = () => {
    stopReplay();
    REPLAY_WEEK_INDEX = Number(slider.value) - 1;
    renderReplayWeek(REPLAY_WEEK_INDEX);
  };
  playBtn.onclick = () => {
    if (REPLAY_TIMER) {
      stopReplay();
      return;
    }
    if (REPLAY_WEEK_INDEX >= REPLAY_SNAPSHOTS.length - 1) REPLAY_WEEK_INDEX = 0;
    playBtn.textContent = "⏸ Pause";
    REPLAY_TIMER = setInterval(() => {
      REPLAY_WEEK_INDEX += 1;
      if (REPLAY_WEEK_INDEX >= REPLAY_SNAPSHOTS.length) {
        stopReplay();
        REPLAY_WEEK_INDEX = REPLAY_SNAPSHOTS.length - 1;
        return;
      }
      renderReplayWeek(REPLAY_WEEK_INDEX);
    }, 900);
  };
}

function stopReplay() {
  if (REPLAY_TIMER) {
    clearInterval(REPLAY_TIMER);
    REPLAY_TIMER = null;
  }
  const playBtn = document.getElementById("replay-play-btn");
  if (playBtn) playBtn.textContent = "▶ Play";
}

function renderReplayWeek(index) {
  const snapshot = REPLAY_SNAPSHOTS[index];
  if (!snapshot) return;
  snapshot.standings.forEach((s, rank) => {
    const row = document.getElementById(`replay-row-${s.rosterId}`);
    if (!row) return;
    row.style.top = `${rank * REPLAY_ROW_HEIGHT}px`;
    row.querySelector(".replay-rank").textContent = `${rank + 1}.`;
    row.querySelector(".replay-team-name").textContent = s.username || s.teamName;
    row.querySelector(".replay-record").textContent = `${s.wins}-${s.losses}${s.ties ? "-" + s.ties : ""}`;
  });
  const weekLabel = document.getElementById("replay-week-label");
  if (weekLabel) weekLabel.textContent = `Week ${snapshot.week}`;
  const slider = document.getElementById("replay-slider");
  if (slider) slider.value = index + 1;
}

function renderPowerRankHistorySection(season) {
  if (!POWER_RANK_CSV_HISTORY || !POWER_RANK_CSV_HISTORY.seasons) return "";
  const yearData = POWER_RANK_CSV_HISTORY.seasons[String(season)];
  if (!yearData || !yearData.ranks) return "";

  function toSeries(dataset) {
    const entries = Object.entries(dataset);
    return entries.map(([key, team], i) => ({
      name: team.label || key,
      color: MULTI_LINE_COLORS[i % MULTI_LINE_COLORS.length],
      points: [...(team.pre != null ? [{ x: "Pre", y: team.pre }] : []), ...team.weekly.map((v, wi) => ({ x: `W${wi + 1}`, y: v }))],
    }));
  }

  // Playoff Odds has no "Pre" value (tracking starts at Week 1) and is
  // stored as a flat array per team rather than {pre, weekly}.
  function toFlatSeries(dataset) {
    const entries = Object.entries(dataset);
    return entries.map(([key, weekly], i) => ({
      name: key,
      color: MULTI_LINE_COLORS[i % MULTI_LINE_COLORS.length],
      points: weekly.map((v, wi) => ({ x: `W${wi + 1}`, y: v })),
    }));
  }

  const rankChart = Charts.multiLineChart(toSeries(yearData.ranks), { invertY: true, formatter: (v) => v.toFixed(1) });
  const hasUnknowns = Object.keys(yearData.ranks).some((k) => k.startsWith("unknown-"));

  const scoreSection = yearData.scores
    ? `
    <div class="wrap"><div class="panel">
      <h2>Power Score History</h2>
      ${Charts.multiLineChart(toSeries(yearData.scores), { invertY: true, formatter: (v) => v.toFixed(2) })}
      <p class="heatmap-note">Raw weighted PR Score each week — lower is better, same as the rank chart above.</p>
    </div></div>`
    : "";

  const oddsSection = yearData.playoffOdds
    ? `
    <div class="wrap"><div class="panel">
      <h2>Playoff Odds History</h2>
      ${Charts.multiLineChart(toFlatSeries(yearData.playoffOdds), { formatter: (v) => v.toFixed(1) + "%" })}
      <p class="heatmap-note">Simulated chance of making the playoffs each week — higher is better, unlike the two charts above.</p>
    </div></div>`
    : "";

  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Power Rank History</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>Power Rank By Week</h2>
      ${rankChart}
      <p class="heatmap-note">Rank 1 (best) is plotted at the top.${hasUnknowns ? " Some teams from this season haven't been identified yet and are labeled by their preseason rank — see data/power-rank-csv-history.json." : ""}</p>
    </div></div>
    ${scoreSection}
    ${oddsSection}`;
}

let PLAYER_NAME_INDEX_CACHE = null;
function getPlayerNameIndex() {
  if (!PLAYER_NAME_INDEX_CACHE) PLAYER_NAME_INDEX_CACHE = buildPlayerNameIndex(PLAYER_DIRECTORY);
  return PLAYER_NAME_INDEX_CACHE;
}

function awardCard(label, winnerLabel, detail, playerId) {
  if (!playerId) {
    return `
      <div class="record-card">
        <p class="record-label">${escapeHtml(label)}</p>
        <p class="record-value award-winner-value">${escapeHtml(winnerLabel)}</p>
        ${detail ? `<p class="record-detail">${escapeHtml(detail)}</p>` : ""}
      </div>`;
  }
  return `
    <div class="record-card record-card-photo">
      ${playerPhotoHtml(playerId, detail || winnerLabel, "player-photo-sm")}
      <div>
        <p class="record-label">${escapeHtml(label)}</p>
        <p class="record-value award-winner-value">${escapeHtml(winnerLabel)}</p>
        ${detail ? `<p class="record-detail">${escapeHtml(detail)}</p>` : ""}
      </div>
    </div>`;
}

function renderAwardsSection(season) {
  if (!SEASON_AWARDS || !SEASON_AWARDS.seasons) return "";
  const yearAwards = SEASON_AWARDS.seasons[String(season)];
  if (!yearAwards) return "";
  const nameIndex = getPlayerNameIndex();
  const cards = Object.entries(yearAwards)
    .map(([category, award]) => {
      const winnerLabel = award.username || award.winnerName || "Unknown";
      const playerId = award.detail ? findPlayerIdByName(award.detail, nameIndex) : null;
      return awardCard(category, winnerLabel, award.detail, playerId);
    })
    .join("");
  return `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Season Awards</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${cards}</div>
    </div>`;
}

function renderSummary(s) {
  const isTotal = s.season === "All-Time";
  const yearTag = (item) => (isTotal && item && item.season ? ` (${item.season})` : "");

  const standingsRows = s.standings
    .map(
      (t, i) => `
    <tr>
      <td class="rank" data-label="#">${i + 1}</td>
      <td class="team-cell">${escapeHtml(t.teamName)}${t.rosterId === s.championRosterId ? " 🏆" : ""}${isTotal && t.championships ? ` ${"🏆".repeat(Math.min(t.championships, 5))}` : ""}</td>
      <td data-label="Record">${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
      <td data-label="PF">${t.fpts.toFixed(1)}</td>
      <td data-label="PA">${t.fptsAgainst.toFixed(1)}</td>
      <td data-label="Overall">${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}</td>
      <td data-label="Luck">${luckBadge(t.luckPct)}</td>
      ${isTotal ? "" : `<td data-label="SOS">${t.avgOpponentPF != null ? t.avgOpponentPF.toFixed(1) : "—"}</td>`}
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

  const positionTableHtml = renderPositionTable(s.positionTable);

  const extremeCards = [
    s.highestWeekScore &&
      expandableRecordCard(
        "Highest Score",
        s.highestWeekScore.points.toFixed(1),
        `${escapeHtml(s.highestWeekScore.teamName)} · Week ${s.highestWeekScore.week}${yearTag(s.highestWeekScore)}`,
        [{ teamName: s.highestWeekScore.teamName, lineup: s.highestWeekScore.lineup }]
      ),
    s.lowestWeekScore &&
      expandableRecordCard(
        "Lowest Score",
        s.lowestWeekScore.points.toFixed(1),
        `${escapeHtml(s.lowestWeekScore.teamName)} · Week ${s.lowestWeekScore.week}${yearTag(s.lowestWeekScore)}`,
        [{ teamName: s.lowestWeekScore.teamName, lineup: s.lowestWeekScore.lineup }]
      ),
  ]
    .filter(Boolean)
    .join("");

  const matchupLineupSections = (m) => [
    { teamName: m.winner, lineup: m.winnerLineup },
    { teamName: m.loser, lineup: m.loserLineup },
  ];
  const closestListHtml = renderRankList(
    s.top5Closest,
    (m) => ({
      main: `${escapeHtml(m.winner)} def. ${escapeHtml(m.loser)}`,
      sub: `Week ${m.week}${yearTag(m)} · ${m.winnerPts.toFixed(1)} - ${m.loserPts.toFixed(1)}`,
      value: `${m.margin.toFixed(1)} pt`,
    }),
    matchupLineupSections
  );
  const blowoutListHtml = renderRankList(
    s.top5Blowouts,
    (m) => ({
      main: `${escapeHtml(m.winner)} over ${escapeHtml(m.loser)}`,
      sub: `Week ${m.week}${yearTag(m)} · ${m.winnerPts.toFixed(1)} - ${m.loserPts.toFixed(1)}`,
      value: `${m.margin.toFixed(1)} pt`,
    }),
    matchupLineupSections
  );

  const luckiestListHtml = isTotal
    ? renderRankList(s.top5Luckiest, (t) => ({
        main: `${escapeHtml(t.teamName)} · ${t.season}`,
        sub: `Record ${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""} · Overall ${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}`,
        value: luckBadge(t.luckPct),
      }))
    : "";
  const unluckiestListHtml = isTotal
    ? renderRankList(s.top5Unluckiest, (t) => ({
        main: `${escapeHtml(t.teamName)} · ${t.season}`,
        sub: `Record ${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""} · Overall ${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}`,
        value: luckBadge(t.luckPct),
      }))
    : "";

  const faabListHtml = s.top5FaabPickups
    ? renderFaabList(s.top5FaabPickups, isTotal)
    : "";

  const POSITION_LABELS = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", K: "K", DEF: "DEF" };
  const bestByPositionCards = Object.entries(POSITION_LABELS)
    .map(([pos, label]) => {
      const x = s.bestByPosition[pos];
      if (!x) return "";
      return recordCardWithPhoto(`Best ${label} Week`, x.playerId, x.player, `${x.points.toFixed(1)} pts · ${escapeHtml(x.teamName)} · Wk ${x.week}${yearTag(x)}`);
    })
    .join("");

  const draftCards = [
    s.bestValuePick &&
      recordCardWithPhoto(
        "Best Late-Round Steal",
        s.bestValuePick.playerId,
        s.bestValuePick.player,
        `Rd ${s.bestValuePick.round} Pick ${s.bestValuePick.pickNo} by ${escapeHtml(s.bestValuePick.username || s.bestValuePick.teamName)} · ${s.bestValuePick.points.toFixed(1)} pts${
          s.bestValuePick.vbd != null ? ` · +${s.bestValuePick.vbd.toFixed(1)} VBD` : ""
        }${yearTag(s.bestValuePick)}`,
        gradeBadgeHtml(s.bestValuePick.grade)
      ),
    s.worstValuePick &&
      recordCardWithPhoto(
        "Biggest Draft Bust",
        s.worstValuePick.playerId,
        s.worstValuePick.player,
        `Rd ${s.worstValuePick.round} Pick ${s.worstValuePick.pickNo} by ${escapeHtml(s.worstValuePick.username || s.worstValuePick.teamName)} · ${s.worstValuePick.points.toFixed(1)} pts${
          s.worstValuePick.vbd != null ? ` · ${s.worstValuePick.vbd.toFixed(1)} VBD` : ""
        }${yearTag(s.worstValuePick)}`,
        gradeBadgeHtml(s.worstValuePick.grade)
      ),
    s.pointsLeader && recordCardWithPhoto("Season Points Leader", s.pointsLeader.playerId, s.pointsLeader.player, `${s.pointsLeader.points.toFixed(1)} total points${yearTag(s.pointsLeader)}`),
  ]
    .filter(Boolean)
    .join("");

  return `
    ${isTotal ? "" : renderChampionshipRecap(s.championshipRecap, s.allTimeRecords, { bestValuePick: s.bestValuePick, worstValuePick: s.worstValuePick, pointsLeader: s.pointsLeader })}

    ${
      s.bracket
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Playoff Bracket</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      ${renderBracket(s.bracket)}
    </div></div>`
        : ""
    }

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Final Standings</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="heatmap-table-wrap">
        <table class="stat-table responsive-stack">
          <thead><tr><th>#</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th><th>Overall</th><th>Luck</th>${isTotal ? "" : "<th>SOS</th>"}</tr></thead>
          <tbody>${standingsRows}</tbody>
        </table>
      </div>
      <p class="heatmap-note">"Overall" is the record if every team played every other team, every week. "Luck" is the gap between a team's real win % and their Overall win %.${isTotal ? "" : " \"SOS\" is average regular-season opponent score faced — higher means a tougher schedule."}</p>
    </div></div>

    ${isTotal ? "" : renderStandingsReplaySection(s.standingsHistory, s.playoffTeams)}

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Weekly Scoring Trend</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>${isTotal ? "Average Score By Week Of Season (All Years)" : "League Average Score By Week"}</h2>
      ${weeklyTrendChart}
    </div></div>

    ${isTotal ? "" : renderPowerRankHistorySection(s.season)}

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
      <span class="label">By Starting Slot</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <h2>Average Score Per Week, By Lineup Slot</h2>
      ${positionTableHtml}
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Season Extremes</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${extremeCards || `<div class="empty-state">No games played yet.</div>`}</div>
    </div>

    <div class="wrap">
      <div class="section-grid" style="margin-top:20px;">
        <div class="panel">
          <h2>Top 5 Closest Matchups</h2>
          ${closestListHtml}
        </div>
        <div class="panel">
          <h2>Top 5 Biggest Blowouts</h2>
          ${blowoutListHtml}
        </div>
      </div>
    </div>

    ${
      isTotal
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Luck</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="section-grid">
        <div class="panel">
          <h2>Top 5 Luckiest Seasons</h2>
          ${luckiestListHtml}
        </div>
        <div class="panel">
          <h2>Top 5 Unluckiest Seasons</h2>
          ${unluckiestListHtml}
        </div>
      </div>
    </div>`
        : ""
    }

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Best By Position</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${bestByPositionCards || `<div class="empty-state">No lineup data available.</div>`}</div>
    </div>

    ${
      isTotal || s.status !== "complete"
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Draft Standouts</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="records-grid">${draftCards || `<div class="empty-state">No draft data for this season.</div>`}</div>
    </div>`
        : ""
    }

    ${
      s.top5FaabPickups && s.top5FaabPickups.length
        ? `
    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Waiver Wire</span>
      <div class="line"></div>
    </div>
    <div class="wrap">
      <div class="panel">
        <h2>Top 5 Priciest FAAB Pickups${isTotal ? " Of All Time" : ""}</h2>
        ${faabListHtml}
      </div>
    </div>`
        : ""
    }

    ${renderAwardsSection(s.season)}
  `;
}

document.addEventListener("DOMContentLoaded", renderSeasonPage);
