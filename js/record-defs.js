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

  // Optional flags on a definition:
  //   needsFinishedSeason  waits for a season to be over (draft picks, the playoff field, the champion)
  //   rate                 a running average or percentage whose leader shuffles every week;
  //                        the Home page's "Latest Records" list skips these
  //   grows                a running career total per manager that only ever goes up; the Home
  //                        page's "Records in Reach" watches how close active managers are
  //   live(ctx)            [{key, raw}]: streaks still going right now, for "Records in Reach"
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
      id, cat, section, title, desc, grows: true,
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
      id, cat, section, title, desc, rate: true,
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
        return { rows: out, note: o.note || null };
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
  careerTotal("careers", "Winning", "career-allplay-wins", "Career Overall Wins", "Overall Record wins: every weekly score against every other team in the league.", (ts) => (ts.allPlay ? ts.allPlay.w : null));
  careerTotal("careers", "Winning", "career-allplay-losses", "Career Overall Losses", "Overall Record losses: the most weekly comparisons lost to the field.", (ts) => (ts.allPlay ? ts.allPlay.l : null), { tone: "low" });
  careerRate("careers", "Winning", "best-vs-median", "Best Record vs the Median", "Who won most often after removing the weekly schedule draw.",
    (ts) => (ts.median ? ts.median.w + 0.5 * ts.median.t : null), (ts) => (ts.median ? ts.median.w + ts.median.l + ts.median.t : null));
  careerRate("careers", "Winning", "best-allplay-record", "Best Overall Record", "Overall Record win percentage: every score against every other team that week.",
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
  careerTotal("careers", "Hardware", "allplay-titles", "Overall Record Titles",
    "Best Overall Record win percentage in a season, with ties worth a half win. Equal leaders share the title.", (ts) => (ts.allPlay ? (ts.titles.allPlay ? 1 : 0) : null));
  // The wooden spoon: worst regular-season record of the year (points scored
  // break a tie, fewest is worst). Only seasons whose regular season is over.
  add({
    id: "most-last-place-finishes", cat: "careers", section: "Hardware", grows: true, title: "Most Last-Place Finishes", desc: "Seasons ending at the bottom of the regular-season standings.", fmt: "int", dir: "desc", tone: "low",
    compute(ctx) {
      const out = new Map(); // key -> seasons finished last
      groupBy(ctx.teamSeasons().filter((ts) => ts.regularComplete && ts.games > 0), (ts) => ts.season).forEach((rs, season) => {
        if (rs.length < 2) return;
        const ranked = [...rs].sort((a, b) => winPct(a.wins, a.losses, a.ties) - winPct(b.wins, b.losses, b.ties) || a.pf - b.pf);
        const worst = ranked[0];
        ranked
          .filter((ts) => Math.abs(winPct(ts.wins, ts.losses, ts.ties) - winPct(worst.wins, worst.losses, worst.ties)) < 1e-9 && Math.abs(ts.pf - worst.pf) < 1e-9)
          .forEach((ts) => {
            if (!out.has(ts.key)) out.set(ts.key, []);
            out.get(ts.key).push(season);
          });
      });
      return {
        rows: [...out.entries()].map(([key, seasons]) => ({ key, raw: seasons.length, detail: seasons.length > 4 ? plural(seasons.length, "season") : [...seasons].sort().join(", ") })),
        note: "Last place in the regular-season standings: the lowest win percentage, with the fewest points scored breaking a tie.",
      };
    },
  });

  // Luck & Schedule
  // Luck = real win % minus Overall Record win %, the same Luck shown on the
  // Home and Season pages (DeepHistory.luckPercent). Over a career it is the
  // gap between all of a manager's wins and all of their Overall Record wins.
  const LUCK_NOTE = "Luck = real win % minus Overall Record win % (every score against every other team, every week), the same Luck shown on the Home and Season pages.";
  function luckCareer(id, title, desc, dir) {
    add({
      id, cat: "careers", section: "Luck & Schedule", title, desc, rate: true, fmt: "signedPct1", dir, tone: dir === "asc" ? "low" : undefined,
      compute(ctx) {
        const out = [];
        groupBy(ctx.teamSeasons().filter((ts) => ts.allPlay && ts.games > 0), (r) => r.key).forEach((rs, key) => {
          if (new Set(rs.map((r) => r.season)).size < ctx.minSeasons) return;
          const raw = DeepHistory.luckPercent(
            sum(rs.map((r) => r.wins)), sum(rs.map((r) => r.losses)), sum(rs.map((r) => r.ties)),
            sum(rs.map((r) => r.allPlay.w)), sum(rs.map((r) => r.allPlay.l)), sum(rs.map((r) => r.allPlay.t))
          ) / 100;
          if (dir === "desc" ? raw <= 0 : raw >= 0) return;
          out.push({ key, raw, detail: seasonsDetail(rs) });
        });
        return { rows: out, note: [LUCK_NOTE, minSeasonsNote(ctx)].filter(Boolean).join(" ") };
      },
    });
  }
  luckCareer("luckiest-career", "Luckiest Career", "The biggest career schedule boost: real win percentage above Overall Record win percentage.", "desc");
  luckCareer("unluckiest-career", "Unluckiest Career", "The biggest career schedule penalty: real win percentage below Overall Record win percentage.", "asc");

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
  seasonRecord(S, "Best Seasons", "best-allplay-season", "Best Overall Record Season", "Overall Record win percentage: every week played against the entire league.",
    (ts) => (ts.allPlay ? winPct(ts.allPlay.w, ts.allPlay.l, ts.allPlay.t) : null), { fmt: "pct1" });
  seasonRecord(S, "Best Seasons", "most-allplay-wins-season", "Most Overall Wins in a Season", "The most Overall Record wins: weekly comparisons won against the field.",
    (ts) => (ts.allPlay ? ts.allPlay.w : null), { positiveOnly: true });
  seasonRecord(S, "Best Seasons", "best-point-differential", "Best Point Differential", "Average scoring margin across the regular season.",
    (ts) => (ts.games ? (ts.pf - ts.pa) / ts.games : null), { fmt: "signed1" });
  seasonRecord(S, "Best Seasons", "most-high-score-weeks-season", "Most High-Score Weeks", "League-leading scoring weeks in one season.", (ts) => ts.highWeeks, { positiveOnly: true });
  seasonRecord(S, "Best Seasons", "most-consistent-season", "Most Consistent Season", "Highest share of sampled weeks in the league's top half.",
    (ts) => (ts.weeks ? ts.topHalfWeeks / ts.weeks : null), { fmt: "pct1" });

  seasonRecord(S, "Lowlights", "most-allplay-losses-season", "Most Overall Losses in a Season", "The most Overall Record losses: weekly comparisons lost to the field.",
    (ts) => (ts.allPlay ? ts.allPlay.l : null), { tone: "low", positiveOnly: true });
  seasonRecord(S, "Lowlights", "most-losses-season", "Most Losses in a Season", "The roughest regular-season records.", (ts) => ts.losses, { tone: "low", positiveOnly: true });
  seasonRecord(S, "Lowlights", "fewest-points-season", "Fewest Points in a Season", "Lowest full-season scoring totals.", (ts) => (ts.pf > 0 ? ts.pf : null), { tone: "low", dir: "asc", fmt: "dec1" });
  seasonRecord(S, "Lowlights", "most-blowout-losses", "Most Blowout Losses", "Losses by 30 points or more in one season.", (ts) => ts.blowoutLosses, { tone: "low", positiveOnly: true });

  seasonRecord(S, "Luck & Schedule", "luckiest-season", "Luckiest Season", "The schedule added the most win percentage over what the Overall Record deserved.", (ts) => ts.luck, { fmt: "signedPct1", positiveOnly: true, note: LUCK_NOTE });
  seasonRecord(S, "Luck & Schedule", "unluckiest-season", "Unluckiest Season", "The schedule cost the most win percentage against what the Overall Record deserved.", (ts) => ts.luck, { fmt: "signedPct1", dir: "asc", tone: "low", negativeOnly: true, note: LUCK_NOTE });
  seasonRecord(S, "Luck & Schedule", "toughest-schedule", "Toughest Schedule", "Opponent scoring indexed to that season's league average.", (ts) => ts.scheduleIndex, { fmt: "dec1" });
  seasonRecord(S, "Luck & Schedule", "easiest-schedule", "Easiest Schedule", "The lowest opponent scoring relative to the league that season.", (ts) => ts.scheduleIndex, { fmt: "dec1", dir: "asc", tone: "low" });

  // Playoff Picture — who got in, who didn't, and what record it took. These
  // need to know the whole bracket, so a season joins once it is over
  // (`needsFinishedSeason`). A first-round bye counts as making the playoffs.
  const PP = "Playoff Picture";
  const PP_NOTE = "Counts a season once its playoffs are over. A first-round bye counts as making the playoffs.";
  const madePlayoffs = (ts) => ts.playoffApp || ts.bye;
  const seasonPct = (ts) => winPct(ts.wins, ts.losses, ts.ties);
  const seasonRec = (ts) => recordText(ts.wins, ts.losses, ts.ties);
  // Finished seasons where the playoff field is actually known (at least one team made it).
  function playoffSeasons(ctx) {
    const done = ctx.teamSeasons().filter((ts) => ts.complete && ts.games > 0);
    const withField = new Set(done.filter(madePlayoffs).map((ts) => ts.season));
    return done.filter((ts) => withField.has(ts.season));
  }
  add({
    id: "best-record-miss-playoffs", cat: S, section: PP, needsFinishedSeason: true, title: "Best Record to Miss the Playoffs", desc: "The best regular season that still wasn't enough to get in.", fmt: (n, r) => r.rec, dir: "desc", tone: "low",
    compute: (ctx) => ({
      rows: playoffSeasons(ctx).filter((ts) => !madePlayoffs(ts)).map((ts) => ({ key: ts.key, raw: seasonPct(ts), tie: -ts.pf, rec: seasonRec(ts), when: Number(ts.season), detail: `${ts.season} · ${ts.pf.toFixed(1)} points scored` })),
      note: `${PP_NOTE} Ranked by win percentage; points scored break ties.`,
    }),
  });
  add({
    id: "worst-record-make-playoffs", cat: S, section: PP, needsFinishedSeason: true, title: "Worst Record to Make the Playoffs", desc: "The weakest regular season that still got a team into the bracket.", fmt: (n, r) => r.rec, dir: "asc", tone: "low",
    compute: (ctx) => ({
      rows: playoffSeasons(ctx).filter(madePlayoffs).map((ts) => ({ key: ts.key, raw: seasonPct(ts), tie: ts.pf, rec: seasonRec(ts), when: Number(ts.season), detail: `${ts.season} · ${ts.pf.toFixed(1)} points scored` })),
      note: `${PP_NOTE} Ranked by win percentage; fewer points scored ranks worse in a tie.`,
    }),
  });
  add({
    id: "fewest-wins-champion", cat: S, section: PP, needsFinishedSeason: true, title: "Fewest Wins by a Champion", desc: "The champion who needed the fewest regular-season wins to get there.", fmt: (n) => plural(Math.round(n), "win"), dir: "asc",
    compute: (ctx) => ({
      rows: ctx.teamSeasons().filter((ts) => ts.complete && ts.isChampion && ts.games > 0).map((ts) => ({ key: ts.key, raw: ts.wins, tie: seasonPct(ts), when: Number(ts.season), detail: `${ts.season} · ${seasonRec(ts)} in the regular season` })),
      note: "Regular-season wins of each season's champion; a lower win percentage ranks first when wins are equal.",
    }),
  });

  // Power Rankings & playoff odds (data/power-rank-csv-history.json): each
  // team's weekly Power Rank (1 = best, shared ranks average to e.g. 1.5), PR
  // Score (lower is better) and playoff odds. Season-long ones wait for a
  // finished regular season like the rest of this page; single-week ones
  // (the score extremes) don't need to.
  const PR_SECTION = "Power Rankings & Playoff Odds";
  const PR_NOTE = "Built from the weekly Power Rankings history (2019 on).";
  const prAtFirst = (r) => r.rank <= 1.5;
  const prAtLast = (r) => r.rank >= r.teams - 0.5;
  const prRankText = (r) => (Number.isInteger(r.rank) ? `#${r.rank}` : `T-${Math.floor(r.rank)}`);
  const finishedSeasons = (ctx) => new Set(ctx.facts.seasons.filter((s) => ctx.seasonSet.has(s.season) && s.regularComplete).map((s) => s.season));

  function prWeeksInSeason(id, title, desc, pred, tone) {
    add({
      id, cat: S, section: PR_SECTION, title, desc, fmt: "int", dir: "desc", tone,
      compute(ctx) {
        const done = finishedSeasons(ctx);
        const out = [];
        groupBy(ctx.powerRows().filter((r) => done.has(r.season)), (r) => `${r.key}|${r.season}`).forEach((rs, k) => {
          const [key, season] = k.split("|");
          const n = rs.filter(pred).length;
          if (n > 0) out.push({ key, raw: n, when: Number(season), detail: `${season} · ${n} of ${plural(rs.length, "ranked week")}` });
        });
        return { rows: out, note: PR_NOTE };
      },
    });
  }

  // Longest run of consecutive weeks inside one season (ranks reset every
  // preseason, so a run never crosses seasons); a missing week ends it.
  function prRunInSeason(id, title, desc, pred, tone) {
    add({
      id, cat: S, section: PR_SECTION, title, desc, fmt: "int", dir: "desc", tone,
      compute(ctx) {
        const done = finishedSeasons(ctx);
        const out = [];
        groupBy(ctx.powerRows().filter((r) => done.has(r.season)), (r) => r.key).forEach((rs, key) => {
          let best = null;
          groupBy(rs, (r) => r.season).forEach((weeks, season) => {
            let cur = null;
            [...weeks].sort((a, b) => a.week - b.week).forEach((r) => {
              if (!pred(r)) {
                cur = null;
                return;
              }
              cur = cur && cur.end === r.week - 1 ? { start: cur.start, end: r.week, length: cur.length + 1 } : { start: r.week, end: r.week, length: 1 };
              if (!best || cur.length > best.length || (cur.length === best.length && Number(season) < Number(best.season))) best = { ...cur, season };
            });
          });
          if (best) out.push({ key, raw: best.length, when: Number(best.season) * 100 + best.start, detail: `${plural(best.length, "week")} · ${best.season} Wk ${best.start}${best.end > best.start ? "–" + best.end : ""}` });
        });
        return { rows: out, note: PR_NOTE + " A run stays inside one season." };
      },
    });
  }

  prWeeksInSeason("most-weeks-first-pr", "Most Weeks at #1 in a Season", "Weeks spent atop the Power Rankings in one season.", prAtFirst);
  prRunInSeason("longest-run-first-pr", "Most Weeks in a Row at #1", "The longest unbroken stay atop the Power Rankings.", prAtFirst);
  prWeeksInSeason("most-weeks-last-pr", "Most Weeks in Last Place in a Season", "Weeks spent at the very bottom of the Power Rankings in one season.", prAtLast, "low");
  prRunInSeason("longest-run-last-pr", "Most Weeks in a Row in Last Place", "The longest unbroken stay at the bottom of the Power Rankings.", prAtLast, "low");

  // PR Score is "lower is better", so "highest" is the worst a team has ever rated.
  function prScoreExtreme(id, title, desc, dir, tone) {
    add({
      id, cat: S, section: PR_SECTION, title, desc, fmt: "dec2", dir, tone,
      compute(ctx) {
        return {
          rows: ctx.powerRows().filter((r) => r.score != null).map((r) => ({ key: r.key, raw: r.score, when: when(r), detail: `${weekLabel(r)} · ranked ${prRankText(r)}` })),
          note: PR_NOTE + " Power Ranking Score is lower-is-better, and weekly scores were first recorded in 2021.",
        };
      },
    });
  }
  prScoreExtreme("highest-pr-score", "Highest Power Ranking Score", "The highest weekly Power Ranking Score ever: the worst a team has rated (lower is better).", "desc", "low");
  prScoreExtreme("lowest-pr-score", "Lowest Power Ranking Score", "The lowest weekly Power Ranking Score ever: the best a team has rated (lower is better).", "asc");

  // The same "clinched" moment the Season page's Playoff Odds chart marks:
  // odds reach 99.5%+ and stay there for the rest of the season. (A week the
  // odds weren't recorded is skipped rather than treated as a dip.)
  add({
    id: "earliest-playoff-clinch", cat: S, section: PR_SECTION, title: "Earliest to Clinch a Playoff Berth",
    desc: "The first week a team's playoff odds hit 100% and stayed there.", fmt: "week", dir: "asc",
    compute(ctx) {
      const done = finishedSeasons(ctx);
      const out = [];
      ctx.oddsSeries().filter((o) => done.has(o.season)).forEach((o) => {
        for (let i = 0; i < o.weekly.length; i++) {
          const v = o.weekly[i];
          if (v != null && v >= 99.5 && o.weekly.slice(i).every((x) => x == null || x >= 99.5)) {
            const spare = o.weekly.length - (i + 1);
            out.push({ key: o.key, raw: i + 1, when: Number(o.season), detail: `${o.season} · ${spare > 0 ? plural(spare, "week") + " to spare" : "clinched in the final week"}` });
            return;
          }
        }
      });
      return { rows: out, note: "Clinched = playoff odds at 99.5%+ for the rest of the regular season, the same moment the Season page's Playoff Odds chart marks. Playoff odds history starts in 2021." };
    },
  });

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
  // Biggest Upset: a lower-ranked team beating a higher-ranked one, by the Power
  // Rankings going INTO the game. Each week's Power Rank is built from that
  // week's results, so the game's own week would give the answer away; last
  // week's rank is what the league saw before kickoff (which leaves Week 1 unranked).
  const rankText = (r) => (Number.isInteger(r) ? `#${r}` : `T-${Math.floor(r)}`);
  add({
    id: "biggest-upset", cat: M, section: "Margins & Drama", title: "Biggest Upset", desc: "The widest Power Rank gap a winner ever overcame.", fmt: (n) => `${Number.isInteger(n) ? n : n.toFixed(1)} ${n === 1 ? "spot" : "spots"}`, dir: "desc",
    compute(ctx) {
      const rank = new Map();
      ctx.powerRows().forEach((r) => rank.set(`${r.season}|${r.week}|${r.key}`, r.rank));
      const rows = [];
      decided(ctx).forEach((d) => {
        if (d.week < 2) return;
        const w = rank.get(`${d.season}|${d.week - 1}|${d.winnerKey}`);
        const l = rank.get(`${d.season}|${d.week - 1}|${d.loserKey}`);
        if (w == null || l == null || w <= l) return;
        rows.push({
          key: d.winnerKey, raw: w - l, when: when(d),
          detail: `${rankText(w)} ${ctx.name(d.winnerKey)} beat ${rankText(l)} ${ctx.name(d.loserKey)} ${d.winnerPts.toFixed(1)}–${d.loserPts.toFixed(1)} · ${gameLabel(d)}`,
        });
      });
      return { rows, note: "Ranks come from the weekly Power Rankings history (2019 on) as they stood before the game, so Week 1 and any game without a prior ranking are left out." };
    },
  });

  // ---- Head to Head -------------------------------------------------
  // One row per pair of managers, built from every counted meeting between
  // them (regular season plus the games on the road to 1st/3rd place; the
  // consolation bracket never counts) — the same games the Rivalries page uses.
  const H2H = "Head to Head";
  const H2H_NOTE = "Counts every regular-season and playoff meeting (consolation games excluded).";
  function pairs(ctx) {
    return ctx.memo("h2hPairs", () => {
      const map = new Map();
      playedGames(ctx).forEach((g) => {
        const flip = g.aKey > g.bKey;
        const lo = flip ? g.bKey : g.aKey;
        const hi = flip ? g.aKey : g.bKey;
        const k = `${lo}|${hi}`;
        if (!map.has(k)) map.set(k, { lo, hi, loWins: 0, hiWins: 0, ties: 0, regLoWins: 0, regHiWins: 0, regTies: 0, regular: 0, playoff: 0, combined: 0, margin: 0, last: 0 });
        const p = map.get(k);
        const loPts = flip ? g.bPts : g.aPts;
        const hiPts = flip ? g.aPts : g.bPts;
        if (loPts > hiPts) p.loWins += 1;
        else if (hiPts > loPts) p.hiWins += 1;
        else p.ties += 1;
        if (g.isPlayoff) p.playoff += 1;
        else {
          p.regular += 1;
          if (loPts > hiPts) p.regLoWins += 1;
          else if (hiPts > loPts) p.regHiWins += 1;
          else p.regTies += 1;
        }
        p.combined += g.aPts + g.bPts;
        p.margin += Math.abs(g.aPts - g.bPts);
        p.last = Math.max(p.last, when(g));
      });
      return [...map.values()].map((p) => ({ ...p, games: p.regular + p.playoff }));
    });
  }
  // Rate-style pair records need a few meetings to mean anything; a narrower
  // era has fewer meetings to go around, so the bar comes down with it.
  const minMeetings = (ctx) => (ctx.seasons.length >= 5 ? 5 : ctx.seasons.length >= 3 ? 3 : 2);
  const pairName = (ctx, p) => `${ctx.name(p.lo)} vs ${ctx.name(p.hi)}`;
  const meetings = (n) => plural(n, "meeting");

  add({
    id: "most-lopsided-head-to-head", cat: M, section: H2H, title: "Most Lopsided Head to Head", desc: "The widest gap in wins between two managers who keep meeting.", fmt: (n) => `+${Math.round(n)} ${Math.round(n) === 1 ? "win" : "wins"}`, dir: "desc",
    compute: (ctx) => ({
      rows: pairs(ctx).filter((p) => p.loWins !== p.hiWins).map((p) => {
        const loLeads = p.loWins > p.hiWins;
        const leader = loLeads ? p.lo : p.hi;
        const trailer = loLeads ? p.hi : p.lo;
        const w = Math.max(p.loWins, p.hiWins);
        const l = Math.min(p.loWins, p.hiWins);
        return {
          name: `${ctx.name(leader)} vs ${ctx.name(trailer)}`, raw: w - l,
          detail: `${ctx.name(leader)} leads ${w}-${l}${p.ties ? `-${p.ties}` : ""} · ${meetings(p.games)}`,
        };
      }),
      note: `${H2H_NOTE} Ranked by the difference in wins.`,
    }),
  });

  function combinedAverage(id, title, desc, dir, tone) {
    add({
      id, cat: M, section: H2H, title, desc, rate: true, fmt: "dec1", dir, tone,
      compute(ctx) {
        const min = minMeetings(ctx);
        return {
          rows: pairs(ctx).filter((p) => p.games >= min).map((p) => ({
            name: pairName(ctx, p), raw: p.combined / p.games, detail: meetings(p.games),
          })),
          note: `${H2H_NOTE} Average of both teams' scores added together per meeting; needs at least ${min} meetings.`,
        };
      },
    });
  }
  combinedAverage("highest-combined-average", "Highest Combined Points Average", "The pair whose meetings produce the most points between them, on average.", "desc");
  combinedAverage("lowest-combined-average", "Lowest Combined Points Average", "The pair whose meetings are the lowest scoring, on average.", "asc", "low");

  add({
    id: "most-regular-season-meetings", cat: M, section: H2H, title: "Most Regular Season Meetings", desc: "The matchup the schedule keeps handing out.", fmt: (n) => meetings(Math.round(n)), dir: "desc",
    compute: (ctx) => ({
      rows: pairs(ctx).filter((p) => p.regular > 0).map((p) => ({ name: pairName(ctx, p), raw: p.regular, detail: `${ctx.name(p.lo)} ${p.regLoWins}-${p.regHiWins}${p.regTies ? `-${p.regTies}` : ""} ${ctx.name(p.hi)} in the regular season` })),
      note: "Regular-season games only.",
    }),
  });
  add({
    id: "most-playoff-meetings", cat: M, section: H2H, title: "Most Playoff Meetings", desc: "Two managers who keep running into each other when it counts.", fmt: (n) => meetings(Math.round(n)), dir: "desc",
    compute: (ctx) => ({
      rows: pairs(ctx).filter((p) => p.playoff > 0).map((p) => ({ name: pairName(ctx, p), raw: p.playoff, detail: `${plural(p.regular + p.playoff, "meeting")} in all` })),
      note: "Playoff games on the road to 1st or 3rd place; the consolation bracket is excluded.",
    }),
  });

  function runLabel(a, b) {
    if (a.season !== b.season) return `${a.season} Wk ${a.week} – ${b.season} Wk ${b.week}`;
    return a.week === b.week ? `${a.season} Wk ${a.week}` : `${a.season} Wk ${a.week}–${b.week}`;
  }
  add({
    id: "longest-head-to-head-streak", cat: M, section: H2H, title: "Longest Head to Head Win Streak", desc: "The most meetings in a row one manager has beaten the same opponent.", fmt: (n) => plural(Math.round(n), "straight win"), dir: "desc",
    compute(ctx) {
      const byPair = new Map();
      [...playedGames(ctx)].sort(byTime).forEach((g) => {
        const k = [g.aKey, g.bKey].sort().join("|");
        if (!byPair.has(k)) byPair.set(k, { cur: null, best: null });
        const st = byPair.get(k);
        if (g.aPts === g.bPts) {
          st.cur = null; // a tie ends the streak
          return;
        }
        const winner = g.aPts > g.bPts ? g.aKey : g.bKey;
        if (!st.cur || st.cur.winner !== winner) st.cur = { winner, loser: winner === g.aKey ? g.bKey : g.aKey, length: 0, start: g, end: g };
        st.cur.length += 1;
        st.cur.end = g;
        if (!st.best || st.cur.length > st.best.length) st.best = st.cur;
      });
      // "Ongoing" = still unbroken as of the league's newest scored season.
      const latestSeason = ctx.facts.latest && ctx.facts.latest.season;
      const rows = [];
      byPair.forEach((st) => {
        const run = st.best;
        if (!run || run.length < 2) return;
        const ongoing = st.cur === run && run.end.season === latestSeason;
        rows.push({
          name: `${ctx.name(run.winner)} over ${ctx.name(run.loser)}`, raw: run.length, when: when(run.start),
          detail: `${runLabel(run.start, run.end)}${ongoing ? " · ongoing" : ""}`,
        });
      });
      return { rows, note: `${H2H_NOTE} A tie ends a streak.` };
    },
  });
  add({
    id: "closest-rivalry", cat: M, section: H2H, rate: true, title: "Closest Rivalry", desc: "The pair whose meetings are decided by the smallest margin, on average.", fmt: (n) => `${n.toFixed(1)} pts`, dir: "asc",
    compute(ctx) {
      const min = minMeetings(ctx);
      return {
        rows: pairs(ctx).filter((p) => p.games >= min).map((p) => ({
          name: pairName(ctx, p), raw: p.margin / p.games,
          detail: `${ctx.name(p.lo)} ${p.loWins}-${p.hiWins}${p.ties ? `-${p.ties}` : ""} ${ctx.name(p.hi)} · ${meetings(p.games)}`,
        })),
        note: `${H2H_NOTE} Average winning margin per meeting; needs at least ${min} meetings.`,
      };
    },
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
    id: "highest-scoring-benched-player", cat: P, section: "Player Performances", title: "Highest Scoring Benched Player", desc: "The biggest week ever left sitting on a bench.", fmt: "dec1", dir: "desc", tone: "low",
    compute(ctx) {
      const teamWeek = new Map();
      ctx.weekTeams().forEach((t) => teamWeek.set(`${t.season}|${t.week}|${t.key}`, t));
      return {
        rows: ctx.playerRows().filter((r) => !r.started && r.points > 0).map((r) => {
          const t = teamWeek.get(`${r.season}|${r.week}|${r.key}`);
          const outcome = !t ? "" : t.result === "W" ? " · they won anyway" : t.result === "L" ? ` · they lost by ${(t.oppPoints - t.points).toFixed(1)}` : " · they tied";
          return { name: ctx.playerName(r.pid), playerId: r.pid, raw: r.points, when: when(r), detail: `benched by ${ctx.name(r.key)} · ${weekLabel(r)}${outcome}` };
        }),
        note: "Any rostered player who scored while outside the starting lineup.",
      };
    },
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

  // ---- Starters by position -------------------------------------------
  const SBP = "Starters by Position";
  const STARTER_POSITIONS = [
    { pos: "QB", label: "QB" }, { pos: "RB", label: "RB" }, { pos: "WR", label: "WR" },
    { pos: "TE", label: "TE" }, { pos: "K", label: "K" }, { pos: "DEF", label: "D/ST" },
  ];
  const posOf = (ctx, pid) => {
    const p = ctx.facts.playerDirectory[pid];
    return p ? p.position : null;
  };
  const starterDetail = (ctx, r) => `for ${ctx.name(r.key)} · ${weekLabel(r)}${r.isPlayoff ? " (playoffs)" : ""}`;
  STARTER_POSITIONS.forEach(({ pos, label }) => {
    [true, false].forEach((high) => {
      add({
        id: `${high ? "highest" : "lowest"}-${label.replace("/", "").toLowerCase()}-starter`, cat: P, section: SBP,
        title: `${high ? "Highest" : "Lowest"} Scoring ${label} Starter`,
        desc: high ? `The biggest week ever from a ${label} in a starting lineup.` : `The worst week ever from a ${label} in a starting lineup.`,
        fmt: "dec1", dir: high ? "desc" : "asc", tone: high ? undefined : "low",
        compute: (ctx) => ({
          rows: ctx.playerRows().filter((r) => r.started && posOf(ctx, r.pid) === pos).map((r) => ({
            name: ctx.playerName(r.pid), playerId: r.pid, raw: r.points, when: when(r), detail: starterDetail(ctx, r),
          })),
          note: "Starters only, in any lineup slot. Includes starters who scored nothing (injured, inactive or on a bye).",
        }),
      });
    });
  });
  add({
    id: "lowest-superflex-starter", cat: P, section: SBP, title: "Lowest Scoring SUPERFLEX Starter", desc: "The worst week ever from a player in the SUPERFLEX slot.", fmt: "dec1", dir: "asc", tone: "low",
    compute: (ctx) => ({
      rows: ctx.playerRows().filter((r) => r.started && r.slot === "SUPER_FLEX").map((r) => ({
        name: ctx.playerName(r.pid), playerId: r.pid, raw: r.points, when: when(r), detail: `${posOf(ctx, r.pid) || "?"} ${starterDetail(ctx, r)}`,
      })),
      note: "The SUPERFLEX slot has been in the lineup since 2022.",
    }),
  });

  // ---- Postseason starts ----------------------------------------------
  const PS = "Postseason Starts";
  function postseasonStarts(id, title, desc, keep, note) {
    add({
      id, cat: P, section: PS, title, desc, fmt: (n) => plural(Math.round(n), "start"), dir: "desc",
      compute(ctx) {
        const out = [];
        groupBy(ctx.playerRows().filter((r) => r.started && keep(r)), (r) => r.pid).forEach((rs, pid) => {
          const years = [...new Set(rs.map((r) => r.season))].sort();
          out.push({ name: ctx.playerName(pid), playerId: pid, raw: rs.length, detail: `${sum(rs.map((r) => r.points)).toFixed(1)} points · ${years.length > 4 ? `${years.length} seasons` : years.join(", ")}` });
        });
        return { rows: out, note };
      },
    });
  }
  postseasonStarts("most-championship-starts", "Most Championship Starts", "The NFL players who keep showing up in the title game lineups.", (r) => r.final,
    "Starts in the championship game, for either finalist.");
  postseasonStarts("most-playoff-starts", "Most Playoff Starts", "The NFL players started most often once the playoffs begin.", (r) => r.isPlayoff,
    "Starts in playoff games on the road to 1st or 3rd place; the consolation bracket is excluded.");

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
      // The runs still alive: ending in the newest scored week of a season in progress.
      live(ctx) {
        const latest = ctx.facts.latest;
        const info = latest && ctx.facts.seasons.find((x) => x.season === latest.season);
        if (!info || info.complete) return [];
        const out = [];
        groupBy(ctx.regularWeekTeams(), (r) => r.key).forEach((rs, key) => {
          const sorted = [...rs].sort(byTime);
          const last = sorted[sorted.length - 1];
          if (!last || last.season !== latest.season || last.week !== latest.week) return;
          let n = 0;
          for (let i = sorted.length - 1; i >= 0 && pred(sorted[i]); i--) n += 1;
          if (n > 0) out.push({ key, raw: n });
        });
        return out;
      },
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
    id: "most-trades", cat: FO, section: "Activity", grows: true, title: "Most Trades", desc: "Career completed trades in the selected era.", fmt: "int", dir: "desc",
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
    id: "most-roster-moves", cat: FO, section: "Activity", grows: true, title: "Most Roster Moves", desc: "Adds, drops, waivers, and trades.", fmt: "int", dir: "desc",
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
  add({
    id: "blockbuster-trades", cat: FO, section: "Trades", title: "Blockbuster Trades", desc: "The biggest trades ever made, by players changing teams.", fmt: (n) => plural(Math.round(n), "player"), dir: "desc",
    compute: (ctx) => ({
      rows: ctx.trades().filter((t) => t.players > 0).map((t) => ({
        name: t.keys.map((k) => ctx.name(k)).join(" & "), raw: t.players, tie: -t.picks, when: when(t),
        detail: `${t.week ? weekLabel(t) : `${t.season} offseason`} · ${t.sides.map((s) => `${ctx.name(s.key)} sent ${nameList(s.sent, 3)}`).join(" · ")}${t.picks ? ` · ${plural(t.picks, "pick")} also moved` : ""}`,
      })),
      note: "Every player who changed teams in one trade, scored or not; draft picks break ties.",
    }),
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
    id: "faab-roi", cat: FO, section: "Waivers & FAAB", rate: true, title: "FAAB Return on Investment", desc: "Realized waiver value per FAAB dollar spent.", fmt: "perDollar", dir: "desc",
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
  // Every Draft record reads ctx.draftPicks(), which leaves out the draft of a
  // season still in progress (see context() in record-book.js) — the picks
  // haven't had a full year to prove themselves. `needsFinishedSeason` is what
  // lets the page say "Unlocks after the season ends" instead of "No qualifying entries".
  const DRAFT_NOTE = "Pick value = a player's value over replacement (injury-adjusted) minus what that draft slot historically returns in this league. A draft class counts once its season is over.";
  const pickDetail = (p) => `${p.player} · ${p.round}.${String(p.pickInRound).padStart(2, "0")} · ${p.season}`;
  add({
    id: "greatest-draft-pick", cat: FO, section: "Draft", needsFinishedSeason: true, title: "Greatest Draft Pick", desc: "One pick measured against what its slot historically returns.", fmt: "signed1", dir: "desc",
    compute: (ctx) => ({ rows: ctx.draftPicks().filter((p) => p.delta > 0).map((p) => ({ key: p.key, raw: p.delta, when: Number(p.season) * 1000 + p.pickNo, detail: pickDetail(p) })), note: DRAFT_NOTE }),
  });
  add({
    id: "biggest-draft-bust", cat: FO, section: "Draft", needsFinishedSeason: true, title: "Biggest Draft Bust", desc: "The picks that missed their league-specific slot expectation by the most.", fmt: "signed1", dir: "asc", tone: "low",
    compute: (ctx) => ({ rows: ctx.draftPicks().filter((p) => p.delta < 0).map((p) => ({ key: p.key, raw: p.delta, when: Number(p.season) * 1000 + p.pickNo, detail: pickDetail(p) })), note: DRAFT_NOTE }),
  });
  add({
    id: "best-career-drafter", cat: FO, section: "Draft", needsFinishedSeason: true, rate: true, title: "Best Career Drafter", desc: "Average realized value per non-keeper pick.", fmt: "signed1", dir: "desc",
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
      id, cat: FO, section: "Draft", needsFinishedSeason: true, title, desc, fmt: "signed1", dir, tone,
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
  // Best Drafter by Position — one record per position. A single-season view has
  // far fewer picks to go around, so the minimum drops with the era.
  const minPositionPicks = (ctx) => (ctx.seasons.length >= 3 ? 3 : 1);
  [["QB", "QB"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"], ["K", "K"], ["DEF", "D/ST"]].forEach(([pos, label]) => {
    add({
      id: `best-drafter-${label.replace("/", "").toLowerCase()}`, cat: FO, section: "Draft", needsFinishedSeason: true, rate: true,
      title: `Best ${label} Drafter`, desc: `Career average pick value on ${label === "D/ST" ? "defenses" : label + "s"}.`, fmt: "signed1", dir: "desc",
      compute(ctx) {
        const min = minPositionPicks(ctx);
        const out = [];
        groupBy(ctx.draftPicks().filter((p) => !p.isKeeper && p.position === pos), (p) => p.key).forEach((ps, key) => {
          if (ps.length < min) return;
          out.push({ key, raw: sum(ps.map((p) => p.delta)) / ps.length, detail: plural(ps.length, "pick") });
        });
        return { rows: out, note: `${DRAFT_NOTE} Needs at least ${plural(min, "pick")} at the position.` };
      },
    });
  });
  // Earliest Kicker / Defense Drafted — pure draft position, so every pick counts
  // (graded or not); the season just has to be over like the rest of this section.
  function earliestPick(id, title, desc, pos) {
    add({
      id, cat: FO, section: "Draft", needsFinishedSeason: true, title, desc, fmt: (n) => `Pick #${Math.round(n)}`, dir: "asc", tone: "low",
      compute: (ctx) => ({
        rows: ctx.draftSlots().filter((p) => p.position === pos).map((p) => ({ key: p.key, raw: p.pickNo, when: Number(p.season) * 1000 + p.pickNo, detail: pickDetail(p) })),
        note: "Overall pick number; the season counts once it is over.",
      }),
    });
  }
  earliestPick("earliest-kicker-drafted", "Earliest Kicker Drafted", "The kicker taken higher on the board than any other.", "K");
  earliestPick("earliest-defense-drafted", "Earliest Defense Drafted", "The D/ST taken higher on the board than any other.", "DEF");

  // ---------- section order within each category ----------
  // Sections show in this order regardless of the order definitions were
  // added above; within a section, records keep definition order.
  const SECTION_ORDER = {
    careers: ["Winning", "Scoring", "Playoffs", "Hardware", "Luck & Schedule"],
    seasons: ["Best Seasons", "Lowlights", "Luck & Schedule", "Playoff Picture", "Power Rankings & Playoff Odds"],
    matchups: ["Scoring", "Margins & Drama", "Head to Head"],
    players: ["Player Performances", "Starters by Position", "Postseason Starts", "Position Crowns", "Lineup Management", "Team Raw Stats · Careers", "Team Raw Stats · Seasons", "Team Raw Stats · Weeks"],
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
