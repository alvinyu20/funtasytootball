/*
  ============================================================
  RECORD DEFINITIONS
  ============================================================
  One entry per record shown on the Records page. Titles, descriptions
  and section groupings are the league's own wording; the math behind
  each is a filter + sort over the facts RecordBook.buildFacts builds
  (see record-book.js), narrowed to whichever era the visitor picked.

  A definition is:
    id, cat, section, title, desc   — what the page shows
    fmt                             — a RecordBook.FORMATS key, or a function
    dir                             — "desc" (biggest wins, default) or "asc"
    tone                            — "low" marks a lowlight (red accent)
    compute(ctx) -> { rows, note?, headline?, status? }
        rows: [{ key | name, raw, detail?, when?, tie?, playerId? }]
        The engine sorts, ranks (ties share a rank), keeps the top 10
        and formats the value.

  Conventions worth knowing:
    - "Career" records add up every season in the era; "season" records
      pick the best single season inside it. They only look at seasons
      whose regular season is finished (a 5-week-old season can't set
      "Fewest Points in a Season").
    - Rate-style career records (win %, efficiency, ...) need at least
      three seasons in the era — or every season, if the era is shorter.
    - Records that need weekly scores/lineups skip the ESPN era (2015-19),
      which only has season totals. They are skipped, never guessed.
*/

(function () {
  const { groupBy, sum, winPct } = RecordBook.helpers;
  const FORMATS = RecordBook.FORMATS;
  const defs = [];

  function add(def) {
    defs.push(def);
  }

  // ---------- shared text helpers ----------
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const seasonsDetail = (rows) => plural(new Set(rows.map((r) => r.season)).size, "season");
  const recordText = (w, l, t) => `${w}-${l}${t ? `-${t}` : ""}`;
  const weekLabel = (r) => `${r.season} Wk ${r.week}`;
  const when = (r) => Number(r.season) * 100 + (r.week || 0);
  const minSeasonsNote = (ctx) => (ctx.minSeasons > 1 ? `Minimum ${ctx.minSeasons} seasons in the selected era.` : null);
  const nameList = (names, max) => (names.length > max ? names.slice(0, max).join(", ") + ` +${names.length - max}` : names.join(", ")) || "picks only";

  // ---------- builders ----------

  // Sum a per-season number across every season a manager played in the era.
  function careerTotal(cat, section, id, title, desc, pick, opts) {
    const o = opts || {};
    add({
      id, cat, section, title, desc,
      fmt: o.fmt || "int",
      tone: o.tone,
      dir: "desc",
      compute(ctx) {
        const rows = ctx.teamSeasons().filter((ts) => pick(ts) != null);
        const out = [];
        groupBy(rows, (r) => r.key).forEach((rs, key) => {
          const raw = sum(rs.map(pick));
          if (raw <= 0) return;
          out.push({ key, raw, detail: o.detail ? o.detail(rs) : seasonsDetail(rs) });
        });
        return { rows: out };
      },
    });
  }

  // A rate across a whole career (sum of numerators / sum of denominators),
  // limited to managers with enough seasons for the rate to mean something.
  function careerRate(cat, section, id, title, desc, num, den, opts) {
    const o = opts || {};
    add({
      id, cat, section, title, desc,
      fmt: o.fmt || "pct1",
      tone: o.tone,
      dir: o.dir || "desc",
      compute(ctx) {
        const rows = ctx.teamSeasons().filter((ts) => den(ts) != null && den(ts) > 0 && num(ts) != null);
        const out = [];
        groupBy(rows, (r) => r.key).forEach((rs, key) => {
          if (new Set(rs.map((r) => r.season)).size < ctx.minSeasons) return;
          out.push({ key, raw: sum(rs.map(num)) / sum(rs.map(den)), detail: o.detail ? o.detail(rs) : seasonsDetail(rs) });
        });
        return { rows: out, note: minSeasonsNote(ctx) };
      },
    });
  }

  // One row per manager-season (finished regular seasons only).
  function seasonRecord(cat, section, id, title, desc, pick, opts) {
    const o = opts || {};
    add({
      id, cat, section, title, desc,
      fmt: o.fmt || "int",
      tone: o.tone,
      dir: o.dir || "desc",
      compute(ctx) {
        const out = [];
        ctx.seasonLevelRows().forEach((ts) => {
          const raw = pick(ts);
          if (raw == null || !Number.isFinite(raw)) return;
          if (o.positiveOnly && raw <= 0) return;
          if (o.negativeOnly && raw >= 0) return;
          out.push({ key: ts.key, raw, detail: o.detail ? o.detail(ts) : `${ts.season} · ${recordText(ts.wins, ts.losses, ts.ties)}`, when: Number(ts.season) });
        });
        return { rows: out };
      },
    });
  }

  // ============================================================
  // CAREERS
  // ============================================================
  const record1 = (rs) => `${recordText(sum(rs.map((r) => r.wins)), sum(rs.map((r) => r.losses)), sum(rs.map((r) => r.ties)))} in ${plural(new Set(rs.map((r) => r.season)).size, "season")}`;

  // Winning
  careerTotal("careers", "Winning", "career-wins", "Career Wins", "The league's winningest managers across the selected era.", (ts) => ts.wins, { detail: record1 });
  careerTotal("careers", "Winning", "career-losses", "Career Losses", "The most regular-season losses across the selected era.", (ts) => ts.losses, { tone: "low", detail: record1 });
  careerRate("careers", "Winning", "best-win-pct", "Best Win Percentage", "Regular-season record, with a three-season minimum.",
    (ts) => ts.wins + 0.5 * ts.ties, (ts) => ts.games, { detail: record1 });
  careerTotal("careers", "Winning", "career-allplay-wins", "Career All-Play Wins", "Every weekly score compared with every other team in the league.", (ts) => (ts.allPlay ? ts.allPlay.w : null));
  careerTotal("careers", "Winning", "career-allplay-losses", "Career All-Play Losses", "The most weekly head-to-head comparisons lost to the field.", (ts) => (ts.allPlay ? ts.allPlay.l : null), { tone: "low" });
  careerRate("careers", "Winning", "best-vs-median", "Best Record vs the Median", "Who won most often after removing the weekly schedule draw.",
    (ts) => (ts.median ? ts.median.w + 0.5 * ts.median.t : null), (ts) => (ts.median ? ts.median.w + ts.median.l + ts.median.t : null));
  careerRate("careers", "Winning", "best-allplay-record", "Best All-Play Record", "Every score compared with every other team that week.",
    (ts) => (ts.allPlay ? ts.allPlay.w + 0.5 * ts.allPlay.t : null), (ts) => (ts.allPlay ? ts.allPlay.w + ts.allPlay.l + ts.allPlay.t : null));
  careerTotal("careers", "Winning", "blowout-wins", "Blowout Wins", "Regular-season victories by 30 points or more", (ts) => ts.blowoutWins);
  careerTotal("careers", "Winning", "narrow-wins", "Narrow Wins", "Regular-season victories by five points or fewer", (ts) => ts.narrowWins);

  // Scoring
  careerTotal("careers", "Scoring", "career-points", "Career Points", "Regular-season points scored in the league's own scoring system.", (ts) => ts.pf, { fmt: "dec1" });
  careerTotal("careers", "Scoring", "high-score-weeks", "High-Score Weeks", "Weeks finished as the league's scoring leader, including tied leaders.", (ts) => ts.highWeeks);
  careerRate("careers", "Scoring", "top-half-consistency", "Top-Half Consistency", "The highest share of weeks finished in the league's top half.",
    (ts) => ts.topHalfWeeks, (ts) => ts.weeks);

  // Playoffs
  careerTotal("careers", "Playoffs", "playoff-wins", "Playoff Wins", "Winners-bracket games only; consolation games are excluded.", (ts) => ts.playoffWins);
  careerTotal("careers", "Playoffs", "playoff-losses", "Playoff Losses", "Losses in the winners bracket, including championship games.", (ts) => ts.playoffLosses, { tone: "low" });
  careerTotal("careers", "Playoffs", "playoff-points", "Playoff Points", "Career scoring in the winners bracket.", (ts) => ts.playoffPoints, { fmt: "int" });

  // Hardware
  careerTotal("careers", "Hardware", "championships", "Championships", "The ultimate hardware count.", (ts) => (ts.isChampion ? 1 : 0));
  careerTotal("careers", "Hardware", "championship-appearances", "Championship Appearances", "Titles plus runner-up finishes.", (ts) => (ts.isChampion || ts.isRunnerUp ? 1 : 0));
  careerTotal("careers", "Hardware", "playoff-appearances", "Playoff Appearances", "Seasons reaching the winners bracket.", (ts) => (ts.playoffApp ? 1 : 0));
  careerTotal("careers", "Hardware", "regular-season-titles", "Regular-Season Titles",
    "Best regular-season win percentage; points scored break ties. Exact ties share the title.", (ts) => (ts.titles.regular ? 1 : 0));
  careerTotal("careers", "Hardware", "points-titles", "Points Titles", "Most regular-season points in a season.", (ts) => (ts.titles.points ? 1 : 0));
  careerTotal("careers", "Hardware", "allplay-titles", "All-Play Titles",
    "Best all-play win percentage, with ties worth a half win. Equal leaders share the title.", (ts) => (ts.allPlay ? (ts.titles.allPlay ? 1 : 0) : null));

  // Luck & Schedule
  function luckCareer(id, title, desc, dir) {
    add({
      id, cat: "careers", section: "Luck & Schedule", title, desc, fmt: "wins", dir, tone: dir === "asc" ? "low" : undefined,
      compute(ctx) {
        const out = [];
        groupBy(ctx.teamSeasons().filter((ts) => ts.luckWins != null), (r) => r.key).forEach((rs, key) => {
          const raw = sum(rs.map((r) => r.luckWins));
          if (dir === "desc" ? raw <= 0 : raw >= 0) return;
          out.push({ key, raw, detail: seasonsDetail(rs) });
        });
        return { rows: out, note: "Luck = actual wins minus the wins a team's weekly scores would normally earn (its all-play win rate times its games)." };
      },
    });
  }
  luckCareer("luckiest-career", "Luckiest Career", "The most wins gained from the weekly schedule draw.", "desc");
  luckCareer("unluckiest-career", "Unluckiest Career", "The most wins lost to the weekly schedule draw.", "asc");

  function scheduleCareer(id, title, desc, dir) {
    add({
      id, cat: "careers", section: "Luck & Schedule", title, desc, fmt: "dec1", dir, tone: dir === "asc" ? "low" : undefined,
      compute(ctx) {
        const out = [];
        groupBy(ctx.teamSeasons().filter((ts) => ts.scheduleIndex != null), (r) => r.key).forEach((rs, key) => {
          if (new Set(rs.map((r) => r.season)).size < ctx.minSeasons) return;
          const games = sum(rs.map((r) => r.oppGames));
          out.push({ key, raw: sum(rs.map((r) => r.scheduleIndex * r.oppGames)) / games, detail: seasonsDetail(rs) });
        });
        return { rows: out, note: [minSeasonsNote(ctx), "100 = a league-average schedule."].filter(Boolean).join(" ") };
      },
    });
  }
  scheduleCareer("hardest-career-schedule", "Hardest Career Schedule", "The strongest opponent scoring across a manager's career.", "desc");
  scheduleCareer("easiest-career-schedule", "Easiest Career Schedule", "The lightest opponent scoring across a manager's career.", "asc");

  // ============================================================
  // SEASONS
  // ============================================================
  const S = "seasons";
  seasonRecord(S, "Best Seasons", "most-wins-season", "Most Wins in a Season", "The strongest regular-season records in league history.", (ts) => ts.wins, { positiveOnly: true });
  seasonRecord(S, "Best Seasons", "best-season-win-pct", "Best Season Win Percentage", "Equivalent wins divided by games.", (ts) => winPct(ts.wins, ts.losses, ts.ties), { fmt: "pct1" });
  seasonRecord(S, "Best Seasons", "most-points-season", "Most Points in a Season", "Regular-season points in the league's scoring system.", (ts) => ts.pf, { fmt: "dec1", positiveOnly: true });
  seasonRecord(S, "Best Seasons", "best-season-vs-median", "Best Season vs the Median", "Schedule-free weekly performance.",
    (ts) => (ts.median ? winPct(ts.median.w, ts.median.l, ts.median.t) : null), { fmt: "pct1" });
  seasonRecord(S, "Best Seasons", "best-allplay-season", "Best All-Play Season", "Every week played against the entire league.",
    (ts) => (ts.allPlay ? winPct(ts.allPlay.w, ts.allPlay.l, ts.allPlay.t) : null), { fmt: "pct1" });
  seasonRecord(S, "Best Seasons", "most-allplay-wins-season", "Most All-Play Wins in a Season", "The most weekly head-to-head comparisons won against the field.",
    (ts) => (ts.allPlay ? ts.allPlay.w : null), { positiveOnly: true });
  seasonRecord(S, "Best Seasons", "best-point-differential", "Best Point Differential", "Average scoring margin across the regular season.",
    (ts) => (ts.games ? (ts.pf - ts.pa) / ts.games : null), { fmt: "signed1" });
  seasonRecord(S, "Best Seasons", "most-high-score-weeks-season", "Most High-Score Weeks", "League-leading scoring weeks in one season.", (ts) => ts.highWeeks, { positiveOnly: true });
  seasonRecord(S, "Best Seasons", "most-consistent-season", "Most Consistent Season", "Highest share of sampled weeks in the league's top half.",
    (ts) => (ts.weeks ? ts.topHalfWeeks / ts.weeks : null), { fmt: "pct1" });

  seasonRecord(S, "Lowlights", "most-allplay-losses-season", "Most All-Play Losses in a Season", "The most weekly head-to-head comparisons lost to the field.",
    (ts) => (ts.allPlay ? ts.allPlay.l : null), { tone: "low", positiveOnly: true });
  seasonRecord(S, "Lowlights", "most-losses-season", "Most Losses in a Season", "The roughest regular-season records.", (ts) => ts.losses, { tone: "low", positiveOnly: true });
  seasonRecord(S, "Lowlights", "fewest-points-season", "Fewest Points in a Season", "Lowest full-season scoring totals.", (ts) => (ts.pf > 0 ? ts.pf : null), { tone: "low", dir: "asc", fmt: "dec1" });
  seasonRecord(S, "Lowlights", "most-blowout-losses", "Most Blowout Losses", "Losses by 30 points or more in one season.", (ts) => ts.blowoutLosses, { tone: "low", positiveOnly: true });

  seasonRecord(S, "Luck & Schedule", "luckiest-season", "Luckiest Season", "The schedule added the most wins relative to weekly performance.", (ts) => ts.luckWins, { fmt: "wins", positiveOnly: true });
  seasonRecord(S, "Luck & Schedule", "unluckiest-season", "Unluckiest Season", "The schedule cost the most wins relative to weekly performance.", (ts) => ts.luckWins, { fmt: "wins", dir: "asc", tone: "low", negativeOnly: true });
  seasonRecord(S, "Luck & Schedule", "toughest-schedule", "Toughest Schedule", "Opponent scoring indexed to that season's league average.", (ts) => ts.scheduleIndex, { fmt: "dec1" });
  seasonRecord(S, "Luck & Schedule", "easiest-schedule", "Easiest Schedule", "The lowest opponent scoring relative to the league that season.", (ts) => ts.scheduleIndex, { fmt: "dec1", dir: "asc", tone: "low" });

  // ============================================================
  // MATCHUPS
  // ============================================================
  const M = "matchups";
  const playedGames = (ctx) => ctx.games().filter((g) => g.aPts > 0 && g.bPts > 0);
  const gameLabel = (g) => weekLabel(g) + (g.isPlayoff ? " (playoffs)" : "");

  function teamScore(id, title, desc, dir, tone) {
    add({
      id, cat: M, section: "Scoring", title, desc, fmt: "dec1", dir, tone,
      compute(ctx) {
        return {
          rows: ctx.weekTeams().filter((r) => r.points > 0 && r.oppPoints > 0).map((r) => ({
            key: r.key, raw: r.points, when: when(r),
            detail: `vs ${ctx.name(r.oppKey)} · ${r.isPlayoff ? weekLabel(r) + " (playoffs)" : weekLabel(r)}`,
          })),
        };
      },
    });
  }
  teamScore("highest-team-score", "Highest Team Score", "The biggest single-week eruption in the archive.", "desc");
  teamScore("lowest-team-score", "Lowest Team Score", "The weeks everyone would rather redact.", "asc", "low");

  function combined(id, title, desc, dir, tone) {
    add({
      id, cat: M, section: "Scoring", title, desc, fmt: "dec1", dir, tone,
      compute(ctx) {
        return {
          rows: playedGames(ctx).map((g) => ({
            name: `${ctx.name(g.aKey)} vs ${ctx.name(g.bKey)}`, raw: g.aPts + g.bPts, when: when(g),
            detail: `${g.aPts.toFixed(1)}–${g.bPts.toFixed(1)} · ${gameLabel(g)}`,
          })),
        };
      },
    });
  }
  combined("highest-combined-score", "Highest Combined Score", "Two teams turning one matchup into a track meet.", "desc");
  combined("lowest-combined-score", "Lowest Combined Score", "The least offensive games on record.", "asc", "low");

  // A game as {winner, loser, margin}; ties have no winner.
  function decided(ctx) {
    const out = [];
    playedGames(ctx).forEach((g) => {
      if (g.aPts === g.bPts) return;
      const aWon = g.aPts > g.bPts;
      out.push({
        season: g.season, week: g.week, isPlayoff: g.isPlayoff,
        winnerKey: aWon ? g.aKey : g.bKey, loserKey: aWon ? g.bKey : g.aKey,
        winnerPts: Math.max(g.aPts, g.bPts), loserPts: Math.min(g.aPts, g.bPts),
        margin: Math.abs(g.aPts - g.bPts),
      });
    });
    return out;
  }
  const decidedDetail = (ctx, d) => `${ctx.name(d.winnerKey)} ${d.winnerPts.toFixed(1)}, ${ctx.name(d.loserKey)} ${d.loserPts.toFixed(1)} · ${gameLabel(d)}`;

  add({
    id: "biggest-blowout", cat: M, section: "Margins & Drama", title: "Biggest Blowout", desc: "The widest winning margins in league history.", fmt: "signed1", dir: "desc",
    compute: (ctx) => ({ rows: decided(ctx).map((d) => ({ key: d.winnerKey, raw: d.margin, when: when(d), detail: decidedDetail(ctx, d) })) }),
  });
  add({
    id: "narrowest-win", cat: M, section: "Margins & Drama", title: "Narrowest Win", desc: "The finishes decided by almost nothing.", fmt: "signed2", dir: "asc",
    compute: (ctx) => ({ rows: decided(ctx).map((d) => ({ key: d.winnerKey, raw: d.margin, when: when(d), detail: decidedDetail(ctx, d) })) }),
  });
  add({
    id: "highest-score-in-loss", cat: M, section: "Margins & Drama", title: "Highest Score in a Loss", desc: "A great week ruined by the one opponent who did better.", fmt: "dec1", dir: "desc", tone: "low",
    compute: (ctx) => ({ rows: decided(ctx).map((d) => ({ key: d.loserKey, raw: d.loserPts, when: when(d), detail: `lost to ${ctx.name(d.winnerKey)} ${d.winnerPts.toFixed(1)} · ${gameLabel(d)}` })) }),
  });
  add({
    id: "lowest-score-in-win", cat: M, section: "Margins & Drama", title: "Lowest Score in a Win", desc: "The wins that got away with it.", fmt: "dec1", dir: "asc",
    compute: (ctx) => ({ rows: decided(ctx).map((d) => ({ key: d.winnerKey, raw: d.winnerPts, when: when(d), detail: `beat ${ctx.name(d.loserKey)} ${d.loserPts.toFixed(1)} · ${gameLabel(d)}` })) }),
  });
  add({
    id: "largest-share", cat: M, section: "Margins & Drama", title: "Largest Share of the Game", desc: "The most one-sided share of a matchup's combined scoring.", fmt: "pct1", dir: "desc",
    compute: (ctx) => ({ rows: decided(ctx).map((d) => ({ key: d.winnerKey, raw: d.winnerPts / (d.winnerPts + d.loserPts), when: when(d), detail: decidedDetail(ctx, d) })) }),
  });

  // ============================================================
  // PLAYERS & LINEUPS
  // ============================================================
  const P = "players";

  add({
    id: "best-player-game", cat: P, section: "Player Performances", title: "Best Player Game", desc: "The highest fantasy score by one player in one week.", fmt: "dec1", dir: "desc",
    compute: (ctx) => ({
      rows: ctx.playerRows().map((r) => ({
        name: ctx.playerName(r.pid), playerId: r.pid, raw: r.points, when: when(r),
        detail: `for ${ctx.name(r.key)} · ${weekLabel(r)}${r.started ? "" : " (on the bench)"}`,
      })),
    }),
  });

  add({
    id: "best-player-season", cat: P, section: "Player Performances", title: "Best Player Season", desc: "Fantasy production while the player appeared in this league's weekly roster archive.", fmt: "dec1", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.playerRows(), (r) => `${r.pid}|${r.season}`).forEach((rs, k) => {
        const [pid, season] = k.split("|");
        const owners = new Map();
        rs.forEach((r) => owners.set(r.key, (owners.get(r.key) || 0) + 1));
        const topOwner = [...owners.entries()].sort((a, b) => b[1] - a[1])[0][0];
        out.push({ name: ctx.playerName(pid), playerId: pid, raw: sum(rs.map((r) => r.points)), when: Number(season) * 100, detail: `${season} · ${plural(rs.length, "week")} rostered, mostly by ${ctx.name(topOwner)}` });
      });
      return { rows: out };
    },
  });

  add({
    id: "most-career-player-points", cat: P, section: "Player Performances", title: "Most Career Player Points", desc: "Total fantasy production captured in the league archive.", fmt: "dec1", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.playerRows(), (r) => r.pid).forEach((rs, pid) => {
        out.push({ name: ctx.playerName(pid), playerId: pid, raw: sum(rs.map((r) => r.points)), detail: `${plural(rs.length, "week")} rostered` });
      });
      return { rows: out };
    },
  });

  add({
    id: "league-workhorses", cat: P, section: "Player Performances", title: "League Workhorses", desc: "The players with the most starts in league history.", fmt: "int", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.playerRows().filter((r) => r.started), (r) => r.pid).forEach((rs, pid) => {
        out.push({ name: ctx.playerName(pid), playerId: pid, raw: rs.length, detail: `${sum(rs.map((r) => r.points)).toFixed(1)} points as a starter` });
      });
      return { rows: out };
    },
  });

  add({
    id: "franchise-players", cat: P, section: "Player Performances", title: "Franchise Players", desc: "Most started points delivered by one player to one manager.", fmt: "dec1", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.playerRows().filter((r) => r.started), (r) => `${r.pid}|${r.key}`).forEach((rs, k) => {
        const [pid, key] = k.split("|");
        out.push({ name: ctx.playerName(pid), playerId: pid, raw: sum(rs.map((r) => r.points)), detail: `for ${ctx.name(key)} · ${plural(rs.length, "start")}` });
      });
      return { rows: out };
    },
  });

  add({
    id: "career-position-crown", cat: P, section: "Position Crowns", title: "Career Position Crown", desc: "Who consistently beat the league at each position.", fmt: "signed1", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.positionCrowns(), (r) => `${r.key}|${r.pos}`).forEach((rs, k) => {
        const [key, pos] = k.split("|");
        out.push({ key, raw: sum(rs.map((r) => r.value)), detail: `${pos} · ${plural(rs.length, "season")}` });
      });
      return { rows: out.filter((e) => e.raw > 0), note: "Points scored by a manager's starters at a position, above the league-average team at that position, week by week (regular season)." };
    },
  });
  add({
    id: "best-position-season", cat: P, section: "Position Crowns", title: "Best Position Season", desc: "The strongest manager-position seasons relative to their weekly peers.", fmt: "signed1", dir: "desc",
    compute: (ctx) => ({
      rows: ctx.positionCrowns().filter((r) => r.value > 0).map((r) => ({ key: r.key, raw: r.value, when: Number(r.season), detail: `${r.pos} · ${r.season}` })),
      note: "Points scored by a manager's starters at a position, above the league-average team at that position, week by week (regular season).",
    }),
  });

  // Lineup management
  const LM = "Lineup Management";
  const lineupSeasons = (rs) => plural(rs.length, "season");
  careerRate(P, LM, "lineup-efficiency", "Lineup Efficiency", "Who captured the greatest share of their legal optimal lineup.",
    (ts) => (ts.lineup ? ts.lineup.actual : null), (ts) => (ts.lineup ? ts.lineup.optimal : null), { detail: lineupSeasons });
  careerRate(P, LM, "perfect-lineup-rate", "Perfect-Lineup Rate", "How often a manager started the best legal lineup available.",
    (ts) => (ts.lineup ? ts.lineup.perfect : null), (ts) => (ts.lineup ? ts.lineup.weeks : null), { detail: lineupSeasons });
  careerRate(P, LM, "best-bench-discipline", "Best Bench Discipline", "Fewest optimal points left unused per lineup week.",
    (ts) => (ts.lineup ? ts.lineup.bench : null), (ts) => (ts.lineup ? ts.lineup.weeks : null), { fmt: "dec1", dir: "asc", detail: lineupSeasons });
  add({
    id: "most-points-left-on-bench", cat: P, section: LM, title: "Most Points Left on the Bench", desc: "The single costliest lineup week in the archive.", fmt: "dec1", dir: "desc", tone: "low",
    compute: (ctx) => ({
      rows: ctx.weekTeams().filter((r) => r.benchLeft != null && r.benchLeft > 0).map((r) => ({
        key: r.key, raw: r.benchLeft, when: when(r), detail: `scored ${r.points.toFixed(1)} of a possible ${r.optimal.toFixed(1)} · ${weekLabel(r)}`,
      })),
    }),
  });
  add({
    id: "highest-optimal-lineup", cat: P, section: LM, title: "Highest Optimal Lineup", desc: "The greatest legal lineup a roster could have produced in one week.", fmt: "dec1", dir: "desc",
    compute: (ctx) => ({
      rows: ctx.weekTeams().filter((r) => r.optimal != null).map((r) => ({
        key: r.key, raw: r.optimal, when: when(r), detail: `actually scored ${r.points.toFixed(1)} · ${weekLabel(r)}`,
      })),
    }),
  });

  // Team raw stats — fed by data/team-raw-stats.json (scripts/build-team-raw-stats.js).
  const RAW_DESC = "Raw production from submitted starting lineups.";
  const RAW_PENDING = "Waiting on data — run the “Build Team Raw Stats” workflow once (GitHub → Actions → Run workflow) and this fills in.";
  const RAW_NOTE = "Regular-season starting lineups only.";
  RecordBook.RAW_STATS.forEach((stat) => {
    add({
      id: `raw-career-${stat.key}`, cat: P, section: "Team Raw Stats · Careers", title: `Career ${stat.label}`, desc: RAW_DESC, fmt: "int", dir: "desc", tone: stat.tone,
      compute(ctx) {
        if (!ctx.facts.rawStatsAvailable) return { status: "pending", note: RAW_PENDING };
        const out = [];
        groupBy(ctx.rawRows(), (r) => r.key).forEach((rs, key) => {
          const raw = sum(rs.map((r) => r.vals[stat.key]));
          if (raw > 0) out.push({ key, raw, detail: seasonsDetail(rs) });
        });
        return { rows: out, note: RAW_NOTE };
      },
    });
  });
  RecordBook.RAW_STATS.forEach((stat) => {
    add({
      id: `raw-season-${stat.key}`, cat: P, section: "Team Raw Stats · Seasons", title: `Most ${stat.label} in a Season`, desc: RAW_DESC, fmt: "int", dir: "desc", tone: stat.tone,
      compute(ctx) {
        if (!ctx.facts.rawStatsAvailable) return { status: "pending", note: RAW_PENDING };
        const out = [];
        groupBy(ctx.rawRows(), (r) => `${r.key}|${r.season}`).forEach((rs, k) => {
          const [key, season] = k.split("|");
          const raw = sum(rs.map((r) => r.vals[stat.key]));
          if (raw > 0) out.push({ key, raw, when: Number(season), detail: `${season} · ${plural(rs.length, "week")}` });
        });
        return { rows: out, note: RAW_NOTE };
      },
    });
  });
  RecordBook.RAW_STATS.forEach((stat) => {
    add({
      id: `raw-week-${stat.key}`, cat: P, section: "Team Raw Stats · Weeks", title: `Most ${stat.label} in a Week`, desc: RAW_DESC, fmt: "int", dir: "desc", tone: stat.tone,
      compute(ctx) {
        if (!ctx.facts.rawStatsAvailable) return { status: "pending", note: RAW_PENDING };
        return {
          rows: ctx.rawRows().filter((r) => r.vals[stat.key] > 0).map((r) => ({ key: r.key, raw: r.vals[stat.key], when: when(r), detail: weekLabel(r) })),
          note: RAW_NOTE,
        };
      },
    });
  });

  // ============================================================
  // STREAKS & MILESTONES
  // ============================================================
  const ST = "streaks";

  // Longest unbroken run of rows satisfying `pred`, rows already in order.
  function longestRun(rows, pred) {
    let best = null;
    let cur = null;
    rows.forEach((r) => {
      if (pred(r)) {
        if (!cur) cur = { start: r, end: r, length: 0 };
        cur.length += 1;
        cur.end = r;
        if (!best || cur.length > best.length) best = { start: cur.start, end: cur.end, length: cur.length };
      } else {
        cur = null;
      }
    });
    return best;
  }
  const byTime = (a, b) => Number(a.season) - Number(b.season) || (a.week || 0) - (b.week || 0);

  function weeklyRange(ctx, run) {
    const a = run.start;
    const b = run.end;
    const label = a.season === b.season ? (a.week === b.week ? `${a.season} Wk ${a.week}` : `${a.season} Wk ${a.week}–${b.week}`) : `${a.season} Wk ${a.week} – ${b.season} Wk ${b.week}`;
    const latest = ctx.facts.latest;
    const active = latest && b.season === latest.season && b.week === latest.week && !ctx.facts.seasons.find((s) => s.season === b.season).complete;
    return label + (active ? " · active" : "");
  }

  function weeklyStreak(id, section, title, desc, pred, opts) {
    const o = opts || {};
    add({
      id, cat: ST, section, title, desc, fmt: "int", dir: "desc", tone: o.tone,
      compute(ctx) {
        const out = [];
        groupBy(ctx.regularWeekTeams(), (r) => r.key).forEach((rs, key) => {
          const run = longestRun([...rs].sort(byTime), pred);
          if (run && run.length > 0) out.push({ key, raw: run.length, when: when(run.start), detail: `${plural(run.length, "week")} · ${weeklyRange(ctx, run)}` });
        });
        return { rows: out, note: "Streaks run across seasons within the selected era." };
      },
    });
  }
  weeklyStreak("longest-win-streak", "Weekly Streaks", "Longest Win Streak", "Consecutive regular-season victories.", (r) => r.result === "W");
  weeklyStreak("longest-losing-skid", "Weekly Streaks", "Longest Losing Skid", "Consecutive regular-season losses.", (r) => r.result === "L", { tone: "low" });
  weeklyStreak("high-score-streak", "Weekly Streaks", "High-Score Streak", "Consecutive weeks as the league's top scorer.", (r) => r.isHigh);
  weeklyStreak("top-three-streak", "Weekly Streaks", "Top-Three Streak", "Consecutive weeks finishing among the top three scores.", (r) => r.isTop3);
  weeklyStreak("top-half-streak", "Weekly Streaks", "Top-Half Streak", "Consecutive weeks above the league's halfway line.", (r) => r.isTopHalf);
  weeklyStreak("high-score-drought", "Droughts", "High-Score Drought", "Longest run without leading the league in weekly scoring.", (r) => !r.isHigh, { tone: "low" });
  weeklyStreak("top-half-drought", "Droughts", "Top-Half Drought", "Longest run without a top-half weekly finish.", (r) => !r.isTopHalf, { tone: "low" });

  function seasonStreak(id, section, title, desc, pred, opts) {
    const o = opts || {};
    add({
      id, cat: ST, section, title, desc, fmt: "int", dir: "desc", tone: o.tone,
      compute(ctx) {
        // Only seasons whose playoffs are over — an unfinished season can't
        // yet say whether a title or playoff trip happened.
        const rows = ctx.teamSeasons().filter((ts) => ts.complete);
        const lastComplete = [...ctx.facts.seasons].filter((s) => s.complete).pop();
        const out = [];
        groupBy(rows, (r) => r.key).forEach((rs, key) => {
          const run = longestRun([...rs].sort(byTime), pred);
          if (!run) return;
          const range = run.start.season === run.end.season ? run.start.season : `${run.start.season}–${run.end.season}`;
          const active = lastComplete && run.end.season === lastComplete.season;
          out.push({ key, raw: run.length, when: Number(run.start.season), detail: `${plural(run.length, "season")} · ${range}${active ? " · active" : ""}` });
        });
        return { rows: out };
      },
    });
  }
  seasonStreak("playoff-drought", "Droughts", "Playoff Drought", "Consecutive managed seasons missing the winners bracket.", (ts) => !ts.playoffApp, { tone: "low" });
  seasonStreak("championship-drought", "Droughts", "Championship Drought", "Consecutive managed seasons without a title.", (ts) => !ts.isChampion, { tone: "low" });
  seasonStreak("winning-season-streak", "Season Streaks", "Winning-Season Streak", "Consecutive managed seasons above .500.", (ts) => (winPct(ts.wins, ts.losses, ts.ties) || 0) > 0.5);
  seasonStreak("playoff-appearance-streak", "Season Streaks", "Playoff Appearance Streak", "Consecutive managed seasons reaching the winners bracket.", (ts) => ts.playoffApp);
  seasonStreak("championship-appearance-streak", "Season Streaks", "Championship Appearance Streak", "Consecutive trips to the title game.", (ts) => ts.isChampion || ts.isRunnerUp);
  seasonStreak("championship-streak", "Season Streaks", "Championship Streak", "Consecutive league titles.", (ts) => ts.isChampion);

  // Milestone wall: who was FIRST to cross each rung of a career ladder.
  // The row shows the current leader's total; expanding it shows the ladder.
  function milestone(id, title, desc, rungs, unit, eventsFor) {
    add({
      id, cat: ST, section: "Milestone Wall", title, desc, fmt: (n) => `${FORMATS.int(n)} ${unit}`, dir: "desc",
      compute(ctx) {
        const events = eventsFor(ctx); // [{key, season, week|null, amount}]
        events.sort(byTime);
        const totals = new Map();
        const firstTo = new Map(); // rung -> {key, season, week}
        events.forEach((e) => {
          const before = totals.get(e.key) || 0;
          const after = before + e.amount;
          totals.set(e.key, after);
          rungs.forEach((rung) => {
            if (before < rung && after >= rung && !firstTo.has(rung)) firstTo.set(rung, { key: e.key, season: e.season, week: e.week });
          });
        });
        if (!totals.size) return { rows: [] };
        const leader = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
        const rows = [];
        rungs.forEach((rung) => {
          const hit = firstTo.get(rung);
          if (!hit) return;
          const at = hit.week != null ? `${hit.season} Wk ${hit.week}` : `${hit.season} season`;
          rows.push({ key: hit.key, raw: rung, detail: `first to reach it · ${at}` });
        });
        const unitLabel = unit === "pts" ? "career points" : unit === "wins" ? "career wins" : "career weeks";
        return {
          rows,
          headline: { key: leader[0], valueText: `${unit === "pts" ? FORMATS.int(leader[1]) : FORMATS.int(leader[1])}`, detail: `current leader · ${unitLabel}` },
          note: "Each row is a rung of the ladder and who got there first.",
        };
      },
    });
  }
  const winEvents = (ctx) => {
    const ev = [];
    ctx.teamSeasons().filter((ts) => ts.source === "espn").forEach((ts) => ev.push({ key: ts.key, season: ts.season, week: null, amount: ts.wins }));
    ctx.regularWeekTeams().filter((r) => r.result === "W").forEach((r) => ev.push({ key: r.key, season: r.season, week: r.week, amount: 1 }));
    return ev;
  };
  const pointEvents = (ctx) => {
    const ev = [];
    ctx.teamSeasons().filter((ts) => ts.source === "espn").forEach((ts) => ev.push({ key: ts.key, season: ts.season, week: null, amount: ts.pf }));
    ctx.regularWeekTeams().forEach((r) => ev.push({ key: r.key, season: r.season, week: r.week, amount: r.points }));
    return ev;
  };
  const highEvents = (ctx) => ctx.regularWeekTeams().filter((r) => r.isHigh).map((r) => ({ key: r.key, season: r.season, week: r.week, amount: 1 }));
  milestone("win-milestones", "Win Milestones", "The career-win ladder.", [10, 25, 50, 75, 100, 125, 150, 200], "wins", winEvents);
  milestone("points-milestones", "Points Milestones", "The league's great scoring plateaus.", [1000, 2500, 5000, 7500, 10000, 12500, 15000, 20000, 25000], "pts", pointEvents);
  milestone("high-score-milestones", "High-Score Milestones", "Career weeks atop the scoreboard.", [3, 5, 10, 15, 20, 25, 30], "weeks", highEvents);

  // ============================================================
  // FRONT OFFICE
  // ============================================================
  const FO = "front-office";

  // Activity
  add({
    id: "most-trades", cat: FO, section: "Activity", title: "Most Trades", desc: "Career completed trades in the selected era.", fmt: "int", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.moveCounts(), (r) => r.key).forEach((rs, key) => {
        const raw = sum(rs.map((r) => r.trades));
        if (raw > 0) out.push({ key, raw, detail: seasonsDetail(rs) });
      });
      return { rows: out };
    },
  });
  add({
    id: "most-roster-moves", cat: FO, section: "Activity", title: "Most Roster Moves", desc: "Adds, drops, waivers, and trades.", fmt: "int", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.moveCounts(), (r) => r.key).forEach((rs, key) => {
        const trades = sum(rs.map((r) => r.trades));
        const adds = sum(rs.map((r) => r.adds));
        const drops = sum(rs.map((r) => r.drops));
        const raw = trades + adds + drops;
        if (raw > 0) out.push({ key, raw, detail: `${adds} adds · ${drops} drops · ${trades} trades` });
      });
      return { rows: out, note: "Every player added, every player dropped, and every trade counts as one move." };
    },
  });

  // Trades
  const TRADE_NOTE = "Judged in hindsight: points the traded players scored in starting lineups (above replacement level) over the rest of that regular season. Picks and FAAB aren't valued.";
  add({
    id: "frequent-trade-partners", cat: FO, section: "Trades", title: "Most Frequent Trade Partners", desc: "The pairs who kept finding reasons to make a deal.", fmt: "int", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.tradePairs(), (r) => [...r.keys].sort().join("|")).forEach((rs, k) => {
        const [a, b] = k.split("|");
        out.push({ name: `${ctx.name(a)} & ${ctx.name(b)}`, raw: rs.length, detail: `${plural(rs.length, "trade")} together` });
      });
      return { rows: out.filter((e) => e.raw > 0) };
    },
  });
  add({
    id: "career-trade-value", cat: FO, section: "Trades", title: "Career Trade Value", desc: "Net useful points a week across a manager's scored trades.", fmt: "perWeek", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.tradeSides(), (r) => r.key).forEach((rs, key) => {
        if (rs.length < 2) return;
        out.push({ key, raw: sum(rs.map((r) => r.perWeek)) / rs.length, detail: `average across ${plural(rs.length, "scored trade")}` });
      });
      return { rows: out.filter((e) => e.raw > 0), note: `${TRADE_NOTE} Needs at least two scored trades.` };
    },
  });
  const tradeDetail = (r) => `${weekLabel(r)} · got ${nameList(r.received, 3)}, sent ${nameList(r.sent, 3)}`;
  add({
    id: "biggest-trade-heist", cat: FO, section: "Trades", title: "Biggest Trade Heist", desc: "One side of one deal, in useful points a week, settled by everything that happened after.", fmt: "perWeek", dir: "desc",
    compute: (ctx) => ({ rows: ctx.tradeSides().filter((r) => r.perWeek > 0).map((r) => ({ key: r.key, raw: r.perWeek, when: when(r), detail: tradeDetail(r) })), note: TRADE_NOTE }),
  });
  add({
    id: "costliest-trade-side", cat: FO, section: "Trades", title: "Costliest Trade Side", desc: "The deals whose receipts aged the worst, in useful points a week.", fmt: "perWeek", dir: "asc", tone: "low",
    compute: (ctx) => ({ rows: ctx.tradeSides().filter((r) => r.perWeek < 0).map((r) => ({ key: r.key, raw: r.perWeek, when: when(r), detail: tradeDetail(r) })), note: TRADE_NOTE }),
  });

  // Waivers & FAAB
  const WIRE_NOTE = "Realized value = points a player scored in the claiming manager's starting lineup after the claim, minus what a replacement-level player at that position would have scored.";
  const pickupDetail = (r) => `${r.player} · ${weekLabel(r)}${r.bid != null ? ` · $${r.bid}` : ""}`;
  add({
    id: "career-waiver-value", cat: FO, section: "Waivers & FAAB", title: "Career Waiver Value", desc: "Managers who created the most realized lineup value on the wire.", fmt: "signed1", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.pickups(), (r) => r.key).forEach((rs, key) => out.push({ key, raw: sum(rs.map((r) => r.value)), detail: `${plural(rs.length, "pickup")}` }));
      return { rows: out, note: WIRE_NOTE };
    },
  });
  add({
    id: "greatest-pickup", cat: FO, section: "Waivers & FAAB", title: "Greatest Pickup", desc: "The waiver claim that returned the most realized lineup value.", fmt: "signed1", dir: "desc",
    compute: (ctx) => ({ rows: ctx.pickups().filter((r) => r.value > 0).map((r) => ({ key: r.key, raw: r.value, when: when(r), detail: pickupDetail(r) })), note: WIRE_NOTE }),
  });
  add({
    id: "ones-that-got-away", cat: FO, section: "Waivers & FAAB", title: "The Ones That Got Away", desc: "Drops and swaps that kept producing somewhere else.", fmt: (n) => FORMATS.signed1(-n), dir: "desc", tone: "low",
    compute: (ctx) => ({
      rows: ctx.drops().map((r) => ({ key: r.key, raw: r.lost, when: when(r), detail: `dropped ${r.player} · ${weekLabel(r)} · started elsewhere ${plural(r.startedWeeks, "week")}` })),
      note: "Realized value the dropped player went on to produce in other managers' starting lineups (above replacement level).",
    }),
  });
  add({
    id: "highest-faab-bid", cat: FO, section: "Waivers & FAAB", title: "Highest FAAB Bid", desc: "The largest successful paid claims in the transaction archive.", fmt: "usd", dir: "desc",
    compute: (ctx) => ({ rows: ctx.pickups().filter((r) => r.bid > 0).map((r) => ({ key: r.key, raw: r.bid, when: when(r), detail: `${r.player} · ${weekLabel(r)}` })) }),
  });
  add({
    id: "best-faab-acquisition", cat: FO, section: "Waivers & FAAB", title: "Best FAAB Acquisition", desc: "The paid pickup that returned the most realized lineup value.", fmt: "signed1", dir: "desc",
    compute: (ctx) => ({ rows: ctx.pickups().filter((r) => r.bid > 0 && r.value > 0).map((r) => ({ key: r.key, raw: r.value, when: when(r), detail: pickupDetail(r) })), note: WIRE_NOTE }),
  });
  add({
    id: "worst-faab-acquisition", cat: FO, section: "Waivers & FAAB", title: "Worst FAAB Acquisition", desc: "The paid pickup with the weakest realized lineup return.", fmt: "signed1", dir: "asc", tone: "low",
    compute: (ctx) => ({
      rows: ctx.pickups().filter((r) => r.bid >= 10).map((r) => ({ key: r.key, raw: r.value, tie: -r.bid, when: when(r), detail: pickupDetail(r) })),
      note: `${WIRE_NOTE} Paid claims of $10 or more; among equal returns, the bigger bid ranks worse.`,
    }),
  });
  add({
    id: "faab-roi", cat: FO, section: "Waivers & FAAB", title: "FAAB Return on Investment", desc: "Realized waiver value per FAAB dollar spent.", fmt: "perDollar", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.pickups().filter((r) => r.bid > 0), (r) => r.key).forEach((rs, key) => {
        const spent = sum(rs.map((r) => r.bid));
        if (spent < 20) return;
        out.push({ key, raw: sum(rs.map((r) => r.value)) / spent, detail: `$${spent} spent on ${plural(rs.length, "paid claim")}` });
      });
      return { rows: out, note: `${WIRE_NOTE} Needs at least $20 of FAAB spent.` };
    },
  });

  // Draft
  const DRAFT_NOTE = "Pick value = a player's value over replacement (injury-adjusted) minus what that draft slot historically returns in this league.";
  const pickDetail = (p) => `${p.player} · ${p.round}.${String(p.pickInRound).padStart(2, "0")} · ${p.season}`;
  add({
    id: "greatest-draft-pick", cat: FO, section: "Draft", title: "Greatest Draft Pick", desc: "One pick measured against what its slot historically returns.", fmt: "signed1", dir: "desc",
    compute: (ctx) => ({ rows: ctx.draftPicks().filter((p) => p.delta > 0).map((p) => ({ key: p.key, raw: p.delta, when: Number(p.season) * 1000 + p.pickNo, detail: pickDetail(p) })), note: DRAFT_NOTE }),
  });
  add({
    id: "biggest-draft-bust", cat: FO, section: "Draft", title: "Biggest Draft Bust", desc: "The picks that missed their league-specific slot expectation by the most.", fmt: "signed1", dir: "asc", tone: "low",
    compute: (ctx) => ({ rows: ctx.draftPicks().filter((p) => p.delta < 0).map((p) => ({ key: p.key, raw: p.delta, when: Number(p.season) * 1000 + p.pickNo, detail: pickDetail(p) })), note: DRAFT_NOTE }),
  });
  add({
    id: "best-career-drafter", cat: FO, section: "Draft", title: "Best Career Drafter", desc: "Average realized value per non-keeper pick.", fmt: "signed1", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.draftPicks().filter((p) => !p.isKeeper), (p) => p.key).forEach((ps, key) => {
        if (ps.length < 8) return;
        out.push({ key, raw: sum(ps.map((p) => p.delta)) / ps.length, detail: `${plural(ps.length, "pick")}` });
      });
      return { rows: out, note: `${DRAFT_NOTE} Needs at least 8 picks.` };
    },
  });
  function draftSeason(id, title, desc, dir, tone) {
    add({
      id, cat: FO, section: "Draft", title, desc, fmt: "signed1", dir, tone,
      compute(ctx) {
        const out = [];
        groupBy(ctx.draftPicks().filter((p) => !p.isKeeper), (p) => `${p.key}|${p.season}`).forEach((ps, k) => {
          if (ps.length < 5) return;
          const [key, season] = k.split("|");
          out.push({ key, raw: sum(ps.map((p) => p.delta)) / ps.length, when: Number(season), detail: `${season} · ${plural(ps.length, "pick")}` });
        });
        return { rows: out, note: `${DRAFT_NOTE} Needs at least 5 non-keeper picks.` };
      },
    });
  }
  draftSeason("best-draft-season", "Best Draft Season", "Average realized pick value within one draft class.", "desc");
  draftSeason("worst-draft-season", "Worst Draft Season", "The draft classes with the lowest average realized pick value.", "asc", "low");
  add({
    id: "best-drafter-by-position", cat: FO, section: "Draft", title: "Best Drafter by Position", desc: "Career average pick value within each position.", fmt: "signed1", dir: "desc",
    compute(ctx) {
      const out = [];
      groupBy(ctx.draftPicks().filter((p) => !p.isKeeper && p.position), (p) => `${p.key}|${p.position}`).forEach((ps, k) => {
        if (ps.length < 3) return;
        const [key, pos] = k.split("|");
        out.push({ key, raw: sum(ps.map((p) => p.delta)) / ps.length, detail: `${pos} · ${plural(ps.length, "pick")}` });
      });
      return { rows: out, note: `${DRAFT_NOTE} Needs at least 3 picks at the position.` };
    },
  });

  // ---------- section order within each category ----------
  // Sections show in this order regardless of the order definitions were
  // added above; within a section, records keep definition order.
  const SECTION_ORDER = {
    careers: ["Winning", "Scoring", "Playoffs", "Hardware", "Luck & Schedule"],
    seasons: ["Best Seasons", "Lowlights", "Luck & Schedule"],
    matchups: ["Scoring", "Margins & Drama"],
    players: ["Player Performances", "Position Crowns", "Lineup Management", "Team Raw Stats · Careers", "Team Raw Stats · Seasons", "Team Raw Stats · Weeks"],
    streaks: ["Weekly Streaks", "Droughts", "Season Streaks", "Milestone Wall"],
    "front-office": ["Activity", "Trades", "Waivers & FAAB", "Draft"],
  };
  // The weekly droughts were defined before the season droughts, which
  // already matches the on-page order (High-Score, Top-Half, Playoff,
  // Championship).
  const sectionRank = (d) => {
    const order = SECTION_ORDER[d.cat] || [];
    const i = order.indexOf(d.section);
    return i === -1 ? order.length : i;
  };
  const categoryRank = (d) => RecordBook.CATEGORIES.findIndex((c) => c.id === d.cat);
  // Array.prototype.sort is stable, so records keep definition order within a section.
  defs.sort((a, b) => categoryRank(a) - categoryRank(b) || sectionRank(a) - sectionRank(b));

  RecordBook.DEFS = defs;
})();
