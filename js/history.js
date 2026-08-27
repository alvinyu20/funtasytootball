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

async function renderCareerRecords(seasons, playerDirectory, manual) {
  try {
    const deepSeasons = await DeepHistory.buildAll(seasons, () => {});
    const stats = DeepHistory.computeStats(seasons, deepSeasons, playerDirectory);

    // Fold in ESPN-era (pre-Sleeper) totals for any manager who's also
    // played in the Sleeper era. Deliberately keyed by looking each
    // Sleeper manager's own username up in the manual data, not the
    // other way around — a name that only ever appears in the manual
    // data (never continued into the Sleeper era) has no Sleeper
    // manager object to merge onto in the first place, so it's
    // naturally excluded here without needing an explicit allow-list.
    const manualStatsByTeam = ManualHistory.computeManagerStats(manual);
    stats.managers.forEach((m) => {
      if (m.username) ManualHistory.mergeIntoManager(m, manualStatsByTeam.get(m.username)?.totals);
    });

    const careerRows = stats.managers
      .map((m) => {
        const totalGames =
          m.careerRegularSeasonWins + m.careerRegularSeasonLosses + m.careerRegularSeasonTies + m.careerPlayoffWins + m.careerPlayoffLosses + m.careerPlayoffTies;
        const totalWins = m.careerRegularSeasonWins + m.careerPlayoffWins;
        const winPct = totalGames > 0 ? (totalWins / totalGames) * 100 : 0;
        return { ...m, winPct };
      })
      .sort((a, b) => b.winPct - a.winPct || b.careerPF - a.careerPF);

    document.getElementById("career-body").innerHTML = careerRows.length
      ? careerRows
          .map(
            (m, i) => `
      <tr>
        <td class="rank" data-label="#">${i + 1}</td>
        <td class="team-cell" data-label="Manager">${escapeHtml(m.username || m.teamName || "Unknown")}</td>
        <td data-label="Regular Season">${m.careerRegularSeasonWins}-${m.careerRegularSeasonLosses}${m.careerRegularSeasonTies ? "-" + m.careerRegularSeasonTies : ""}</td>
        <td data-label="Playoffs">${m.careerPlayoffWins}-${m.careerPlayoffLosses}${m.careerPlayoffTies ? "-" + m.careerPlayoffTies : ""}</td>
        <td data-label="Win %">${m.winPct.toFixed(1)}%</td>
        <td data-label="Career PF">${m.careerPF.toFixed(1)}</td>
        <td data-label="🏆">${m.championships || 0}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="7" class="empty-state">No completed seasons yet.</td></tr>`;
  } catch (err) {
    console.error(err);
    document.getElementById("career-body").innerHTML = `<tr><td colspan="7" class="empty-state">Couldn't load career records.</td></tr>`;
  }
}

document.addEventListener("DOMContentLoaded", renderHistory);
