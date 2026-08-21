async function renderDashboard() {
  const errorBox = document.getElementById("dash-error");

  try {
    // ---- Phase 1: fast, essential data (standings, matchups, ROS) ----
    const [league, rosters, users, nflState, teamStrength, playerDirectory] = await Promise.all([
      SleeperAPI.getLeague(LEAGUE_ID),
      SleeperAPI.getRosters(LEAGUE_ID),
      SleeperAPI.getUsers(LEAGUE_ID),
      SleeperAPI.getNflState(),
      fetchJsonSafe(TEAM_STRENGTH_FILE, { teams: {} }),
      SleeperAPI.getPlayerDirectory(),
    ]);

    if (!league || league.detail === "not found") {
      throw new Error("League not found. Double-check LEAGUE_ID in js/config.js.");
    }

    document.title = (SITE_TITLE || league.name || "League") + " — Home";
    document.getElementById("sb-eyebrow").textContent = `${league.season} SEASON`;
    document.getElementById("sb-title").textContent = league.name || "Fantasy League";

    let week = null;
    if (league.status === "in_season" && String(league.season) === String(nflState.season)) {
      week = nflState.week;
    } else if (league.status === "complete") {
      const playoffStart = (league.settings && league.settings.playoff_week_start) || 15;
      week = Math.max(1, playoffStart - 1); // last regular-season week as a reasonable default
    }

    document.getElementById("sb-sub").textContent =
      league.status === "pre_draft" ? "Season hasn't started yet" : week ? `Week ${week}` : "";

    const standings = SleeperAPI.buildStandings(rosters, users);

    renderStandingsTable(standings, teamStrength, league.settings && league.settings.playoff_teams);

    let rawMatchups = [];
    if (week) {
      rawMatchups = await SleeperAPI.getMatchups(LEAGUE_ID, week).catch(() => []);
    }
    renderMatchupsAndFeatured(rawMatchups, standings, week);

    fetchJsonSafe(SEASON_AWARDS_FILE, { seasons: {} }).then(renderHistoryCallout);

    // ---- Phase 2: heavier data (full-season fetch), doesn't block the above ----
    if (league.status !== "pre_draft" && week) {
      renderStreaksAndPowerRankings(league, rosters, users, playerDirectory, teamStrength);
      renderRecentActivity(LEAGUE_ID, week, rosters, users, playerDirectory);
    } else {
      document.getElementById("streaks-panel").innerHTML = `<div class="empty-state">Check back once the season starts.</div>`;
      document.getElementById("power-rankings-snapshot").innerHTML = `<div class="empty-state">Check back once the season starts.</div>`;
      document.getElementById("recent-activity-panel").innerHTML = `<div class="empty-state">No activity yet.</div>`;
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

function renderStandingsTable(standings, teamStrength, playoffTeams) {
  const strengthByUsername = (teamStrength && teamStrength.teams) || {};
  const tbody = document.getElementById("standings-body");
  tbody.innerHTML = standings
    .map((t, i) => {
      const strength = t.username && strengthByUsername[t.username];
      const row = `
      <tr>
        <td class="rank">${i + 1}</td>
        <td class="team-cell">${escapeHtml(t.teamName)}</td>
        <td>${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
        <td>${t.fpts.toFixed(1)}</td>
        <td>${strength ? "#" + strength.rank : "—"}</td>
      </tr>`;
      if (playoffTeams && i + 1 === playoffTeams && i + 1 < standings.length) {
        return row + `<tr class="playoff-cutoff-row"><td colspan="5" class="playoff-cutoff-label">Playoff Line</td></tr>`;
      }
      return row;
    })
    .join("");

  const rosNoteEl = document.getElementById("ros-note");
  if (rosNoteEl) {
    rosNoteEl.textContent = teamStrength && teamStrength.asOf ? `ROS strength as of ${teamStrength.asOf}, via FantasyPros` : "";
  }
}

function renderMatchupsAndFeatured(rawMatchups, standings, week) {
  const matchupsEl = document.getElementById("matchups-list");
  const tickerEl = document.getElementById("sb-ticker");
  const featuredEl = document.getElementById("featured-matchup-panel");

  if (!week) {
    matchupsEl.innerHTML = `<div class="empty-state">No matchups to show right now.</div>`;
    featuredEl.innerHTML = `<div class="empty-state">No matchups to feature yet.</div>`;
    return;
  }
  if (!rawMatchups || rawMatchups.length === 0) {
    matchupsEl.innerHTML = `<div class="empty-state">Matchups for week ${week} aren't posted yet.</div>`;
    featuredEl.innerHTML = `<div class="empty-state">Matchups for week ${week} aren't posted yet.</div>`;
    return;
  }

  const nameByRoster = new Map(standings.map((t) => [t.rosterId, t.teamName]));
  const standingsByRoster = new Map(standings.map((t) => [t.rosterId, t]));
  const byMatchupId = new Map();
  rawMatchups.forEach((m) => {
    if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
    byMatchupId.get(m.matchup_id).push(m);
  });

  let topScore = { name: "—", pts: -Infinity };
  let closest = { diff: Infinity, a: null, b: null };
  let featuredPair = null;
  let featuredWins = -1;

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

    const sa = standingsByRoster.get(a.roster_id);
    const sb = standingsByRoster.get(b.roster_id);
    const combinedWins = (sa ? sa.wins : 0) + (sb ? sb.wins : 0);
    if (combinedWins > featuredWins) {
      featuredWins = combinedWins;
      featuredPair = { a, b, aName, bName, sa, sb };
    }

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

  if (featuredPair) {
    const { a, b, aName, bName, sa, sb } = featuredPair;
    featuredEl.innerHTML = `
      <div class="featured-matchup">
        <div class="side">
          <div class="name">${escapeHtml(aName)}</div>
          <div class="record">${sa ? `${sa.wins}-${sa.losses}${sa.ties ? "-" + sa.ties : ""}` : ""}</div>
          <div class="pts">${(a.points || 0).toFixed(1)}</div>
        </div>
        <div class="vs">VS</div>
        <div class="side">
          <div class="name">${escapeHtml(bName)}</div>
          <div class="record">${sb ? `${sb.wins}-${sb.losses}${sb.ties ? "-" + sb.ties : ""}` : ""}</div>
          <div class="pts">${(b.points || 0).toFixed(1)}</div>
        </div>
      </div>
      <div class="featured-matchup-sub">Week ${week} · best combined record on the slate</div>`;
  } else {
    featuredEl.innerHTML = `<div class="empty-state">No matchups to feature yet.</div>`;
  }
}

function renderHistoryCallout(seasonAwards) {
  const el = document.getElementById("history-callout");
  const entries = [];
  if (seasonAwards && seasonAwards.seasons) {
    Object.entries(seasonAwards.seasons).forEach(([year, categories]) => {
      Object.entries(categories).forEach(([category, award]) => {
        const winner = award.username || award.winnerName;
        if (winner) entries.push({ year, category, winner, detail: award.detail });
      });
    });
  }
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state">No league history recorded yet.</div>`;
    return;
  }
  // Deterministic pick based on the day of the year, so it changes daily
  // but stays stable within a single day (not re-randomized every reload).
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const pick = entries[dayOfYear % entries.length];
  el.innerHTML = `
    <div class="history-callout-inner">
      <span class="history-callout-icon">📜</span>
      <div>
        <div class="history-callout-eyebrow">From The Archives · ${escapeHtml(String(pick.year))}</div>
        <div class="history-callout-text"><strong>${escapeHtml(pick.winner)}</strong> won <strong>${escapeHtml(pick.category)}</strong>${
    pick.detail ? ` with ${escapeHtml(pick.detail)}` : ""
  }.</div>
      </div>
    </div>`;
}

function computeCurrentStreaks(deepWeeks, rosterInfo) {
  const resultsByRoster = new Map();
  deepWeeks.forEach(({ week, matchups }) => {
    const pairs = new Map();
    matchups.forEach((m) => {
      if (m.matchup_id == null) return;
      if (!pairs.has(m.matchup_id)) pairs.set(m.matchup_id, []);
      pairs.get(m.matchup_id).push(m);
    });
    pairs.forEach((pair) => {
      if (pair.length < 2) return;
      const [a, b] = pair;
      [
        { rid: a.roster_id, own: a.points || 0, opp: b.points || 0 },
        { rid: b.roster_id, own: b.points || 0, opp: a.points || 0 },
      ].forEach(({ rid, own, opp }) => {
        const result = own > opp ? "W" : own < opp ? "L" : "T";
        if (!resultsByRoster.has(rid)) resultsByRoster.set(rid, []);
        resultsByRoster.get(rid).push({ week, result });
      });
    });
  });

  const streaks = [];
  resultsByRoster.forEach((results, rosterId) => {
    results.sort((a, b) => a.week - b.week);
    if (!results.length) return;
    let len = 0;
    let result = null;
    for (let i = results.length - 1; i >= 0; i--) {
      if (result === null) {
        result = results[i].result;
        len = 1;
      } else if (results[i].result === result) {
        len += 1;
      } else {
        break;
      }
    }
    if ((result === "W" || result === "L") && len >= 2) {
      const info = rosterInfo.get(rosterId);
      streaks.push({ teamName: info ? info.username || info.teamName : "Unknown", result, length: len });
    }
  });
  return streaks.sort((a, b) => b.length - a.length);
}

function renderStreaksPanel(streaks) {
  const el = document.getElementById("streaks-panel");
  const hot = streaks.filter((s) => s.result === "W").slice(0, 3);
  const cold = streaks.filter((s) => s.result === "L").slice(0, 3);
  if (!hot.length && !cold.length) {
    el.innerHTML = `<div class="empty-state">No streaks of 2+ games yet.</div>`;
    return;
  }
  el.innerHTML = [...hot, ...cold]
    .map(
      (s) => `
    <div class="streak-row">
      <span class="name">${escapeHtml(s.teamName)}</span>
      <span class="streak-badge ${s.result === "W" ? "hot" : "cold"}">${s.result === "W" ? "🔥" : "🥶"} ${s.length}${s.result}</span>
    </div>`
    )
    .join("");
}

function renderPowerRankingsSnapshot(pr, lastWeekRanks) {
  const el = document.getElementById("power-rankings-snapshot");
  const top3 = pr.rows.slice(0, 3);
  const fmtRank = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const rows = top3
    .map((r) => {
      let deltaHtml = `<span class="pr-mini-delta muted-inline">NEW</span>`;
      if (lastWeekRanks && lastWeekRanks[r.teamName] != null) {
        const diff = lastWeekRanks[r.teamName] - r.powerRank;
        if (diff > 0) deltaHtml = `<span class="pr-mini-delta luck-positive">▲${fmtRank(diff)}</span>`;
        else if (diff < 0) deltaHtml = `<span class="pr-mini-delta luck-negative">▼${fmtRank(Math.abs(diff))}</span>`;
        else deltaHtml = `<span class="pr-mini-delta muted-inline">–</span>`;
      }
      return `
      <div class="pr-mini-row">
        <span class="pr-mini-rank">#${fmtRank(r.powerRank)}</span>
        <span class="pr-mini-name">${escapeHtml(r.teamName)}</span>
        ${deltaHtml}
      </div>`;
    })
    .join("");
  el.innerHTML = rows + `<a class="dash-more-link" href="power-rankings.html">See Full Power Rankings →</a>`;
}

async function renderStreaksAndPowerRankings(league, rosters, users, playerDirectory, teamStrength) {
  try {
    const seasonEntry = { league, rosters, users, bracket: [] };
    const deep = await DeepHistory.fetchSeasonDeep(seasonEntry, () => {});

    if (!deep.weeks.length) {
      document.getElementById("streaks-panel").innerHTML = `<div class="empty-state">No games played yet.</div>`;
      document.getElementById("power-rankings-snapshot").innerHTML = `<div class="empty-state">No games played yet.</div>`;
      return;
    }

    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const rosterInfo = new Map();
    rosters.forEach((r) => {
      const user = usersById.get(r.owner_id);
      rosterInfo.set(r.roster_id, { teamName: SleeperAPI.teamName(user, r.roster_id), username: user ? user.display_name : null });
    });
    renderStreaksPanel(computeCurrentStreaks(deep.weeks, rosterInfo));

    const teamStrengthTeams = (teamStrength && teamStrength.teams) || {};
    const pr = DeepHistory.computePowerRankings(seasonEntry, deep, playerDirectory, teamStrengthTeams, 1000);
    const powerRankHistory = await fetchJsonSafe(POWER_RANK_HISTORY_FILE, { seasons: {} });
    const seasonHistory = (powerRankHistory.seasons && powerRankHistory.seasons[String(pr.season)]) || {};
    const lastWeekRanks = seasonHistory[String(pr.week - 1)] || null;
    renderPowerRankingsSnapshot(pr, lastWeekRanks);
  } catch (err) {
    console.error(err);
    document.getElementById("streaks-panel").innerHTML = `<div class="empty-state">Couldn't load streak data.</div>`;
    document.getElementById("power-rankings-snapshot").innerHTML = `<div class="empty-state">Couldn't load power rankings.</div>`;
  }
}

function describeTransaction(tx, rosterInfoByRosterId, playerDirectory) {
  const teamLabel = (rid) => {
    const roster = rosterInfoByRosterId.get(rid);
    return escapeHtml(roster ? roster.username || roster.teamName : "Unknown");
  };
  const playerLabel = (pid) => escapeHtml(SleeperAPI.playerName(playerDirectory, pid));

  if (tx.type === "trade") {
    const sides = (tx.roster_ids || []).map(teamLabel);
    if (sides.length < 2) return null;
    return `<div class="activity-item"><strong>Trade</strong> between ${sides.join(" and ")}<span class="activity-meta">Week ${tx.leg}</span></div>`;
  }

  const addedEntries = Object.entries(tx.adds || {});
  if (!addedEntries.length) return null;
  const bid = tx.settings && tx.settings.waiver_bid;
  return addedEntries
    .map(([pid, rid]) => {
      const label = bid ? `for $${bid} on waivers` : "as a free agent";
      return `<div class="activity-item">${teamLabel(rid)} added <strong>${playerLabel(pid)}</strong> ${label}<span class="activity-meta">Week ${tx.leg}</span></div>`;
    })
    .join("");
}

async function renderRecentActivity(leagueId, currentWeek, rosters, users, playerDirectory) {
  const el = document.getElementById("recent-activity-panel");
  try {
    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const rosterInfoByRosterId = new Map(
      rosters.map((r) => {
        const user = usersById.get(r.owner_id);
        return [r.roster_id, { teamName: SleeperAPI.teamName(user, r.roster_id), username: user ? user.display_name : null }];
      })
    );

    const weeksToCheck = [currentWeek, currentWeek - 1].filter((w) => w >= 1);
    const results = await Promise.all(weeksToCheck.map((w) => SleeperAPI.getTransactions(leagueId, w).catch(() => [])));
    const all = results
      .flat()
      .filter((tx) => tx && tx.status === "complete" && (tx.type === "trade" || tx.type === "waiver" || tx.type === "free_agent"));
    all.sort((a, b) => (b.created || 0) - (a.created || 0));
    const recent = all.slice(0, 6);

    if (!recent.length) {
      el.innerHTML = `<div class="empty-state">No moves yet this week.</div>`;
      return;
    }

    const items = recent
      .map((tx) => describeTransaction(tx, rosterInfoByRosterId, playerDirectory))
      .filter(Boolean)
      .join("");
    el.innerHTML = items || `<div class="empty-state">No moves yet this week.</div>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="empty-state">Couldn't load recent activity.</div>`;
  }
}

document.addEventListener("DOMContentLoaded", renderDashboard);
