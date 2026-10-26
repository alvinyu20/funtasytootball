/*
  "Records in Reach" — which active managers are closing in on a record they
  don't hold yet, for the Home page (see scripts/build-records-feed.js).

  Two kinds of record can be chased:
    total   a running career total that only ever goes up (def.grows):
            Career Wins, Career Points, Championships... A challenger is
            "in reach" when the gap is at most 5% of the record — or one
            notch for a small count (a record of 20 or less).
    streak  a weekly run still going this season (def.live): it is in reach
            when the record is at most three weeks away.

  Only managers who played in the newest season count: a retired manager
  can't catch anybody. Every manager within range of a record is listed, the
  closest one flagged `primary` — the Home page shows the primary ones to
  everybody, and puts a manager's own chases first once they've picked their
  team. The closest few across the book are kept.
*/

const REACH_LIMIT = 40;
const STREAK_MAX_GAP = 3;
const STREAK_MIN_LENGTH = 3;

function reachItems(RecordBook, facts, opts) {
  const limit = (opts && opts.limit) || REACH_LIMIT;
  const latest = facts.latest;
  if (!latest) return [];
  const active = new Set(facts.teamSeasons.filter((ts) => ts.season === latest.season).map((ts) => ts.key));
  if (!active.size) return [];

  const contexts = new Map();
  const ctxFor = (category) => {
    const sleeperOnly = !category.history;
    if (!contexts.has(sleeperOnly)) contexts.set(sleeperOnly, RecordBook.context(facts, "all", sleeperOnly));
    return contexts.get(sleeperOnly);
  };

  const items = [];
  RecordBook.DEFS.forEach((def) => {
    if (!def.grows && typeof def.live !== "function") return;
    const category = RecordBook.CATEGORIES.find((c) => c.id === def.cat);
    const ctx = ctxFor(category);
    let result;
    let rows;
    try {
      result = RecordBook.compute(def, ctx);
      rows = def.grows ? (def.compute(ctx).rows || []) : def.live(ctx);
    } catch (err) {
      return;
    }
    if (result.status !== "ok" || !result.entries.length) return;
    const lead = result.entries[0];
    if (!lead.key || !(lead.raw > 0)) return;
    const fmt = typeof def.fmt === "function" ? def.fmt : RecordBook.FORMATS[def.fmt || "int"];

    const chasers = [];
    rows.forEach((r) => {
      if (!r.key || r.key === lead.key || !active.has(r.key) || !Number.isFinite(r.raw)) return;
      const gap = lead.raw - r.raw;
      if (gap <= 0 && def.grows) return; // level with the record is a shared lead, not a chase
      if (gap < 0) return;
      const near = def.grows
        ? lead.raw <= 20 ? gap <= 1 : gap / lead.raw <= 0.05
        : gap <= STREAK_MAX_GAP && r.raw >= STREAK_MIN_LENGTH;
      if (!near) return;
      chasers.push({ key: r.key, raw: r.raw, gap });
    });
    chasers.sort((a, b) => a.gap - b.gap);

    chasers.forEach((best, idx) => {
      items.push({
        id: def.id,
        title: def.title,
        category: def.cat,
        categoryTitle: category.title,
        section: def.section,
        kind: def.grows ? "total" : "streak",
        challenger: ctx.name(best.key),
        current: fmt(best.raw, {}),
        holder: lead.name,
        record: lead.valueText,
        gap: fmt(best.gap, {}),
        ratio: best.gap / lead.raw,
        primary: idx === 0,
      });
    });
  });

  items.sort((a, b) => a.ratio - b.ratio || a.title.localeCompare(b.title));
  return items.slice(0, limit);
}

module.exports = { reachItems, REACH_LIMIT };
