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

    const lastWeek = week && week > 1 ? week - 1 : null;
    const [rawMatchups, rawMatchupsLastWeek] = await Promise.all([
      week ? SleeperAPI.getMatchups(LEAGUE_ID, week).catch(() => []) : Promise.resolve([]),
      lastWeek ? SleeperAPI.getMatchups(LEAGUE_ID, lastWeek).catch(() => []) : Promise.resolve([]),
    ]);
    const { pairs: matchupPairs } = renderMatchupsAndFeatured(rawMatchups, standings, week);
    const { pairs: lastWeekPairs } = renderLastWeekMatchups(rawMatchupsLastWeek, standings, lastWeek);
    initScrollAnimations();

    fetchJsonSafe(SEASON_AWARDS_FILE, { seasons: {} }).then(renderHistoryCallout);

    // ---- Phase 2: heavier data (full-season fetch), doesn't block the above ----
    const allH2hPairs = [...matchupPairs.map((p) => ({ ...p, idPrefix: "cur" })), ...lastWeekPairs.map((p) => ({ ...p, idPrefix: "last" }))];
    if (league.status !== "pre_draft" && week) {
      renderStreaksAndPowerRankings(league, rosters, users, week, playerDirectory, teamStrength);
      renderRecentActivity(LEAGUE_ID, week, rosters, users, playerDirectory);
      if (allH2hPairs.length) {
        renderMatchupHeadToHead(allH2hPairs, playerDirectory);
      }
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

// Phase 1 (fast): # / Team / Record / PF / ROS are all available straight
// from the light buildStandings() + team-strength.json fetch, so they
// render immediately. PA / Avg-Wk / Overall / Luck / SOS need the full
// single-season weekly fetch (DeepHistory.computeSeasonSummary), which is
// Phase 2 work -- those columns show "—" here and get filled in for real
// by renderEnrichedStandings below once that data lands. The column COUNT
// never changes between the two passes, just which cells have real values,
// so the table never jumps around.
const STANDINGS_COLSPAN = 10;

function renderStandingsTable(standings, teamStrength, playoffTeams) {
  const strengthByUsername = (teamStrength && teamStrength.teams) || {};
  const tbody = document.getElementById("standings-body");
  tbody.innerHTML = standings
    .map((t, i) => {
      const strength = t.username && strengthByUsername[t.username];
      const row = `
      <tr>
        <td class="rank" data-label="#">${i + 1}</td>
        <td class="team-cell" data-label="Team">${t.userId ? `<a href="teams.html#${encodeURIComponent(t.userId)}" class="subtle-link">${escapeHtml(t.teamName)}</a>` : escapeHtml(t.teamName)}</td>
        <td data-label="Record">${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
        <td data-label="PF">${t.fpts.toFixed(1)}</td>
        <td data-label="PA">—</td>
        <td data-label="Avg/Wk">—</td>
        <td data-label="Overall">—</td>
        <td data-label="Luck">—</td>
        <td data-label="ROS">${strength ? "#" + strength.rank : "—"}</td>
        <td data-label="SOS">—</td>
      </tr>`;
      if (playoffTeams && i + 1 === playoffTeams && i + 1 < standings.length) {
        return row + `<tr class="playoff-cutoff-row"><td colspan="${STANDINGS_COLSPAN}" class="playoff-cutoff-label">Playoff Line</td></tr>`;
      }
      return row;
    })
    .join("");

  const rosNoteEl = document.getElementById("ros-note");
  if (rosNoteEl) {
    rosNoteEl.textContent = teamStrength && teamStrength.asOf ? `ROS strength as of ${teamStrength.asOf}, via FantasyPros` : "";
  }
}

// Phase 2: replaces the table above with every column fully populated,
// once the single-season deep fetch (already needed for streaks/Power
// Rankings) is in hand. Reuses DeepHistory.computeSeasonSummary -- the
// same function the Season page itself builds its "Final Standings" table
// from -- so this is the same Record/PF/PA/Avg-Wk/Overall/Luck/SOS data,
// just for the in-progress current season. ROS keeps coming from
// team-strength.json (computeSeasonSummary doesn't know about that file).
function renderEnrichedStandings(league, rosters, users, deep, playerDirectory, teamStrength, playoffTeams) {
  try {
    const seasonEntry = { league, rosters, users, bracket: [] };
    const summary = DeepHistory.computeSeasonSummary(seasonEntry, deep, playerDirectory, null, null, null);
    const strengthByUsername = (teamStrength && teamStrength.teams) || {};

    const avgByRosterId = new Map();
    (summary.teamAverages || []).forEach((t) => {
      if (t.rosterId != null) avgByRosterId.set(t.rosterId, t.average);
    });

    const tbody = document.getElementById("standings-body");
    tbody.innerHTML = summary.standings
      .map((t, i) => {
        const strength = t.username && strengthByUsername[t.username];
        const row = `
        <tr>
          <td class="rank" data-label="#">${i + 1}</td>
          <td class="team-cell" data-label="Team">${t.userId ? `<a href="teams.html#${encodeURIComponent(t.userId)}" class="subtle-link">${escapeHtml(t.teamName)}</a>` : escapeHtml(t.teamName)}</td>
          <td data-label="Record">${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
          <td data-label="PF">${t.fpts.toFixed(1)}</td>
          <td data-label="PA">${t.fptsAgainst.toFixed(1)}</td>
          <td data-label="Avg/Wk">${avgByRosterId.has(t.rosterId) ? avgByRosterId.get(t.rosterId).toFixed(1) : "—"}</td>
          <td data-label="Overall">${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}</td>
          <td data-label="Luck">${luckBadge(t.luckPct)}</td>
          <td data-label="ROS">${strength ? "#" + strength.rank : "—"}</td>
          <td data-label="SOS">${t.avgOpponentPF != null ? t.avgOpponentPF.toFixed(1) : "—"}</td>
        </tr>`;
        if (playoffTeams && i + 1 === playoffTeams && i + 1 < summary.standings.length) {
          return row + `<tr class="playoff-cutoff-row"><td colspan="${STANDINGS_COLSPAN}" class="playoff-cutoff-label">Playoff Line</td></tr>`;
        }
        return row;
      })
      .join("");
  } catch (err) {
    // Best-effort enhancement -- Phase 1's lighter table above is still
    // correct (just missing a few columns), so leave it as-is rather than
    // replacing working data with an error state.
    console.warn("Couldn't load enriched standings:", err);
  }
}

// Shared by both the This Week's and Last Week's Matchups sections: one
// matchup card, team name primary (matching the rest of the Home page),
// username as a small subtitle right underneath, score to the side, and
// an empty head-to-head slot (filled in later, in the background, by
// renderMatchupHeadToHead) identified by idPrefix so the two sections'
// cards never collide even when the same two rosters appear in both.
function matchupCardHtml(a, b, aName, bName, aUsername, bUsername, idPrefix) {
  return `
      <div class="matchup">
        <div class="matchup-row">
          <div class="side">
            <span class="name">${escapeHtml(aName)}</span>
            ${aUsername ? `<span class="username-sub">${escapeHtml(aUsername)}</span>` : ""}
            <span class="pts lead">${(a.points || 0).toFixed(1)}</span>
          </div>
          <span class="vs">VS</span>
          <div class="side right">
            <span class="name">${escapeHtml(bName)}</span>
            ${bUsername ? `<span class="username-sub">${escapeHtml(bUsername)}</span>` : ""}
            <span class="pts trail">${(b.points || 0).toFixed(1)}</span>
          </div>
        </div>
        <div class="matchup-h2h" id="h2h-${idPrefix}-${a.roster_id}-${b.roster_id}"></div>
      </div>`;
}

function renderMatchupsAndFeatured(rawMatchups, standings, week) {
  const matchupsEl = document.getElementById("matchups-list");
  const tickerEl = document.getElementById("sb-ticker");
  const featuredEl = document.getElementById("featured-matchup-panel");

  if (!week) {
    matchupsEl.innerHTML = `<div class="empty-state">No matchups to show right now.</div>`;
    featuredEl.innerHTML = `<div class="empty-state">No matchups to feature yet.</div>`;
    return { topScore: null, closest: null, pairs: [] };
  }
  if (!rawMatchups || rawMatchups.length === 0) {
    matchupsEl.innerHTML = `<div class="empty-state">Matchups for week ${week} aren't posted yet.</div>`;
    featuredEl.innerHTML = `<div class="empty-state">Matchups for week ${week} aren't posted yet.</div>`;
    return { topScore: null, closest: null, pairs: [] };
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
  const pairs = []; // {rosterA, rosterB, userIdA, userIdB, aName, bName} -- for the head-to-head enrichment pass (Phase 2)
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

    pairs.push({
      rosterA: a.roster_id,
      rosterB: b.roster_id,
      userIdA: sa ? sa.userId : null,
      userIdB: sb ? sb.userId : null,
      aName,
      bName,
    });

    cards.push(matchupCardHtml(a, b, aName, bName, sa && sa.username, sb && sb.username, "cur"));
  });

  matchupsEl.innerHTML = cards.join("") || `<div class="empty-state">No matchups posted yet.</div>`;

  if (topScore.pts > -Infinity) {
    tickerEl.innerHTML = `
      <div class="ticker-stat">
        <span class="label">Top Score</span>
        <span class="value" data-count-up>${topScore.pts.toFixed(1)} · ${escapeHtml(topScore.name)}</span>
      </div>
      <div class="ticker-stat">
        <span class="label">Closest Game</span>
        <span class="value" data-count-up>${closest.diff.toFixed(1)} pt gap</span>
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

  return { topScore: topScore.pts > -Infinity ? topScore : null, closest: closest.diff < Infinity ? closest : null, pairs };
}

// Same card format as This Week's Matchups (team name, username subtitle,
// final score, empty h2h slot filled in later), but no ticker/featured
// side effects -- those are specific to the CURRENT week. idPrefix "last"
// keeps this section's h2h element ids distinct from "cur"'s.
function renderLastWeekMatchups(rawMatchups, standings, lastWeek) {
  const el = document.getElementById("last-week-matchups-list");
  if (!el) return { pairs: [] };

  if (!lastWeek) {
    el.innerHTML = `<div class="empty-state">No prior week yet this season.</div>`;
    return { pairs: [] };
  }
  if (!rawMatchups || rawMatchups.length === 0) {
    el.innerHTML = `<div class="empty-state">Week ${lastWeek} matchups aren't available.</div>`;
    return { pairs: [] };
  }

  const nameByRoster = new Map(standings.map((t) => [t.rosterId, t.teamName]));
  const standingsByRoster = new Map(standings.map((t) => [t.rosterId, t]));
  const byMatchupId = new Map();
  rawMatchups.forEach((m) => {
    if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
    byMatchupId.get(m.matchup_id).push(m);
  });

  const cards = [];
  const pairs = [];
  byMatchupId.forEach((pair) => {
    if (pair.length < 2) return;
    const [a, b] = pair.sort((x, y) => (y.points || 0) - (x.points || 0));
    const aName = nameByRoster.get(a.roster_id) || `Roster ${a.roster_id}`;
    const bName = nameByRoster.get(b.roster_id) || `Roster ${b.roster_id}`;
    const sa = standingsByRoster.get(a.roster_id);
    const sb = standingsByRoster.get(b.roster_id);

    pairs.push({
      rosterA: a.roster_id,
      rosterB: b.roster_id,
      userIdA: sa ? sa.userId : null,
      userIdB: sb ? sb.userId : null,
      aName,
      bName,
    });

    cards.push(matchupCardHtml(a, b, aName, bName, sa && sa.username, sb && sb.username, "last"));
  });

  el.innerHTML = cards.join("") || `<div class="empty-state">No matchups posted that week.</div>`;
  return { pairs };
}

// Fills in each matchup card's all-time head-to-head line (both This
// Week's and Last Week's sections at once -- see idPrefix on each pair),
// once the full season history is available. Deliberately separate from
// (and run after) renderMatchupsAndFeatured/renderLastWeekMatchups: those
// functions' whole job is to get matchups on screen from the fast,
// single-call standings/matchups data, with no multi-season fetch
// blocking them. Head-to-head needs a manager's full career record
// against each opponent, which only exists after walking the entire
// season chain (the same fetchSeasonChain -> buildAll -> computeStats
// pipeline Teams/Records/Rivalries already use) -- a real
// network-and-compute cost best paid in the background, after the
// matchups the person actually came here to see are already on screen.
// The card itself still shows team names (matching the rest of the Home
// page), but the All-Time record line uses usernames, not team names.
async function renderMatchupHeadToHead(pairs, playerDirectory) {
  try {
    const seasonChain = await SleeperAPI.getSeasonChain(LEAGUE_ID);
    if (seasonChain.length === 0) return;
    const deepSeasons = await DeepHistory.buildAll(seasonChain, () => {});
    const { managers } = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);
    const h2hByUserId = new Map(managers.map((m) => [m.userId, m.headToHead]));
    const usernameByUserId = new Map(managers.map((m) => [m.userId, m.username || m.teamName]));

    pairs.forEach(({ rosterA, rosterB, userIdA, userIdB, aName, bName, idPrefix }) => {
      const el = document.getElementById(`h2h-${idPrefix}-${rosterA}-${rosterB}`);
      if (!el || !userIdA || !userIdB) return;
      const aUsername = usernameByUserId.get(userIdA) || aName;
      const bUsername = usernameByUserId.get(userIdB) || bName;
      const list = h2hByUserId.get(userIdA) || [];
      const rec = list.find((h) => h.opponentUserId === userIdB);
      if (!rec) {
        el.textContent = "First-ever meeting";
        return;
      }
      const total = rec.wins + rec.losses + rec.ties;
      if (!total) {
        el.textContent = "First-ever meeting";
        return;
      }
      const tieStr = rec.ties ? `-${rec.ties}` : "";
      el.textContent = `All-Time: ${aUsername} ${rec.wins}-${rec.losses}${tieStr} ${bUsername}`;
    });
  } catch (err) {
    // Best-effort enhancement -- the matchup cards above already rendered
    // fine without this, so a failure here (e.g. a season in the chain
    // failing to fetch) just means the h2h line stays empty, not an error
    // banner over working matchup data.
    console.warn("Couldn't load head-to-head history for this week's matchups:", err);
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

function renderPowerRankingsSnapshot(snapshot, lastWeekRanks) {
  const el = document.getElementById("power-rankings-snapshot");
  if (!snapshot || !snapshot.rows || !snapshot.rows.length) {
    el.innerHTML = `<div class="empty-state">No power rankings yet.</div>`;
    return;
  }
  const fmtRank = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // Preseason rows are just {rank, username, teamName} — there's no PR
  // Score/record/playoff odds yet to build a real ranking from, so this
  // is a plain top-3 list with no delta column rather than trying to
  // force the full-season row shape onto data that doesn't have it.
  if (snapshot.preseason) {
    const rows = snapshot.rows
      .slice(0, 3)
      .map(
        (r) => `
      <div class="pr-mini-row">
        <span class="pr-mini-rank">#${r.rank}</span>
        <span class="pr-mini-name">${escapeHtml(r.username)}</span>
        <span class="pr-mini-delta muted-inline">PRESEASON</span>
      </div>`
      )
      .join("");
    el.innerHTML = rows + `<a class="dash-more-link" href="power-rankings.html">See Full Power Rankings →</a>`;
    return;
  }

  const top3 = snapshot.rows.slice(0, 3);
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

// Streaks are computed live (deterministic from actual results — no
// randomness involved, so there's nothing to gain from freezing them
// into a snapshot the way Power Rankings needed). Power Rankings and
// the clinch/eliminate hero story, though, both come from
// data/power-rankings-snapshot.json — the same saved-not-live snapshot
// scripts/update-power-rankings.js writes, exactly as on the dedicated
// Power Rankings page. This used to call DeepHistory.computePowerRankings
// directly here too, which re-ran an unseeded Monte Carlo simulation on
// every single page load — different random playoff odds (and
// therefore a different top-3 order) on every refresh. Reading the same
// saved snapshot this page's dedicated view uses fixes that by
// construction: both places now show the exact same numbers, updated
// only when someone actually runs the update script.
async function renderStreaksAndPowerRankings(league, rosters, users, week, playerDirectory, teamStrength) {
  try {
    const seasonEntry = { league, rosters, users, bracket: [] };
    const [deep, snapshot, powerRankHistory] = await Promise.all([
      DeepHistory.fetchSeasonDeep(seasonEntry, () => {}),
      fetchJsonSafe(POWER_RANKINGS_SNAPSHOT_FILE, null),
      fetchJsonSafe(POWER_RANK_HISTORY_FILE, { seasons: {} }),
    ]);

    let streaks = [];
    if (deep.weeks.length) {
      const usersById = new Map(users.map((u) => [u.user_id, u]));
      const rosterInfo = new Map();
      rosters.forEach((r) => {
        const user = usersById.get(r.owner_id);
        rosterInfo.set(r.roster_id, { teamName: SleeperAPI.teamName(user, r.roster_id), username: user ? user.display_name : null });
      });
      streaks = computeCurrentStreaks(deep.weeks, rosterInfo);
      renderStreaksPanel(streaks);
    } else {
      document.getElementById("streaks-panel").innerHTML = `<div class="empty-state">No games played yet.</div>`;
    }

    const prRows = snapshot && !snapshot.preseason ? snapshot.rows : null;
    let lastWeekRanks = null;
    if (prRows) {
      const seasonHistory = (powerRankHistory.seasons && powerRankHistory.seasons[String(snapshot.season)]) || {};
      lastWeekRanks = seasonHistory[String(snapshot.week - 1)] || null;
    }
    renderPowerRankingsSnapshot(snapshot, lastWeekRanks);

    renderEnrichedStandings(league, rosters, users, deep, playerDirectory, teamStrength, league.settings && league.settings.playoff_teams);
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
  const playerLabel = (pid) => playerLinkHtml(pid, escapeHtml(SleeperAPI.playerName(playerDirectory, pid)));

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
