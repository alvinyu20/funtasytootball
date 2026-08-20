async function renderDashboard() {
  const errorBox = document.getElementById("dash-error");

  try {
    const [league, rosters, users, nflState, teamStrength] = await Promise.all([
      SleeperAPI.getLeague(LEAGUE_ID),
      SleeperAPI.getRosters(LEAGUE_ID),
      SleeperAPI.getUsers(LEAGUE_ID),
      SleeperAPI.getNflState(),
      fetchJsonSafe(TEAM_STRENGTH_FILE, { teams: {} }),
    ]);

    if (!league || league.detail === "not found") {
      throw new Error("League not found. Double-check LEAGUE_ID in js/config.js.");
    }

    document.title = (SITE_TITLE || league.name || "League") + " — Home";
    document.getElementById("sb-eyebrow").textContent = `${league.season} SEASON`;
    document.getElementById("sb-title").textContent = league.name || "Fantasy League";

    // ---- Figure out which week to show matchups for ----
    let week = null;
    if (league.status === "in_season" && String(league.season) === String(nflState.season)) {
      week = nflState.week;
    } else if (league.status === "complete") {
      const playoffStart = (league.settings && league.settings.playoff_week_start) || 15;
      week = Math.max(1, playoffStart - 1); // last regular-season week as a reasonable default
    }

    document.getElementById("sb-sub").textContent =
      league.status === "pre_draft"
        ? "Season hasn't started yet"
        : week
        ? `Week ${week}`
        : "";

    // ---- Standings ----
    const standings = SleeperAPI.buildStandings(rosters, users);
    const strengthByUsername = (teamStrength && teamStrength.teams) || {};
    const tbody = document.getElementById("standings-body");
    tbody.innerHTML = standings
      .map((t, i) => {
        const strength = t.username && strengthByUsername[t.username];
        return `
      <tr>
        <td class="rank">${i + 1}</td>
        <td class="team-cell">${escapeHtml(t.teamName)}</td>
        <td>${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
        <td>${t.fpts.toFixed(1)}</td>
        <td>${strength ? "#" + strength.rank : "—"}</td>
      </tr>`;
      })
      .join("");

    const rosNoteEl = document.getElementById("ros-note");
    if (rosNoteEl) {
      rosNoteEl.textContent = teamStrength && teamStrength.asOf ? `ROS strength as of ${teamStrength.asOf}, via FantasyPros` : "";
    }

    // ---- This week's matchups + ticker stats ----
    const matchupsEl = document.getElementById("matchups-list");
    const tickerEl = document.getElementById("sb-ticker");

    if (!week) {
      matchupsEl.innerHTML = `<div class="empty-state">No matchups to show right now.</div>`;
    } else {
      const rawMatchups = await SleeperAPI.getMatchups(LEAGUE_ID, week).catch(() => []);

      if (!rawMatchups || rawMatchups.length === 0) {
        matchupsEl.innerHTML = `<div class="empty-state">Matchups for week ${week} aren't posted yet.</div>`;
      } else {
        const nameByRoster = new Map(standings.map((t) => [t.rosterId, t.teamName]));
        const byMatchupId = new Map();
        rawMatchups.forEach((m) => {
          if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
          byMatchupId.get(m.matchup_id).push(m);
        });

        let topScore = { name: "—", pts: -Infinity };
        let closest = { diff: Infinity, a: null, b: null };

        const cards = [];
        byMatchupId.forEach((pair) => {
          if (pair.length < 2) return; // bye week / odd roster count
          const [a, b] = pair.sort((x, y) => (y.points || 0) - (x.points || 0));
          const aName = nameByRoster.get(a.roster_id) || `Roster ${a.roster_id}`;
          const bName = nameByRoster.get(b.roster_id) || `Roster ${b.roster_id}`;

          [{ name: aName, pts: a.points }, { name: bName, pts: b.points }].forEach((t) => {
            if (t.pts > topScore.pts) topScore = t;
          });
          const diff = Math.abs((a.points || 0) - (b.points || 0));
          if (diff < closest.diff) closest = { diff, a: aName, b: bName };

          cards.push(`
            <div class="matchup">
              <div class="side">
                <span class="name">${escapeHtml(aName)}</span>
                <span class="pts lead">${(a.points || 0).toFixed(1)}</span>
              </div>
              <span class="vs">VS</span>
              <div class="side right">
                <span class="name">${escapeHtml(bName)}</span>
                <span class="pts trail">${(b.points || 0).toFixed(1)}</span>
              </div>
            </div>`);
        });

        matchupsEl.innerHTML = cards.join("") || `<div class="empty-state">No matchups posted yet.</div>`;

        if (topScore.pts > -Infinity) {
          tickerEl.innerHTML = `
            <div class="ticker-stat">
              <span class="label">Top Score</span>
              <span class="value">${topScore.pts.toFixed(1)} · ${escapeHtml(topScore.name)}</span>
            </div>
            <div class="ticker-stat">
              <span class="label">Closest Game</span>
              <span class="value">${closest.diff.toFixed(1)} pt gap</span>
            </div>`;
        }
      }
    }
  } catch (err) {
    console.error(err);
    errorBox.textContent =
      "Couldn't load league data — " +
      err.message +
      ". If you haven't set your league ID yet, open js/config.js and paste it in.";
    errorBox.style.display = "block";
  }
}

document.addEventListener("DOMContentLoaded", renderDashboard);
