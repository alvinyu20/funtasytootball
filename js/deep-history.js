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
    // v2: bumped from v1 because earlier cached data could include week 18,
    // which LAST_FANTASY_WEEK now excludes — this forces a clean refetch.
    const cacheKey = `deep_season_v2_${leagueId}`;

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

    // Walk weeks 1..LAST_FANTASY_WEEK until we hit a week with no data —
    // that's the reliable signal we've run past the end of that season.
    const weeksRaw = [];
    for (let week = 1; week <= LAST_FANTASY_WEEK; week++) {
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
    const headToHead = new Map(); // userId -> Map(opponentUserId -> {wins, losses, ties})

    function h2hRecord(userId, opponentId) {
      if (!headToHead.has(userId)) headToHead.set(userId, new Map());
      const byOpponent = headToHead.get(userId);
      if (!byOpponent.has(opponentId)) byOpponent.set(opponentId, { wins: 0, losses: 0, ties: 0 });
      return byOpponent.get(opponentId);
    }

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

            // Head-to-head: each side's record specifically against the other.
            if (aInfo.userId && bInfo.userId && aInfo.userId !== bInfo.userId) {
              const aRec = h2hRecord(aInfo.userId, bInfo.userId);
              const bRec = h2hRecord(bInfo.userId, aInfo.userId);
              if (a.points > b.points) {
                aRec.wins += 1;
                bRec.losses += 1;
              } else if (a.points < b.points) {
                aRec.losses += 1;
                bRec.wins += 1;
              } else {
                aRec.ties += 1;
                bRec.ties += 1;
              }
            }
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
    // and resolve head-to-head opponent names now that every manager's most
    // recent team name/username is known.
    const managerList = [...managers.values()]
      .map((m) => ({
        ...m,
        mostRostered: [...m.playerCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([pid, count]) => ({ playerId: pid, name: playerName(pid), weeksRostered: count })),
        headToHead: [...(headToHead.get(m.userId) || new Map()).entries()]
          .map(([opponentId, rec]) => {
            const opp = managers.get(opponentId);
            return {
              opponentUserId: opponentId,
              opponentName: (opp && (opp.username || opp.teamName)) || "Unknown",
              wins: rec.wins,
              losses: rec.losses,
              ties: rec.ties,
            };
          })
          .sort((a, b) => b.wins + b.losses + b.ties - (a.wins + a.losses + a.ties)),
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
    // Note: on the Season page, "teamName" throughout this function
    // deliberately holds the Sleeper USERNAME rather than the custom team
    // name — usernames are easier for the league to recognize each other
    // by than whatever a team happened to be called that year.
    const rosterInfo = new Map();
    rosters.forEach((r) => {
      const user = usersById.get(r.owner_id);
      rosterInfo.set(r.roster_id, {
        userId: r.owner_id,
        teamName: user ? user.display_name || SleeperAPI.teamName(user, r.roster_id) : SleeperAPI.teamName(user, r.roster_id),
        username: user ? user.display_name : null,
      });
    });

    const standings = SleeperAPI.buildStandings(rosters, users);
    const championRosterId = SleeperAPI.findChampionRosterId(bracket);

    const KNOWN_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

    function pick(current, candidate, better) {
      return !current || better(candidate, current) ? candidate : current;
    }

    // Declared up front (not just for the draft section below) because the
    // weekly loop also uses it to name each week's best-at-position player.
    const playerNameOverrides = new Map();
    function playerName(pid) {
      const fromDir = SleeperAPI.playerName(playerDirectory, pid);
      if (!fromDir.startsWith("Unknown Player")) return fromDir;
      return playerNameOverrides.get(pid) || fromDir;
    }
    function nativePosition(pid) {
      const p = playerDirectory && playerDirectory[pid];
      return p && KNOWN_POS.has(p.position) ? p.position : null;
    }

    const weeklyLeagueAvg = [];
    const teamTotals = new Map(); // rosterId -> {sum, games, teamName, username}
    const seasonPlayerPoints = new Map(); // player_id -> total points, this season

    let highestWeekScore = null;
    let lowestWeekScore = null;
    const allMargins = []; // every matchup's margin this season, for top-5 lists
    const bestByPosition = {}; // "QB" -> {player, points, week, teamName}

    (deep ? deep.weeks : []).forEach(({ week, matchups }) => {
      let weekSum = 0;
      let weekCount = 0;

      matchups.forEach((m) => {
        const info = rosterInfo.get(m.roster_id);
        if (!info) return;
        weekSum += m.points || 0;
        weekCount += 1;

        const t = teamTotals.get(m.roster_id) || { sum: 0, games: 0, teamName: info.teamName, username: info.username, userId: info.userId };
        t.sum += m.points || 0;
        t.games += 1;
        teamTotals.set(m.roster_id, t);

        Object.entries(m.players_points || {}).forEach(([pid, pts]) => {
          seasonPlayerPoints.set(pid, (seasonPlayerPoints.get(pid) || 0) + (pts || 0));
          const pos = nativePosition(pid);
          if (pos) {
            const entry = { player: playerName(pid), points: pts || 0, week, season: league.season, teamName: info.teamName };
            bestByPosition[pos] = pick(bestByPosition[pos], entry, (a, b) => a.points > b.points);
          }
        });

        const entry = { points: m.points || 0, teamName: info.teamName, week, season: league.season };
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
        const winnerPts = Math.max(a.points || 0, b.points || 0);
        const loserPts = Math.min(a.points || 0, b.points || 0);
        allMargins.push({ margin, winner, loser, winnerPts, loserPts, week, season: league.season });
      });
    });

    const top5Closest = [...allMargins].sort((a, b) => a.margin - b.margin).slice(0, 5);
    const top5Blowouts = [...allMargins].sort((a, b) => b.margin - a.margin).slice(0, 5);

    // ---- Scoring-by-position table (dedicated slots ranked by score,
    //      pooled together with any same-position player in FLEX/SUPERFLEX) ----
    const positionTable = DeepHistory.buildPositionTable(rosterInfo, league, deep, playerDirectory);

    // ---- Draft standouts, this season only ----
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
        const entry = { player: playerName(p.player_id), round: p.round, pickNo: p.pick_no, points: pts, season: league.season, teamName: info ? info.teamName : "Unknown" };
        if (p.round >= lateThreshold) bestValuePick = pick(bestValuePick, entry, (a, b) => a.points > b.points);
        if (p.round <= earlyThreshold) worstValuePick = pick(worstValuePick, entry, (a, b) => a.points < b.points);
      });
    }

    let pointsLeader = null;
    seasonPlayerPoints.forEach((pts, pid) => {
      pointsLeader = pick(pointsLeader, { player: playerName(pid), points: pts, season: league.season }, (a, b) => a.points > b.points);
    });

    const teamAverages = [...teamTotals.entries()]
      .map(([rosterId, t]) => ({
        rosterId,
        userId: t.userId,
        teamName: t.teamName,
        username: t.username,
        average: t.games ? t.sum / t.games : 0,
        total: t.sum,
        games: t.games,
      }))
      .sort((a, b) => b.average - a.average);

    const bracket_ = DeepHistory.buildBracket(seasonEntry, deep);

    return {
      season: league.season,
      status: league.status,
      standings,
      championRosterId,
      weeksPlayed: deep ? deep.weeks.length : 0,
      weeklyLeagueAvg,
      teamAverages,
      positionTable,
      highestWeekScore,
      lowestWeekScore,
      top5Closest,
      top5Blowouts,
      bestByPosition,
      bestValuePick,
      worstValuePick,
      pointsLeader,
      bracket: bracket_,
    };
  },

  /*
    Turns Sleeper's raw winners_bracket into a clean, render-ready shape:
    { rounds: [ { roundNumber, label, games: [ {team1, team2, specialLabel} ] } ] }
    where team1/team2 are { name, score, isWinner }. Scores are looked up
    from that round's actual week of matchup data when available. Returns
    null if the league doesn't have bracket data (e.g. season hasn't
    reached the playoffs yet).
  */
  buildBracket(seasonEntry, deep) {
    const { league, rosters, users, bracket } = seasonEntry;
    if (!bracket || !bracket.length) return null;

    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const teamNameById = new Map();
    rosters.forEach((r) => {
      const user = usersById.get(r.owner_id);
      teamNameById.set(r.roster_id, user ? user.display_name || SleeperAPI.teamName(user, r.roster_id) : SleeperAPI.teamName(user, r.roster_id));
    });

    const gameById = new Map(bracket.map((g) => [g.m, g]));
    const playoffStart = league.settings && league.settings.playoff_week_start;

    function resolveTeamId(game, slotKey) {
      if (game[slotKey] != null) return game[slotKey];
      const from = game[slotKey + "_from"];
      if (!from) return null;
      if (from.w != null) {
        const src = gameById.get(from.w);
        return src ? src.w : null;
      }
      if (from.l != null) {
        const src = gameById.get(from.l);
        return src ? src.l : null;
      }
      return null;
    }

    function scoreFor(rosterId, round) {
      if (rosterId == null || !playoffStart || !deep) return null;
      const week = playoffStart + (round - 1);
      const weekData = deep.weeks.find((w) => w.week === week);
      if (!weekData) return null;
      const m = weekData.matchups.find((mm) => mm.roster_id === rosterId);
      return m ? m.points : null;
    }

    const maxRound = Math.max(...bracket.map((g) => g.r));
    function roundLabel(r) {
      const distance = maxRound - r;
      if (distance === 0) return "Finals";
      if (distance === 1) return "Semifinals";
      if (distance === 2) return "Quarterfinals";
      return `Round ${r}`;
    }

    function teamSlot(game, slotKey) {
      const id = resolveTeamId(game, slotKey);
      return {
        name: id != null ? teamNameById.get(id) || `Roster ${id}` : "TBD",
        score: scoreFor(id, game.r),
        isWinner: game.w != null && id != null && game.w === id,
      };
    }

    const byRound = new Map();
    [...bracket]
      .sort((a, b) => a.r - b.r || a.m - b.m)
      .forEach((g) => {
        const specialLabel = g.p === 1 ? "Championship" : g.p === 3 ? "3rd Place" : null;
        if (!byRound.has(g.r)) byRound.set(g.r, []);
        byRound.get(g.r).push({ team1: teamSlot(g, "t1"), team2: teamSlot(g, "t2"), specialLabel });
      });

    const rounds = [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, games]) => ({ roundNumber: r, label: roundLabel(r), games }));

    return { rounds };
  },

  /*
    Builds the "average score per week, per starting-lineup slot" table.

    Columns come straight from that season's league.roster_positions, so a
    league that changes its lineup format year to year gets the right
    columns automatically.

    Labeling rule: for a given position (say RB), every player who started
    that week at that position — whether in a dedicated RB slot OR in
    FLEX/SUPERFLEX — is pooled together and ranked by score. The top N
    (N = number of dedicated slots for that position) become RB1, RB2, etc.
    Whoever's left over is, by definition, playing on the flex line: with
    one leftover it's labeled by whichever flex-type slot they're actually
    in; with two leftovers (the same position filling BOTH FLEX and
    SUPERFLEX that week) the lower scorer is labeled FLEX and the higher
    is labeled SUPERFLEX, regardless of which literal slot each was
    dragged into — FLEX always represents that position's weakest starter.
  */
  buildPositionTable(rosterInfo, league, deep, playerDirectory) {
    const EXCLUDE = new Set(["BN", "IR", "TAXI"]);
    const slotTypes = (league.roster_positions || []).filter((p) => !EXCLUDE.has(p));

    if (!slotTypes.length || !deep || !deep.weeks.length) {
      return { columns: [], rows: [] };
    }

    const countByType = {};
    slotTypes.forEach((t) => {
      countByType[t] = (countByType[t] || 0) + 1;
    });

    const KNOWN_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
    function nativePosition(pid) {
      const p = playerDirectory && playerDirectory[pid];
      return p && KNOWN_POS.has(p.position) ? p.position : null;
    }

    // Which real positions each flex-type slot can hold, and the fixed
    // priority order used to break ties when the same position fills more
    // than one flex-type slot in the same week (FLEX always claims the
    // lower score first).
    const FLEX_ELIGIBLE = { FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"] };
    const FLEX_PRIORITY = ["FLEX", "SUPER_FLEX"];

    function friendlyFlexLabel(slotType) {
      if (slotType === "FLEX") return "FLEX";
      if (slotType === "SUPER_FLEX") return "SFLX";
      return slotType.replace(/_FLEX$/, "").replace(/_/g, "") + " FLEX";
    }

    // Fixed, sensible column order: standard positions first (numbered if
    // there's more than one dedicated slot), then flex-type slots, then
    // anything unrecognized (e.g. IDP leagues) in whatever order it appears.
    const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
    const seenKeys = new Set();
    const columns = [];
    function addColumn(key, label) {
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      columns.push({ key, label });
    }
    POSITION_ORDER.forEach((pos) => {
      const count = countByType[pos] || 0;
      for (let i = 1; i <= count; i++) addColumn(count > 1 ? `${pos}${i}` : pos, count > 1 ? `${pos}${i}` : pos);
    });
    slotTypes.forEach((t) => {
      if (POSITION_ORDER.includes(t)) return;
      addColumn(t, friendlyFlexLabel(t));
    });

    const teamColumnTotals = new Map(); // rosterId -> { colKey -> {sum, weeks} }
    function addCell(totals, key, pts) {
      const cell = totals[key] || { sum: 0, weeks: 0 };
      cell.sum += pts;
      cell.weeks += 1;
      totals[key] = cell;
    }

    deep.weeks.forEach(({ matchups }) => {
      matchups.forEach((m) => {
        const info = rosterInfo.get(m.roster_id);
        if (!info) return;
        const starters = m.starters || [];
        const pointsMap = m.players_points || {};

        // Group this week's starters by literal slot type, keeping each
        // instance separate (so two RB slots stay as two entries).
        const byType = {};
        starters.forEach((pid, i) => {
          const slotType = slotTypes[i];
          if (!slotType || !pid || pid === "0") return;
          (byType[slotType] = byType[slotType] || []).push({ pid, pts: pointsMap[pid] || 0 });
        });

        const totals = teamColumnTotals.get(m.roster_id) || {};
        const consumedPids = new Set();

        POSITION_ORDER.forEach((pos) => {
          const dedicatedCount = countByType[pos] || 0;
          const dedicatedEntries = (byType[pos] || []).slice();
          dedicatedEntries.forEach((e) => consumedPids.add(e.pid));

          // Pull in any FLEX/SUPERFLEX occupant whose real position is
          // this one — this is what makes RB1 the true highest-scoring
          // RB even if a RB was started in FLEX instead of a dedicated slot.
          const contributingFlexTypes = [];
          const contributingEntries = [];
          FLEX_PRIORITY.forEach((flexType) => {
            if (!FLEX_ELIGIBLE[flexType] || !FLEX_ELIGIBLE[flexType].includes(pos)) return;
            const match = (byType[flexType] || []).find((e) => !consumedPids.has(e.pid) && nativePosition(e.pid) === pos);
            if (match) {
              contributingFlexTypes.push(flexType);
              contributingEntries.push(match);
              consumedPids.add(match.pid);
            }
          });

          if (dedicatedCount === 0 && contributingEntries.length === 0) return;

          const pool = [...dedicatedEntries, ...contributingEntries].sort((a, b) => b.pts - a.pts);
          const dedicatedPicks = pool.slice(0, dedicatedCount);
          const overflow = pool.slice(dedicatedCount);

          // Top scorers fill the numbered dedicated columns regardless of
          // which literal slot they actually started in.
          dedicatedPicks.forEach((entry, idx) => {
            const key = dedicatedCount > 1 ? `${pos}${idx + 1}` : pos;
            addCell(totals, key, entry.pts);
          });

          // Whoever's left ranks below every dedicated slot for this
          // position — by definition that's the flex line. Lowest score
          // gets the FLEX column, next-lowest gets SUPERFLEX, and so on,
          // purely by rank (overflow.length never exceeds
          // contributingFlexTypes.length, since a dedicated slot can only
          // ever push at most one flex contributor out per flex-type slot).
          [...overflow]
            .sort((a, b) => a.pts - b.pts)
            .forEach((entry, idx) => {
              addCell(totals, contributingFlexTypes[idx], entry.pts);
            });
        });

        // Anything left over — K/DEF already handled above via the same
        // pooling pass (they simply have no flex contributors), so this
        // only catches unrecognized/custom slot types (e.g. IDP leagues)
        // and rare extra flex-type instances beyond the first of a kind.
        Object.entries(byType).forEach(([slotType, entries]) => {
          entries.forEach((entry) => {
            if (consumedPids.has(entry.pid)) return;
            addCell(totals, slotType, entry.pts);
            consumedPids.add(entry.pid);
          });
        });

        teamColumnTotals.set(m.roster_id, totals);
      });
    });

    const rows = [...teamColumnTotals.entries()].map(([rosterId, totals]) => {
      const info = rosterInfo.get(rosterId);
      const cells = {};
      columns.forEach((col) => {
        const cell = totals[col.key];
        cells[col.key] = cell && cell.weeks ? cell.sum / cell.weeks : null;
      });
      return { rosterId, teamName: info ? info.teamName : `Roster ${rosterId}`, cells };
    });

    return { columns, rows };
  },

  /*
    Same idea as buildPositionTable, but pooled across EVERY season and
    keyed by user (not roster_id, which resets each season). Column counts
    are the max seen across all seasons, so a league that added a 3rd RB
    slot partway through its history still gets an RB3 column, averaged
    only over the weeks that slot actually existed.
  */
  buildPositionTableTotal(seasonChain, deepSeasons, playerDirectory) {
    const EXCLUDE = new Set(["BN", "IR", "TAXI"]);
    const KNOWN_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
    function nativePosition(pid) {
      const p = playerDirectory && playerDirectory[pid];
      return p && KNOWN_POS.has(p.position) ? p.position : null;
    }
    const FLEX_ELIGIBLE = { FLEX: ["RB", "WR", "TE"], SUPER_FLEX: ["QB", "RB", "WR", "TE"] };
    const FLEX_PRIORITY = ["FLEX", "SUPER_FLEX"];
    function friendlyFlexLabel(slotType) {
      if (slotType === "FLEX") return "FLEX";
      if (slotType === "SUPER_FLEX") return "SFLX";
      return slotType.replace(/_FLEX$/, "").replace(/_/g, "") + " FLEX";
    }

    const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
    const maxCountByType = {};
    const seenFlexTypes = [];

    seasonChain.forEach(({ league }) => {
      const slotTypes = (league.roster_positions || []).filter((p) => !EXCLUDE.has(p));
      const countByType = {};
      slotTypes.forEach((t) => {
        countByType[t] = (countByType[t] || 0) + 1;
      });
      Object.entries(countByType).forEach(([t, c]) => {
        maxCountByType[t] = Math.max(maxCountByType[t] || 0, c);
      });
      slotTypes.forEach((t) => {
        if (!POSITION_ORDER.includes(t) && !seenFlexTypes.includes(t)) seenFlexTypes.push(t);
      });
    });

    const columns = [];
    const seenKeys = new Set();
    function addColumn(key, label) {
      if (seenKeys.has(key)) return;
      seenKeys.add(key);
      columns.push({ key, label });
    }
    POSITION_ORDER.forEach((pos) => {
      const count = maxCountByType[pos] || 0;
      for (let i = 1; i <= count; i++) addColumn(count > 1 ? `${pos}${i}` : pos, count > 1 ? `${pos}${i}` : pos);
    });
    seenFlexTypes.forEach((t) => addColumn(t, friendlyFlexLabel(t)));

    const userColumnTotals = new Map();
    const userNameById = new Map();
    function addCell(totals, key, pts) {
      const cell = totals[key] || { sum: 0, weeks: 0 };
      cell.sum += pts;
      cell.weeks += 1;
      totals[key] = cell;
    }

    seasonChain.forEach((seasonEntry, idx) => {
      const { league, rosters, users } = seasonEntry;
      const deep = deepSeasons[idx];
      if (!deep || !deep.weeks.length) return;

      const usersById = new Map(users.map((u) => [u.user_id, u]));
      const rosterInfo = new Map();
      rosters.forEach((r) => {
        const user = usersById.get(r.owner_id);
        const name = user ? user.display_name || SleeperAPI.teamName(user, r.roster_id) : SleeperAPI.teamName(user, r.roster_id);
        rosterInfo.set(r.roster_id, { userId: r.owner_id, teamName: name });
        if (r.owner_id) userNameById.set(r.owner_id, name);
      });

      const slotTypes = (league.roster_positions || []).filter((p) => !EXCLUDE.has(p));
      const countByType = {};
      slotTypes.forEach((t) => {
        countByType[t] = (countByType[t] || 0) + 1;
      });

      deep.weeks.forEach(({ matchups }) => {
        matchups.forEach((m) => {
          const info = rosterInfo.get(m.roster_id);
          if (!info || !info.userId) return;
          const starters = m.starters || [];
          const pointsMap = m.players_points || {};

          const byType = {};
          starters.forEach((pid, i) => {
            const slotType = slotTypes[i];
            if (!slotType || !pid || pid === "0") return;
            (byType[slotType] = byType[slotType] || []).push({ pid, pts: pointsMap[pid] || 0 });
          });

          const totals = userColumnTotals.get(info.userId) || {};
          const consumedPids = new Set();

          POSITION_ORDER.forEach((pos) => {
            const dedicatedCount = countByType[pos] || 0;
            const dedicatedEntries = (byType[pos] || []).slice();
            dedicatedEntries.forEach((e) => consumedPids.add(e.pid));

            const contributingFlexTypes = [];
            const contributingEntries = [];
            FLEX_PRIORITY.forEach((flexType) => {
              if (!FLEX_ELIGIBLE[flexType] || !FLEX_ELIGIBLE[flexType].includes(pos)) return;
              const match = (byType[flexType] || []).find((e) => !consumedPids.has(e.pid) && nativePosition(e.pid) === pos);
              if (match) {
                contributingFlexTypes.push(flexType);
                contributingEntries.push(match);
                consumedPids.add(match.pid);
              }
            });

            if (dedicatedCount === 0 && contributingEntries.length === 0) return;

            const pool = [...dedicatedEntries, ...contributingEntries].sort((a, b) => b.pts - a.pts);
            const dedicatedPicks = pool.slice(0, dedicatedCount);
            const overflow = pool.slice(dedicatedCount);

            dedicatedPicks.forEach((entry, idx2) => {
              const key = dedicatedCount > 1 ? `${pos}${idx2 + 1}` : pos;
              addCell(totals, key, entry.pts);
            });

            [...overflow]
              .sort((a, b) => a.pts - b.pts)
              .forEach((entry, idx2) => {
                addCell(totals, contributingFlexTypes[idx2], entry.pts);
              });
          });

          Object.entries(byType).forEach(([slotType, entries]) => {
            entries.forEach((entry) => {
              if (consumedPids.has(entry.pid)) return;
              addCell(totals, slotType, entry.pts);
              consumedPids.add(entry.pid);
            });
          });

          userColumnTotals.set(info.userId, totals);
        });
      });
    });

    const rows = [...userColumnTotals.entries()].map(([userId, totals]) => {
      const cells = {};
      columns.forEach((col) => {
        const cell = totals[col.key];
        cells[col.key] = cell && cell.weeks ? cell.sum / cell.weeks : null;
      });
      return { userId, teamName: userNameById.get(userId) || "Unknown", cells };
    });

    return { columns, rows };
  },

  /*
    The "Total" page: every season combined. Reuses computeSeasonSummary
    per season and computeStats for career totals, then merges them —
    this is exact for top-5 lists and single-best records (a record that
    isn't in its own season's top 5 can't possibly be in the all-time top
    5 either), and a true weighted average for career scoring rates.
  */
  computeTotalSummary(seasonChain, deepSeasons, playerDirectory) {
    const perSeason = seasonChain.map((entry, idx) => DeepHistory.computeSeasonSummary(entry, deepSeasons[idx], playerDirectory));
    const { managers } = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);

    const standings = managers
      .map((m) => ({
        rosterId: m.userId,
        teamName: m.username || m.teamName,
        wins: m.careerWins,
        losses: m.careerLosses,
        ties: m.careerTies,
        fpts: m.careerPF,
        fptsAgainst: m.careerPA,
        championships: m.championships,
      }))
      .sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

    // Weekly trend: average score at each week-of-season INDEX, across
    // every season that reached that week — shows whether scoring
    // typically climbs or fades over the course of a season, league-wide.
    const weekBuckets = new Map();
    seasonChain.forEach((entry, idx) => {
      const deep = deepSeasons[idx];
      if (!deep) return;
      deep.weeks.forEach(({ week, matchups }) => {
        const bucket = weekBuckets.get(week) || { sum: 0, count: 0 };
        matchups.forEach((m) => {
          bucket.sum += m.points || 0;
          bucket.count += 1;
        });
        weekBuckets.set(week, bucket);
      });
    });
    const weeklyLeagueAvg = [...weekBuckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([week, b]) => ({ week, avg: b.count ? b.sum / b.count : 0 }));

    // True career scoring average per person (total points / total games).
    const userTotals = new Map();
    perSeason.forEach((s) => {
      s.teamAverages.forEach((t) => {
        if (!t.userId) return;
        const cur = userTotals.get(t.userId) || { teamName: t.username || t.teamName, sum: 0, games: 0 };
        cur.sum += t.total;
        cur.games += t.games;
        cur.teamName = t.username || t.teamName || cur.teamName;
        userTotals.set(t.userId, cur);
      });
    });
    const teamAverages = [...userTotals.entries()]
      .map(([userId, t]) => ({ userId, teamName: t.teamName, average: t.games ? t.sum / t.games : 0, total: t.sum }))
      .sort((a, b) => b.average - a.average);

    const positionTable = DeepHistory.buildPositionTableTotal(seasonChain, deepSeasons, playerDirectory);

    function pickAcrossSeasons(getField, better) {
      let cur = null;
      perSeason.forEach((s) => {
        const candidate = getField(s);
        if (!candidate) return;
        if (!cur || better(candidate, cur)) cur = candidate;
      });
      return cur;
    }

    const highestWeekScore = pickAcrossSeasons((s) => s.highestWeekScore, (a, b) => a.points > b.points);
    const lowestWeekScore = pickAcrossSeasons((s) => s.lowestWeekScore, (a, b) => a.points < b.points);
    const bestValuePick = pickAcrossSeasons((s) => s.bestValuePick, (a, b) => a.points > b.points);
    const worstValuePick = pickAcrossSeasons((s) => s.worstValuePick, (a, b) => a.points < b.points);
    const pointsLeader = pickAcrossSeasons((s) => s.pointsLeader, (a, b) => a.points > b.points);

    const allClosest = perSeason.flatMap((s) => s.top5Closest);
    const allBlowouts = perSeason.flatMap((s) => s.top5Blowouts);
    const top5Closest = [...allClosest].sort((a, b) => a.margin - b.margin).slice(0, 5);
    const top5Blowouts = [...allBlowouts].sort((a, b) => b.margin - a.margin).slice(0, 5);

    const bestByPosition = {};
    ["QB", "RB", "WR", "TE", "K", "DEF"].forEach((pos) => {
      let cur = null;
      perSeason.forEach((s) => {
        const candidate = s.bestByPosition[pos];
        if (candidate && (!cur || candidate.points > cur.points)) cur = candidate;
      });
      bestByPosition[pos] = cur;
    });

    return {
      season: "All-Time",
      status: "complete",
      standings,
      championRosterId: null,
      weeksPlayed: seasonChain.length,
      weeklyLeagueAvg,
      teamAverages,
      positionTable,
      highestWeekScore,
      lowestWeekScore,
      top5Closest,
      top5Blowouts,
      bestByPosition,
      bestValuePick,
      worstValuePick,
      pointsLeader,
      bracket: null,
    };
  },
};
