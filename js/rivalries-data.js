/*
  Rivalries page numbers, kept apart from the page code so they can be tested on
  their own. Nothing here touches the page.

  Everything takes plain data in and gives plain data out. The raw material is
  DeepHistory.computeStats().pairGameLog: for every pair of managers who have
  met, one entry per game ({ season, week, isPlayoff, aUserId, aScore, bUserId,
  bScore }), Sleeper years only (2020 on), playoffs included. The careers in
  Career Compare come from the same owner cells the History and Teams pages use
  (HistoryData.buildOwners), so a title count can never read differently here.

  Win rates: a meeting is a win, a loss or a tie, and a tie is not a win, so a
  rate is wins over meetings. A rate is rounded to a whole percent before it is
  put into a color band, so the number printed in a square and its color can
  never disagree (54.5% prints as 55% and is colored as 55%).
*/
const RivalriesData = (function () {
  const MIN_MAP_MEETINGS = 5; // fewer meetings than this is drawn with a dashed edge: too few to mean much
  const MIN_RECORD_MEETINGS = 8; // Most Lopsided and Most Even only look at pairs that have met this often
  const MIN_STREAK = 3; // a run shorter than this is not worth a card
  const LIST_SIZE = 5;
  const STREAK_CARDS = 5;

  const pairKey = (a, b) => [a, b].sort().join("|");
  // One decimal, halves rounded away from zero. A score like 90.05 is stored as 90.04999..., so a plain
  // Math.round(x * 10) would print 90.0; the small nudge keeps what is printed what a person would round to.
  const round1 = (x) => (x < 0 ? -1 : 1) * (Math.round(Math.abs(x) * 10 + 1e-7) / 10);
  const fmt1 = (x) => round1(x).toFixed(1);
  const nameOf = (m) => (m ? m.username || m.teamName || "" : "");
  const recordText = (w, l, t) => `${w}-${l}${t ? "-" + t : ""}`;

  // ---- short names ---------------------------------------------------------------

  /*
    Four letters for the chips, the map and the lists: the first four letters of the
    username (JoeSifBoreDough is JOES, hmart92 is HMAR), except a CamelCase name made of
    exactly three words, which is its initials (YuWillLose is YWL). Two names that would
    land on the same letters get longer until they differ. Returns { username: "ABBR" }.
  */
  function baseAbbr(name) {
    const letters = String(name || "").replace(/[^A-Za-z]/g, "");
    const words = letters.match(/[A-Z][a-z]*|[a-z]+/g) || [];
    if (words.length === 3) return words.map((w) => w[0]).join("").toUpperCase();
    return letters.slice(0, 4).toUpperCase() || "?";
  }

  function abbreviations(names) {
    const list = [...new Set((names || []).filter(Boolean))];
    const out = {};
    list.forEach((n) => (out[n] = baseAbbr(n)));
    const groups = {};
    list.forEach((n) => (groups[out[n]] = groups[out[n]] || []).push(n));
    Object.values(groups).forEach((group) => {
      if (group.length < 2) return;
      for (let len = 5; len <= 12; len++) {
        const tried = group.map((n) => String(n).replace(/[^A-Za-z]/g, "").slice(0, len).toUpperCase());
        if (new Set(tried).size === group.length) {
          group.forEach((n, i) => (out[n] = tried[i]));
          return;
        }
      }
      group.forEach((n, i) => (out[n] = out[n] + (i + 1))); // the same letters all the way down: number them
    });
    return out;
  }

  // ---- win-rate colors -------------------------------------------------------------

  /*
    The five bands of the map and the legend. b5 is 70% and up (gold), b4 55 to 69, b3 45 to 54
    (the neutral middle), b2 30 to 44, b1 under 30 (bright blue); "none" is a pair that has not met.
  */
  function bandOf(pct) {
    if (pct == null) return "none";
    const r = Math.round(pct);
    if (r >= 70) return "b5";
    if (r >= 55) return "b4";
    if (r >= 45) return "b3";
    if (r >= 30) return "b2";
    return "b1";
  }

  // ---- one pair's games ------------------------------------------------------------

  function orient(g, idA) {
    const aIsA = g.aUserId === idA;
    const a = aIsA ? g.aScore : g.bScore;
    const b = aIsA ? g.bScore : g.aScore;
    return { season: Number(g.season), week: Number(g.week), isPlayoff: !!g.isPlayoff, a, b, diff: round1(a - b), result: a > b ? "W" : a < b ? "L" : "T" };
  }

  // Every meeting of two managers from idA's side, oldest first.
  function gamesBetween(pairGameLog, idA, idB) {
    const raw = (pairGameLog || {})[pairKey(idA, idB)] || [];
    return raw.map((g) => orient(g, idA)).sort((x, y) => x.season - y.season || x.week - y.week);
  }

  function tally(games) {
    let w = 0;
    let l = 0;
    let t = 0;
    games.forEach((g) => (g.result === "W" ? (w += 1) : g.result === "L" ? (l += 1) : (t += 1)));
    return { w, l, t, n: games.length };
  }

  /*
    The numbers on the top card for one pair, from the first manager's side. `games` is gamesBetween().
    closest and blowout go by the size of the gap either way; if two games tie for it, the newer one.
  */
  function summarize(games) {
    const n = games.length;
    const all = tally(games);
    const playoffs = tally(games.filter((g) => g.isPlayoff));
    const sum = (f) => games.reduce((t, g) => t + f(g), 0);
    let closest = null;
    let blowout = null;
    [...games].reverse().forEach((g) => {
      const margin = Math.abs(g.diff);
      if (!closest || margin < closest.margin) closest = { margin, season: g.season, week: g.week, isPlayoff: g.isPlayoff };
      if (!blowout || margin > blowout.margin) blowout = { margin, season: g.season, week: g.week, isPlayoff: g.isPlayoff };
    });
    return {
      n,
      w: all.w,
      l: all.l,
      t: all.t,
      record: recordText(all.w, all.l, all.t),
      pct: n ? (all.w / n) * 100 : null,
      lead: Math.abs(all.w - all.l),
      leader: all.w > all.l ? "a" : all.l > all.w ? "b" : null,
      playoffs,
      avgA: n ? sum((g) => g.a) / n : null,
      avgB: n ? sum((g) => g.b) / n : null,
      avgMargin: n ? sum((g) => g.a - g.b) / n : null,
      closest,
      blowout,
      firstSeason: n ? games[0].season : null,
      lastSeason: n ? games[n - 1].season : null,
      strip: games.map((g) => ({ result: g.result, isPlayoff: g.isPlayoff, season: g.season, week: g.week })),
    };
  }

  // "2020 to 2026", or just "2026" when every meeting was in one year.
  function rangeText(first, last) {
    if (first == null) return "";
    return first === last ? String(first) : `${first} to ${last}`;
  }

  /*
    The two lines under the big record. The leader's win rate is the one quoted ("64% win rate" is the
    series leader's), and a level series says so.
  */
  function seriesLines(s, nameA, nameB) {
    if (!s.n) return { lead: "", detail: "" };
    const meetings = `${s.n} meeting${s.n === 1 ? "" : "s"}`;
    if (!s.leader) return { lead: `The series is level.`, detail: `${meetings}, 50% win rate each.` };
    const winsOf = s.leader === "a" ? s.w : s.l;
    const who = s.leader === "a" ? nameA : nameB;
    return { lead: `${who} leads the series by ${s.lead}.`, detail: `${meetings}, ${Math.round((winsOf / s.n) * 100)}% win rate` };
  }

  // +1.4 / -1.4 / 0.0
  function signed1(x) {
    const r = round1(x);
    return r > 0 ? `+${r.toFixed(1)}` : r < 0 ? `-${Math.abs(r).toFixed(1)}` : "0.0";
  }

  /*
    The game log, newest first. Each row carries the running series after that game (so you can see when
    the lead changed hands), the first manager's record for that season (shown on a season's first row),
    and a note for a playoff game, the closest game and the biggest blowout. The closest and biggest
    are only called out when they differ (a rivalry of one game, or of equal margins, has neither).
  */
  function gameLog(games) {
    if (!games.length) return [];
    const s = summarize(games);
    const callouts = s.closest && s.blowout && s.closest.margin !== s.blowout.margin;
    const same = (g, ref) => ref && g.season === ref.season && g.week === ref.week;
    let w = 0;
    let l = 0;
    let t = 0;
    const seasonTally = {};
    const rows = games.map((g) => {
      if (g.result === "W") w += 1;
      else if (g.result === "L") l += 1;
      else t += 1;
      const st = (seasonTally[g.season] = seasonTally[g.season] || { w: 0, l: 0, t: 0 });
      if (g.result === "W") st.w += 1;
      else if (g.result === "L") st.l += 1;
      else st.t += 1;
      const notes = [];
      if (g.isPlayoff) notes.push("Playoff");
      if (callouts && same(g, s.closest)) notes.push("Closest");
      if (callouts && same(g, s.blowout)) notes.push("Biggest blowout");
      return { season: g.season, week: g.week, a: g.a, b: g.b, diff: g.diff, result: g.result, isPlayoff: g.isPlayoff, seriesAfter: recordText(w, l, t), notes };
    });
    const newestFirst = rows.reverse();
    newestFirst.forEach((row, i) => {
      const st = seasonTally[row.season];
      row.seasonRecord = recordText(st.w, st.l, st.t);
      row.firstOfSeason = i === 0 || newestFirst[i - 1].season !== row.season;
    });
    return newestFirst;
  }

  // ---- who is in the league --------------------------------------------------------

  const isCurrent = (id, currentIds) => !currentIds || currentIds.has(id);

  /*
    The order of the map's rows and columns. You first, then the other current managers longest-tenured
    first (a newcomer sits last, however the alphabet falls), then, if asked for, past managers, who always
    sit at the bottom and right so the current owners stay in the same spots with the switch on or off.
  */
  function orderManagers(managers, { currentIds, meId, includePast } = {}) {
    const byTenure = (a, b) => (b.seasons ? b.seasons.length : 0) - (a.seasons ? a.seasons.length : 0) || nameOf(a).localeCompare(nameOf(b));
    const current = (managers || []).filter((m) => isCurrent(m.userId, currentIds));
    const me = current.find((m) => m.userId === meId) || null;
    const others = current.filter((m) => m !== me).sort(byTenure);
    const past = includePast ? (managers || []).filter((m) => !isCurrent(m.userId, currentIds)).sort(byTenure) : [];
    return [...(me ? [me] : []), ...others, ...past];
  }

  // ---- the opponent chips ----------------------------------------------------------

  /*
    One chip per opponent the first manager has met: the series, from their side, and whether they lead it,
    trail it or are level (that is the chip's color). Most-met first, then by name. Current managers only,
    except the one currently picked, so a past manager picked from the list still shows up selected.
  */
  function opponentChips(pairGameLog, managers, idA, { currentIds, selectedB } = {}) {
    const names = {};
    (managers || []).forEach((m) => (names[m.userId] = nameOf(m)));
    const abbr = abbreviations((managers || []).map(nameOf));
    const chips = [];
    (managers || []).forEach((m) => {
      if (m.userId === idA) return;
      if (!isCurrent(m.userId, currentIds) && m.userId !== selectedB) return;
      const games = gamesBetween(pairGameLog, idA, m.userId);
      if (!games.length) return;
      const t = tally(games);
      chips.push({
        id: m.userId,
        name: nameOf(m),
        abbr: abbr[nameOf(m)],
        w: t.w,
        l: t.l,
        t: t.t,
        n: t.n,
        record: recordText(t.w, t.l, t.t),
        pct: (t.w / t.n) * 100,
        tone: t.w > t.l ? "lead" : t.l > t.w ? "trail" : "even",
      });
    });
    chips.sort((x, y) => y.n - x.n || x.name.localeCompare(y.name));
    return chips;
  }

  // ---- the league map --------------------------------------------------------------

  /*
    Every manager's record against every other, from the row manager's side. `all` is each row manager's
    record against every manager there has ever been (past ones too), whichever are on the grid.
  */
  function leagueMap(pairGameLog, managers, { currentIds, meId, includePast } = {}) {
    const ordered = orderManagers(managers, { currentIds, meId, includePast });
    const abbr = abbreviations((managers || []).map(nameOf));
    const head = (m) => ({ id: m.userId, name: nameOf(m), abbr: abbr[nameOf(m)], isMe: m.userId === meId, past: !isCurrent(m.userId, currentIds) });
    const cols = ordered.map(head);
    const known = new Set((managers || []).map((m) => m.userId));
    const rows = ordered.map((row) => {
      const cells = ordered.map((col) => {
        if (col.userId === row.userId) return { id: col.userId, self: true };
        const t = tally(gamesBetween(pairGameLog, row.userId, col.userId));
        const pct = t.n ? (t.w / t.n) * 100 : null;
        return { id: col.userId, self: false, w: t.w, l: t.l, t: t.t, n: t.n, record: t.n ? recordText(t.w, t.l, t.t) : "", pct, pctText: t.n ? `${Math.round(pct)}%` : "", band: bandOf(pct), small: t.n > 0 && t.n < MIN_MAP_MEETINGS };
      });
      let w = 0;
      let l = 0;
      let t = 0;
      Object.entries(pairGameLog || {}).forEach(([key, list]) => {
        const [x, y] = key.split("|");
        if ((x !== row.userId && y !== row.userId) || !known.has(x) || !known.has(y)) return;
        const tl = tally(list.map((g) => orient(g, row.userId)));
        w += tl.w;
        l += tl.l;
        t += tl.t;
      });
      return { ...head(row), cells, all: { w, l, t, n: w + l + t, record: recordText(w, l, t) } };
    });
    return { rows, cols, allLabel: `ALL ${Math.max(0, (managers || []).length - 1)}`, pastCount: (managers || []).filter((m) => !isCurrent(m.userId, currentIds)).length };
  }

  // ---- streaks and records ---------------------------------------------------------

  // Every pair of current managers who have met, with their games from the first id's side.
  function currentPairs(pairGameLog, managers, currentIds) {
    const byId = new Map((managers || []).map((m) => [m.userId, m]));
    const out = [];
    Object.keys(pairGameLog || {}).forEach((key) => {
      const [idA, idB] = key.split("|");
      if (!byId.has(idA) || !byId.has(idB) || !isCurrent(idA, currentIds) || !isCurrent(idB, currentIds)) return;
      const games = gamesBetween(pairGameLog, idA, idB);
      if (games.length) out.push({ idA, idB, nameA: nameOf(byId.get(idA)), nameB: nameOf(byId.get(idB)), games });
    });
    return out;
  }

  /*
    Who is on a run right now: the straight wins over one opponent that the newest meeting is part of.
    Longest first, then the one that began most recently. A tie in the newest meeting ends the run.
  */
  function currentStreaks(pairGameLog, managers, { currentIds, limit = STREAK_CARDS, minLength = MIN_STREAK } = {}) {
    const runs = [];
    currentPairs(pairGameLog, managers, currentIds).forEach((p) => {
      const last = p.games[p.games.length - 1];
      if (last.result === "T") return;
      let i = p.games.length - 1;
      while (i >= 0 && p.games[i].result === last.result) i -= 1;
      const length = p.games.length - 1 - i;
      if (length < minLength) return;
      const start = p.games[i + 1];
      const aWon = last.result === "W";
      runs.push({
        holderId: aWon ? p.idA : p.idB,
        holder: aWon ? p.nameA : p.nameB,
        otherId: aWon ? p.idB : p.idA,
        other: aWon ? p.nameB : p.nameA,
        length,
        startSeason: start.season,
        startWeek: start.week,
      });
    });
    runs.sort((x, y) => y.length - x.length || y.startSeason - x.startSeason || y.startWeek - x.startWeek || `${x.holder}${x.other}`.localeCompare(`${y.holder}${y.other}`));
    return limit ? runs.slice(0, limit) : runs;
  }

  /*
    The three all-time lists. Most Lopsided and Most Even look only at pairs that have met 8 times or more;
    Most Lopsided is the biggest win rate for the leading side, Most Even the smallest gap (then the more
    meetings). Biggest Blowouts is single games by winning margin. Current managers only.
  */
  function pairRecords(pairGameLog, managers, { currentIds, limit = LIST_SIZE, minMeetings = MIN_RECORD_MEETINGS } = {}) {
    const pairs = currentPairs(pairGameLog, managers, currentIds);
    const lopsided = [];
    const even = [];
    const blowouts = [];
    pairs.forEach((p) => {
      const t = tally(p.games);
      if (t.n >= minMeetings) {
        if (t.w !== t.l) {
          const aLeads = t.w > t.l;
          const wins = aLeads ? t.w : t.l;
          const losses = aLeads ? t.l : t.w;
          lopsided.push({ aId: aLeads ? p.idA : p.idB, a: aLeads ? p.nameA : p.nameB, bId: aLeads ? p.idB : p.idA, b: aLeads ? p.nameB : p.nameA, record: recordText(wins, losses, t.t), pct: Math.round((wins / t.n) * 100), meetings: t.n, raw: wins / t.n });
        }
        // names read alphabetically; the record has to be told from the side of whoever is named first
        const aFirst = p.nameA.localeCompare(p.nameB) <= 0;
        const [first, second] = aFirst ? [{ id: p.idA, name: p.nameA }, { id: p.idB, name: p.nameB }] : [{ id: p.idB, name: p.nameB }, { id: p.idA, name: p.nameA }];
        even.push({ aId: first.id, a: first.name, bId: second.id, b: second.name, record: aFirst ? recordText(t.w, t.l, t.t) : recordText(t.l, t.w, t.t), gap: Math.abs(t.w - t.l), meetings: t.n });
      }
      p.games.forEach((g) => {
        if (g.result === "T") return;
        const aWon = g.result === "W";
        blowouts.push({ aId: aWon ? p.idA : p.idB, a: aWon ? p.nameA : p.nameB, bId: aWon ? p.idB : p.idA, b: aWon ? p.nameB : p.nameA, margin: Math.abs(g.diff), season: g.season, week: g.week, isPlayoff: g.isPlayoff });
      });
    });
    const names = (x) => `${x.a}${x.b}`;
    lopsided.sort((x, y) => y.raw - x.raw || y.meetings - x.meetings || names(x).localeCompare(names(y)));
    even.sort((x, y) => x.gap - y.gap || y.meetings - x.meetings || names(x).localeCompare(names(y)));
    blowouts.sort((x, y) => y.margin - x.margin || y.season - x.season || y.week - x.week || names(x).localeCompare(names(y)));
    return { lopsided: lopsided.slice(0, limit), even: even.slice(0, limit), blowouts: blowouts.slice(0, limit) };
  }

  // The count and years in the header line: "523 games, 2020 to 2026, playoffs included".
  function leagueSummary(pairGameLog) {
    let games = 0;
    let first = null;
    let last = null;
    Object.values(pairGameLog || {}).forEach((list) =>
      list.forEach((g) => {
        games += 1;
        const y = Number(g.season);
        first = first == null ? y : Math.min(first, y);
        last = last == null ? y : Math.max(last, y);
      })
    );
    return { games, first, last, text: games ? `${games} games, ${rangeText(first, last)}, playoffs included` : "" };
  }

  // ---- career compare --------------------------------------------------------------

  /*
    One manager's career numbers for the compare, from a HistoryData owner (ESPN years included, the same as
    the Teams page) and the first-round bye count from the manager. A rate with nothing behind it is null.
  */
  function careerFacts(owner, byes) {
    if (!owner) return null;
    const n = (v) => Number(v) || 0;
    const wins = n(owner.regW) + n(owner.poW);
    const games = wins + n(owner.regL) + n(owner.regT) + n(owner.poL) + n(owner.poT);
    const finals = n(owner.titles) + n(owner.seconds);
    return {
      titles: n(owner.titles),
      finalsWon: n(owner.titles),
      finalsLost: n(owner.seconds),
      finalsText: finals ? `${n(owner.titles)}-${n(owner.seconds)}` : "–",
      finalsPct: finals ? (n(owner.titles) / finals) * 100 : null,
      poPct: owner.poGames > 0 ? owner.poPct : null,
      trips: n(owner.trips),
      byes: byes || 0,
      regPct: owner.regGames > 0 ? owner.regPct : null,
      overallPct: games ? (wins / games) * 100 : null,
      top3: n(owner.podiums),
      avgFinish: owner.avgFinish == null ? null : owner.avgFinish,
    };
  }

  const dash = "–";
  const pctText = (v) => (v == null ? dash : `${fmt1(v)}%`);
  const countText = (v) => String(v);

  /*
    The nine rows of Career Compare. For each: the two values, which side leads (the highlighted pill), and
    the gap written out ("YOU +2", "EVAN +3.1 pts"). `labelA` / `labelB` are the short names used in the
    gaps. The summary counts the rows each side leads; a level row counts for neither.
  */
  function careerRows(fa, fb, labelA, labelB) {
    if (!fa || !fb) return { rows: [], winsA: 0, winsB: 0, summary: "" };
    const label = (side) => (side === "a" ? labelA : labelB);
    const rows = [];
    // A count or a rate where bigger is better; `unit` is " pts" for rates, "" for counts.
    const higher = (key, name, field, text, unit, digits) => {
      const a = fa[field];
      const b = fb[field];
      const diff = a == null || b == null ? 0 : round1(a - b);
      const gap = digits === 0 ? Math.abs(a - b) : Math.abs(diff);
      const side = a == null || b == null || gap < (digits === 0 ? 1 : 0.05) ? null : a > b ? "a" : "b";
      rows.push({ key, label: name, aText: text(a), bText: text(b), winner: side, gap: side ? `${label(side)} +${digits === 0 ? gap : fmt1(gap)}${unit}` : a == null || b == null ? "" : "Level" });
    };
    higher("titles", "Titles", "titles", countText, "", 0);
    // Championship games: the better record wins; a side that never lost one says so.
    {
      const a = fa.finalsPct;
      const b = fb.finalsPct;
      let side = null;
      if (a != null && b != null) side = a > b ? "a" : b > a ? "b" : null;
      else if (a != null && a > 0) side = "a";
      else if (b != null && b > 0) side = "b";
      const unbeaten = (f) => f.finalsWon > 0 && f.finalsLost === 0;
      let gap = "";
      if (side && unbeaten(side === "a" ? fa : fb)) gap = `${label(side)} never lost one`;
      else if (side && a != null && b != null) gap = `${label(side)} +${Math.round(Math.abs(a - b))} pts`;
      else if (side) gap = `${label(side)} leads`;
      else if (a != null && b != null) gap = "Level";
      rows.push({ key: "finals", label: "Champ games", aText: fa.finalsText, bText: fb.finalsText, winner: side, gap });
    }
    higher("poRate", "Playoff win rate", "poPct", pctText, " pts", 1);
    higher("trips", "Playoff appearances", "trips", countText, "", 0);
    higher("byes", "First-round byes", "byes", countText, "", 0);
    higher("regRate", "Reg. season win rate", "regPct", pctText, " pts", 1);
    higher("overallRate", "Overall win rate", "overallPct", pctText, " pts", 1);
    higher("top3", "Top-3 finishes", "top3", countText, "", 0);
    // Average finish: lower is better.
    {
      const a = fa.avgFinish;
      const b = fb.avgFinish;
      const diff = a == null || b == null ? 0 : round1(Math.abs(a - b));
      const side = a == null || b == null || diff < 0.05 ? null : a < b ? "a" : "b";
      rows.push({ key: "avgFinish", label: "Average finish", aText: a == null ? dash : fmt1(a), bText: b == null ? dash : fmt1(b), winner: side, gap: side ? `${label(side)} +${fmt1(diff)} places` : a == null || b == null ? "" : "Level" });
    }
    const winsA = rows.filter((r) => r.winner === "a").length;
    const winsB = rows.filter((r) => r.winner === "b").length;
    const summary = winsA === winsB ? `level, ${winsA} to ${winsB}` : winsA > winsB ? `${winsA} to ${winsB} for ${labelA}` : `${winsB} to ${winsA} for ${labelB}`;
    return { rows, winsA, winsB, summary };
  }

  return {
    MIN_MAP_MEETINGS,
    MIN_RECORD_MEETINGS,
    MIN_STREAK,
    pairKey,
    abbreviations,
    bandOf,
    gamesBetween,
    summarize,
    rangeText,
    seriesLines,
    signed1,
    fmt1,
    gameLog,
    orderManagers,
    opponentChips,
    leagueMap,
    currentStreaks,
    pairRecords,
    leagueSummary,
    careerFacts,
    careerRows,
  };
})();
