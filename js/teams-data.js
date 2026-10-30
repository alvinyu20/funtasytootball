/*
  Teams page numbers, kept apart from the page code so they can be tested on
  their own. Nothing here touches the page.

  The page is built on the same owner cells the History page uses
  (HistoryData.buildOwners), so a finish, a title or a playoff trip can never
  read differently on the two pages. What is added here is what only the Teams
  page needs: the league's scoring average for every year, the head-to-head
  table with regular season and playoffs side by side, the draft report cards
  (with the season in progress left ungraded), and the profile tiles.

  Everything takes plain data in and gives plain data out.
*/
const TeamsData = (function () {
  const MIN_H2H_GAMES = 5; // fewer games than this is "too small to rank"
  const MIN_GAMES_TO_RANK = 20; // a newcomer with fewer games sorts after everyone else
  const GRADES = ["S+", "S", "A", "B", "C", "D", "F"];

  const keyOf = (name) => HistoryData.keyOf(name);
  const ord = (n) => HistoryData.ord(n);
  const recordOf = (w, l, t) => HistoryData.recordOf(w, l, t);
  const pctOf = (num, den) => (den > 0 ? (num / den) * 100 : null);

  // ---- scoring averages -------------------------------------------------

  /*
    The league's points per team per game for every year: all the points the
    teams scored that year over all the games they played. Sleeper years come
    from the season chain; years before that from the ESPN file. A year in both
    keeps the Sleeper numbers.
  */
  function leagueAverages(chain, manual) {
    const totals = new Map();
    const add = (year, pts, games) => {
      if (!(games > 0) || !(pts > 0)) return;
      const t = totals.get(year) || { pts: 0, games: 0, teams: 0 };
      t.pts += pts;
      t.games += games;
      t.teams += 1;
      totals.set(year, t);
    };
    const sleeperYears = new Set();
    (chain || []).forEach((entry) => {
      const year = Number(entry.league.season);
      sleeperYears.add(year);
      SleeperAPI.buildStandings(entry.rosters || [], entry.users || []).forEach((s) => add(year, s.fpts, s.wins + s.losses + s.ties));
    });
    ((manual && manual.seasons) || []).forEach((season) => {
      const year = Number(season.year);
      if (sleeperYears.has(year)) return;
      (season.standings || []).forEach((r) => add(year, Number(r.pointsFor), (r.wins || 0) + (r.losses || 0) + (r.ties || 0)));
    });
    const out = {};
    totals.forEach((t, year) => {
      out[year] = { ppg: t.pts / t.games, teams: t.teams };
    });
    return out;
  }

  // ---- Season by Season -------------------------------------------------

  const STATUS_LABELS = {
    champion: "TITLE",
    runnerUp: "2ND",
    third: "3RD",
    playoffs: "PLAYOFFS",
    missed: "MISSED",
    "live-in": "LIVE",
    "live-out": "LIVE",
    live: "LIVE",
  };

  /*
    One row per season the owner played, newest first. `manager` is the
    DeepHistory manager (after the ESPN seasons were folded in) and supplies the
    points and all-play numbers; `owner` supplies the finish and how the playoffs
    went. Luck and the all-play record are only shown where a genuine all-play
    record exists: the earliest ESPN years have none, so they read n/a.
  */
  function seasonRows(owner, manager, averages) {
    if (!owner) return [];
    const bySeason = new Map(((manager && manager.seasons) || []).map((s) => [Number(s.season), s]));
    return [...owner.cells]
      .sort((a, b) => b.year - a.year)
      .map((cell) => {
        const ms = bySeason.get(cell.year) || null;
        const games = cell.wins + cell.losses + cell.ties;
        const avg = averages && averages[cell.year] ? averages[cell.year].ppg : null;
        const allPlay = ms && ms.luckPct != null ? ms : null;
        const allPlayGames = allPlay ? (allPlay.overallWins || 0) + (allPlay.overallLosses || 0) + (allPlay.overallTies || 0) : 0;
        return {
          year: cell.year,
          finish: cell.finish,
          status: cell.status,
          label: STATUS_LABELS[cell.status] || "",
          live: !cell.complete,
          wins: cell.wins,
          losses: cell.losses,
          ties: cell.ties,
          games,
          record: recordOf(cell.wins, cell.losses, cell.ties),
          winPct: pctOf(cell.wins, games),
          ppgFor: ms && games ? ms.fpts / games : null,
          ppgAgainst: ms && games ? ms.fptsAgainst / games : null,
          leagueAvg: avg,
          overall: allPlay && allPlayGames > 0 ? { wins: allPlay.overallWins || 0, losses: allPlay.overallLosses || 0, ties: allPlay.overallTies || 0, text: recordOf(allPlay.overallWins, allPlay.overallLosses, allPlay.overallTies) } : null,
          luck: allPlay ? allPlay.luckPct : null,
        };
      });
  }

  // ---- the profile header and tiles ---------------------------------------

  function overallOf(o) {
    const w = o.regW + o.poW;
    const l = o.regL + o.poL;
    const t = o.regT + o.poT;
    return { w, l, t, games: w + l + t, pct: pctOf(w, w + l + t) };
  }

  // "5 titles · 5-0 in championship games", or "No titles yet" (with the finals record when there have been any).
  function titleLine(owner) {
    const finals = owner.titles + owner.seconds;
    const head = owner.titles > 0 ? `${owner.titles} title${owner.titles === 1 ? "" : "s"}` : "No titles yet";
    return finals > 0 ? `${head} · ${owner.titles}-${owner.seconds} in championship games` : head;
  }

  /*
    Everything the profile's top shows: the hero line, the title rings, and
    the seven tiles. `owners` is every owner (for "best of the 15") and `ledger`
    the HistoryData ledger (for the season in progress).
  */
  function profileFacts(owner, owners, ledger, manager) {
    const all = owners || [];
    const latest = (ledger || []).length ? ledger[ledger.length - 1] : null;
    const liveCell = latest && !latest.complete ? owner.cells.find((c) => c.year === latest.year) || null : null;
    const liveGames = liveCell ? liveCell.wins + liveCell.losses + liveCell.ties : 0;
    const lastYear = owner.cells.length ? owner.cells[owner.cells.length - 1].year : null;
    const latestCell = latest ? owner.cells.find((c) => c.year === latest.year) || null : null;

    let now = null;
    if (latestCell && !latestCell.complete) {
      now = liveGames > 0 ? `${latest.year} ranked ${ord(latestCell.finish)} after Week ${liveGames}` : `${latest.year} season hasn't started`;
    } else if (latestCell) {
      now = `${latest.year} finished ${ord(latestCell.finish)}`;
    } else if (lastYear != null) {
      now = `Last played ${lastYear}`;
    }

    const mine = overallOf(owner);
    const pool = all.map((o) => overallOf(o)).filter((x) => x.games > 0);
    const overallRank = mine.games > 0 ? pool.filter((x) => x.pct > mine.pct).length + 1 : null;
    const finalsPlayed = owner.titles + owner.seconds;
    const byeCount = manager ? manager.byes || 0 : 0;

    const regGames = owner.regW + owner.regL + owner.regT;
    return {
      name: owner.name,
      since: owner.firstYear,
      now,
      titles: owner.titles,
      titleYears: owner.titleYears,
      titleLine: titleLine(owner),
      finals: `${owner.titles}-${owner.seconds}`,
      overall: {
        record: recordOf(mine.w, mine.l, mine.t),
        pct: mine.pct,
        rank: overallRank,
        of: pool.length,
      },
      regular: {
        record: recordOf(owner.regW, owner.regL, owner.regT),
        pct: pctOf(owner.regW, regGames),
      },
      playoffs: {
        record: recordOf(owner.poW, owner.poL, owner.poT),
        pct: owner.poPct,
        games: owner.poGames,
      },
      titleGames: { record: finalsPlayed > 0 ? `${owner.titles}-${owner.seconds}` : "–" },
      trips: { text: owner.completedYears > 0 ? `${owner.trips} of ${owner.completedYears}` : "–" },
      byes: { count: byeCount, text: owner.trips > 0 ? String(byeCount) : "–" },
      third: { count: owner.thirds },
    };
  }

  // ---- the manager cards ------------------------------------------------

  /*
    What one card shows: the finish bars (one per year in the league's history),
    the overall record, the current standing and the titles. `ctx` is
    { years, teamCountByYear, latestYear, teamNames } where teamNames maps a
    Sleeper user id to the team name (left blank when it is just the username).
  */
  function ownerCard(owner, ctx) {
    const o = overallOf(owner);
    const bars = ctx.years.map((year) => {
      const cell = owner.cells.find((c) => c.year === year);
      if (!cell) return { year, empty: true };
      const teams = ctx.teamCountByYear[year] || 0;
      const better = teams > 1 ? 1 - (cell.finish - 1) / (teams - 1) : 1;
      return {
        year,
        empty: false,
        status: cell.status,
        title: !!cell.isChampion,
        live: !cell.complete,
        finish: cell.finish,
        height: Math.max(0.12, Math.min(1, 0.12 + 0.88 * better)),
      };
    });
    const latestCell = owner.cells.find((c) => c.year === ctx.latestYear) || null;
    let rank = null;
    if (latestCell) {
      const started = latestCell.wins + latestCell.losses + latestCell.ties > 0 || latestCell.complete;
      rank = {
        finish: latestCell.finish,
        text: `${ord(latestCell.finish)} in ${ctx.latestYear}`,
        inside: latestCell.status === "live-in" || (latestCell.complete && latestCell.appeared),
        started,
        isNew: !!owner.isNew,
      };
    }
    const teamName = (ctx.teamNames && owner.userId && ctx.teamNames[owner.userId]) || "";
    return {
      key: owner.key,
      name: owner.name,
      teamName: keyOf(teamName) === keyOf(owner.name) ? "" : teamName,
      userId: owner.userId,
      former: !!owner.former,
      isNew: !!owner.isNew,
      titles: owner.titles,
      titleYears: owner.titleYears,
      seasons: owner.cells.length,
      games: o.games,
      record: recordOf(o.w, o.l, o.t),
      pct: o.pct,
      trips: owner.trips,
      completedYears: owner.completedYears,
      poRecord: recordOf(owner.poW, owner.poL, owner.poT),
      poGames: owner.poGames,
      avgFinish: owner.avgFinish,
      rank,
      bars,
    };
  }

  /*
    Order for the cards. Anyone with fewer than MIN_GAMES_TO_RANK games is a
    newcomer whose win rate says little, so they sort after everyone else in
    the Titles and Win % orders.
  */
  function sortCards(cards, how) {
    const established = (c) => (c.games >= MIN_GAMES_TO_RANK ? 0 : 1);
    const pct = (c) => (c.pct == null ? -1 : c.pct);
    const byName = (a, b) => a.name.localeCompare(b.name);
    const orders = {
      titles: (a, b) => established(a) - established(b) || b.titles - a.titles || pct(b) - pct(a),
      win: (a, b) => established(a) - established(b) || pct(b) - pct(a) || b.games - a.games,
      rank: (a, b) => (a.rank ? a.rank.finish : 1e9) - (b.rank ? b.rank.finish : 1e9),
      az: () => 0,
    };
    const cmp = orders[how] || orders.titles;
    return [...cards].sort((a, b) => cmp(a, b) || byName(a, b));
  }

  /*
    Former managers sit in their own section. A to Z stays alphabetical; every
    other order puts whoever played the most seasons first (then the most games).
  */
  function sortFormer(cards, how) {
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (how === "az") return [...cards].sort(byName);
    return [...cards].sort((a, b) => b.seasons - a.seasons || b.games - a.games || byName(a, b));
  }

  // ---- Head to Head ------------------------------------------------------

  function sumOf(rec) {
    return rec.wins + rec.losses + rec.ties;
  }

  /*
    The head-to-head table: every opponent once, with the regular season and
    the playoffs side by side. Opponents with MIN_H2H_GAMES or more regular
    season games are ranked by win rate; fewer are listed after, by games
    played; anyone met only in the playoffs comes last.

    Playoff entries are matched to the regular-season ones by Sleeper id where
    there is one, otherwise by name (the earlier years only know names).
  */
  function headToHead(manager) {
    const byId = new Map();
    const byName = new Map();
    const rows = [];
    ((manager && manager.headToHead) || []).forEach((h) => {
      const row = {
        key: h.opponentUserId ? `u:${h.opponentUserId}` : `n:${keyOf(h.opponentName)}`,
        name: h.opponentName,
        userId: h.opponentUserId || null,
        reg: { wins: h.wins, losses: h.losses, ties: h.ties },
        po: { wins: 0, losses: 0, ties: 0 },
      };
      rows.push(row);
      if (row.userId) byId.set(row.userId, row);
      byName.set(keyOf(row.name), row);
    });
    ((manager && manager.headToHeadPlayoffs) || []).forEach((h) => {
      let row = (h.opponentUserId && byId.get(h.opponentUserId)) || byName.get(keyOf(h.opponentName));
      if (!row) {
        row = {
          key: h.opponentUserId ? `u:${h.opponentUserId}` : `n:${keyOf(h.opponentName)}`,
          name: h.opponentName,
          userId: h.opponentUserId || null,
          reg: { wins: 0, losses: 0, ties: 0 },
          po: { wins: 0, losses: 0, ties: 0 },
        };
        rows.push(row);
        byName.set(keyOf(row.name), row);
      }
      row.po = { wins: h.wins, losses: h.losses, ties: h.ties };
    });

    rows.forEach((r) => {
      r.games = sumOf(r.reg);
      r.poGames = sumOf(r.po);
      r.winPct = pctOf(r.reg.wins, r.games);
      r.record = recordOf(r.reg.wins, r.reg.losses, r.reg.ties);
      r.poRecord = r.poGames ? recordOf(r.po.wins, r.po.losses, r.po.ties) : null;
    });

    const ranked = rows.filter((r) => r.games >= MIN_H2H_GAMES).sort((a, b) => b.winPct - a.winPct || b.games - a.games || a.name.localeCompare(b.name));
    const small = rows.filter((r) => r.games > 0 && r.games < MIN_H2H_GAMES).sort((a, b) => b.games - a.games || b.winPct - a.winPct || a.name.localeCompare(b.name));
    const playoffOnly = rows.filter((r) => r.games === 0 && r.poGames > 0).sort((a, b) => b.poGames - a.poGames || a.name.localeCompare(b.name));
    return { rows, ranked, small, playoffOnly, bestKey: ranked.length ? ranked[0].key : null, worstKey: ranked.length > 1 ? ranked[ranked.length - 1].key : null };
  }

  /*
    Opponents met only in the playoffs, grouped when they are all the same
    single game ("One playoff win over each"). Anything less tidy stays one
    row per opponent.
  */
  function playoffOnlyGroups(list) {
    if (!list.length) return [];
    const same = list.length > 1 && list.every((r) => r.poGames === 1 && r.poRecord === list[0].poRecord);
    if (!same) return list.map((r) => ({ names: [r.name], record: r.poRecord, note: "" }));
    const won = list[0].po.wins === 1;
    const lost = list[0].po.losses === 1;
    const total = list.reduce((acc, r) => ({ wins: acc.wins + r.po.wins, losses: acc.losses + r.po.losses, ties: acc.ties + r.po.ties }), { wins: 0, losses: 0, ties: 0 });
    return [{ names: list.map((r) => r.name), record: recordOf(total.wins, total.losses, total.ties), note: won ? "One playoff win over each" : lost ? "One playoff loss to each" : "One playoff tie with each" }];
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  function joinNames(names) {
    if (names.length <= 1) return names.join("");
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  /*
    The four notes beside the table: best matchup, worst matchup, playoff rival
    and playoff losses. A card is left out when there is nothing to say.
  */
  function headToHeadCards(h2h) {
    const cards = [];
    const { ranked, rows } = h2h;
    if (ranked.length) {
      const best = ranked[0];
      const pct = Math.round(best.winPct);
      const po = best.poGames ? `, and ${best.poRecord} against them in the playoffs` : "";
      cards.push({ kind: "best", label: "Best matchup", head: `${best.name}, ${best.record}`, body: `${pct}% across ${best.games} games${po}.` });
    }
    if (ranked.length > 1) {
      const worst = ranked[ranked.length - 1];
      const next = ranked.slice(-3, -1).reverse(); // the next-worst, then the one after
      const nextText = next.length ? ` ${next[0].name} is next at ${next[0].record}${next[1] ? `, then ${next[1].name} at ${next[1].record}` : ""}.` : "";
      cards.push({ kind: "worst", label: "Worst matchup", head: `${worst.name}, ${worst.record}`, body: `${Math.round(worst.winPct)}% in ${worst.games} games.${nextText}` });
    }
    const played = rows.filter((r) => r.poGames > 0);
    if (played.length) {
      const rival = [...played].sort((a, b) => b.poGames - a.poGames || b.po.wins - a.po.wins || a.name.localeCompare(b.name))[0];
      const second = played.filter((r) => r !== rival).sort((a, b) => b.po.wins - a.po.wins || a.name.localeCompare(b.name))[0];
      const moreThanAnyone = played.every((r) => r === rival || r.poGames < rival.poGames);
      const first = `${plural(rival.poGames, "playoff game")}${moreThanAnyone && played.length > 1 ? ", more than against anyone else" : ""}.`;
      const alsoBest = second && second.po.wins >= 2 ? ` ${second.poRecord} against ${second.name}.` : "";
      cards.push({ kind: "rival", label: "Playoff rival", head: `${rival.name}, ${rival.poRecord}`, body: `${first}${alsoBest}` });

      const lossesBy = played.filter((r) => r.po.losses > 0).sort((a, b) => b.po.losses - a.po.losses || a.name.localeCompare(b.name));
      const totalLosses = lossesBy.reduce((t, r) => t + r.po.losses, 0);
      let body = "No playoff losses yet.";
      if (totalLosses > 0) {
        const multi = lossesBy.filter((r) => r.po.losses > 1).map((r) => `${r.po.losses} to ${r.name}`);
        const single = lossesBy.filter((r) => r.po.losses === 1).map((r) => r.name);
        const parts = [...multi];
        if (single.length) parts.push(single.length === 1 ? `1 to ${single[0]}` : `1 each to ${joinNames(single)}`);
        body = `${joinNames(parts)}.`;
      }
      cards.push({ kind: "losses", label: "Playoff losses", head: `${totalLosses} total`, body });
    }
    return cards;
  }

  // ---- Draft ---------------------------------------------------------------

  // A season's grades are published once the season is over; ESPN seasons have no draft data at all.
  function isGraded(season) {
    return season.isSeasonComplete !== false;
  }

  /*
    The years with draft picks, newest first, for the year selector. A year
    still being played is listed (its picks can be looked at) but marked
    ungraded.
  */
  function draftYears(manager) {
    return [...((manager && manager.seasons) || [])]
      .filter((s) => (s.draftPicks || []).length > 0)
      .sort((a, b) => Number(b.season) - Number(a.season))
      .map((s) => ({ year: Number(s.season), picks: s.draftPicks.length, graded: isGraded(s), title: !!s.isChampion }));
  }

  // The year the page opens on: the newest graded year, else the newest year with picks.
  function defaultDraftYear(years) {
    const graded = years.find((y) => y.graded);
    return graded ? graded.year : years.length ? years[0].year : null;
  }

  /*
    The report-card rows: every pick's grade in pick order, plus how many were
    S+, S or A and how many D or F. A season that is not over has no row.
  */
  function reportCards(manager) {
    return [...((manager && manager.seasons) || [])]
      .filter((s) => (s.draftPicks || []).length > 0 && isGraded(s))
      .sort((a, b) => Number(b.season) - Number(a.season))
      .map((s) => {
        const grades = s.draftPicks.map((p) => (GRADES.includes(p.grade) ? p.grade : null));
        return {
          year: Number(s.season),
          title: !!s.isChampion,
          grades,
          sa: grades.filter((g) => g === "S+" || g === "S" || g === "A").length,
          df: grades.filter((g) => g === "D" || g === "F").length,
        };
      });
  }

  /*
    One year's picks. For a season in progress the grade and the value are left
    out entirely (both would read as a verdict on a pick that has barely
    played), leaving the pick, the player and the points so far. "vsSlot" is
    the points a pick returned above what picks at that slot typically return.
  */
  function draftTable(season) {
    if (!season) return null;
    const graded = isGraded(season);
    const picks = (season.draftPicks || []).map((p) => ({
      label: `${p.round}.${p.pickInRound}`,
      player: p.player,
      playerId: p.playerId || null,
      position: p.position || "",
      points: p.points,
      vsSlot: graded && p.valueOverSlot != null ? p.valueOverSlot : null,
      grade: graded && GRADES.includes(p.grade) ? p.grade : null,
    }));
    const maxVsSlot = picks.reduce((m, p) => (p.vsSlot == null ? m : Math.max(m, Math.abs(p.vsSlot))), 0);
    return { year: Number(season.season), graded, title: !!season.isChampion, picks, maxVsSlot };
  }

  // ---- Most Common Lineup ---------------------------------------------------

  const ACQUISITION_ORDER = ["Draft", "Waivers", "Trade", "Free Agency", "Roster"];

  function lineupView(season) {
    const lineup = season && season.startingLineup;
    if (!lineup || !lineup.slots || !lineup.slots.length) return null;
    const weeks = lineup.weeksCounted || 0;
    const slots = lineup.slots.map((s) => ({
      slot: s.slot,
      player: s.player || null,
      playerId: s.playerId || null,
      acquisition: s.player ? s.acquisition || "Roster" : null,
      starts: s.starts || 0,
      share: weeks > 0 ? Math.min(1, (s.starts || 0) / weeks) : 0,
    }));
    const counts = new Map();
    slots.forEach((s) => {
      if (s.acquisition) counts.set(s.acquisition, (counts.get(s.acquisition) || 0) + 1);
    });
    const mix = ACQUISITION_ORDER.filter((a) => counts.has(a)).map((a) => ({ label: a, count: counts.get(a) }));
    return { year: Number(season.season), weeks, title: !!season.isChampion, slots, mix };
  }

  // ---- Season Awards and the Player Representative -----------------------------

  const AWARD_ORDER = ["Best Draft Pick", "Best FA Pickup", "Best Team", "Worst Drop", "Worst Draft Pick", "Most Significant Injury"];
  const GOOD_AWARDS = new Set(["Best Draft Pick", "Best FA Pickup", "Best Team"]);

  /*
    Every award the owner won, newest first. Best-of awards are marked good and
    the rest (worst picks, worst drops, injuries) bad. Only years the site tracks
    count; the awards file also holds seasons from before the league existed here.
  */
  function awardsFor(username, awards, trackedYears) {
    const out = [];
    if (!username || !awards || !awards.seasons) return out;
    Object.entries(awards.seasons).forEach(([year, categories]) => {
      if (trackedYears && !trackedYears.has(String(year))) return;
      Object.entries(categories || {}).forEach(([category, award]) => {
        if (award && keyOf(award.username) === keyOf(username)) {
          out.push({ year: Number(year), category, detail: award.detail || "", good: GOOD_AWARDS.has(category) });
        }
      });
    });
    const rank = (c) => {
      const i = AWARD_ORDER.indexOf(c);
      return i === -1 ? AWARD_ORDER.length : i;
    };
    return out.sort((a, b) => b.year - a.year || rank(a.category) - rank(b.category));
  }

  // The five players who spent the most weeks on the roster, with each one's bar against the leader.
  function playerRep(manager) {
    const list = ((manager && manager.mostRostered) || []).slice(0, 5);
    const top = list.length ? list[0].weeksRostered : 0;
    return list.map((p) => ({ playerId: p.playerId, name: p.name, weeks: p.weeksRostered, share: top > 0 ? p.weeksRostered / top : 0 }));
  }

  return {
    MIN_H2H_GAMES,
    MIN_GAMES_TO_RANK,
    GRADES,
    leagueAverages,
    seasonRows,
    profileFacts,
    ownerCard,
    sortCards,
    sortFormer,
    headToHead,
    playoffOnlyGroups,
    headToHeadCards,
    isGraded,
    draftYears,
    defaultDraftYear,
    reportCards,
    draftTable,
    lineupView,
    awardsFor,
    playerRep,
  };
})();
