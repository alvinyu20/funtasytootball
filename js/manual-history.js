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
    exists for these seasons; luckPct is always null (there's no
    week-by-week data to compute it from), which callers should render
    as "—" rather than passing straight into luckBadge().

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

        entry.seasons.push({
          season: season.year,
          rank: row.standing,
          wins: row.wins,
          losses: row.losses,
          ties: row.ties || 0,
          fpts: row.pointsFor,
          fptsAgainst: row.pointsAgainst,
          overallWins: row.wins + row.playoffWins,
          overallLosses: row.losses + row.playoffLosses,
          overallTies: row.ties || 0,
          isChampion,
          isRunnerUp,
          isThirdPlace,
          luckPct: null,
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
