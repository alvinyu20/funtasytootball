/*
  ============================================================
  RECORD BOOK ENGINE
  ============================================================
  Powers the Records page (records.js). Pure computation — no DOM, no
  fetching — so every number on that page can be unit-tested against
  the real code (tests/record-book*.test.js) instead of a copy of it.

  Two steps:

    1. RecordBook.buildFacts({...}) walks every season ONCE and boils the
       raw Sleeper data (weekly scores, lineups, transactions, drafts)
       plus the hand-entered ESPN-era standings down into flat "facts":
       one row per manager-season, one per manager-week, one per game,
       one per player-week, one per pickup/drop/trade... Everything a
       record needs is a filter + sort over those rows.

    2. RecordBook.context(facts, eraId) narrows the facts to the era the
       visitor picked ("all", "last3", or a single season like "2023"),
       and RecordBook.compute(def, ctx) runs one record definition
       (see record-defs.js) against it, returning a ranked top-10.

  Era handling in one sentence: "Career" records add up every season in
  the era, "season" records pick the best single season inside it — so
  picking one season just makes the career records that season's totals.

  Data coverage: the pre-Sleeper ESPN seasons (2015-2019) only have season
  totals, so they contribute to the records computable from totals (wins,
  points, playoffs, titles, Overall Record where recorded — 2017 on) and
  are skipped — not guessed at — for anything that needs weekly scores or
  lineups. Only the categories flagged `history` (Careers, Seasons) include
  them; the page asks for the rest with context(facts, era, true).

  Seasons in progress: ctx.seasonLevelRows() holds back single-season
  records until the regular season ends, and ctx.draftPicks() holds back a
  draft class until its season is completely over (league status "complete").
*/

const RecordBook = (function () {
  const MINUS = "−";
  const MIN_SEASONS = 3; // rate-style career records need at least this many seasons in the era
  const BLOWOUT_MARGIN = 30; // "Blowout Wins/Losses": margin of victory at least this big
  const NARROW_MARGIN = 5; // "Narrow Wins": margin of victory at most this small

  // ---------------------------------------------------------------
  // Metadata the page needs even before any records are computed.
  // ---------------------------------------------------------------
  const CATEGORIES = [
    { id: "careers", history: true, title: "Careers", icon: "crown", blurb: "Winning, scoring and hardware—volume records paired with the rates that keep long tenures honest." },
    { id: "seasons", history: true, title: "Seasons", icon: "medal", blurb: "The dominant runs, fortunate schedules and campaigns that became league shorthand." },
    { id: "matchups", title: "Matchups", icon: "target", blurb: "Scoreboard eruptions, impossible losses, narrow escapes and the widest margins in the archive." },
    { id: "players", title: "Players & Lineups", icon: "user", blurb: "Historic performances, position crowns and the managers who squeezed the most from every roster." },
    { id: "streaks", title: "Streaks & Milestones", icon: "flame", blurb: "The heat that lasted, the waits that would not end and the career marks that changed the ledger." },
    { id: "front-office", title: "Front Office", icon: "gauge", blurb: "Drafts, trades and waiver decisions ranked by what they actually returned—not merely how often someone clicked." },
  ];

  // The raw box-score categories behind the "Team Raw Stats" records.
  // `sleeperKey` is the field name in Sleeper's /stats/nfl endpoint; the
  // pipeline (scripts/build-team-raw-stats.js) stores them in this exact
  // order, so the order here IS the file format — append, never reorder.
  const RAW_STATS = [
    { key: "pass_yd", label: "Passing Yards" },
    { key: "pass_td", label: "Passing TDs" },
    { key: "pass_int", label: "Interceptions Thrown", tone: "low" },
    { key: "rush_yd", label: "Rushing Yards" },
    { key: "rush_td", label: "Rushing TDs" },
    { key: "rec", label: "Receptions" },
    { key: "rec_yd", label: "Receiving Yards" },
    { key: "rec_td", label: "Receiving TDs" },
    { key: "def_td", label: "Defensive TDs" },
    { key: "fgm", label: "Field Goals Made" },
    { key: "fum", label: "Fumbles", tone: "low" },
  ];

  // ---------------------------------------------------------------
  // Number formatting. Raw values stay numbers inside the engine; text
  // is produced here so tests can assert on exactly what a visitor sees.
  // ---------------------------------------------------------------
  function fixed(n, dec) {
    const text = Number(n).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    if (!text.startsWith("-")) return text;
    // A real minus sign, like signed() uses; and a negative that rounds to zero is just zero.
    return /[1-9]/.test(text) ? MINUS + text.slice(1) : text.slice(1);
  }
  function signed(n, dec) {
    const rounded = Math.round(Math.abs(n) * 10 ** dec) / 10 ** dec;
    if (rounded === 0) return fixed(0, dec);
    return (n > 0 ? "+" : MINUS) + fixed(rounded, dec);
  }
  const FORMATS = {
    int: (n) => fixed(Math.round(n), 0),
    dec1: (n) => fixed(n, 1),
    dec2: (n) => fixed(n, 2),
    pct1: (n) => fixed(n * 100, 1) + "%",
    signedPct1: (n) => signed(n * 100, 1) + "%",
    signed1: (n) => signed(n, 1),
    signed2: (n) => signed(n, 2),
    wins: (n) => signed(n, 1) + " wins",
    perWeek: (n) => signed(n, 1) + "/wk",
    perDollar: (n) => signed(n, 1) + "/$",
    usd: (n) => "$" + fixed(Math.round(n), 0),
    week: (n) => "Week " + Math.round(n),
  };

  // ---------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------
  function groupBy(rows, keyFn) {
    const map = new Map();
    rows.forEach((r) => {
      const k = keyFn(r);
      if (k == null) return;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    });
    return map;
  }
  function sum(values) {
    let t = 0;
    for (const v of values) t += v || 0;
    return t;
  }
  function winPct(w, l, t) {
    const g = w + l + t;
    return g > 0 ? (w + 0.5 * t) / g : null;
  }
  function seasonOrder(a, b) {
    return Number(a) - Number(b);
  }

  // ---------------------------------------------------------------
  // FACTS
  // ---------------------------------------------------------------
  function buildFacts(input) {
    const seasonChain = input.seasonChain || [];
    const deepSeasons = input.deepSeasons || [];
    const playerDirectory = input.playerDirectory || {};
    const manual = input.manual || null;
    const stats = input.stats || null;
    const rawStats = input.rawStats || null;

    const facts = {
      playerDirectory,
      seasons: [], // [{season, source, complete, regularComplete, hasWeekly, numTeams, playoffStart}] oldest -> newest
      managers: new Map(), // key -> {key, userId, username}
      teamSeasons: [],
      weekTeams: [],
      games: [],
      playerRows: [],
      positionCrowns: [], // {key, pos, season, value}
      pickups: [],
      drops: [],
      tradeSides: [],
      tradePairs: [],
      trades: [], // every completed trade: {season, week, keys, players, picks, sides:[{key, sent:[names]}]}
      moveCounts: [],
      draftPicks: [],
      draftSlots: [], // every draft pick, graded or not: where each player went off the board
      rawRows: [],
      powerRows: [], // weekly Power Rankings: {season, week, key, rank, score, odds, teams}
      oddsSeries: [], // each manager-season's weekly playoff odds: {season, key, weekly}
      rawStatsAvailable: !!(rawStats && rawStats.seasons && Object.keys(rawStats.seasons).length),
      latest: null, // {season, week} of the newest scored week (for "active" streak flags)
    };

    // ---- Manager identity ------------------------------------------------
    // Sleeper managers are keyed by their stable user_id; the username shown
    // is the most recent one (chain is oldest -> newest, so last write wins).
    // ESPN-era rows only have a name, which is matched to a Sleeper manager
    // by ANY username they've used — the same "match by name" rule history.js
    // already uses — and otherwise becomes its own standalone manager.
    const usernameIndex = new Map(); // lowercased username -> key
    function register(key, userId, username) {
      if (!facts.managers.has(key)) facts.managers.set(key, { key, userId, username });
      const m = facts.managers.get(key);
      if (username) {
        m.username = username;
        usernameIndex.set(String(username).toLowerCase(), key);
      }
      return m;
    }
    seasonChain.forEach((entry) => {
      const usersById = new Map((entry.users || []).map((u) => [u.user_id, u]));
      (entry.rosters || []).forEach((r) => {
        if (!r.owner_id) return;
        const user = usersById.get(r.owner_id);
        const name = (user && user.display_name) || SleeperAPI.teamName(user, r.roster_id);
        register("u:" + r.owner_id, r.owner_id, name);
      });
    });
    const manualSeasons = ((manual && manual.seasons) || []).filter((s) => s && s.standings && s.standings.length);
    const sleeperYears = new Set(seasonChain.map((e) => String(e.league.season)));
    manualSeasons.forEach((s) => {
      if (sleeperYears.has(String(s.year))) return;
      s.standings.forEach((row) => {
        const existing = usernameIndex.get(String(row.team).toLowerCase());
        if (!existing) register("e:" + row.team, null, row.team);
      });
    });

    // ---- ESPN era: season totals only -----------------------------------
    manualSeasons.forEach((s) => {
      if (sleeperYears.has(String(s.year))) return;
      const season = String(s.year);
      facts.seasons.push({ season, source: "espn", complete: true, regularComplete: true, hasWeekly: false, numTeams: s.standings.length, playoffStart: null });
      const rows = [];
      s.standings.forEach((row) => {
        const key = usernameIndex.get(String(row.team).toLowerCase()) || "e:" + row.team;
        const ties = row.ties || 0;
        const games = row.wins + row.losses + ties;
        const ap = row.overallRecord ? { w: row.overallRecord.wins, l: row.overallRecord.losses, t: row.overallRecord.ties || 0 } : null;
        
        rows.push({
          season,
          source: "espn",
          hasWeekly: false,
          complete: true,
          regularComplete: true,
          key,
          rosterId: null,
          wins: row.wins,
          losses: row.losses,
          ties,
          games,
          pf: row.pointsFor,
          pa: row.pointsAgainst,
          isChampion: row.medal === "gold",
          isRunnerUp: row.medal === "silver",
          isThird: row.medal === "bronze",
          playoffApp: !!row.playoffAppearance,
          bye: !!row.playoffBye,
          playoffWins: row.playoffWins || 0,
          playoffLosses: row.playoffLosses || 0,
          playoffTies: 0,
          playoffPoints: row.playoffPoints || 0,
          allPlay: ap,
          median: null,
          highWeeks: null,
          topHalfWeeks: null,
          top3Weeks: null,
          weeks: null,
          blowoutWins: null,
          blowoutLosses: null,
          narrowWins: null,
          oppSum: null,
          oppGames: null,
          scheduleIndex: null,
          luck: ap && games > 0 ? DeepHistory.luckPercent(row.wins, row.losses, ties, ap.w, ap.l, ap.t) / 100 : null,
          lineup: null,
          titles: { regular: false, points: false, allPlay: false },
        });
      });
      assignSeasonTitles(rows);
      facts.teamSeasons.push(...rows);
    });

    // ---- Sleeper era: full weekly detail ----------------------------------
    seasonChain.forEach((entry, idx) => {
      processSleeperSeason(facts, entry, deepSeasons[idx], playerDirectory, stats);
    });

    facts.seasons.sort((a, b) => seasonOrder(a.season, b.season));
    facts.teamSeasons.sort((a, b) => seasonOrder(a.season, b.season));

    // ---- Draft picks (graded by DeepHistory.computeStats) --------------------
    if (stats && stats.managers) {
      const model = stats.draftGradeModel || null;
      stats.managers.forEach((m) => {
        if (!m.userId) return;
        const key = "u:" + m.userId;
        if (!facts.managers.has(key)) return;
        (m.seasons || []).forEach((s) => {
          (s.draftPicks || []).forEach((p) => {
            facts.draftSlots.push({
              key,
              season: String(p.season),
              player: p.player,
              playerId: p.playerId,
              position: p.position || "",
              round: p.round,
              pickNo: p.pickNo,
              pickInRound: p.pickInRound,
              isKeeper: !!p.isKeeper,
            });
            const actual = p.gradingVbd != null ? p.gradingVbd : p.vbd;
            if (actual == null) return;
            const expected = p.expectedVbd != null ? p.expectedVbd : DeepHistory.predictExpectedVBD(p.pickNo, model);
            if (expected == null) return;
            facts.draftPicks.push({
              key,
              season: String(p.season),
              player: p.player,
              playerId: p.playerId,
              position: p.position || "",
              round: p.round,
              pickNo: p.pickNo,
              pickInRound: p.pickInRound,
              isKeeper: !!p.isKeeper,
              delta: actual - expected,
            });
          });
        });
      });
    }

    // ---- Team raw stats (written by scripts/build-team-raw-stats.js) -------
    if (rawStats && rawStats.seasons) {
      const order = rawStats.stats || RAW_STATS.map((s) => s.key);
      Object.entries(rawStats.seasons).forEach(([season, weeks]) => {
        Object.entries(weeks || {}).forEach(([week, byUser]) => {
          Object.entries(byUser || {}).forEach(([userId, vals]) => {
            const key = "u:" + userId;
            if (!facts.managers.has(key)) return;
            const byStat = {};
            order.forEach((statKey, i) => (byStat[statKey] = Number(vals[i]) || 0));
            facts.rawRows.push({ season: String(season), week: Number(week), key, vals: byStat });
          });
        });
      });
    }


    // ---- Power Rankings history (data/power-rank-csv-history.json) ---------
    // Weekly Power Rank (1 = best; shared ranks are averaged, e.g. 1.5), PR
    // Score (lower is better) and playoff odds, keyed by Sleeper username.
    // Names are matched to managers by any username they have used; a name
    // that matches nobody becomes its own standalone manager.
    const powerRanks = input.powerRanks;
    if (powerRanks && powerRanks.seasons) {
      Object.entries(powerRanks.seasons).forEach(([season, data]) => {
        const keyOf = (name) => {
          const hit = usernameIndex.get(String(name).toLowerCase());
          if (hit) return hit;
          register("e:" + name, null, name);
          return "e:" + name;
        };
        const ranks = (data && data.ranks) || {};
        const scores = (data && data.scores) || {};
        const odds = (data && data.playoffOdds) || {};
        const rows = [];
        Object.entries(ranks).forEach(([name, series]) => {
          const key = keyOf(name);
          (series.weekly || []).forEach((rank, i) => {
            if (rank == null) return;
            const sc = scores[name] && scores[name].weekly ? scores[name].weekly[i] : null;
            const od = Array.isArray(odds[name]) ? odds[name][i] : null;
            rows.push({ season: String(season), week: i + 1, key, rank, score: sc == null ? null : sc, odds: od == null ? null : od, teams: 0 });
          });
        });
        const teamsByWeek = new Map();
        rows.forEach((r) => teamsByWeek.set(r.week, (teamsByWeek.get(r.week) || 0) + 1));
        rows.forEach((r) => (r.teams = teamsByWeek.get(r.week)));
        facts.powerRows.push(...rows);
        Object.entries(odds).forEach(([name, weekly]) => {
          if (Array.isArray(weekly)) facts.oddsSeries.push({ season: String(season), key: keyOf(name), weekly });
        });
      });
    }
    return facts;
  }

  // Titles are decided across a whole season's rows, so they're assigned
  // after every team in that season exists. Exact ties share a title.
  function assignSeasonTitles(rows) {
    if (!rows.length) return;
    const complete = rows.every((r) => r.regularComplete);
    if (!complete) return; // no regular-season title until the regular season is over
    const EPS = 1e-9;

    let best = null;
    rows.forEach((r) => {
      const pct = winPct(r.wins, r.losses, r.ties);
      if (pct == null) return;
      if (!best || pct > best.pct + EPS || (Math.abs(pct - best.pct) <= EPS && r.pf > best.pf + EPS)) best = { pct, pf: r.pf };
    });
    if (best) {
      rows.forEach((r) => {
        const pct = winPct(r.wins, r.losses, r.ties);
        r.titles.regular = pct != null && Math.abs(pct - best.pct) <= EPS && Math.abs(r.pf - best.pf) <= EPS;
      });
    }

    const maxPf = Math.max(...rows.map((r) => r.pf));
    rows.forEach((r) => (r.titles.points = Math.abs(r.pf - maxPf) <= EPS));

    const apRows = rows.filter((r) => r.allPlay);
    if (apRows.length) {
      const maxAp = Math.max(...apRows.map((r) => winPct(r.allPlay.w, r.allPlay.l, r.allPlay.t)));
      apRows.forEach((r) => (r.titles.allPlay = Math.abs(winPct(r.allPlay.w, r.allPlay.l, r.allPlay.t) - maxAp) <= EPS));
    }
  }

  function processSleeperSeason(facts, entry, deep, playerDirectory, stats) {
    const { league, rosters, users, bracket } = entry;
    const season = String(league.season);
    const usersById = new Map((users || []).map((u) => [u.user_id, u]));
    const playoffStart = league.settings && league.settings.playoff_week_start != null ? league.settings.playoff_week_start : null;
    const weeks = deep && deep.weeks ? [...deep.weeks].sort((a, b) => a.week - b.week) : [];
    const complete = league.status === "complete";
    const regularComplete = complete || (playoffStart != null && weeks.some((w) => w.week >= playoffStart));

    // A season with no scored weeks yet (e.g. a league just created for next
    // year) has nothing to rank, so it isn't offered as an era either.
    if (!weeks.length) return;
    facts.seasons.push({ season, source: "sleeper", complete, regularComplete, hasWeekly: true, numTeams: (rosters || []).length, playoffStart });

    const rosterInfo = new Map(); // roster_id -> {key}
    (rosters || []).forEach((r) => {
      if (!r.owner_id) return;
      rosterInfo.set(r.roster_id, { key: "u:" + r.owner_id });
    });

    // The exact (week, roster-pair) games on the road to 1st or 3rd place —
    // the same definition computeStats uses for "playoff" results, so the
    // consolation bracket never leaks into winners-bracket numbers.
    const relevantPairs = new Set();
    const finalPairs = new Set(); // the championship game alone (bracket game p:1)
    if (bracket && bracket.length && playoffStart != null) {
      SleeperAPI.relevantBracketGames(bracket).forEach((g) => {
        const t1 = SleeperAPI.resolveBracketTeamId(bracket, g, "t1");
        const t2 = SleeperAPI.resolveBracketTeamId(bracket, g, "t2");
        if (t1 == null || t2 == null) return;
        const pairKey = `${playoffStart + (g.r - 1)}:${Math.min(t1, t2)}-${Math.max(t1, t2)}`;
        relevantPairs.add(pairKey);
        if (g.p === 1) finalPairs.add(pairKey);
      });
    }
    const championId = SleeperAPI.findChampionRosterId(bracket);
    const runnerUpId = SleeperAPI.findRunnerUpRosterId(bracket);
    const thirdId = SleeperAPI.findThirdPlaceRosterId(bracket);
    const byeIds = new Set(SleeperAPI.byeRosterIds(bracket));

    const accs = new Map();
    function acc(rosterId) {
      if (!accs.has(rosterId)) {
        accs.set(rosterId, {
          wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, games: 0,
          apW: 0, apL: 0, apT: 0, medW: 0, medL: 0, medT: 0, expWins: 0,
          highWeeks: 0, topHalfWeeks: 0, top3Weeks: 0, scoredWeeks: 0,
          blowoutWins: 0, blowoutLosses: 0, narrowWins: 0, oppSum: 0, oppGames: 0,
          pWins: 0, pLosses: 0, pTies: 0, pPoints: 0, playoffGames: 0,
          lineupActual: 0, lineupOptimal: 0, lineupBench: 0, lineupWeeks: 0, lineupPerfect: 0,
        });
      }
      return accs.get(rosterId);
    }

    const crownSums = new Map(); // `${key}|${pos}` -> running sum this season
    const KNOWN_POS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);
    const nativePos = (pid) => {
      const p = playerDirectory[pid];
      return p && KNOWN_POS.has(p.position) ? p.position : null;
    };

    let regularScoreSum = 0;
    let regularScoreCount = 0;

    weeks.forEach(({ week, matchups }) => {
      const isRegular = playoffStart == null || week < playoffStart;
      const rows = (matchups || []).filter((m) => m && m.roster_id != null);

      const byMatchupId = new Map();
      rows.forEach((m) => {
        if (m.matchup_id == null) return;
        if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
        byMatchupId.get(m.matchup_id).push(m);
      });
      const opponentOf = new Map(); // roster_id -> opponent matchup row
      const countedRow = new Set(); // roster_ids whose game this week counts toward records
      byMatchupId.forEach((pair) => {
        if (pair.length !== 2) return;
        const [a, b] = pair;
        const counted = isRegular || relevantPairs.has(`${week}:${Math.min(a.roster_id, b.roster_id)}-${Math.max(a.roster_id, b.roster_id)}`);
        if (!counted) return;
        opponentOf.set(a.roster_id, b);
        opponentOf.set(b.roster_id, a);
        countedRow.add(a.roster_id);
        countedRow.add(b.roster_id);
      });

      // League-relative standing this week (regular season only): how many
      // OTHER teams scored strictly more / the same, which gives all-play,
      // top-half, top-three, high-score and vs-median all from one pass.
      const rel = new Map();
      if (isRegular) {
        const pts = rows.map((m) => m.points || 0);
        const n = pts.length;
        const sorted = [...pts].sort((x, y) => x - y);
        const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
        rows.forEach((m) => {
          const p = m.points || 0;
          let higher = 0;
          let equal = 0;
          pts.forEach((q) => {
            if (q > p) higher++;
            else if (q === p) equal++;
          });
          equal -= 1; // not counting yourself
          rel.set(m.roster_id, { n, higher, equal, lower: n - 1 - higher - equal, median });
        });
      }

      // Position scoring for Position Crowns: each roster's starters' points
      // at each position this week, measured against the league average.
      const posByRoster = new Map();
      if (isRegular) {
        rows.forEach((m) => {
          if (!rosterInfo.has(m.roster_id)) return;
          const pm = m.players_points || {};
          const byPos = {};
          (m.starters || []).forEach((pid) => {
            if (!pid || pid === "0") return;
            const pos = nativePos(pid);
            if (!pos) return;
            byPos[pos] = (byPos[pos] || 0) + (pm[pid] || 0);
          });
          posByRoster.set(m.roster_id, byPos);
        });
        const teamsCounted = posByRoster.size;
        if (teamsCounted) {
          const avg = {};
          KNOWN_POS.forEach((pos) => {
            let t = 0;
            posByRoster.forEach((byPos) => (t += byPos[pos] || 0));
            avg[pos] = t / teamsCounted;
          });
          posByRoster.forEach((byPos, rosterId) => {
            const key = rosterInfo.get(rosterId).key;
            KNOWN_POS.forEach((pos) => {
              const k = `${key}|${pos}`;
              crownSums.set(k, (crownSums.get(k) || 0) + ((byPos[pos] || 0) - avg[pos]));
            });
          });
        }
      }

      rows.forEach((m) => {
        const info = rosterInfo.get(m.roster_id);
        if (!info) return;
        if (!countedRow.has(m.roster_id)) return;
        const opp = opponentOf.get(m.roster_id);
        const p = m.points || 0;
        const oppPts = opp.points || 0;
        const oppInfo = rosterInfo.get(opp.roster_id);
        const result = p > oppPts ? "W" : p < oppPts ? "L" : "T";
        const isFinal = finalPairs.has(`${week}:${Math.min(m.roster_id, opp.roster_id)}-${Math.max(m.roster_id, opp.roster_id)}`);
        const a = acc(m.roster_id);
        const margin = Math.abs(p - oppPts);

        // Lineup efficiency — the best LEGAL lineup this roster's week could
        // have fielded vs what it actually started.
        let optimal = null;
        let benchLeft = null;
        const rosterPlayers = (m.players || [])
          .map((pid) => {
            const pl = playerDirectory[pid];
            return pl && pl.position ? { playerId: pid, position: pl.position, points: (m.players_points || {})[pid] || 0 } : null;
          })
          .filter(Boolean);
        if (rosterPlayers.length) {
          optimal = DeepHistory.computeOptimalLineup(league.roster_positions, rosterPlayers).total;
          optimal = Math.max(optimal, p);
          benchLeft = Math.max(0, optimal - p);
        }

        const row = {
          season, week, isPlayoff: !isRegular, final: isFinal, key: info.key, rosterId: m.roster_id,
          points: p, oppKey: oppInfo ? oppInfo.key : null, oppPoints: oppPts, result,
          optimal, benchLeft,
          rank: null, isHigh: false, isTop3: false, isTopHalf: false, medianResult: null,
        };

        if (isRegular) {
          const r = rel.get(m.roster_id);
          row.rank = r.higher + 1;
          row.isHigh = r.higher === 0;
          row.isTop3 = r.higher < 3;
          row.isTopHalf = r.higher < r.n / 2;
          row.medianResult = p > r.median ? "W" : p < r.median ? "L" : "T";

          a.games += 1;
          a.pf += p;
          a.pa += oppPts;
          if (result === "W") a.wins += 1;
          else if (result === "L") a.losses += 1;
          else a.ties += 1;
          a.apW += r.lower;
          a.apL += r.higher;
          a.apT += r.equal;
          a.expWins += (r.lower + 0.5 * r.equal) / (r.n - 1);
          if (row.medianResult === "W") a.medW += 1;
          else if (row.medianResult === "L") a.medL += 1;
          else a.medT += 1;
          a.scoredWeeks += 1;
          if (row.isHigh) a.highWeeks += 1;
          if (row.isTop3) a.top3Weeks += 1;
          if (row.isTopHalf) a.topHalfWeeks += 1;
          if (result === "W" && margin >= BLOWOUT_MARGIN) a.blowoutWins += 1;
          if (result === "L" && margin >= BLOWOUT_MARGIN) a.blowoutLosses += 1;
          if (result === "W" && margin <= NARROW_MARGIN) a.narrowWins += 1;
          a.oppSum += oppPts;
          a.oppGames += 1;
          regularScoreSum += p;
          regularScoreCount += 1;
          if (optimal != null) {
            a.lineupActual += p;
            a.lineupOptimal += optimal;
            a.lineupBench += benchLeft;
            a.lineupWeeks += 1;
            if (benchLeft <= 0.01) a.lineupPerfect += 1;
          }
        } else {
          a.playoffGames += 1;
          a.pPoints += p;
          if (result === "W") a.pWins += 1;
          else if (result === "L") a.pLosses += 1;
          else a.pTies += 1;
        }

        facts.weekTeams.push(row);

        // Every player on this roster this week, started or not.
        const startedSet = new Set((m.starters || []).filter((pid) => pid && pid !== "0"));
        // Sleeper lists starters in the same order as the lineup slots in
        // league.roster_positions (QB, RB, RB, WR, WR, TE, FLEX, SUPER_FLEX, K, DEF...),
        // so a starter's slot is just their index in that list.
        const slotOf = new Map();
        (m.starters || []).forEach((pid, i) => {
          if (pid && pid !== "0") slotOf.set(pid, (league.roster_positions || [])[i] || null);
        });
        Object.entries(m.players_points || {}).forEach(([pid, pts]) => {
          facts.playerRows.push({
            season, week, pid, points: pts || 0, key: info.key, started: startedSet.has(pid), slot: slotOf.get(pid) || null,
            isPlayoff: !isRegular, final: isFinal,
          });
        });

        // One game record per matchup (add it from the "first" side only).
        if (oppInfo && m.roster_id < opp.roster_id) {
          facts.games.push({
            season, week, isPlayoff: !isRegular, final: isFinal,
            aKey: info.key, aPts: p, bKey: oppInfo.key, bPts: oppPts,
          });
        }
      });

      facts.latest = { season, week };
    });

    // ---- Per-roster season rows ---------------------------------------------
    const leagueAvgPf = regularScoreCount ? regularScoreSum / regularScoreCount : null;
    const seasonRows = [];
    rosterInfo.forEach((info, rosterId) => {
      const a = accs.get(rosterId);
      if (!a || (a.games === 0 && a.playoffGames === 0)) return;
      const hasAllPlay = a.apW + a.apL + a.apT > 0;
      seasonRows.push({
        season, source: "sleeper", hasWeekly: true, complete, regularComplete,
        key: info.key, rosterId,
        wins: a.wins, losses: a.losses, ties: a.ties, games: a.games, pf: a.pf, pa: a.pa,
        isChampion: rosterId === championId,
        isRunnerUp: rosterId === runnerUpId,
        isThird: rosterId === thirdId,
        playoffApp: a.playoffGames > 0,
        bye: byeIds.has(rosterId),
        playoffWins: a.pWins, playoffLosses: a.pLosses, playoffTies: a.pTies, playoffPoints: a.pPoints,
        allPlay: hasAllPlay ? { w: a.apW, l: a.apL, t: a.apT } : null,
        median: a.scoredWeeks ? { w: a.medW, l: a.medL, t: a.medT } : null,
        highWeeks: a.highWeeks, topHalfWeeks: a.topHalfWeeks, top3Weeks: a.top3Weeks, weeks: a.scoredWeeks,
        blowoutWins: a.blowoutWins, blowoutLosses: a.blowoutLosses, narrowWins: a.narrowWins,
        oppSum: a.oppSum, oppGames: a.oppGames,
        scheduleIndex: a.oppGames && leagueAvgPf ? (a.oppSum / a.oppGames / leagueAvgPf) * 100 : null,
        luck: hasAllPlay && a.games ? DeepHistory.luckPercent(a.wins, a.losses, a.ties, a.apW, a.apL, a.apT) / 100 : null,
        lineup: a.lineupWeeks ? { actual: a.lineupActual, optimal: a.lineupOptimal, bench: a.lineupBench, weeks: a.lineupWeeks, perfect: a.lineupPerfect } : null,
        titles: { regular: false, points: false, allPlay: false },
      });
    });
    // Titles only count teams that actually played regular-season games.
    assignSeasonTitles(seasonRows.filter((r) => r.games > 0));
    facts.teamSeasons.push(...seasonRows);

    crownSums.forEach((value, k) => {
      const [key, pos] = k.split("|");
      facts.positionCrowns.push({ key, pos, season, value });
    });

    buildFrontOfficeFacts(facts, { league, rosters, deep, weeks, playoffStart, rosterInfo, playerDirectory });
  }

  // ---------------------------------------------------------------
  // Front office: pickups, drops, trades, move counts.
  //
  // "Realized value" throughout = points a player scored while sitting in
  // a STARTING lineup, minus what a replacement-level player at that
  // position would have scored those same weeks. Bench production isn't
  // value anyone realized; below-replacement starts are negative.
  // ---------------------------------------------------------------
  function buildFrontOfficeFacts(facts, { league, rosters, deep, weeks, playoffStart, rosterInfo, playerDirectory }) {
    const season = String(league.season);
    const regularWeeks = weeks.filter((w) => playoffStart == null || w.week < playoffStart).map((w) => w.week);
    const transactions = (deep && deep.transactions ? deep.transactions : []).filter((tx) => tx && tx.status === "complete");

    // Move counts need no weekly data, so they're tallied first.
    const counts = new Map(); // key -> {trades, adds, drops}
    function countFor(rosterId) {
      const info = rosterInfo.get(rosterId);
      if (!info) return null;
      if (!counts.has(info.key)) counts.set(info.key, { trades: 0, adds: 0, drops: 0 });
      return counts.get(info.key);
    }
    transactions.forEach((tx) => {
      if (tx.type === "trade") {
        (tx.roster_ids || []).forEach((rid) => {
          const c = countFor(rid);
          if (c) c.trades += 1;
        });
      } else {
        Object.values(tx.adds || {}).forEach((rid) => {
          const c = countFor(rid);
          if (c) c.adds += 1;
        });
        Object.values(tx.drops || {}).forEach((rid) => {
          const c = countFor(rid);
          if (c) c.drops += 1;
        });
      }
    });
    counts.forEach((c, key) => facts.moveCounts.push({ season, key, trades: c.trades, adds: c.adds, drops: c.drops }));

    // Which two managers swapped players/picks, for "Most Frequent Trade Partners".
    transactions
      .filter((tx) => tx.type === "trade")
      .forEach((tx) => {
        const keys = (tx.roster_ids || []).map((rid) => (rosterInfo.get(rid) || {}).key).filter(Boolean);
        for (let i = 0; i < keys.length; i++) {
          for (let j = i + 1; j < keys.length; j++) facts.tradePairs.push({ season, week: tx.leg, keys: [keys[i], keys[j]] });
        }
      });

    // One row per completed trade (scored or not, any week of the year), for
    // "Blockbuster Trades". Each player in a trade is added to one roster and
    // dropped from another, so the players moved are the distinct ids across both.
    transactions
      .filter((tx) => tx.type === "trade")
      .forEach((tx) => {
        const sides = new Map();
        (tx.roster_ids || []).forEach((rid) => {
          if (rosterInfo.has(rid)) sides.set(rid, { key: rosterInfo.get(rid).key, sent: [] });
        });
        if (sides.size < 2) return;
        const moved = new Set([...Object.keys(tx.adds || {}), ...Object.keys(tx.drops || {})]);
        Object.entries(tx.drops || {}).forEach(([pid, rid]) => {
          if (sides.has(rid)) sides.get(rid).sent.push(SleeperAPI.playerName(playerDirectory, pid));
        });
        const picks = (tx.draft_picks || []).length;
        if (!moved.size && !picks) return;
        facts.trades.push({ season, week: tx.leg == null ? 0 : tx.leg, keys: [...sides.values()].map((x) => x.key), players: moved.size, picks, sides: [...sides.values()] });
      });

    if (!regularWeeks.length) return;
    const lastRegular = Math.max(...regularWeeks);
    const regularSet = new Set(regularWeeks);

    // Index the season: who started whom, who rostered whom, season totals.
    const startedBy = new Map(); // `${week}|${pid}` -> {rid, points}
    const rosteredBy = new Map(); // `${week}|${pid}` -> rid
    const seasonPts = new Map();
    weeks.forEach(({ week, matchups }) => {
      if (!regularSet.has(week)) return;
      (matchups || []).forEach((m) => {
        const pm = m.players_points || {};
        Object.entries(pm).forEach(([pid, pts]) => seasonPts.set(pid, (seasonPts.get(pid) || 0) + (pts || 0)));
        (m.players || []).forEach((pid) => rosteredBy.set(`${week}|${pid}`, m.roster_id));
        (m.starters || []).forEach((pid) => {
          if (!pid || pid === "0") return;
          startedBy.set(`${week}|${pid}`, { rid: m.roster_id, points: pm[pid] || 0 });
        });
      });
    });
    const level = DeepHistory.computeReplacementLevels(league.roster_positions, (rosters || []).length, seasonPts, playerDirectory);
    const replacementPerWeek = (pid) => {
      const p = playerDirectory[pid];
      if (!p || !p.position || level[p.position] == null) return null;
      return level[p.position] / regularWeeks.length;
    };
    const nameOf = (pid) => SleeperAPI.playerName(playerDirectory, pid);

    // Sum of (points - replacement) over the weeks `pid` was in a starting
    // lineup within [from, to], optionally only for starts by certain rosters.
    function startedValue(pid, from, to, ridFilter) {
      const repl = replacementPerWeek(pid);
      if (repl == null) return { value: 0, weeks: 0, points: 0 };
      let value = 0;
      let count = 0;
      let points = 0;
      for (let w = from; w <= to; w++) {
        if (!regularSet.has(w)) continue;
        const st = startedBy.get(`${w}|${pid}`);
        if (!st || (ridFilter && !ridFilter(st.rid))) continue;
        value += st.points - repl;
        points += st.points;
        count += 1;
      }
      return { value, weeks: count, points };
    }

    transactions.forEach((tx) => {
      const leg = tx.leg;
      if (leg == null || leg > lastRegular) return;

      if (tx.type !== "trade") {
        Object.entries(tx.adds || {}).forEach(([pid, rid]) => {
          const info = rosterInfo.get(rid);
          if (!info || replacementPerWeek(pid) == null) return;
          // Credit stops once the claiming roster no longer holds the player.
          let value = 0;
          let startedWeeks = 0;
          const repl = replacementPerWeek(pid);
          for (let w = leg; w <= lastRegular; w++) {
            if (!regularSet.has(w)) continue;
            if (w > leg && rosteredBy.get(`${w}|${pid}`) !== rid) break;
            const st = startedBy.get(`${w}|${pid}`);
            if (st && st.rid === rid) {
              value += st.points - repl;
              startedWeeks += 1;
            }
          }
          const bid = tx.settings && tx.settings.waiver_bid != null ? tx.settings.waiver_bid : null;
          facts.pickups.push({ season, week: leg, key: info.key, playerId: pid, player: nameOf(pid), position: playerDirectory[pid].position, bid, value, startedWeeks });
        });
        Object.entries(tx.drops || {}).forEach(([pid, rid]) => {
          const info = rosterInfo.get(rid);
          if (!info) return;
          const got = startedValue(pid, leg, lastRegular, (r) => r !== rid);
          if (got.value > 0) facts.drops.push({ season, week: leg, key: info.key, playerId: pid, player: nameOf(pid), lost: got.value, startedWeeks: got.weeks });
        });
        return;
      }

      // Trades: judged in hindsight over the rest of that regular season.
      const horizon = regularWeeks.filter((w) => w >= leg).length;
      if (horizon < 3) return;
      const sides = new Map();
      (tx.roster_ids || []).forEach((rid) => {
        if (rosterInfo.has(rid)) sides.set(rid, { received: [], sent: [] });
      });
      Object.entries(tx.adds || {}).forEach(([pid, rid]) => sides.has(rid) && sides.get(rid).received.push(pid));
      Object.entries(tx.drops || {}).forEach(([pid, rid]) => sides.has(rid) && sides.get(rid).sent.push(pid));
      sides.forEach((side, rid) => {
        if (!side.received.length && !side.sent.length) return;
        const recv = sum(side.received.map((pid) => startedValue(pid, leg, lastRegular).value));
        const sentVal = sum(side.sent.map((pid) => startedValue(pid, leg, lastRegular).value));
        facts.tradeSides.push({
          season, week: leg, key: rosterInfo.get(rid).key, horizon,
          net: recv - sentVal, perWeek: (recv - sentVal) / horizon,
          received: side.received.map(nameOf), sent: side.sent.map(nameOf),
        });
      });
    });
  }

  // ---------------------------------------------------------------
  // Eras
  // ---------------------------------------------------------------
  function eras(facts, sleeperOnly) {
    const ids = facts.seasons.filter((s) => !sleeperOnly || s.source !== "espn").map((s) => s.season);
    const out = [
      { id: "all", label: "All seasons" },
      { id: "last3", label: "Last 3 seasons" },
    ];
    [...ids].reverse().forEach((id) => out.push({ id, label: id }));
    return out;
  }

  // `sleeperOnly` drops the pre-Sleeper (ESPN) seasons, which only have
  // season totals — used by the categories that need weekly detail.
  function seasonsForEra(facts, eraId, sleeperOnly) {
    const ids = facts.seasons.filter((s) => !sleeperOnly || s.source !== "espn").map((s) => s.season);
    if (eraId === "all" || eraId == null) return ids;
    if (eraId === "last3") return ids.slice(-3);
    return ids.includes(String(eraId)) ? [String(eraId)] : ids;
  }

  // ---------------------------------------------------------------
  // Context: the facts narrowed to one era. Everything is filtered
  // lazily and memoized, since most records touch only one or two
  // fact tables.
  // ---------------------------------------------------------------
  function context(facts, eraId, sleeperOnly) {
    const seasons = seasonsForEra(facts, eraId, sleeperOnly);
    const set = new Set(seasons);
    const memo = new Map();
    const lazy = (name, fn) => () => {
      if (!memo.has(name)) memo.set(name, fn());
      return memo.get(name);
    };
    const inEra = (r) => set.has(r.season);
    // A draft pick is only judged on how its player did over the whole year,
    // so a draft class joins the books once its season is over (league status
    // "complete") — not while the season is still being played.
    const overSeasons = new Set(facts.seasons.filter((s) => s.complete).map((s) => s.season));
    const ctx = {
      facts,
      eraId: eraId || "all",
      sleeperOnly: !!sleeperOnly,
      seasons,
      seasonSet: set,
      minSeasons: Math.min(MIN_SEASONS, seasons.length),
      name: (key) => (facts.managers.get(key) ? facts.managers.get(key).username : "Unknown"),
      playerName: (pid) => SleeperAPI.playerName(facts.playerDirectory, pid),
      teamSeasons: lazy("teamSeasons", () => facts.teamSeasons.filter(inEra)),
      seasonLevelRows: lazy("seasonLevelRows", () => facts.teamSeasons.filter((r) => inEra(r) && r.regularComplete)),
      weekTeams: lazy("weekTeams", () => facts.weekTeams.filter(inEra)),
      regularWeekTeams: lazy("regularWeekTeams", () => facts.weekTeams.filter((r) => inEra(r) && !r.isPlayoff)),
      games: lazy("games", () => facts.games.filter(inEra)),
      playerRows: lazy("playerRows", () => facts.playerRows.filter(inEra)),
      positionCrowns: lazy("positionCrowns", () => facts.positionCrowns.filter(inEra)),
      pickups: lazy("pickups", () => facts.pickups.filter(inEra)),
      drops: lazy("drops", () => facts.drops.filter(inEra)),
      tradeSides: lazy("tradeSides", () => facts.tradeSides.filter(inEra)),
      tradePairs: lazy("tradePairs", () => facts.tradePairs.filter(inEra)),
      moveCounts: lazy("moveCounts", () => facts.moveCounts.filter(inEra)),
      draftPicks: lazy("draftPicks", () => facts.draftPicks.filter((p) => inEra(p) && overSeasons.has(p.season))),
      draftSlots: lazy("draftSlots", () => (facts.draftSlots || []).filter((p) => inEra(p) && overSeasons.has(p.season))),
      trades: lazy("trades", () => (facts.trades || []).filter(inEra)),
      rawRows: lazy("rawRows", () => facts.rawRows.filter(inEra)),
      powerRows: lazy("powerRows", () => facts.powerRows.filter(inEra)),
      oddsSeries: lazy("oddsSeries", () => facts.oddsSeries.filter(inEra)),
      memo: (name, fn) => {
        if (!memo.has(name)) memo.set(name, fn());
        return memo.get(name);
      },
    };
    return ctx;
  }

  // ---------------------------------------------------------------
  // Ranking + formatting one record's rows
  // ---------------------------------------------------------------
  const TOP_N = 10;
  const EPS = 1e-9;

  function compute(def, ctx) {
    const out = def.compute(ctx) || {};
    if (out.status === "pending") return { id: def.id, status: "pending", entries: [], note: out.note || null };
    const rows = (out.rows || []).filter((r) => r && Number.isFinite(r.raw));
    if (!rows.length) return { id: def.id, status: "empty", entries: [], note: out.note || null };

    const dir = def.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => dir * (a.raw - b.raw) || (a.tie || 0) - (b.tie || 0) || (a.when || 0) - (b.when || 0) || String(a.name || a.key).localeCompare(String(b.name || b.key)));

    const fmt = typeof def.fmt === "function" ? def.fmt : FORMATS[def.fmt || "int"];
    let rank = 0;
    let prev = null;
    const entries = rows.slice(0, TOP_N).map((r, i) => {
      if (prev == null || Math.abs(r.raw - prev) > EPS) rank = i + 1;
      prev = r.raw;
      return {
        rank,
        name: r.name || ctx.name(r.key),
        key: r.key || null,
        playerId: r.playerId || null,
        raw: r.raw,
        when: r.when != null ? r.when : null,
        valueText: fmt(r.raw, r),
        detail: r.detail || "",
      };
    });
    const leaderRaw = rows[0].raw;
    const tied = rows.filter((r) => Math.abs(r.raw - leaderRaw) <= EPS).length - 1;
    return { id: def.id, status: "ok", entries, tied, note: out.note || null, headline: out.headline ? { ...out.headline, name: out.headline.name || ctx.name(out.headline.key) } : null };
  }

  // Lays one category out as the page shows it: sections in definition
  // order, each with its records computed for the given context.
  function computeCategory(categoryId, ctx) {
    const sections = [];
    const byName = new Map();
    RecordBook.DEFS.filter((d) => d.cat === categoryId).forEach((def) => {
      if (!byName.has(def.section)) {
        const s = { title: def.section, records: [] };
        byName.set(def.section, s);
        sections.push(s);
      }
      byName.get(def.section).records.push({ def, result: compute(def, ctx) });
    });
    return sections;
  }

  function countByCategory() {
    const counts = {};
    CATEGORIES.forEach((c) => (counts[c.id] = 0));
    RecordBook.DEFS.forEach((d) => (counts[d.cat] = (counts[d.cat] || 0) + 1));
    return counts;
  }

  return {
    MIN_SEASONS,
    BLOWOUT_MARGIN,
    NARROW_MARGIN,
    CATEGORIES,
    RAW_STATS,
    FORMATS,
    DEFS: [], // filled in by record-defs.js
    TOP_N,
    buildFacts,
    eras,
    seasonsForEra,
    context,
    compute,
    computeCategory,
    countByCategory,
    helpers: { groupBy, sum, winPct, seasonOrder, MINUS },
  };
})();
