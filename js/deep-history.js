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
    "Overall Record" (a.k.a. all-play record): for every week, compares a
    team's score against every OTHER team that played that week — a win
    for each team outscored, a loss for each that outscored them, a tie
    for equal scores. This is what a team's record would look like if they
    played the whole league every week instead of just one opponent.
  */
  computeOverallRecords(deepWeeks, playoffStart) {
    const byRoster = new Map(); // roster_id -> {wins, losses, ties}
    (deepWeeks || [])
      .filter((w) => playoffStart == null || w.week < playoffStart)
      .forEach(({ matchups }) => {
      const scores = matchups.map((m) => ({ rosterId: m.roster_id, points: m.points || 0 }));
      scores.forEach(({ rosterId, points }) => {
        const rec = byRoster.get(rosterId) || { wins: 0, losses: 0, ties: 0 };
        scores.forEach((other) => {
          if (other.rosterId === rosterId) return;
          if (points > other.points) rec.wins += 1;
          else if (points < other.points) rec.losses += 1;
          else rec.ties += 1;
        });
        byRoster.set(rosterId, rec);
      });
    });
    return byRoster;
  },

  /*
    Each roster's REAL win/loss/tie record (their actual head-to-head
    result each week, not the all-play comparison above), optionally
    filtered down to specific matchups via `pairFilter(week, rosterA,
    rosterB)`. Used for Regular Season record (filter: week before
    playoffs) and Playoff record (filter: genuinely on the path to 1st
    or 3rd place, via relevantPlayoffPairs).
  */
  computeActualRecords(deepWeeks, pairFilter) {
    const byRoster = new Map(); // roster_id -> {wins, losses, ties}
    (deepWeeks || []).forEach(({ week, matchups }) => {
      const byMatchupId = new Map();
      matchups.forEach((m) => {
        if (m.matchup_id == null) return;
        if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
        byMatchupId.get(m.matchup_id).push(m);
      });
      byMatchupId.forEach((pair) => {
        if (pair.length < 2) return;
        const [a, b] = pair;
        if (pairFilter && !pairFilter(week, a.roster_id, b.roster_id)) return;
        const recA = byRoster.get(a.roster_id) || { wins: 0, losses: 0, ties: 0 };
        const recB = byRoster.get(b.roster_id) || { wins: 0, losses: 0, ties: 0 };
        if (a.points > b.points) {
          recA.wins += 1;
          recB.losses += 1;
        } else if (a.points < b.points) {
          recA.losses += 1;
          recB.wins += 1;
        } else {
          recA.ties += 1;
          recB.ties += 1;
        }
        byRoster.set(a.roster_id, recA);
        byRoster.set(b.roster_id, recB);
      });
    });
    return byRoster;
  },

  // "Luck" = actual win% minus overall (all-play) win%, as a percentage
  // point difference. Positive means their real record is better than
  // their underlying scoring deserved (lucky schedule); negative means
  // worse (unlucky schedule).
  luckPercent(wins, losses, ties, overallWins, overallLosses, overallTies) {
    const games = wins + losses + ties;
    const overallGames = overallWins + overallLosses + overallTies;
    if (!games || !overallGames) return 0;
    return (wins / games - overallWins / overallGames) * 100;
  },

  // Turns one team's raw matchup object for a week into a display-ready
  // starting lineup: [{ slot, player, points }], using that season's own
  // roster_positions to label each starter's slot correctly.
  lineupForMatchup(m, slotTypes, playerDirectory) {
    if (!m) return [];
    const pointsMap = m.players_points || {};
    return (m.starters || [])
      .map((pid, i) => {
        if (!pid || pid === "0") return null;
        return {
          slot: SleeperAPI.friendlySlotLabel(slotTypes[i] || "?"),
          player: SleeperAPI.playerName(playerDirectory, pid),
          points: pointsMap[pid] || 0,
        };
      })
      .filter(Boolean);
  },

  /*
    Fetches everything for one season. Returns:
    { leagueId, season, weeks: [{week, matchups}], transactions: [...], draft: {draftId, picks} | null }
  */
  async fetchSeasonDeep(seasonEntry, onProgress) {
    const { league } = seasonEntry;
    const leagueId = league.league_id;
    const isComplete = league.status === "complete";
    // v3: bumped from v2 to split out scheduleWeeks (see below) and to
    // make sure "played weeks" is judged by actual scoring, not just
    // whether the API returned a non-empty array.
    const cacheKey = `deep_season_v3_${leagueId}`;

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

    // Walk weeks 1..LAST_FANTASY_WEEK until we hit a week with no data at
    // all. Sleeper generates the whole season's matchup pairings upfront,
    // so this array is often non-empty for future weeks too — it just has
    // no score yet. We keep everything fetched as `scheduleWeeks` (needed
    // for the Monte Carlo playoff simulator's remaining schedule), and
    // separately filter down to `weeks` — weeks where a game has actually
    // been played — since that's what every other stat on the site should
    // be built from.
    const scheduleWeeksRaw = [];
    for (let week = 1; week <= LAST_FANTASY_WEEK; week++) {
      let matchups;
      try {
        matchups = await SleeperAPI.getMatchups(leagueId, week);
      } catch (err) {
        break;
      }
      if (!matchups || matchups.length === 0) break;
      scheduleWeeksRaw.push({ week, matchups });
    }
    const weeksRaw = scheduleWeeksRaw.filter(({ matchups }) => matchups.some((m) => (m.points || 0) > 0));

    // Transactions, one call per week we found ANY data for (so this
    // still includes the current in-progress week). Limited concurrency
    // so we're not firing 15+ requests at once.
    const txPerWeek = await mapWithConcurrency(
      scheduleWeeksRaw.map((w) => w.week),
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

    const result = { leagueId, season: league.season, weeks: weeksRaw, scheduleWeeks: scheduleWeeksRaw, transactions, draft };

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
    const headToHeadPlayoffs = new Map(); // same shape, but only weeks >= that season's playoff start

    function h2hRecord(userId, opponentId) {
      if (!headToHead.has(userId)) headToHead.set(userId, new Map());
      const byOpponent = headToHead.get(userId);
      if (!byOpponent.has(opponentId)) byOpponent.set(opponentId, { wins: 0, losses: 0, ties: 0 });
      return byOpponent.get(opponentId);
    }

    function h2hPlayoffRecord(userId, opponentId) {
      if (!headToHeadPlayoffs.has(userId)) headToHeadPlayoffs.set(userId, new Map());
      const byOpponent = headToHeadPlayoffs.get(userId);
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
          thirdPlaceFinishes: 0,
          winningSeasons: 0,
          losingSeasons: 0,
          playoffAppearances: 0,
          byes: 0,
          firstPicks: 0,
          careerRegularSeasonWins: 0,
          careerRegularSeasonLosses: 0,
          careerRegularSeasonTies: 0,
          careerPlayoffWins: 0,
          careerPlayoffLosses: 0,
          careerPlayoffTies: 0,
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
      const chainEntry = seasonEntry; // kept under this name since `seasonEntry` gets shadowed below
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
      const thirdPlaceRosterId = SleeperAPI.findThirdPlaceRosterId(bracket);
      const playoffStart = league.settings && league.settings.playoff_week_start;
      // Exact set of (week, roster-pair) matchups that are genuinely on the
      // path to 1st or 3rd place, so Playoff H2H only counts real playoff
      // games — not the 5th-place game or any other consolation-bracket
      // matchup that happens to fall in a "playoff week."
      const relevantPlayoffPairs = new Set();
      if (bracket && bracket.length && playoffStart != null) {
        SleeperAPI.relevantBracketGames(bracket).forEach((g) => {
          const t1Id = SleeperAPI.resolveBracketTeamId(bracket, g, "t1");
          const t2Id = SleeperAPI.resolveBracketTeamId(bracket, g, "t2");
          if (t1Id == null || t2Id == null) return;
          const week = playoffStart + (g.r - 1);
          relevantPlayoffPairs.add(`${week}:${Math.min(t1Id, t2Id)}-${Math.max(t1Id, t2Id)}`);
        });
      }
      const overallRecordByRoster = DeepHistory.computeOverallRecords(deep ? deep.weeks : [], playoffStart);
      const regularSeasonByRoster = DeepHistory.computeActualRecords(deep ? deep.weeks : [], (week) => playoffStart == null || week < playoffStart);
      const playoffByRoster = DeepHistory.computeActualRecords(deep ? deep.weeks : [], (week, a, b) => relevantPlayoffPairs.has(`${week}:${Math.min(a, b)}-${Math.max(a, b)}`));
      const byeRosterIdsThisSeason = new Set(SleeperAPI.byeRosterIds(bracket));

      const seasonEntryByRosterId = new Map(); // this season only, for attaching draft picks below

      standings.forEach((s, rank) => {
        if (!s.userId) return;
        const m = getManager(s.userId, s.teamName, s.username);
        const overall = overallRecordByRoster.get(s.rosterId) || { wins: 0, losses: 0, ties: 0 };
        const regSeason = regularSeasonByRoster.get(s.rosterId) || { wins: 0, losses: 0, ties: 0 };
        const playoff = playoffByRoster.get(s.rosterId) || { wins: 0, losses: 0, ties: 0 };
        const seasonEntry = {
          season,
          rosterId: s.rosterId,
          rank: rank + 1,
          wins: s.wins,
          losses: s.losses,
          ties: s.ties,
          fpts: s.fpts,
          fptsAgainst: s.fptsAgainst,
          overallWins: overall.wins,
          overallLosses: overall.losses,
          overallTies: overall.ties,
          luckPct: DeepHistory.luckPercent(s.wins, s.losses, s.ties, overall.wins, overall.losses, overall.ties),
          regularSeasonWins: regSeason.wins,
          regularSeasonLosses: regSeason.losses,
          regularSeasonTies: regSeason.ties,
          playoffWins: playoff.wins,
          playoffLosses: playoff.losses,
          playoffTies: playoff.ties,
          isWinningSeason: regSeason.wins > regSeason.losses,
          isLosingSeason: regSeason.losses > regSeason.wins,
          isPlayoffAppearance: playoff.wins + playoff.losses + playoff.ties > 0,
          isBye: byeRosterIdsThisSeason.has(s.rosterId),
          isChampion: s.rosterId === championRosterId,
          isRunnerUp: s.rosterId === runnerUpRosterId,
          isThirdPlace: s.rosterId === thirdPlaceRosterId,
          startingLineup: DeepHistory.buildStartingLineup(s.rosterId, chainEntry, deep, playerDirectory),
          draftPicks: [],
        };
        m.seasons.push(seasonEntry);
        seasonEntryByRosterId.set(s.rosterId, seasonEntry);
        m.careerWins += s.wins;
        m.careerLosses += s.losses;
        m.careerTies += s.ties;
        m.careerPF += s.fpts;
        m.careerPA += s.fptsAgainst;
        m.careerRegularSeasonWins += regSeason.wins;
        m.careerRegularSeasonLosses += regSeason.losses;
        m.careerRegularSeasonTies += regSeason.ties;
        m.careerPlayoffWins += playoff.wins;
        m.careerPlayoffLosses += playoff.losses;
        m.careerPlayoffTies += playoff.ties;
        if (seasonEntry.isWinningSeason) m.winningSeasons += 1;
        if (seasonEntry.isLosingSeason) m.losingSeasons += 1;
        if (seasonEntry.isPlayoffAppearance) m.playoffAppearances += 1;
        if (seasonEntry.isBye) m.byes += 1;
        if (s.rosterId === championRosterId) m.championships += 1;
        if (s.rosterId === runnerUpRosterId) m.runnerUps += 1;
        if (s.rosterId === thirdPlaceRosterId) m.thirdPlaceFinishes += 1;
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
              const isPlayoffWeek = relevantPlayoffPairs.has(`${week}:${Math.min(a.roster_id, b.roster_id)}-${Math.max(a.roster_id, b.roster_id)}`);
              const aPlayoffRec = isPlayoffWeek ? h2hPlayoffRecord(aInfo.userId, bInfo.userId) : null;
              const bPlayoffRec = isPlayoffWeek ? h2hPlayoffRecord(bInfo.userId, aInfo.userId) : null;
              if (a.points > b.points) {
                aRec.wins += 1;
                bRec.losses += 1;
                if (isPlayoffWeek) {
                  aPlayoffRec.wins += 1;
                  bPlayoffRec.losses += 1;
                }
              } else if (a.points < b.points) {
                aRec.losses += 1;
                bRec.wins += 1;
                if (isPlayoffWeek) {
                  aPlayoffRec.losses += 1;
                  bPlayoffRec.wins += 1;
                }
              } else {
                aRec.ties += 1;
                bRec.ties += 1;
                if (isPlayoffWeek) {
                  aPlayoffRec.ties += 1;
                  bPlayoffRec.ties += 1;
                }
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
            if (pick.pick_no === 1 && info) {
              const firstPickManager = getManager(info.userId, info.teamName, info.username);
              firstPickManager.firstPicks += 1;
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
        headToHeadPlayoffs: [...(headToHeadPlayoffs.get(m.userId) || new Map()).entries()]
          .filter(([, rec]) => rec.wins + rec.losses + rec.ties > 0)
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

    const playoffStart = league.settings && league.settings.playoff_week_start;
    const overallRecordByRoster = DeepHistory.computeOverallRecords(deep ? deep.weeks : [], playoffStart);
    const standings = SleeperAPI.buildStandings(rosters, users).map((s) => {
      const overall = overallRecordByRoster.get(s.rosterId) || { wins: 0, losses: 0, ties: 0 };
      return {
        ...s,
        teamName: s.username || s.teamName, // Season page shows usernames, not custom team names
        overallWins: overall.wins,
        overallLosses: overall.losses,
        overallTies: overall.ties,
        luckPct: DeepHistory.luckPercent(s.wins, s.losses, s.ties, overall.wins, overall.losses, overall.ties),
      };
    });
    const championRosterId = SleeperAPI.findChampionRosterId(bracket);

    const EXCLUDE_SLOTS = new Set(["BN", "IR", "TAXI"]);
    const slotTypes = (league.roster_positions || []).filter((p) => !EXCLUDE_SLOTS.has(p));

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

        const entry = {
          points: m.points || 0,
          teamName: info.teamName,
          week,
          season: league.season,
          lineup: DeepHistory.lineupForMatchup(m, slotTypes, playerDirectory),
        };
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
        const winnerM = a.points >= b.points ? a : b;
        const loserM = a.points >= b.points ? b : a;
        allMargins.push({
          margin,
          winner,
          loser,
          winnerPts,
          loserPts,
          week,
          season: league.season,
          winnerLineup: DeepHistory.lineupForMatchup(winnerM, slotTypes, playerDirectory),
          loserLineup: DeepHistory.lineupForMatchup(loserM, slotTypes, playerDirectory),
        });
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

    // ---- Top 5 most expensive FAAB waiver pickups this season (only
    //      meaningful for leagues using FAAB bidding — seasons that used
    //      plain waiver priority instead simply won't have bid amounts) ----
    const faabPickups = [];
    if (deep && deep.transactions) {
      deep.transactions.forEach((tx) => {
        if (!tx || tx.status !== "complete") return;
        const bid = tx.settings && tx.settings.waiver_bid;
        if (!bid) return;
        Object.entries(tx.adds || {}).forEach(([playerId, rid]) => {
          const info = rosterInfo.get(rid);
          faabPickups.push({
            player: playerName(playerId),
            teamName: info ? info.teamName : "Unknown",
            bid,
            week: tx.leg,
            season: league.season,
          });
        });
      });
    }
    const top5FaabPickups = [...faabPickups].sort((a, b) => b.bid - a.bid).slice(0, 5);

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

    const bracket_ = DeepHistory.buildBracket(seasonEntry, deep, playerDirectory);

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
      top5FaabPickups,
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
  /*
    Reconstructs a team's "typical" starting lineup for one season: for
    each roster slot, whichever player filled it most often. Counts every
    regular-season week, plus any playoff week that team was still in
    genuine contention for 1st or 3rd place (via relevantBracketGames) —
    the 5th-place game and anything after elimination don't count.

    Slot assignment mirrors the scoring-by-slot table: QB pools together
    dedicated-QB and SUPERFLEX-as-QB starts. RB/WR/TE each pool their
    dedicated slot with FLEX-as-that-position and SUPERFLEX-as-that-
    position starts. Once QB and every RB/WR/TE slot is assigned, FLEX is
    whoever (not already claimed) started at FLEX most often; SUPERFLEX is
    decided last the same way, excluding everyone already claimed
    (including FLEX).
  */
  buildStartingLineup(rosterId, seasonEntry, deep, playerDirectory) {
    const { league, bracket } = seasonEntry;
    const playoffStart = league.settings && league.settings.playoff_week_start;

    const relevantPlayoffWeeks = new Set();
    if (bracket && bracket.length) {
      SleeperAPI.relevantBracketGames(bracket).forEach((g) => {
        const t1Id = SleeperAPI.resolveBracketTeamId(bracket, g, "t1");
        const t2Id = SleeperAPI.resolveBracketTeamId(bracket, g, "t2");
        if (playoffStart != null && (t1Id === rosterId || t2Id === rosterId)) {
          relevantPlayoffWeeks.add(playoffStart + (g.r - 1));
        }
      });
    }

    const weeks = (deep ? deep.weeks : []).filter(
      (w) => playoffStart == null || w.week < playoffStart || relevantPlayoffWeeks.has(w.week)
    );

    const EXCLUDE = new Set(["BN", "IR", "TAXI"]);
    const slotTypes = (league.roster_positions || []).filter((p) => !EXCLUDE.has(p));
    const countByType = {};
    slotTypes.forEach((t) => {
      countByType[t] = (countByType[t] || 0) + 1;
    });

    const KNOWN_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
    function nativePosition(pid) {
      const p = playerDirectory && playerDirectory[pid];
      return p && KNOWN_POS.has(p.position) ? p.position : null;
    }

    const slotCounts = {}; // literal slot type -> Map(playerId -> starts)
    let weeksCounted = 0;

    weeks.forEach(({ matchups }) => {
      const m = matchups.find((mm) => mm.roster_id === rosterId);
      if (!m) return;
      weeksCounted += 1;
      (m.starters || []).forEach((pid, i) => {
        const slotType = slotTypes[i];
        if (!slotType || !pid || pid === "0") return;
        if (!slotCounts[slotType]) slotCounts[slotType] = new Map();
        slotCounts[slotType].set(pid, (slotCounts[slotType].get(pid) || 0) + 1);
      });
    });

    function mergeCounts(...maps) {
      const merged = new Map();
      maps.forEach((m) => {
        (m || new Map()).forEach((count, pid) => {
          merged.set(pid, (merged.get(pid) || 0) + count);
        });
      });
      return merged;
    }
    function filterByPosition(countMap, pos) {
      const filtered = new Map();
      (countMap || new Map()).forEach((count, pid) => {
        if (nativePosition(pid) === pos) filtered.set(pid, count);
      });
      return filtered;
    }
    function topN(countMap, n) {
      return [...(countMap || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
    }

    // ---- Who acquired each player, and how (Draft / Trade / Waivers /
    //      Free Agency) — latest genuine acquisition wins if a player was
    //      added more than once. Falls back to "Roster" for keeper/
    //      dynasty holdovers with no transaction this season.
    //
    //      Sleeper sometimes logs an internal roster move (e.g. activating
    //      someone off IR) as a transaction that adds AND drops the same
    //      player on the same roster at once. That's not a real
    //      acquisition, so those are explicitly ignored — otherwise a
    //      drafted player could wrongly flip to "Free Agency" the moment
    //      their IR status changes. A player only counts as re-acquired
    //      if they were genuinely dropped by this roster at some earlier
    //      point and then later actually added back. ----
    const acquisitionByPlayer = new Map();
    const onRoster = new Set(); // players currently considered rostered, as we replay the season
    if (deep && deep.draft && deep.draft.picks) {
      deep.draft.picks.forEach((p) => {
        if (p.roster_id === rosterId && p.player_id) {
          acquisitionByPlayer.set(p.player_id, "Draft");
          onRoster.add(p.player_id);
        }
      });
    }
    if (deep && deep.transactions) {
      const sortedTx = [...deep.transactions].sort((a, b) => (a.leg || 0) - (b.leg || 0));
      sortedTx.forEach((tx) => {
        if (!tx || tx.status !== "complete") return;
        const label = tx.type === "trade" ? "Trade" : tx.type === "waiver" ? "Waivers" : tx.type === "free_agent" ? "Free Agency" : null;
        const adds = tx.adds || {};
        const drops = tx.drops || {};
        // A player added AND dropped by the SAME roster within this same
        // transaction is a same-team toggle, not a real transfer — skip it.
        const selfToggled = new Set(Object.keys(adds).filter((pid) => drops[pid] != null && drops[pid] === adds[pid]));

        Object.entries(drops).forEach(([playerId, rid]) => {
          if (rid === rosterId && !selfToggled.has(playerId)) onRoster.delete(playerId);
        });
        if (!label) return;
        Object.entries(adds).forEach(([playerId, rid]) => {
          if (rid !== rosterId || selfToggled.has(playerId)) return;
          if (onRoster.has(playerId)) return; // already considered rostered — not a new acquisition
          acquisitionByPlayer.set(playerId, label);
          onRoster.add(playerId);
        });
      });
    }

    const claimed = new Set();
    const slots = [];
    function pushSlot(label, pid, count) {
      if (pid) claimed.add(pid);
      slots.push({
        slot: label,
        player: pid ? SleeperAPI.playerName(playerDirectory, pid) : null,
        starts: pid ? count : 0,
        acquisition: pid ? acquisitionByPlayer.get(pid) || "Roster" : null,
      });
    }

    // QB: dedicated QB + SUPERFLEX-as-QB.
    const qbCount = countByType.QB || 0;
    if (qbCount > 0) {
      const pool = mergeCounts(slotCounts.QB, filterByPosition(slotCounts.SUPER_FLEX, "QB"));
      const top = topN(pool, qbCount);
      for (let i = 0; i < qbCount; i++) {
        const entry = top[i];
        pushSlot(qbCount > 1 ? `QB${i + 1}` : "QB", entry ? entry[0] : null, entry ? entry[1] : 0);
      }
    }

    // RB / WR / TE: each pools its dedicated slot(s) with FLEX-as-that-
    // position and SUPERFLEX-as-that-position.
    ["RB", "WR", "TE"].forEach((pos) => {
      const count = countByType[pos] || 0;
      if (count === 0) return;
      const pool = mergeCounts(slotCounts[pos], filterByPosition(slotCounts.FLEX, pos), filterByPosition(slotCounts.SUPER_FLEX, pos));
      const top = topN(pool, count);
      for (let i = 0; i < count; i++) {
        const entry = top[i];
        pushSlot(count > 1 ? `${pos}${i + 1}` : pos, entry ? entry[0] : null, entry ? entry[1] : 0);
      }
    });

    // K / DEF: never flex-eligible, so literal counts only.
    ["K", "DEF"].forEach((pos) => {
      const count = countByType[pos] || 0;
      if (count === 0) return;
      const top = topN(slotCounts[pos], count);
      for (let i = 0; i < count; i++) {
        const entry = top[i];
        pushSlot(count > 1 ? `${pos}${i + 1}` : pos, entry ? entry[0] : null, entry ? entry[1] : 0);
      }
    });

    // FLEX: whoever (not already claimed above) started at FLEX most often.
    if (slotCounts.FLEX) {
      const remaining = new Map();
      slotCounts.FLEX.forEach((count, pid) => {
        if (!claimed.has(pid)) remaining.set(pid, count);
      });
      const top = topN(remaining, 1)[0];
      pushSlot("FLEX", top ? top[0] : null, top ? top[1] : 0);
    }

    // SUPERFLEX: decided last, excluding everyone already claimed (incl. FLEX).
    if (slotCounts.SUPER_FLEX) {
      const remaining = new Map();
      slotCounts.SUPER_FLEX.forEach((count, pid) => {
        if (!claimed.has(pid)) remaining.set(pid, count);
      });
      const top = topN(remaining, 1)[0];
      pushSlot("SFLX", top ? top[0] : null, top ? top[1] : 0);
    }

    // Any other custom/exotic flex-type slot (rare) — literal tally only.
    const seenFlexTypes = [];
    slotTypes.forEach((t) => {
      if (["FLEX", "SUPER_FLEX"].includes(t) || !t.includes("FLEX") || seenFlexTypes.includes(t)) return;
      seenFlexTypes.push(t);
    });
    seenFlexTypes.forEach((slotType) => {
      const top = topN(slotCounts[slotType], 1)[0];
      pushSlot(SleeperAPI.friendlySlotLabel(slotType), top ? top[0] : null, top ? top[1] : 0);
    });

    return { slots, weeksCounted };
  },

  buildBracket(seasonEntry, deep, playerDirectory) {
    const { league, rosters, users, bracket } = seasonEntry;
    if (!bracket || !bracket.length) return null;

    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const teamNameById = new Map();
    rosters.forEach((r) => {
      const user = usersById.get(r.owner_id);
      teamNameById.set(r.roster_id, user ? user.display_name || SleeperAPI.teamName(user, r.roster_id) : SleeperAPI.teamName(user, r.roster_id));
    });

    const playoffStart = league.settings && league.settings.playoff_week_start;
    const EXCLUDE = new Set(["BN", "IR", "TAXI"]);
    const slotTypes = (league.roster_positions || []).filter((p) => !EXCLUDE.has(p));

    function matchupFor(rosterId, round) {
      if (rosterId == null || !playoffStart || !deep) return null;
      const week = playoffStart + (round - 1);
      const weekData = deep.weeks.find((w) => w.week === week);
      if (!weekData) return null;
      return weekData.matchups.find((mm) => mm.roster_id === rosterId) || null;
    }

    function lineupFor(m) {
      return DeepHistory.lineupForMatchup(m, slotTypes, playerDirectory);
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
      const id = SleeperAPI.resolveBracketTeamId(bracket, game, slotKey);
      const m = matchupFor(id, game.r);
      return {
        name: id != null ? teamNameById.get(id) || `Roster ${id}` : "TBD",
        score: m ? m.points : null,
        isWinner: game.w != null && id != null && game.w === id,
        lineup: lineupFor(m),
      };
    }

    const byRound = new Map();
    [...bracket]
      .filter((g) => g.p !== 5) // 5th-place game isn't shown
      .sort((a, b) => a.r - b.r || a.m - b.m)
      .forEach((g) => {
        const specialLabel = g.p === 1 ? "Championship" : g.p === 3 ? "3rd Place" : null;
        if (!byRound.has(g.r)) byRound.set(g.r, []);
        byRound.get(g.r).push({ team1: teamSlot(g, "t1"), team2: teamSlot(g, "t2"), specialLabel, isChampionship: g.p === 1 });
      });

    const rounds = [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([r, games]) => ({ roundNumber: r, label: roundLabel(r), games }));

    // ---- Champion + Finals MVP (highest-scoring starter on the winning
    //      team, in the championship game itself) ----
    let champion = null;
    const champGame = bracket.find((g) => g.p === 1);
    if (champGame && champGame.w != null) {
      const champRosterId = champGame.w;
      const m = matchupFor(champRosterId, champGame.r);
      let mvp = null;
      if (m) {
        (m.starters || []).forEach((pid) => {
          if (!pid || pid === "0") return;
          const pts = (m.players_points && m.players_points[pid]) || 0;
          if (!mvp || pts > mvp.points) mvp = { player: SleeperAPI.playerName(playerDirectory, pid), playerId: pid, points: pts };
        });
      }
      champion = { name: teamNameById.get(champRosterId) || `Roster ${champRosterId}`, mvp };
    }

    return { rounds, champion };
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
      addColumn(t, SleeperAPI.friendlySlotLabel(t));
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
    seenFlexTypes.forEach((t) => addColumn(t, SleeperAPI.friendlySlotLabel(t)));

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
      .map((m) => {
        const overallWins = m.seasons.reduce((sum, s) => sum + s.overallWins, 0);
        const overallLosses = m.seasons.reduce((sum, s) => sum + s.overallLosses, 0);
        const overallTies = m.seasons.reduce((sum, s) => sum + s.overallTies, 0);
        return {
          rosterId: m.userId,
          teamName: m.username || m.teamName,
          wins: m.careerWins,
          losses: m.careerLosses,
          ties: m.careerTies,
          fpts: m.careerPF,
          fptsAgainst: m.careerPA,
          championships: m.championships,
          overallWins,
          overallLosses,
          overallTies,
          luckPct: DeepHistory.luckPercent(m.careerWins, m.careerLosses, m.careerTies, overallWins, overallLosses, overallTies),
        };
      })
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

    const allFaabPickups = perSeason.flatMap((s) => s.top5FaabPickups || []);
    const top5FaabPickups = [...allFaabPickups].sort((a, b) => b.bid - a.bid).slice(0, 5);

    const bestByPosition = {};
    ["QB", "RB", "WR", "TE", "K", "DEF"].forEach((pos) => {
      let cur = null;
      perSeason.forEach((s) => {
        const candidate = s.bestByPosition[pos];
        if (candidate && (!cur || candidate.points > cur.points)) cur = candidate;
      });
      bestByPosition[pos] = cur;
    });

    // Every team-season's luck value, for the luckiest/unluckiest lists —
    // pulled straight from computeStats' per-manager season records.
    const allSeasonLuck = [];
    managers.forEach((m) => {
      m.seasons.forEach((s) => {
        allSeasonLuck.push({
          teamName: m.username || m.teamName,
          season: s.season,
          luckPct: s.luckPct,
          wins: s.wins,
          losses: s.losses,
          ties: s.ties,
          overallWins: s.overallWins,
          overallLosses: s.overallLosses,
          overallTies: s.overallTies,
        });
      });
    });
    const top5Luckiest = [...allSeasonLuck].sort((a, b) => b.luckPct - a.luckPct).slice(0, 5);
    const top5Unluckiest = [...allSeasonLuck].sort((a, b) => a.luckPct - b.luckPct).slice(0, 5);

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
      top5Luckiest,
      top5Unluckiest,
      top5FaabPickups,
      bestByPosition,
      bestValuePick,
      worstValuePick,
      pointsLeader,
      bracket: null,
    };
  },

  // Mimics scipy.stats.rankdata's default "average" tie-breaking: tied
  // values share the average of the ranks they'd occupy. `ascending`
  // controls whether the smallest or largest value gets rank 1.
  rankData(values, ascending = true) {
    const n = values.length;
    const order = values.map((v, i) => i).sort((a, b) => (ascending ? values[a] - values[b] : values[b] - values[a]));
    const ranks = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++;
      const avgRank = (i + 1 + (j + 1)) / 2;
      for (let k = i; k <= j; k++) ranks[order[k]] = avgRank;
      i = j + 1;
    }
    return ranks;
  },

  /*
    Boom/bust counts per roster: how many times a starter cleared the
    "boom" threshold for their position that week, or fell below the
    "bust" threshold, across every played week. Thresholds are the same
    regardless of which literal slot a player started in (dedicated,
    flex, or superflex) — only their real-world position matters.
  */
  computeBoomBust(rosterInfo, deepWeeks, playerDirectory) {
    const BOOM = { QB: 25, RB: 20, WR: 20, TE: 20, K: 15, DEF: 15 };
    const BUST = { QB: 10, RB: 5, WR: 5, TE: 5, K: 4, DEF: 4 };
    const KNOWN_POS = new Set(Object.keys(BOOM));
    function nativePosition(pid) {
      const p = playerDirectory && playerDirectory[pid];
      return p && KNOWN_POS.has(p.position) ? p.position : null;
    }
    const counts = new Map(); // rosterId -> {boom, bust}
    (deepWeeks || []).forEach(({ matchups }) => {
      matchups.forEach((m) => {
        if (!rosterInfo.has(m.roster_id)) return;
        const rec = counts.get(m.roster_id) || { boom: 0, bust: 0 };
        const pointsMap = m.players_points || {};
        (m.starters || []).forEach((pid) => {
          if (!pid || pid === "0") return;
          const pos = nativePosition(pid);
          if (!pos) return;
          const pts = pointsMap[pid] || 0;
          if (pts > BOOM[pos]) rec.boom += 1;
          else if (pts < BUST[pos]) rec.bust += 1;
        });
        counts.set(m.roster_id, rec);
      });
    });
    return counts;
  },

  /*
    Monte Carlo playoff-odds simulation. For each of `iterations` random
    "seasons," every team's rest-of-season scoring is sampled around a
    simulated skill level derived from their FantasyPros ROS power score
    (falls back to the field's average score, or a neutral default, for
    any team without one yet), remaining games are played out according
    to the real schedule, and the final standings are tallied (ties
    broken by points-for, same as Sleeper itself). Returns, for each
    roster_id, the probability (%) of finishing in each possible final
    rank — works for any number of teams.
  */
  simulatePlayoffOdds(rosterIds, currentRecordByRoster, remainingWeeks, rosPtByRoster, iterations) {
    const n = rosterIds.length;
    const knownPts = rosterIds.map((id) => rosPtByRoster.get(id)).filter((v) => v != null);
    const fallbackPt = knownPts.length ? knownPts.reduce((a, b) => a + b, 0) / knownPts.length : 70;

    const finishCounts = new Map();
    rosterIds.forEach((id) => finishCounts.set(id, new Array(n).fill(0)));

    for (let iter = 0; iter < iterations; iter++) {
      const teamMean = new Map();
      rosterIds.forEach((id) => {
        const pt = rosPtByRoster.has(id) ? rosPtByRoster.get(id) : fallbackPt;
        teamMean.set(id, gaussianRandom(pt / 2 + 30, 5));
      });

      const wins = new Map();
      const losses = new Map();
      const ties = new Map();
      const pf = new Map();
      rosterIds.forEach((id) => {
        const rec = currentRecordByRoster.get(id) || { wins: 0, losses: 0, ties: 0, pf: 0 };
        wins.set(id, rec.wins);
        losses.set(id, rec.losses);
        ties.set(id, rec.ties || 0);
        pf.set(id, rec.pf);
      });

      remainingWeeks.forEach((pairs) => {
        pairs.forEach(([a, b]) => {
          const scoreA = gaussianRandom(teamMean.get(a), 20);
          const scoreB = gaussianRandom(teamMean.get(b), 20);
          pf.set(a, pf.get(a) + scoreA);
          pf.set(b, pf.get(b) + scoreB);
          if (scoreA > scoreB) {
            wins.set(a, wins.get(a) + 1);
            losses.set(b, losses.get(b) + 1);
          } else if (scoreB > scoreA) {
            wins.set(b, wins.get(b) + 1);
            losses.set(a, losses.get(a) + 1);
          } else {
            ties.set(a, ties.get(a) + 1);
            ties.set(b, ties.get(b) + 1);
          }
        });
      });

      const ranked = [...rosterIds].sort((x, y) => {
        const gx = wins.get(x) + losses.get(x) + ties.get(x);
        const gy = wins.get(y) + losses.get(y) + ties.get(y);
        const pctX = gx ? wins.get(x) / gx : 0;
        const pctY = gy ? wins.get(y) / gy : 0;
        if (pctY !== pctX) return pctY - pctX;
        return pf.get(y) - pf.get(x);
      });
      ranked.forEach((id, idx) => {
        finishCounts.get(id)[idx] += 1;
      });
    }

    const result = new Map();
    rosterIds.forEach((id) => result.set(id, finishCounts.get(id).map((c) => (c / iterations) * 100)));
    return result;
  },

  /*
    Builds the full Power Rankings table for the current season: actual
    record, all-play "Overall" record, scoring average/std-dev, boom/bust
    counts, ROS rank (from team-strength.json), and simulated playoff/bye
    odds — combined into one composite "PR Score" (a weighted average of
    ranks, lower is better) that determines each team's Power Rank.
    Works for any number of teams (not hardcoded to any one league size).
  */
  computePowerRankings(seasonEntry, deep, playerDirectory, teamStrengthTeams, iterations = 1000) {
    const { league, rosters, users } = seasonEntry;
    const usersById = new Map(users.map((u) => [u.user_id, u]));
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
    const rosterIds = standings.map((s) => s.rosterId);
    const weeksPlayed = deep ? deep.weeks.length : 0;

    const playoffStart = league.settings && league.settings.playoff_week_start;
    const overallByRoster = DeepHistory.computeOverallRecords(deep ? deep.weeks : [], playoffStart);
    const boomBustByRoster = DeepHistory.computeBoomBust(rosterInfo, deep ? deep.weeks : [], playerDirectory);

    // ROS rank/pt, keyed to roster via Sleeper username.
    const rosRankByRoster = new Map();
    const rosPtByRoster = new Map();
    standings.forEach((s) => {
      const entry = s.username && teamStrengthTeams ? teamStrengthTeams[s.username] : null;
      if (entry && entry.rank != null) rosRankByRoster.set(s.rosterId, entry.rank);
      if (entry && entry.pt != null) rosPtByRoster.set(s.rosterId, entry.pt);
    });
    const knownRanks = [...rosRankByRoster.values()];
    const fallbackRank = knownRanks.length ? (Math.min(...knownRanks) + Math.max(...knownRanks)) / 2 : (rosterIds.length + 1) / 2;

    // Remaining schedule, from weeks that were fetched but haven't been
    // played yet (see fetchSeasonDeep's scheduleWeeks).
    const playedWeekNumbers = new Set((deep ? deep.weeks : []).map((w) => w.week));
    const scheduleSource = deep && deep.scheduleWeeks ? deep.scheduleWeeks : [];
    const remainingWeeks = scheduleSource
      .filter((w) => !playedWeekNumbers.has(w.week) && (playoffStart == null || w.week < playoffStart))
      .map(({ matchups }) => {
        const byMatchupId = new Map();
        matchups.forEach((m) => {
          if (m.matchup_id == null) return;
          if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
          byMatchupId.get(m.matchup_id).push(m.roster_id);
        });
        return [...byMatchupId.values()].filter((pair) => pair.length === 2);
      });

    const currentRecordByRoster = new Map();
    standings.forEach((s) => {
      currentRecordByRoster.set(s.rosterId, { wins: s.wins, losses: s.losses, ties: s.ties, pf: s.fpts });
    });

    const playoffOddsByRoster = DeepHistory.simulatePlayoffOdds(rosterIds, currentRecordByRoster, remainingWeeks, rosPtByRoster, iterations);

    // How many teams make the playoffs / get a first-round bye, read
    // straight from the league's own settings — not hardcoded to any one
    // league size. Sleeper's bracket only comes in 4/6/8-team sizes.
    const playoffTeams = (league.settings && league.settings.playoff_teams) || Math.min(6, rosterIds.length);
    const byeTeams = playoffTeams === 6 ? 2 : 0;

    const rows = standings.map((s) => {
      const overall = overallByRoster.get(s.rosterId) || { wins: 0, losses: 0, ties: 0 };
      const bb = boomBustByRoster.get(s.rosterId) || { boom: 0, bust: 0 };
      const dist = playoffOddsByRoster.get(s.rosterId) || [];
      const playoffPct = dist.slice(0, playoffTeams).reduce((a, b) => a + b, 0);
      const byePct = byeTeams ? dist.slice(0, byeTeams).reduce((a, b) => a + b, 0) : null;
      const avgPpg = weeksPlayed ? s.fpts / weeksPlayed : 0;

      return {
        rosterId: s.rosterId,
        userId: s.userId,
        teamName: s.username || s.teamName,
        wins: s.wins,
        losses: s.losses,
        ties: s.ties,
        record: `${s.wins}-${s.losses}${s.ties ? "-" + s.ties : ""}`,
        overallWins: overall.wins,
        overallRecord: `${overall.wins}-${overall.losses}${overall.ties ? "-" + overall.ties : ""}`,
        avgPpg,
        playoffPct,
        byePct,
        rosRank: rosRankByRoster.has(s.rosterId) ? rosRankByRoster.get(s.rosterId) : null,
        boom: bb.boom,
        bust: bb.bust,
        finishDistribution: dist,
      };
    });

    // Std dev of weekly points (population formula — divide by N).
    const weeklyByRoster = new Map(rosterIds.map((id) => [id, []]));
    (deep ? deep.weeks : []).forEach(({ matchups }) => {
      matchups.forEach((m) => {
        if (weeklyByRoster.has(m.roster_id)) weeklyByRoster.get(m.roster_id).push(m.points || 0);
      });
    });
    rows.forEach((row) => {
      const pts = weeklyByRoster.get(row.rosterId) || [];
      if (!pts.length) {
        row.stdDev = 0;
        return;
      }
      const mean = pts.reduce((a, b) => a + b, 0) / pts.length;
      row.stdDev = Math.sqrt(pts.reduce((a, b) => a + (b - mean) ** 2, 0) / pts.length);
    });

    // Composite PR Score: a weighted average of ranks (1 = best in every
    // term), so a lower PR Score always means a stronger team overall.
    const recordRank = DeepHistory.rankData(rows.map((r) => r.wins), false);
    const overallRank = DeepHistory.rankData(rows.map((r) => r.overallWins), false);
    const ppgRank = DeepHistory.rankData(rows.map((r) => r.avgPpg), false);
    const playoffOddsRank = DeepHistory.rankData(rows.map((r) => r.playoffPct), false);
    const rosRankValues = rows.map((r) => (r.rosRank != null ? r.rosRank : fallbackRank));

    const WEIGHTS = { record: 4, overall: 4, ppg: 5, playoffOdds: 3, ros: 4 };
    const weightSum = WEIGHTS.record + WEIGHTS.overall + WEIGHTS.ppg + WEIGHTS.playoffOdds + WEIGHTS.ros;

    rows.forEach((row, i) => {
      row.prScore =
        (recordRank[i] * WEIGHTS.record +
          overallRank[i] * WEIGHTS.overall +
          ppgRank[i] * WEIGHTS.ppg +
          playoffOddsRank[i] * WEIGHTS.playoffOdds +
          rosRankValues[i] * WEIGHTS.ros) /
        weightSum;
    });

    const powerRank = DeepHistory.rankData(rows.map((r) => r.prScore), true); // lower score = better = rank 1
    rows.forEach((row, i) => {
      row.powerRank = powerRank[i];
    });

    // "Luck Rank" (1 = luckiest): teams whose actual win% is running well
    // ahead of their all-play win% get the lowest (best/luckiest) rank.
    const luckDiff = rows.map((r) => {
      const games = r.wins + r.losses + r.ties;
      const overallGames = r.overallWins + (overallByRoster.get(r.rosterId) ? overallByRoster.get(r.rosterId).losses + overallByRoster.get(r.rosterId).ties : 0);
      const actualPct = games ? r.wins / games : 0;
      const overallPct = overallGames ? r.overallWins / overallGames : 0;
      return overallPct - actualPct;
    });
    const luckRank = DeepHistory.rankData(luckDiff, true);
    rows.forEach((row, i) => {
      row.luckRank = luckRank[i];
    });

    rows.sort((a, b) => a.powerRank - b.powerRank);

    return {
      season: league.season,
      week: weeksPlayed,
      playoffTeams,
      byeTeams,
      rows,
    };
  },
};
