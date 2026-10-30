/*
  The Draft page (draft.html).

  One season's draft at a time, in six views that share the year pills at the top:
    Overview      the shaded draft board, who drafted best, the biggest steals and costliest picks
                  (a season still being played gets "the draft so far" instead: points and pace, no grades)
    By Round      each round's picks in order, with the round's total against what its slots usually return
    By Team       every team as a card: the whole draft graded at a glance, open it for the pick list
    Table         every pick, filterable and sortable (it opens on All picks)
    Report Card   every manager across every graded year (all seasons, so the year pills step aside)
    Steals & Busts  the best and costliest picks ever (all seasons too)
  A tap on any pick opens a small card with the numbers behind it.

  The numbers all come from draft-data.js; this file is the page around them. Everything that draws is a
  plain function from data to an HTML string, so the tests can run them as they are.
*/
let SEASON_CHAIN = null;
let PLAYER_DIRECTORY = null;
let LEAGUE_STATS = null;
let DR = null; // the page's state, built once the data is in

const DD = DraftData;
const esc = (s) => escapeHtml(String(s == null ? "" : s));

// ---------------------------------------------------------------------------------------------
// Routes: #2025, #2025/table, #2025/team/<user id>, #2025/report
// ---------------------------------------------------------------------------------------------

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "round", label: "By Round" },
  { key: "team", label: "By Team" },
  { key: "table", label: "Table" },
  { key: "report", label: "Report Card", allTime: true },
  { key: "hall", label: "Steals & Busts", allTime: true },
];
const DEFAULT_TAB = "overview";

function tabsFor(hasGraded) {
  return TABS.filter((t) => !t.allTime || hasGraded);
}

function parseDraftHash(hash, seasons) {
  let parts = [];
  try {
    // split first, then decode each part, so an encoded "/" inside a team id stays inside it
    parts = String(hash || "").replace(/^#/, "").split("/").filter(Boolean).map(decodeURIComponent);
  } catch (err) {
    parts = [];
  }
  const out = { season: null, tab: null, team: null };
  parts.forEach((part) => {
    if (!out.season && seasons.includes(part)) out.season = part;
    else if (!out.tab && TABS.some((t) => t.key === part)) out.tab = part;
    else if (out.tab === "team" && !out.team) out.team = part;
  });
  return out;
}

function draftHash(season, tab, team) {
  const t = tab && tab !== DEFAULT_TAB ? `/${tab}` : "";
  const tm = tab === "team" && team ? `/${encodeURIComponent(team)}` : "";
  return `#${season}${t}${tm}`;
}

/*
  Which season the page opens to when the address names none: the newest season that has a draft on record,
  even when it is the season still being played (its draft already happened). A season with no picks yet
  (the upcoming year before its draft) is skipped; if none has any, the newest season in the chain.
*/
function pickDefaultSeason(seasonChain, stats) {
  if (!seasonChain || !seasonChain.length) return null;
  const data = stats || LEAGUE_STATS;
  const newestFirst = [...seasonChain].reverse();
  const withDraft = newestFirst.find((e) => DD.buildDraft(data, e.league.season));
  return String((withDraft || seasonChain[seasonChain.length - 1]).league.season);
}

// The manager the My Team picker names (a username), as a user id; null when nobody is picked or they have no draft.
function meIdFor(stats, username) {
  const key = String(username == null ? "" : username).trim().toLowerCase();
  if (!key) return null;
  const m = ((stats && stats.managers) || []).find((x) => String(x.username || "").trim().toLowerCase() === key || String(x.teamName || "").trim().toLowerCase() === key);
  return m ? m.userId : null;
}

// Everyone who is in the league now: the managers with a team in the newest season. null means "everyone".
function currentIdsFor(stats, seasonChain) {
  if (!seasonChain || !seasonChain.length) return null;
  const latest = String(seasonChain[seasonChain.length - 1].league.season);
  const ids = ((stats && stats.managers) || []).filter((m) => (m.seasons || []).some((s) => String(s.season) === latest)).map((m) => m.userId);
  return ids.length ? new Set(ids) : null;
}

// ---------------------------------------------------------------------------------------------
// Small pieces of markup
// ---------------------------------------------------------------------------------------------

const KNOWN_POS = ["QB", "RB", "WR", "TE", "K", "DEF"];
const posClass = (pos) => `pos-${(KNOWN_POS.includes(pos) ? pos : "other").toLowerCase()}`;
const posBadgeHtml = (pos) => (pos ? `<span class="dr-pos ${posClass(pos)}">${esc(pos)}</span>` : "");
const youTagHtml = () => `<span class="dr-you">YOU</span>`;
const fmtPts = (n) => (n == null ? "" : Number(n).toFixed(1));
const fmtBig = (n) => Math.round(n).toLocaleString("en-US");
const toneOf = (n) => (n > 0 ? "good" : n < 0 ? "bad" : "plain");

const CAP_NOTE = "Held at B: a kicker or defense, or a player who missed over half the season, cannot earn a higher grade";

function gradeSqHtml(g, extra, note) {
  if (!DD.GRADES.includes(g)) return `<span class="gr gr-none${extra ? ` ${extra}` : ""}" aria-label="No grade">–</span>`;
  return `<span class="gr gr-${g}${extra ? ` ${extra}` : ""}"${note ? ` title="${esc(note)}"` : ""} aria-label="Grade ${g}${note ? `. ${esc(note)}` : ""}">${g}</span>`;
}
const pickGradeHtml = (p, extra) => gradeSqHtml(p.grade, extra, p.capped ? CAP_NOTE : null);

function vsPillHtml(p) {
  if (p.vs == null) return "";
  return `<span class="dr-vs ${DD.bandOfVs(p.vs)}">${DD.signed(p.vs)}</span>`;
}

// The whole draft as a row of grade squares with their letters (the By Team cards).
function lettersHtml(grades) {
  const sq = (g) => (DD.GRADES.includes(g) ? `<span class="gr gr-${g}">${g}</span>` : `<span class="gr gr-none">–</span>`);
  const spoken = (grades || []).map((g) => g || "none").join(", ");
  return `<span class="dr-letters" role="img" aria-label="Grades in draft order: ${esc(spoken)}">${(grades || []).map(sq).join("")}</span>`;
}

// One tiny square per pick, colored by grade (a pick with no grade is an empty slot).
function minisHtml(grades) {
  const squares = (grades || []).map((g) => `<i class="dr-sq ${DD.GRADES.includes(g) ? `gr-${g}` : "gr-none"}"></i>`).join("");
  const spoken = (grades || []).map((g) => g || "none").join(", ");
  return `<span class="dr-minis" role="img" aria-label="Grades in draft order: ${esc(spoken)}">${squares}</span>`;
}

function rankHtml(p) {
  if (!p.rank || !p.rank.text) return "";
  const d = p.rank.delta;
  const arrow = d > 0 ? ` <b class="dr-up">▲${d}</b>` : d < 0 ? ` <b class="dr-down">▼${-d}</b>` : "";
  return `${esc(p.rank.text)}${arrow}`;
}

const injTagHtml = (p) => (p.injWeeks > 0 ? `<span class="dr-inj">${p.injWeeks} inj</span>` : "");

function teamTagHtml(d, userId, me) {
  const t = d.teams.find((x) => x.userId === userId);
  const label = DD.teamLabel(d, userId, me);
  return `<span class="dr-tt${userId === me ? " dr-tt-me" : ""}" title="${esc(t ? t.name : "")}">${esc(label)}</span>`;
}

function tilesHtml(tiles) {
  if (!tiles.length) return "";
  const body = tiles
    .map((t) => {
      const inner = `<span class="dr-tile-label">${esc(t.label)}</span><span class="dr-tile-main" title="${esc(t.main)}">${esc(t.main)}</span><span class="dr-tile-sub">${esc(t.sub)}</span>`;
      const cls = `dr-tile${t.tone ? ` dr-tone-${t.tone}` : ""}`;
      return t.pick ? `<button type="button" class="${cls} dr-tile-btn" data-pick="${esc(t.pick)}">${inner}</button>` : `<div class="${cls}">${inner}</div>`;
    })
    .join("");
  return `<div class="dr-tiles dr-tiles-${tiles.length}">${body}</div>`;
}

function gradeKeyHtml() {
  return `<span class="dr-gkey" aria-label="Grade colors">${DD.GRADES.map((g) => `<span class="dr-gkey-item">${gradeSqHtml(g, "dr-gkey-sq")}</span>`).join("")}</span>`;
}

// ---------------------------------------------------------------------------------------------
// Pick rows: one description of the columns per list, used for the wide row and the phone's two lines
// ---------------------------------------------------------------------------------------------

const COLS = {
  pick: { w: "46px", head: "Pick" },
  team: { w: "58px", head: "Team" },
  player: { w: "minmax(0, 1fr)", head: "Player" },
  grade: { w: "40px", head: "Grade", ctr: true },
  vs: { w: "68px", head: "Vs slot", ctr: true },
  rank: { w: "116px", head: "Pos. rank" },
  pts: { w: "64px", head: "Points", num: true },
  ppg: { w: "58px", head: "Per game", num: true },
  gp: { w: "54px", head: "Games", num: true },
  inj: { w: "58px", head: "Hurt", ctr: true },
};

const LAYOUTS = {
  round: { graded: ["pick", "team", "player", "grade", "vs", "rank"], live: ["pick", "team", "player", "pts", "ppg", "gp", "inj"] },
  team: { graded: ["pick", "player", "grade", "vs", "rank", "gp", "inj"], live: ["pick", "player", "pts", "ppg", "gp", "inj"] },
  mini: { graded: ["pick", "player", "grade", "vs"], live: ["pick", "player", "pts", "ppg"] },
  // the Table tab on a phone: the wide version is a real table, so only what the two lines show matters
  table: { graded: ["pick", "team", "player", "grade", "vs", "rank", "gp", "inj"], live: ["pick", "team", "player", "pts", "ppg", "rank", "gp", "inj"] },
};

const layoutFor = (kind, graded) => LAYOUTS[kind][graded ? "graded" : "live"];

function gamesText(p, d) {
  if (p.gp == null) return "";
  if (!d.graded && p.gamesPossible != null) return `${p.gp} of ${p.gamesPossible}`;
  return String(p.gp);
}

function cellHtml(key, p, d, me) {
  switch (key) {
    case "pick":
      return `<span class="c-pick">${esc(p.label)}</span>`;
    case "team":
      return `<span class="c-team">${teamTagHtml(d, p.userId, me)}</span>`;
    case "player":
      return `<span class="c-player">${posBadgeHtml(p.position)}<span class="c-name">${esc(p.player)}</span>${p.isKeeper ? `<span class="dr-keeper">keeper</span>` : ""}</span>`;
    case "grade":
      return `<span class="c-grade">${pickGradeHtml(p)}</span>`;
    case "vs":
      return `<span class="c-vs">${vsPillHtml(p)}</span>`;
    case "rank":
      return `<span class="c-rank">${rankHtml(p)}</span>`;
    case "pts":
      return `<span class="c-pts">${fmtPts(p.points)}</span>`;
    case "ppg":
      return `<span class="c-ppg${DD.isHot(p) ? " dr-hot" : ""}">${p.ppg == null ? "" : fmtPts(p.ppg)}</span>`;
    case "gp":
      return `<span class="c-gp">${esc(gamesText(p, d))}</span>`;
    case "inj":
      return `<span class="c-inj">${injTagHtml(p)}</span>`;
    default:
      return "";
  }
}

function narrowHtml(p, d, me, cols) {
  const has = (k) => cols.includes(k);
  const sub = [];
  sub.push(posBadgeHtml(p.position));
  if (has("team")) sub.push(teamTagHtml(d, p.userId, me));
  if (p.rank && p.rank.text) sub.push(`<span class="n-rank">${rankHtml(p)}</span>`);
  if (has("gp") && p.gp != null) sub.push(`<span>${esc(gamesText(p, d))} GP</span>`);
  const end = d.graded
    ? `${pickGradeHtml(p)}${vsPillHtml(p)}`
    : `<span class="n-pts"><b>${fmtPts(p.points)}</b>${p.ppg != null ? `<small class="${DD.isHot(p) ? "dr-hot" : ""}">${fmtPts(p.ppg)}/g</small>` : ""}</span>`;
  return `<span class="dr-narrow"><span class="n-pick">${esc(p.label)}</span><span class="n-main"><span class="n-name"><span class="n-pname">${esc(p.player)}</span>${p.isKeeper ? `<span class="dr-keeper">keeper</span>` : ""}${has("inj") ? injTagHtml(p) : ""}</span><span class="n-sub">${sub.filter(Boolean).join("")}</span></span><span class="n-end">${end}</span></span>`;
}

function rowHtml(p, d, me, kind, { mark = true } = {}) {
  const cols = layoutFor(kind, d.graded);
  const mine = mark && p.userId === me;
  const wide = `<span class="dr-wide">${cols.map((k) => cellHtml(k, p, d, me)).join("")}</span>`;
  return `<li><button type="button" class="dr-row${mine ? " dr-me" : ""}" data-pick="${esc(p.key)}">${wide}${narrowHtml(p, d, me, cols)}</button></li>`;
}

function rowsHeadHtml(cols) {
  return `<li class="dr-rowhead" aria-hidden="true"><span class="dr-wide">${cols
    .map((k) => `<span class="c-${k}${COLS[k].num ? " c-num" : ""}${COLS[k].ctr ? " c-ctr" : ""}">${esc(COLS[k].head)}</span>`)
    .join("")}</span></li>`;
}

function colsStyle(cols) {
  return cols.map((k) => COLS[k].w).join(" ");
}

function rowsHtml(picks, d, me, kind, opts) {
  const cols = layoutFor(kind, d.graded);
  return `<ul class="dr-rows dr-k-${kind}" style="--cols: ${colsStyle(cols)}">${rowsHeadHtml(cols)}${picks.map((p) => rowHtml(p, d, me, kind, opts)).join("")}</ul>`;
}

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------

function boardCellHtml(cell, d, me) {
  const p = cell.pick;
  if (!p) return `<td class="dr-cell-empty"></td>`;
  const spoken = `Pick ${p.label}, ${p.player}, ${p.position}${p.grade ? `, grade ${p.grade}` : ""}${p.vs != null ? `, ${DD.signed(p.vs)} versus slot` : ""}, drafted by ${p.owner}`;
  const meta = p.vs != null ? `${p.grade ? `${esc(p.grade)} ` : ""}${DD.signed(p.vs)}` : esc(p.position);
  return `<td><button type="button" class="dr-cell ${DD.bandOfVs(p.vs)} ${posClass(p.position)}${p.userId === me ? " dr-mine" : ""}" data-pick="${esc(p.key)}" aria-label="${esc(spoken)}"><span class="dr-cell-name">${esc(DD.lastName(p.player))}</span><span class="dr-cell-meta">${meta}</span></button>${cell.extra ? `<i class="dr-cell-extra" title="Also holds ${cell.extra} more pick${cell.extra === 1 ? "" : "s"} this round">+${cell.extra}</i>` : ""}</td>`;
}

function boardHtml(d, me) {
  const head = d.teams.map((t) => `<th scope="col" class="${t.userId === me ? "dr-me-col" : ""}" title="${esc(t.name)}">${esc(DD.teamLabel(d, t.userId, me))}</th>`).join("");
  const rows = DD.boardRows(d)
    .map((r) => `<tr><th scope="row" class="dr-round">${r.round}</th>${r.cells.map((c) => boardCellHtml(c, d, me)).join("")}</tr>`)
    .join("");
  return `<div class="dr-board-scroll"><table class="dr-board"><thead><tr><td class="dr-board-corner"></td>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function boardLegendHtml(hasMe) {
  return `<div class="dr-legend"><span>costly</span><i class="dr-lg b1"></i><i class="dr-lg b2"></i><i class="dr-lg b3"></i><i class="dr-lg b4"></i><i class="dr-lg b5"></i><span>steal</span>${hasMe ? `<span class="dr-legend-me"><i class="dr-lg-me"></i>your pick</span>` : ""}<span class="dr-legend-swipe">swipe sideways for every team</span></div>`;
}

function wdbRowHtml(t, d, me, openId) {
  const mine = t.userId === me;
  return `<details class="dr-wdb-item${mine ? " dr-me" : ""}"${openId && t.userId === openId ? " open" : ""}>
    <summary class="dr-wdb-row"><span class="dr-rank">${t.rank}</span><span class="dr-wdb-name">${esc(t.name)}</span>${minisHtml(t.grades)}<span class="dr-total dr-tone-${toneOf(t.total)}">${DD.signed(t.total)}</span><i class="dr-chev" aria-hidden="true"></i></summary>
    <ul class="dr-rows dr-k-mini" style="--cols: ${colsStyle(layoutFor("mini", true))}">${t.picks.map((p) => rowHtml(p, d, me, "mini", { mark: false })).join("")}</ul>
  </details>`;
}

function shortListHtml(lists, d, me) {
  const row = (p) =>
    `<li><button type="button" class="dr-sl-row${p.userId === me ? " dr-me" : ""}" data-pick="${esc(p.key)}"><span class="dr-sl-pick">${esc(p.label)}</span><span class="dr-sl-name">${esc(p.player)}<small>${teamTagHtml(d, p.userId, me)}</small></span><span class="dr-sl-vs dr-tone-${toneOf(p.vs)}">${DD.signed(p.vs)}</span></button></li>`;
  return `<ul class="dr-sl">${[...lists.steals, ...lists.costly].map(row).join("")}</ul>`;
}

function overviewHtml(d, me, openId) {
  const lists = DD.shortLists(d);
  const hasMe = d.teams.some((t) => t.userId === me);
  const side = `
      <section class="panel dr-wdb-panel" aria-label="Who drafted best">
        <h2>Who drafted best</h2>
        <p class="dr-sub">total vs slot · squares are the picks, colored by grade</p>
        <div class="dr-wdb">${d.ranked.map((t) => wdbRowHtml(t, d, me, openId)).join("")}</div>
      </section>
      <section class="panel dr-sl-panel" aria-label="Steals and costliest picks">
        <h2>Steals and costliest picks</h2>
        ${shortListHtml(lists, d, me)}
      </section>`;
  return `
    ${tilesHtml(DD.overviewTiles(d, me))}
    <div class="dr-ov">
      <section class="panel dr-board-panel" aria-label="Draft board">
        <div class="panel-head"><h2>Draft board</h2><span class="dr-note">shaded by value vs slot</span></div>
        ${boardHtml(d, me)}
        ${boardLegendHtml(hasMe)}
      </section>
      <div class="dr-ov-side">${side}</div>
    </div>`;
}

// ---------------------------------------------------------------------------------------------
// The draft so far (a season still being played)
// ---------------------------------------------------------------------------------------------

function liveNoteHtml(d) {
  return `<div class="dr-note-bar"><span class="dr-chip">Through week ${esc(d.weeksPlayed == null ? "" : d.weeksPlayed)}</span><span>Grades and value vs slot need a full season, so until then this counts points and games. Points are for everyone a team drafted, starters or not.</span></div>`;
}

function liveOverviewHtml(d, me) {
  const m = DD.liveModel(d);
  const showInj = d.teams.some((t) => t.injWeeks != null);
  const total = (t) => `<li><div class="dr-pt-row${t.userId === me ? " dr-me" : ""}"><span class="dr-rank">${t.rank}</span><span class="dr-pt-name">${esc(t.name)}${t.userId === me ? youTagHtml() : ""}</span><b class="dr-pt-pts">${fmtBig(t.points)}</b>${showInj && t.injWeeks != null ? `<span class="dr-pt-inj">${t.injWeeks} inj</span>` : ""}</div></li>`;
  const listRow = (p, endHtml) =>
    `<li><button type="button" class="dr-sl-row${p.userId === me ? " dr-me" : ""}" data-pick="${esc(p.key)}"><span class="dr-sl-pick">${esc(p.label)}</span><span class="dr-sl-team">${teamTagHtml(d, p.userId, me)}</span><span class="dr-sl-name">${esc(p.player)}</span><span class="dr-sl-pts">${fmtPts(p.points)}</span>${endHtml}</button></li>`;
  const hot = m.hotStarts.length
    ? `<section class="panel dr-live-hot" aria-label="Hot starts"><h2>Hot starts after round ${DD.HOT_AFTER_ROUND}</h2><p class="dr-sub">points per game, ${DD.HOT_MIN_GAMES} or more games played</p><ul class="dr-sl dr-sl-live">${m.hotStarts.map((p) => listRow(p, `<span class="dr-sl-end dr-hot">${fmtPts(p.ppg)}/g</span>`)).join("")}</ul></section>`
    : "";
  const hurt = m.hurtEarly.length
    ? `<section class="panel dr-live-hurt" aria-label="Early picks who are hurt"><h2>Early picks who are hurt</h2><p class="dr-sub">rounds 1 to ${DD.HURT_MAX_ROUND}, ${DD.HURT_MIN_INJ} or more injury weeks (points so far)</p><ul class="dr-sl dr-sl-live">${m.hurtEarly.map((p) => listRow(p, `<span class="dr-sl-end dr-tone-bad">${p.injWeeks} inj</span>`)).join("")}</ul></section>`
    : "";
  return `
    ${liveNoteHtml(d)}
    <div class="dr-live">
      <section class="panel dr-live-r1" aria-label="Round 1 so far"><h2>Round 1 so far</h2>${rowsHtml(m.roundOne, d, me, "round")}</section>
      <section class="panel dr-live-pts" aria-label="Points from the whole draft"><h2>Points from the whole draft</h2><p class="dr-sub">all ${d.rounds} picks added up${showInj ? " · injury weeks lost" : ""}</p><ol class="dr-pt-list">${m.teamPoints.map(total).join("")}</ol></section>
    </div>
    ${hot || hurt ? `<div class="dr-live-bottom">${hot}${hurt}</div>` : ""}`;
}

// ---------------------------------------------------------------------------------------------
// By Round
// ---------------------------------------------------------------------------------------------

function roundLineHtml(r, d) {
  if (d.graded) {
    const bits = [];
    if (r.best) bits.push(`Best: ${esc(r.best.player)} (${DD.signed(r.best.vs)}).`);
    if (r.worst) bits.push(`Costliest: ${esc(r.worst.player)} (${DD.signed(r.worst.vs)}).`);
    return bits.join(" ");
  }
  const top = r.picks.reduce((b, p) => (!b || p.points > b.points ? p : b), null);
  return top && top.points > 0 ? `Most points: ${esc(top.player)} (${fmtPts(top.points)}).` : "";
}

function byRoundHtml(d, me) {
  const rounds = DD.roundSummaries(d);
  const chips = rounds.map((r) => `<button type="button" class="dr-rchip" data-jump="dr-round-${r.round}" aria-label="Jump to round ${r.round}">${r.round}</button>`).join("");
  const panels = rounds
    .map((r) => {
      const line = roundLineHtml(r, d);
      return `<section class="panel dr-round" id="dr-round-${r.round}" aria-label="Round ${r.round}">
        <div class="dr-round-head"><h2>Round ${r.round}</h2>${d.graded ? `<span class="dr-round-total dr-tone-${toneOf(r.total)}"><b>${DD.signed(r.total)}</b> round total vs slot</span>` : ""}</div>
        ${line ? `<p class="dr-sub">${line}</p>` : ""}
        ${rowsHtml(r.picks, d, me, "round")}
      </section>`;
    })
    .join("");
  return `<nav class="dr-rchips" aria-label="Jump to a round"><span class="dr-rchips-label">Round</span>${chips}</nav><div class="dr-rounds">${panels}</div>`;
}

// ---------------------------------------------------------------------------------------------
// By Team
// ---------------------------------------------------------------------------------------------

function teamCardHtml(t, d, me, openId) {
  const mine = t.userId === me;
  const mix = t.mix.map((m) => `<span class="dr-mixchip ${posClass(m.pos)}">${esc(m.pos)} ${m.n}</span>`).join("");
  let score;
  let squares = "";
  let bw = "";
  if (d.graded) {
    score = `<small>total vs slot</small><b class="dr-tone-${toneOf(t.total)}">${DD.signed(t.total)}</b>`;
    squares = lettersHtml(t.grades);
    const bits = [];
    if (t.best) bits.push(`Best ${esc(DD.lastName(t.best.player))} ${DD.signed(t.best.vs)}`);
    if (t.worst) bits.push(`Costliest ${esc(DD.lastName(t.worst.player))} ${DD.signed(t.worst.vs)}`);
    bw = bits.join(" · ");
  } else {
    score = `<small>points</small><b>${fmtBig(t.points)}</b>`;
    const bits = [];
    if (t.hottest) bits.push(`Hottest ${esc(DD.lastName(t.hottest.player))} ${fmtPts(t.hottest.ppg)}/g`);
    if (t.injWeeks != null) bits.push(`${t.injWeeks} injury weeks`);
    bw = bits.join(" · ");
  }
  return `<details class="dr-team${mine ? " dr-me" : ""}" id="dr-team-${esc(t.userId)}"${openId && t.userId === openId ? " open" : ""}>
    <summary class="dr-team-sum">
      <span class="dr-rank">${t.rank}</span>
      <span class="dr-team-id"><b class="dr-team-name">${esc(t.name)}</b>${mine ? youTagHtml() : ""}<small>${t.slot != null ? `<span class="dr-pf">picked </span>from slot ${t.slot}` : ""}</small></span>
      <span class="dr-team-score">${score}</span>
      <span class="dr-team-squares">${squares}</span>
      <span class="dr-team-foot"><span class="dr-mix">${mix}</span><span class="dr-bw">${bw}</span></span>
      <i class="dr-chev" aria-hidden="true"></i>
    </summary>
    ${rowsHtml(t.picks, d, me, "team", { mark: false })}
  </details>`;
}

function byTeamHtml(d, me, openId) {
  return `<div class="dr-teams">${d.ranked.map((t) => teamCardHtml(t, d, me, openId)).join("")}</div>`;
}

// ---------------------------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------------------------

const SORT_LABELS_GRADED = [["pick", "Pick order"], ["vs", "Vs slot"], ["points", "Points"], ["value", "Value"], ["typical", "Typical"], ["gp", "Games"], ["starts", "Starts"], ["inj", "Injury weeks"]];
const SORT_LABELS_LIVE = [["pick", "Pick order"], ["points", "Points"], ["ppg", "Per game"], ["gp", "Games"], ["starts", "Starts"], ["inj", "Injury weeks"]];

function filtersHtml(opts, active) {
  return `<div class="dr-filters" role="group" aria-label="Filter the picks">${opts
    .map((o) => `<button type="button" class="dr-pill${o.key === active ? " active" : ""}" data-filter="${esc(o.key)}" aria-pressed="${o.key === active ? "true" : "false"}">${esc(o.label)}${o.key === "all" || o.key === "mine" ? ` <span class="dr-pill-n">${o.count}</span>` : ""}</button>`)
    .join("")}</div>`;
}

function sortArrow(key, sort, active) {
  if (!active) return "";
  // pick order runs small to big; every number column runs big to small (see DraftData.sortPicks)
  const up = (key === "pick") === (sort.dir === 1);
  return up ? " ▴" : " ▾";
}

function tableColumns(d, hideTeam) {
  const cols = d.graded
    ? [
        { k: "pick", sort: "pick", head: "Pick" },
        { k: "team", head: "Team" },
        { k: "player", head: "Player" },
        { k: "grade", head: "Grade" },
        { k: "points", sort: "points", head: "Points", num: true },
        { k: "value", sort: "value", head: "Value", num: true },
        { k: "typical", sort: "typical", head: "Typical", num: true },
        { k: "vs", sort: "vs", head: "Vs slot", ctr: true },
        { k: "rank", head: "Pos. rank" },
        { k: "gp", sort: "gp", head: "GP", num: true },
        { k: "starts", sort: "starts", head: "ST", num: true },
      ]
    : [
        { k: "pick", sort: "pick", head: "Pick" },
        { k: "team", head: "Team" },
        { k: "player", head: "Player" },
        { k: "points", sort: "points", head: "Points", num: true },
        { k: "ppg", sort: "ppg", head: "Per game", num: true },
        { k: "rank", head: "Pos. rank" },
        { k: "gp", sort: "gp", head: "GP", num: true },
        { k: "starts", sort: "starts", head: "ST", num: true },
      ];
  return cols.filter((c) => !(hideTeam && c.k === "team"));
}

function tableCellHtml(c, p, d, me) {
  switch (c.k) {
    case "pick":
      return `<td class="t-pick">${esc(p.label)}</td>`;
    case "team":
      return `<td class="t-team">${teamTagHtml(d, p.userId, me)}</td>`;
    case "player":
      return `<td class="t-player">${posBadgeHtml(p.position)}<button type="button" class="dr-name" data-pick="${esc(p.key)}">${esc(p.player)}</button>${p.isKeeper ? `<span class="dr-keeper">keeper</span>` : ""}</td>`;
    case "grade":
      return `<td class="t-grade">${pickGradeHtml(p)}</td>`;
    case "points":
      return `<td class="t-num">${fmtPts(p.points)}</td>`;
    case "value":
      return `<td class="t-num">${p.value == null ? "" : p.value}</td>`;
    case "typical":
      return `<td class="t-num t-dim">${p.typical == null ? "" : p.typical}</td>`;
    case "vs":
      return `<td class="t-vs">${vsPillHtml(p)}</td>`;
    case "ppg":
      return `<td class="t-num${DD.isHot(p) ? " dr-hot" : ""}">${p.ppg == null ? "" : fmtPts(p.ppg)}</td>`;
    case "rank":
      return `<td class="t-rank">${rankHtml(p)}</td>`;
    case "gp":
      return `<td class="t-num">${p.gp == null ? "" : p.gp}</td>`;
    case "starts":
      return `<td class="t-num t-st">${p.starts == null ? "" : p.starts}${injTagHtml(p)}</td>`;
    default:
      return "<td></td>";
  }
}

function tableHtml(picks, d, me, ui, filterKey) {
  const cols = tableColumns(d, filterKey === "mine");
  const head = cols
    .map((c) => {
      const cls = `${c.num ? "t-num" : ""}${c.ctr ? " t-ctr" : ""}`.trim();
      if (!c.sort) return `<th scope="col" class="${cls}">${esc(c.head)}</th>`;
      const active = ui.sort.key === c.sort;
      return `<th scope="col" class="${cls}" aria-sort="${active ? (sortArrow(c.sort, ui.sort, true).includes("▴") ? "ascending" : "descending") : "none"}"><button type="button" class="dr-sort${active ? " active" : ""}" data-sort="${c.sort}">${esc(c.head)}${sortArrow(c.sort, ui.sort, active)}</button></th>`;
    })
    .join("");
  const body = picks.map((p) => `<tr class="${p.userId === me ? "dr-me" : ""}" data-pick="${esc(p.key)}">${cols.map((c) => tableCellHtml(c, p, d, me)).join("")}</tr>`).join("");
  const labels = d.graded ? SORT_LABELS_GRADED : SORT_LABELS_LIVE;
  const known = d.teams.some((t) => t.injWeeks != null);
  const select = `<label class="dr-sortsel"><span>Sort by</span><select id="dr-sort" aria-label="Sort the picks">${labels
    .filter(([k]) => k !== "inj" || known)
    .map(([k, label]) => `<option value="${k}"${ui.sort.key === k ? " selected" : ""}>${esc(label)}</option>`)
    .join("")}</select></label>`;
  const phone = `<ul class="dr-rows dr-k-table">${picks.map((p) => rowHtml(p, d, me, "table")).join("")}</ul>`;
  return `${select}<div class="dr-table-wrap"><table class="dr-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${phone}`;
}

function tableNoteHtml(d) {
  return d.graded
    ? `<p class="dr-foot"><b>Value</b> is season points above a replacement player at that position. <b>Typical</b> is what that draft slot usually returns, so <b>vs slot</b> is the gap. <b>GP</b> games played, <b>ST</b> weeks started, and the small tag is weeks lost to injury.</p>`
    : `<p class="dr-foot"><b>GP</b> games played, <b>ST</b> weeks started, and the small tag is weeks lost to injury. Grades and value vs slot arrive when the season ends.</p>`;
}

function tableTabHtml(d, me, ui) {
  const opts = DD.filterOptions(d, me);
  const key = opts.some((o) => o.key === ui.filter) ? ui.filter : "all";
  const shown = DD.filterPicks(d, key, me);
  const picks = DD.sortPicks(shown, ui.sort.key, ui.sort.dir);
  return `${tilesHtml(DD.tableTiles(d, shown, { filterKey: key, meId: me }))}${filtersHtml(opts, key)}${tableHtml(picks, d, me, ui, key)}${tableNoteHtml(d)}`;
}

// ---------------------------------------------------------------------------------------------
// Report Card (every graded year)
// ---------------------------------------------------------------------------------------------

function cellTitle(c) {
  return `${c.year}: ${DD.signed(c.total)} vs slot, ${DD.ordinal(c.rank)} of ${c.of}${c.slot != null ? `, slot ${c.slot}` : ""}`;
}

function rcListHtml(title, items, kind) {
  const rows = items
    .map((s) => {
      const label = kind === "mine" ? `${DD.ordinal(s.rank)} of ${s.of}${s.slot != null ? `, slot ${s.slot}` : ""}` : esc(s.name);
      return `<li><a class="dr-rcl-row" href="${draftHash(s.year, "team", s.userId)}"><span class="dr-rcl-y">${s.year}</span><span class="dr-rcl-n">${kind === "mine" ? esc(label) : label}</span><b class="dr-tone-${toneOf(s.total)}">${DD.signed(s.total)}</b></a></li>`;
    })
    .join("");
  return `<section class="panel dr-rcl" aria-label="${esc(title)}"><h3>${esc(title)}</h3><ol>${rows}</ol></section>`;
}

function rcCellHtml(c) {
  if (!c) return `<td class="dr-rc-none">–</td>`;
  return `<td><a class="dr-rc-cell ${c.band}" href="${draftHash(c.year, "team", c.userId)}" title="${esc(cellTitle(c))}"><span class="dr-rc-t">${DD.signed(c.total)}</span><span class="dr-rc-r">#${c.rank}</span>${minisHtml(c.grades)}</a></td>`;
}

function rcGridHtml(rc) {
  const head = rc.years.map((y) => `<th scope="col">${y}</th>`).join("");
  const rows = rc.rows
    .map((r) => {
      const cells = r.cells.map((c) => (c ? rcCellHtml({ ...c, userId: r.userId }) : rcCellHtml(null))).join("");
      return `<tr class="${r.isMe ? "dr-me" : ""}${r.past ? " dr-past" : ""}"><th scope="row" class="dr-rc-mgr"><b>${esc(r.name)}</b><small>${r.past ? "former manager" : `${r.drafts} draft${r.drafts === 1 ? "" : "s"}`}</small></th>${cells}<td class="dr-rc-tot dr-tone-${toneOf(r.total)}">${DD.signed(r.total)}</td><td class="dr-rc-avg">${DD.signed(Math.round(r.avg))}/yr</td></tr>`;
    })
    .join("");
  return `<div class="dr-rc-wrap"><table class="dr-rc"><thead><tr><th scope="col" class="dr-rc-mgr">Manager</th>${head}<th scope="col">Total</th><th scope="col">Avg</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// The phone's version: one year at a time (or the totals), one manager per row.
function rcPhoneHtml(rc, ui) {
  const sel = ui.reportYear === "total" || !rc.years.includes(Number(ui.reportYear)) ? "total" : String(ui.reportYear);
  const chips = ["total", ...[...rc.years].reverse().map(String)]
    .map((k) => `<button type="button" class="dr-ychip${k === sel ? " active" : ""}" data-report-year="${k}" aria-pressed="${k === sel ? "true" : "false"}">${k === "total" ? "Total" : k}</button>`)
    .join("");
  let list;
  if (sel === "total") {
    list = rc.rows
      .map(
        (r) =>
          `<li class="dr-rcp-row${r.isMe ? " dr-me" : ""}${r.past ? " dr-past" : ""}"><span class="dr-rank">${rc.rows.indexOf(r) + 1}</span><span class="dr-rcp-main"><b>${esc(r.name)}${r.isMe ? youTagHtml() : ""}</b><small>${r.past ? "former manager" : `${r.drafts} draft${r.drafts === 1 ? "" : "s"}`} · ${DD.signed(Math.round(r.avg))}/yr</small></span><b class="dr-rcp-total dr-tone-${toneOf(r.total)}">${DD.signed(r.total)}</b></li>`
      )
      .join("");
  } else {
    const idx = rc.years.indexOf(Number(sel));
    list = rc.rows
      .filter((r) => r.cells[idx])
      .sort((a, b) => b.cells[idx].total - a.cells[idx].total)
      .map((r) => {
        const c = r.cells[idx];
        return `<li class="dr-rcp-row${r.isMe ? " dr-me" : ""}${r.past ? " dr-past" : ""}"><span class="dr-rank">${c.rank}</span><span class="dr-rcp-main"><b>${esc(r.name)}${r.isMe ? youTagHtml() : ""}</b>${minisHtml(c.grades)}</span><a class="dr-rcp-total ${c.band}" href="${draftHash(c.year, "team", r.userId)}" title="${esc(cellTitle(c))}">${DD.signed(c.total)}</a></li>`;
      })
      .join("");
  }
  return `<div class="dr-rcp"><div class="dr-ychips" role="group" aria-label="Year">${chips}</div><ul class="dr-rcp-list">${list}</ul></div>`;
}

function reportHtml(stats, me, currentIds, ui) {
  const rc = DD.reportCard(stats, { currentIds, includePast: !!ui.includePast, meId: me });
  if (!rc.years.length) return `<div class="empty-state">No graded drafts yet. The first report card lands when a season ends.</div>`;
  const lists = [rcListHtml("Best drafts ever", rc.best, "best"), rcListHtml("Worst drafts ever", rc.worst, "worst")];
  if (rc.mine.length) lists.push(rcListHtml("Your drafts", rc.mine, "mine"));
  const toggle = rc.pastCount
    ? `<label class="dr-toggle"><span>Include past managers</span><input type="checkbox" id="dr-past"${ui.includePast ? " checked" : ""} /><i class="dr-switch" aria-hidden="true"></i></label>`
    : "";
  return `
    <div class="dr-rc-page">
    <div class="dr-rc-top dr-rc-top-${lists.length}">${lists.join("")}</div>
    <section class="panel dr-rc-panel" aria-label="Report card">
      <div class="panel-head"><h2>Report card</h2>${toggle}</div>
      <div class="dr-rc-desk">${rcGridHtml(rc)}</div>
      ${rcPhoneHtml(rc, ui)}
      <div class="dr-legend dr-legend-rc">${gradeKeyHtml()}<span>#N is that year's rank among the teams that drafted</span></div>
    </section>
    </div>`;
}

// ---------------------------------------------------------------------------------------------
// Steals & Busts (every graded year)
// ---------------------------------------------------------------------------------------------

function hallRowHtml(p, me) {
  const yr = `'${String(p.season).slice(2)}`;
  return `<li><button type="button" class="dr-row dr-hall${p.userId === me ? " dr-me" : ""}" data-pick="${esc(p.key)}">
    <span class="dr-wide"><span class="c-yr">${yr}</span><span class="c-pick">${esc(p.label)}</span><span class="c-player c-two">${posBadgeHtml(p.position)}<span class="c-stack"><span class="c-name">${esc(p.player)}</span><small>${esc(p.owner)} · ${fmtPts(p.points)} pts</small></span></span><span class="c-grade">${pickGradeHtml(p)}</span><span class="c-num">${p.value}</span><span class="c-num c-dim">${p.typical}</span><span class="c-vs">${vsPillHtml(p)}</span></span>
    <span class="dr-narrow"><span class="n-pick">${yr}<br />${esc(p.label)}</span><span class="n-main"><span class="n-name">${esc(p.player)}</span><span class="n-sub">${posBadgeHtml(p.position)}<span>${esc(p.owner)}</span><span>${fmtPts(p.points)} pts</span></span></span><span class="n-end">${pickGradeHtml(p)}${vsPillHtml(p)}</span></span>
  </button></li>`;
}

const HALL_COLS = "34px 46px minmax(0, 1fr) 40px 52px 52px 68px";

function hallPanelHtml(title, sub, picks, me, tone) {
  const head = `<li class="dr-rowhead" aria-hidden="true"><span class="dr-wide"><span>Yr</span><span>Pick</span><span>Player and manager</span><span class="c-ctr">Grade</span><span class="c-num">Value</span><span class="c-num">Slot</span><span class="c-ctr">Vs slot</span></span></li>`;
  return `<section class="panel dr-hall-panel dr-hall-${tone}" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p class="dr-sub">${esc(sub)}</p><ul class="dr-rows dr-k-hall" style="--cols: ${HALL_COLS}">${head}${picks.map((p) => hallRowHtml(p, me)).join("")}</ul></section>`;
}

function hallHtml(stats, me) {
  const hof = DD.hallOfFame(stats);
  if (!hof.pickCount) return `<div class="empty-state">No graded drafts yet.</div>`;
  return `<div class="dr-hall-grid">
    ${hallPanelHtml(`${hof.best.length} best picks ever`, "points above what the slot usually returns", hof.best, me, "best")}
    ${hallPanelHtml(`${hof.costly.length} costliest picks ever`, "points below what the slot usually returns", hof.costly, me, "costly")}
  </div>`;
}

// ---------------------------------------------------------------------------------------------
// The pick card (opens on a tap)
// ---------------------------------------------------------------------------------------------

function pickCardHtml(p, me) {
  const mine = p.userId === me;
  const stat = (label, value, extra) => `<div class="dr-pc-stat${extra ? ` ${extra}` : ""}"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
  const graded = p.vs != null;
  const top = graded
    ? [stat("Value", p.value == null ? "–" : p.value), stat("Typical", p.typical == null ? "–" : p.typical), stat("Vs slot", vsPillHtml(p), "dr-pc-vs")]
    : [stat("Points", fmtPts(p.points)), stat("Per game", p.ppg == null ? "–" : fmtPts(p.ppg)), stat("Games", p.gp == null ? "–" : `${p.gp}${p.gamesPossible != null ? ` of ${p.gamesPossible}` : ""}`)];
  const rows = [];
  if (graded) rows.push(["Points", fmtPts(p.points)]);
  if (graded && p.gp != null) rows.push(["Games played", `${p.gp}${p.gamesPossible != null ? ` of ${p.gamesPossible}` : ""}`]);
  if (p.starts != null) rows.push(["Weeks started", String(p.starts)]);
  if (p.injWeeks != null) rows.push(["Injury weeks", String(p.injWeeks)]);
  if (p.rank && p.rank.text) rows.push(["Position rank", rankHtml(p)]);
  const link = p.playerId ? `<a class="dr-pc-link" href="player.html#${encodeURIComponent(p.playerId)}">Player page &rarr;</a>` : "";
  return `<div class="dr-pc">
    <div class="dr-pc-head">
      ${playerPhotoHtml(p.playerId, p.player, "player-photo-sm")}
      <div class="dr-pc-id">
        <p class="dr-pc-eyebrow">${p.season} · pick ${esc(p.label)}${p.isKeeper ? " · keeper" : ""}</p>
        <h3 class="dr-pc-name">${esc(p.player)}</h3>
        <p class="dr-pc-meta">${posBadgeHtml(p.position)}<span>${esc(p.owner)}</span>${mine ? youTagHtml() : ""}</p>
      </div>
      ${p.grade ? pickGradeHtml(p, "dr-pc-grade") : ""}
    </div>
    <dl class="dr-pc-stats">${top.join("")}</dl>
    ${p.capped ? `<p class="dr-pc-note">${esc(CAP_NOTE)}.</p>` : ""}
    ${rows.length ? `<dl class="dr-pc-rows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
    ${link}
  </div>`;
}

// ---------------------------------------------------------------------------------------------
// The page: heading, year pills, tabs, body
// ---------------------------------------------------------------------------------------------

function eyebrowText(route, draft) {
  if (route.tab === "report" || route.tab === "hall") return "All graded drafts";
  if (!draft) return `${route.season} draft`;
  return draft.graded ? `${route.season} draft` : `${route.season} draft · through week ${draft.weeksPlayed == null ? "?" : draft.weeksPlayed}`;
}

function yearsHtml(seasons, route) {
  return seasons.map((s) => `<a class="dr-year${s === route.season ? " active" : ""}" href="${draftHash(s, route.tab)}"${s === route.season ? ' aria-current="true"' : ""}>${esc(s)}</a>`).join("");
}

function tabsHtml(tabs, route) {
  return tabs.map((t) => `<a class="dr-tab${t.key === route.tab ? " active" : ""}" role="tab" aria-selected="${t.key === route.tab ? "true" : "false"}" href="${draftHash(route.season, t.key)}">${esc(t.label)}</a>`).join("");
}

function bodyHtml(route, draft, state) {
  const me = state.meId;
  if (route.tab === "report") return reportHtml(state.stats, me, state.currentIds, state.ui);
  if (route.tab === "hall") return hallHtml(state.stats, me);
  if (!draft) return `<div class="empty-state">No draft on record for ${esc(route.season)} yet.</div>`;
  if (route.tab === "round") return byRoundHtml(draft, me);
  if (route.tab === "team") return byTeamHtml(draft, me, route.team);
  if (route.tab === "table") return tableTabHtml(draft, me, state.ui);
  // on a phone the viewer's own picks open under their row in "who drafted best", where the mockup had a separate panel
  return draft.graded ? overviewHtml(draft, me, state.phone ? me : null) : liveOverviewHtml(draft, me);
}

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

const isPhone = () => typeof window !== "undefined" && !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);

function draftFor(season) {
  if (!DR.drafts.has(season)) {
    const d = DD.buildDraft(LEAGUE_STATS, season);
    DR.drafts.set(season, d);
    if (d) d.picks.forEach((p) => DR.picks.set(p.key, p));
  }
  return DR.drafts.get(season);
}

function currentRoute() {
  const parsed = parseDraftHash(location.hash, DR.seasons);
  const gradedYears = DD.gradedSeasons(LEAGUE_STATS).length > 0;
  const tabs = tabsFor(gradedYears);
  const tab = parsed.tab && tabs.some((t) => t.key === parsed.tab) ? parsed.tab : DEFAULT_TAB;
  return { season: parsed.season || DR.defaultSeason, tab, team: parsed.team, tabs };
}

function renderHead(route, draft) {
  const allTime = route.tab === "report" || route.tab === "hall";
  document.getElementById("dr-eyebrow").textContent = eyebrowText(route, draft);
  const years = document.getElementById("dr-years");
  years.innerHTML = yearsHtml(DR.seasons, route);
  years.hidden = allTime;
  const tabsEl = document.getElementById("dr-tabs");
  tabsEl.innerHTML = tabsHtml(route.tabs, route);
  tabsEl.setAttribute("data-count", String(route.tabs.length));
}

function renderBody(focusSelector) {
  const route = DR.route;
  const draft = route.tab === "report" || route.tab === "hall" ? null : draftFor(route.season);
  document.getElementById("dr-body").innerHTML = bodyHtml(route, draft, { stats: LEAGUE_STATS, meId: DR.meId, currentIds: DR.currentIds, ui: DR.ui, phone: isPhone() });
  document.body.setAttribute("data-dr-tab", route.tab);
  if (focusSelector) {
    const el = document.querySelector(focusSelector);
    if (el && el.focus) el.focus();
  }
}

function renderPage() {
  DR.route = currentRoute();
  const draft = DR.route.tab === "report" || DR.route.tab === "hall" ? null : draftFor(DR.route.season);
  renderHead(DR.route, draft);
  renderBody();
  if (DR.route.tab === "team" && DR.route.team) scrollToId(`dr-team-${DR.route.team}`);
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el || !el.scrollIntoView) return;
  const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}

// ---- the pick card ----

let DR_SHEET_OPENER = null;

// A pick by its key ("2025-34"). The cards on the all-years tabs name picks from drafts the page has not drawn yet.
function lookupPick(key) {
  if (DR.picks.has(key)) return DR.picks.get(key);
  const season = String(key).split("-")[0];
  if (DR.seasons.includes(season)) draftFor(season);
  return DR.picks.get(key) || null;
}

function openSheet(key, opener) {
  const sheet = document.getElementById("dr-sheet");
  const pick = lookupPick(key);
  if (!sheet || !pick) return;
  document.getElementById("dr-sheet-body").innerHTML = pickCardHtml(pick, DR.meId);
  sheet.hidden = false;
  DR_SHEET_OPENER = opener || null;
  document.body.classList.add("dr-sheet-open");
  const x = sheet.querySelector(".dr-sheet-x");
  if (x && x.focus) x.focus();
}

function closeSheet() {
  const sheet = document.getElementById("dr-sheet");
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  document.body.classList.remove("dr-sheet-open");
  if (DR_SHEET_OPENER && DR_SHEET_OPENER.focus && document.contains(DR_SHEET_OPENER)) DR_SHEET_OPENER.focus();
  DR_SHEET_OPENER = null;
}

function trapFocus(e) {
  const sheet = document.getElementById("dr-sheet");
  if (!sheet || sheet.hidden || e.key !== "Tab") return;
  const items = [...sheet.querySelectorAll("button, a[href]")].filter((el) => !el.disabled);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function wireEvents() {
  document.addEventListener("click", (e) => {
    if (!e.target.closest) return;
    if (e.target.closest("[data-sheet-close]")) {
      closeSheet();
      return;
    }
    const jump = e.target.closest("[data-jump]");
    if (jump) {
      scrollToId(jump.getAttribute("data-jump"));
      return;
    }
    const filter = e.target.closest("[data-filter]");
    if (filter) {
      DR.ui.filter = filter.getAttribute("data-filter");
      renderBody(`[data-filter="${DR.ui.filter}"]`);
      return;
    }
    const sort = e.target.closest("[data-sort]");
    if (sort) {
      const key = sort.getAttribute("data-sort");
      DR.ui.sort = DR.ui.sort.key === key ? { key, dir: -DR.ui.sort.dir } : { key, dir: 1 };
      renderBody(`[data-sort="${key}"]`);
      return;
    }
    const year = e.target.closest("[data-report-year]");
    if (year) {
      DR.ui.reportYear = year.getAttribute("data-report-year");
      renderBody(`[data-report-year="${DR.ui.reportYear}"]`);
      return;
    }
    const pick = e.target.closest("[data-pick]");
    if (pick && !e.target.closest("#dr-sheet")) openSheet(pick.getAttribute("data-pick"), pick.matches("tr") ? pick.querySelector(".dr-name") : pick);
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!t || !t.id) return;
    if (t.id === "dr-past") {
      DR.ui.includePast = !!t.checked;
      renderBody("#dr-past");
    } else if (t.id === "dr-sort") {
      DR.ui.sort = { key: t.value, dir: 1 };
      renderBody("#dr-sort");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSheet();
    else trapFocus(e);
  });
  window.addEventListener("hashchange", () => {
    closeSheet();
    // a filter such as Keepers only means something inside the season it was picked in
    if (DR.route && currentRoute().season !== DR.route.season) DR.ui.filter = "all";
    renderPage();
  });
  // Changing My Team (the nav picker) changes who is YOU.
  document.addEventListener("myteam:change", () => {
    DR.meId = meIdFor(LEAGUE_STATS, typeof MyTeam !== "undefined" ? MyTeam.get() : null);
    closeSheet();
    renderBody();
  });
}

async function renderDraftPage() {
  const errorBox = document.getElementById("draft-error");
  const progressBox = document.getElementById("progress-status");
  try {
    const [seasonChain, playerDirectory, injuries] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(INJURIES_FILE, { players: {} }),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load the league's seasons from Sleeper. Give it a minute and refresh the page.");
    }
    SEASON_CHAIN = seasonChain;
    PLAYER_DIRECTORY = playerDirectory;
    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Draft";

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    // Grades need the league-wide draft-value curve, which only comes from computeStats (the same full-history
    // pass the Teams and Records pages make). The injury weeks are added after, so they never change a grade.
    LEAGUE_STATS = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);
    DeepHistory.attachInjuryWeeks(LEAGUE_STATS, seasonChain, deepSeasons, injuries);

    const withDraft = [...seasonChain].reverse().map((e) => String(e.league.season)).filter((s) => DD.buildDraft(LEAGUE_STATS, s));
    DR = {
      seasons: withDraft,
      defaultSeason: pickDefaultSeason(seasonChain, LEAGUE_STATS),
      drafts: new Map(),
      picks: new Map(),
      meId: meIdFor(LEAGUE_STATS, typeof MyTeam !== "undefined" ? MyTeam.get() : null),
      currentIds: currentIdsFor(LEAGUE_STATS, seasonChain),
      ui: { filter: "all", sort: { key: "pick", dir: 1 }, reportYear: "total", includePast: false },
      route: null,
    };
    if (!DR.seasons.length) DR.seasons = [DR.defaultSeason];

    wireEvents();
    renderPage();
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load draft data — " + err.message;
    errorBox.style.display = "block";
  }
}

document.addEventListener("DOMContentLoaded", renderDraftPage);
