/*
  2026.html — a full-roster "meet your teams" page for the current
  season, meant to be read right after the draft: every team, every
  player on that roster, a photo for each, and a highlighted "top 3
  picks" callout per team with a slot for a team photo.

  Deliberately a much lighter fetch than draft.js/teams.js/records.js —
  this only needs the CURRENT season's rosters, users, and draft picks,
  not DeepHistory.buildAll's full multi-season matchup/transaction
  history (which those pages need for career stats and draft grading,
  neither of which applies here — there's no performance history to
  grade a rookie-season roster against yet).
*/

let PLAYER_DIRECTORY_2026 = null;

async function renderTeams2026Page() {
  const errorBox = document.getElementById("page-error");

  try {
    const [seasonChain, playerDirectory] = await Promise.all([SleeperAPI.getSeasonChain(LEAGUE_ID), SleeperAPI.getPlayerDirectory()]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }
    PLAYER_DIRECTORY_2026 = playerDirectory;

    const current = seasonChain[seasonChain.length - 1];
    const { league, rosters, users } = current;

    document.title = (SITE_TITLE || league.name || "League") + ` — ${league.season} Teams`;
    document.getElementById("sb-title").textContent = `${league.season} Teams`;
    document.getElementById("sb-sub").textContent = "Every roster, fresh off the draft.";

    const standings = SleeperAPI.buildStandings(rosters, users);
    const picksByRoster = await fetchPicksByRoster(league.league_id);

    renderTeamJumpNav(standings);
    renderAllTeamSections(standings, rosters, league, picksByRoster, playerDirectory, league.season);
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't load team data — " + err.message;
    errorBox.style.display = "block";
  }
}

// Draft picks, grouped by roster_id and sorted by pick number — a plain
// Map(rosterId -> picks[]), empty if this season's draft hasn't
// happened yet (a fresh, pre-draft season shouldn't error, just show
// rosters with no "top 3 picks" callout).
async function fetchPicksByRoster(leagueId) {
  const drafts = await SleeperAPI.getDrafts(leagueId);
  const picksByRoster = new Map();
  if (!drafts.length) return picksByRoster;
  const picks = await SleeperAPI.getDraftPicks(drafts[0].draft_id);
  picks.forEach((p) => {
    if (!picksByRoster.has(p.roster_id)) picksByRoster.set(p.roster_id, []);
    picksByRoster.get(p.roster_id).push(p);
  });
  picksByRoster.forEach((arr) => arr.sort((a, b) => a.pick_no - b.pick_no));
  return picksByRoster;
}

function renderTeamJumpNav(standings) {
  const root = document.getElementById("team-jump-nav");
  if (!root) return;
  root.innerHTML = standings.map((s) => `<a class="team-jump-pill" href="#team-${s.rosterId}">${escapeHtml(s.username || s.teamName || "Team")}</a>`).join("");
}

function renderAllTeamSections(standings, rosters, league, picksByRoster, playerDirectory, season) {
  const root = document.getElementById("teams-2026-root");
  if (!root) return;
  const rostersById = new Map(rosters.map((r) => [r.roster_id, r]));
  root.innerHTML = standings
    .map((s) => renderTeamSection(s, rostersById.get(s.rosterId), league, picksByRoster.get(s.rosterId) || [], playerDirectory, season))
    .join("");
}

// Splits a roster into starter rows (in roster_positions slot order,
// each labeled QB/RB/FLEX/etc via the same SleeperAPI helper the rest
// of the site uses for lineups) and bench player IDs (everyone else on
// the roster). A slot with no player yet (a bye, or a roster fetched
// mid-transaction) renders as an empty placeholder card rather than
// being silently skipped, so the grid always shows the full lineup shape.
function buildRosterGroups(roster, rosterPositions) {
  const starterSlotTypes = (rosterPositions || []).filter((p) => p !== "BN");
  const starters = (roster && roster.starters) || [];
  const starterRows = starterSlotTypes.map((slotType, i) => ({
    slot: SleeperAPI.friendlySlotLabel(slotType),
    playerId: starters[i] || null,
  }));
  const starterSet = new Set(starters.filter(Boolean));
  const benchIds = ((roster && roster.players) || []).filter((pid) => !starterSet.has(pid));
  return { starterRows, benchIds };
}

// A roster's `metadata` stores any custom nicknames league members have
// assigned to specific players, keyed "p_nick_{player_id}" — a Sleeper
// feature, not something this site invents. Some entries are present
// but blank (a nickname that was cleared, not one that was never set),
// which should read the same as "no nickname" rather than showing an
// empty tag.
function nicknameFor(roster, playerId) {
  const meta = roster && roster.metadata;
  if (!meta) return null;
  const nick = meta[`p_nick_${playerId}`];
  return nick && String(nick).trim() ? nick : null;
}

function renderTeamSection(standingsEntry, roster, league, teamPicks, playerDirectory, season) {
  const { rosterId, teamName, username, avatar, wins, losses, ties, fpts, fptsAgainst } = standingsEntry;
  const displayName = username || teamName || "Unknown";
  const record = `${wins}-${losses}${ties ? `-${ties}` : ""}`;
  const rosterSize = (roster && roster.players && roster.players.length) || 0;
  const { starterRows, benchIds } = buildRosterGroups(roster, league.roster_positions);

  return `
    <div class="scoreboard team-2026-section" id="team-${rosterId}">
      <p class="scoreboard-eyebrow">${escapeHtml(season)} ROSTER</p>
      <div class="team-2026-header">
        ${userAvatarHtml(avatar, displayName, "player-photo-sm")}
        <div>
          <h1 class="scoreboard-title">${escapeHtml(displayName)}</h1>
          ${teamName && teamName !== displayName ? `<p class="scoreboard-sub">${escapeHtml(teamName)}</p>` : ""}
        </div>
      </div>
      <div class="scoreboard-ticker">
        <div class="ticker-stat"><span class="label">Record</span><span class="value">${record}</span></div>
        <div class="ticker-stat"><span class="label">Points For</span><span class="value">${fpts.toFixed(1)}</span></div>
        <div class="ticker-stat"><span class="label">Points Against</span><span class="value">${fptsAgainst.toFixed(1)}</span></div>
        <div class="ticker-stat"><span class="label">Roster Size</span><span class="value">${rosterSize}</span></div>
      </div>
    </div>
    <div class="panel">
      ${renderTopPicksTrio(rosterId, displayName, teamPicks, playerDirectory, season, roster)}
      <p class="team-2026-subhead">Starting Lineup</p>
      <div class="team-2026-roster-grid">
        ${starterRows.map((row) => renderRosterPlayerCard(row.playerId, row.slot, teamPicks, playerDirectory, roster)).join("")}
      </div>
      ${
        benchIds.length
          ? `
      <p class="team-2026-subhead">Bench</p>
      <div class="team-2026-roster-grid">
        ${benchIds.map((pid) => renderRosterPlayerCard(pid, null, teamPicks, playerDirectory, roster)).join("")}
      </div>`
          : ""
      }
    </div>`;
}

function renderTopPicksTrio(rosterId, displayName, teamPicks, playerDirectory, season, roster) {
  const top3 = teamPicks.slice(0, 3);
  if (!top3.length) return "";
  const photoPath = `data/team-photos/${season}-${rosterId}.jpg`;
  return `
    <div class="team-2026-trio">
      <div class="team-2026-photo-slot">
        <img src="${escapeHtml(photoPath)}" alt="${escapeHtml(displayName)}'s top 3 picks" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
        <div class="team-2026-photo-fallback">
          📸 Add a photo of ${escapeHtml(displayName)}'s top 3 picks together<br />drop one at<br /><code>${escapeHtml(photoPath)}</code>
        </div>
      </div>
      <div class="team-2026-trio-list">
        <p class="team-2026-trio-label">Top 3 Picks</p>
        ${top3.map((p) => renderTrioPlayer(p, playerDirectory, roster)).join("")}
      </div>
    </div>`;
}

function trioPlayerName(pick, playerDirectory) {
  const info = playerDirectory[pick.player_id];
  if (info && info.full_name) return info.full_name;
  const meta = pick.metadata || {};
  const metaName = `${meta.first_name || ""} ${meta.last_name || ""}`.trim();
  return metaName || "Unknown";
}

function renderTrioPlayer(pick, playerDirectory, roster) {
  const name = trioPlayerName(pick, playerDirectory);
  const info = playerDirectory[pick.player_id] || {};
  const position = info.position || (pick.metadata && pick.metadata.position) || "";
  const nickname = nicknameFor(roster, pick.player_id);
  return `
    <div class="team-2026-trio-player">
      ${playerLinkHtml(pick.player_id, playerPhotoHtml(pick.player_id, name, "player-photo-sm"))}
      <div>
        ${playerLinkHtml(pick.player_id, `<span class="team-2026-trio-name">${escapeHtml(name)}</span>`)}
        ${nickname ? `<span class="team-2026-nickname">"${escapeHtml(nickname)}"</span>` : ""}
        <span class="team-2026-trio-meta">${escapeHtml(position)}${position ? " · " : ""}Rd ${pick.round}, Pick ${pick.pick_no}</span>
      </div>
    </div>`;
}

function renderRosterPlayerCard(playerId, slotLabel, teamPicks, playerDirectory, roster) {
  if (!playerId) return `<div class="team-2026-player-card empty">—</div>`;
  const info = playerDirectory[playerId] || {};
  const name = info.full_name || "Unknown";
  const pick = teamPicks.find((p) => p.player_id === playerId);
  const nickname = nicknameFor(roster, playerId);
  const metaParts = [info.position, info.team].filter(Boolean);
  // Only worth showing the slot label when it says something the
  // position doesn't already (FLEX/SFLX) -- for a plain starter, "QB"
  // as both the position AND the slot just reads as a stutter.
  if (slotLabel && slotLabel !== info.position) metaParts.push(slotLabel);
  return `
    <div class="team-2026-player-card">
      ${playerLinkHtml(playerId, playerPhotoHtml(playerId, name, "player-photo-xs"))}
      <div class="team-2026-player-info">
        ${playerLinkHtml(playerId, `<span class="team-2026-player-name">${escapeHtml(name)}</span>`)}
        ${nickname ? `<span class="team-2026-nickname">"${escapeHtml(nickname)}"</span>` : ""}
        <span class="team-2026-player-meta">${escapeHtml(metaParts.join(" · "))}</span>
        ${pick ? `<span class="team-2026-player-pick">Rd ${pick.round}, Pick ${pick.pick_no}</span>` : ""}
      </div>
    </div>`;
}

document.addEventListener("DOMContentLoaded", renderTeams2026Page);
