/*
  ============================================================
  DEEP HISTORY ENGINE
  ============================================================
  Builds on top of SleeperAPI.getSeasonChain() by pulling, for every
  season in the league's history: every week's scores + starting
  lineups + full rosters, every waiver/trade transaction, and the
  full draft board.

  This is a LOT more data than the dashboard needs, so completed
  seasons (which can never change) are cached in localStorage after
  their first fetch — repeat visits skip straight to the cache for
  every season except the current one, which is always fetched fresh.
*/

const DeepHistory = {
  /*
    Fetches everything for one season. Returns:
    { leagueId, season, weeks: [{week, matchups}], transactions: [...], draft: {draftId, picks} | null }
  */
  async fetchSeasonDeep(seasonEntry, onProgress) {
    const { league } = seasonEntry;
    const leagueId = league.league_id;
    const isComplete = league.status === "complete";
    const cacheKey = `deep_season_v1_${leagueId}`;

    if (isComplete) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
        if (cached) {
          onProgress && onProgress(league.season, "cached");
          return cached;
        }
      } catch (err) {
        // corrupt cache entry — fall through and refetch
      }
    }

    onProgress && onProgress(league.season, "fetching");

    // Walk weeks 1..18 until we hit a week with no data — that's the
    // reliable signal we've run past the end of that season.
    const weeksRaw = [];
    for (let week = 1; week <= 18; week++) {
      let matchups;
      try {
        matchups = await SleeperAPI.getMatchups(leagueId, week);
      } catch (err) {
        break;
      }
      if (!matchups || matchups.length === 0) break;
      weeksRaw.push({ week, matchups });
    }

    // Transactions, one call per week we found data for. Limited
    // concurrency so we're not firing 15+ requests at once.
    const txPerWeek = await mapWithConcurrency(
      weeksRaw.map((w) => w.week),
      4,
      (week) => SleeperAPI.getTransactions(leagueId, week).catch(() => [])
    );
    const transactions = txPerWeek.flat().filter(Boolean);

    // Draft board (a league normally has exactly one draft per season).
    let draft = null;
    try {
      const drafts = await SleeperAPI.getDrafts(leagueId);
      if (drafts && drafts.length > 0) {
        const picks = await SleeperAPI.getDraftPicks(drafts[0].draft_id);
        draft = { draftId: drafts[0].draft_id, picks };
      }
    } catch (err) {
      draft = null;
    }

    const result = { leagueId, season: league.season, weeks: weeksRaw, transactions, draft };

    if (isComplete) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch (err) {
        console.warn("Couldn't cache season data (localStorage full/unavailable):", err);
      }
    }

    return result;
  },

  // Fetches every season's deep data, two seasons at a time, in the
  // same oldest -> newest order as seasonChain.
  async buildAll(seasonChain, onProgress) {
    return mapWithConcurrency(seasonChain, 2, (entry) => DeepHistory.fetchSeasonDeep(entry, onProgress));
  },

  /*
    Turns seasonChain + the deep data into everything the Teams and
    Records pages render: per-manager career stats and a set of
    league-wide "fun stat" records.
  */
  computeStats(seasonChain, deepSeasons, playerDirectory) {
    const managers = new Map(); // user_id -> career record
    const playerNameOverrides = new Map(); // player_id -> name, filled in from draft metadata

    function getManager(userId, fallbackName, fallbackUsername) {
      if (!managers.has(userId)) {
        managers.set(userId, {
          userId,
          teamName: fallbackName,
          username: fallbackUsername || null,
          seasons: [],
          careerWins: 0,
          careerLosses: 0,
          careerTies: 0,
          careerPF: 0,
          careerPA: 0,
          championships: 0,
          runnerUps: 0,
          playerCounts: new Map(),
          gameLog: [],
          transactionCounts: { trades: 0, waiver: 0, freeAgent: 0 },
        });
      }
      const m = managers.get(userId);
      m.teamName = fallbackName || m.teamName; // keep most recent team name
      m.username = fallbackUsername || m.username;
      return m;
    }

    function playerName(playerId) {
      const fromDirectory = SleeperAPI.playerName(playerDirectory, playerId);
      if (!fromDirectory.startsWith("Unknown Player")) return fromDirectory;
      return playerNameOverrides.get(playerId) || fromDirectory;
    }

    const records = {
      highestWeekScore: null,
      lowestWeekScore: null,
      biggestBlowout: null,
      closestGame: null,
      longestWinStreak: null,
      longestLoseStreak: null,
      bestValuePick: null,
      worstValuePick: null,
      mostTrades: null,
      mostWaiverAdds: null,
    };

    function consider(recordKey, candidate, better) {
      const current = records[recordKey];
      if (!current || better(candidate, current)) records[recordKey] = candidate;
    }

    seasonChain.forEach((seasonEntry, idx) => {
      const { league, rosters, users, bracket } = seasonEntry;
      const deep = deepSeasons[idx];
      const season = league.season;

      const usersById = new Map(users.map((u) => [u.user_id, u]));
      const rosterInfo = new Map(); // roster_id -> { userId, teamName, username }
      rosters.forEach((r) => {
        const user = usersById.get(r.owner_id);
        rosterInfo.set(r.roster_id, {
          userId: r.owner_id,
          teamName: SleeperAPI.teamName(user, r.roster_id),
          username: user ? user.display_name : null,
        });
      });

      const standings = SleeperAPI.buildStandings(rosters, users);
      const championRosterId = SleeperAPI.findChampionRosterId(bracket);
      const runnerUpRosterId = SleeperAPI.findRunnerUpRosterId(bracket);

      const seasonEntryByRosterId = new Map(); // this season only, for attaching draft picks below

      standings.forEach((s, rank) => {
        if (!s.userId) return;
        const m = getManager(s.userId, s.teamName, s.username);
        const seasonEntry = {
          season,
          rosterId: s.rosterId,
          rank: rank + 1,
          wins: s.wins,
          losses: s.losses,
          ties: s.ties,
          fpts: s.fpts,
          fptsAgainst: s.fptsAgainst,
          isChampion: s.rosterId === championRosterId,
          isRunnerUp: s.rosterId === runnerUpRosterId,
          draftPicks: [],
        };
        m.seasons.push(seasonEntry);
        seasonEntryByRosterId.set(s.rosterId, seasonEntry);
        m.careerWins += s.wins;
        m.careerLosses += s.losses;
        m.careerTies += s.ties;
        m.careerPF += s.fpts;
        m.careerPA += s.fptsAgainst;
        if (s.rosterId === championRosterId) m.championships += 1;
        if (s.rosterId === runnerUpRosterId) m.runnerUps += 1;
      });

      // ---- Weekly scores, lineups, matchup-level records ----
      if (deep) {
        const seasonPlayerPoints = new Map(); // player_id -> total points this season

        deep.weeks.forEach(({ week, matchups }) => {
          // Union every roster's players_points this week so every
          // player's score for the week is captured exactly once.
          matchups.forEach((m) => {
            Object.entries(m.players_points || {}).forEach(([pid, pts]) => {
              seasonPlayerPoints.set(pid, (seasonPlayerPoints.get(pid) || 0) + (pts || 0));
            });
          });

          // Roster appearance counts (for "most rostered players").
          matchups.forEach((m) => {
            const info = rosterInfo.get(m.roster_id);
            if (!info || !info.userId) return;
            const mgr = getManager(info.userId, info.teamName, info.username);
            (m.players || []).forEach((pid) => {
              mgr.playerCounts.set(pid, (mgr.playerCounts.get(pid) || 0) + 1);
            });
          });

          // Highest / lowest single-week score.
          matchups.forEach((m) => {
            const info = rosterInfo.get(m.roster_id);
            if (!info) return;
            const entry = { points: m.points || 0, teamName: info.teamName, season, week };
            consider("highestWeekScore", entry, (a, b) => a.points > b.points);
            consider("lowestWeekScore", entry, (a, b) => a.points < b.points);
          });

          // Pair up matchups by matchup_id for blowout/closest-game/win-loss.
          const byMatchupId = new Map();
          matchups.forEach((m) => {
            if (m.matchup_id == null) return;
            if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
            byMatchupId.get(m.matchup_id).push(m);
          });

          byMatchupId.forEach((pair) => {
            if (pair.length < 2) return;
            const [a, b] = pair;
            const aInfo = rosterInfo.get(a.roster_id);
            const bInfo = rosterInfo.get(b.roster_id);
            if (!aInfo || !bInfo) return;
            const margin = Math.abs((a.points || 0) - (b.points || 0));
            const winner = a.points >= b.points ? aInfo.teamName : bInfo.teamName;
            const loser = a.points >= b.points ? bInfo.teamName : aInfo.teamName;
            const marginEntry = { margin, winner, loser, season, week };
            consider("biggestBlowout", marginEntry, (x, y) => x.margin > y.margin);
            consider("closestGame", marginEntry, (x, y) => x.margin < y.margin);

            // Game log, for win/loss streaks.
            [
              { info: aInfo, own: a.points || 0, opp: b.points || 0 },
              { info: bInfo, own: b.points || 0, opp: a.points || 0 },
            ].forEach(({ info, own, opp }) => {
              if (!info.userId) return;
              const mgr = getManager(info.userId, info.teamName, info.username);
              const result = own > opp ? "W" : own < opp ? "L" : "T";
              mgr.gameLog.push({ result, season, week });
            });
          });
        });

        // ---- Draft value (best late-round steal / biggest early-round bust) ----
        if (deep.draft && deep.draft.picks && deep.draft.picks.length) {
          const maxRound = Math.max(...deep.draft.picks.map((p) => p.round || 1));
          const lateThreshold = Math.max(2, Math.ceil(maxRound * 0.6));
          const earlyThreshold = Math.max(1, Math.ceil(maxRound * 0.25));

          deep.draft.picks.forEach((pick) => {
            if (!pick.player_id) return;
            if (pick.metadata && (pick.metadata.first_name || pick.metadata.last_name)) {
              playerNameOverrides.set(
                pick.player_id,
                `${pick.metadata.first_name || ""} ${pick.metadata.last_name || ""}`.trim()
              );
            }
            const pts = seasonPlayerPoints.get(pick.player_id) || 0;
            const info = rosterInfo.get(pick.roster_id);
            const entry = {
              player: playerName(pick.player_id),
              round: pick.round,
              pickNo: pick.pick_no,
              points: pts,
              teamName: info ? info.teamName : "Unknown",
              season,
            };
            if (pick.round >= lateThreshold) {
              consider("bestValuePick", entry, (a, b) => a.points > b.points);
            }
            if (pick.round <= earlyThreshold) {
              consider("worstValuePick", entry, (a, b) => a.points < b.points);
            }

            const seasonEntry = seasonEntryByRosterId.get(pick.roster_id);
            if (seasonEntry) {
              seasonEntry.draftPicks.push({
                round: pick.round,
                pickNo: pick.pick_no,
                player: playerName(pick.player_id),
                position: (pick.metadata && pick.metadata.position) || "",
                points: pts,
              });
            }
          });
        }

        // ---- Transactions ----
        deep.transactions.forEach((tx) => {
          if (!tx || tx.status !== "complete") return;
          if (tx.type === "trade") {
            (tx.roster_ids || []).forEach((rid) => {
              const info = rosterInfo.get(rid);
              if (!info || !info.userId) return;
              getManager(info.userId, info.teamName, info.username).transactionCounts.trades += 1;
            });
          } else if (tx.type === "waiver" || tx.type === "free_agent") {
            const key = tx.type === "waiver" ? "waiver" : "freeAgent";
            Object.values(tx.adds || {}).forEach((rid) => {
              const info = rosterInfo.get(rid);
              if (!info || !info.userId) return;
              getManager(info.userId, info.teamName, info.username).transactionCounts[key] += 1;
            });
          }
        });
      }
    });

    managers.forEach((m) => {
      m.seasons.forEach((s) => s.draftPicks.sort((a, b) => (a.pickNo || 0) - (b.pickNo || 0)));
    });

    // ---- Streaks + trade/waiver leaders, computed after all seasons are merged ----
    managers.forEach((m) => {
      let curResult = null;
      let curLen = 0;
      let bestWin = { length: 0 };
      let bestLose = { length: 0 };
      let streakStart = null;

      m.gameLog.forEach((g) => {
        if (g.result === curResult) {
          curLen += 1;
        } else {
          curResult = g.result;
          curLen = 1;
          streakStart = g;
        }
        if (curResult === "W" && curLen > bestWin.length) {
          bestWin = { length: curLen, teamName: m.teamName, start: streakStart, end: g };
        }
        if (curResult === "L" && curLen > bestLose.length) {
          bestLose = { length: curLen, teamName: m.teamName, start: streakStart, end: g };
        }
      });

      if (bestWin.length > 1) consider("longestWinStreak", bestWin, (a, b) => a.length > b.length);
      if (bestLose.length > 1) consider("longestLoseStreak", bestLose, (a, b) => a.length > b.length);

      if (m.transactionCounts.trades > 0) {
        consider(
          "mostTrades",
          { teamName: m.teamName, count: m.transactionCounts.trades },
          (a, b) => a.count > b.count
        );
      }
      const waiverTotal = m.transactionCounts.waiver + m.transactionCounts.freeAgent;
      if (waiverTotal > 0) {
        consider("mostWaiverAdds", { teamName: m.teamName, count: waiverTotal }, (a, b) => a.count > b.count);
      }
    });

    // ---- Finalize per-manager "most rostered players" (top 5, with names) ----
    const managerList = [...managers.values()]
      .map((m) => ({
        ...m,
        mostRostered: [...m.playerCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([pid, count]) => ({ playerId: pid, name: playerName(pid), weeksRostered: count })),
      }))
      .sort((a, b) => b.careerWins - a.careerWins || b.careerPF - a.careerPF);

    return { managers: managerList, records };
  },

  /*
    Same idea as computeStats, but scoped to ONE season — this is what
    powers the Season page's charts (weekly scoring trend, team averages,
    scoring by position, that season's extremes and draft standouts).
  */
  computeSeasonSummary(seasonEntry, deep, playerDirectory) {
    const { league, rosters, users, bracket } = seasonEntry;
    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const rosterInfo = new Map();
    rosters.forEach((r) => {
      const user = usersById.get(r.owner_id);
      rosterInfo.set(r.roster_id, {
        userId: r.owner_id,
        teamName: SleeperAPI.teamName(user, r.roster_id),
        username: user ? user.display_name : null,
      });
    });

    const standings = SleeperAPI.buildStandings(rosters, users);
    const championRosterId = SleeperAPI.findChampionRosterId(bracket);

    const KNOWN_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
    function normalizedPosition(pid) {
      const p = playerDirectory && playerDirectory[pid];
      const pos = p && p.position;
      return KNOWN_POS.has(pos) ? pos : "OTHER";
    }

    function pick(current, candidate, better) {
      return !current || better(candidate, current) ? candidate : current;
    }

    const weeklyLeagueAvg = [];
    const teamTotals = new Map(); // rosterId -> {sum, games, teamName, username}
    const teamPositionTotals = new Map(); // rosterId -> {QB:0, RB:0, ...}
    const seasonPlayerPoints = new Map(); // player_id -> total points

    let highestWeekScore = null;
    let lowestWeekScore = null;
    let biggestBlowout = null;
    let closestGame = null;

    (deep ? deep.weeks : []).forEach(({ week, matchups }) => {
      let weekSum = 0;
      let weekCount = 0;

      matchups.forEach((m) => {
        const info = rosterInfo.get(m.roster_id);
        if (!info) return;
        weekSum += m.points || 0;
        weekCount += 1;

        const t = teamTotals.get(m.roster_id) || { sum: 0, games: 0, teamName: info.teamName, username: info.username };
        t.sum += m.points || 0;
        t.games += 1;
        teamTotals.set(m.roster_id, t);

        const posTotals = teamPositionTotals.get(m.roster_id) || {};
        (m.starters || []).forEach((pid) => {
          if (!pid || pid === "0") return;
          const pos = normalizedPosition(pid);
          const pts = (m.players_points && m.players_points[pid]) || 0;
          posTotals[pos] = (posTotals[pos] || 0) + pts;
        });
        teamPositionTotals.set(m.roster_id, posTotals);

        Object.entries(m.players_points || {}).forEach(([pid, pts]) => {
          seasonPlayerPoints.set(pid, (seasonPlayerPoints.get(pid) || 0) + (pts || 0));
        });

        const entry = { points: m.points || 0, teamName: info.teamName, week };
        highestWeekScore = pick(highestWeekScore, entry, (a, b) => a.points > b.points);
        lowestWeekScore = pick(lowestWeekScore, entry, (a, b) => a.points < b.points);
      });

      if (weekCount > 0) weeklyLeagueAvg.push({ week, avg: weekSum / weekCount });

      const byMatchupId = new Map();
      matchups.forEach((m) => {
        if (m.matchup_id == null) return;
        if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
        byMatchupId.get(m.matchup_id).push(m);
      });
      byMatchupId.forEach((pair) => {
        if (pair.length < 2) return;
        const [a, b] = pair;
        const aInfo = rosterInfo.get(a.roster_id);
        const bInfo = rosterInfo.get(b.roster_id);
        if (!aInfo || !bInfo) return;
        const margin = Math.abs((a.points || 0) - (b.points || 0));
        const winner = a.points >= b.points ? aInfo.teamName : bInfo.teamName;
        const loser = a.points >= b.points ? bInfo.teamName : aInfo.teamName;
        const marginEntry = { margin, winner, loser, week };
        biggestBlowout = pick(biggestBlowout, marginEntry, (x, y) => x.margin > y.margin);
        closestGame = pick(closestGame, marginEntry, (x, y) => x.margin < y.margin);
      });
    });

    // ---- Draft standouts, this season only ----
    const playerNameOverrides = new Map();
    function playerName(pid) {
      const fromDir = SleeperAPI.playerName(playerDirectory, pid);
      if (!fromDir.startsWith("Unknown Player")) return fromDir;
      return playerNameOverrides.get(pid) || fromDir;
    }

    let bestValuePick = null;
    let worstValuePick = null;
    if (deep && deep.draft && deep.draft.picks && deep.draft.picks.length) {
      const picks = deep.draft.picks;
      const maxRound = Math.max(...picks.map((p) => p.round || 1));
      const lateThreshold = Math.max(2, Math.ceil(maxRound * 0.6));
      const earlyThreshold = Math.max(1, Math.ceil(maxRound * 0.25));
      picks.forEach((p) => {
        if (!p.player_id) return;
        if (p.metadata && (p.metadata.first_name || p.metadata.last_name)) {
          playerNameOverrides.set(p.player_id, `${p.metadata.first_name || ""} ${p.metadata.last_name || ""}`.trim());
        }
        const pts = seasonPlayerPoints.get(p.player_id) || 0;
        const info = rosterInfo.get(p.roster_id);
        const entry = { player: playerName(p.player_id), round: p.round, pickNo: p.pick_no, points: pts, teamName: info ? info.teamName : "Unknown" };
        if (p.round >= lateThreshold) bestValuePick = pick(bestValuePick, entry, (a, b) => a.points > b.points);
        if (p.round <= earlyThreshold) worstValuePick = pick(worstValuePick, entry, (a, b) => a.points < b.points);
      });
    }

    let pointsLeader = null;
    seasonPlayerPoints.forEach((pts, pid) => {
      pointsLeader = pick(pointsLeader, { player: playerName(pid), points: pts }, (a, b) => a.points > b.points);
    });

    const teamAverages = [...teamTotals.entries()]
      .map(([rosterId, t]) => ({
        rosterId,
        teamName: t.teamName,
        username: t.username,
        average: t.games ? t.sum / t.games : 0,
        total: t.sum,
      }))
      .sort((a, b) => b.average - a.average);

    const positionRows = [...teamPositionTotals.entries()]
      .map(([rosterId, segments]) => {
        const info = rosterInfo.get(rosterId);
        return { rosterId, label: info ? info.teamName : `Roster ${rosterId}`, segments };
      })
      .sort((a, b) => {
        const totalA = Object.values(a.segments).reduce((s, v) => s + v, 0);
        const totalB = Object.values(b.segments).reduce((s, v) => s + v, 0);
        return totalB - totalA;
      });

    return {
      season: league.season,
      status: league.status,
      standings,
      championRosterId,
      weeksPlayed: deep ? deep.weeks.length : 0,
      weeklyLeagueAvg,
      teamAverages,
      positionRows,
      highestWeekScore,
      lowestWeekScore,
      biggestBlowout,
      closestGame,
      bestValuePick,
      worstValuePick,
      pointsLeader,
    };
  },
};
