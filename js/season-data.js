/*
  Seasons page numbers, kept apart from the page code (js/season.js) so they can be tested on their
  own. Nothing here touches the page. Everything reads what the page already has: the season's
  Sleeper entry ({ league, rosters, users, bracket }), its weekly data (deep.weeks) and the summary
  DeepHistory.computeSeasonSummary builds.

    standingsRows   the Final Standings table: finish, record, points, all-play, expected wins,
                    luck (in percent), schedule and the last five results
    seasonGrid      every team's score every week (the Season Grid), with the playoff rounds
    bracketModel    the playoff bracket as columns of games and byes, the champion's route and story
    legacyBracket   the same shape for an ESPN-era season (data/manual-history.json)
    slotTable       points per week from each lineup slot, against the league average per slot
    rankGrid / scoreCards / oddsGrid   the three Power Rank History views
    bumpModel       Standings Over Time: every team's rank each week, with three teams picked out
*/
const SeasonData = (function () {
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sd = (xs) => {
    if (xs.length < 2) return null;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / xs.length);
  };
  const recordOf = (w, l, t) => `${w || 0}-${l || 0}${t ? "-" + t : ""}`;
  const playoffStartOf = (league) => (league && league.settings && league.settings.playoff_week_start) || null;
  // A short tag for a manager in a narrow cell: the first four letters, in capitals.
  const abbr = (name) => String(name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase() || "?";

  // ---- games -----------------------------------------------------------------------------------

  // Every regular-season game each roster played: rosterId -> [{ week, pts, opp, oppPts, result }],
  // oldest first. A week where both sides scored 0 has not been played yet.
  function teamGames(seasonEntry, deep) {
    const start = playoffStartOf(seasonEntry && seasonEntry.league);
    const out = new Map();
    ((deep && deep.weeks) || []).forEach((w) => {
      if (start && w.week >= start) return;
      const byMatch = new Map();
      (w.matchups || []).forEach((m) => {
        if (m.matchup_id == null) return;
        if (!byMatch.has(m.matchup_id)) byMatch.set(m.matchup_id, []);
        byMatch.get(m.matchup_id).push(m);
      });
      byMatch.forEach((pair) => {
        if (pair.length !== 2) return;
        const [a, b] = pair;
        if (!(a.points || 0) && !(b.points || 0)) return;
        [
          [a, b],
          [b, a],
        ].forEach(([me, op]) => {
          const pts = me.points || 0;
          const oppPts = op.points || 0;
          if (!out.has(me.roster_id)) out.set(me.roster_id, []);
          out.get(me.roster_id).push({ week: w.week, pts, opp: op.roster_id, oppPts, result: pts > oppPts ? "W" : pts < oppPts ? "L" : "T" });
        });
      });
    });
    out.forEach((g) => g.sort((x, y) => x.week - y.week));
    return out;
  }

  // Points a roster scored in a given week (any week, playoffs included), or null.
  function weekPoints(deep, week, rosterId) {
    const w = ((deep && deep.weeks) || []).find((x) => x.week === week);
    const m = w && (w.matchups || []).find((x) => x.roster_id === rosterId);
    return m && m.points != null ? m.points : null;
  }

  // ---- how each team's season ended --------------------------------------------------------------

  // rosterId -> { kind, label } from the winners bracket: Champion, Runner-up, 3rd place, 4th place,
  // Lost semifinal / Lost quarterfinal. The 5th-place game is not counted (it decides nothing that matters).
  function finishes(bracket) {
    const relevant = SleeperAPI.relevantBracketGames(bracket || []);
    const out = new Map();
    if (!relevant.length) return out;
    const maxR = Math.max(...relevant.map((g) => g.r));
    relevant
      .filter((g) => g.p !== 1 && g.p !== 3 && g.l != null)
      .forEach((g) => {
        const d = maxR - g.r;
        out.set(g.l, { kind: "lost", label: d === 1 ? "Lost semifinal" : d === 2 ? "Lost quarterfinal" : `Lost round ${g.r}` });
      });
    const third = relevant.find((g) => g.p === 3);
    if (third && third.w != null) {
      out.set(third.w, { kind: "third", label: "3rd place" });
      if (third.l != null) out.set(third.l, { kind: "fourth", label: "4th place" });
    }
    const champ = relevant.find((g) => g.p === 1);
    if (champ && champ.w != null) {
      out.set(champ.w, { kind: "champion", label: "Champion" });
      if (champ.l != null) out.set(champ.l, { kind: "runnerup", label: "Runner-up" });
    }
    return out;
  }

  // ---- Final Standings ---------------------------------------------------------------------------

  /*
    One row per team in standings order (wins, then points). Points per game is regular season only.
    All-play is the record against every team every week; expected wins is that win rate times the
    games played; luck stays the site's percent (real win % minus all-play win %). Schedule is the
    average score of the opponents faced, ranked 1 = toughest. Last 5 are the last five regular-season
    results, oldest first. `finish` is how the season ended, only once it is over.
  */
  function standingsRows(summary, seasonEntry, deep) {
    const games = teamGames(seasonEntry, deep);
    const complete = !!(seasonEntry && seasonEntry.league && seasonEntry.league.status === "complete");
    const fin = complete ? finishes(seasonEntry.bracket) : new Map();
    const rows = ((summary && summary.standings) || []).map((t, i) => {
      const g = games.get(t.rosterId) || [];
      const gp = (t.wins || 0) + (t.losses || 0) + (t.ties || 0);
      const apGames = (t.overallWins || 0) + (t.overallLosses || 0) + (t.overallTies || 0);
      const apPct = apGames ? ((t.overallWins || 0) + 0.5 * (t.overallTies || 0)) / apGames : null;
      return {
        rank: i + 1,
        rosterId: t.rosterId,
        userId: t.userId || null,
        username: t.username || t.teamName,
        name: t.teamName,
        wins: t.wins || 0,
        losses: t.losses || 0,
        ties: t.ties || 0,
        record: recordOf(t.wins, t.losses, t.ties),
        pf: t.fpts || 0,
        pa: t.fptsAgainst || 0,
        diff: (t.fpts || 0) - (t.fptsAgainst || 0),
        ppg: g.length ? mean(g.map((x) => x.pts)) : gp ? (t.fpts || 0) / gp : null,
        allPlay: apGames ? recordOf(t.overallWins, t.overallLosses, t.overallTies) : null,
        allPlayPct: apPct,
        expWins: apPct != null ? apPct * gp : null,
        luckPct: t.luckPct != null ? t.luckPct : null,
        sched: t.avgOpponentPF != null ? t.avgOpponentPF : null,
        schedRank: null,
        last5: g.slice(-5).map((x) => x.result),
        finish: fin.get(t.rosterId) || (complete && fin.size ? { kind: "missed", label: "Missed" } : null),
      };
    });
    const withSched = rows.filter((r) => r.sched != null).sort((a, b) => b.sched - a.sched);
    withSched.forEach((r, i) => {
      r.schedRank = i + 1;
      r.schedOf = withSched.length;
    });
    return rows;
  }

  // ---- Season Grid -------------------------------------------------------------------------------

  // The playoff rounds as columns: QF / SF / F (or R1 ... for a bigger bracket). The 3rd-place game
  // sits in the F column with the final. Only games on the way to 1st or 3rd are shown.
  function playoffColumns(seasonEntry, deep) {
    const bracket = (seasonEntry && seasonEntry.bracket) || [];
    const relevant = SleeperAPI.relevantBracketGames(bracket);
    const start = playoffStartOf(seasonEntry && seasonEntry.league);
    if (!relevant.length || !start) return null;
    const minR = Math.min(...relevant.map((g) => g.r));
    const maxR = Math.max(...relevant.map((g) => g.r));
    const byes = new Set(SleeperAPI.byeRosterIds(bracket));
    const label = (r) => (maxR - r === 0 ? "F" : maxR - r === 1 ? "SF" : maxR - r === 2 ? "QF" : `R${r}`);
    const cols = [];
    for (let r = minR; r <= maxR; r++) cols.push({ r, label: label(r), week: start + r - 1 });
    const cell = (rosterId, col) => {
      const g = relevant.find((x) => x.r === col.r && [SleeperAPI.resolveBracketTeamId(bracket, x, "t1"), SleeperAPI.resolveBracketTeamId(bracket, x, "t2")].includes(rosterId));
      if (!g) return col.r === minR && byes.has(rosterId) ? { bye: true } : null;
      const pts = weekPoints(deep, col.week, rosterId);
      if (pts == null || (g.w == null && !pts)) return null;
      return { pts, won: g.w === rosterId, decided: g.w != null, game: g.p === 1 ? "final" : g.p === 3 ? "third" : "game" };
    };
    return { cols, cell };
  }

  /*
    Rows in standings order. Each regular-season week: the score, W / L / T, and whether it was that
    week's top or lowest score in the league. Avg and spread (how far a team's weeks wander from its own
    average, a standard deviation) cover the regular season. The footer has the league average and the
    top scorer each week. Tiles: most weeks with the league's top score, and the steadiest / wildest team.
  */
  function seasonGrid(summary, seasonEntry, deep) {
    const games = teamGames(seasonEntry, deep);
    const weeks = [...new Set([...games.values()].flatMap((g) => g.map((x) => x.week)))].sort((a, b) => a - b);
    if (!weeks.length) return null;
    const standings = (summary && summary.standings) || [];
    const nameOf = new Map(standings.map((t) => [t.rosterId, t.teamName]));

    const weekInfo = weeks.map((week) => {
      const scores = [];
      games.forEach((g, rid) => {
        const x = g.find((y) => y.week === week);
        if (x) scores.push({ rid, pts: x.pts });
      });
      const max = Math.max(...scores.map((s) => s.pts));
      const min = Math.min(...scores.map((s) => s.pts));
      const top = scores.filter((s) => s.pts === max).map((s) => s.rid);
      return { week, avg: mean(scores.map((s) => s.pts)), max, min, top, topName: top.length ? nameOf.get(top[0]) || "" : "" };
    });

    const complete = !!(seasonEntry && seasonEntry.league && seasonEntry.league.status === "complete");
    const po = playoffColumns(seasonEntry, deep);
    const showPlayoffs = !!po && standings.some((t) => po.cols.some((c) => {
      const x = po.cell(t.rosterId, c);
      return x && !x.bye;
    }));

    const rows = standings.map((t) => {
      const g = games.get(t.rosterId) || [];
      const cells = weekInfo.map((wi) => {
        const x = g.find((y) => y.week === wi.week);
        if (!x) return null;
        return { pts: x.pts, result: x.result, top: x.pts === wi.max, bottom: x.pts === wi.min };
      });
      const pts = g.map((x) => x.pts);
      return {
        rosterId: t.rosterId,
        name: t.teamName,
        username: t.username || t.teamName,
        cells,
        playoffs: showPlayoffs ? po.cols.map((c) => po.cell(t.rosterId, c)) : [],
        avg: mean(pts),
        spread: sd(pts),
        tops: weekInfo.filter((wi) => wi.top.includes(t.rosterId)).length,
      };
    });

    const mostTop = Math.max(...rows.map((r) => r.tops));
    const spreads = rows.filter((r) => r.spread != null).sort((a, b) => a.spread - b.spread);
    return {
      weeks: weekInfo.map((wi) => ({ week: wi.week, avg: wi.avg, topTag: abbr(wi.topName), topName: wi.topName })),
      playoffCols: showPlayoffs ? po.cols.map((c) => ({ label: c.label, week: c.week })) : [],
      rows,
      complete,
      tiles: {
        mostTop: mostTop > 0 ? { count: mostTop, names: rows.filter((r) => r.tops === mostTop).map((r) => r.name), of: weekInfo.length } : null,
        steadiest: spreads.length ? { name: spreads[0].name, spread: spreads[0].spread } : null,
        wildest: spreads.length > 1 ? { name: spreads[spreads.length - 1].name, spread: spreads[spreads.length - 1].spread } : null,
      },
    };
  }

  // ---- the playoff bracket -------------------------------------------------------------------------

  /*
    { columns: [{ label, week, items: [game | bye] }], champion, rounds }
      game = { kind: "game", label, teams: [{ seed, name, score, won }], margin, winnerName, route, final, third, m }
      bye  = { kind: "bye", seed, name, route }
    Earlier rounds are ordered by the games they feed, so each game lines up with the one it leads to and
    a bye sits where its team comes back in. `route` marks the champion's own games (and bye) in gold.
  */
  function bracketModel(seasonEntry, deep, summary) {
    const bracket = (seasonEntry && seasonEntry.bracket) || [];
    const relevant = SleeperAPI.relevantBracketGames(bracket);
    if (!relevant.length) return null;
    const start = playoffStartOf(seasonEntry.league);
    const standings = (summary && summary.standings) || [];
    const seedOf = new Map(standings.map((t, i) => [t.rosterId, i + 1]));
    const nameOf = new Map(standings.map((t) => [t.rosterId, t.teamName]));
    const rowOf = new Map(standings.map((t) => [t.rosterId, t]));
    const minR = Math.min(...relevant.map((g) => g.r));
    const maxR = Math.max(...relevant.map((g) => g.r));
    const roundName = (r) => (maxR - r === 0 ? "Final" : maxR - r === 1 ? "Semifinals" : maxR - r === 2 ? "Quarterfinals" : `Round ${r}`);
    const gameName = (g) => (g.p === 1 ? "Championship" : g.p === 3 ? "Third place game" : maxR - g.r === 1 ? "Semifinal" : maxR - g.r === 2 ? "Quarterfinal" : `Round ${g.r}`);
    const champGame = relevant.find((g) => g.p === 1);
    const champId = champGame && champGame.w != null ? champGame.w : null;
    const byId = new Map(relevant.map((g) => [g.m, g]));

    const teamOf = (g, slot) => {
      const id = SleeperAPI.resolveBracketTeamId(bracket, g, slot);
      const score = id != null && start ? weekPoints(deep, start + g.r - 1, id) : null;
      return { rosterId: id, seed: id != null ? seedOf.get(id) || null : null, name: id != null ? nameOf.get(id) || `Roster ${id}` : "TBD", score: score || score === 0 ? score : null, won: g.w != null && id != null && g.w === id };
    };
    const gameOf = (g) => {
      const teams = [teamOf(g, "t1"), teamOf(g, "t2")];
      const w = teams.find((t) => t.won);
      const l = teams.find((t) => !t.won);
      const margin = w && l && w.score != null && l.score != null && g.w != null ? w.score - l.score : null;
      return {
        kind: "game",
        m: g.m,
        r: g.r,
        week: start ? start + g.r - 1 : null,
        label: gameName(g),
        teams,
        margin,
        winnerName: w && g.w != null ? w.name : null,
        route: champId != null && g.p !== 3 && teams.some((t) => t.rosterId === champId),
        final: g.p === 1,
        third: g.p === 3,
      };
    };

    // Order each round by the games it feeds, starting from the final.
    const columns = [];
    const main = relevant.filter((g) => g.p !== 3);
    let order = main.filter((g) => g.r === maxR);
    for (let r = maxR; r >= minR; r--) {
      const items = order.map((x) => (x.kind === "bye" ? x : gameOf(x)));
      if (r === maxR) {
        const third = relevant.find((g) => g.p === 3);
        if (third) items.push(gameOf(third));
      }
      columns.unshift({ label: roundName(r), week: start ? start + r - 1 : null, items });
      if (r === minR) break;
      const next = [];
      order.forEach((x) => {
        if (x.kind === "bye") {
          next.push(x);
          return;
        }
        ["t1", "t2"].forEach((slot) => {
          const from = x[slot + "_from"];
          if (from && from.w != null && byId.has(from.w)) next.push(byId.get(from.w));
          else if (x[slot] != null) {
            const id = x[slot];
            next.push({ kind: "bye", rosterId: id, seed: seedOf.get(id) || null, name: nameOf.get(id) || `Roster ${id}`, route: id === champId });
          }
        });
      });
      // anything in the round not reached that way still shows
      main.filter((g) => g.r === r - 1 && !next.includes(g)).forEach((g) => next.push(g));
      order = next;
    }

    let champion = null;
    if (champId != null) {
      const row = rowOf.get(champId);
      const path = columns
        .flatMap((c) => c.items)
        .filter((x) => x.route)
        .map((x) => {
          if (x.kind === "bye") return { bye: true, week: start ? start + minR - 1 : null };
          const opp = x.teams.find((t) => t.rosterId !== champId);
          return { label: x.label, final: x.final, opp: opp ? opp.name : "", margin: x.margin, week: x.week };
        });
      const finalGame = columns[columns.length - 1].items.find((x) => x.final);
      champion = {
        rosterId: champId,
        name: nameOf.get(champId) || `Roster ${champId}`,
        seed: seedOf.get(champId) || null,
        record: row ? recordOf(row.wins, row.losses, row.ties) : null,
        path,
        finalScore: finalGame ? finalGame.teams : null,
      };
    }
    return { columns, champion };
  }

  // The same shape for an ESPN-era season, from ManualHistory.buildBracketData plus the standings
  // (seeds are the regular-season standing; a team with playoffBye gets a bye card).
  function legacyBracket(bracketData, standings) {
    if (!bracketData || !bracketData.rounds || !bracketData.rounds.length) return null;
    const seedOf = new Map((standings || []).map((r) => [String(r.team).toLowerCase(), r.standing]));
    const byes = (standings || []).filter((r) => r.playoffBye).map((r) => r.team);
    const champName = bracketData.champion ? bracketData.champion.name : null;
    const n = bracketData.rounds.length;
    const roundName = (i) => (n - 1 - i === 0 ? "Final" : n - 1 - i === 1 ? "Semifinals" : n - 1 - i === 2 ? "Quarterfinals" : `Round ${i + 1}`);
    const gameOf = (g, i) => {
      const teams = [g.team1, g.team2].map((t) => ({ seed: seedOf.get(String(t.name).toLowerCase()) || null, name: t.name, score: t.score, won: !!t.isWinner }));
      const w = teams.find((t) => t.won);
      const l = teams.find((t) => !t.won);
      const third = g.specialLabel === "3rd Place";
      return {
        kind: "game",
        label: g.isChampionship ? "Championship" : third ? "Third place game" : roundName(i).replace(/s$/, ""),
        teams,
        margin: w && l && w.score != null && l.score != null ? w.score - l.score : null,
        winnerName: w ? w.name : null,
        route: !third && !!champName && teams.some((t) => t.name === champName),
        final: !!g.isChampionship,
        third,
      };
    };
    const columns = bracketData.rounds.map((round, i) => {
      const games = round.games.map((g) => gameOf(g, i));
      const ordered = [...games.filter((g) => !g.third), ...games.filter((g) => g.third)];
      return { label: roundName(i), week: null, items: ordered };
    });
    // A first round with byes: line each game up with the semifinal it fed, byes in their place.
    if (columns.length >= 2 && byes.length) {
      const first = columns[0].items;
      const items = [];
      columns[1].items.forEach((sf) => {
        sf.teams.forEach((t) => {
          const fed = first.find((g) => g.winnerName === t.name);
          if (fed) items.push(fed);
          else if (byes.includes(t.name)) items.push({ kind: "bye", seed: seedOf.get(String(t.name).toLowerCase()) || null, name: t.name, route: t.name === champName });
        });
      });
      first.filter((g) => !items.includes(g)).forEach((g) => items.push(g));
      columns[0].items = items;
    }
    return {
      columns,
      champion: champName ? { name: champName, seed: seedOf.get(String(champName).toLowerCase()) || null, record: null, path: [], finalScore: null } : null,
    };
  }

  // The champion's season in a sentence or two: record and seed, the path, then the final.
  function championStory(champion) {
    if (!champion) return "";
    const parts = [];
    if (champion.record) parts.push(`${champion.record}${champion.seed ? ` and the #${champion.seed} seed.` : "."}`);
    else if (champion.seed) parts.push(`The #${champion.seed} seed.`);
    const steps = [];
    (champion.path || []).forEach((p) => {
      if (p.bye) steps.push(`rested${p.week ? ` in week ${p.week}` : " in the first round"}`);
      else if (p.margin != null) steps.push(p.final && steps.length ? `then ${p.opp} by ${p.margin.toFixed(1)} in the final` : `beat ${p.opp} by ${p.margin.toFixed(1)} in the ${p.final ? "final" : p.label.toLowerCase()}`);
    });
    if (steps.length) {
      const s = steps.join(", ");
      parts.push(s.charAt(0).toUpperCase() + s.slice(1) + ".");
    }
    return parts.join(" ");
  }

  // ---- points by starting slot ----------------------------------------------------------------------

  /*
    Each team's average points per week from each lineup slot, with the gap to the league average for
    that slot (so a 5.3 at WR2 and a 27.0 at QB are on the same footing). Best and worst in each column
    are flagged; Strongest / Weakest are the team's biggest gaps above and below. Sorted by total.
  */
  function slotTable(positionTable) {
    if (!positionTable || !(positionTable.columns || []).length || !(positionTable.rows || []).length) return null;
    const cols = positionTable.columns;
    const avg = {};
    cols.forEach((c) => {
      avg[c.key] = mean(positionTable.rows.map((r) => r.cells[c.key]).filter((v) => v != null));
    });
    const leagueTotal = cols.reduce((s, c) => s + (avg[c.key] || 0), 0);
    const rows = positionTable.rows.map((r) => {
      const cells = cols.map((c) => {
        const v = r.cells[c.key];
        return v == null ? null : { v, gap: avg[c.key] != null ? v - avg[c.key] : 0 };
      });
      const total = cells.reduce((s, x) => s + (x ? x.v : 0), 0);
      const withGap = cells.map((x, i) => ({ x, label: cols[i].label })).filter((y) => y.x);
      const strongest = withGap.length ? withGap.reduce((a, b) => (b.x.gap > a.x.gap ? b : a)) : null;
      const weakest = withGap.length ? withGap.reduce((a, b) => (b.x.gap < a.x.gap ? b : a)) : null;
      return {
        name: r.teamName,
        rosterId: r.rosterId != null ? r.rosterId : null,
        userId: r.userId || null,
        cells,
        total,
        totalGap: total - leagueTotal,
        strongest: strongest && strongest.x.gap > 0 ? { label: strongest.label, gap: strongest.x.gap } : null,
        weakest: weakest && weakest.x.gap < 0 ? { label: weakest.label, gap: weakest.x.gap } : null,
      };
    });
    cols.forEach((c, i) => {
      const vals = rows.map((r) => r.cells[i]).filter(Boolean);
      if (vals.length < 2) return;
      const hi = Math.max(...vals.map((x) => x.v));
      const lo = Math.min(...vals.map((x) => x.v));
      if (hi === lo) return;
      vals.forEach((x) => {
        if (x.v === hi) x.best = true;
        if (x.v === lo) x.worst = true;
      });
    });
    rows.sort((a, b) => b.total - a.total);
    return { columns: cols.map((c) => ({ key: c.key, label: c.label })), rows, leagueTotal, avg: cols.map((c) => avg[c.key]) };
  }

  // ---- Power Rank History -------------------------------------------------------------------------

  // A rank's shade: 5 = the best, 1 = the worst, 3 the quiet middle.
  function rankBand(rank, n) {
    if (rank == null || !n) return 3;
    if (rank <= 1) return 5;
    if (rank >= n) return 1;
    const t = (rank - 1) / (n - 1);
    return t <= 0.34 ? 4 : t >= 0.66 ? 2 : 3;
  }

  // Ranks by week, one row per team, sorted by the latest rank. `move` is preseason minus latest
  // (positive = climbed).
  function rankGrid(ranks) {
    const entries = Object.entries(ranks || {});
    if (!entries.length) return null;
    const weeks = Math.max(...entries.map(([, t]) => (t.weekly || []).length));
    const hasPre = entries.some(([, t]) => t.pre != null);
    const n = entries.length;
    const rows = entries.map(([key, t]) => {
      const weekly = t.weekly || [];
      const latest = [...weekly].reverse().find((v) => v != null);
      return {
        key,
        name: t.label || key,
        pre: t.pre != null ? { v: t.pre, band: rankBand(t.pre, n) } : null,
        cells: Array.from({ length: weeks }, (_, i) => (weekly[i] != null ? { v: weekly[i], band: rankBand(weekly[i], n) } : null)),
        latest: latest != null ? latest : null,
        move: t.pre != null && latest != null ? t.pre - latest : null,
      };
    });
    rows.sort((a, b) => (a.latest == null) - (b.latest == null) || a.latest - b.latest || a.name.localeCompare(b.name));
    return { weeks, hasPre, rows };
  }

  // One small chart per team on the same scale (lower is better), best and worst week marked.
  function scoreCards(scores) {
    const entries = Object.entries(scores || {});
    if (!entries.length) return null;
    const all = entries.flatMap(([, t]) => [t.pre, ...(t.weekly || [])]).filter((v) => v != null);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const cards = entries.map(([key, t]) => {
      const pts = [...(t.pre != null ? [{ x: "Pre", y: t.pre }] : []), ...(t.weekly || []).map((v, i) => ({ x: `W${i + 1}`, y: v }))].filter((p) => p.y != null);
      const latest = pts.length ? pts[pts.length - 1].y : null;
      const weeklyPts = pts.filter((p) => p.x !== "Pre");
      const best = weeklyPts.length ? weeklyPts.reduce((a, b) => (b.y < a.y ? b : a)) : null;
      const worst = weeklyPts.length ? weeklyPts.reduce((a, b) => (b.y > a.y ? b : a)) : null;
      return { key, name: t.label || key, pts, latest, best, worst };
    });
    cards.sort((a, b) => (a.latest == null) - (b.latest == null) || a.latest - b.latest);
    return { lo, hi, cards };
  }

  // A playoff-odds number as the page shows it: 99.0 to 99.9 and anything under 1 (but over 0) keep
  // one decimal, so a 99.6 never reads as a sure thing and a 0.3 never reads as zero.
  function oddsLabel(v) {
    if (v == null) return "";
    if ((v >= 99 && v < 100) || (v > 0 && v < 1)) return (Math.floor(v * 10) / 10).toFixed(1);
    return String(Math.round(v));
  }
  function oddsBand(v) {
    if (v == null) return "none";
    if (v >= 99.5) return "in";
    if (v >= 80) return "hi";
    if (v >= 50) return "mid";
    if (v >= 20) return "low";
    if (v > 0.5) return "vlow";
    return "out";
  }

  // Playoff odds by week, with the week each team clinched (odds at 99.5 or more for the rest of the
  // season) or was knocked out (0.5 or less for the rest). Rows follow `order` (the rank grid's keys).
  function oddsGrid(playoffOdds, order) {
    const entries = Object.entries(playoffOdds || {});
    if (!entries.length) return null;
    const weeks = Math.max(...entries.map(([, w]) => w.length));
    const rows = entries.map(([key, weekly]) => {
      let result = null;
      for (let i = 0; i < weekly.length; i++) {
        if (weekly[i] != null && weekly[i] >= 99.5 && weekly.slice(i).every((v) => v != null && v >= 99.5)) {
          result = { kind: "in", week: i + 1 };
          break;
        }
        if (weekly[i] != null && weekly[i] <= 0.5 && weekly.slice(i).every((v) => v != null && v <= 0.5)) {
          result = { kind: "out", week: i + 1 };
          break;
        }
      }
      return { key, cells: Array.from({ length: weeks }, (_, i) => (weekly[i] != null ? { v: weekly[i], label: oddsLabel(weekly[i]), band: oddsBand(weekly[i]) } : null)), result };
    });
    if (order && order.length) {
      const pos = new Map(order.map((k, i) => [k, i]));
      rows.sort((a, b) => (pos.has(a.key) ? pos.get(a.key) : 999) - (pos.has(b.key) ? pos.get(b.key) : 999));
    }
    return { weeks, rows };
  }

  // ---- Standings Over Time ------------------------------------------------------------------------

  /*
    Every team's rank after each week, plus three teams picked out in color: the champion (gold) and
    runner-up (white) once the season is over, or the top two while it is played, and the team with the
    most points (blue) when it is neither, else the team that fell furthest from its best rank.
  */
  function bumpModel(standingsHistory, summary) {
    if (!standingsHistory || standingsHistory.length < 2) return null;
    const ids = standingsHistory[0].standings.map((s) => s.rosterId);
    const last = standingsHistory[standingsHistory.length - 1].standings;
    const lines = ids.map((rid) => {
      const ranks = standingsHistory.map((snap) => {
        const i = snap.standings.findIndex((s) => s.rosterId === rid);
        return i >= 0 ? i + 1 : null;
      });
      const end = last.find((s) => s.rosterId === rid) || {};
      return { rosterId: rid, name: end.username || end.teamName || "Unknown", record: recordOf(end.wins, end.losses, end.ties), ranks, final: ranks[ranks.length - 1], best: Math.min(...ranks.filter((v) => v != null)) };
    });
    const complete = summary && summary.status === "complete";
    const stories = [];
    const add = (rid, tone, note) => {
      if (rid == null || stories.some((s) => s.rosterId === rid)) return;
      const l = lines.find((x) => x.rosterId === rid);
      if (l) stories.push({ rosterId: rid, tone, note, name: l.name });
    };
    if (complete && summary.championRosterId != null) {
      add(summary.championRosterId, "gold", "champion");
      add(summary.runnerUpRosterId, "white", "runner-up");
    } else {
      const byFinal = [...lines].sort((a, b) => a.final - b.final);
      if (byFinal[0]) add(byFinal[0].rosterId, "gold", "1st");
      if (byFinal[1]) add(byFinal[1].rosterId, "white", "2nd");
    }
    const standings = (summary && summary.standings) || [];
    const topPF = [...standings].sort((a, b) => (b.fpts || 0) - (a.fpts || 0))[0];
    const ord = (n) => n + (["th", "st", "nd", "rd"][((n % 100) - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
    if (topPF && !stories.some((s) => s.rosterId === topPF.rosterId)) {
      const l = lines.find((x) => x.rosterId === topPF.rosterId);
      if (l) add(l.rosterId, "blue", `most points, ${complete ? "finished" : "now"} ${ord(l.final)}`);
    } else {
      const faller = lines.filter((l) => !stories.some((s) => s.rosterId === l.rosterId)).sort((a, b) => b.final - b.best - (a.final - a.best))[0];
      if (faller && faller.final - faller.best >= 2) add(faller.rosterId, "blue", `peaked at ${ord(faller.best)}, ${complete ? "finished" : "now"} ${ord(faller.final)}`);
    }
    return { weeks: standingsHistory.map((s) => s.week), lines, stories, teams: ids.length };
  }

  return {
    abbr,
    recordOf,
    teamGames,
    weekPoints,
    finishes,
    standingsRows,
    seasonGrid,
    bracketModel,
    legacyBracket,
    championStory,
    slotTable,
    rankBand,
    rankGrid,
    scoreCards,
    oddsLabel,
    oddsBand,
    oddsGrid,
    bumpModel,
  };
})();
