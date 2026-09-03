async function renderHistory() {
  const errorBox = document.getElementById("hist-error");

  try {
    const [seasons, playerDirectory, rawManual] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID), // oldest -> newest
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(MANUAL_HISTORY_FILE, { seasons: [] }),
    ]);
    // Guard against an un-replaced template entry (champion still says
    // "REPLACE_WITH...") ever showing up on the live site.
    const manual = { ...rawManual, seasons: (rawManual.seasons || []).filter((s) => s.champion && !String(s.champion).startsWith("REPLACE_WITH")) };

    if (seasons.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    const latest = seasons[seasons.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — History";
    document.getElementById("sb-eyebrow").textContent = "ALL-TIME";
    document.getElementById("sb-title").textContent = "Trophy Case";

    const totalSeasons = seasons.length + manual.seasons.length;
    document.getElementById("sb-sub").textContent = `${totalSeasons} season${totalSeasons === 1 ? "" : "s"} on record`;

    // ---- Champions ledger (Sleeper-tracked seasons) ----
    const sleeperLedger = seasons.map(({ league, rosters, users, bracket }) => {
      const champRosterId = SleeperAPI.findChampionRosterId(bracket);
      let champName = "In progress";
      let champUsername = null;
      let champAvatarUrl = null;
      let champUserId = null;
      if (champRosterId != null) {
        const roster = rosters.find((r) => r.roster_id === champRosterId);
        const user = users.find((u) => u.user_id === (roster && roster.owner_id));
        champName = SleeperAPI.teamName(user, champRosterId);
        champUsername = user ? user.display_name : null;
        champAvatarUrl = user && user.avatar ? SleeperAPI.avatarUrl(user.avatar) : null;
        champUserId = roster ? roster.owner_id : null;
      } else if (league.status === "complete") {
        champName = "Unavailable"; // completed but bracket data missing/unusual format
      }
      return {
        year: league.season,
        champion: champName,
        championUsername: champUsername,
        championAvatarUrl: champAvatarUrl,
        championUserId: champUserId,
        sourceBadge: "Sleeper",
        notes: "",
      };
    });

    // ---- Manual pre-Sleeper seasons ----
    const manualLedger = (manual.seasons || []).map((s) => ({
      year: s.year,
      champion: s.champion || "Unknown",
      sourceBadge: "ESPN",
      notes: "",
    }));

    const fullLedger = [...sleeperLedger, ...manualLedger].sort((a, b) => b.year - a.year);

    // ---- Trophy Room: a visual grid of every confirmed champion ----
    const isPlaceholder = (name) => !name || name.startsWith("REPLACE_WITH");
    const trophyEntries = fullLedger.filter((row) => row.champion && row.champion !== "In progress" && row.champion !== "Unavailable" && !isPlaceholder(row.champion));
    document.getElementById("trophy-room").innerHTML = trophyEntries.length
      ? trophyEntries
          .map((row) => {
            const displayName = row.championUsername || row.champion;
            // The team name only adds anything when it's a distinct
            // custom name — for a manager who never set one, teamName()
            // just falls back to their username anyway, and printing
            // the same string twice would look like a mistake, not a detail.
            const teamName = row.championUsername && row.champion && row.champion !== row.championUsername ? row.champion : null;
            const card = `
            ${userAvatarHtml(row.championAvatarUrl, displayName, "player-photo-lg")}
            <div class="trophy-year">${escapeHtml(String(row.year))}</div>
            <div class="trophy-champion-name">${escapeHtml(displayName)}</div>
            ${teamName ? `<div class="trophy-team-name">${escapeHtml(teamName)}</div>` : ""}`;
            return `<a class="trophy-card" href="season.html#${row.year}">${card}</a>`;
          })
          .join("")
      : `<div class="empty-state">No champions crowned yet.</div>`;

    // ---- All-time career records — deferred, since this needs full deep
    //      history (not just the fast season-chain data used above) to
    //      correctly separate genuine playoff games from regular season
    //      and consolation-bracket games. Kicked off after the fast stuff
    //      above is already on screen. ----
    renderCareerRecords(seasons, playerDirectory, manual);

    // ---- Championship Rings: every player who was ever on a title
    // team's roster, Sleeper era only (no player-level data exists for
    // the ESPN era — see data/manual-history.json). Kicked off after
    // the fast stuff above is already on screen, since it needs full
    // deep history (every week's roster) to know who was actually on
    // each champion's roster, not just who's in the league today. ----
    renderChampionshipRings(seasons, playerDirectory);
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't load league history — " + err.message;
    errorBox.style.display = "block";
  }
}

/*
  A player earns one "ring" for a season if they were on the roster of
  that season's championship team at ANY point during the season — not
  just during the championship game, and regardless of whether they
  were ever started. Counts distinct championship seasons per player
  (a player rostered by the same eventual champion in two different
  weeks of the SAME season only earns that season's ring once), ranks
  the top 10, and keeps which year(s)/manager(s) each ring came from so
  the table can show the breakdown, not just a bare count. Also tracks
  how many of those weeks they were actually STARTED (not just
  rostered) for the champion, summed across every championship season
  they were part of.

  Kickers and defenses are excluded from eligibility entirely — a K/DEF
  is much more a product of whichever streaming target was available
  that week than a meaningful part of "this roster," so including them
  would mostly just reward whoever happened to roster the right
  matchup, not roster-building.
*/
const RING_INELIGIBLE_POSITIONS = new Set(["K", "DEF"]);

async function renderChampionshipRings(seasons, playerDirectory) {
  const tbody = document.getElementById("rings-body");
  try {
    const deepSeasons = await DeepHistory.buildAll(seasons, () => {});

    // playerId -> [{ season, ownerName, gamesStarted }], one entry per
    // distinct championship season that player was ever rostered by
    // the winner, with how many of that season's weeks they started.
    const ringsByPlayer = new Map();

    seasons.forEach((seasonEntry, idx) => {
      const { league, rosters, users, bracket } = seasonEntry;
      const championRosterId = SleeperAPI.findChampionRosterId(bracket);
      if (championRosterId == null) return; // season still in progress, or no bracket on record

      const roster = rosters.find((r) => r.roster_id === championRosterId);
      const user = users.find((u) => u.user_id === (roster && roster.owner_id));
      const ownerName = SleeperAPI.teamName(user, championRosterId);
      const ownerId = roster ? roster.owner_id : null;

      // playerId -> weeks started for the champion roster this season.
      // A player's mere presence as a Map key (regardless of count,
      // including 0) is what makes them eligible for this season's
      // ring — matches the previous Set-based "were they ever on this
      // roster" check, just now also carrying the start count.
      const deep = deepSeasons[idx];
      const startsThisSeasonByPlayer = new Map();
      (deep ? deep.weeks : []).forEach((w) => {
        (w.matchups || []).forEach((m) => {
          if (m.roster_id !== championRosterId) return;
          const starterSet = new Set(m.starters || []);
          (m.players || []).forEach((pid) => {
            if (!pid || pid === "0") return;
            const position = playerDirectory && playerDirectory[pid] && playerDirectory[pid].position;
            if (RING_INELIGIBLE_POSITIONS.has(position)) return;
            if (!startsThisSeasonByPlayer.has(pid)) startsThisSeasonByPlayer.set(pid, 0);
            if (starterSet.has(pid)) startsThisSeasonByPlayer.set(pid, startsThisSeasonByPlayer.get(pid) + 1);
          });
        });
      });

      startsThisSeasonByPlayer.forEach((gamesStarted, pid) => {
        if (!ringsByPlayer.has(pid)) ringsByPlayer.set(pid, []);
        ringsByPlayer.get(pid).push({ season: league.season, ownerName, ownerId, gamesStarted });
      });
    });

    const ranked = [...ringsByPlayer.entries()]
      .map(([pid, rings]) => ({
        playerId: pid,
        name: playerName(pid, playerDirectory),
        rings: rings.sort((a, b) => a.season - b.season),
        totalGamesStarted: rings.reduce((sum, r) => sum + r.gamesStarted, 0),
      }))
      .sort((a, b) => b.rings.length - a.rings.length || b.totalGamesStarted - a.totalGamesStarted)
      .slice(0, 10);

    tbody.innerHTML = ranked.length
      ? ranked
          .map(
            (p, i) => `
      <tr>
        <td class="rank" data-label="#">${i + 1}</td>
        <td class="team-cell player-cell" data-label="Player">${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.name, "player-photo-xs"))}<span>${playerLinkHtml(p.playerId, escapeHtml(p.name))}</span></td>
        <td data-label="Rings">${p.rings.length}</td>
        <td data-label="Games Started">${p.totalGamesStarted}</td>
        <td class="rings-won-with" data-label="Won With">${p.rings.map((r) => `${escapeHtml(String(r.season))} (${r.ownerId ? `<a href="teams.html#${encodeURIComponent(r.ownerId)}" class="subtle-link">${escapeHtml(r.ownerName)}</a>` : escapeHtml(r.ownerName)})`).join(", ")}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="empty-state">No champions crowned yet.</td></tr>`;
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Couldn't load championship rings.</td></tr>`;
  }
}

function playerName(playerId, playerDirectory) {
  const p = playerDirectory && playerDirectory[playerId];
  if (!p) return "Unknown Player";
  return p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Unknown Player";
}

let CAREER_ROWS = [];
let CAREER_SORT = { key: "gold", dir: "desc" };
// Numeric stat columns default to descending (biggest first, the way a
// sports leaderboard reads) on their first click; Owner is the one
// exception, since a name reads naturally sorted A-Z rather than Z-A.
const CAREER_SORT_ASC_DEFAULT = new Set(["name"]);

function sortCareerRows(rows, key, dir) {
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    return dir === "asc" ? av - bv : bv - av;
  });
}

function renderCareerTable() {
  const sorted = sortCareerRows(CAREER_ROWS, CAREER_SORT.key, CAREER_SORT.dir);
  document.getElementById("career-body").innerHTML = sorted.length
    ? sorted
        .map(
          (m, i) => `
      <tr>
        <td class="rank" data-label="#">${i + 1}</td>
        <td class="team-cell" data-label="Owner">${m.userId ? `<a href="teams.html#${encodeURIComponent(m.userId)}" class="subtle-link">${escapeHtml(m.name)}</a>` : escapeHtml(m.name)}</td>
        <td data-label="Gold">${m.gold || "—"}</td>
        <td data-label="Silver">${m.silver || "—"}</td>
        <td data-label="Bronze">${m.bronze || "—"}</td>
        <td data-label="App">${m.playoffApp}</td>
        <td data-label="Pct">${m.playoffPct.toFixed(0)}%</td>
        <td data-label="Years">${m.years}</td>
        <td data-label="Playoff Record">${m.playoffWins}-${m.playoffLosses}${m.playoffTies ? "-" + m.playoffTies : ""}</td>
        <td data-label="Playoff Win %">${m.playoffWinPct.toFixed(1)}%</td>
        <td data-label="Reg Season Record">${m.regWins}-${m.regLosses}${m.regTies ? "-" + m.regTies : ""}</td>
        <td data-label="Reg Season Win %">${m.regWinPct.toFixed(1)}%</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="12" class="empty-state">No completed seasons yet.</td></tr>`;

  document.querySelectorAll("#career-table th.sortable").forEach((th) => {
    th.classList.remove("sort-active", "sort-asc", "sort-desc");
    if (th.dataset.sortKey === CAREER_SORT.key) th.classList.add("sort-active", CAREER_SORT.dir === "asc" ? "sort-asc" : "sort-desc");
  });
}

function initCareerTableSorting() {
  document.querySelectorAll("#career-table th.sortable").forEach((th) => {
    th.onclick = () => {
      const key = th.dataset.sortKey;
      if (CAREER_SORT.key === key) {
        CAREER_SORT.dir = CAREER_SORT.dir === "asc" ? "desc" : "asc";
      } else {
        CAREER_SORT.key = key;
        CAREER_SORT.dir = CAREER_SORT_ASC_DEFAULT.has(key) ? "asc" : "desc";
      }
      renderCareerTable();
    };
  });
}

async function renderCareerRecords(seasons, playerDirectory, manual) {
  try {
    const deepSeasons = await DeepHistory.buildAll(seasons, () => {});
    const stats = DeepHistory.computeStats(seasons, deepSeasons, playerDirectory);

    // Fold in ESPN-era (pre-Sleeper) totals AND season-by-season entries
    // for any manager who's also played in the Sleeper era. Deliberately
    // keyed by looking each Sleeper manager's own username up in the
    // manual data, not the other way around — a name that only ever
    // appears in the manual data (never continued into the Sleeper era)
    // has no Sleeper manager object to merge onto in the first place, so
    // it's naturally excluded here without needing an explicit allow-list.
    const manualStatsByTeam = ManualHistory.computeManagerStats(manual);
    stats.managers.forEach((m) => {
      if (!m.username) return;
      const manualForThisManager = manualStatsByTeam.get(m.username);
      if (!manualForThisManager) return;
      ManualHistory.mergeIntoManager(m, manualForThisManager.totals);
      // The per-season array (not just the totals) is what the career
      // trend grid below draws its sparklines from, so a manager who
      // played both eras shows their whole career's shape, not just
      // the Sleeper-tracked half of it.
      m.seasons = [...m.seasons, ...manualForThisManager.seasons];
    });

    // Career Records table — Titles (gold/silver/bronze), Playoffs
    // (appearances/rate/years played), and separate Playoff and Regular
    // Season records, each independently sortable by clicking its header
    // (see initCareerTableSorting).
    CAREER_ROWS = stats.managers.map((m) => {
      const years = (m.seasons || []).length;
      const playoffPct = years > 0 ? (m.playoffAppearances / years) * 100 : 0;
      const playoffGames = m.careerPlayoffWins + m.careerPlayoffLosses + m.careerPlayoffTies;
      const playoffWinPct = playoffGames > 0 ? (m.careerPlayoffWins / playoffGames) * 100 : 0;
      const regGames = m.careerRegularSeasonWins + m.careerRegularSeasonLosses + m.careerRegularSeasonTies;
      const regWinPct = regGames > 0 ? (m.careerRegularSeasonWins / regGames) * 100 : 0;
      return {
        userId: m.userId,
        name: m.username || m.teamName || "Unknown",
        gold: m.championships || 0,
        silver: m.runnerUps || 0,
        bronze: m.thirdPlaceFinishes || 0,
        playoffApp: m.playoffAppearances || 0,
        playoffPct,
        years,
        playoffWins: m.careerPlayoffWins,
        playoffLosses: m.careerPlayoffLosses,
        playoffTies: m.careerPlayoffTies,
        playoffWinPct,
        regWins: m.careerRegularSeasonWins,
        regLosses: m.careerRegularSeasonLosses,
        regTies: m.careerRegularSeasonTies,
        regWinPct,
      };
    });
    renderCareerTable();
    initCareerTableSorting();
  } catch (err) {
    console.error(err);
    document.getElementById("career-body").innerHTML = `<tr><td colspan="12" class="empty-state">Couldn't load career records.</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", renderHistory);
