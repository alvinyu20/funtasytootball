/*
  The Draft page's numbers (no DOM, so tests run it as it is): one season's picks, teams, rounds and
  tiles, the report card across every graded draft, and the all-time best and costliest picks.

  Everything starts from DeepHistory.computeStats(): each manager's seasons[].draftPicks, the league-wide
  grade curve (draftGradeModel) and the per-season facts (draftSeasons).

  Three words used all over:
    value    season points above a replacement player at that position (the VBD the grades use), rounded
    typical  what that draft slot usually returns, from the league's own curve, rounded
    vs slot  value minus typical, worked out from the two rounded numbers so the page always adds up

  A season that is still being played has no grades, value, typical or vs slot (they need a full year),
  so it is described with points and games instead.
*/
const DraftData = (function () {
  const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const GRADES = ["S", "A", "B", "C", "D", "F"];

  // The page's tunable numbers, in one place.
  const BOARD_BANDS = [60, 20, -20, -60]; // a pick's vs slot: b5 at +60 or more, b4 +20 to +59, b3 within 20, b2 -20 to -59, b1 -60 or less
  const TEAM_BANDS = [150, 50, -50, -150]; // a whole draft's total (made for a 16-round draft): the same five bands
  const LIST_SIZE = 6; // the short lists on the in-season page
  const HOT_AFTER_ROUND = 3; // "hot starts after round 3"
  const HOT_MIN_GAMES = 4; // ...needs this many games played
  const HOT_PPG = 20; // a pick scoring this many points a game or more is "hot" in the tables
  const HURT_MAX_ROUND = 8; // "early picks who are hurt" means rounds 1 to 8
  const HURT_MIN_INJ = 3; // ...with this many injury weeks
  const HALL_SIZE = 8; // best and costliest picks ever
  const SHORT_LIST = 3; // steals and costliest on the overview

  // ---- small helpers ---------------------------------------------------------------

  // Rounds .5 away from zero, so -2.5 is -3 the same way 2.5 is 3.
  const round = (x) => {
    const r = Math.round(Math.abs(x));
    return x < 0 && r ? -r : r; // never -0
  };
  const signed = (n) => (n == null ? "" : n > 0 ? `+${n}` : n < 0 ? `-${Math.abs(n)}` : "0");
  const ordinal = (n) => {
    const m100 = n % 100;
    if (m100 >= 11 && m100 <= 13) return `${n}th`;
    return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
  };
  const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);
  // "Brian Thomas Jr." is Thomas, "Puka Nacua" is Nacua, "San Francisco 49ers" is 49ers.
  function lastName(full) {
    const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
    while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1].toLowerCase())) parts.pop();
    return parts[parts.length - 1] || "";
  }
  const nameOf = (m) => (m ? m.username || m.teamName || "" : "");
  const canBeSteal = (p) => !p.capped;

  // Five bands, b5 the best: `edges` are the cut points from highest to lowest.
  function bandBy(x, edges) {
    if (x == null) return "none";
    if (x >= edges[0]) return "b5";
    if (x >= edges[1]) return "b4";
    if (x > edges[2]) return "b3";
    if (x > edges[3]) return "b2";
    return "b1";
  }
  const bandOfVs = (vs) => bandBy(vs, BOARD_BANDS);
  const bandOfTotal = (total) => bandBy(total, TEAM_BANDS);

  // The grade a z-score earns before DeepHistory's caps (K and DEF, or a pick who missed over half the season, top out at B).
  const FALLBACK_BANDS = [{ min: 1.5, grade: "S" }, { min: 0.75, grade: "A" }, { min: 0, grade: "B" }, { min: -0.75, grade: "C" }, { min: -1.5, grade: "D" }, { min: -Infinity, grade: "F" }];
  function gradeOfZ(z) {
    const bands = (typeof DeepHistory !== "undefined" && DeepHistory.DRAFT_GRADE_BANDS) || FALLBACK_BANDS;
    const hit = bands.find((b) => z >= b.min);
    return hit ? hit.grade : null;
  }

  // ---- one pick ----------------------------------------------------------------------

  function shapePick(entry, manager, season, graded, model) {
    const points = entry.points || 0;
    let value = null;
    let typical = null;
    let vs = null;
    if (graded) {
      // The same number the grade is worked out from (DeepHistory's gradeDraftPick), so a pick's grade and
      // its vs slot always agree: the season's value at the pace he played when he was available.
      const basis = entry.gradingVbd != null ? entry.gradingVbd : entry.vbd;
      value = basis != null ? round(basis) : points <= 0 ? 0 : null;
      const expected = entry.expectedVbd != null ? entry.expectedVbd : model && typeof DeepHistory !== "undefined" ? DeepHistory.predictExpectedVBD(entry.pickNo, model) : null;
      typical = expected != null ? round(expected) : null;
      vs = value != null && typical != null ? value - typical : null;
    }
    // Capped: the grade was held down to B (a kicker or defense, or a player who missed over half the year), so a big
    // vs slot is a small-sample or position-scale artifact and he is left out of the steal lists.
    const rawGrade = graded && entry.z != null && Number.isFinite(entry.z) ? gradeOfZ(entry.z) : null;
    const capped = !!(rawGrade && entry.grade && GRADES.indexOf(rawGrade) < GRADES.indexOf(entry.grade));
    const pos = entry.position || entry.posKey || "";
    const gp = entry.gp == null ? null : entry.gp;
    const from = entry.posDraftRank != null ? `${pos}${entry.posDraftRank}` : null;
    const to = entry.posFinishRank != null ? `${pos}${entry.posFinishRank}` : null;
    return {
      key: `${season}-${entry.pickNo}`,
      season: Number(season),
      round: entry.round,
      pickInRound: entry.pickInRound,
      pickNo: entry.pickNo,
      label: `${entry.round}.${entry.pickInRound}`,
      player: entry.player,
      playerId: entry.playerId,
      position: pos,
      grade: graded ? entry.grade || null : null,
      capped,
      points,
      value,
      typical,
      vs,
      userId: manager.userId,
      owner: nameOf(manager),
      isKeeper: !!entry.isKeeper,
      gp,
      starts: entry.starts == null ? null : entry.starts,
      injWeeks: entry.injWeeks == null ? null : entry.injWeeks,
      gamesPossible: entry.gamesPossible == null ? null : entry.gamesPossible,
      // points over games is only a clean "per game" in a season with no playoffs yet (the in-season page)
      ppg: gp ? points / gp : null,
      rank: {
        from,
        to,
        // positive: finished higher at his position than he was taken (moved up)
        delta: entry.posDraftRank != null && entry.posFinishRank != null ? entry.posDraftRank - entry.posFinishRank : null,
        text: from && to ? `${from} to ${to}` : from ? `${from} to –` : "",
      },
    };
  }

  // ---- one season's draft -------------------------------------------------------------

  /*
    Everything the page draws a season from. `opts.complete` overrides what the data says about whether the
    season is over. Teams come back by draft slot (the board's column order) in `teams`, and best-first in `ranked`.
  */
  function buildDraft(stats, season, opts = {}) {
    const meta = ((stats && stats.draftSeasons) || {})[String(season)] || {};
    const complete = opts.complete != null ? !!opts.complete : !!meta.complete;
    const model = (stats && stats.draftGradeModel) || null;
    const graded = complete && !!model;

    const picks = [];
    const owners = [];
    ((stats && stats.managers) || []).forEach((m) => {
      const s = (m.seasons || []).find((se) => String(se.season) === String(season));
      if (!s || !(s.draftPicks || []).length) return;
      owners.push(m);
      s.draftPicks.forEach((e) => picks.push(shapePick(e, m, season, graded, model)));
    });
    picks.sort((a, b) => a.pickNo - b.pickNo);
    if (!picks.length) return null;

    const sum = (list, f) => list.reduce((t, p) => t + (f(p) || 0), 0);
    const teams = owners.map((m) => {
      const mine = picks.filter((p) => p.userId === m.userId);
      const first = mine.filter((p) => p.round === 1).sort((a, b) => a.pickNo - b.pickNo)[0];
      const scored = mine.filter((p) => p.vs != null);
      const best = scored.filter(canBeSteal).reduce((b, p) => (!b || p.vs > b.vs ? p : b), null);
      const worst = scored.reduce((b, p) => (!b || p.vs < b.vs ? p : b), null);
      const mix = POSITIONS.map((pos) => ({ pos, n: mine.filter((p) => p.position === pos).length })).filter((x) => x.n > 0);
      const injKnown = mine.some((p) => p.injWeeks != null);
      const hottest = mine
        .filter((p) => (p.gp || 0) >= HOT_MIN_GAMES)
        .reduce((b, p) => (!b || p.ppg > b.ppg ? p : b), null);
      return {
        userId: m.userId,
        name: nameOf(m),
        slot: first ? first.pickInRound : null,
        picks: mine,
        total: graded ? sum(mine, (p) => p.vs) : null,
        grades: mine.map((p) => (GRADES.includes(p.grade) ? p.grade : null)),
        mix,
        best: best && best.vs > 0 ? best : null,
        worst: worst && worst.vs < 0 ? worst : null,
        hottest,
        points: sum(mine, (p) => p.points),
        injWeeks: injKnown ? sum(mine, (p) => p.injWeeks) : null,
        starts: sum(mine, (p) => p.starts),
        rank: 0,
      };
    });
    const bySlot = (a, b) => (a.slot == null ? 1e9 : a.slot) - (b.slot == null ? 1e9 : b.slot) || a.name.localeCompare(b.name);
    const ranked = [...teams].sort((a, b) => (graded ? b.total - a.total : b.points - a.points) || bySlot(a, b));
    ranked.forEach((t, i) => (t.rank = i + 1));
    teams.sort(bySlot);

    const names = owners.map(nameOf);
    return {
      season: Number(season),
      complete,
      graded,
      weeksPlayed: meta.weeksPlayed == null ? null : meta.weeksPlayed,
      teamCount: teams.length,
      rounds: Math.max(...picks.map((p) => p.round || 1)),
      picks,
      teams,
      ranked,
      abbr: typeof RivalriesData !== "undefined" ? RivalriesData.abbreviations(names) : {},
      byKey: new Map(picks.map((p) => [p.key, p])),
    };
  }

  // The label a team goes by in tight places: YOU for the manager picked as My Team, otherwise four letters.
  function teamLabel(draft, userId, meId) {
    if (meId && userId === meId) return "YOU";
    const t = draft.teams.find((x) => x.userId === userId);
    return t ? (draft.abbr && draft.abbr[t.name]) || t.name : "";
  }

  // ---- the overview ----------------------------------------------------------------------

  function overviewTiles(draft, meId) {
    if (!draft.graded) return [];
    const scored = draft.picks.filter((p) => p.vs != null);
    const steal = scored.filter(canBeSteal).reduce((b, p) => (!b || p.vs > b.vs ? p : b), null);
    const costly = scored.reduce((b, p) => (!b || p.vs < b.vs ? p : b), null);
    const best = draft.ranked[0];
    const me = meId ? draft.teams.find((t) => t.userId === meId) : null;
    const worst = draft.ranked[draft.ranked.length - 1];
    const teamSub = (t) => `${signed(t.total)} vs slot${t.slot != null ? `, from slot ${t.slot}` : ""}`;
    const pickSub = (p) => `Pick ${p.label} by ${p.owner}, ${signed(p.vs)}`;
    const tiles = [];
    if (best) tiles.push({ key: "best-draft", label: "Best draft", main: best.name, sub: teamSub(best), tone: "good" });
    if (steal) tiles.push({ key: "steal", label: "Biggest steal", main: steal.player, sub: pickSub(steal), tone: "good", pick: steal.key });
    if (costly) tiles.push({ key: "costly", label: "Costliest pick", main: costly.player, sub: pickSub(costly), tone: "bad", pick: costly.key });
    if (me) tiles.push({ key: "mine", label: "Your draft", main: `${ordinal(me.rank)} of ${draft.teamCount}`, sub: teamSub(me), tone: "plain" });
    else if (worst) tiles.push({ key: "worst-draft", label: "Worst draft", main: worst.name, sub: teamSub(worst), tone: "bad" });
    return tiles;
  }

  // The short lists under the board: the biggest steals, then the costliest picks.
  function shortLists(draft, size = SHORT_LIST) {
    const scored = draft.picks.filter((p) => p.vs != null);
    const byBest = [...scored].sort((a, b) => b.vs - a.vs || a.pickNo - b.pickNo);
    return {
      steals: byBest.filter((p) => p.vs > 0 && canBeSteal(p)).slice(0, size),
      costly: [...byBest].reverse().filter((p) => p.vs < 0).slice(0, size),
    };
  }

  // ---- the board ---------------------------------------------------------------------------

  // One row per round, one column per team (in draft-slot order). A team that holds two picks in a round
  // (a traded pick) shows the earlier one and counts the other in `extra`.
  function boardRows(draft) {
    const rows = [];
    for (let r = 1; r <= draft.rounds; r++) {
      rows.push({
        round: r,
        cells: draft.teams.map((t) => {
          const here = t.picks.filter((p) => p.round === r).sort((a, b) => a.pickNo - b.pickNo);
          return { teamId: t.userId, pick: here[0] || null, extra: Math.max(0, here.length - 1) };
        }),
      });
    }
    return rows;
  }

  // ---- by round -----------------------------------------------------------------------------

  function roundSummaries(draft) {
    const out = [];
    for (let r = 1; r <= draft.rounds; r++) {
      const picks = draft.picks.filter((p) => p.round === r);
      if (!picks.length) continue;
      const scored = picks.filter((p) => p.vs != null);
      const best = scored.filter(canBeSteal).reduce((b, p) => (!b || p.vs > b.vs ? p : b), null);
      const worst = scored.reduce((b, p) => (!b || p.vs < b.vs ? p : b), null);
      out.push({
        round: r,
        picks,
        total: draft.graded ? scored.reduce((t, p) => t + p.vs, 0) : null,
        best: best && best.vs > 0 ? best : null,
        worst: worst && worst.vs < 0 ? worst : null,
      });
    }
    return out;
  }

  // ---- the table ---------------------------------------------------------------------------

  const isHurt = (p) => (p.injWeeks || 0) >= HURT_MIN_INJ;
  const isHot = (p) => p.ppg != null && p.ppg >= HOT_PPG;

  /*
    The filter pills. A pill that would show nothing is left out (no keepers, no kickers), and the
    pills that talk about grades or being hurt only exist when they mean something.
  */
  function filterOptions(draft, meId) {
    const count = (f) => draft.picks.filter(f).length;
    const opts = [{ key: "all", label: "All", count: draft.picks.length }];
    if (meId) opts.push({ key: "mine", label: "My picks", count: count((p) => p.userId === meId) }); // dropped below when he has none here
    if (draft.graded) {
      opts.push({ key: "steals", label: "Steals", count: count((p) => p.grade === "S" || p.grade === "A") });
      opts.push({ key: "busts", label: "Busts", count: count((p) => p.grade === "D" || p.grade === "F") });
    } else if (count(isHurt)) {
      opts.push({ key: "hurt", label: "Hurt", count: count(isHurt) });
    }
    if (count((p) => p.isKeeper)) opts.push({ key: "keepers", label: "Keepers", count: count((p) => p.isKeeper) });
    POSITIONS.forEach((pos) => {
      const n = count((p) => p.position === pos);
      if (n) opts.push({ key: pos, label: pos, count: n, position: true });
    });
    return opts.filter((o) => o.key === "all" || o.count > 0);
  }

  function filterPicks(draft, key, meId) {
    const all = draft.picks;
    if (key === "mine") return all.filter((p) => p.userId === meId);
    if (key === "steals") return all.filter((p) => p.grade === "S" || p.grade === "A");
    if (key === "busts") return all.filter((p) => p.grade === "D" || p.grade === "F");
    if (key === "hurt") return all.filter(isHurt);
    if (key === "keepers") return all.filter((p) => p.isKeeper);
    if (POSITIONS.includes(key)) return all.filter((p) => p.position === key);
    return all;
  }

  const SORT_FIELDS = { pick: "pickNo", points: "points", value: "value", typical: "typical", vs: "vs", gp: "gp", starts: "starts", ppg: "ppg", inj: "injWeeks" };

  // `dir` 1 = best or biggest first (pick order for "pick"), -1 = the other way. Picks with no number go last either way.
  function sortPicks(picks, sortKey = "pick", dir = 1) {
    const key = SORT_FIELDS[sortKey] ? sortKey : "pick"; // a column that does not exist is pick order
    const field = SORT_FIELDS[key];
    const natural = key === "pick" ? 1 : -1; // pick order runs small to big; every number column runs big to small
    return [...picks].sort((a, b) => {
      const x = a[field];
      const y = b[field];
      if (x == null && y == null) return a.pickNo - b.pickNo;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x - y) * natural * dir || a.pickNo - b.pickNo;
    });
  }

  // The tiles above the table describe whichever picks are showing.
  function tableTiles(draft, picks, { filterKey, meId } = {}) {
    if (!picks.length) return [];
    const startsTotal = picks.reduce((t, p) => t + (p.starts || 0), 0);
    const injTotal = picks.some((p) => p.injWeeks != null) ? picks.reduce((t, p) => t + (p.injWeeks || 0), 0) : null;
    const showedUp = {
      key: "showed-up",
      label: "Showed up",
      main: `${startsTotal} ${startsTotal === 1 ? "start" : "starts"}`,
      sub: `across ${picks.length === 1 ? "the pick" : `all ${picks.length} picks`}${injTotal != null ? `, ${injTotal} injury ${injTotal === 1 ? "week" : "weeks"}` : ""}`,
    };
    if (!draft.graded) {
      const pts = picks.reduce((t, p) => t + p.points, 0);
      const games = picks.reduce((t, p) => t + (p.gp || 0), 0);
      const hottest = picks.filter((p) => (p.gp || 0) >= HOT_MIN_GAMES).sort((a, b) => b.ppg - a.ppg || a.pickNo - b.pickNo)[0];
      const tiles = [{ key: "points", label: "Points", main: Math.round(pts).toLocaleString("en-US"), sub: games ? `${(pts / games).toFixed(1)} per game played` : "no games yet" }];
      if (hottest) tiles.push({ key: "hottest", label: "Hottest pick", main: hottest.player, sub: `Pick ${hottest.label}, ${hottest.ppg.toFixed(1)} per game`, tone: "good", pick: hottest.key });
      tiles.push(showedUp);
      return tiles;
    }
    const scored = picks.filter((p) => p.vs != null);
    const total = scored.reduce((t, p) => t + p.vs, 0);
    let sub = `across ${picks.length} ${picks.length === 1 ? "pick" : "picks"}`;
    if (filterKey === "mine" && meId) {
      const me = draft.teams.find((t) => t.userId === meId);
      if (me) sub = `${ordinal(me.rank)} of ${draft.teamCount} teams${me.slot != null ? `, round 1 slot ${me.slot}` : ""}`;
    }
    const counts = GRADES.map((g) => ({ g, n: picks.filter((p) => p.grade === g).length }));
    const gradedCount = counts.reduce((t, c) => t + c.n, 0);
    const upper = counts.filter((c) => c.g === "S" || c.g === "A").reduce((t, c) => t + c.n, 0);
    const best = scored.filter(canBeSteal).reduce((b, p) => (!b || p.vs > b.vs ? p : b), null);
    const costly = scored.reduce((b, p) => (!b || p.vs < b.vs ? p : b), null);
    return [
      { key: "vs", label: "Draft vs slot", main: signed(total), sub, tone: total > 0 ? "good" : total < 0 ? "bad" : "plain" },
      { key: "grades", label: "Grades", main: `${upper} of ${gradedCount}`, sub: `graded A or better${counts.filter((c) => c.n).length ? " · " + counts.filter((c) => c.n).map((c) => `${c.n} ${c.g}`).join(" · ") : ""}` },
      best ? { key: "best", label: "Best pick", main: best.player, sub: `Pick ${best.label}, ${signed(best.vs)} vs slot`, tone: "good", pick: best.key } : null,
      costly ? { key: "costly", label: "Costliest pick", main: costly.player, sub: `Pick ${costly.label}, ${signed(costly.vs)} vs slot`, tone: "bad", pick: costly.key } : null,
      showedUp,
    ].filter(Boolean);
  }

  // ---- the draft so far (a season that is still being played) ------------------------------------

  function liveModel(draft) {
    const roundOne = draft.picks.filter((p) => p.round === 1);
    const teamPoints = draft.ranked.map((t) => ({ userId: t.userId, name: t.name, rank: t.rank, points: t.points, injWeeks: t.injWeeks }));
    const hotStarts = draft.picks
      .filter((p) => p.round > HOT_AFTER_ROUND && (p.gp || 0) >= HOT_MIN_GAMES)
      .sort((a, b) => b.ppg - a.ppg || a.pickNo - b.pickNo)
      .slice(0, LIST_SIZE);
    const hurtEarly = draft.picks
      .filter((p) => p.round <= HURT_MAX_ROUND && (p.injWeeks || 0) >= HURT_MIN_INJ)
      .sort((a, b) => b.injWeeks - a.injWeeks || a.pickNo - b.pickNo)
      .slice(0, LIST_SIZE);
    return { weeksPlayed: draft.weeksPlayed, roundOne, teamPoints, hotStarts, hurtEarly };
  }

  // ---- every graded draft: the report card ----------------------------------------------------

  function gradedSeasons(stats) {
    return Object.values((stats && stats.draftSeasons) || {})
      .filter((s) => s.complete)
      .map((s) => Number(s.season))
      .sort((a, b) => a - b);
  }

  /*
    Every manager across every graded year. `currentIds` (a Set of user ids, or null for everyone) marks who is
    still in the league; past managers are left out unless `includePast`, and sit last when they are in.
  */
  function reportCard(stats, { currentIds = null, includePast = false, meId = null } = {}) {
    const drafts = gradedSeasons(stats).map((y) => buildDraft(stats, y)).filter(Boolean); // a graded year with no picks on record has no column
    const years = drafts.map((d) => d.season);
    const isCurrent = (id) => !currentIds || currentIds.has(id);
    const byManager = new Map();
    const seasonsList = []; // every team-season, for the best and worst lists
    drafts.forEach((d) => {
      d.teams.forEach((t) => {
        if (!byManager.has(t.userId)) byManager.set(t.userId, { userId: t.userId, name: t.name, cells: {} });
        const rec = byManager.get(t.userId);
        rec.name = t.name;
        const cell = { year: d.season, total: t.total, rank: t.rank, of: d.teamCount, slot: t.slot, grades: t.grades, band: bandOfTotal(t.total) };
        rec.cells[d.season] = cell;
        seasonsList.push({ ...cell, userId: t.userId, name: t.name });
      });
    });
    const rows = [...byManager.values()].map((r) => {
      const cells = years.map((y) => r.cells[y] || null);
      const played = cells.filter(Boolean);
      const total = played.reduce((t, c) => t + c.total, 0);
      return { userId: r.userId, name: r.name, cells, drafts: played.length, total, avg: played.length ? total / played.length : 0, past: !isCurrent(r.userId), isMe: r.userId === meId };
    });
    const visible = rows.filter((r) => includePast || !r.past);
    visible.sort((a, b) => (a.past - b.past) || b.total - a.total || a.name.localeCompare(b.name));
    const byTotal = [...seasonsList].sort((a, b) => b.total - a.total || b.year - a.year || a.name.localeCompare(b.name));
    return {
      years,
      rows: visible,
      pastCount: rows.filter((r) => r.past).length,
      best: byTotal.slice(0, LIST_SIZE),
      worst: [...byTotal].reverse().slice(0, LIST_SIZE),
      mine: meId ? seasonsList.filter((s) => s.userId === meId).sort((a, b) => a.year - b.year) : [],
    };
  }

  // ---- every graded draft: the best and costliest picks ever ---------------------------------------

  function hallOfFame(stats, { limit = HALL_SIZE } = {}) {
    const picks = [];
    gradedSeasons(stats).forEach((y) => {
      const d = buildDraft(stats, y);
      if (d) d.picks.forEach((p) => p.vs != null && picks.push(p));
    });
    const best = picks.filter(canBeSteal).sort((a, b) => b.vs - a.vs || b.season - a.season || a.pickNo - b.pickNo);
    const costly = [...picks].sort((a, b) => a.vs - b.vs || b.season - a.season || a.pickNo - b.pickNo);
    return { best: best.filter((p) => p.vs > 0).slice(0, limit), costly: costly.filter((p) => p.vs < 0).slice(0, limit), pickCount: picks.length };
  }

  return {
    POSITIONS,
    GRADES,
    BOARD_BANDS,
    TEAM_BANDS,
    LIST_SIZE,
    HOT_AFTER_ROUND,
    HOT_MIN_GAMES,
    HOT_PPG,
    HURT_MAX_ROUND,
    HURT_MIN_INJ,
    HALL_SIZE,
    SHORT_LIST,
    round,
    gradeOfZ,
    signed,
    ordinal,
    lastName,
    bandOfVs,
    bandOfTotal,
    buildDraft,
    teamLabel,
    overviewTiles,
    shortLists,
    boardRows,
    roundSummaries,
    isHot,
    isHurt,
    filterOptions,
    filterPicks,
    sortPicks,
    tableTiles,
    liveModel,
    gradedSeasons,
    reportCard,
    hallOfFame,
  };
})();
