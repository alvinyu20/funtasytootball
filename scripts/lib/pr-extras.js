/*
  Power Rankings extras: three views of the same finished games that the
  Power Rankings table summarises in a single number.

    sos      Strength of Schedule. The old "SOS" column on Home and Seasons is
             really Points Against per game (the average of the scores the
             team's opponents posted against it). The real question is how good
             those opponents are in their OTHER games, so "true SOS" is, for
             every game a team played, the opponent's average score in all of
             its other games (the game against this team left out), averaged
             over the season. "Road ahead" looks forward: the remaining
             regular-season schedule, with each opponent's current points per
             game as the strength proxy, shown as distance from the league
             average.
    scores   Every finished week's score for every team (the strip plot), plus
             each team's low / high / average.
    slots    Per starter slot (QB, RB1, RB2 ... DEF), each team's average points
             per game minus the league's average for that same slot, plus the
             sum across all slots. Reuses DeepHistory.buildPositionTable, the
             same slot-labelling the Seasons page uses.

  Everything here is a pure function of finished regular-season weeks (the
  caller passes only weeks that are final, same rule as the rest of the
  Power Rankings), so a half-played week can never leak in. The playoff weeks
  are left out on purpose: Avg PPG in the table is a regular-season number and
  these views should agree with it.

  Output is written by scripts/update-power-rankings.js to
  data/power-rankings-extras.json; js/power-rankings.js only draws it.
*/

const round2 = (x) => Math.round(x * 100) / 100;

// Weeks that count: regular season only (before the first playoff week).
function regularSeasonWeeks(weeks, playoffStart) {
  return (weeks || []).filter((w) => playoffStart == null || w.week < playoffStart);
}

// A week's matchups as [[a, b], ...]: only real two-team games. A bye (no
// matchup_id) or an unpaired row counts for nothing, same as the standings.
function gamePairs(matchups) {
  const byId = new Map();
  (matchups || []).forEach((m) => {
    if (m.matchup_id == null) return;
    if (!byId.has(m.matchup_id)) byId.set(m.matchup_id, []);
    byId.get(m.matchup_id).push(m);
  });
  return [...byId.values()].filter((pair) => pair.length === 2);
}

// 1 = highest value. Equal values share a rank (1, 2, 2, 4).
function rankDescending(values) {
  return values.map((v) => (v == null ? null : 1 + values.filter((o) => o != null && o > v).length));
}

// Every team's finished games, oldest first: { week, opp, pts, oppPts }.
function gamesByTeam(teams, weeks) {
  const games = new Map(teams.map((t) => [t.rosterId, []]));
  [...weeks]
    .sort((a, b) => a.week - b.week)
    .forEach(({ week, matchups }) => {
      gamePairs(matchups).forEach(([a, b]) => {
        const ga = games.get(a.roster_id);
        const gb = games.get(b.roster_id);
        if (!ga || !gb) return;
        ga.push({ week, opp: b.roster_id, pts: a.points || 0, oppPts: b.points || 0 });
        gb.push({ week, opp: a.roster_id, pts: b.points || 0, oppPts: a.points || 0 });
      });
    });
  return games;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/*
  teams: [{ rosterId, teamName, record }]
  weeks: finished regular-season weeks [{ week, matchups }]
  scheduleWeeks: every week Sleeper has a schedule for (finished or not)
  Returns null when there isn't enough to say anything yet (no finished week).
*/
function buildStrengthOfSchedule({ teams, weeks, scheduleWeeks, playoffStart }) {
  const games = gamesByTeam(teams, weeks);
  const all = [...games.values()].flat();
  if (!all.length) return null;

  const total = new Map();
  const count = new Map();
  games.forEach((gs, id) => {
    total.set(id, gs.reduce((s, g) => s + g.pts, 0));
    count.set(id, gs.length);
  });
  const leagueAvgPpg = mean(all.map((g) => g.pts));

  const lastWeek = Math.max(...weeks.map((w) => w.week));
  const rows = teams.map((t) => {
    const gs = games.get(t.rosterId) || [];
    // The opponent's average in its other games: its season total minus the
    // score it posted against THIS team, over one fewer game. Needs the
    // opponent to have another game to average, which is why Week 1 alone
    // has no true SOS.
    const otherAvgs = gs
      .filter((g) => count.get(g.opp) > 1)
      .map((g) => (total.get(g.opp) - g.oppPts) / (count.get(g.opp) - 1));
    return {
      rosterId: t.rosterId,
      teamName: t.teamName,
      record: t.record,
      games: gs.length,
      paPerGame: gs.length ? mean(gs.map((g) => g.oppPts)) : null,
      trueSos: otherAvgs.length ? mean(otherAvgs) : null,
    };
  });

  const paRanks = rankDescending(rows.map((r) => r.paPerGame));
  const trueRanks = rankDescending(rows.map((r) => r.trueSos));

  // Road ahead: the rest of the regular season, opponents rated by their
  // current points per game.
  const ppgNow = new Map([...games.keys()].map((id) => [id, count.get(id) ? total.get(id) / count.get(id) : null]));
  const aheadGames = new Map(teams.map((t) => [t.rosterId, []]));
  const remainingWeeks = (scheduleWeeks || []).filter((w) => w.week > lastWeek && (playoffStart == null || w.week < playoffStart));
  remainingWeeks.forEach(({ matchups }) => {
    gamePairs(matchups).forEach(([a, b]) => {
      if (aheadGames.has(a.roster_id) && ppgNow.get(b.roster_id) != null) aheadGames.get(a.roster_id).push(ppgNow.get(b.roster_id));
      if (aheadGames.has(b.roster_id) && ppgNow.get(a.roster_id) != null) aheadGames.get(b.roster_id).push(ppgNow.get(a.roster_id));
    });
  });

  const out = rows.map((r, i) => {
    const ahead = aheadGames.get(r.rosterId);
    return {
      ...r,
      paPerGame: r.paPerGame == null ? null : round2(r.paPerGame),
      trueSos: r.trueSos == null ? null : round2(r.trueSos),
      paRank: paRanks[i],
      trueRank: trueRanks[i],
      ahead: ahead.length ? { games: ahead.length, oppPpg: round2(mean(ahead)), delta: round2(mean(ahead) - leagueAvgPpg) } : null,
    };
  });
  // Hardest true schedule first; teams without one (Week 1 only) go last.
  out.sort((a, b) => (a.trueRank == null) - (b.trueRank == null) || a.trueRank - b.trueRank || a.teamName.localeCompare(b.teamName));

  const remainingNumbers = remainingWeeks.filter((w) => gamePairs(w.matchups).length).map((w) => w.week);
  return {
    leagueAvgPpg: round2(leagueAvgPpg),
    remaining: remainingNumbers.length ? { fromWeek: Math.min(...remainingNumbers), toWeek: Math.max(...remainingNumbers), games: remainingNumbers.length } : null,
    rows: out,
  };
}

/*
  One score per team per finished week (null for a week with no game), plus
  low / high / average over the weeks played. Sorted by average, best first.
*/
function buildWeeklyScores({ teams, weeks }) {
  const games = gamesByTeam(teams, weeks);
  const all = [...games.values()].flat();
  if (!all.length) return null;
  const lastWeek = Math.max(...weeks.map((w) => w.week));
  const rows = teams
    .map((t) => {
      const gs = games.get(t.rosterId) || [];
      const scores = Array.from({ length: lastWeek }, () => null);
      gs.forEach((g) => {
        scores[g.week - 1] = round2(g.pts);
      });
      const pts = gs.map((g) => g.pts);
      return {
        rosterId: t.rosterId,
        teamName: t.teamName,
        scores,
        avg: pts.length ? round2(mean(pts)) : null,
        low: pts.length ? round2(Math.min(...pts)) : null,
        high: pts.length ? round2(Math.max(...pts)) : null,
      };
    })
    .filter((r) => r.avg != null);
  rows.sort((a, b) => b.avg - a.avg || a.teamName.localeCompare(b.teamName));
  return { leagueAvgPpg: round2(mean(all.map((g) => g.pts))), rows };
}

// buildPositionTable lists K and DEF before the flex slots; a lineup reads
// QB, RB, RB, WR, WR, TE, FLEX, SUPERFLEX, K, DEF, so order the columns the way
// the league's roster_positions do (numbered slots, RB1 then RB2, stay in order).
function lineupOrder(columns, rosterPositions) {
  const slots = rosterPositions || [];
  const place = (key) => {
    const i = slots.indexOf(key.replace(/\d+$/, ""));
    return i === -1 ? slots.length : i;
  };
  const number = (key) => Number((key.match(/(\d+)$/) || [0, 0])[1]);
  return [...columns].sort((a, b) => place(a.key) - place(b.key) || number(a.key) - number(b.key));
}

/*
  buildPositionTable is DeepHistory's; passed in so this file stays free of
  the browser-script loading. Each cell is the team's average in that slot
  minus the league's average in that slot (the mean of the teams' averages,
  so every team counts equally); total is the sum over the slots the team
  filled. Sorted by total, best first.
*/
function buildSlotGaps({ teams, weeks, league, playerDirectory, buildPositionTable }) {
  if (!weeks.length) return null;
  const rosterInfo = new Map(teams.map((t) => [t.rosterId, { teamName: t.teamName, username: t.teamName, userId: t.userId }]));
  const table = buildPositionTable(rosterInfo, league, { weeks }, playerDirectory);
  if (!table || !table.columns || !table.columns.length || !table.rows.length) return null;

  const columns = lineupOrder(table.columns, league && league.roster_positions);
  const leagueAvg = {};
  columns.forEach((col) => {
    const vals = table.rows.map((r) => r.cells[col.key]).filter((v) => v != null);
    leagueAvg[col.key] = vals.length ? mean(vals) : null;
  });

  const rows = table.rows.map((r) => {
    const cells = {};
    let total = 0;
    columns.forEach((col) => {
      const v = r.cells[col.key];
      if (v == null || leagueAvg[col.key] == null) {
        cells[col.key] = null;
        return;
      }
      cells[col.key] = round2(v - leagueAvg[col.key]);
      total += v - leagueAvg[col.key];
    });
    return { rosterId: r.rosterId, teamName: r.teamName, cells, total: round2(total) };
  });
  rows.sort((a, b) => b.total - a.total || a.teamName.localeCompare(b.teamName));

  const roundedAvg = {};
  Object.keys(leagueAvg).forEach((k) => {
    roundedAvg[k] = leagueAvg[k] == null ? null : round2(leagueAvg[k]);
  });
  return { columns: columns.map((c) => ({ key: c.key, label: c.label })), leagueAvg: roundedAvg, rows };
}

/*
  The whole file. `week` is the snapshot's week (what the page checks the file
  against); `teams` are the Power Rankings rows. The three sections are each
  null when their data isn't there yet, and the page simply skips them.
*/
function buildPowerRankingsExtras({ season, week, generatedAt, teams, league, weeks, scheduleWeeks, playerDirectory, buildPositionTable }) {
  const playoffStart = league && league.settings ? league.settings.playoff_week_start : null;
  const finished = regularSeasonWeeks(weeks, playoffStart);
  const roster = teams.map((t) => ({ rosterId: t.rosterId, userId: t.userId, teamName: t.teamName, record: t.record }));
  return {
    _instructions:
      "The Power Rankings page's Strength of Schedule, Weekly Scores and Lineup Slot sections read this file. scripts/update-power-rankings.js writes it next to the snapshot (same week); never edit it by hand.",
    generatedAt,
    season: String(season),
    week,
    sos: buildStrengthOfSchedule({ teams: roster, weeks: finished, scheduleWeeks, playoffStart }),
    scores: buildWeeklyScores({ teams: roster, weeks: finished }),
    slots: buildSlotGaps({ teams: roster, weeks: finished, league, playerDirectory, buildPositionTable }),
  };
}

module.exports = {
  regularSeasonWeeks,
  gamePairs,
  rankDescending,
  lineupOrder,
  buildStrengthOfSchedule,
  buildWeeklyScores,
  buildSlotGaps,
  buildPowerRankingsExtras,
};
