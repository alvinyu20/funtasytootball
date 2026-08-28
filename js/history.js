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
            const card = `
            ${userAvatarHtml(row.championAvatarUrl, displayName, "player-photo-lg")}
            <div class="trophy-year">${escapeHtml(String(row.year))}</div>
            <div class="trophy-champion-name">${escapeHtml(displayName)}</div>`;
            return `<a class="trophy-card" href="season.html#${row.year}">${card}</a>`;
          })
          .join("")
      : `<div class="empty-state">No champions crowned yet.</div>`;

    document.getElementById("champions-ledger").innerHTML = fullLedger
      .map((row) => {
        const inner = `
        <span class="year">${row.year}</span>
        <div>
          <div class="champ-name">${escapeHtml(row.champion)}${row.championUsername && row.championUsername !== row.champion ? ` <span class="muted-inline">(${escapeHtml(row.championUsername)})</span>` : ""}</div>
          ${row.notes ? `<div class="champ-sub">${escapeHtml(row.notes)}</div>` : ""}
        </div>
        <span class="badge">${row.sourceBadge}</span>`;
        return `<a class="ledger-row" href="season.html#${row.year}" style="text-decoration:none; color:inherit; cursor:pointer;">${inner}</a>`;
      })
      .join("");

    // ---- All-time career records — deferred, since this needs full deep
    //      history (not just the fast season-chain data used above) to
    //      correctly separate genuine playoff games from regular season
    //      and consolation-bracket games. Kicked off after the fast stuff
    //      above is already on screen. ----
    renderCareerRecords(seasons, playerDirectory, manual);
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't load league history — " + err.message;
    errorBox.style.display = "block";
  }
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
        <td class="team-cell" data-label="Owner">${escapeHtml(m.name)}</td>
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

    const gridRows = stats.managers.map((m) => {
      const totalGames =
        m.careerRegularSeasonWins + m.careerRegularSeasonLosses + m.careerRegularSeasonTies + m.careerPlayoffWins + m.careerPlayoffLosses + m.careerPlayoffTies;
      const totalWins = m.careerRegularSeasonWins + m.careerPlayoffWins;
      const overallWinPct = totalGames > 0 ? (totalWins / totalGames) * 100 : 0;
      return { ...m, overallWinPct };
    });

    // Career trend grid — one small card per manager, each with a tiny
    // sparkline of wins-per-season (their whole career, oldest to
    // newest) so the shape of every career is scannable at once before
    // the detailed table below spells out the exact numbers.
    document.getElementById("career-grid").innerHTML = gridRows.length
      ? gridRows
          .map((m) => {
            const bySeasonAsc = [...(m.seasons || [])].sort((a, b) => a.season - b.season);
            const wins = bySeasonAsc.map((s) => s.wins);
            const points = sparklinePoints(wins, 100, 28, 3);
            return `
      <div class="career-card">
        <div class="career-card-name">${escapeHtml(m.username || m.teamName || "Unknown")}</div>
        ${points ? `<svg class="career-spark" viewBox="0 0 100 28" preserveAspectRatio="none"><polyline points="${points}" /></svg>` : ""}
        <div class="career-card-stat">${m.overallWinPct.toFixed(1)}% win rate</div>
      </div>`;
          })
          .join("")
      : `<div class="empty-state">No completed seasons yet.</div>`;

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
    document.getElementById("career-grid").innerHTML = `<div class="empty-state">Couldn't load career trends.</div>`;
    document.getElementById("career-body").innerHTML = `<tr><td colspan="12" class="empty-state">Couldn't load career records.</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", renderHistory);
