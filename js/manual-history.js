/*
  ============================================================
  MANUAL HISTORY ENGINE
  ============================================================
  Turns data/manual-history.json (pre-Sleeper season standings and
  playoff results, entered by hand) into the same shapes the rest of
  the site already knows how to render — so history.js, teams.js, and
  season.js can reuse existing rendering code (renderBracket, the
  season-card layout, the career-records table) almost as-is, rather
  than building a second, parallel set of UI for "the old years."

  Deliberately NOT filtered to "Sleeper-era" managers here — every name
  that appears in a manual season's standings is included. Filtering
  to "only show this on pages for managers who also played in the
  Sleeper era" happens naturally at each call site instead, simply by
  looking a Sleeper manager's own username up in what this file
  returns: a manager who never continued into the Sleeper era has no
  Sleeper-side profile to attach anything to in the first place, so
  nothing further is needed to exclude them.
*/

const ManualHistory = {
  /*
    Returns a Map<team name, { seasons: [...], totals: {...} }> covering
    every name that appears anywhere in manual-history's standings.

    Each `seasons` entry matches the shape teams.js's existing
    season-card renderer already expects (season, rank, wins/losses/ties,
    fpts/fptsAgainst, overallWins/Losses/Ties, isChampion/isRunnerUp/
    isThirdPlace, luckPct, draftPicks, startingLineup) — draftPicks is
    always [] and startingLineup always null, since no per-player data
    exists for these seasons.

    `overallWins`/`overallLosses`/`overallTies` and `luckPct` use a
    genuine all-play "Overall Record" (see a standings row's
    `overallRecord` field in data/manual-history.json) for any season
    that has one on file — the same all-play concept, and the same
    Luck formula (DeepHistory.luckPercent), that Sleeper-era seasons
    already use. For a season without that data, `overallWins`/
    `overallLosses`/`overallTies` fall back to a regular+playoff
    combined record instead (a DIFFERENT, looser number — NOT all-play)
    just so the "Overall" column always has something to show, and
    `luckPct` stays null, which callers should render as "—" rather
    than passing straight into luckBadge().

    `totals` matches the career-total field names deep-history.js's own
    computeStats() already uses on a Sleeper manager object, so merging
    is a simple matter of adding same-named fields together.
  */
  computeManagerStats(manualData) {
    const byTeam = new Map();
    const seasons = (manualData && manualData.seasons) || [];

    function getEntry(team) {
      if (!byTeam.has(team)) {
        byTeam.set(team, {
          seasons: [],
          totals: {
            careerRegularSeasonWins: 0,
            careerRegularSeasonLosses: 0,
            careerRegularSeasonTies: 0,
            careerPlayoffWins: 0,
            careerPlayoffLosses: 0,
            careerPlayoffTies: 0,
            careerPF: 0,
            championships: 0,
            runnerUps: 0,
            thirdPlaceFinishes: 0,
            winningSeasons: 0,
            losingSeasons: 0,
            playoffAppearances: 0,
            byes: 0,
            firstPicks: 0,
          },
        });
      }
      return byTeam.get(team);
    }

    for (const season of seasons) {
      for (const row of season.standings || []) {
        const entry = getEntry(row.team);
        const isChampion = row.medal === "gold";
        const isRunnerUp = row.medal === "silver";
        const isThirdPlace = row.medal === "bronze";

        const hasAllPlayRecord = !!row.overallRecord;
        const overallWins = hasAllPlayRecord ? row.overallRecord.wins : row.wins + row.playoffWins;
        const overallLosses = hasAllPlayRecord ? row.overallRecord.losses : row.losses + row.playoffLosses;
        const overallTies = hasAllPlayRecord ? row.overallRecord.ties || 0 : row.ties || 0;
        const luckPct = hasAllPlayRecord ? DeepHistory.luckPercent(row.wins, row.losses, row.ties || 0, overallWins, overallLosses, overallTies) : null;

        entry.seasons.push({
          season: season.year,
          rank: row.standing,
          wins: row.wins,
          losses: row.losses,
          ties: row.ties || 0,
          fpts: row.pointsFor,
          fptsAgainst: row.pointsAgainst,
          overallWins,
          overallLosses,
          overallTies,
          isChampion,
          isRunnerUp,
          isThirdPlace,
          luckPct,
          draftPicks: [],
          startingLineup: null,
        });

        const t = entry.totals;
        t.careerRegularSeasonWins += row.wins;
        t.careerRegularSeasonLosses += row.losses;
        t.careerRegularSeasonTies += row.ties || 0;
        t.careerPlayoffWins += row.playoffWins;
        t.careerPlayoffLosses += row.playoffLosses;
        t.careerPF += row.pointsFor;
        if (isChampion) t.championships++;
        if (isRunnerUp) t.runnerUps++;
        if (isThirdPlace) t.thirdPlaceFinishes++;
        if (row.wins > row.losses) t.winningSeasons++;
        else if (row.losses > row.wins) t.losingSeasons++;
        if (row.playoffAppearance) t.playoffAppearances++;
        if (row.playoffBye) t.byes++;
        if (row.draftPick === 1) t.firstPicks++;
      }
    }

    return byTeam;
  },

  /*
    Flat list of every (team, season) that has a genuine all-play
    "Overall Record" on file — i.e. every season/team pair Luck can
    actually be computed for — in the exact shape season.js's Total
    page already uses for its Luckiest/Unluckiest Seasons lists (see
    deep-history.js's computeTotalSummary), so the two lists can be
    concatenated and re-ranked together directly. A season without
    all-play data (luckPct null) is naturally excluded, the same way
    it's excluded from the per-season Luck display elsewhere.
  */
  computeAllSeasonLuck(manualData) {
    const byTeam = ManualHistory.computeManagerStats(manualData);
    const out = [];
    byTeam.forEach((entry, teamName) => {
      entry.seasons.forEach((s) => {
        if (s.luckPct == null) return;
        out.push({
          teamName,
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
    return out;
  },

  /*
    Merges one manual-history totals object (from computeManagerStats)
    into a Sleeper-computed manager object IN PLACE, adding onto the
    same career-total fields computeStats() already populates. Used
    identically by history.js (career records) and teams.js (team
    profile ticker) so the two pages can never quietly disagree with
    each other about someone's all-time numbers.
  */
  mergeIntoManager(manager, manualTotals) {
    if (!manualTotals) return;
    const t = manualTotals;
    manager.careerRegularSeasonWins += t.careerRegularSeasonWins;
    manager.careerRegularSeasonLosses += t.careerRegularSeasonLosses;
    manager.careerRegularSeasonTies += t.careerRegularSeasonTies;
    manager.careerPlayoffWins += t.careerPlayoffWins;
    manager.careerPlayoffLosses += t.careerPlayoffLosses;
    manager.careerPlayoffTies += t.careerPlayoffTies;
    manager.careerPF += t.careerPF;
    manager.championships += t.championships;
    manager.runnerUps += t.runnerUps;
    manager.thirdPlaceFinishes += t.thirdPlaceFinishes;
    manager.winningSeasons += t.winningSeasons;
    manager.losingSeasons += t.losingSeasons;
    manager.playoffAppearances += t.playoffAppearances;
    manager.byes += t.byes;
    manager.firstPicks += t.firstPicks;
  },

  // True if `year` (number or numeric string) matches a season present
  // in manual-history.json — the check season.js uses to decide whether
  // a hash like "#2016" should render the lighter-weight manual-season
  // view instead of looking for it in the live Sleeper season chain.
  findSeason(manualData, year) {
    const seasons = (manualData && manualData.seasons) || [];
    return seasons.find((s) => String(s.year) === String(year)) || null;
  },

  /*
    Returns a Map<team name, Map<opponent name, {wins, losses, ties}>>
    built from every playoff game (quarterfinals, semifinals, 3rd-place,
    and finals) across every manual season — the ESPN-era equivalent of
    deep-history.js's headToHeadPlayoffs computation.

    Keyed by team NAME rather than a Sleeper user_id, since these games
    predate Sleeper and several participants (e.g. someone who never
    continued into the Sleeper era) have no user_id to key by in the
    first place. teams.js merges this in by matching a Sleeper manager's
    own username against these names directly.

    Manual brackets never record ties (there's no data for that), so
    `ties` is always 0 here — included only so the merged shape matches
    what deep-history.js already produces.
  */
  computeHeadToHeadPlayoffs(manualData) {
    const byTeam = new Map();
    const seasons = (manualData && manualData.seasons) || [];

    function record(winner, loser) {
      if (!winner || !loser) return;
      if (!byTeam.has(winner)) byTeam.set(winner, new Map());
      if (!byTeam.has(loser)) byTeam.set(loser, new Map());
      const winnerRow = byTeam.get(winner);
      const loserRow = byTeam.get(loser);
      if (!winnerRow.has(loser)) winnerRow.set(loser, { wins: 0, losses: 0, ties: 0 });
      if (!loserRow.has(winner)) loserRow.set(winner, { wins: 0, losses: 0, ties: 0 });
      winnerRow.get(loser).wins += 1;
      loserRow.get(winner).losses += 1;
    }

    seasons.forEach((season) => {
      const b = season.bracket;
      if (!b) return;
      (b.quarterfinals || []).forEach((g) => record(g.winner, g.loser));
      (b.semifinals || []).forEach((g) => record(g.winner, g.loser));
      if (b.thirdPlace) record(b.thirdPlace.winner, b.thirdPlace.loser);
      if (b.finals) record(b.finals.winner, b.finals.loser);
    });

    return byTeam;
  },

  /*
    Merges one manager's manual-era playoff opponents (a Map<opponent
    name, {wins, losses, ties}> — one row of computeHeadToHeadPlayoffs'
    return value) into a Sleeper-computed manager object's existing
    `headToHeadPlayoffs` array IN PLACE, the same "merge onto what
    computeStats already built" pattern mergeIntoManager uses above.

    Matched by opponent NAME rather than user_id (manual opponents have
    none), which also naturally combines the two eras' records for any
    opponent who played in both — e.g. two Sleeper-era playoff meetings
    plus one ESPN-era meeting becomes a single 3-game row, not two rows
    that quietly disagree with each other. Re-sorts afterward so the
    merged-in opponents take their correct place by total games played,
    matching computeStats' own ordering.
  */
  mergeHeadToHeadPlayoffs(manager, manualOpponents) {
    if (!manualOpponents) return;
    manualOpponents.forEach((rec, opponentName) => {
      const existing = manager.headToHeadPlayoffs.find((h) => h.opponentName === opponentName);
      if (existing) {
        existing.wins += rec.wins;
        existing.losses += rec.losses;
        existing.ties += rec.ties;
      } else {
        manager.headToHeadPlayoffs.push({ opponentUserId: null, opponentName, wins: rec.wins, losses: rec.losses, ties: rec.ties });
      }
    });
    manager.headToHeadPlayoffs.sort((a, b) => b.wins + b.losses + b.ties - (a.wins + a.losses + a.ties));
  },

  /*
    Transforms one manual season's `bracket` field into the exact shape
    season.js's existing renderBracket() already expects — reusing that
    function completely rather than building a second bracket renderer.
    Scores are only known for the finals here (the source data simply
    doesn't have them for earlier rounds), which renderBracket already
    handles gracefully: a null score just renders as a team name with
    no points next to it.
  */
  buildBracketData(season) {
    const b = season.bracket;
    if (!b) return { rounds: [], champion: null };

    function team(name, isWinner, score) {
      return { name, isWinner, score: score != null ? score : null, lineup: [] };
    }
    function game(matchup, isChampionship, specialLabel) {
      return {
        isChampionship: !!isChampionship,
        specialLabel: specialLabel || null,
        team1: team(matchup.winner, true, matchup.winnerScore),
        team2: team(matchup.loser, false, matchup.loserScore),
      };
    }

    const rounds = [];
    if (b.quarterfinals && b.quarterfinals.length) {
      rounds.push({ label: "Quarterfinals", games: b.quarterfinals.map((m) => game(m)) });
    }
    if (b.semifinals && b.semifinals.length) {
      rounds.push({ label: "Semifinals", games: b.semifinals.map((m) => game(m)) });
    }
    const finalsRoundGames = [];
    if (b.thirdPlace) finalsRoundGames.push(game(b.thirdPlace, false, "3rd Place"));
    if (b.finals) finalsRoundGames.push(game(b.finals, true));
    if (finalsRoundGames.length) rounds.push({ label: "Finals", games: finalsRoundGames });

    const champion = b.finals
      ? {
          name: b.finals.winner,
          mvp: b.finalsMvp ? { playerId: null, player: b.finalsMvp.player, points: b.finalsMvp.points, position: b.finalsMvp.position } : null,
        }
      : null;

    return { rounds, champion };
  },
};
