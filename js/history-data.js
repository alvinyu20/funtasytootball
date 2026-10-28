/*
  History page numbers, kept apart from the page code so they can be tested
  on their own. Nothing here touches the page.

  Everything starts from one list, the ledger: one entry per season, oldest to
  newest, built the same way for the Sleeper years (from the season chain) and
  the ESPN years (from data/manual-history.json). Each entry knows its standings
  in seed order, so a champion's seed is simply where their row sits, and who
  they beat in the final is the runner-up.

    ledger season = {
      year, source: "sleeper" | "manual", complete, teamCount, playoffTeams,
      rows: [{ key, name, userId, teamName, seed, wins, losses, ties }],  // seed order
      champion, runnerUp, third,                                          // a row, or null
    }

  An owner is a person, matched across the two eras by username (case does not
  matter). Their cells are one per season they played; the Career Records table,
  the season strip and the Every Season grid all read the same cells, so the
  three can never disagree.
*/
const HistoryData = (function () {
  const DEFAULT_PLAYOFF_TEAMS = 6;
  const MIN_SEED_ROWS = 6;

  function keyOf(name) {
    return String(name == null ? "" : name).trim().toLowerCase();
  }

  function ord(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function recordOf(w, l, t) {
    return `${w || 0}-${l || 0}${t ? "-" + t : ""}`;
  }

  // ---- the ledger --------------------------------------------------------

  function sleeperSeason(entry) {
    const { league, rosters, users, bracket } = entry;
    const standings = SleeperAPI.buildStandings(rosters || [], users || []);
    const rows = standings.map((s, i) => ({
      key: s.userId ? keyOf(s.username || s.teamName) : `roster:${s.rosterId}`,
      name: s.username || s.teamName,
      userId: s.userId || null,
      teamName: s.teamName,
      rosterId: s.rosterId,
      seed: i + 1,
      wins: s.wins,
      losses: s.losses,
      ties: s.ties,
    }));
    const byRoster = new Map(rows.map((r) => [r.rosterId, r]));
    const find = (id) => (id == null ? null : byRoster.get(id) || null);
    const settings = (league && league.settings) || {};
    return {
      year: Number(league.season),
      source: "sleeper",
      complete: league.status === "complete",
      teamCount: rows.length,
      playoffTeams: Number(settings.playoff_teams) || DEFAULT_PLAYOFF_TEAMS,
      rows,
      champion: find(SleeperAPI.findChampionRosterId(bracket)),
      runnerUp: find(SleeperAPI.findRunnerUpRosterId(bracket)),
      third: find(SleeperAPI.findThirdPlaceRosterId(bracket)),
    };
  }

  function manualSeason(season) {
    const rows = (season.standings || [])
      .map((r) => ({
        key: keyOf(r.team),
        name: r.team,
        userId: null,
        teamName: null,
        seed: r.standing,
        wins: r.wins || 0,
        losses: r.losses || 0,
        ties: r.ties || 0,
        medal: r.medal || null,
      }))
      .sort((a, b) => a.seed - b.seed);
    const byName = new Map(rows.map((r) => [keyOf(r.name), r]));
    const byMedal = (m) => rows.find((r) => r.medal === m) || null;
    const finals = (season.bracket && season.bracket.finals) || null;
    const thirdGame = (season.bracket && season.bracket.thirdPlace) || null;
    const pick = (medal, name) => byMedal(medal) || (name ? byName.get(keyOf(name)) || null : null);
    const playoffTeams = (season.standings || []).filter((r) => r.playoffAppearance).length;
    return {
      year: Number(season.year),
      source: "manual",
      complete: true,
      teamCount: rows.length,
      playoffTeams: playoffTeams || DEFAULT_PLAYOFF_TEAMS,
      rows,
      champion: pick("gold", season.champion || (finals && finals.winner)),
      runnerUp: pick("silver", finals && finals.loser),
      third: pick("bronze", thirdGame && thirdGame.winner),
    };
  }

  // Every season on record, oldest to newest. A year that somehow appears in
  // both sources keeps the Sleeper one.
  function buildLedger(chain, manual) {
    const sleeper = (chain || []).map(sleeperSeason);
    const have = new Set(sleeper.map((s) => s.year));
    const espn = ((manual && manual.seasons) || []).map(manualSeason).filter((s) => !have.has(s.year));
    return [...espn, ...sleeper].sort((a, b) => a.year - b.year);
  }

  // ---- Trophy Room -------------------------------------------------------

  // A card per season, newest first: the champion with how they won it, or a
  // placeholder for the season still being played. A season that finished
  // without a champion on record has no card.
  function trophyCards(ledger) {
    const titles = new Map();
    let previous = null; // the last season's champion: { year, key }
    const cards = [];
    (ledger || []).forEach((season) => {
      const c = season.champion;
      if (c) {
        const n = (titles.get(c.key) || 0) + 1;
        titles.set(c.key, n);
        const teamName = c.teamName && keyOf(c.teamName) !== c.key ? c.teamName : null;
        cards.push({
          kind: "champion",
          year: season.year,
          key: c.key,
          name: c.name,
          userId: c.userId,
          teamName,
          titleNumber: n,
          repeat: !!previous && previous.year === season.year - 1 && previous.key === c.key,
          record: recordOf(c.wins, c.losses, c.ties),
          seed: c.seed,
          beat: season.runnerUp ? season.runnerUp.name : null,
        });
        previous = { year: season.year, key: c.key };
      } else if (!season.complete) {
        cards.push({ kind: "live", year: season.year });
        previous = null;
      } else {
        previous = null;
      }
    });
    return cards.reverse();
  }

  // What the season-in-progress card says: the week, and who leads.
  function liveSummary(ledger, nflState) {
    const live = [...(ledger || [])].reverse().find((s) => !s.complete && !s.champion);
    if (!live) return null;
    const leader = live.rows[0] || null;
    const games = leader ? leader.wins + leader.losses + leader.ties : 0;
    const week = nflState && String(nflState.season) === String(live.year) && Number(nflState.week) > 0 ? Number(nflState.week) : null;
    return {
      year: live.year,
      week,
      leader: leader && games > 0 ? { name: leader.name, record: recordOf(leader.wins, leader.losses, leader.ties), games } : null,
    };
  }

  // Titles by owner, most first; ties go to whoever won theirs first.
  function titlesByOwner(ledger) {
    const byKey = new Map();
    (ledger || []).forEach((season) => {
      const c = season.champion;
      if (!c) return;
      if (!byKey.has(c.key)) byKey.set(c.key, { key: c.key, name: c.name, titles: 0, firstYear: season.year, years: [] });
      const entry = byKey.get(c.key);
      entry.titles += 1;
      entry.name = c.name;
      entry.years.push(season.year);
    });
    const owners = [...byKey.values()].sort((a, b) => b.titles - a.titles || a.firstYear - b.firstYear);
    return {
      owners,
      seasonsComplete: (ledger || []).filter((s) => s.complete || s.champion).length,
      champions: owners.length,
    };
  }

  // The header tiles: seasons played, different champions, most titles.
  function heroStats(ledger) {
    const t = titlesByOwner(ledger);
    const live = (ledger || []).filter((s) => !s.complete && !s.champion);
    const top = t.owners.length ? t.owners[0].titles : 0;
    const leaders = t.owners.filter((o) => o.titles === top).map((o) => o.name);
    return {
      seasonsComplete: t.seasonsComplete,
      liveYear: live.length ? live[live.length - 1].year : null,
      champions: t.champions,
      mostTitles: top,
      mostTitlesNames: leaders,
      seasonsOnRecord: (ledger || []).length,
    };
  }

  // ---- Where Podiums Come From -------------------------------------------

  // For each regular-season seed, how many titles, runner-up finishes and
  // thirds it produced. Seasons with no champion on record are left out.
  function podiumsBySeed(ledger) {
    const seasons = (ledger || []).filter((s) => s.champion);
    let maxSeed = MIN_SEED_ROWS;
    seasons.forEach((s) => {
      maxSeed = Math.max(maxSeed, s.playoffTeams || 0);
      [s.champion, s.runnerUp, s.third].forEach((r) => {
        if (r) maxSeed = Math.max(maxSeed, r.seed);
      });
    });
    const rows = [];
    for (let seed = 1; seed <= maxSeed; seed++) rows.push({ seed, title: 0, second: 0, third: 0, total: 0 });
    seasons.forEach((s) => {
      const add = (row, field) => {
        if (!row || !rows[row.seed - 1]) return;
        rows[row.seed - 1][field] += 1;
        rows[row.seed - 1].total += 1;
      };
      add(s.champion, "title");
      add(s.runnerUp, "second");
      add(s.third, "third");
    });
    return { rows, seasons: seasons.length };
  }

  // ---- owners ------------------------------------------------------------

  function sleeperCell(s) {
    const medal = !!(s.isChampion || s.isRunnerUp || s.isThirdPlace);
    return {
      year: Number(s.season),
      source: "sleeper",
      finish: s.rank,
      complete: !!s.isSeasonComplete,
      wins: s.wins || 0,
      losses: s.losses || 0,
      ties: s.ties || 0,
      regW: s.regularSeasonWins || 0,
      regL: s.regularSeasonLosses || 0,
      regT: s.regularSeasonTies || 0,
      poW: s.playoffWins || 0,
      poL: s.playoffLosses || 0,
      poT: s.playoffTies || 0,
      isChampion: !!s.isChampion,
      isRunnerUp: !!s.isRunnerUp,
      isThirdPlace: !!s.isThirdPlace,
      appeared: !!s.isPlayoffAppearance || medal,
    };
  }

  function manualCell(season, row) {
    return {
      year: Number(season.year),
      source: "manual",
      finish: row.standing,
      complete: true,
      wins: row.wins || 0,
      losses: row.losses || 0,
      ties: row.ties || 0,
      regW: row.wins || 0,
      regL: row.losses || 0,
      regT: row.ties || 0,
      poW: row.playoffWins || 0,
      poL: row.playoffLosses || 0,
      poT: 0,
      isChampion: row.medal === "gold",
      isRunnerUp: row.medal === "silver",
      isThirdPlace: row.medal === "bronze",
      appeared: !!row.playoffAppearance || !!row.medal,
    };
  }

  // How a season looked for one owner. A finished season is a medal, a playoff
  // trip or a miss; one still being played is in or out of the top playoffTeams.
  function cellStatus(cell, playoffTeams) {
    if (!cell.complete) {
      if (cell.wins + cell.losses + cell.ties === 0) return "live";
      return cell.finish <= (playoffTeams || DEFAULT_PLAYOFF_TEAMS) ? "live-in" : "live-out";
    }
    if (cell.isChampion) return "champion";
    if (cell.isRunnerUp) return "runnerUp";
    if (cell.isThirdPlace) return "third";
    return cell.appeared ? "playoffs" : "missed";
  }

  function pct(num, den) {
    return den > 0 ? (num / den) * 100 : 0;
  }

  /*
    Every owner who played in the Sleeper era, with their ESPN-era seasons
    folded in by username (someone who only ever played ESPN is not listed,
    the same as before). `managers` is DeepHistory.computeStats().managers.
  */
  function buildOwners(managers, manual, ledger) {
    const seasonByYear = new Map((ledger || []).map((s) => [s.year, s]));
    const years = (ledger || []).map((s) => s.year);
    const firstYear = years.length ? Math.min(...years) : null;
    const latestYear = years.length ? Math.max(...years) : null;
    const maxTeams = Math.max(0, ...(ledger || []).map((s) => s.teamCount));

    const espnRows = new Map(); // key -> [{ season, row }]
    ((manual && manual.seasons) || []).forEach((season) => {
      (season.standings || []).forEach((row) => {
        const k = keyOf(row.team);
        if (!espnRows.has(k)) espnRows.set(k, []);
        espnRows.get(k).push({ season, row });
      });
    });

    const byKey = new Map();
    (managers || []).forEach((m) => {
      const name = m.username || m.teamName;
      if (!name) return;
      const k = keyOf(name);
      if (!byKey.has(k)) byKey.set(k, { key: k, name, userId: m.userId || null, cells: [] });
      const owner = byKey.get(k);
      owner.name = name;
      owner.userId = owner.userId || m.userId || null;
      (m.seasons || []).forEach((s) => {
        if (s.season == null) return;
        if (!owner.cells.some((c) => c.year === Number(s.season))) owner.cells.push(sleeperCell(s));
      });
    });
    byKey.forEach((owner, k) => {
      (espnRows.get(k) || []).forEach(({ season, row }) => {
        if (!owner.cells.some((c) => c.year === Number(season.year))) owner.cells.push(manualCell(season, row));
      });
    });

    const owners = [...byKey.values()].map((o) => {
      const cells = o.cells.sort((a, b) => a.year - b.year);
      cells.forEach((c) => {
        const season = seasonByYear.get(c.year);
        c.status = cellStatus(c, season && season.playoffTeams);
      });
      const done = cells.filter((c) => c.complete);
      const sum = (field) => cells.reduce((t, c) => t + c[field], 0);
      const titles = cells.filter((c) => c.isChampion).length;
      const seconds = cells.filter((c) => c.isRunnerUp).length;
      const thirds = cells.filter((c) => c.isThirdPlace).length;
      const trips = done.filter((c) => c.appeared).length;
      const poW = sum("poW");
      const poL = sum("poL");
      const poT = sum("poT");
      const regW = sum("regW");
      const regL = sum("regL");
      const regT = sum("regT");
      const first = cells.length ? cells[0].year : null;
      const active = latestYear != null && cells.some((c) => c.year === latestYear);
      return {
        key: o.key,
        name: o.name,
        userId: o.userId,
        cells,
        titles,
        seconds,
        thirds,
        podiums: titles + seconds + thirds,
        titleYears: cells.filter((c) => c.isChampion).map((c) => c.year),
        completedYears: done.length,
        trips,
        tripPct: pct(trips, done.length),
        poW,
        poL,
        poT,
        poGames: poW + poL + poT,
        poPct: pct(poW, poW + poL + poT),
        regW,
        regL,
        regT,
        regGames: regW + regL + regT,
        regPct: pct(regW, regW + regL + regT),
        avgFinish: done.length ? done.reduce((t, c) => t + c.finish, 0) / done.length : null,
        firstYear: first,
        active,
        former: !active,
        isNew: active && first === latestYear && firstYear != null && latestYear > firstYear,
      };
    });

    return { owners: sortOwners(owners, "titles"), firstYear, latestYear, maxTeams };
  }

  const SORTS = {
    titles: (a, b) => b.titles - a.titles || b.tripPct - a.tripPct || b.trips - a.trips || b.poW - a.poW || b.completedYears - a.completedYears || b.regPct - a.regPct,
    podiums: (a, b) => b.podiums - a.podiums || b.titles - a.titles || b.seconds - a.seconds || b.tripPct - a.tripPct,
    playoff: (a, b) => b.tripPct - a.tripPct || b.trips - a.trips || b.titles - a.titles,
    winpct: (a, b) => b.regPct - a.regPct || b.regGames - a.regGames,
  };

  function sortOwners(owners, how) {
    const cmp = SORTS[how] || SORTS.titles;
    return [...owners].sort((a, b) => cmp(a, b) || a.name.localeCompare(b.name));
  }

  function filterOwners(owners, show) {
    return show === "active" ? owners.filter((o) => o.active) : owners;
  }

  // ---- Your History ------------------------------------------------------

  function standingAmong(owners, mine, field, higherIsBetter, eligible) {
    const pool = owners.filter(eligible);
    const better = pool.filter((o) => (higherIsBetter ? o[field] > mine[field] : o[field] < mine[field])).length;
    return better + 1;
  }

  // The "Your History" card: a few lines about the picked owner, or null when
  // they have no seasons on record.
  function yourHistory(owners, ledger, name) {
    const mine = (owners || []).find((o) => o.key === keyOf(name));
    if (!mine) return null;
    const latest = (ledger || []).length ? ledger[ledger.length - 1] : null;

    const parts = [];
    if (mine.titles) parts.push(`${mine.titles} title${mine.titles === 1 ? "" : "s"}`);
    if (mine.seconds) parts.push(`${mine.seconds} runner-up${mine.seconds === 1 ? "" : "s"}`);
    if (mine.thirds) parts.push(`${mine.thirds} third${mine.thirds === 1 ? "" : "s"}`);

    let finishRank = null;
    if (mine.avgFinish != null) finishRank = standingAmong(owners, mine, "avgFinish", false, (o) => o.avgFinish != null);

    let playoffRank = null;
    let ahead = null;
    if (mine.poGames > 0) {
      const playoffOwners = owners.filter((o) => o.poGames > 0);
      playoffRank = standingAmong(owners, mine, "poW", true, (o) => o.poGames > 0);
      if (playoffRank === 2) ahead = playoffOwners.find((o) => o.poW > mine.poW) || null;
    }

    const liveCell = latest && !latest.complete ? mine.cells.find((c) => c.year === latest.year) : null;
    let live = null;
    if (liveCell) {
      const games = liveCell.wins + liveCell.losses + liveCell.ties;
      live = {
        year: latest.year,
        finish: liveCell.finish,
        games,
        inside: games > 0 ? liveCell.finish <= latest.playoffTeams : null,
        playoffTeams: latest.playoffTeams,
      };
    }

    return {
      name: mine.name,
      titles: mine.titles,
      titleYears: mine.titleYears,
      podiums: mine.podiums,
      podiumText: parts.join(", "),
      avgFinish: mine.avgFinish,
      finishRank,
      completedYears: mine.completedYears,
      poRecord: recordOf(mine.poW, mine.poL, mine.poT),
      poGames: mine.poGames,
      playoffRank,
      aheadName: ahead ? ahead.name : null,
      aheadRecord: ahead ? recordOf(ahead.poW, ahead.poL, ahead.poT) : null,
      live,
    };
  }

  // ---- Championship Rings ------------------------------------------------

  const RING_INELIGIBLE_POSITIONS = new Set(["K", "DEF"]);

  /*
    A player earns one ring for a season if they were on that season's
    champion's roster at ANY point, started or not. Counts distinct title
    seasons per player and keeps which season and owner each ring came from,
    plus how many weeks they actually started for the champion. Kickers and
    defenses are not eligible: they say more about who streamed the right
    matchup than about the roster. Sleeper era only, since no roster data
    exists for ESPN. Returns every player, most rings first.
  */
  function computeRings(seasons, deepSeasons, playerDirectory) {
    const ringsByPlayer = new Map();
    (seasons || []).forEach((entry, idx) => {
      const { league, rosters, users, bracket } = entry;
      const championRosterId = SleeperAPI.findChampionRosterId(bracket);
      if (championRosterId == null) return; // still in progress, or no bracket on record

      const roster = (rosters || []).find((r) => r.roster_id === championRosterId);
      const user = (users || []).find((u) => u.user_id === (roster && roster.owner_id));
      const ownerName = (user && user.display_name) || SleeperAPI.teamName(user, championRosterId);
      const ownerId = roster ? roster.owner_id : null;

      // A player being a key at all, even with 0 starts, is what makes them eligible.
      const starts = new Map();
      const deep = deepSeasons && deepSeasons[idx];
      (deep ? deep.weeks : []).forEach((w) => {
        (w.matchups || []).forEach((m) => {
          if (m.roster_id !== championRosterId) return;
          const starterSet = new Set(m.starters || []);
          (m.players || []).forEach((pid) => {
            if (!pid || pid === "0") return;
            const position = playerDirectory && playerDirectory[pid] && playerDirectory[pid].position;
            if (RING_INELIGIBLE_POSITIONS.has(position)) return;
            if (!starts.has(pid)) starts.set(pid, 0);
            if (starterSet.has(pid)) starts.set(pid, starts.get(pid) + 1);
          });
        });
      });

      starts.forEach((gamesStarted, pid) => {
        if (!ringsByPlayer.has(pid)) ringsByPlayer.set(pid, []);
        ringsByPlayer.get(pid).push({ season: Number(league.season), ownerName, ownerId, ownerKey: keyOf(ownerName), gamesStarted });
      });
    });

    return [...ringsByPlayer.entries()]
      .map(([playerId, rings]) => ({
        playerId,
        rings: rings.sort((a, b) => a.season - b.season),
        totalGamesStarted: rings.reduce((t, r) => t + r.gamesStarted, 0),
      }))
      .sort((a, b) => b.rings.length - a.rings.length || b.totalGamesStarted - a.totalGamesStarted);
  }

  // One column per season whose champion has a roster on record (the Sleeper
  // years), oldest first.
  function ringColumns(ledger) {
    return (ledger || [])
      .filter((s) => s.source === "sleeper" && s.champion)
      .map((s) => ({ year: s.year, ownerKey: s.champion.key, ownerName: s.champion.name }));
  }

  /*
    A short, unique label for each owner (their first letter), used to letter
    the squares. If two owners share an initial the later one gets a longer
    label so a letter never means two people.
  */
  function ownerLetters(owners) {
    const taken = new Set();
    const out = new Map();
    (owners || []).forEach((o) => {
      if (out.has(o.key)) return;
      const name = String(o.name || o.key).trim();
      let label = null;
      for (let len = 1; len <= name.length; len++) {
        const candidate = name.charAt(0).toUpperCase() + name.slice(1, len).toLowerCase();
        if (!taken.has(candidate)) {
          label = candidate;
          break;
        }
      }
      if (label == null) label = name;
      taken.add(label);
      out.set(o.key, label);
    });
    return out;
  }

  return {
    DEFAULT_PLAYOFF_TEAMS,
    MIN_SEED_ROWS,
    keyOf,
    ord,
    recordOf,
    buildLedger,
    trophyCards,
    liveSummary,
    titlesByOwner,
    heroStats,
    podiumsBySeed,
    cellStatus,
    buildOwners,
    sortOwners,
    filterOwners,
    yourHistory,
    computeRings,
    ringColumns,
    ownerLetters,
  };
})();
