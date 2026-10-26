/*
  Replays the league's history one scored week at a time to find out WHEN
  each record was set — the engine behind the Home page's "Latest Records"
  list (see scripts/build-records-feed.js).

  The Record Book (js/record-book.js) only knows how to answer "what are
  the records right now?". To date them, this rebuilds the Record Book as it
  stood after every week of every season: it cuts the archive off at that
  week (later weeks, transactions, power rankings and bracket results are
  hidden, and a season that hasn't finished is marked in progress), runs the
  real engine on what's left, and compares each record's holder with the
  previous week's. Whoever's name appears at the top of a record that wasn't
  there a week earlier set it that week.

  Nothing in here touches the network or the DOM, and the engine is passed
  in rather than imported (it's browser code), so tests can run the same
  functions against a tiny fixture league.
*/

const EPS = 1e-9;

// "Played" the way DeepHistory.fetchSeasonDeep decides it: a week with at
// least one real score in it.
function playedWeeks(archive) {
  return (archive.weeks || [])
    .filter(({ matchups }) => (matchups || []).some((m) => (m.points || 0) > 0))
    .sort((a, b) => a.week - b.week);
}

// Every (season, week) there is something to replay, oldest first.
function timePoints(archives) {
  const points = [];
  archives.forEach((archive, seasonIdx) => {
    const weeks = playedWeeks(archive);
    weeks.forEach(({ week }, i) => {
      points.push({ seasonIdx, season: String(archive.league.season), week, isLastWeek: i === weeks.length - 1 });
    });
  });
  return points;
}

// The playoff bracket as Sleeper shows it mid-season: a game in a round that
// hasn't been played yet has no winner/loser, so the later rounds' teams
// can't be worked out until the earlier ones finish.
function bracketAsOf(bracket, playoffStart, week) {
  if (!Array.isArray(bracket) || playoffStart == null) return bracket;
  return bracket.map((g) => (playoffStart + (g.r - 1) <= week ? g : { ...g, w: null, l: null }));
}

function powerRanksAsOf(powerRanks, seasonIdx, archives, week) {
  if (!powerRanks || !powerRanks.seasons) return powerRanks || null;
  const lastSeason = Number(archives[seasonIdx].league.season);
  const seasons = {};
  Object.entries(powerRanks.seasons).forEach(([year, data]) => {
    if (Number(year) > lastSeason) return;
    if (Number(year) < lastSeason) {
      seasons[year] = data;
      return;
    }
    const cutSeries = (byName) => {
      if (!byName) return byName;
      const out = {};
      Object.entries(byName).forEach(([name, series]) => {
        out[name] = { ...series, weekly: (series.weekly || []).slice(0, week) };
      });
      return out;
    };
    const cutOdds = (byName) => {
      if (!byName) return byName;
      const out = {};
      Object.entries(byName).forEach(([name, weekly]) => (out[name] = Array.isArray(weekly) ? weekly.slice(0, week) : weekly));
      return out;
    };
    seasons[year] = { ...data, ranks: cutSeries(data.ranks), scores: cutSeries(data.scores), playoffOdds: cutOdds(data.playoffOdds) };
  });
  return { ...powerRanks, seasons };
}

function rawStatsAsOf(rawStats, seasonIdx, archives, week) {
  if (!rawStats || !rawStats.seasons) return rawStats || null;
  const lastSeason = Number(archives[seasonIdx].league.season);
  const seasons = {};
  Object.entries(rawStats.seasons).forEach(([year, weeks]) => {
    if (Number(year) > lastSeason) return;
    if (Number(year) < lastSeason) {
      seasons[year] = weeks;
      return;
    }
    const kept = {};
    Object.entries(weeks || {}).forEach(([w, byUser]) => {
      if (Number(w) <= week) kept[w] = byUser;
    });
    seasons[year] = kept;
  });
  return { ...rawStats, seasons };
}

// The exact input RecordBook.buildFacts needs for the league as it stood at
// the end of `point`.
function inputAt(base, point) {
  const { archives } = base;
  const upTo = archives.slice(0, point.seasonIdx + 1);
  const seasonChain = upTo.map((a, j) => {
    const isCurrent = j === point.seasonIdx;
    if (!isCurrent || point.isLastWeek) return { league: a.league, rosters: a.rosters, users: a.users, bracket: a.bracket };
    return {
      league: { ...a.league, status: "in_season" },
      rosters: a.rosters,
      users: a.users,
      bracket: bracketAsOf(a.bracket, a.league.settings && a.league.settings.playoff_week_start, point.week),
    };
  });
  const deepSeasons = upTo.map((a, j) => {
    const isCurrent = j === point.seasonIdx;
    const weeks = playedWeeks(a).filter((w) => !isCurrent || w.week <= point.week);
    const transactions = (a.transactions || []).filter((t) => !isCurrent || t.leg == null || t.leg <= point.week);
    return { leagueId: a.league.league_id, season: a.league.season, weeks, scheduleWeeks: a.weeks, transactions, draft: a.draft || null };
  });
  const stats = base.DeepHistory.computeStats(seasonChain, deepSeasons, base.playerDirectory);
  return {
    seasonChain,
    deepSeasons,
    playerDirectory: base.playerDirectory,
    stats,
    manual: base.manual,
    rawStats: rawStatsAsOf(base.rawStats, point.seasonIdx, archives, point.week),
    powerRanks: powerRanksAsOf(base.powerRanks, point.seasonIdx, archives, point.week),
  };
}

// Every record's #1 entry (all tied leaders) with the era set to "all seasons",
// scoped the way the Records page scopes each category.
function snapshot(RecordBook, facts) {
  const contexts = new Map();
  const ctxFor = (category) => {
    const sleeperOnly = !category.history;
    if (!contexts.has(sleeperOnly)) contexts.set(sleeperOnly, RecordBook.context(facts, "all", sleeperOnly));
    return contexts.get(sleeperOnly);
  };
  const snap = {};
  RecordBook.DEFS.forEach((def) => {
    const category = RecordBook.CATEGORIES.find((c) => c.id === def.cat);
    let result;
    try {
      result = RecordBook.compute(def, ctxFor(category));
    } catch (err) {
      result = { status: "empty", entries: [] };
    }
    if (result.status !== "ok") {
      snap[def.id] = { status: result.status, tops: [] };
      return;
    }
    snap[def.id] = {
      status: "ok",
      tops: result.entries
        .filter((e) => e.rank === 1)
        .slice(0, 5)
        .map((e) => ({ holder: e.key || e.name, name: e.name, playerId: e.playerId, raw: e.raw, when: e.when, valueText: e.valueText, detail: e.detail })),
    };
  });
  return snap;
}

/*
  Did this record change hands (or get beaten) between two snapshots?

  A holder who simply keeps adding to a running total (Alice's career wins
  going 41 -> 42) is NOT a new record, so a top entry only counts as new if
  its holder AND its `when` (the week/season of the performance behind it)
  differ from every leader a week earlier. Returns null when nothing happened,
  or { kind, subject, previous }:
    new        the record has nothing before it (first time it can be ranked)
    broke      someone else beat the old mark
    broke-own  the old holder beat their own mark with a fresh performance
    took-over  the lead changed hands without beating the old value (a rate
               stat where the old leader slipped)
*/
const idOf = (e) => `${e.holder}|${e.when == null ? "" : e.when}`;

function changeBetween(def, prev, cur) {
  if (!cur || cur.status !== "ok" || !cur.tops.length) return null;
  if (!prev || prev.status !== "ok" || !prev.tops.length) return { kind: "new", subject: cur.tops[0], previous: null };

  const prevIds = new Set(prev.tops.map(idOf));
  const fresh = cur.tops.filter((e) => !prevIds.has(idOf(e)));
  if (!fresh.length) return null;

  const subject = fresh[0];
  const old = prev.tops[0];
  const better = def.dir === "asc" ? subject.raw < old.raw - EPS : subject.raw > old.raw + EPS;
  const tied = Math.abs(subject.raw - old.raw) <= EPS;
  if (tied) return null; // matching the old mark isn't setting a new one
  const own = prev.tops.find((e) => e.holder === subject.holder);
  if (better) return { kind: own ? "broke-own" : "broke", subject, previous: own || old };
  if (own) return null;
  return { kind: "took-over", subject, previous: old };
}

/*
  The date to show for a record's holder. Normally that is the week the replay
  saw it happen. The one exception is a record already on the books when the
  replay begins (the first scored week): the holder got there earlier, so the
  date comes from the record's own `when` when it has one (a 2018 season, a
  2019 draft pick), and a running total that started out ahead is dated
  "before" the replay when the category counts the pre-Sleeper seasons.
  Season and draft records have no week.
*/
function eventDate(scope, when, at, isStart, preSleeper) {
  if (isStart) {
    if (scope === "week") return { season: String(Math.floor(when / 100)), week: when % 100 };
    if (scope === "season") return { season: String(when < 10000 ? when : Math.floor(when / 100)), week: null };
    if (scope === "draft") return { season: String(Math.floor(when / 1000)), week: null };
    if (preSleeper) return { season: at.season, week: null, before: true };
  }
  return { season: at.season, week: scope === "season" || scope === "draft" ? null : at.week };
}

/*
  `prev` in changeBetween is not simply last week's snapshot: it is whoever
  the book last RECOGNIZED as the record holder (the "reign"). Otherwise a
  challenger who first ties the record and a week later passes it would never
  register — by then they were already sitting in last week's top spots.
  After each week the reign follows its holders' current numbers (a career
  total creeping up), ignores anyone who has only tied, and is replaced
  whenever changeBetween reports a change.
*/
function carryReign(reign, cur) {
  if (!cur || cur.status !== "ok" || !cur.tops.length) return reign; // the record went blank: remember who held it
  if (!reign || reign.status !== "ok" || !reign.tops.length) return cur;
  const ids = new Set(reign.tops.map(idOf));
  const kept = cur.tops.filter((e) => ids.has(idOf(e)));
  return kept.length ? { status: "ok", tops: kept } : reign;
}

const KIND_RANK = { broke: 3, "took-over": 3, "broke-own": 2, new: 1 };

// A record flagged NEW if it was set in one of the newest scored weeks.
const RECENT_WEEKS = 3;

// What kind of date a record's `when` stands for, so the Records page words
// the "Set ..." line right: a week (2024 Wk 14 = 202414), a whole season (2024,
// or 202400), a draft pick (2024 pick 37 = 2024037), or nothing at all — a
// running career total has no single moment, only the week its leader took over.
function whenScope(when) {
  if (when == null) return "since";
  if (when >= 1000000) return "draft";
  if (when < 10000 || when % 100 === 0) return "season";
  return "week";
}

/*
  Walks every point and returns the record-setting events, newest first.
  `onProgress(i, total, point)` is optional.
*/
function replay(base, onProgress) {
  const { RecordBook } = base;
  const points = timePoints(base.archives);
  const defOrder = new Map(RecordBook.DEFS.map((d, i) => [d.id, i]));
  const categoryTitle = new Map(RecordBook.CATEGORIES.map((c) => [c.id, c.title]));

  const reign = {}; // def id -> the last recognized holder(s), see carryReign
  const reignSince = {}; // def id -> Map(holder id -> the point they joined the reign)
  let prev = null;
  let lastFacts = null;
  const events = [];
  points.forEach((point, i) => {
    if (onProgress) onProgress(i, points.length, point);
    const facts = RecordBook.buildFacts(inputAt(base, point));
    lastFacts = facts;
    const cur = snapshot(RecordBook, facts);
    RecordBook.DEFS.forEach((def) => {
      if (def.rate) return; // running averages shuffle their leader weekly; not "records set"
      const change = changeBetween(def, reign[def.id], cur[def.id]);
      const since = reignSince[def.id] || new Map();
      if (!change) {
        reign[def.id] = carryReign(reign[def.id], cur[def.id]);
        reignSince[def.id] = new Map(((reign[def.id] && reign[def.id].tops) || []).map((e) => [idOf(e), since.get(idOf(e))]).filter(([, at]) => at));
        return;
      }
      reign[def.id] = cur[def.id];
      // Co-leaders who were already in the reign keep their original date.
      reignSince[def.id] = new Map(cur[def.id].tops.map((e) => [idOf(e), since.get(idOf(e)) || { season: point.season, week: point.week }]));
      const s = change.subject;
      const scope = whenScope(s.when);
      const category = RecordBook.CATEGORIES.find((c) => c.id === def.cat);
      const isStart = i === 0;
      events.push({
        scope,
        when: s.when == null ? null : s.when,
        date: eventDate(scope, s.when, { season: point.season, week: point.week }, isStart && change.kind === "new", !!(category && category.history)),
        id: def.id,
        title: def.title,
        category: def.cat,
        categoryTitle: categoryTitle.get(def.cat) || def.cat,
        section: def.section,
        season: point.season,
        week: point.week,
        kind: change.kind,
        holder: s.name,
        playerId: s.playerId || null,
        value: s.valueText,
        detail: s.detail || "",
        previous: change.previous ? { holder: change.previous.name, value: change.previous.valueText } : null,
      });
    });
    prev = cur;
  });

  // Newest first; inside one week a record that changed hands outranks a mere
  // personal best, which outranks a record that simply appeared.
  events.sort(
    (a, b) =>
      Number(b.season) - Number(a.season) ||
      b.week - a.week ||
      KIND_RANK[b.kind] - KIND_RANK[a.kind] ||
      defOrder.get(a.id) - defOrder.get(b.id)
  );
  const last = points[points.length - 1] || null;

  // When did each record's CURRENT leader get there? The newest change in which
  // that holder appears. Averages and percentages shuffle every week, so they
  // have no "set on" date and are left out.
  const recent = new Set(points.slice(-RECENT_WEEKS).map((p) => `${p.season}|${p.week}`));
  const current = {};
  if (prev) {
    RecordBook.DEFS.forEach((def) => {
      const snap = prev[def.id]; // what the Records page leads with: the top of the final standings
      if (def.rate || !snap || snap.status !== "ok" || !snap.tops.length) return;
      const top = snap.tops[0];
      const at = (reignSince[def.id] || new Map()).get(idOf(top));
      if (!at) return; // a fresh tie at the very top has not held the record yet
      const ev = events.find((e) => e.id === def.id && e.holder === top.name && e.season === at.season && e.week === at.week);
      const scope = whenScope(top.when);
      const category = RecordBook.CATEGORIES.find((c) => c.id === def.cat);
      const isStart = !!points.length && at.season === points[0].season && at.week === points[0].week;
      current[def.id] = {
        holder: top.name, when: top.when == null ? null : top.when, scope,
        ...eventDate(scope, top.when, at, isStart, !!(category && category.history)),
        kind: ev ? ev.kind : "new", isNew: recent.has(`${at.season}|${at.week}`),
      };
    });
  }
  return { events, current, asOf: last ? { season: last.season, week: last.week } : null, points: points.length, finalFacts: lastFacts };
}

module.exports = { timePoints, bracketAsOf, powerRanksAsOf, rawStatsAsOf, inputAt, snapshot, changeBetween, carryReign, replay, playedWeeks, whenScope, eventDate, RECENT_WEEKS };
