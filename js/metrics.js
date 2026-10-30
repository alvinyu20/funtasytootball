/*
  ============================================================
  METRICS — the league's "value" yardsticks, in one place
  ============================================================
  Draft grades, the league MVP, pickups, trade verdicts, injury luck, the
  MVP race. Everything here is plain functions over the same data every page
  already loads (a season chain + each season's weekly data + the player
  directory + data/injuries.json), so the Draft, Teams, Season and Trades
  pages and the Power Rankings build script all get the same answers.

  Shared ideas (decided with the league):

  • PAR ("points above replacement"): a player's points in the games he
    played, minus what a replacement-level player at his position scores per
    game. Replacement = the same rule the site already uses (the weakest
    player who wins a starting slot league-wide), measured on the REGULAR
    season only.
  • Wins: PAR ÷ points-per-win, where points-per-win is measured from the
    league's own history (season points needed per extra win).
  • Injury credit: a week a player is on the injury report (Out / Doubtful /
    IR) is not held against him. He gets INJURY_CREDIT of his healthy
    per-game surplus for it instead.
  • Lineup math: whenever a roster's value is at stake (trades, injuries) we
    ask "what is the best lineup this roster could field?", using the real
    starting slots (QB, RB, WR, TE, FLEX, SUPER_FLEX, K, DEF).

  Browser-global style like the other files in js/ (no modules). Needs
  DeepHistory (deep-history.js) and SleeperAPI (sleeper-api.js) loaded first.
  ============================================================
*/

const Metrics = {
  KNOWN_POSITIONS: ["QB", "RB", "WR", "TE", "K", "DEF"],
  LOW_IMPACT_POSITIONS: ["K", "DEF"],

  // 50%: a week lost to the injury report earns half of the player's healthy
  // per-game surplus. Applies to draft grades, trade assets and injury math.
  INJURY_CREDIT: 0.5,

  // Draft grades. A pick is compared with every pick made at the same stage
  // of the draft (within PEER_SHARE of its slot, at least PEER_FLOOR slots
  // either way) in the same lineup era, and the share of those it beat sets
  // the letter. S+ is reserved for the best SPLUS_SHARE of all graded picks
  // in league history, by points over what the slot normally returns.
  PEER_SHARE: 0.12,
  PEER_FLOOR: 3,
  PEER_MIN: 8,
  PEER_FALLBACK: 12,
  SPLUS_SHARE: 0.005,
  GRADE_BANDS: [
    { min: 93.3, grade: "S" },
    { min: 77.3, grade: "A" },
    { min: 50, grade: "B" },
    { min: 22.7, grade: "C" },
    { min: 6.7, grade: "D" },
    { min: -Infinity, grade: "F" },
  ],
  GRADE_ORDER: ["S+", "S", "A", "B", "C", "D", "F"],
  LOW_IMPACT_GRADE_CAP: "B",

  // Pickups: a kicker or defense has to be this much better than a skill
  // player to rank the same, so they show up on the list only when they are
  // truly outstanding.
  WIRE_LOW_IMPACT_FACTOR: 0.4,
  WIRE_MIN_BID_FOR_RATE: 1,

  // How many rounds of K shrinkage the injury model uses (same idea as the
  // site's existing injury luck: lean on the draft slot until a player has
  // played a few healthy games).
  INJURY_SHRINK_GAMES: 4,

  ELIGIBILITY: {
    FLEX: ["RB", "WR", "TE"],
    SUPER_FLEX: ["QB", "RB", "WR", "TE"],
    SUPERFLEX: ["QB", "RB", "WR", "TE"],
  },

  // ----------------------------------------------------------
  // helpers
  // ----------------------------------------------------------
  positionOf(playerDirectory, pid, fallback) {
    const p = playerDirectory && playerDirectory[pid];
    if (p && Metrics.KNOWN_POSITIONS.includes(p.position)) return p.position;
    if (fallback && Metrics.KNOWN_POSITIONS.includes(fallback)) return fallback;
    return null;
  },

  mean(xs) {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  },

  // Starting slots that count toward a lineup (no bench / IR / taxi).
  lineupSlots(league) {
    return (league.roster_positions || []).filter((s) => s !== "BN" && s !== "IR" && s !== "TAXI");
  },

  // Best possible lineup: fill the most restrictive slots first with the best
  // eligible player left, then the flex-type slots. cands: [{pid, pos, pts}].
  // Returns the chosen cands in slot order.
  bestLineup(slots, cands) {
    const elig = (slot) => Metrics.ELIGIBILITY[slot] || [slot];
    const order = [...slots].sort((a, b) => elig(a).length - elig(b).length);
    const sorted = [...cands].sort((a, b) => b.pts - a.pts);
    const used = new Set();
    const chosen = [];
    order.forEach((slot) => {
      const ok = elig(slot);
      const pick = sorted.find((c) => !used.has(c.pid) && ok.includes(c.pos));
      if (pick) {
        used.add(pick.pid);
        chosen.push({ slot, ...pick });
      }
    });
    return chosen;
  },

  bestLineupScore(slots, cands) {
    return Metrics.bestLineup(slots, cands).reduce((a, c) => a + c.pts, 0);
  },

  // Tiny seeded random numbers, so a simulation can be repeated exactly in a
  // test. mulberry32.
  makeRng(seed) {
    let a = seed >>> 0;
    const uniform = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    const normal = (mean, sd) => {
      if (spare != null) {
        const v = spare;
        spare = null;
        return mean + sd * v;
      }
      let u = 0;
      let v = 0;
      while (u === 0) u = uniform();
      while (v === 0) v = uniform();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return mean + sd * r * Math.cos(2 * Math.PI * v);
    };
    return { uniform, normal };
  },

  // ----------------------------------------------------------
  // one season's raw material
  // ----------------------------------------------------------
  prepareSeason(seasonEntry, deep, playerDirectory, injuriesData) {
    const { league, rosters, users } = seasonEntry;
    const season = String(league.season);
    const playoffStart = league.settings && league.settings.playoff_week_start != null ? league.settings.playoff_week_start : null;
    const usersById = new Map((users || []).map((u) => [u.user_id, u]));
    const rosterInfo = new Map();
    rosters.forEach((r) => {
      const user = usersById.get(r.owner_id);
      const username = user ? user.display_name : null;
      rosterInfo.set(r.roster_id, {
        rosterId: r.roster_id,
        userId: r.owner_id,
        username,
        teamName: username || SleeperAPI.teamName(user, r.roster_id),
      });
    });

    const weeks = ((deep && deep.weeks) || []).filter((w) => (w.matchups || []).some((m) => (m.points || 0) > 0)).sort((a, b) => a.week - b.week);
    const pts = new Map(); // pid -> Map(week -> points), every rostered player, every scored week
    const owner = new Map(); // "week|pid" -> rosterId
    const started = new Map(); // "week|pid" -> rosterId
    const matchupByRoster = new Map(); // "week|rosterId" -> matchup
    const pairsByWeek = new Map(); // week -> [[a, b], ...]
    weeks.forEach(({ week, matchups }) => {
      const byId = new Map();
      matchups.forEach((m) => {
        matchupByRoster.set(`${week}|${m.roster_id}`, m);
        Object.entries(m.players_points || {}).forEach(([pid, p]) => {
          if (!pts.has(pid)) pts.set(pid, new Map());
          pts.get(pid).set(week, p || 0);
        });
        (m.players || []).forEach((pid) => owner.set(`${week}|${pid}`, m.roster_id));
        (m.starters || []).forEach((pid) => {
          if (pid && pid !== "0") started.set(`${week}|${pid}`, m.roster_id);
        });
        if (m.matchup_id != null) {
          if (!byId.has(m.matchup_id)) byId.set(m.matchup_id, []);
          byId.get(m.matchup_id).push(m);
        }
      });
      pairsByWeek.set(
        week,
        [...byId.values()].filter((p) => p.length === 2)
      );
    });
    const allWeeks = weeks.map((w) => w.week);
    const regWeeks = allWeeks.filter((w) => playoffStart == null || w < playoffStart);

    // replacement level, measured on the regular season
    const regTotals = new Map();
    pts.forEach((byWeek, pid) => {
      let t = 0;
      regWeeks.forEach((w) => {
        if (byWeek.has(w)) t += byWeek.get(w);
      });
      regTotals.set(pid, t);
    });
    const starterPoints = DeepHistory._computeStarterPointsByPosition(league.roster_positions, rosters.length, regTotals, playerDirectory);
    const replacement = {};
    const replacementPerWeek = {};
    Object.entries(starterPoints).forEach(([pos, list]) => {
      if (!Metrics.KNOWN_POSITIONS.includes(pos)) return;
      replacement[pos] = Math.min(...list);
      replacementPerWeek[pos] = regWeeks.length ? replacement[pos] / regWeeks.length : 0;
    });

    // Weeks in which each roster plays a playoff game that counts: the path to
    // 1st or 3rd place (Sleeper's bracket marks side games, e.g. the 5th-place
    // game, with their own p value).
    const playoffGameWeeks = new Map();
    if (playoffStart != null && Array.isArray(seasonEntry.bracket)) {
      seasonEntry.bracket.forEach((g) => {
        if (g.p != null && g.p !== 1 && g.p !== 3) return;
        const wk = playoffStart + (g.r - 1);
        [g.t1, g.t2].forEach((rid) => {
          if (rid == null) return;
          if (!playoffGameWeeks.has(rid)) playoffGameWeeks.set(rid, new Set());
          playoffGameWeeks.get(rid).add(wk);
        });
      });
    }

    const injuries = DeepHistory.extractInjuriesForSeason(injuriesData, season);
    const picks = deep && deep.draft && deep.draft.picks ? deep.draft.picks.filter((p) => p.player_id) : [];
    const roster_positions = league.roster_positions || [];

    return {
      season,
      league,
      rosters,
      users,
      bracket: seasonEntry.bracket,
      transactions: (deep && deep.transactions) || [],
      playerDirectory,
      rosterInfo,
      status: league.status,
      complete: league.status === "complete",
      superflex: roster_positions.includes("SUPER_FLEX") || roster_positions.includes("SUPERFLEX"),
      numTeams: rosters.length,
      playoffStart,
      weeks,
      allWeeks,
      regWeeks,
      pts,
      owner,
      started,
      matchupByRoster,
      pairsByWeek,
      replacement,
      replacementPerWeek,
      playoffGameWeeks,
      injuries,
      picks,
      slots: Metrics.lineupSlots(league),
    };
  },

  isInjured(ctx, pid, week) {
    const w = ctx.injuries[pid];
    return !!(w && w[week] != null);
  },

  pointsOf(ctx, pid, week) {
    const m = ctx.pts.get(pid);
    return m && m.has(week) ? m.get(week) : 0;
  },

  // Points above replacement in the games a player played (regular season).
  parTable(ctx) {
    const table = new Map();
    ctx.pts.forEach((byWeek, pid) => {
      const pos = Metrics.positionOf(ctx.playerDirectory, pid);
      if (!pos || ctx.replacementPerWeek[pos] == null) return;
      const rw = ctx.replacementPerWeek[pos];
      let par = 0;
      let gp = 0;
      let total = 0;
      ctx.regWeeks.forEach((w) => {
        const p = byWeek.get(w);
        if (p > 0) {
          par += p - rw;
          gp += 1;
          total += p;
        }
      });
      if (!gp) return;
      table.set(pid, { playerId: pid, position: pos, par, gp, points: total, ppg: total / gp, replacementPerWeek: rw });
    });
    // finish rank within position (by PAR)
    const byPos = {};
    table.forEach((v) => {
      (byPos[v.position] = byPos[v.position] || []).push(v);
    });
    Object.values(byPos).forEach((list) => {
      list.sort((a, b) => b.par - a.par);
      list.forEach((v, i) => {
        v.positionRank = i + 1;
      });
    });
    return table;
  },

  // A player's value over the regular season with the injury credit applied.
  //   value = Σ over healthy weeks (points − replacement/wk)
  //         + credit × (injured weeks) × max(0, his healthy surplus per game played)
  playerValue(ctx, pid, position, credit) {
    const c = credit == null ? Metrics.INJURY_CREDIT : credit;
    const rw = ctx.replacementPerWeek[position];
    if (rw == null) return null;
    let val = 0;
    let injuredWeeks = 0;
    let gp = 0;
    let healthyTotal = 0;
    const surplus = [];
    let total = 0;
    ctx.regWeeks.forEach((w) => {
      const p = Metrics.pointsOf(ctx, pid, w);
      total += p;
      if (Metrics.isInjured(ctx, pid, w)) {
        injuredWeeks += 1;
        return;
      }
      val += p - rw;
      if (p > 0) {
        gp += 1;
        healthyTotal += p;
        surplus.push(p - rw);
      }
    });
    val += c * injuredWeeks * Math.max(0, Metrics.mean(surplus));
    return { value: val, injuredWeeks, gamesPlayed: gp, healthyPpg: gp ? healthyTotal / gp : 0, total };
  },

  nameOf(ctx, pid, meta) {
    const n = SleeperAPI.playerName(ctx.playerDirectory, pid);
    if (n && !n.startsWith("Unknown Player")) return n;
    if (meta && (meta.first_name || meta.last_name)) return `${meta.first_name || ""} ${meta.last_name || ""}`.trim();
    return n;
  },

  // ----------------------------------------------------------
  // draft grades
  // ----------------------------------------------------------
  // ctxs: prepareSeason() results for every season, oldest first. Returns
  //   { bySeason: Map(season -> Map(pickNo -> result)), splus: [result] }
  // A season still in progress is not graded (its players have not finished
  // their year), and is not used as a comparison either.
  gradeDrafts(ctxs) {
    const bySeason = new Map();
    const graded = [];
    ctxs.forEach((ctx) => {
      const results = new Map();
      bySeason.set(ctx.season, results);
      const par = Metrics.parTable(ctx);
      const ordered = [...ctx.picks].sort((a, b) => a.pick_no - b.pick_no);
      const posCount = {};
      ordered.forEach((pk) => {
        const meta = pk.metadata || {};
        const pid = pk.player_id;
        const position = Metrics.positionOf(ctx.playerDirectory, pid, meta.position);
        const info = ctx.rosterInfo.get(pk.roster_id);
        const rid = pk.roster_id;
        let started = 0;
        let held = 0;
        ctx.regWeeks.forEach((w) => {
          if (ctx.started.get(`${w}|${pid}`) === rid) started += 1;
          if (ctx.owner.get(`${w}|${pid}`) === rid) held += 1;
        });
        if (position) posCount[position] = (posCount[position] || 0) + 1;
        const base = {
          season: ctx.season,
          pickNo: pk.pick_no,
          round: pk.round,
          pickInRound: pk.pick_no - (pk.round - 1) * ctx.numTeams,
          playerId: pid,
          player: Metrics.nameOf(ctx, pid, meta),
          position,
          rosterId: rid,
          username: info ? info.teamName : null,
          isKeeper: !!pk.is_keeper,
          startedWeeks: started,
          heldWeeks: held,
          positionDraftRank: position ? posCount[position] : null,
          positionFinishRank: par.has(pid) ? par.get(pid).positionRank : null,
          value: null,
          typical: null,
          valueOverSlot: null,
          percentile: null,
          grade: null,
          ungraded: true,
          injuredWeeks: 0,
          gamesPlayed: 0,
          healthyPpg: 0,
          totalPoints: 0,
          superflex: ctx.superflex,
        };
        const v = position ? Metrics.playerValue(ctx, pid, position) : null;
        if (v) {
          base.injuredWeeks = v.injuredWeeks;
          base.gamesPlayed = v.gamesPlayed;
          base.healthyPpg = v.healthyPpg;
          base.totalPoints = v.total;
        }
        if (v && ctx.complete) {
          base.value = Math.max(0, v.value); // a dead roster spot is worth zero, not a debt
          base.ungraded = false;
          graded.push(base);
        }
        results.set(pk.pick_no, base);
      });
    });

    // compare each pick with its peers: same lineup era, similar slot
    const eras = new Map();
    graded.forEach((r) => {
      const k = r.superflex ? "SF" : "STD";
      if (!eras.has(k)) eras.set(k, []);
      eras.get(k).push(r);
    });
    eras.forEach((rows) => {
      rows.forEach((r) => {
        const half = Math.max(Metrics.PEER_FLOOR, Metrics.PEER_SHARE * r.pickNo);
        let peers = rows.filter((q) => q !== r && Math.abs(q.pickNo - r.pickNo) <= half);
        if (peers.length < Metrics.PEER_MIN) {
          peers = rows
            .filter((q) => q !== r)
            .sort((a, b) => Math.abs(a.pickNo - r.pickNo) - Math.abs(b.pickNo - r.pickNo))
            .slice(0, Metrics.PEER_FALLBACK);
        }
        if (!peers.length) {
          r.ungraded = true;
          return;
        }
        let below = 0;
        let equal = 0;
        peers.forEach((q) => {
          if (q.value < r.value) below += 1;
          else if (q.value === r.value) equal += 1;
        });
        r.percentile = (100 * (below + 0.5 * equal)) / peers.length;
        r.typical = Metrics.mean(peers.map((q) => q.value));
        r.valueOverSlot = r.value - r.typical;
        let grade = Metrics.GRADE_BANDS.find((b) => r.percentile >= b.min).grade;
        if (Metrics.LOW_IMPACT_POSITIONS.includes(r.position) && (grade === "S" || grade === "A")) grade = Metrics.LOW_IMPACT_GRADE_CAP;
        r.grade = grade;
      });
    });

    // S+: the best SPLUS_SHARE of every graded pick in league history (by
    // points over slot), among the picks that already earned an S.
    const eligible = graded.filter((r) => r.grade === "S" && !Metrics.LOW_IMPACT_POSITIONS.includes(r.position));
    const gradedCount = graded.filter((r) => r.grade).length;
    const n = Math.round(gradedCount * Metrics.SPLUS_SHARE);
    const splus = [...eligible].sort((a, b) => b.valueOverSlot - a.valueOverSlot).slice(0, n);
    splus.forEach((r) => {
      r.grade = "S+";
    });
    return { bySeason, splus };
  },

  // ----------------------------------------------------------
  // league-wide yardsticks measured from the league's own history
  // ----------------------------------------------------------
  pointsPerWin(ctxs) {
    let sxx = 0;
    let sxy = 0;
    ctxs.forEach((ctx) => {
      if (!ctx.complete) return;
      const rows = [];
      ctx.rosters.forEach((r) => {
        const s = r.settings || {};
        const g = (s.wins || 0) + (s.losses || 0) + (s.ties || 0);
        if (!g) return;
        rows.push({ wins: (((s.wins || 0) + 0.5 * (s.ties || 0)) / g) * 14, pf: (((s.fpts || 0) + (s.fpts_decimal || 0) / 100) / g) * 14 });
      });
      const mw = Metrics.mean(rows.map((r) => r.wins));
      const mp = Metrics.mean(rows.map((r) => r.pf));
      rows.forEach((r) => {
        sxx += (r.pf - mp) * (r.pf - mp);
        sxy += (r.pf - mp) * (r.wins - mw);
      });
    });
    return sxy > 0 ? sxx / sxy : 85.8;
  },

  // ----------------------------------------------------------
  // season awards
  // ----------------------------------------------------------
  // How many results a player swung for the rosters that started him: games
  // those rosters won that they would have lost with a replacement-level
  // player in his place.
  resultsSwung(ctx, pid, position) {
    const rw = ctx.replacementPerWeek[position];
    if (rw == null) return 0;
    let swung = 0;
    ctx.regWeeks.forEach((w) => {
      const rid = ctx.started.get(`${w}|${pid}`);
      if (rid == null) return;
      const mine = ctx.matchupByRoster.get(`${w}|${rid}`);
      if (!mine) return;
      const pair = (ctx.pairsByWeek.get(w) || []).find((p) => p.includes(mine));
      if (!pair) return;
      const opp = pair[0] === mine ? pair[1] : pair[0];
      const surplus = Metrics.pointsOf(ctx, pid, w) - rw;
      if ((mine.points || 0) > (opp.points || 0) && (mine.points || 0) - surplus < (opp.points || 0)) swung += 1;
    });
    return swung;
  },

  holderLabel(ctx, pid) {
    // who had him at the end of the regular season, else the last team to hold him
    for (let i = ctx.regWeeks.length - 1; i >= 0; i--) {
      const rid = ctx.owner.get(`${ctx.regWeeks[i]}|${pid}`);
      if (rid != null) return (ctx.rosterInfo.get(rid) || {}).teamName || null;
    }
    return null;
  },

  seasonAwards(ctx, draftResults, constants) {
    const ppw = (constants && constants.pointsPerWin) || 85.8;
    const par = Metrics.parTable(ctx);
    const all = [...par.values()].sort((a, b) => b.par - a.par);
    const decorate = (r) => ({
      playerId: r.playerId,
      player: Metrics.nameOf(ctx, r.playerId),
      position: r.position,
      par: r.par,
      wins: r.par / ppw,
      ppg: r.ppg,
      gamesPlayed: r.gp,
      owner: Metrics.holderLabel(ctx, r.playerId),
      swung: Metrics.resultsSwung(ctx, r.playerId, r.position),
    });
    const mvp = { All: all.slice(0, 5).map(decorate) };
    Metrics.KNOWN_POSITIONS.forEach((pos) => {
      mvp[pos] = all.filter((r) => r.position === pos).slice(0, 5).map(decorate);
    });

    // the champion's top scorer, regular season and playoffs (the site's
    // long-standing "Season MVP", now its own award)
    let championsAce = null;
    const champId = ctx.bracket ? SleeperAPI.findChampionRosterId(ctx.bracket) : null;
    if (champId != null) {
      const totals = new Map();
      ctx.allWeeks.forEach((w) => {
        const m = ctx.matchupByRoster.get(`${w}|${champId}`);
        if (!m) return;
        (m.starters || []).forEach((pid) => {
          if (!pid || pid === "0") return;
          totals.set(pid, (totals.get(pid) || 0) + ((m.players_points || {})[pid] || 0));
        });
      });
      let best = null;
      totals.forEach((p, pid) => {
        if (!best || p > best.points) best = { playerId: pid, points: p };
      });
      if (best) {
        const info = ctx.rosterInfo.get(champId);
        championsAce = {
          playerId: best.playerId,
          player: Metrics.nameOf(ctx, best.playerId),
          position: Metrics.positionOf(ctx.playerDirectory, best.playerId),
          points: best.points,
          team: info ? info.teamName : null,
        };
      }
    }

    const out = { season: ctx.season, regularWeeks: ctx.regWeeks.length, complete: ctx.complete, mvp, championsAce, steals: [], busts: [], cursed: [] };
    if (ctx.complete && draftResults) {
      const picks = [...draftResults.values()].filter((r) => !r.ungraded && r.grade && !Metrics.LOW_IMPACT_POSITIONS.includes(r.position));
      out.steals = [...picks].sort((a, b) => b.valueOverSlot - a.valueOverSlot).slice(0, 5);
      out.busts = picks.filter((r) => r.injuredWeeks <= 2).sort((a, b) => a.valueOverSlot - b.valueOverSlot).slice(0, 5);
      out.cursed = picks.filter((r) => r.injuredWeeks >= 3 && r.valueOverSlot < 0).sort((a, b) => a.valueOverSlot - b.valueOverSlot).slice(0, 5);
    }
    return out;
  },

  // ----------------------------------------------------------
  // waiver and free-agent pickups ("Wire Value")
  // ----------------------------------------------------------
  WIRE_HIT: 15,

  swungFor(ctx, pid, position, rosterId, weeks) {
    const rw = ctx.replacementPerWeek[position];
    if (rw == null) return 0;
    let swung = 0;
    weeks.forEach((w) => {
      if (ctx.started.get(`${w}|${pid}`) !== rosterId) return;
      const mine = ctx.matchupByRoster.get(`${w}|${rosterId}`);
      if (!mine) return;
      const pair = (ctx.pairsByWeek.get(w) || []).find((p) => p.includes(mine));
      if (!pair) return;
      const opp = pair[0] === mine ? pair[1] : pair[0];
      const surplus = Metrics.pointsOf(ctx, pid, w) - rw;
      if ((mine.points || 0) > (opp.points || 0) && (mine.points || 0) - surplus < (opp.points || 0)) swung += 1;
    });
    return swung;
  },

  // Every completed add (waiver claim or free agent) in the regular season.
  // Wire Value = points above replacement in the games the claiming team
  // started him, from the claim until he left that roster, playoff games
  // included (a pickup who helps win the title should count). Kickers and
  // defenses count 40% as much, so they show up only when outstanding.
  wire(ctx) {
    const par = Metrics.parTable(ctx);
    const last = ctx.regWeeks[ctx.regWeeks.length - 1];
    const pickups = [];
    ctx.transactions.forEach((tx) => {
      if (!tx || tx.status !== "complete" || tx.type === "trade") return;
      const leg = tx.leg;
      if (leg == null || last == null || leg > last) return;
      const bid = tx.settings && tx.settings.waiver_bid != null ? tx.settings.waiver_bid : 0;
      Object.entries(tx.adds || {}).forEach(([pid, rid]) => {
        const info = ctx.rosterInfo.get(rid);
        const position = Metrics.positionOf(ctx.playerDirectory, pid);
        if (!info || !position || ctx.replacementPerWeek[position] == null) return;
        const rw = ctx.replacementPerWeek[position];
        let raw = 0;
        let startedWeeks = 0;
        let heldWeeks = 0;
        const heldList = [];
        let broken = false;
        ctx.allWeeks.forEach((w) => {
          if (broken || w < leg) return;
          if (w > leg && ctx.owner.get(`${w}|${pid}`) !== rid) {
            broken = true;
            return;
          }
          // playoff weeks only count when the claiming team plays a counted game
          if (ctx.playoffStart != null && w >= ctx.playoffStart) {
            const games = ctx.playoffGameWeeks.get(rid);
            if (!games || !games.has(w)) return;
          }
          heldList.push(w);
          heldWeeks += 1;
          if (ctx.started.get(`${w}|${pid}`) === rid) {
            raw += Metrics.pointsOf(ctx, pid, w) - rw;
            startedWeeks += 1;
          }
        });
        const factor = Metrics.LOW_IMPACT_POSITIONS.includes(position) ? Metrics.WIRE_LOW_IMPACT_FACTOR : 1;
        const p = par.get(pid);
        pickups.push({
          season: ctx.season,
          week: leg,
          type: tx.type,
          playerId: pid,
          player: Metrics.nameOf(ctx, pid),
          position,
          rosterId: rid,
          username: info.teamName,
          bid,
          startedWeeks,
          heldWeeks,
          rawValue: raw,
          value: raw * factor,
          swung: Metrics.swungFor(ctx, pid, position, rid, heldList),
          finishRank: p ? p.positionRank : null,
        });
      });
    });
    pickups.sort((a, b) => b.value - a.value);

    const byManager = new Map();
    pickups.forEach((r) => {
      if (!byManager.has(r.rosterId)) byManager.set(r.rosterId, { rosterId: r.rosterId, username: r.username, value: 0, claims: 0, hits: 0, faab: 0, swung: 0 });
      const m = byManager.get(r.rosterId);
      m.value += Math.max(0, r.value);
      m.claims += 1;
      m.hits += r.value >= Metrics.WIRE_HIT ? 1 : 0;
      m.faab += r.bid || 0;
      m.swung += r.swung;
    });
    return { pickups, managers: [...byManager.values()].sort((a, b) => b.value - a.value) };
  },

  // What a FAAB dollar has bought in this league: the Wire Value of paid
  // claims per dollar bid, over finished seasons.
  faabPointsPerDollar(wires) {
    let value = 0;
    let bid = 0;
    wires.forEach((w) => {
      w.pickups.forEach((r) => {
        if (r.bid >= Metrics.WIRE_MIN_BID_FOR_RATE) {
          value += Math.max(0, r.rawValue);
          bid += r.bid;
        }
      });
    });
    return bid > 0 ? value / bid : 0;
  },

  // ----------------------------------------------------------
  // trades
  // ----------------------------------------------------------
  // A traded player's points in a week, with injured weeks credited.
  creditedPoints(ctx, pid, week, cache) {
    const p = Metrics.pointsOf(ctx, pid, week);
    if (!Metrics.isInjured(ctx, pid, week)) return p;
    if (!cache.has(pid)) {
      const played = [];
      ctx.regWeeks.forEach((w) => {
        const q = Metrics.pointsOf(ctx, pid, w);
        if (q > 0 && !Metrics.isInjured(ctx, pid, w)) played.push(q);
      });
      cache.set(pid, Metrics.mean(played));
    }
    return Math.max(p, Metrics.INJURY_CREDIT * cache.get(pid));
  },

  // Points above replacement a player produced from `fromWeek` on (injury
  // credit applied). Shown beside each player in a trade; not the verdict.
  assetPar(ctx, pid, position, fromWeek) {
    const rw = ctx.replacementPerWeek[position];
    if (rw == null) return 0;
    let par = 0;
    let injured = 0;
    const surplus = [];
    ctx.regWeeks.forEach((w) => {
      const p = Metrics.pointsOf(ctx, pid, w);
      if (Metrics.isInjured(ctx, pid, w)) {
        if (w >= fromWeek) injured += 1;
        return;
      }
      if (p > 0) {
        surplus.push(p - rw);
        if (w >= fromWeek) par += p - rw;
      }
    });
    return par + Metrics.INJURY_CREDIT * injured * Math.max(0, Metrics.mean(surplus));
  },

  // Each completed trade, judged by what it did to each roster's best
  // possible lineup from the trade on: the roster as it really was, against
  // the roster with the received players removed and the sent players
  // kept. That is why a 2-for-1 that lands the best player shows up: the
  // depth piece you gave up gets replaced from the bench. FAAB changes hands
  // at the league's own dollars-to-points rate.
  trades(ctx, constants) {
    const ppw = (constants && constants.pointsPerWin) || 85.8;
    const rate = (constants && constants.faabPointsPerDollar) || 0;
    const out = [];
    ctx.transactions.forEach((tx) => {
      if (!tx || tx.type !== "trade" || tx.status !== "complete") return;
      const leg = tx.leg;
      const rids = (tx.roster_ids || []).filter((r) => ctx.rosterInfo.has(r));
      if (leg == null || rids.length < 2) return;
      const sides = rids.map((rid) => ({ rosterId: rid, username: ctx.rosterInfo.get(rid).teamName, received: [], sent: [], faabIn: 0, faabOut: 0 }));
      const side = (rid) => sides.find((s) => s.rosterId === rid);
      Object.entries(tx.adds || {}).forEach(([pid, rid]) => side(rid) && side(rid).received.push(pid));
      Object.entries(tx.drops || {}).forEach(([pid, rid]) => side(rid) && side(rid).sent.push(pid));
      (tx.waiver_budget || []).forEach((wb) => {
        if (side(wb.receiver)) side(wb.receiver).faabIn += wb.amount;
        if (side(wb.sender)) side(wb.sender).faabOut += wb.amount;
      });
      const weeks = ctx.regWeeks.filter((w) => w >= leg);
      const cache = new Map();
      sides.forEach((s) => {
        const traded = new Set([...s.received, ...s.sent]);
        let gain = 0;
        let reflected = false;
        let startedWeeks = 0;
        weeks.forEach((w) => {
          const m = ctx.matchupByRoster.get(`${w}|${s.rosterId}`);
          if (!m) return;
          const onRoster = new Set(m.players || []);
          if (!reflected) {
            reflected = s.received.some((pid) => onRoster.has(pid)) || (s.sent.length > 0 && s.sent.every((pid) => !onRoster.has(pid)));
          }
          if (!reflected || !traded.size) return;
          const cand = (pid) => {
            const pos = Metrics.positionOf(ctx.playerDirectory, pid);
            if (!pos) return null;
            return { pid, pos, pts: traded.has(pid) ? Metrics.creditedPoints(ctx, pid, w, cache) : Metrics.pointsOf(ctx, pid, w) };
          };
          const actual = [...onRoster].map(cand).filter(Boolean);
          const counter = actual.filter((c) => !s.received.includes(c.pid));
          s.sent.forEach((pid) => {
            if (!counter.some((c) => c.pid === pid)) {
              const c = cand(pid);
              if (c) counter.push(c);
            }
          });
          gain += Metrics.bestLineupScore(ctx.slots, actual) - Metrics.bestLineupScore(ctx.slots, counter);
          s.received.forEach((pid) => {
            if (ctx.started.get(`${w}|${pid}`) === s.rosterId) startedWeeks += 1;
          });
        });
        const detail = (pid) => {
          const position = Metrics.positionOf(ctx.playerDirectory, pid);
          return {
            playerId: pid,
            player: Metrics.nameOf(ctx, pid),
            position,
            par: position ? Metrics.assetPar(ctx, pid, position, leg) : 0,
            injured: Metrics.isInjured(ctx, pid, weeks[weeks.length - 1]) && ctx.regWeeks.filter((w) => w >= leg && Metrics.isInjured(ctx, pid, w)).length >= 3,
          };
        };
        s.receivedDetail = s.received.map(detail);
        s.sentDetail = s.sent.map(detail);
        s.lineupPoints = gain;
        s.faabNet = s.faabIn - s.faabOut;
        s.faabPoints = s.faabNet * rate;
        s.totalPoints = gain + s.faabPoints;
        s.wins = s.totalPoints / ppw;
        s.startedWeeks = startedWeeks;
      });
      const ranked = [...sides].sort((a, b) => b.wins - a.wins);
      out.push({
        season: ctx.season,
        week: leg,
        transactionId: tx.transaction_id,
        pending: !ctx.complete,
        weeksCounted: weeks.length,
        winnerRosterId: ranked[0].wins - ranked[1].wins > 0.005 ? ranked[0].rosterId : null,
        margin: ranked[0].wins - ranked[ranked.length - 1].wins,
        sides,
      });
    });
    return out;
  },

  // ----------------------------------------------------------
  // injury luck
  // ----------------------------------------------------------
  // What a drafted player at a given slot normally scores per game when
  // healthy, by position: points ≈ a + b·ln(pick), fit over every draft in
  // the league's history.
  injuryBaseline(ctxs) {
    const byPos = {};
    ctxs.forEach((ctx) => {
      ctx.picks.forEach((pk) => {
        const pos = Metrics.positionOf(ctx.playerDirectory, pk.player_id, pk.metadata && pk.metadata.position);
        if (!["QB", "RB", "WR", "TE"].includes(pos)) return;
        const healthy = [];
        ctx.regWeeks.forEach((w) => {
          const p = Metrics.pointsOf(ctx, pk.player_id, w);
          if (p > 0 && !Metrics.isInjured(ctx, pk.player_id, w)) healthy.push(p);
        });
        if (healthy.length < 3) return;
        (byPos[pos] = byPos[pos] || []).push([Math.log(pk.pick_no), Metrics.mean(healthy)]);
      });
    });
    const models = {};
    Object.entries(byPos).forEach(([pos, rows]) => {
      if (rows.length < 8) return;
      const mx = Metrics.mean(rows.map((r) => r[0]));
      const my = Metrics.mean(rows.map((r) => r[1]));
      let sxx = 0;
      let sxy = 0;
      rows.forEach(([x, y]) => {
        sxx += (x - mx) * (x - mx);
        sxy += (x - mx) * (y - my);
      });
      const slope = sxx ? sxy / sxx : 0;
      models[pos] = { slope, intercept: my - slope * mx };
    });
    return models;
  },

  expectedPpg(ctx, pid, position, pickNo, models) {
    const rw = ctx.replacementPerWeek[position] || 0;
    const healthy = [];
    ctx.regWeeks.forEach((w) => {
      const p = Metrics.pointsOf(ctx, pid, w);
      if (p > 0 && !Metrics.isInjured(ctx, pid, w)) healthy.push(p);
    });
    const m = models[position];
    const baseline = pickNo && m ? Math.max(rw, m.intercept + m.slope * Math.log(pickNo)) : rw * 1.15;
    const k = Metrics.INJURY_SHRINK_GAMES;
    const n = healthy.length;
    return n ? (n * Metrics.mean(healthy) + k * baseline) / (n + k) : baseline;
  },

  // Each week, every roster's best lineup if its injured players had played
  // to expectation, minus its best lineup as it really was. A player on the
  // injury report is charged to whoever holds him that week; if nobody
  // holds him (he was dropped), to the last team that did. A dropped star
  // is added back to that team's roster at his expected output.
  injuryLuck(ctx, models) {
    const picks = new Map(ctx.picks.map((p) => [p.player_id, p.pick_no]));
    const expCache = new Map();
    const expected = (pid, position) => {
      if (!expCache.has(pid)) expCache.set(pid, Metrics.expectedPpg(ctx, pid, position, picks.get(pid), models));
      return expCache.get(pid);
    };
    const lastHolder = new Map();
    const extra = new Map(); // "week|rid" -> [{pid, position, exp, held}]
    ctx.regWeeks.forEach((w) => {
      ctx.rosters.forEach((r) => {
        const m = ctx.matchupByRoster.get(`${w}|${r.roster_id}`);
        if (m) (m.players || []).forEach((pid) => lastHolder.set(pid, r.roster_id));
      });
      Object.keys(ctx.injuries).forEach((pid) => {
        if (!Metrics.isInjured(ctx, pid, w)) return;
        const position = Metrics.positionOf(ctx.playerDirectory, pid);
        if (!position) return;
        const held = ctx.owner.get(`${w}|${pid}`);
        const rid = held != null ? held : lastHolder.get(pid);
        if (rid == null) return;
        const key = `${w}|${rid}`;
        if (!extra.has(key)) extra.set(key, []);
        extra.get(key).push({ pid, position, exp: expected(pid, position), held: held != null });
      });
    });

    const teams = new Map();
    const ensure = (rid) => {
      if (!teams.has(rid)) teams.set(rid, { rosterId: rid, lost: 0, resultsLost: 0, resultsGifted: 0, players: new Map() });
      return teams.get(rid);
    };
    const weekly = new Map();
    ctx.regWeeks.forEach((w) => {
      ctx.rosters.forEach((r) => {
        const rid = r.roster_id;
        const m = ctx.matchupByRoster.get(`${w}|${rid}`);
        if (!m) return;
        const actual = [];
        const healthy = [];
        const flagged = [];
        (m.players || []).forEach((pid) => {
          const position = Metrics.positionOf(ctx.playerDirectory, pid);
          if (!position) return;
          const p = (m.players_points || {})[pid] || 0;
          actual.push({ pid, pos: position, pts: p });
          let eff = p;
          if (Metrics.isInjured(ctx, pid, w)) {
            const e = expected(pid, position);
            if (e > p) {
              eff = e;
              flagged.push({ pid, loss: e - p });
            }
          }
          healthy.push({ pid, pos: position, pts: eff });
        });
        const on = new Set(actual.map((c) => c.pid));
        (extra.get(`${w}|${rid}`) || []).forEach((x) => {
          if (!on.has(x.pid)) {
            healthy.push({ pid: x.pid, pos: x.position, pts: x.exp });
            flagged.push({ pid: x.pid, loss: x.exp });
          }
        });
        const delta = Math.max(0, Metrics.bestLineupScore(ctx.slots, healthy) - Metrics.bestLineupScore(ctx.slots, actual));
        weekly.set(`${w}|${rid}`, delta);
        const t = ensure(rid);
        t.lost += delta;
        const tot = flagged.reduce((a, f) => a + f.loss, 0);
        if (delta > 0 && tot > 0) {
          flagged.forEach((f) => {
            const e = t.players.get(f.pid) || { lost: 0, weeks: 0 };
            e.lost += (delta * f.loss) / tot;
            e.weeks += 1;
            t.players.set(f.pid, e);
          });
        }
      });
    });
    ctx.regWeeks.forEach((w) => {
      (ctx.pairsByWeek.get(w) || []).forEach((pair) => {
        [
          [pair[0], pair[1]],
          [pair[1], pair[0]],
        ].forEach(([a, b]) => {
          const da = weekly.get(`${w}|${a.roster_id}`) || 0;
          const db = weekly.get(`${w}|${b.roster_id}`) || 0;
          if ((a.points || 0) < (b.points || 0) && (a.points || 0) + da > (b.points || 0)) ensure(a.roster_id).resultsLost += 1;
          if ((a.points || 0) > (b.points || 0) && (a.points || 0) < (b.points || 0) + db) ensure(a.roster_id).resultsGifted += 1;
        });
      });
    });

    const list = ctx.rosters.map((r) => {
      const t = ensure(r.roster_id);
      const info = ctx.rosterInfo.get(r.roster_id) || {};
      return {
        season: ctx.season,
        rosterId: r.roster_id,
        username: info.teamName,
        pointsLost: t.lost,
        resultsLost: t.resultsLost,
        resultsGifted: t.resultsGifted,
        players: [...t.players.entries()]
          .map(([pid, e]) => ({ playerId: pid, player: Metrics.nameOf(ctx, pid), position: Metrics.positionOf(ctx.playerDirectory, pid), pointsLost: e.lost, weeks: e.weeks }))
          .sort((a, b) => b.pointsLost - a.pointsLost),
      };
    });
    list.sort((a, b) => b.pointsLost - a.pointsLost);
    const playerInjuries = [];
    list.forEach((t) => t.players.forEach((p) => playerInjuries.push({ ...p, rosterId: t.rosterId, username: t.username, season: ctx.season })));
    playerInjuries.sort((a, b) => b.pointsLost - a.pointsLost);
    return { teams: list, playerInjuries };
  },

  // ----------------------------------------------------------
  // the MVP race (simulated finish of the regular season)
  // ----------------------------------------------------------
  // Rank by projected final PAR; chance of finishing first from a simulation:
  // each remaining week a player scores around his own pace (pulled toward
  // what the position's top players average, ten games' worth), may miss the
  // week (bye / inactive), and may be lost for the season.
  mvpRace(ctx, totalWeeks, options) {
    const o = Object.assign({ sims: 20000, candidates: 40, top: 8, prior: 10, weeklyMiss: 0.08, seasonEndingHazard: 0.03, seed: 11 }, options || {});
    const ppw = o.pointsPerWin || 85.8;
    const rng = Metrics.makeRng(o.seed);
    const par = Metrics.parTable(ctx);
    const through = ctx.regWeeks.length ? ctx.regWeeks[ctx.regWeeks.length - 1] : 0;
    const remaining = Math.max(0, totalWeeks - through);
    const byPos = {};
    par.forEach((v) => (byPos[v.position] = byPos[v.position] || []).push(v.ppg));
    const priors = {};
    Object.entries(byPos).forEach(([pos, list]) => {
      priors[pos] = Metrics.mean([...list].sort((a, b) => b - a).slice(0, 24));
    });
    const cands = [...par.values()].sort((a, b) => b.par - a.par).slice(0, o.candidates);
    const totals = cands.map((c) => new Float64Array(o.sims).fill(c.par));
    cands.forEach((c, j) => {
      const games = [];
      ctx.regWeeks.forEach((w) => {
        const p = Metrics.pointsOf(ctx, c.playerId, w);
        if (p > 0) games.push(p);
      });
      const n = games.length;
      const own = Metrics.mean(games);
      const mu = (n * own + o.prior * priors[c.position]) / (n + o.prior);
      const mean = own;
      const sdOwn = n > 2 ? Math.sqrt(games.reduce((a, g) => a + (g - mean) * (g - mean), 0) / (n - 1)) : 0;
      const sd = Math.max(0.45 * mu, sdOwn);
      for (let s = 0; s < o.sims; s++) {
        const talent = rng.normal(mu, sd / Math.sqrt(n + o.prior));
        let alive = true;
        let t = totals[j][s];
        for (let k = 0; k < remaining; k++) {
          if (rng.uniform() < o.seasonEndingHazard) alive = false;
          if (alive && rng.uniform() > o.weeklyMiss) t += Math.max(0, rng.normal(talent, sd)) - c.replacementPerWeek;
        }
        totals[j][s] = t;
      }
    });
    const wins = new Array(cands.length).fill(0);
    const sums = new Array(cands.length).fill(0);
    for (let s = 0; s < o.sims; s++) {
      let best = 0;
      for (let j = 0; j < cands.length; j++) {
        sums[j] += totals[j][s];
        if (totals[j][s] > totals[best][s]) best = j;
      }
      wins[best] += 1;
    }
    const rows = cands.map((c, j) => {
      const weeksPts = ctx.regWeeks.map((w) => Metrics.pointsOf(ctx, c.playerId, w));
      return {
        playerId: c.playerId,
        player: Metrics.nameOf(ctx, c.playerId),
        position: c.position,
        owner: Metrics.holderLabel(ctx, c.playerId),
        par: c.par,
        wins: c.par / ppw,
        ppg: c.ppg,
        gamesPlayed: c.gp,
        weekly: weeksPts,
        projectedPar: sums[j] / o.sims,
        chance: (100 * wins[j]) / o.sims,
      };
    });
    rows.sort((a, b) => b.projectedPar - a.projectedPar);
    return { throughWeek: through, remainingWeeks: remaining, sims: o.sims, rows: rows.slice(0, o.top) };
  },

  // ----------------------------------------------------------
  // everything for a set of seasons, computed on demand
  // ----------------------------------------------------------
  analyze(seasonChain, deepSeasons, playerDirectory, injuriesData) {
    const ctxs = [];
    seasonChain.forEach((entry, i) => {
      if (deepSeasons[i]) ctxs.push(Metrics.prepareSeason(entry, deepSeasons[i], playerDirectory, injuriesData));
    });
    const memo = new Map();
    const lazy = (key, fn) => {
      if (!memo.has(key)) memo.set(key, fn());
      return memo.get(key);
    };
    const api = {
      contexts: ctxs,
      ctx: (season) => ctxs.find((c) => c.season === String(season)) || null,
      drafts: () => lazy("drafts", () => Metrics.gradeDrafts(ctxs)),
      draftResults: (season) => api.drafts().bySeason.get(String(season)) || new Map(),
      wire: (season) => lazy(`wire|${season}`, () => (api.ctx(season) ? Metrics.wire(api.ctx(season)) : { pickups: [], managers: [] })),
      constants: () =>
        lazy("constants", () => ({
          pointsPerWin: Metrics.pointsPerWin(ctxs),
          faabPointsPerDollar: Metrics.faabPointsPerDollar(ctxs.filter((c) => c.complete).map((c) => api.wire(c.season))),
        })),
      awards: (season) => lazy(`awards|${season}`, () => (api.ctx(season) ? Metrics.seasonAwards(api.ctx(season), api.draftResults(season), api.constants()) : null)),
      trades: (season) => lazy(`trades|${season}`, () => (api.ctx(season) ? Metrics.trades(api.ctx(season), api.constants()) : [])),
      injuryModel: () => lazy("injuryModel", () => Metrics.injuryBaseline(ctxs)),
      injury: (season) => lazy(`injury|${season}`, () => (api.ctx(season) ? Metrics.injuryLuck(api.ctx(season), api.injuryModel()) : { teams: [], playerInjuries: [] })),
    };
    return api;
  },

  // Gives DeepHistory.computeStats' draft pick entries (the ones the Draft and
  // Teams pages render) the new grade and value fields. Entries are shared
  // objects, so everything that holds one sees the change.
  applyDraftGrades(managers, analysis) {
    const grades = analysis.drafts().bySeason;
    (managers || []).forEach((m) => {
      (m.seasons || []).forEach((s) => {
        const results = grades.get(String(s.season));
        (s.draftPicks || []).forEach((p) => {
          const r = results && results.get(p.pickNo);
          if (!r) return;
          p.grade = r.grade;
          p.ungraded = r.ungraded;
          p.value = r.value;
          p.typical = r.typical;
          p.valueOverSlot = r.valueOverSlot;
          p.injuredWeeks = r.injuredWeeks;
          p.gamesPlayed = r.gamesPlayed;
          p.startedWeeks = r.startedWeeks;
          p.heldWeeks = r.heldWeeks;
          p.positionDraftRank = r.positionDraftRank;
          p.positionFinishRank = r.positionFinishRank;
        });
      });
    });
  },
};
