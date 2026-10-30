/*
  A tiny synthetic league, shaped like what Sleeper returns, for testing
  js/metrics.js. Nothing here is real data: every player scores a flat,
  hand-picked number of points each week, so the expected answers in the
  tests can be worked out by hand.

  buildLeague({...}) returns what Metrics.prepareSeason() takes:
    { seasonEntry: { league, rosters, users, bracket }, deep, playerDirectory }
*/

const ELIGIBLE = {
  FLEX: ["RB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
};

// Starters = the best lineup the roster could field that week. Plain greedy
// fill, written separately from Metrics.bestLineup so the two can check each
// other's work.
function autoStarters(slots, roster, positionOf, pointsOf) {
  const order = slots.filter((s) => s !== "BN").sort((a, b) => (ELIGIBLE[a] || [a]).length - (ELIGIBLE[b] || [b]).length);
  const used = new Set();
  const starters = [];
  order.forEach((slot) => {
    const ok = ELIGIBLE[slot] || [slot];
    const best = roster
      .filter((pid) => !used.has(pid) && ok.includes(positionOf(pid)))
      .sort((a, b) => pointsOf(b) - pointsOf(a))[0];
    if (best) {
      used.add(best);
      starters.push(best);
    }
  });
  return starters;
}

function buildLeague(opts) {
  const o = Object.assign(
    {
      season: "2024",
      status: "complete",
      teams: 4,
      rosterPositions: ["QB", "RB", "WR", "K", "DEF", "BN"],
      weeks: [1, 2, 3, 4, 5, 6],
      playoffStart: 7,
      players: {}, // pid -> { position, name }
      rosterOf: () => [], // (rosterId, week) -> [pid]
      pointsOf: () => 0, // (pid, week) -> points, only called for rostered players
      startersOf: null, // (rosterId, week, roster) -> [pid]; default best lineup
      pairs: null, // [[a, b], ...]; default 1v2, 3v4...
      picks: [],
      transactions: [],
      bracket: [],
    },
    opts
  );
  const names = Array.from({ length: o.teams }, (_, i) => `manager${i + 1}`);
  const users = names.map((n, i) => ({ user_id: `u${i + 1}`, display_name: n, metadata: {} }));
  const rosters = names.map((n, i) => ({ roster_id: i + 1, owner_id: `u${i + 1}`, settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } }));
  const playerDirectory = {};
  Object.entries(o.players).forEach(([pid, p]) => {
    playerDirectory[pid] = { player_id: pid, position: p.position, full_name: p.name || pid, first_name: p.name || pid, last_name: "" };
  });
  const positionOf = (pid) => (playerDirectory[pid] || {}).position;
  const pairs = o.pairs || Array.from({ length: Math.floor(o.teams / 2) }, (_, i) => [i * 2 + 1, i * 2 + 2]);

  const weeks = o.weeks.map((week) => {
    const byRid = {};
    rosters.forEach((r) => {
      const roster = o.rosterOf(r.roster_id, week);
      const players_points = {};
      roster.forEach((pid) => {
        players_points[pid] = o.pointsOf(pid, week);
      });
      const starters = o.startersOf
        ? o.startersOf(r.roster_id, week, roster)
        : autoStarters(o.rosterPositions, roster, positionOf, (pid) => players_points[pid]);
      byRid[r.roster_id] = {
        roster_id: r.roster_id,
        players: roster,
        starters,
        players_points,
        points: starters.reduce((a, pid) => a + (players_points[pid] || 0), 0),
      };
    });
    const matchups = [];
    pairs.forEach(([a, b], i) => {
      byRid[a].matchup_id = i + 1;
      byRid[b].matchup_id = i + 1;
    });
    Object.values(byRid).forEach((m) => matchups.push(m));
    return { week, matchups };
  });

  // season records, so pointsPerWin() has something to read
  if (o.status === "complete") {
    weeks.forEach(({ week, matchups }) => {
      if (week >= o.playoffStart) return;
      pairs.forEach(([a, b]) => {
        const ma = matchups.find((m) => m.roster_id === a);
        const mb = matchups.find((m) => m.roster_id === b);
        const ra = rosters[a - 1].settings;
        const rb = rosters[b - 1].settings;
        ra.fpts += ma.points;
        rb.fpts += mb.points;
        if (ma.points > mb.points) {
          ra.wins += 1;
          rb.losses += 1;
        } else if (mb.points > ma.points) {
          rb.wins += 1;
          ra.losses += 1;
        } else {
          ra.ties += 1;
          rb.ties += 1;
        }
      });
    });
  }

  const league = {
    league_id: `L${o.season}`,
    season: o.season,
    status: o.status,
    roster_positions: o.rosterPositions,
    settings: { playoff_week_start: o.playoffStart, num_teams: o.teams },
  };
  return {
    seasonEntry: { league, rosters, users, bracket: o.bracket },
    deep: { weeks, draft: { picks: o.picks }, transactions: o.transactions },
    playerDirectory,
  };
}

// data/injuries.json shape: { players: { pid: { weeks: { season: { week: status } } } } }
function injuriesFor(season, byPlayer) {
  const players = {};
  Object.entries(byPlayer).forEach(([pid, weeks]) => {
    const w = {};
    weeks.forEach((wk) => {
      w[wk] = "Out";
    });
    players[pid] = { weeks: { [season]: w } };
  });
  return { players };
}

module.exports = { buildLeague, injuriesFor };
