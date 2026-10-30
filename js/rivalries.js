/*
  The Rivalries page: pick two managers (or tap an opponent chip, or a square of the league map) and see
  their whole series, then the league-wide streaks and records. The numbers come from rivalries-data.js;
  this file turns them into markup and wires up the page.

  The page keeps all of its state in RIV (built once by buildRivalryState), and every block of markup is
  a function of that state plus the pair being shown, so a redraw is idempotent: picking a pair, flipping
  the past-managers switch, or changing "My team" just redraws what depends on it.
*/
let RIV = null;

// ---------------------------------------------------------------
// Which rivalry to open on. A link wins; then your own hottest rivalry
// (if you picked a team); then this week's featured matchup (if those two
// have met before); then the league's hottest rivalry. Never a random pair.
// ---------------------------------------------------------------

// How big a rivalry is: lots of meetings, an even series, playoff games, and
// games lately. Returns a number, bigger = hotter. `games` is the pair's game
// log, `newestSeason` the most recent season on record.
function rivalryHeat(games, userIdA, newestSeason) {
  const n = games.length;
  if (!n) return 0;
  let winsA = 0;
  let winsB = 0;
  let playoffs = 0;
  let recent = 0;
  games.forEach((g) => {
    const aIsA = g.aUserId === userIdA;
    const scoreA = aIsA ? g.aScore : g.bScore;
    const scoreB = aIsA ? g.bScore : g.aScore;
    if (scoreA > scoreB) winsA += 1;
    else if (scoreB > scoreA) winsB += 1;
    if (g.isPlayoff) playoffs += 1;
    if (newestSeason != null && Number(g.season) >= Number(newestSeason) - 1) recent += 1;
  });
  const evenness = 1 - Math.abs(winsA - winsB) / n; // 1 = dead even, 0 = one side swept it
  return n * (0.5 + evenness) + 2 * playoffs + recent;
}

// The hottest pairs in the league, hottest first. A tie goes to the pair with more meetings,
// then alphabetical, so the answer never changes between visits.
function hottestRivalries(pairGameLog, managers, limit) {
  const byId = new Map((managers || []).map((m) => [m.userId, m]));
  const nameOf = (m) => (m ? m.username || m.teamName || "" : "");
  let newest = null;
  Object.values(pairGameLog || {}).forEach((games) => games.forEach((g) => (newest = newest == null ? Number(g.season) : Math.max(newest, Number(g.season)))));
  const rows = [];
  Object.entries(pairGameLog || {}).forEach(([key, games]) => {
    if (!games.length) return;
    const [idA, idB] = key.split("|");
    if (!byId.has(idA) || !byId.has(idB)) return;
    let winsA = 0;
    let winsB = 0;
    let ties = 0;
    let playoffs = 0;
    games.forEach((g) => {
      const aIsA = g.aUserId === idA;
      const scoreA = aIsA ? g.aScore : g.bScore;
      const scoreB = aIsA ? g.bScore : g.aScore;
      if (scoreA > scoreB) winsA += 1;
      else if (scoreB > scoreA) winsB += 1;
      else ties += 1;
      if (g.isPlayoff) playoffs += 1;
    });
    rows.push({ a: idA, b: idB, nameA: nameOf(byId.get(idA)), nameB: nameOf(byId.get(idB)), meetings: games.length, winsA, winsB, ties, playoffs, heat: rivalryHeat(games, idA, newest) });
  });
  rows.sort((x, y) => y.heat - x.heat || y.meetings - x.meetings || `${x.nameA}${x.nameB}`.localeCompare(`${y.nameA}${y.nameB}`));
  return limit ? rows.slice(0, limit) : rows;
}

function pickOpeningPair({ hashPair, validIds, me, managers, featured, pairGameLog, hot, fallback }) {
  const [hashA, hashB] = hashPair || [];
  if (validIds.has(hashA) && validIds.has(hashB) && hashA !== hashB) return { a: hashA, b: hashB, reason: "" };

  const met = (a, b) => ((pairGameLog || {})[[a, b].sort().join("|")] || []).length > 0;

  const key = String(me || "").trim().toLowerCase();
  const mine = key ? (managers || []).find((m) => String(m.username || "").trim().toLowerCase() === key) : null;
  if (mine) {
    const row = (hot || []).find((r) => r.a === mine.userId || r.b === mine.userId);
    if (row) return mine.userId === row.a ? { a: row.a, b: row.b, reason: "Your hottest rivalry" } : { a: row.b, b: row.a, reason: "Your hottest rivalry" };
  }
  if (featured && validIds.has(featured.a) && validIds.has(featured.b) && featured.a !== featured.b && met(featured.a, featured.b)) {
    return { a: featured.a, b: featured.b, reason: "This week's featured matchup" };
  }
  if (hot && hot.length) return { a: hot[0].a, b: hot[0].b, reason: "The league's hottest rivalry" };
  return { a: fallback[0], b: fallback[1], reason: "" };
}

// This week's featured matchup as a pair of Sleeper user ids, or null (offseason, no matchups posted).
async function loadFeaturedPair(seasonChain) {
  const current = seasonChain[seasonChain.length - 1];
  if (!current || !current.league || current.league.status !== "in_season") return null;
  const state = await SleeperAPI.getNflState();
  if (!state || String(state.season) !== String(current.league.season)) return null;
  const raw = await SleeperAPI.getMatchups(current.league.league_id, state.week);
  const standings = SleeperAPI.buildStandings(current.rosters, current.users);
  const pair = featuredMatchupPair(raw, standings);
  if (!pair || !pair.sa || !pair.sb || !pair.sa.userId || !pair.sb.userId) return null;
  return { a: pair.sa.userId, b: pair.sb.userId };
}

function parseHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const parts = hash.split("-vs-");
  return [parts[0], parts[1]];
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

/*
  Everything the page draws from. `stats` is DeepHistory.computeStats() (managers + pairGameLog),
  `currentIds` the Set of user ids in this year's league (null = treat everyone as current), `careers`
  { userId: RivalriesData.careerFacts(...) }, `me` the username picked as My Team (or null).
*/
function buildRivalryState({ stats, currentIds, careers, me }) {
  const managers = stats.managers || [];
  const nameOf = (m) => m.username || m.teamName || "";
  const key = String(me || "").trim().toLowerCase();
  const mine = key ? managers.find((m) => String(m.username || "").trim().toLowerCase() === key) : null;
  const meId = mine ? mine.userId : null;
  const opts = { currentIds: currentIds || null };
  return {
    managers,
    byId: new Map(managers.map((m) => [m.userId, m])),
    pairGameLog: stats.pairGameLog || {},
    currentIds: currentIds || null,
    careers: careers || {},
    abbr: RivalriesData.abbreviations(managers.map(nameOf)),
    meId,
    includePast: false,
    a: null,
    b: null,
    streaks: RivalriesData.currentStreaks(stats.pairGameLog || {}, managers, opts),
    records: RivalriesData.pairRecords(stats.pairGameLog || {}, managers, opts),
    summary: RivalriesData.leagueSummary(stats.pairGameLog || {}),
    pastCount: currentIds ? managers.filter((m) => !currentIds.has(m.userId)).length : 0,
  };
}

const rivName = (id) => {
  const m = RIV && RIV.byId.get(id);
  return m ? m.username || m.teamName || "" : "";
};
// "YOU" for the manager picked as My Team, otherwise their four letters.
const rivLabel = (id) => (RIV && id === RIV.meId ? "YOU" : (RIV && RIV.abbr[rivName(id)]) || rivName(id));
const esc = (s) => escapeHtml(String(s == null ? "" : s));

// Everything one pair's blocks are drawn from.
function rivalryModel(a, b) {
  const games = RivalriesData.gamesBetween(RIV.pairGameLog, a, b);
  const summary = RivalriesData.summarize(games);
  const nameA = rivName(a);
  const nameB = rivName(b);
  const labelA = rivLabel(a);
  const labelB = rivLabel(b);
  return {
    a,
    b,
    nameA,
    nameB,
    labelA,
    labelB,
    games,
    summary,
    lines: RivalriesData.seriesLines(summary, nameA, nameB),
    log: RivalriesData.gameLog(games),
    career: RivalriesData.careerRows(RIV.careers[a], RIV.careers[b], labelA, labelB),
  };
}

// ---------------------------------------------------------------
// Markup: the picker
// ---------------------------------------------------------------

function selectFaceHtml(id) {
  const name = rivName(id);
  return `<span class="riv-select-name">${esc(name)}</span>${id === RIV.meId ? ` <span class="you-tag">You</span>` : ""}`;
}

function chipsHtml(a, b) {
  const chips = RivalriesData.opponentChips(RIV.pairGameLog, RIV.managers, a, { currentIds: RIV.currentIds, selectedB: b });
  if (!chips.length) return `<span class="riv-chips-none">${esc(rivName(a))} hasn't played anyone yet.</span>`;
  return chips
    .map((c) => {
      const label = c.id === RIV.meId ? "YOU" : c.abbr;
      const on = c.id === b;
      return `<button type="button" class="riv-chip ${c.tone}${on ? " sel" : ""}" data-riv-a="${esc(a)}" data-riv-b="${esc(c.id)}" data-riv-src="chip" aria-pressed="${on}" title="${esc(rivName(a))} vs ${esc(c.name)}: ${esc(c.record)}"><span class="rc-n">${esc(label)}</span><span class="rc-r">${esc(c.record)}</span></button>`;
    })
    .join("");
}

// ---------------------------------------------------------------
// Markup: the top card (and the same card in the phone's bottom sheet)
// ---------------------------------------------------------------

function stripHtml(summary) {
  const letters = summary.strip.map((s) => s.result).join(" ");
  const squares = summary.strip
    .map((s) => `<i class="riv-sq ${s.result === "W" ? "w" : s.result === "L" ? "l" : "t"}${s.isPlayoff ? " po" : ""}" title="${s.season} wk ${s.week}${s.isPlayoff ? " (playoffs)" : ""}">${s.result}</i>`)
    .join("");
  return `<div class="riv-strip" role="img" aria-label="Every meeting, oldest to newest: ${letters}">${squares}</div>`;
}

function tilesHtml(model) {
  const s = model.summary;
  const po = s.playoffs;
  const poRecord = `${po.w}-${po.l}${po.t ? "-" + po.t : ""}`;
  const poSub = po.n ? `${po.n} game${po.n === 1 ? "" : "s"} since ${s.firstSeason}` : "none yet";
  const margin = s.avgMargin == null ? 0 : s.avgMargin;
  const marginClass = Math.round(margin * 10) > 0 ? " good" : Math.round(margin * 10) < 0 ? " bad" : "";
  const c = s.closest;
  return `
    <div class="riv-tile"><span class="rt-l">Playoffs</span><span class="rt-v">${poRecord}</span><span class="rt-s">${poSub}</span></div>
    <div class="riv-tile"><span class="rt-l">Avg score</span><span class="rt-v good">${RivalriesData.fmt1(s.avgA)}</span><span class="rt-s">${esc(model.nameB)} ${RivalriesData.fmt1(s.avgB)}</span></div>
    <div class="riv-tile"><span class="rt-l">Avg margin</span><span class="rt-v${marginClass}">${RivalriesData.signed1(margin)}</span><span class="rt-s">per game, ${esc(model.labelA)} view</span></div>
    <div class="riv-tile"><span class="rt-l">Closest</span><span class="rt-v">${RivalriesData.fmt1(c.margin)}</span><span class="rt-s">${c.season} wk ${c.week}${c.isPlayoff ? " · playoffs" : ""}</span></div>`;
}

function heroHtml(model, { sheet } = {}) {
  const s = model.summary;
  const idAttr = sheet ? "" : ` id="riv-this"`;
  if (!s.n) {
    return `<section class="panel riv-hero riv-hero-empty"${idAttr}><p class="riv-empty">${esc(model.nameA)} and ${esc(model.nameB)} haven't played each other yet.</p></section>`;
  }
  const range = RivalriesData.rangeText(s.firstSeason, s.lastSeason);
  const first = s.firstSeason;
  const last = s.lastSeason;
  return `
    <section class="panel riv-hero"${idAttr} aria-label="This rivalry">
      <div class="riv-hero-main">
        <p class="riv-eyebrow">This rivalry · ${esc(range)}</p>
        <p class="riv-matchup"><span>${esc(model.labelA)}</span> <span class="riv-vs">vs</span> <span>${esc(model.labelB)}</span></p>
        <div class="riv-record-row">
          <span class="riv-record">${esc(s.record)}</span>
          <p class="riv-lines"><span>${esc(model.lines.lead)}</span><span>${esc(model.lines.detail)}</span></p>
        </div>
      </div>
      <div class="riv-hero-side">
        ${stripHtml(s)}
        <div class="riv-strip-key"><span>${first}</span><span class="riv-strip-note"><span class="riv-key-long">every meeting, oldest to newest · </span>outlined = playoff</span><span>${last}</span></div>
        <div class="riv-tiles">${tilesHtml(model)}</div>
      </div>
    </section>`;
}

// ---------------------------------------------------------------
// Markup: game log and career compare
// ---------------------------------------------------------------

const LOG_PREVIEW_ROWS = 6; // on a phone: this many meetings, then a button for the rest

function logHtml(model) {
  const rows = model.log;
  if (!rows.length) return "";
  const body = rows
    .map((r, i) => {
      const aWon = r.result === "W";
      const bWon = r.result === "L";
      const mgClass = r.diff > 0 ? " good" : r.diff < 0 ? " bad" : "";
      const note = r.notes.join(", ");
      return `
        <tr class="${r.isPlayoff ? "riv-po" : ""}${r.firstOfSeason ? "" : " riv-cont"}${i >= LOG_PREVIEW_ROWS ? " riv-extra" : ""}">
          <td class="riv-yr"><span class="riv-yr-y">${r.season}</span>${r.firstOfSeason ? `<span class="riv-yr-rec">${esc(r.seasonRecord)}</span>` : ""}</td>
          <td class="riv-wk">wk ${r.week}</td>
          <td class="riv-sc"><span class="riv-s${aWon ? " won" : ""}">${RivalriesData.fmt1(r.a)}</span><span class="riv-to"> to </span><span class="riv-s${bWon ? " won" : ""}">${RivalriesData.fmt1(r.b)}</span></td>
          <td class="riv-mg${mgClass}">${RivalriesData.signed1(r.diff)}</td>
          <td class="riv-sr">${esc(r.seriesAfter)}</td>
          <td class="riv-nt${note ? " has-note" : ""}"><span class="riv-nt-text">${esc(note)}</span><span class="riv-nt-series">series ${esc(r.seriesAfter)}</span></td>
        </tr>`;
    })
    .join("");
  const more = rows.length > LOG_PREVIEW_ROWS ? `<button type="button" class="riv-more" data-riv-more data-count="${rows.length}">Show all ${rows.length} meetings ▾</button>` : "";
  return `
    <div class="panel-head"><h2>Game log</h2><span class="riv-note">newest first · gold score won</span></div>
    <table class="riv-log">
      <thead><tr><th class="riv-yr">Season</th><th class="riv-wk">Week</th><th class="riv-sc"><span class="riv-th-a">${esc(model.labelA)}</span> <span>${esc(model.labelB)}</span></th><th class="riv-mg">Margin</th><th class="riv-sr">Series</th><th class="riv-nt">Notes</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${more}`;
}

function careerHtml(model) {
  const c = model.career;
  if (!c.rows.length) return "";
  const rows = c.rows
    .map(
      (r) => `
      <div class="riv-cc-row">
        <div class="cc-a"><span class="cc-pill${r.winner === "a" ? " win-a" : ""}">${esc(r.aText)}</span></div>
        <div class="cc-mid"><span class="cc-lab">${esc(r.label)}</span><span class="cc-gap${r.winner === "a" ? " for-a" : ""}">${esc(r.gap)}</span></div>
        <div class="cc-b"><span class="cc-pill${r.winner === "b" ? " win-b" : ""}">${esc(r.bText)}</span></div>
      </div>`
    )
    .join("");
  return `
    <div class="panel-head"><h2>Career compare</h2><span class="riv-note">${esc(c.summary)}</span></div>
    <div class="riv-cc">${rows}</div>
    <p class="riv-foot">Whole careers, ESPN years included. The game log and the map start in 2020.</p>`;
}

// ---------------------------------------------------------------
// Markup: the league map
// ---------------------------------------------------------------

function mapHtml() {
  const map = RivalriesData.leagueMap(RIV.pairGameLog, RIV.managers, { currentIds: RIV.currentIds, meId: RIV.meId, includePast: RIV.includePast });
  const head = map.cols
    .map((c) => `<th class="rm-col${c.id === RIV.b ? " sel" : ""}${c.isMe ? " me" : ""}${c.past ? " past" : ""}" scope="col"><span class="rm-ab">${esc(c.isMe ? "YOU" : c.abbr)}</span>${c.past ? `<em class="rm-past">past</em>` : ""}</th>`)
    .join("");
  const body = map.rows
    .map((row) => {
      const cells = row.cells
        .map((cell) => {
          if (cell.self) return `<td class="rm-self"></td>`;
          if (!cell.n) return `<td><span class="rm-cell none" aria-label="${esc(row.name)} and ${esc(map.cols.find((c) => c.id === cell.id).name)} have not met">-</span></td>`;
          const colName = map.cols.find((c) => c.id === cell.id).name;
          const sel = row.id === RIV.a && cell.id === RIV.b;
          return `<td><button type="button" class="rm-cell ${cell.band}${cell.small ? " small" : ""}${sel ? " sel" : ""}" data-riv-a="${esc(row.id)}" data-riv-b="${esc(cell.id)}" data-riv-src="map" aria-label="${esc(row.name)} vs ${esc(colName)}: ${esc(cell.record)}, ${esc(cell.pctText)}${cell.small ? ", few meetings" : ""}"><span class="rm-rec">${esc(cell.record)}</span><span class="rm-pct">${esc(cell.pctText)}</span></button></td>`;
        })
        .join("");
      return `<tr class="${row.id === RIV.a ? "rm-on" : ""}"><th class="rm-name" scope="row"><span class="rm-nm">${esc(row.name)}</span>${row.isMe ? ` <span class="you-tag">You</span>` : ""}${row.past ? ` <em class="rm-past">past</em>` : ""}</th>${cells}<td class="rm-all">${esc(row.all.record)}</td></tr>`;
    })
    .join("");
  return `
    <table class="riv-map">
      <thead><tr><th class="rm-corner" scope="col">Row owner vs</th>${head}<th class="rm-allh" scope="col">${esc(map.allLabel)}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

const MAP_LEGEND = [
  ["b5", "70%+"],
  ["b4", "55 to 69"],
  ["b3", "45 to 54"],
  ["b2", "30 to 44"],
  ["b1", "Under 30"],
];

function mapLegendHtml() {
  const bands = MAP_LEGEND.map(([band, text]) => `<span class="rl-key"><i class="rm-sw ${band}"></i>${text}</span>`).join("");
  return `<span class="riv-legend-label">Win rate</span>${bands}<span class="rl-key"><i class="rm-sw few"></i>Fewer than ${RivalriesData.MIN_MAP_MEETINGS} meetings</span>`;
}

// ---------------------------------------------------------------
// Markup: streaks and records
// ---------------------------------------------------------------

// Who goes first when a row opens a rivalry: you, if you are one of the two; otherwise the first name shown.
function openPair(a, b) {
  return b === RIV.meId ? [b, a] : [a, b];
}

function pairAttrs(a, b, src) {
  const [x, y] = openPair(a, b);
  return `data-riv-a="${esc(x)}" data-riv-b="${esc(y)}" data-riv-src="${src}"`;
}

function streaksHtml() {
  if (!RIV.streaks.length) return `<p class="riv-none">No one is on a run of ${RivalriesData.MIN_STREAK} or more right now.</p>`;
  return RIV.streaks
    .map((s) => {
      const mine = s.holderId === RIV.meId || s.otherId === RIV.meId;
      return `<button type="button" class="riv-streak${mine ? " mine" : ""}" ${pairAttrs(s.holderId, s.otherId, "streak")}>
        <span class="rs-top"><span class="rs-n">${s.length}</span><span class="rs-w">straight</span></span>
        <span class="rs-who">${esc(s.holder)} over ${esc(s.other)}</span>
        <span class="rs-since">began ${s.startSeason} wk ${s.startWeek}</span>
      </button>`;
    })
    .join("");
}

function recordRowsHtml(rows, kind) {
  if (!rows.length) return `<p class="riv-none">Nothing yet.</p>`;
  return rows
    .map((r) => {
      const mine = r.aId === RIV.meId || r.bId === RIV.meId;
      const a = rivLabel(r.aId);
      const b = rivLabel(r.bId);
      let text;
      let right;
      if (kind === "lopsided") {
        text = `${esc(a)} over ${esc(b)}`;
        right = `<span class="rr-v">${esc(r.record)}</span><span class="rr-s">${r.pct}%</span>`;
      } else if (kind === "even") {
        text = `${esc(a)} vs ${esc(b)}`;
        right = `<span class="rr-v">${esc(r.record)}</span><span class="rr-s">${r.meetings} games</span>`;
      } else {
        text = `${esc(a)} over ${esc(b)}`;
        right = `<span class="rr-v">${RivalriesData.fmt1(r.margin)}</span><span class="rr-s">${r.season} wk ${r.week}</span>`;
      }
      return `<button type="button" class="riv-rr${mine ? " mine" : ""}" ${pairAttrs(r.aId, r.bId, "record")}><span class="rr-t">${text}</span>${right}</button>`;
    })
    .join("");
}

// ---------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function drawLeagueSections() {
  setHtml("riv-summary", esc(RIV.summary.text));
  setHtml("riv-streaks", streaksHtml());
  setHtml("riv-rec-lopsided", recordRowsHtml(RIV.records.lopsided, "lopsided"));
  setHtml("riv-rec-even", recordRowsHtml(RIV.records.even, "even"));
  setHtml("riv-rec-blowouts", recordRowsHtml(RIV.records.blowouts, "blowouts"));
  setHtml("riv-map-legend", mapLegendHtml());
}

function drawMap() {
  setHtml("riv-map", mapHtml());
  const toggle = document.getElementById("riv-past-wrap");
  if (toggle) toggle.style.display = RIV.pastCount ? "" : "none";
}

function renderRivalry(userIdA, userIdB) {
  RIV.a = userIdA;
  RIV.b = userIdB;
  const selA = document.getElementById("rivalry-select-a");
  const selB = document.getElementById("rivalry-select-b");
  if (selA) selA.value = userIdA;
  if (selB) selB.value = userIdB;
  setHtml("riv-face-a", selectFaceHtml(userIdA));
  setHtml("riv-face-b", selectFaceHtml(userIdB));
  setHtml("riv-chips", chipsHtml(userIdA, userIdB));
  drawMap();

  if (userIdA === userIdB) {
    setHtml("riv-hero", `<section class="panel riv-hero riv-hero-empty" id="riv-this"><p class="riv-empty">Pick two different managers.</p></section>`);
    setHtml("riv-log-panel", "");
    setHtml("riv-compare-panel", "");
    return;
  }
  const model = rivalryModel(userIdA, userIdB);
  setHtml("riv-hero", heroHtml(model));
  setHtml("riv-log-panel", logHtml(model));
  setHtml("riv-compare-panel", careerHtml(model));
  const cols = document.getElementById("riv-cols");
  if (cols) cols.className = `wrap riv-cols${model.log.length && model.career.rows.length ? "" : " riv-cols-one"}`;
  const logPanel = document.getElementById("riv-log-panel");
  if (logPanel) logPanel.style.display = model.log.length ? "" : "none";
  const ccPanel = document.getElementById("riv-compare-panel");
  if (ccPanel) ccPanel.style.display = model.career.rows.length ? "" : "none";
}

// ---------------------------------------------------------------
// The phone's bottom sheet: a tap on the map shows the rivalry here instead of scrolling you off the grid
// ---------------------------------------------------------------

let RIV_SHEET_OPENER = null;

function openSheet(a, b, opener) {
  const sheet = document.getElementById("riv-sheet");
  if (!sheet) return;
  const model = rivalryModel(a, b);
  setHtml("riv-sheet-body", heroHtml(model, { sheet: true }));
  const load = document.getElementById("riv-sheet-load");
  if (load) {
    load.setAttribute("data-riv-a", a);
    load.setAttribute("data-riv-b", b);
  }
  sheet.hidden = false;
  RIV_SHEET_OPENER = opener || null;
  document.body.classList.add("riv-sheet-open");
  if (load && load.focus) load.focus();
}

function closeSheet() {
  const sheet = document.getElementById("riv-sheet");
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  document.body.classList.remove("riv-sheet-open");
  if (RIV_SHEET_OPENER && RIV_SHEET_OPENER.focus) RIV_SHEET_OPENER.focus();
  RIV_SHEET_OPENER = null;
}

// ---------------------------------------------------------------
// Loading and wiring
// ---------------------------------------------------------------

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el || !el.scrollIntoView) return;
  const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}

const isPhone = () => !!(window.matchMedia && window.matchMedia("(max-width: 720px)").matches);

async function renderRivalriesPage() {
  const errorBox = document.getElementById("rivalries-error");
  const progressBox = document.getElementById("progress-status");
  const pickerBox = document.getElementById("rivalry-picker");

  try {
    const [seasonChain, playerDirectory, rawManual] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(MANUAL_HISTORY_FILE, { seasons: [] }),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load the league's seasons from Sleeper. Give it a minute and refresh the page.");
    }
    // An un-replaced template entry (champion still says "REPLACE_WITH...") never shows up on the live site.
    const manual = { ...rawManual, seasons: (rawManual.seasons || []).filter((s) => s.champion && !String(s.champion).startsWith("REPLACE_WITH")) };
    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Rivalries";

    // This week's featured matchup (best combined record on the slate), fetched
    // while the history loads; the page opens on it when those two have met.
    const featuredPromise = loadFeaturedPair(seasonChain).catch(() => null);

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    const stats = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);
    if (stats.managers.length < 2) {
      document.getElementById("riv-hero").innerHTML = `<div class="empty-state">Need at least 2 managers with history to compare.</div>`;
      return;
    }

    // Careers: the same owners the Teams page uses (ESPN years folded in), and the first-round byes
    // from the managers once the ESPN years are added to them.
    const ledger = HistoryData.buildLedger(seasonChain, manual);
    const ownerData = HistoryData.buildOwners(stats.managers, manual, ledger);
    const manualStatsByTeam = ManualHistory.computeManagerStats(manual);
    const careers = {};
    stats.managers.forEach((m) => {
      const name = m.username || m.teamName;
      const mm = m.username ? manualStatsByTeam.get(m.username) : null;
      if (mm) ManualHistory.mergeIntoManager(m, mm.totals);
      const owner = name ? ownerData.owners.find((o) => o.key === HistoryData.keyOf(name)) : null;
      if (owner) careers[m.userId] = RivalriesData.careerFacts(owner, m.byes);
    });
    const currentIds = new Set(ownerData.owners.filter((o) => o.active && o.userId).map((o) => o.userId));

    RIV = buildRivalryState({ stats, currentIds: currentIds.size ? currentIds : null, careers, me: typeof MyTeam !== "undefined" ? MyTeam.get() : null });

    const sortedManagers = [...RIV.managers].sort((a, b) => (a.username || a.teamName).localeCompare(b.username || b.teamName));
    const optionsHtml = () => sortedManagers.map((m) => `<option value="${esc(m.userId)}">${esc(m.username || m.teamName)}${m.userId === RIV.meId ? " (you)" : ""}</option>`).join("");
    const selectA = document.getElementById("rivalry-select-a");
    const selectB = document.getElementById("rivalry-select-b");
    selectA.innerHTML = optionsHtml();
    selectB.innerHTML = optionsHtml();

    const validIds = new Set(sortedManagers.map((m) => m.userId));
    const featured = await featuredPromise;
    const hot = hottestRivalries(RIV.pairGameLog, RIV.managers);
    const opening = pickOpeningPair({
      hashPair: parseHash(),
      validIds,
      me: typeof MyTeam !== "undefined" ? MyTeam.get() : null,
      managers: RIV.managers,
      featured,
      pairGameLog: RIV.pairGameLog,
      hot,
      fallback: [sortedManagers[0].userId, sortedManagers[1] ? sortedManagers[1].userId : sortedManagers[0].userId],
    });

    pickerBox.style.display = "";
    drawLeagueSections();
    renderRivalry(opening.a, opening.b);
    window.location.hash = `${opening.a}-vs-${opening.b}`;

    function show(a, b) {
      window.location.hash = `${a}-vs-${b}`;
      renderRivalry(a, b);
    }
    selectA.addEventListener("change", () => show(selectA.value, selectB.value));
    selectB.addEventListener("change", () => show(selectA.value, selectB.value));
    document.getElementById("rivalry-swap").addEventListener("click", () => show(RIV.b, RIV.a));

    const past = document.getElementById("riv-past");
    if (past) {
      past.addEventListener("change", () => {
        RIV.includePast = !!past.checked;
        drawMap();
      });
    }

    document.addEventListener("click", (e) => {
      if (!e.target.closest) return;
      const jump = e.target.closest("[data-jump]");
      if (jump) {
        e.preventDefault();
        scrollToId(jump.getAttribute("data-jump"));
        return;
      }
      const more = e.target.closest("[data-riv-more]");
      if (more) {
        const panel = document.getElementById("riv-log-panel");
        const open = panel.classList.toggle("is-open");
        more.textContent = open ? "Show fewer ▴" : `Show all ${more.getAttribute("data-count")} meetings ▾`;
        return;
      }
      if (e.target.closest("[data-sheet-close]")) {
        closeSheet();
        return;
      }
      const pick = e.target.closest("[data-riv-a]");
      if (!pick) return;
      const a = pick.getAttribute("data-riv-a");
      const b = pick.getAttribute("data-riv-b");
      const src = pick.getAttribute("data-riv-src") || "";
      if (src === "map" && isPhone()) {
        openSheet(a, b, pick);
        return;
      }
      if (pick.id === "riv-sheet-load") closeSheet();
      show(a, b);
      if (src !== "chip") scrollToId("riv-this");
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSheet();
    });
    // Changing My Team (the nav picker) changes who is YOU.
    document.addEventListener("myteam:change", () => {
      const me = typeof MyTeam !== "undefined" ? MyTeam.get() : null;
      const key = String(me || "").trim().toLowerCase();
      const mine = key ? RIV.managers.find((m) => String(m.username || "").trim().toLowerCase() === key) : null;
      RIV.meId = mine ? mine.userId : null;
      const a = RIV.a;
      const b = RIV.b;
      const opts = { currentIds: RIV.currentIds };
      RIV.streaks = RivalriesData.currentStreaks(RIV.pairGameLog, RIV.managers, opts);
      selectA.innerHTML = optionsHtml();
      selectB.innerHTML = optionsHtml();
      drawLeagueSections();
      renderRivalry(a, b);
    });
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load rivalry data — " + err.message;
    errorBox.style.display = "block";
  }
}

document.addEventListener("DOMContentLoaded", renderRivalriesPage);
