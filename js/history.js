async function renderHistory() {
  const errorBox = document.getElementById("hist-error");

  try {
    const seasons = await SleeperAPI.getSeasonChain(LEAGUE_ID); // oldest -> newest
    const manual = await fetchJsonSafe(MANUAL_HISTORY_FILE, { seasons: [] });

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
      if (champRosterId != null) {
        const roster = rosters.find((r) => r.roster_id === champRosterId);
        const user = users.find((u) => u.user_id === (roster && roster.owner_id));
        champName = SleeperAPI.teamName(user, champRosterId);
        champUsername = user ? user.display_name : null;
      } else if (league.status === "complete") {
        champName = "Unavailable"; // completed but bracket data missing/unusual format
      }
      return { year: league.season, champion: champName, championUsername: champUsername, sourceBadge: "Sleeper", notes: "" };
    });

    // ---- Manual pre-Sleeper seasons ----
    const manualLedger = (manual.seasons || []).map((s) => ({
      year: s.year,
      champion: s.champion || "Unknown",
      sourceBadge: "Manual entry",
      notes: s.notes || "",
    }));

    const fullLedger = [...sleeperLedger, ...manualLedger].sort((a, b) => b.year - a.year);

    document.getElementById("champions-ledger").innerHTML = fullLedger
      .map((row) => {
        const inner = `
        <span class="year">${row.year}</span>
        <div>
          <div class="champ-name">${escapeHtml(row.champion)}${row.championUsername && row.championUsername !== row.champion ? ` <span class="muted-inline">(${escapeHtml(row.championUsername)})</span>` : ""}</div>
          ${row.notes ? `<div class="champ-sub">${escapeHtml(row.notes)}</div>` : ""}
        </div>
        <span class="badge">${row.sourceBadge}</span>`;
        return row.sourceBadge === "Sleeper"
          ? `<a class="ledger-row" href="season.html#${row.year}" style="text-decoration:none; color:inherit; cursor:pointer;">${inner}</a>`
          : `<div class="ledger-row">${inner}</div>`;
      })
      .join("");

    // ---- All-time career standings, aggregated by Sleeper user_id ----
    const careerByUser = new Map();
    seasons.forEach(({ rosters, users }) => {
      const standings = SleeperAPI.buildStandings(rosters, users);
      standings.forEach((t) => {
        if (!t.userId) return;
        const prev = careerByUser.get(t.userId) || {
          teamName: t.teamName,
          wins: 0,
          losses: 0,
          ties: 0,
          fpts: 0,
          championships: 0,
        };
        prev.teamName = t.teamName; // keep most recent name
        prev.wins += t.wins;
        prev.losses += t.losses;
        prev.ties += t.ties;
        prev.fpts += t.fpts;
        careerByUser.set(t.userId, prev);
      });
    });
    sleeperLedger.forEach((row) => {
      // Bump championship counts by matching team name back to a user
      // (best-effort — team renames across years can occasionally miss a match)
      for (const [, rec] of careerByUser) {
        if (rec.teamName === row.champion) rec.championships += 1;
      }
    });

    const careerRows = [...careerByUser.values()].sort(
      (a, b) => b.wins - a.wins || b.fpts - a.fpts
    );

    document.getElementById("career-body").innerHTML = careerRows.length
      ? careerRows
          .map(
            (t, i) => `
      <tr>
        <td class="rank">${i + 1}</td>
        <td class="team-cell">${escapeHtml(t.teamName)}</td>
        <td>${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
        <td>${t.fpts.toFixed(1)}</td>
        <td>${t.championships || 0}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="5" class="empty-state">No completed seasons yet.</td></tr>`;

    // ---- Pre-Sleeper season standings (only if manual data provided) ----
    const preSection = document.getElementById("pre-sleeper-section");
    if (manual.seasons && manual.seasons.some((s) => s.standings && s.standings.length)) {
      preSection.style.display = "";
      const rows = [];
      manual.seasons
        .filter((s) => s.standings && s.standings.length)
        .sort((a, b) => b.year - a.year)
        .forEach((s) => {
          rows.push(`<tr><td colspan="4" class="team-cell" style="padding-top:16px;"><strong>${s.year}</strong></td></tr>`);
          s.standings.forEach((row) => {
            rows.push(`
              <tr>
                <td class="team-cell">${escapeHtml(row.team)}</td>
                <td>${row.wins}-${row.losses}</td>
                <td>${(row.pointsFor ?? 0).toFixed ? row.pointsFor.toFixed(1) : row.pointsFor}</td>
                <td>${row.team === s.champion ? "🏆" : ""}</td>
              </tr>`);
          });
        });
      document.getElementById("pre-sleeper-body").innerHTML = rows.join("");
    } else {
      preSection.style.display = "none";
    }
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't load league history — " + err.message;
    errorBox.style.display = "block";
  }
}

document.addEventListener("DOMContentLoaded", renderHistory);
