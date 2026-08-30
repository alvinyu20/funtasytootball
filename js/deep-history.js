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

    For a completed season, tries — in order — the browser's own
    localStorage cache, then this site's static data/sleeper-archive/
    backup, before ever falling back to a live, multi-request fetch
    from Sleeper's API. See scripts/backup-sleeper-data.js for how that
    backup gets populated.
  */
  async fetchSeasonDeep(seasonEntry, onProgress) {
    const { league } = seasonEntry;
    const leagueId = league.league_id;
    const isComplete = league.status === "complete";
    // v4: bumped from v3 to add a cache expiry (see MAX_AGE_MS below) —
    // v3 and earlier entries have no fetchedAt field, so they'd fail an
    // age check anyway, but bumping the key makes that explicit rather
    // than relying on a NaN comparison to fail safe.
    const cacheKey = `deep_season_v4_${leagueId}`;
    // "Complete" isn't quite as permanent a guarantee as it sounds —
    // official NFL stat corrections can still land in the days after a
    // season wraps, and this cache previously had NO expiry at all once
    // written, meaning whichever numbers happened to be live the FIRST
    // time a given browser cached a freshly-completed season would stay
    // frozen in that browser forever, even after the archive (or Sleeper
    // itself) later settled on corrected numbers. A day is long enough to
    // avoid re-fetching a genuinely stable season on every repeat visit,
    // short enough that any one browser can't silently disagree with
    // everyone else for more than a day before self-correcting.
    const MAX_AGE_MS = 24 * 60 * 60 * 1000;

    if (isComplete) {
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
        if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) {
          onProgress && onProgress(league.season, "cached");
          return cached.data;
        }
      } catch (err) {
        // corrupt cache entry — fall through and refetch
      }

      // Next, try this site's own static backup of the season (see
      // scripts/backup-sleeper-data.js and data/sleeper-archive/)
      // before ever touching Sleeper's live API. A completed season's
      // data can't change, so a same-origin static file is exactly as
      // correct as a live fetch, but faster (no dozens of sequential
      // Sleeper calls) and keeps working even if Sleeper's API is
      // slow, rate-limited, or briefly unreachable. fetchJsonSafe
      // already handles a missing file (this season hasn't been
      // backed up yet) or any other fetch problem gracefully, falling
      // through to the live fetch below with no special handling
      // needed here.
      const archived = await fetchJsonSafe(`data/sleeper-archive/${league.season}.json`, null);
      if (archived) {
        const scheduleWeeks = archived.weeks || [];
        const weeks = scheduleWeeks.filter(({ matchups }) => matchups.some((m) => (m.points || 0) > 0));
        const result = {
          leagueId,
          season: league.season,
          weeks,
          scheduleWeeks,
          transactions: archived.transactions || [],
          draft: archived.draft || null,
        };
        onProgress && onProgress(league.season, "archived");
        // Deliberately not cached in localStorage — a same-origin
        // static file is already fast to re-fetch, so spending
        // localStorage quota on it has no real benefit, and leaving
        // that quota free matters more for seasons that DO need the
        // live-fetch fallback below.
        return result;
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
        localStorage.setItem(cacheKey, JSON.stringify({ fetchedAt: Date.now(), data: result }));
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
  computeStats(seasonChain, deepSeasons, playerDirectory, injuriesData) {
    const managers = new Map(); // user_id -> career record
    const playerNameOverrides = new Map(); // player_id -> name, filled in from draft metadata
    const headToHead = new Map(); // userId -> Map(opponentUserId -> {wins, losses, ties})
    const headToHeadPlayoffs = new Map(); // same shape, but only weeks >= that season's playoff start
    const pairGameLog = new Map(); // "userIdA|userIdB" (sorted) -> [{season, week, isPlayoff, aUserId, aScore, bUserId, bScore}]
    const pickPPGEntries = []; // {pickNo, position, ppg} across every drafted player, every season — fits the injury-luck expected-PPG baseline

    function pairKey(userIdA, userIdB) {
      return [userIdA, userIdB].sort().join("|");
    }
    function recordPairGame(season, week, isPlayoff, aInfo, aScore, bInfo, bScore) {
      const key = pairKey(aInfo.userId, bInfo.userId);
      if (!pairGameLog.has(key)) pairGameLog.set(key, []);
      pairGameLog.get(key).push({
        season,
        week,
        isPlayoff,
        aUserId: aInfo.userId,
        aTeamName: aInfo.teamName,
        aScore,
        bUserId: bInfo.userId,
        bTeamName: bInfo.teamName,
        bScore,
      });
    }

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
          careerBenchPointsLeft: 0,
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
      mostBenchPointsLeft: null,
      mostConsistentSeason: null,
      leastConsistentSeason: null,
      toughestSchedule: null,
      easiestSchedule: null,
      mostRegularSeasonPoints: null,
      fewestRegularSeasonPoints: null,
    };

    // Every consider() call below also keeps a running top-5 list per
    // category for free — same candidates, same "better" comparator,
    // just kept instead of discarded once they're no longer #1. Powers
    // the Fun Stats & Records page's click-to-expand panels (records.js)
    // without needing a second pass over the data or a second call site
    // next to every existing consider().
    const top5Lists = {};

    function consider(recordKey, candidate, better) {
      const current = records[recordKey];
      if (!current || better(candidate, current)) records[recordKey] = candidate;

      const list = top5Lists[recordKey] || (top5Lists[recordKey] = []);
      list.push(candidate);
      list.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
      if (list.length > 5) list.length = 5;
    }

    const allDraftPickEntries = []; // every draft pick with a valid VBD, across every season — used to fit the league-wide draft grade curve

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
        const weeklyScoresByUser = new Map(); // userId -> [score, score, ...] this season (for consistency)
        const opponentPointsByUser = new Map(); // userId -> { sum, count } of opponents' scores (for strength of schedule)
        const regularSeasonPointsByRoster = new Map(); // rosterId -> { total, players: Map(playerId -> points) }

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

          const isRegularSeasonWeek = playoffStart == null || week < playoffStart;

          // Highest / lowest single-week score, points left on bench, and
          // weekly score accumulation (for the consistency leaderboard).
          matchups.forEach((m) => {
            const info = rosterInfo.get(m.roster_id);
            if (!info) return;

            const pointsMap = m.players_points || {};
            const rosterPlayers = (m.players || [])
              .map((pid) => {
                const p = playerDirectory && playerDirectory[pid];
                return p && p.position ? { playerId: pid, position: p.position, points: pointsMap[pid] || 0 } : null;
              })
              .filter(Boolean);

            // Whoever on this roster scored the most that week (starter or
            // not) — attached to the highest/lowest week-score records so a
            // "record set this season" callout can name a contributing player.
            let weekTopScorer = null;
            (m.starters || []).forEach((pid) => {
              if (!pid || pid === "0") return;
              const pts = pointsMap[pid] || 0;
              if (!weekTopScorer || pts > weekTopScorer.points) weekTopScorer = { playerId: pid, player: playerName(pid), points: pts };
            });

            const entry = { points: m.points || 0, teamName: info.teamName, username: info.username, season, week, topScorer: weekTopScorer };
            consider("highestWeekScore", entry, (a, b) => a.points > b.points);
            consider("lowestWeekScore", entry, (a, b) => a.points < b.points);

            if (rosterPlayers.length) {
              const { total: optimal } = DeepHistory.computeOptimalLineup(league.roster_positions, rosterPlayers);
              const left = Math.max(0, optimal - (m.points || 0));
              consider(
                "mostBenchPointsLeft",
                { left, optimal, actual: m.points || 0, teamName: info.teamName, username: info.username, season, week },
                (a, b) => a.left > b.left
              );
              if (info.userId) getManager(info.userId, info.teamName, info.username).careerBenchPointsLeft += left;
            }

            if (info.userId) {
              if (!weeklyScoresByUser.has(info.userId)) weeklyScoresByUser.set(info.userId, []);
              weeklyScoresByUser.get(info.userId).push(m.points || 0);
            }

            if (isRegularSeasonWeek) {
              if (!regularSeasonPointsByRoster.has(m.roster_id)) regularSeasonPointsByRoster.set(m.roster_id, { total: 0, players: new Map() });
              const rec = regularSeasonPointsByRoster.get(m.roster_id);
              rec.total += m.points || 0;
              (m.starters || []).forEach((pid) => {
                if (!pid || pid === "0") return;
                const pts = pointsMap[pid] || 0;
                rec.players.set(pid, (rec.players.get(pid) || 0) + pts);
              });
            }
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
            const winnerUsername = a.points >= b.points ? aInfo.username : bInfo.username;
            const loserUsername = a.points >= b.points ? bInfo.username : aInfo.username;
            const marginEntry = { margin, winner, loser, winnerUsername, loserUsername, season, week };
            consider("biggestBlowout", marginEntry, (x, y) => x.margin > y.margin);
            consider("closestGame", marginEntry, (x, y) => x.margin < y.margin);

            // Game log, for win/loss streaks, and opponent-points
            // accumulation for the strength-of-schedule leaderboard.
            [
              { info: aInfo, own: a.points || 0, opp: b.points || 0 },
              { info: bInfo, own: b.points || 0, opp: a.points || 0 },
            ].forEach(({ info, own, opp }) => {
              if (!info.userId) return;
              const mgr = getManager(info.userId, info.teamName, info.username);
              const result = own > opp ? "W" : own < opp ? "L" : "T";
              mgr.gameLog.push({ result, season, week });
              if (playoffStart == null || week < playoffStart) {
                if (!opponentPointsByUser.has(info.userId)) opponentPointsByUser.set(info.userId, { sum: 0, count: 0 });
                const sos = opponentPointsByUser.get(info.userId);
                sos.sum += opp;
                sos.count += 1;
              }
            });

            // Head-to-head: each side's record specifically against the other.
            let isPlayoffWeek = false;
            if (aInfo.userId && bInfo.userId && aInfo.userId !== bInfo.userId) {
              const aRec = h2hRecord(aInfo.userId, bInfo.userId);
              const bRec = h2hRecord(bInfo.userId, aInfo.userId);
              isPlayoffWeek = relevantPlayoffPairs.has(`${week}:${Math.min(a.roster_id, b.roster_id)}-${Math.max(a.roster_id, b.roster_id)}`);
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
              recordPairGame(season, week, isPlayoffWeek, aInfo, a.points || 0, bInfo, b.points || 0);
            }
          });
        });

        // ---- Season-level records from data accumulated across the
        //      weeks above: consistency (weekly score std dev) and
        //      strength of schedule (average opponent score faced). ----
        weeklyScoresByUser.forEach((scores, userId) => {
          if (scores.length < 3) return; // too few weeks to be meaningful
          const mgr = managers.get(userId);
          const teamName = mgr ? mgr.teamName : "Unknown";
          const username = mgr ? mgr.username : null;
          const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
          const stdDev = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length);
          const entry = { stdDev, avgScore: mean, teamName, username, season, weeksPlayed: scores.length };
          consider("mostConsistentSeason", entry, (a, b) => a.stdDev < b.stdDev);
          consider("leastConsistentSeason", entry, (a, b) => a.stdDev > b.stdDev);
        });

        opponentPointsByUser.forEach((sos, userId) => {
          if (sos.count < 3) return;
          const mgr = managers.get(userId);
          const teamName = mgr ? mgr.teamName : "Unknown";
          const username = mgr ? mgr.username : null;
          const avgOpponentPF = sos.sum / sos.count;
          const entry = { avgOpponentPF, teamName, username, season, gamesPlayed: sos.count };
          consider("toughestSchedule", entry, (a, b) => a.avgOpponentPF > b.avgOpponentPF);
          consider("easiestSchedule", entry, (a, b) => a.avgOpponentPF < b.avgOpponentPF);
        });

        regularSeasonPointsByRoster.forEach((rec, rosterId) => {
          const info = rosterInfo.get(rosterId);
          if (!info) return;
          let topScorer = null;
          rec.players.forEach((pts, pid) => {
            if (!topScorer || pts > topScorer.points) topScorer = { playerId: pid, player: playerName(pid), points: pts };
          });
          const entry = { total: rec.total, teamName: info.teamName, username: info.username, season, topScorer };
          consider("mostRegularSeasonPoints", entry, (a, b) => a.total > b.total);
          consider("fewestRegularSeasonPoints", entry, (a, b) => a.total < b.total);
        });

        // ---- Collect healthy-week PPG per drafted player. Feeds two
        //      things: the injury-luck expected-PPG baseline (fit in a
        //      second pass once every season's draft data is pooled), and
        //      — reusing the same per-player healthy-week data — a
        //      "prorated" points total used for draft grading below, so an
        //      injury doesn't tank a pick's grade just for the games they
        //      missed. ----
        const injuriesForSeason = DeepHistory.extractInjuriesForSeason(injuriesData, season);
        const healthyPointsByPlayer = new Map(); // playerId -> [points, points, ...] for non-injured weeks only
        deep.weeks.forEach(({ week, matchups }) => {
          if (playoffStart != null && week >= playoffStart) return;
          matchups.forEach((m) => {
            Object.entries(m.players_points || {}).forEach(([pid, pts]) => {
              const injuredThisWeek = injuriesForSeason[pid] && injuriesForSeason[pid][week] != null;
              if (injuredThisWeek) return;
              if (!healthyPointsByPlayer.has(pid)) healthyPointsByPlayer.set(pid, []);
              healthyPointsByPlayer.get(pid).push(pts || 0);
            });
          });
        });
        if (deep.draft && deep.draft.picks) {
          deep.draft.picks.forEach((pick) => {
            if (!pick.player_id) return;
            const p = playerDirectory && playerDirectory[pick.player_id];
            if (!p || !p.position) return;
            const healthyPts = healthyPointsByPlayer.get(pick.player_id);
            if (!healthyPts || !healthyPts.length) return;
            const ppg = healthyPts.reduce((a, b) => a + b, 0) / healthyPts.length;
            pickPPGEntries.push({ pickNo: pick.pick_no, position: p.position, ppg });
          });
        }

        // ---- Draft value (best late-round steal / biggest early-round bust) ----
        if (deep.draft && deep.draft.picks && deep.draft.picks.length) {
          const maxRound = Math.max(...deep.draft.picks.map((p) => p.round || 1));
          const lateThreshold = Math.max(2, Math.ceil(maxRound * 0.6));
          const earlyThreshold = Math.max(1, Math.ceil(maxRound * 0.25));
          const vbdByPlayer = DeepHistory.computeVBD(league.roster_positions, rosters.length, seasonPlayerPoints, playerDirectory);

          deep.draft.picks.forEach((pick) => {
            if (!pick.player_id) return;
            if (pick.metadata && (pick.metadata.first_name || pick.metadata.last_name)) {
              playerNameOverrides.set(
                pick.player_id,
                `${pick.metadata.first_name || ""} ${pick.metadata.last_name || ""}`.trim()
              );
            }
            const pts = seasonPlayerPoints.get(pick.player_id) || 0;
            const vbdEntry = vbdByPlayer.get(pick.player_id);
            const info = rosterInfo.get(pick.roster_id);

            // Grading uses a "prorated" points total — this player's own
            // healthy-week average, projected across the full regular
            // season — rather than their raw total, so missed games from
            // injury don't tank the grade. Same replacement-level baseline
            // as the real VBD, just crediting their actual per-game rate
            // instead of penalizing time they didn't play. Games-played
            // fraction rides along separately so a great rate in a tiny
            // sample still can't claim the top grades (see gradeDraftPick).
            const healthyPts = healthyPointsByPlayer.get(pick.player_id);
            const totalRegularSeasonWeeks = playoffStart != null ? playoffStart - 1 : LAST_FANTASY_WEEK;
            const gamesPlayedFraction = totalRegularSeasonWeeks > 0 ? (healthyPts ? healthyPts.length : 0) / totalRegularSeasonWeeks : 0;
            let gradingVbd = null;
            if (healthyPts && healthyPts.length && vbdEntry) {
              const ppgWhenHealthy = healthyPts.reduce((a, b) => a + b, 0) / healthyPts.length;
              gradingVbd = ppgWhenHealthy * totalRegularSeasonWeeks - vbdEntry.replacementLevel;
            }

            // One shared entry object, reused for bestValuePick/worstValuePick
            // AND the per-manager draftPicks list — a single source of truth,
            // and grade/expectedVbd/z get filled in after the league-wide
            // grading model is fit (once every season has been processed).
            const entry = {
              player: playerName(pick.player_id),
              playerId: pick.player_id,
              round: pick.round,
              pickNo: pick.pick_no,
              pickInRound: pick.pick_no - (pick.round - 1) * rosters.length,
              position: (pick.metadata && pick.metadata.position) || "",
              points: pts,
              vbd: vbdEntry ? vbdEntry.vbd : null,
              gradingVbd,
              gamesPlayedFraction,
              teamName: info ? info.teamName : "Unknown",
              username: info ? info.username : null,
              season,
              grade: null,
              expectedVbd: null,
              z: null,
            };
            // VBD (points above position replacement level) is what actually
            // makes a pick a "steal" or a "bust" — a raw-points comparison
            // always favors QBs, who score more no matter how replaceable
            // they are. Falls back to raw points only if VBD couldn't be
            // established for this player (e.g. they never scored at all).
            if (pick.round >= lateThreshold) {
              consider("bestValuePick", entry, (a, b) => (a.vbd != null && b.vbd != null ? a.vbd > b.vbd : a.points > b.points));
            }
            if (pick.round <= earlyThreshold) {
              consider("worstValuePick", entry, (a, b) => (a.vbd != null && b.vbd != null ? a.vbd < b.vbd : a.points < b.points));
            }

            allDraftPickEntries.push(entry);

            const seasonEntryForRoster = seasonEntryByRosterId.get(pick.roster_id);
            if (seasonEntryForRoster) seasonEntryForRoster.draftPicks.push(entry);

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

    // ---- Draft pick grades: fit the expected-VBD-by-pick-number curve from
    //      every pick in league history, then grade each one by how far its
    //      actual VBD fell from what that pick slot should produce. Mutates
    //      the shared entry objects in place, so this also updates
    //      bestValuePick/worstValuePick and every season's draftPicks list —
    //      they're the same objects, not copies. ----
    const draftGradeModel = DeepHistory.computeDraftGradeModel(allDraftPickEntries);
    allDraftPickEntries.forEach((entry) => {
      const g = DeepHistory.gradeDraftPick(
        entry.gradingVbd != null ? entry.gradingVbd : entry.vbd,
        entry.pickNo,
        draftGradeModel,
        entry.points,
        entry.gamesPlayedFraction,
        entry.position
      );
      if (g) {
        entry.expectedVbd = g.expectedVbd;
        entry.grade = g.grade;
        entry.z = g.z;
      }
    });

    // ---- Injury luck: fit the expected-PPG baseline from every drafted
    //      player's healthy-week production across league history, then
    //      compute each season's injury luck using that model. Needs a
    //      second pass over seasonChain (not just the collected picks)
    //      since computeInjuryLuck needs each season's full weekly data,
    //      not just the pooled PPG samples used to fit the curve. ----
    const expectedPPGModel = DeepHistory.computeExpectedPPGModel(pickPPGEntries);
    const injuriesBySeason = {}; // season -> { playerInjuries, teamInjuryLuck }
    const allTimeTopInjuries = [];
    const allTimeTeamSeasonInjuryLuck = [];
    if (injuriesData) {
      seasonChain.forEach((seasonEntry, idx) => {
        const deep = deepSeasons[idx];
        if (!deep) return;
        const injuriesForSeason = DeepHistory.extractInjuriesForSeason(injuriesData, seasonEntry.league.season);
        const result = DeepHistory.computeInjuryLuck(seasonEntry, deep, playerDirectory, injuriesForSeason, expectedPPGModel);
        injuriesBySeason[seasonEntry.league.season] = result;
        allTimeTopInjuries.push(...result.playerInjuries);
        allTimeTeamSeasonInjuryLuck.push(...result.teamInjuryLuck);
      });
      allTimeTopInjuries.sort((a, b) => b.pointsLost - a.pointsLost);
      allTimeTeamSeasonInjuryLuck.sort((a, b) => b.pointsLost - a.pointsLost);
    }

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

    return {
      managers: managerList,
      records,
      top5Records: top5Lists,
      pairGameLog: Object.fromEntries(pairGameLog),
      draftGradeModel,
      expectedPPGModel,
      injuriesBySeason,
      allTimeTopInjuries,
      allTimeTeamSeasonInjuryLuck,
    };
  },

  /*
    Same idea as computeStats, but scoped to ONE season — this is what
    powers the Season page's charts (weekly scoring trend, team averages,
    scoring by position, that season's extremes and draft standouts).
  */
  computeSeasonSummary(seasonEntry, deep, playerDirectory, draftGradeModel, expectedPPGModel, injuriesForSeason) {
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
    const runnerUpRosterId = SleeperAPI.findRunnerUpRosterId(bracket);
    const thirdPlaceRosterId = SleeperAPI.findThirdPlaceRosterId(bracket);

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
    const opponentPointsByRoster = new Map(); // rosterId -> {sum, count}, regular-season only (strength of schedule)

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
            const entry = { player: playerName(pid), playerId: pid, points: pts || 0, week, season: league.season, teamName: info.teamName };
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
        if (playoffStart == null || week < playoffStart) {
          const soaA = opponentPointsByRoster.get(a.roster_id) || { sum: 0, count: 0 };
          soaA.sum += b.points || 0;
          soaA.count += 1;
          opponentPointsByRoster.set(a.roster_id, soaA);
          const soaB = opponentPointsByRoster.get(b.roster_id) || { sum: 0, count: 0 };
          soaB.sum += a.points || 0;
          soaB.count += 1;
          opponentPointsByRoster.set(b.roster_id, soaB);
        }
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

    standings.forEach((s) => {
      const sos = opponentPointsByRoster.get(s.rosterId);
      s.avgOpponentPF = sos && sos.count ? sos.sum / sos.count : null;
    });

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
      const vbdByPlayer = DeepHistory.computeVBD(league.roster_positions, rosters.length, seasonPlayerPoints, playerDirectory);

      // Same healthy-week collection as computeStats — grading uses each
      // player's own healthy-week rate, prorated to a full season, rather
      // than their raw total, so an injury doesn't tank the grade for
      // games they simply didn't play.
      const healthyPointsByPlayer = new Map();
      if (deep.weeks) {
        deep.weeks.forEach(({ week, matchups }) => {
          if (playoffStart != null && week >= playoffStart) return;
          matchups.forEach((m) => {
            Object.entries(m.players_points || {}).forEach(([pid, pts]) => {
              const injuredThisWeek = injuriesForSeason && injuriesForSeason[pid] && injuriesForSeason[pid][week] != null;
              if (injuredThisWeek) return;
              if (!healthyPointsByPlayer.has(pid)) healthyPointsByPlayer.set(pid, []);
              healthyPointsByPlayer.get(pid).push(pts || 0);
            });
          });
        });
      }
      const totalRegularSeasonWeeks = playoffStart != null ? playoffStart - 1 : LAST_FANTASY_WEEK;

      picks.forEach((p) => {
        if (!p.player_id) return;
        if (p.metadata && (p.metadata.first_name || p.metadata.last_name)) {
          playerNameOverrides.set(p.player_id, `${p.metadata.first_name || ""} ${p.metadata.last_name || ""}`.trim());
        }
        const pts = seasonPlayerPoints.get(p.player_id) || 0;
        const vbdEntry = vbdByPlayer.get(p.player_id);
        const info = rosterInfo.get(p.roster_id);

        const healthyPts = healthyPointsByPlayer.get(p.player_id);
        const gamesPlayedFraction = totalRegularSeasonWeeks > 0 ? (healthyPts ? healthyPts.length : 0) / totalRegularSeasonWeeks : 0;
        let gradingVbd = null;
        if (healthyPts && healthyPts.length && vbdEntry) {
          const ppgWhenHealthy = healthyPts.reduce((a, b) => a + b, 0) / healthyPts.length;
          gradingVbd = ppgWhenHealthy * totalRegularSeasonWeeks - vbdEntry.replacementLevel;
        }

        const pickPosition = playerDirectory && playerDirectory[p.player_id] ? playerDirectory[p.player_id].position : null;
        const grading = DeepHistory.gradeDraftPick(
          gradingVbd != null ? gradingVbd : (vbdEntry ? vbdEntry.vbd : null),
          p.pick_no,
          draftGradeModel,
          pts,
          gamesPlayedFraction,
          pickPosition
        );
        const entry = {
          player: playerName(p.player_id),
          playerId: p.player_id,
          round: p.round,
          pickNo: p.pick_no,
          pickInRound: p.pick_no - (p.round - 1) * rosters.length,
          points: pts,
          vbd: vbdEntry ? vbdEntry.vbd : null,
          season: league.season,
          teamName: info ? info.teamName : "Unknown",
          username: info ? info.username : null,
          grade: grading ? grading.grade : null,
          expectedVbd: grading ? grading.expectedVbd : null,
          z: grading ? grading.z : null,
        };
        if (p.round >= lateThreshold) {
          bestValuePick = pick(bestValuePick, entry, (a, b) => (a.vbd != null && b.vbd != null ? a.vbd > b.vbd : a.points > b.points));
        }
        if (p.round <= earlyThreshold) {
          worstValuePick = pick(worstValuePick, entry, (a, b) => (a.vbd != null && b.vbd != null ? a.vbd < b.vbd : a.points < b.points));
        }
      });
    }

    let pointsLeader = null;
    seasonPlayerPoints.forEach((pts, pid) => {
      pointsLeader = pick(pointsLeader, { player: playerName(pid), playerId: pid, points: pts, season: league.season }, (a, b) => a.points > b.points);
    });

    // ---- Top 5 most expensive FAAB waiver pickups this season (only
    //      meaningful for leagues using FAAB bidding — seasons that used
    //      plain waiver priority instead simply won't have bid amounts) ----
    // First, collect EVERY waiver bid this season (won or lost), grouped
    // by week+player — Sleeper returns failed bids too (status other than
    // "complete"), which is what lets a winning pickup show who else was
    // bidding on the same player that week, and for how much.
    const allWaiverBidsByWeekPlayer = new Map(); // "week|playerId" -> [{rosterId, bid, status}]
    if (deep && deep.transactions) {
      deep.transactions.forEach((tx) => {
        if (!tx || tx.type === "trade") return;
        const bid = tx.settings && tx.settings.waiver_bid;
        if (bid == null) return;
        Object.entries(tx.adds || {}).forEach(([playerId, rid]) => {
          const key = `${tx.leg}|${playerId}`;
          if (!allWaiverBidsByWeekPlayer.has(key)) allWaiverBidsByWeekPlayer.set(key, []);
          allWaiverBidsByWeekPlayer.get(key).push({ rosterId: rid, bid, status: tx.status });
        });
      });
    }

    const faabPickups = [];
    if (deep && deep.transactions) {
      deep.transactions.forEach((tx) => {
        if (!tx || tx.status !== "complete") return;
        const bid = tx.settings && tx.settings.waiver_bid;
        if (!bid) return;
        Object.entries(tx.adds || {}).forEach(([playerId, rid]) => {
          const info = rosterInfo.get(rid);
          const allBids = allWaiverBidsByWeekPlayer.get(`${tx.leg}|${playerId}`) || [];
          const competingBids = allBids
            .filter((b) => b.status !== "complete")
            .map((b) => {
              const bidderInfo = rosterInfo.get(b.rosterId);
              return { teamName: bidderInfo ? bidderInfo.teamName : "Unknown", username: bidderInfo ? bidderInfo.username : null, bid: b.bid };
            })
            .sort((a, b) => b.bid - a.bid);
          faabPickups.push({
            player: playerName(playerId),
            playerId,
            teamName: info ? info.teamName : "Unknown",
            username: info ? info.username : null,
            bid,
            competingBids,
            week: tx.leg,
            season: league.season,
          });
        });
      });
    }
    const top5FaabPickups = [...faabPickups].sort((a, b) => b.bid - a.bid).slice(0, 5);

    // ---- Top 5 best waiver/free-agent pickups by value added for the
    //      rest of the season. Different question from "priciest FAAB
    //      pickup" above — this is about who actually turned out to be
    //      worth adding, cheap or free included. Reuses the same
    //      replacement-level idea as VBD: how many points above a
    //      replacement-level player at that position did this pickup
    //      provide. DEF/K are excluded — not meaningful enough as
    //      pickups to compete for this list.
    //
    //      Counts only weeks the player actually played fully (not
    //      significantly injured), compared against replacement level
    //      for that SAME number of weeks — not the full pickup-to-
    //      end-of-season window. A pickup who got hurt shortly after
    //      being added, then came back and carried a team the rest of
    //      the way, shouldn't have their value dragged down by weeks
    //      they were merely unavailable rather than unproductive. ----
    const totalRegularSeasonWeeksForPickups = playoffStart != null ? playoffStart - 1 : LAST_FANTASY_WEEK;
    const positionValueStats = DeepHistory.computePositionValueStats(league.roster_positions, rosters.length, seasonPlayerPoints, playerDirectory, totalRegularSeasonWeeksForPickups);
    const weeklyPointsByPlayer = new Map(); // playerId -> Map(week -> points), regular season only, every week (unlike the injury-aware healthy-weeks map — this wants realized outcomes, injuries included, so the exclusion below can be scoped precisely to injured weeks)
    const rosterByWeekPlayerForPickups = new Map(); // "week|playerId" -> rosterId, so a pickup's window stops once the manager who made it drops/trades the player away, instead of running to the end of the season regardless
    if (deep && deep.weeks) {
      deep.weeks.forEach(({ week, matchups }) => {
        if (playoffStart != null && week >= playoffStart) return;
        matchups.forEach((m) => {
          Object.entries(m.players_points || {}).forEach(([pid, pts]) => {
            if (!weeklyPointsByPlayer.has(pid)) weeklyPointsByPlayer.set(pid, new Map());
            weeklyPointsByPlayer.get(pid).set(week, pts || 0);
          });
          (m.players || []).forEach((pid) => {
            rosterByWeekPlayerForPickups.set(`${week}|${pid}`, m.roster_id);
          });
        });
      });
    }
    const EXCLUDED_PICKUP_POSITIONS = new Set(["DEF", "K"]);

    const waiverValueAdds = [];
    if (deep && deep.transactions) {
      deep.transactions.forEach((tx) => {
        // Any completed, non-trade transaction that adds a player counts
        // as a "pickup" — not just the two most common type labels
        // ("waiver", "free_agent"). Sleeper also has other transaction
        // types (e.g. a commissioner manually processing a late or
        // disputed claim), and any of those still represents a genuine
        // acquisition; only a trade is a fundamentally different kind of
        // move and is excluded on purpose.
        if (!tx || tx.status !== "complete" || tx.type === "trade") return;
        const pickupWeek = tx.leg;
        if (pickupWeek == null || pickupWeek > totalRegularSeasonWeeksForPickups) return; // no week on the record, or picked up after the regular season ended
        // Whether this was a paid waiver claim is determined by whether a
        // bid amount is actually present, not by the transaction's type
        // label specifically — more robust than assuming only
        // type === "waiver" ever carries one.
        const hasBid = tx.settings && tx.settings.waiver_bid != null;
        const bid = hasBid ? tx.settings.waiver_bid : null;

        Object.entries(tx.adds || {}).forEach(([playerId, rid]) => {
          const p = playerDirectory && playerDirectory[playerId];
          if (!p || !p.position || EXCLUDED_PICKUP_POSITIONS.has(p.position)) return;
          const posStats = positionValueStats[p.position];
          if (!posStats || !(posStats.stdDevPPG > 0)) return; // no meaningful spread to compare against at this position

          const injuredWeeksForPlayer = (injuriesForSeason && injuriesForSeason[playerId]) || {};
          const weekPts = weeklyPointsByPlayer.get(playerId);
          let pointsInActiveWeeks = 0;
          let activeWeeksCount = 0;
          for (let w = pickupWeek; w <= totalRegularSeasonWeeksForPickups; w++) {
            // Stop once this roster no longer has the player — dropped or
            // traded away. Without this, a manager who added a player and
            // dropped them a week later would get credited for everything
            // that player did for the rest of the season on someone else's
            // roster, which is exactly backwards.
            //
            // This check is skipped for the pickup week itself: we already
            // know from the transaction record that this roster added the
            // player that week, and a same-week roster snapshot can lag
            // behind waiver processing depending on when Sleeper generates
            // it — a mismatch there would otherwise break the loop on its
            // very first iteration and silently drop an entirely
            // legitimate, never-dropped pickup from the list. From the
            // following week on, the snapshot has had time to catch up, so
            // it's trustworthy for detecting a genuine later drop.
            if (w > pickupWeek && rosterByWeekPlayerForPickups.get(`${w}|${playerId}`) !== rid) break;
            if (injuredWeeksForPlayer[w] != null) continue; // significantly injured that week — excluded from both sides of the comparison
            activeWeeksCount++;
            pointsInActiveWeeks += weekPts && weekPts.has(w) ? weekPts.get(w) : 0;
          }
          if (activeWeeksCount === 0) return; // never had a healthy, rostered week after pickup

          const pickupPPG = pointsInActiveWeeks / activeWeeksCount;
          // Per-week rate in position-normalized units — mathematically, the
          // sum of each individual week's own z-score against the position
          // average, divided by the number of weeks (a constant baseline
          // subtracted and divided by a constant is linear, so this average
          // is exactly equivalent to averaging the per-week z-scores
          // directly).
          const relativeValuePerWeek = (pickupPPG - posStats.meanPPG) / posStats.stdDevPPG;
          // The actual ranking metric: that same per-week rate, weighted by
          // how many weeks it was sustained for. Un-doing the division by
          // activeWeeksCount above turns the average back into a sum across
          // every counted week — so a great single week (small sample, easy
          // to run hot) can no longer dominate a whole season of solid,
          // sustained production the way a pure rate can. A Week 14 pickup
          // with one big game and a Week 2 pickup who was steadily good all
          // year are no longer compared as if they'd contributed the same
          // amount, even at an identical per-week rate.
          const relativeValue = relativeValuePerWeek * activeWeeksCount;

          const info = rosterInfo.get(rid);
          let competingBids = [];
          if (hasBid) {
            const allBids = allWaiverBidsByWeekPlayer.get(`${pickupWeek}|${playerId}`) || [];
            competingBids = allBids
              .filter((b) => b.status !== "complete")
              .map((b) => {
                const bidderInfo = rosterInfo.get(b.rosterId);
                return { teamName: bidderInfo ? bidderInfo.teamName : "Unknown", username: bidderInfo ? bidderInfo.username : null, bid: b.bid };
              })
              .sort((a, b) => b.bid - a.bid);
          }

          waiverValueAdds.push({
            player: playerName(playerId),
            playerId,
            position: p.position,
            teamName: info ? info.teamName : "Unknown",
            username: info ? info.username : null,
            week: pickupWeek,
            season: league.season,
            bid: hasBid ? bid || 0 : null, // null = free agent, 0 = a $0 winning waiver bid
            competingBids,
            pointsSincePickup: pointsInActiveWeeks,
            activeWeeks: activeWeeksCount,
            pickupPPG,
            positionMeanPPG: posStats.meanPPG,
            relativeValuePerWeek,
            relativeValue,
          });
        });
      });
    }
    const top5WaiverValueAdds = [...waiverValueAdds].sort((a, b) => b.relativeValue - a.relativeValue).slice(0, 5);

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
    const injuryLuck =
      expectedPPGModel && injuriesForSeason
        ? DeepHistory.computeInjuryLuck(seasonEntry, deep, playerDirectory, injuriesForSeason, expectedPPGModel)
        : { playerInjuries: [], teamInjuryLuck: [] };

    return {
      season: league.season,
      status: league.status,
      standings,
      championRosterId,
      runnerUpRosterId,
      thirdPlaceRosterId,
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
      top5WaiverValueAdds,
      standingsHistory: DeepHistory.computeStandingsHistory(seasonEntry, deep),
      playoffTeams: (league.settings && league.settings.playoff_teams) || null,
      championshipRecap: DeepHistory.computeChampionshipRecap(seasonEntry, deep, playerDirectory),
      bracket: bracket_,
      injuryLuck,
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
  /*
    Given a roster's full set of players for one week (with each player's
    native position and points scored that week) and the league's
    roster_positions, finds the highest-scoring LEGAL starting lineup —
    used to compute "points left on bench." Fills the most restrictive
    slots first (single dedicated positions), then FLEX, then
    SUPER_FLEX, taking the highest-scoring not-yet-used eligible player
    each time — the correct greedy strategy for this kind of nested
    slot-eligibility structure (every FLEX-eligible position is also
    SUPER_FLEX-eligible, etc).
  */
  computeOptimalLineup(rosterPositions, players) {
    const ELIGIBILITY = {
      FLEX: ["RB", "WR", "TE"],
      SUPER_FLEX: ["QB", "RB", "WR", "TE"],
      REC_FLEX: ["WR", "TE"],
      WRRB_FLEX: ["WR", "RB"],
      IDP_FLEX: ["DL", "LB", "DB"],
    };
    const slots = (rosterPositions || []).filter((p) => p !== "BN" && p !== "IR" && p !== "TAXI");
    const slotsSorted = [...slots].sort((a, b) => (ELIGIBILITY[a] || [a]).length - (ELIGIBILITY[b] || [b]).length);
    const used = new Set();
    let total = 0;
    const assignments = [];
    slotsSorted.forEach((slotType) => {
      const eligible = ELIGIBILITY[slotType] || [slotType];
      const candidates = players.filter((p) => !used.has(p.playerId) && eligible.includes(p.position));
      candidates.sort((a, b) => b.points - a.points);
      if (candidates.length) {
        const best = candidates[0];
        used.add(best.playerId);
        total += best.points;
        assignments.push({ slot: slotType, ...best });
      }
    });
    return { total, assignments };
  },

  /*
    Value Based Drafting (VBD): a player's fantasy points minus the
    "replacement level" baseline at their position — what a team could get
    for free off the wire instead. This is what actually lets you compare
    a QB's 300 points to a WR's 180 points on a level footing, since raw
    points alone always favor QBs (who score more no matter how replaceable
    they are in a given league).

    Both the roster requirements (how many teams, how many starters at each
    position, whether there's a FLEX or SUPER_FLEX) and the scoring rules
    that produced these points can change every season, so replacement
    level is computed fresh per season from that season's own
    league.roster_positions and roster count — never hardcoded.

    The core idea: simulate who'd actually be a "starter" leaguewide by
    greedily filling every open starting slot (across every team) with the
    best remaining player it can accept, most-restrictive slot types first
    (dedicated position slots before FLEX before SUPER_FLEX) — the same
    approach and the same ELIGIBILITY map as computeOptimalLineup, just
    applied across the whole league's player pool instead of one team's.
    Replacement level at a position = the weakest player who still won a
    starting slot there. Whoever's just outside that cutoff is
    "replacement level" — freely available, in theory.
  */
  // Shared simulation used by both computeReplacementLevels (below) and
  // computePositionValueStats: greedily fills every open starting slot
  // leaguewide with the best remaining eligible player, most-restrictive
  // slot types first, and returns the full list of season points for
  // every player who won a slot, grouped by position — not just the
  // minimum (that's what computeReplacementLevels reduces it to) or the
  // mean/spread (that's computePositionValueStats). Kept as one function
  // so both callers are guaranteed to agree on who counts as a "starter"
  // at each position, rather than risking two slightly different
  // simulations drifting apart over time.
  _computeStarterPointsByPosition(rosterPositions, numTeams, playerPointsMap, playerDirectory) {
    const ELIGIBILITY = {
      FLEX: ["RB", "WR", "TE"],
      SUPER_FLEX: ["QB", "RB", "WR", "TE"],
      REC_FLEX: ["WR", "TE"],
      WRRB_FLEX: ["WR", "RB"],
      IDP_FLEX: ["DL", "LB", "DB"],
    };
    const KNOWN_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
    const EXCLUDE = new Set(["BN", "IR", "TAXI"]);

    const slotTypes = (rosterPositions || []).filter((p) => !EXCLUDE.has(p));
    const countByType = {};
    slotTypes.forEach((t) => {
      if (!KNOWN_POS.has(t) && !ELIGIBILITY[t]) return;
      countByType[t] = (countByType[t] || 0) + 1;
    });

    const slotTypesSorted = Object.keys(countByType).sort(
      (a, b) => (ELIGIBILITY[a] || [a]).length - (ELIGIBILITY[b] || [b]).length
    );

    const allSlots = [];
    slotTypesSorted.forEach((slotType) => {
      const eligible = ELIGIBILITY[slotType] || [slotType];
      for (let i = 0; i < countByType[slotType] * numTeams; i++) {
        allSlots.push({ eligible, filled: false });
      }
    });

    const pool = [];
    playerPointsMap.forEach((points, pid) => {
      const p = playerDirectory && playerDirectory[pid];
      if (!p || !p.position || !(KNOWN_POS.has(p.position) || p.position === "DL" || p.position === "LB" || p.position === "DB")) return;
      if (points <= 0) return;
      pool.push({ position: p.position, points });
    });
    pool.sort((a, b) => b.points - a.points);

    const starterPointsByPosition = {};
    pool.forEach((player) => {
      const slot = allSlots.find((s) => !s.filled && s.eligible.includes(player.position));
      if (!slot) return;
      slot.filled = true;
      if (!starterPointsByPosition[player.position]) starterPointsByPosition[player.position] = [];
      starterPointsByPosition[player.position].push(player.points);
    });
    return starterPointsByPosition;
  },

  computeReplacementLevels(rosterPositions, numTeams, playerPointsMap, playerDirectory) {
    const starterPointsByPosition = DeepHistory._computeStarterPointsByPosition(rosterPositions, numTeams, playerPointsMap, playerDirectory);
    const replacementLevel = {};
    Object.entries(starterPointsByPosition).forEach(([position, pointsList]) => {
      replacementLevel[position] = Math.min(...pointsList);
    });
    return replacementLevel;
  },

  /*
    Position-relative value: unlike replacement level (a floor), this is
    the mean and spread of the whole starter-caliber pool at each
    position, expressed as a per-week rate. Built specifically so a
    pickup's value can be judged by how many standard deviations above
    a typical starter at THEIR OWN position they ran — not by raw
    points, which structurally favors high-scoring positions (a
    SuperFlex league's replacement-level QB still puts up bigger raw
    numbers than an excellent WR, simply because QBs score more per
    game across the board). Dividing by each position's own spread is
    what makes a dominant WR season and a hot streaming-QB week
    comparable on the same scale.
  */
  computePositionValueStats(rosterPositions, numTeams, playerPointsMap, playerDirectory, totalWeeks) {
    const starterPointsByPosition = DeepHistory._computeStarterPointsByPosition(rosterPositions, numTeams, playerPointsMap, playerDirectory);
    const stats = {};
    Object.entries(starterPointsByPosition).forEach(([position, pointsList]) => {
      const rates = pointsList.map((pts) => pts / totalWeeks);
      const n = rates.length;
      const meanPPG = rates.reduce((a, b) => a + b, 0) / n;
      const stdDevPPG = Math.sqrt(rates.reduce((a, b) => a + (b - meanPPG) ** 2, 0) / n);
      stats[position] = { meanPPG, stdDevPPG, n };
    });
    return stats;
  },

  // playerPointsMap: Map(playerId -> total points this season). Returns
  // Map(playerId -> { points, position, vbd, replacementLevel }) for every
  // player a replacement level could be established for.
  computeVBD(rosterPositions, numTeams, playerPointsMap, playerDirectory) {
    const replacementLevel = DeepHistory.computeReplacementLevels(rosterPositions, numTeams, playerPointsMap, playerDirectory);
    const vbdByPlayer = new Map();
    playerPointsMap.forEach((points, pid) => {
      const p = playerDirectory && playerDirectory[pid];
      if (!p || !p.position) return;
      const baseline = replacementLevel[p.position];
      if (baseline == null) return;
      vbdByPlayer.set(pid, { points, position: p.position, vbd: points - baseline, replacementLevel: baseline });
    });
    return vbdByPlayer;
  },

  /*
    Draft pick grades: how good was a pick relative to what a pick at that
    slot should reasonably produce? Two steps:

    1. Fit an "expected VBD by pick number" curve from every pick in the
       league's own draft history (any pick with a valid VBD). Value drops
       off fast in the first round or two and levels out later — the
       standard shape for this is logarithmic decay, so this is a
       log-linear regression: expectedVBD = intercept + slope * ln(pickNo).
       Overall pick number (not round) is used deliberately, so this stays
       meaningful even across seasons where the league size changed.

    2. For each pick, compare its actual VBD to what the curve expected at
       that slot. The gap, measured in standard deviations of the
       historical residuals (a z-score), is what actually determines the
       grade — that's the "bell curve": most picks land close to their
       expected value (B range), with A+/F reserved for picks that beat or
       missed expectations by a lot.

    Needs a reasonable amount of history to be meaningful — returns null
    (no grading) rather than a shaky curve fit from a handful of picks.
  */
  computeDraftGradeModel(picks) {
    const valid = (picks || []).filter((p) => p.vbd != null && p.pickNo != null && p.pickNo > 0);
    if (valid.length < 8) return null;

    const xs = valid.map((p) => Math.log(p.pickNo));
    const ys = valid.map((p) => p.vbd);
    const n = xs.length;
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - xMean) * (ys[i] - yMean);
      den += (xs[i] - xMean) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    const intercept = yMean - slope * xMean;

    const residuals = valid.map((p) => p.vbd - (intercept + slope * Math.log(p.pickNo)));
    const residMean = residuals.reduce((a, b) => a + b, 0) / n; // ~0 by construction of OLS, computed anyway for correctness
    const variance = residuals.reduce((a, b) => a + (b - residMean) ** 2, 0) / Math.max(1, n - 1);
    const stdDev = Math.sqrt(variance);

    return { slope, intercept, stdDev, sampleSize: n };
  },

  predictExpectedVBD(pickNo, model) {
    if (!model || pickNo == null) return null;
    return model.intercept + model.slope * Math.log(Math.max(1, pickNo));
  },

  DRAFT_GRADE_BANDS: [
    { min: 1.5, grade: "S" },
    { min: 0.75, grade: "A" },
    { min: 0, grade: "B" },
    { min: -0.75, grade: "C" },
    { min: -1.5, grade: "D" },
    { min: -Infinity, grade: "F" },
  ],

  // Below this fraction of the regular season actually played healthy, a
  // pick is capped out of the top grades — a great per-game rate in a
  // tiny sample shouldn't outrank someone who was actually available all
  // year. Doesn't touch S alone; being unavailable for half the season
  // caps out at B, however good the rate was in the time they did play.
  GAMES_PLAYED_GRADE_CAP_THRESHOLD: 0.5,
  GAMES_PLAYED_GRADE_CAP: "B",

  // K/DEF get pooled into the same pick-number model as every skill
  // position for simplicity, but their VBD distribution is much
  // narrower and more homogeneous — a modestly-above-expectation
  // kicker or defense can post a residual that reads as S/A-worthy
  // against a model mostly shaped by skill positions, even though the
  // position itself isn't especially differentiated or draft-relevant.
  // Capped the same way an unavailable-most-of-the-season pick is
  // capped, rather than building an entirely separate grading model
  // for two low-investment positions.
  LOW_IMPACT_POSITIONS: new Set(["K", "DEF"]),
  LOW_IMPACT_POSITION_GRADE_CAP: "B",

  gradeDraftPick(vbd, pickNo, model, points, gamesPlayedFraction, position) {
    // A player who scored zero points the whole season is an unambiguous
    // bust, regardless of whether a replacement-level baseline could be
    // established for their position that year — no model or computed
    // VBD needed to know that's an F.
    if (points != null && points <= 0) return { expectedVbd: null, residual: null, z: null, grade: "F" };
    if (!model || vbd == null || pickNo == null || !(model.stdDev > 0)) return null;
    const expectedVbd = DeepHistory.predictExpectedVBD(pickNo, model);
    const residual = vbd - expectedVbd;
    const z = residual / model.stdDev;
    const band = DeepHistory.DRAFT_GRADE_BANDS.find((b) => z >= b.min);
    let grade = band ? band.grade : "F";
    if (
      gamesPlayedFraction != null &&
      gamesPlayedFraction < DeepHistory.GAMES_PLAYED_GRADE_CAP_THRESHOLD &&
      (grade === "S" || grade === "A")
    ) {
      grade = DeepHistory.GAMES_PLAYED_GRADE_CAP;
    }
    if (DeepHistory.LOW_IMPACT_POSITIONS.has(position) && (grade === "S" || grade === "A")) {
      grade = DeepHistory.LOW_IMPACT_POSITION_GRADE_CAP;
    }
    return { expectedVbd, residual, z, grade };
  },

  /*
    Injury luck: how many points did a team lose because a rostered
    player was on the injury report (Out/Doubtful) that week and scored
    below what they'd reasonably be expected to?

    "Reasonably expected" is a shrinkage blend of the player's own
    healthy-week average that season and a baseline — what a player
    drafted at that slot/position typically produces — weighted by how
    many healthy games they'd actually played. A player hurt in Week 1
    has zero healthy games, so their expectation is pure baseline; a
    player hurt in Week 12 after 10 strong healthy games is judged
    almost entirely against their own established level, not a generic
    number. This is the standard fix for the "small sample size" problem
    with an early-season injury.

    The baseline itself reuses the same idea as the draft grade curve
    (expected value decays log-linearly with pick number), but fit
    per-position on raw PPG rather than VBD — a 1st-round RB and a
    1st-round QB have very different expected point totals, even though
    they might have similar draft-relative *value*.
  */
  computeExpectedPPGModel(picksWithPPG) {
    const byPosition = {};
    (picksWithPPG || []).forEach((p) => {
      if (p.pickNo == null || p.ppg == null || !p.position) return;
      if (!byPosition[p.position]) byPosition[p.position] = [];
      byPosition[p.position].push(p);
    });
    const models = {};
    Object.entries(byPosition).forEach(([position, picks]) => {
      if (picks.length < 8) return; // not enough at this position to fit a meaningful curve
      const xs = picks.map((p) => Math.log(p.pickNo));
      const ys = picks.map((p) => p.ppg);
      const n = xs.length;
      const xMean = xs.reduce((a, b) => a + b, 0) / n;
      const yMean = ys.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (xs[i] - xMean) * (ys[i] - yMean);
        den += (xs[i] - xMean) ** 2;
      }
      const slope = den !== 0 ? num / den : 0;
      const intercept = yMean - slope * xMean;
      models[position] = { slope, intercept, sampleSize: n };
    });
    return models;
  },

  predictExpectedPPG(pickNo, position, models) {
    const model = models && models[position];
    if (!model || pickNo == null) return null;
    return Math.max(0, model.intercept + model.slope * Math.log(Math.max(1, pickNo)));
  },

  // k = how many games of "trust the baseline" the shrinkage is worth.
  // Higher k leans more on the baseline for longer; lower k lets a
  // player's own hot/cold start matter sooner.
  computeShrunkExpectedPPG(playerOwnAvg, gamesPlayed, baselinePPG, k) {
    const kappa = k == null ? 4 : k;
    if (baselinePPG == null) return playerOwnAvg != null ? playerOwnAvg : null;
    if (playerOwnAvg == null || !gamesPlayed) return baselinePPG;
    return (gamesPlayed * playerOwnAvg + kappa * baselinePPG) / (gamesPlayed + kappa);
  },

  // injuriesForSeason: { playerId: { week: status } } — already narrowed
  // to one season (see extractInjuriesForSeason). expectedPPGModel: from
  // computeExpectedPPGModel, fit across the league's full draft history.
  computeInjuryLuck(seasonEntry, deep, playerDirectory, injuriesForSeason, expectedPPGModel) {
    const { league, rosters, users } = seasonEntry;
    if (!deep || !deep.weeks || !deep.weeks.length || !injuriesForSeason || !expectedPPGModel) {
      return { playerInjuries: [], teamInjuryLuck: [] };
    }
    const playoffStart = league.settings && league.settings.playoff_week_start;

    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const rosterInfo = new Map();
    rosters.forEach((r) => {
      const user = usersById.get(r.owner_id);
      rosterInfo.set(r.roster_id, {
        teamName: SleeperAPI.teamName(user, r.roster_id),
        username: user ? user.display_name : null,
      });
    });

    // Who rostered which player, each week — full roster, not just
    // starters, since an injured player is typically benched, and the
    // "loss" is about the asset being unavailable, not that week's
    // literal lineup. Regular season only — playoff weeks are excluded
    // entirely here, so both the healthy-week average and the injured-week
    // tally below are automatically regular-season-only too.
    const rosterByWeekPlayer = new Map(); // "week|playerId" -> rosterId
    const pointsByPlayerWeek = new Map(); // playerId -> Map(week -> points)
    deep.weeks.forEach(({ week, matchups }) => {
      if (playoffStart != null && week >= playoffStart) return;
      matchups.forEach((m) => {
        (m.players || []).forEach((pid) => {
          rosterByWeekPlayer.set(`${week}|${pid}`, m.roster_id);
        });
        Object.entries(m.players_points || {}).forEach(([pid, pts]) => {
          if (!pointsByPlayerWeek.has(pid)) pointsByPlayerWeek.set(pid, new Map());
          pointsByPlayerWeek.get(pid).set(week, pts || 0);
        });
      });
    });

    const pickNoByPlayer = new Map();
    let maxPickNo = 0;
    if (deep.draft && deep.draft.picks) {
      deep.draft.picks.forEach((p) => {
        if (p.player_id) pickNoByPlayer.set(p.player_id, p.pick_no);
        if (p.pick_no > maxPickNo) maxPickNo = p.pick_no;
      });
    }
    // Undrafted players (waiver/FA/trade acquisitions never drafted this
    // season) get treated as a very late pick — a low baseline that gets
    // overridden fast by their own real production once they have any.
    const undraftedPickNo = maxPickNo > 0 ? maxPickNo + 20 : 300;

    const playerInjuries = [];
    const teamPointsLost = new Map(); // rosterId -> total

    Object.entries(injuriesForSeason).forEach(([playerId, weeksMap]) => {
      const p = playerDirectory && playerDirectory[playerId];
      if (!p || !p.position) return;
      const weekPts = pointsByPlayerWeek.get(playerId);
      if (!weekPts) return; // never showed up in this league's data at all

      const injuredWeeks = new Set(
        Object.keys(weeksMap)
          .map(Number)
          .filter((week) => playoffStart == null || week < playoffStart)
      );
      const healthyPoints = [];
      weekPts.forEach((pts, week) => {
        if (!injuredWeeks.has(week)) healthyPoints.push(pts);
      });
      const gamesPlayed = healthyPoints.length;
      const playerOwnAvg = gamesPlayed > 0 ? healthyPoints.reduce((a, b) => a + b, 0) / gamesPlayed : null;

      const pickNo = pickNoByPlayer.get(playerId) || undraftedPickNo;
      const baseline = DeepHistory.predictExpectedPPG(pickNo, p.position, expectedPPGModel);
      const expectedPPG = DeepHistory.computeShrunkExpectedPPG(playerOwnAvg, gamesPlayed, baseline, 4);
      if (expectedPPG == null) return;

      // Attribute the whole injury stint to whoever had this player
      // rostered when it began — not a per-week lookup. Managers commonly
      // drop a player once they're hurt; that shouldn't transfer the "bad
      // luck" to whoever (if anyone) picks up the injured player
      // afterward, or erase it if nobody does. The manager who took the
      // injury risk by rostering them is the one who wears the loss.
      //
      // "When it began" prefers the first injured week's roster owner,
      // but falls back to searching backward through prior weeks if
      // nobody had them rostered exactly then — an injury often happens
      // during a game, and a manager dropping the player right away (same
      // week or the week after) shouldn't erase attribution to whoever
      // actually carried the injury risk.
      const sortedInjuredWeeks = [...injuredWeeks].sort((a, b) => a - b);
      const firstInjuredWeek = sortedInjuredWeeks[0];
      let attributionRosterId = null;
      if (firstInjuredWeek != null) {
        for (let w = firstInjuredWeek; w >= 1; w--) {
          const rid = rosterByWeekPlayer.get(`${w}|${playerId}`);
          if (rid != null) {
            attributionRosterId = rid;
            break;
          }
        }
      }

      let totalLost = 0;
      const weeksList = [];
      sortedInjuredWeeks.forEach((week) => {
        const actual = weekPts.has(week) ? weekPts.get(week) : 0;
        const lost = Math.max(0, expectedPPG - actual);
        if (lost <= 0) return;
        totalLost += lost;
        weeksList.push({ week, status: weeksMap[week], actual, expected: expectedPPG, lost });
      });

      if (attributionRosterId != null && totalLost > 0) {
        teamPointsLost.set(attributionRosterId, (teamPointsLost.get(attributionRosterId) || 0) + totalLost);
      }

      if (totalLost > 0) {
        const attrInfo = attributionRosterId != null ? rosterInfo.get(attributionRosterId) : null;
        playerInjuries.push({
          playerId,
          player: SleeperAPI.playerName(playerDirectory, playerId),
          position: p.position,
          season: league.season,
          pointsLost: totalLost,
          weeksInjured: weeksList.length,
          weeks: weeksList,
          rosterId: attributionRosterId,
          teamName: attrInfo ? attrInfo.teamName : null,
          username: attrInfo ? attrInfo.username : null,
        });
      }
    });

    playerInjuries.sort((a, b) => b.pointsLost - a.pointsLost);

    const teamInjuryLuck = rosters
      .map((r) => {
        const info = rosterInfo.get(r.roster_id) || {};
        return {
          rosterId: r.roster_id,
          teamName: info.teamName,
          username: info.username,
          season: league.season,
          pointsLost: teamPointsLost.get(r.roster_id) || 0,
        };
      })
      .sort((a, b) => b.pointsLost - a.pointsLost);

    return { playerInjuries, teamInjuryLuck };
  },

  // data/injuries.json is organized player-first (see the file for why —
  // it's built once from an external pipeline, not per-season). This
  // flips it to season-first: { playerId: { week: status } } for just
  // the one season being viewed.
  extractInjuriesForSeason(injuriesData, season) {
    const result = {};
    if (!injuriesData || !injuriesData.players) return result;
    const seasonKey = String(season);
    Object.entries(injuriesData.players).forEach(([playerId, p]) => {
      const weeks = p.weeks && p.weeks[seasonKey];
      if (weeks && Object.keys(weeks).length) result[playerId] = weeks;
    });
    return result;
  },

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
    Everything needed for the Season Summary recap at the top of a
    completed season's page: the champion's regular-season seed, their
    full round-by-round path through the playoffs (only genuinely
    relevant bracket games — same rule as everywhere else), a cumulative
    "Playoff MVP" (their single highest-scoring starter across the WHOLE
    playoff run, not just one game), and the existing Finals MVP concept
    (best performer in the championship game specifically). Returns null
    for a season that isn't complete yet, or has no bracket.
  */
  computeChampionshipRecap(seasonEntry, deep, playerDirectory) {
    const { league, rosters, users, bracket } = seasonEntry;
    if (league.status !== "complete" || !bracket || !bracket.length || !deep) return null;

    const playoffStart = league.settings && league.settings.playoff_week_start;
    if (playoffStart == null) return null;

    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const rosterInfo = new Map();
    rosters.forEach((r) => {
      const user = usersById.get(r.owner_id);
      rosterInfo.set(r.roster_id, {
        userId: r.owner_id,
        username: user ? user.display_name : null,
      });
    });

    const championRosterId = SleeperAPI.findChampionRosterId(bracket);
    if (championRosterId == null) return null;
    const champInfo = rosterInfo.get(championRosterId);
    if (!champInfo) return null;

    function matchupFor(rosterId, round) {
      if (rosterId == null) return null;
      const week = playoffStart + (round - 1);
      const weekData = deep.weeks.find((w) => w.week === week);
      if (!weekData) return null;
      return weekData.matchups.find((mm) => mm.roster_id === rosterId) || null;
    }

    const relevant = SleeperAPI.relevantBracketGames(bracket);
    const champGames = relevant
      .filter((g) => {
        const t1 = SleeperAPI.resolveBracketTeamId(bracket, g, "t1");
        const t2 = SleeperAPI.resolveBracketTeamId(bracket, g, "t2");
        return t1 === championRosterId || t2 === championRosterId;
      })
      .sort((a, b) => a.r - b.r);

    // Just the round count and who they beat in the championship — no
    // scores or other matchup detail, this is meant to stay high-level.
    const roundsPlayed = champGames.length;
    const champGame = champGames.find((g) => g.p === 1);
    let runnerUpName = null;
    if (champGame) {
      const t1 = SleeperAPI.resolveBracketTeamId(bracket, champGame, "t1");
      const t2 = SleeperAPI.resolveBracketTeamId(bracket, champGame, "t2");
      const oppId = t1 === championRosterId ? t2 : t1;
      const oppInfo = rosterInfo.get(oppId);
      runnerUpName = oppInfo ? oppInfo.username : null;
    }

    // Season MVP: the champion's single highest-scoring starter across the
    // WHOLE season (regular season + playoffs) — "the one player who
    // carried them all year," not just a good playoff run.
    const seasonPointsByPlayer = new Map(); // playerId -> points
    deep.weeks.forEach(({ matchups }) => {
      const m = matchups.find((mm) => mm.roster_id === championRosterId);
      if (!m) return;
      const pointsMap = m.players_points || {};
      (m.starters || []).forEach((pid) => {
        if (!pid || pid === "0") return;
        seasonPointsByPlayer.set(pid, (seasonPointsByPlayer.get(pid) || 0) + (pointsMap[pid] || 0));
      });
    });
    let seasonMVP = null;
    seasonPointsByPlayer.forEach((points, pid) => {
      if (!seasonMVP || points > seasonMVP.points) seasonMVP = { playerId: pid, player: SleeperAPI.playerName(playerDirectory, pid), points };
    });

    // Was the MVP drafted by this same team? A nice "draft to championship"
    // narrative detail when true — omitted otherwise (traded for/waiver add).
    let mvpDraftRound = null;
    if (seasonMVP && deep.draft && deep.draft.picks) {
      const pick = deep.draft.picks.find((p) => p.player_id === seasonMVP.playerId && p.roster_id === championRosterId);
      if (pick) mvpDraftRound = pick.round;
    }

    const standings = SleeperAPI.buildStandings(rosters, users);
    const champStanding = standings.find((s) => s.rosterId === championRosterId);
    const seed = [...standings].sort((a, b) => b.wins - a.wins || b.fpts - a.fpts).findIndex((s) => s.rosterId === championRosterId) + 1;

    return {
      season: league.season,
      champion: {
        rosterId: championRosterId,
        teamName: champInfo.username || "Unknown",
        seed,
        regularSeasonRecord: champStanding ? `${champStanding.wins}-${champStanding.losses}${champStanding.ties ? "-" + champStanding.ties : ""}` : null,
        roundsPlayed,
        runnerUpName,
        seasonMVP,
        mvpDraftRound,
      },
    };
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

    `extraSeasonLuck` is an optional array of already-computed
    {teamName, season, luckPct, wins, losses, ties, overallWins,
    overallLosses, overallTies} entries from OUTSIDE the Sleeper season
    chain — e.g. ESPN-era seasons with a genuine all-play "Overall
    Record" on file (see ManualHistory.computeAllSeasonLuck) — folded
    into the Luckiest/Unluckiest Seasons ranking alongside the Sleeper
    seasons computed below. Deliberately passed in rather than this
    file reaching for MANUAL_HISTORY/ManualHistory itself, matching the
    rest of the codebase's separation: ESPN-era-specific logic stays in
    manual-history.js and the page controllers, not the core Sleeper
    stats engine.
  */
  computeTotalSummary(seasonChain, deepSeasons, playerDirectory, injuriesData, extraSeasonLuck) {
    const perSeason = seasonChain.map((entry, idx) =>
      DeepHistory.computeSeasonSummary(entry, deepSeasons[idx], playerDirectory, null, null, DeepHistory.extractInjuriesForSeason(injuriesData, entry.league.season))
    );
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

    const allWaiverValueAdds = perSeason.flatMap((s) => s.top5WaiverValueAdds || []);
    const top5WaiverValueAdds = [...allWaiverValueAdds].sort((a, b) => b.relativeValue - a.relativeValue).slice(0, 5);

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
    // pulled straight from computeStats' per-manager season records,
    // plus any pre-computed extra (e.g. ESPN-era) entries the caller
    // supplied — see this function's own doc comment.
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
    (extraSeasonLuck || []).forEach((entry) => allSeasonLuck.push(entry));
    const top5Luckiest = [...allSeasonLuck].sort((a, b) => b.luckPct - a.luckPct).slice(0, 10);
    const top5Unluckiest = [...allSeasonLuck].sort((a, b) => a.luckPct - b.luckPct).slice(0, 10);

    return {
      season: "All-Time",
      status: "complete",
      standings,
      championRosterId: null,
      runnerUpRosterId: null,
      thirdPlaceRosterId: null,
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
      top5WaiverValueAdds,
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

  /*
    Week-by-week replay of the standings: for every regular-season week
    (playoffs excluded — once the bracket starts, not everyone is still
    playing a fair round-robin-style schedule, so "climbing the
    standings" stops being a meaningful narrative), returns each team's
    cumulative wins/losses/ties/PF as of that week, sorted the same way
    Sleeper sorts real standings (wins desc, PF as tiebreaker). Used for
    the Standings Over Time replay animation.
  */
  computeStandingsHistory(seasonEntry, deep) {
    const { league, rosters, users } = seasonEntry;
    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const rosterInfo = new Map();
    rosters.forEach((r) => {
      const user = usersById.get(r.owner_id);
      rosterInfo.set(r.roster_id, { teamName: SleeperAPI.teamName(user, r.roster_id), username: user ? user.display_name : null });
    });

    const playoffStart = league.settings && league.settings.playoff_week_start;
    const state = new Map();
    rosters.forEach((r) => state.set(r.roster_id, { wins: 0, losses: 0, ties: 0, pf: 0 }));

    const snapshots = [];
    (deep ? deep.weeks : [])
      .filter((w) => playoffStart == null || w.week < playoffStart)
      .sort((a, b) => a.week - b.week)
      .forEach(({ week, matchups }) => {
        const byMatchupId = new Map();
        matchups.forEach((m) => {
          if (m.matchup_id == null) return;
          if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
          byMatchupId.get(m.matchup_id).push(m);
        });
        byMatchupId.forEach((pair) => {
          if (pair.length < 2) return;
          const [a, b] = pair;
          const sa = state.get(a.roster_id);
          const sb = state.get(b.roster_id);
          if (!sa || !sb) return;
          sa.pf += a.points || 0;
          sb.pf += b.points || 0;
          if ((a.points || 0) > (b.points || 0)) {
            sa.wins += 1;
            sb.losses += 1;
          } else if ((a.points || 0) < (b.points || 0)) {
            sa.losses += 1;
            sb.wins += 1;
          } else {
            sa.ties += 1;
            sb.ties += 1;
          }
        });
        const standings = [...state.entries()]
          .map(([rosterId, s]) => {
            const info = rosterInfo.get(rosterId) || {};
            return { rosterId, teamName: info.teamName || "Unknown", username: info.username, ...s };
          })
          .sort((x, y) => y.wins - x.wins || y.pf - x.pf);
        snapshots.push({ week, standings });
      });

    return snapshots;
  },

  /*
    Builds a chronological trade log across every season. Each entry shows,
    per roster involved, exactly what they gave up and received — players,
    draft picks, and FAAB — straight from Sleeper's trade transaction data.
  */
  buildTradeLog(seasonChain, deepSeasons, playerDirectory) {
    const trades = [];
    seasonChain.forEach((seasonEntry, idx) => {
      const { league, rosters, users } = seasonEntry;
      const deep = deepSeasons[idx];
      if (!deep || !deep.transactions) return;
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

      // Season-long points + VBD, computed once per season and reused for
      // every trade that season. A trade's "value" here is judged in
      // hindsight — how the traded players' whole season actually played
      // out — not a point-in-time snapshot at the moment of the trade.
      const seasonPlayerPoints = new Map();
      (deep.weeks || []).forEach(({ matchups }) => {
        matchups.forEach((m) => {
          Object.entries(m.players_points || {}).forEach(([pid, pts]) => {
            seasonPlayerPoints.set(pid, (seasonPlayerPoints.get(pid) || 0) + (pts || 0));
          });
        });
      });
      const vbdByPlayer = DeepHistory.computeVBD(league.roster_positions, rosters.length, seasonPlayerPoints, playerDirectory);

      deep.transactions
        .filter((tx) => tx && tx.type === "trade" && tx.status === "complete")
        .forEach((tx) => {
          const byRoster = new Map(); // rosterId -> {info, received:{players,picks,faab}, gave:{...}}
          function ensure(rosterId) {
            if (rosterId == null) return null;
            if (!byRoster.has(rosterId)) {
              byRoster.set(rosterId, {
                rosterId,
                info: rosterInfo.get(rosterId),
                received: { players: [], picks: [], faab: 0 },
                gave: { players: [], picks: [], faab: 0 },
              });
            }
            return byRoster.get(rosterId);
          }
          (tx.roster_ids || []).forEach((rid) => ensure(rid));

          Object.entries(tx.adds || {}).forEach(([pid, rid]) => {
            const t = ensure(rid);
            if (t) {
              const p = playerDirectory && playerDirectory[pid];
              const vbdEntry = vbdByPlayer.get(pid);
              t.received.players.push({
                name: SleeperAPI.playerName(playerDirectory, pid),
                playerId: pid,
                position: (p && p.position) || null,
                vbd: vbdEntry ? vbdEntry.vbd : null,
              });
            }
          });
          Object.entries(tx.drops || {}).forEach(([pid, rid]) => {
            const t = ensure(rid);
            if (t) {
              const p = playerDirectory && playerDirectory[pid];
              const vbdEntry = vbdByPlayer.get(pid);
              t.gave.players.push({
                name: SleeperAPI.playerName(playerDirectory, pid),
                playerId: pid,
                position: (p && p.position) || null,
                vbd: vbdEntry ? vbdEntry.vbd : null,
              });
            }
          });
          (tx.draft_picks || []).forEach((pick) => {
            const label = `${pick.season} Round ${pick.round}`;
            const to = ensure(pick.owner_id);
            const from = ensure(pick.previous_owner_id);
            if (to) to.received.picks.push(label);
            if (from) from.gave.picks.push(label);
          });
          (tx.waiver_budget || []).forEach((wb) => {
            const to = ensure(wb.receiver);
            const from = ensure(wb.sender);
            if (to) to.received.faab += wb.amount;
            if (from) from.gave.faab += wb.amount;
          });

          const teams = [...byRoster.values()].filter((t) => t.info);
          if (teams.length < 2) return; // need at least 2 identifiable sides to show anything meaningful

          trades.push({
            season: league.season,
            week: tx.leg,
            transactionId: tx.transaction_id,
            teams,
          });
        });
    });

    trades.sort((a, b) => Number(b.season) - Number(a.season) || b.week - a.week);
    return trades;
  },
};
