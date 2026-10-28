/*
  History page. The numbers come from history-data.js (the ledger of seasons and
  the owners' career rows); this file turns them into the page and handles the
  few controls: the Career Records sort and filter, and the phone's "show all".

  The top of the page (header tiles, Titles by Owner, Trophy Room, Where Podiums
  Come From) only needs the season chain, so it appears straight away. Everything
  built from weekly results (Every Season, Career Records, Championship Rings,
  Your History) waits for the full history and fills in after.
*/

const HIST = {
  ledger: [],
  ownerData: null, // { owners, firstYear, latestYear, maxTeams } once the full history is in
  rings: null, // { ranked, columns, letters } once the full history is in
};

// The Career Records controls. Sort and filter are remembered while the page is open.
const CAREER_UI = { sort: "titles", show: "all", expanded: false };
const RINGS_UI = { expanded: false };

// Phone: how many Career Records / Championship Rings rows show before "show all".
const CAREER_PHONE_ROWS = 10;
const RINGS_PHONE_ROWS = 5;
const RINGS_SHOWN = 10;

const CAREER_SORTS = [
  { key: "titles", label: "Titles" },
  { key: "podiums", label: "Podiums" },
  { key: "playoff", label: "Playoff %" },
  { key: "winpct", label: "Reg. season win %", short: "Win %" },
];

// Titles by Owner: the leader is yellow, everyone after that a step lighter in blue.
const TITLE_SEGMENT_COLORS = ["#F0A340", "#4EA8DD", "#7DBFE6", "#A8D3EE", "#CBE4F4"];

function histIsMine(key) {
  return typeof MyTeam !== "undefined" && !!MyTeam.get() && MyTeam.isMine(key);
}

function histMineName() {
  return typeof MyTeam !== "undefined" ? MyTeam.get() : null;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || one + "s"}`;
}

// ---- header tiles and Your History --------------------------------------

function heroTilesHtml(h) {
  const most = h.mostTitles ? (h.mostTitlesNames.length > 2 ? `${h.mostTitlesNames.length} owners tied` : h.mostTitlesNames.join(", ")) : "";
  const tiles = [
    { label: "Seasons", value: h.seasonsComplete, sub: h.liveYear ? `complete, plus ${h.liveYear} live` : "complete" },
    { label: "Champions", value: h.champions, sub: "different owners" },
    { label: "Most titles", value: h.mostTitles || "—", sub: most, gold: true },
  ];
  return tiles
    .map(
      (t) => `
      <div class="hist-tile${t.gold ? " gold" : ""}">
        <span class="label">${escapeHtml(t.label)}</span>
        <span class="value">${escapeHtml(String(t.value))}</span>
        <span class="sub">${escapeHtml(t.sub)}</span>
      </div>`
    )
    .join("");
}

// The card beside the header. `info` is HistoryData.yourHistory(); null means no
// team is picked (or the picked one has no seasons on record).
function yourHistoryHtml(info, pickedName, loading) {
  if (!pickedName) {
    return `
      <div class="panel-head"><h2>Your History</h2></div>
      <button type="button" class="you-pick" data-myteam-open>Pick your team</button>`;
  }
  if (loading) {
    return `
      <div class="panel-head"><h2>Your History</h2><span class="you-tag">YOU · ${escapeHtml(pickedName)}</span></div>
      <div class="loading">Loading…</div>`;
  }
  if (!info) {
    return `
      <div class="panel-head"><h2>Your History</h2><span class="you-tag">YOU · ${escapeHtml(pickedName)}</span></div>
      <p class="you-empty">No seasons on record yet.</p>`;
  }

  const rows = [];
  rows.push({
    label: "Titles",
    sub: info.titleYears.length ? info.titleYears.join(", ") : "None yet",
    value: String(info.titles),
  });
  rows.push({ label: "Podiums", sub: info.podiumText || "None yet", value: String(info.podiums) });
  if (info.avgFinish != null) {
    const rank = info.finishRank === 1 ? "Best in the league" : `${HistoryData.ord(info.finishRank)} best in the league`;
    rows.push({ label: "Avg finish", sub: `${rank}, ${plural(info.completedYears, "season")}`, value: info.avgFinish.toFixed(1) });
  }
  if (info.poGames > 0) {
    let sub;
    if (info.playoffRank === 1) sub = "Most playoff wins in the league";
    else if (info.playoffRank === 2 && info.aheadName) sub = `Behind only ${info.aheadName} (${info.aheadRecord})`;
    else sub = `${HistoryData.ord(info.playoffRank)} in playoff wins`;
    rows.push({ label: "Playoff games", sub, value: info.poRecord });
  }
  if (info.live) {
    const l = info.live;
    let sub = "The season hasn't started";
    let cls = "";
    if (l.games > 0) {
      sub = `Ranked ${HistoryData.ord(l.finish)} after Week ${l.games}, ${l.inside ? "inside" : "outside"} the top ${l.playoffTeams}`;
      cls = l.inside ? "up" : "down";
    }
    rows.push({ label: `${l.year} so far`, sub, value: l.games > 0 ? HistoryData.ord(l.finish).toUpperCase() : "—", cls });
  }

  return `
    <div class="panel-head"><h2>Your History</h2><span class="you-tag">YOU · ${escapeHtml(info.name)}</span></div>
    <dl class="you-list">
      ${rows
        .map(
          (r) => `
        <div class="you-row">
          <dt><span>${escapeHtml(r.label)}</span><small>${escapeHtml(r.sub)}</small></dt>
          <dd class="${r.cls || ""}">${escapeHtml(r.value)}</dd>
        </div>`
        )
        .join("")}
    </dl>`;
}

// ---- Titles by Owner -----------------------------------------------------

function titlesBarHtml(t) {
  if (!t.owners.length) return `<div class="empty-state">No champions crowned yet.</div>`;
  const colorFor = (i) => TITLE_SEGMENT_COLORS[Math.min(i, TITLE_SEGMENT_COLORS.length - 1)];
  const max = t.owners[0].titles;
  const label = (o) => `${o.name}${o.titles > 1 ? ` · ${o.titles}` : ""}`;
  const bar = t.owners
    .map(
      (o, i) =>
        `<span class="tb-seg" style="flex-grow:${o.titles};background:${colorFor(i)}" title="${escapeHtml(`${o.name}: ${plural(o.titles, "title")} (${o.years.join(", ")})`)}"><span class="tb-name">${escapeHtml(label(o))}</span></span>`
    )
    .join("");
  const rows = t.owners
    .map(
      (o, i) => `
      <li class="tb-row">
        <span class="tb-row-name">${escapeHtml(o.name)}</span>
        <span class="tb-row-track"><i style="width:${(o.titles / max) * 100}%;background:${colorFor(i)}"></i></span>
        <b>${o.titles}</b>
      </li>`
    )
    .join("");
  return `<div class="tb-bar" role="img" aria-label="${escapeHtml(t.owners.map((o) => `${o.name} ${o.titles}`).join(", "))}">${bar}</div><ul class="tb-rows">${rows}</ul>`;
}

function titlesMetaText(t) {
  return `${plural(t.seasonsComplete, "season")} complete · ${plural(t.champions, "different champion")}`;
}

// ---- Trophy Room ----------------------------------------------------------

function trophyCardHtml(card) {
  if (card.kind === "live") {
    return `
      <a class="trophy-card live" href="season.html#${card.year}">
        <span class="tc-year">${card.year}</span>
        <span class="tc-pill">LIVE</span>
        <span class="tc-badge">?</span>
        <span class="tc-name">In progress</span>
        <span class="tc-stats">
          <span class="tc-stat"><span>Record</span><b>TBD</b></span>
          <span class="tc-stat"><span>Seed</span><b>TBD</b></span>
          <span class="tc-stat"><span>Beat</span><b>TBD</b></span>
        </span>
      </a>`;
  }
  const pill = card.repeat ? `REPEAT · TITLE ${card.titleNumber}` : `TITLE ${card.titleNumber}`;
  return `
      <a class="trophy-card${card.repeat ? " repeat" : ""}" href="season.html#${card.year}" data-username="${escapeHtml(card.name)}">
        <span class="tc-year">${card.year}</span>
        <span class="tc-pill">${escapeHtml(pill)}</span>
        <span class="tc-badge">${escapeHtml(card.name.trim().charAt(0).toUpperCase() || "?")}</span>
        <span class="tc-name">${escapeHtml(card.name)}</span>
        <span class="tc-team">${card.teamName ? escapeHtml(card.teamName) : "&nbsp;"}</span>
        <span class="tc-stats">
          <span class="tc-stat"><span>Record</span><b>${escapeHtml(card.record)}</b></span>
          <span class="tc-stat"><span>Seed</span><b>#${card.seed}</b></span>
          <span class="tc-stat"><span>Beat</span><b data-no-mine>${card.beat ? escapeHtml(card.beat) : "—"}</b></span>
        </span>
      </a>`;
}

function trophyRoomHtml(cards) {
  if (!cards.length) return `<div class="empty-state">No champions crowned yet.</div>`;
  return cards.map((c) => trophyCardHtml(c)).join("");
}

// ---- season squares (Career Records strip, Every Season grid) --------------

const STATUS_LABELS = {
  champion: "Champion",
  runnerUp: "Runner-up",
  third: "Third place",
  playoffs: "Made the playoffs",
  missed: "Missed the playoffs",
};
const MEDAL_NUMBER = { champion: "1", runnerUp: "2", third: "3" };
const MEDAL_LABEL = { champion: "TITLE", runnerUp: "2ND", third: "3RD" };

// The hover text for one season square.
function seasonCellTitle(cell) {
  if (cell.status === "live") return `${cell.year}: not started`;
  if (cell.status === "live-in" || cell.status === "live-out") {
    return `${cell.year} so far: ${cell.status === "live-in" ? "in" : "out of"} the playoff spots (currently ${HistoryData.ord(cell.finish)})`;
  }
  return `${cell.year}: ${STATUS_LABELS[cell.status] || ""} (finished ${HistoryData.ord(cell.finish)} in the regular season)`;
}

function stripHtml(owner, years) {
  const squares = years
    .map((y) => {
      const cell = owner.cells.find((c) => c.year === y);
      if (!cell) return `<i class="sq sq-empty" title="${y}: not in the league"></i>`;
      const n = MEDAL_NUMBER[cell.status] || "";
      return `<i class="sq st-${cell.status}" title="${escapeHtml(seasonCellTitle(cell))}">${n}</i>`;
    })
    .join("");
  return `<span class="cr-strip" role="img" aria-label="${escapeHtml(`${owner.name}'s seasons, ${years[0]} to ${years[years.length - 1]}`)}">${squares}</span>`;
}

function avgFinishTrackHtml(avg, maxTeams) {
  if (avg == null) return `<span class="sg-avg-in"><span class="sg-avg-text">–</span></span>`;
  const pos = maxTeams > 1 ? ((avg - 1) / (maxTeams - 1)) * 100 : 0;
  return `<span class="sg-avg-in"><span class="sg-avg-text">${avg.toFixed(1)}</span><span class="sg-track" aria-hidden="true"><i style="left:${Math.min(100, Math.max(0, pos)).toFixed(1)}%"></i></span></span>`;
}

function seasonLegendHtml(latestYear, live, withTick) {
  const sw = (cls, text) => `<span class="lg"><i class="sq mini ${cls}"></i>${escapeHtml(text)}</span>`;
  return `
    <div class="hist-legend${withTick ? " cr-legend" : ""}">
      ${sw("st-champion", "Champion")}${sw("st-runnerUp", "Runner-up")}${sw("st-third", "Third")}${sw("st-playoffs", "Made playoffs")}${sw("st-missed", "Missed")}
      ${live ? `${sw("st-live-in", `${latestYear}: in`)}${sw("st-live-out", `${latestYear}: out`)}` : ""}
      ${withTick ? `<span class="lg"><i class="tick-key"></i>.500</span>` : ""}
    </div>`;
}

// ---- Every Season at a Glance ----------------------------------------------

function seasonGridHtml(data, liveSeason) {
  const { owners, firstYear, latestYear, maxTeams } = data;
  if (!owners.length || firstYear == null) return `<div class="empty-state">No seasons yet.</div>`;
  const years = [];
  for (let y = firstYear; y <= latestYear; y++) years.push(y);
  const liveYear = liveSeason ? latestYear : null;

  const head = `
    <tr>
      <th class="sg-owner" scope="col">Owner</th>
      ${years.map((y) => `<th scope="col" class="sg-year${y === liveYear ? " live" : ""}">${y}</th>`).join("")}
      <th scope="col" class="sg-avg">Avg finish</th>
    </tr>`;

  const body = owners
    .map((o) => {
      const cells = years
        .map((y) => {
          const cell = o.cells.find((c) => c.year === y);
          if (!cell) return `<td class="sg-cell"><i class="sq sq-empty" title="${y}: not in the league"></i></td>`;
          const label = MEDAL_LABEL[cell.status];
          return `<td class="sg-cell"><span class="sq st-${cell.status}" title="${escapeHtml(seasonCellTitle(cell))}"><b>${cell.finish}</b>${label ? `<small>${label}</small>` : ""}</span></td>`;
        })
        .join("");
      return `
      <tr class="sg-row${o.former ? " is-former" : ""}" data-username="${escapeHtml(o.name)}">
        <th scope="row" class="sg-owner"><a class="subtle-link sg-name" ${o.userId ? `href="teams.html#${encodeURIComponent(o.userId)}"` : ""}>${escapeHtml(o.name)}</a></th>
        ${cells}
        <td class="sg-avg">${avgFinishTrackHtml(o.avgFinish, maxTeams)}</td>
      </tr>`;
    })
    .join("");

  return `
    <div class="sg-wrap stay-scrollable">
      <table class="sg-table"><thead>${head}</thead><tbody>${body}</tbody></table>
    </div>
    ${seasonLegendHtml(latestYear, !!liveYear, false)}`;
}

// ---- Career Records ---------------------------------------------------------

function barHtml(pctValue, kind, tick) {
  const w = Math.max(0, Math.min(100, pctValue || 0));
  return `<i class="bar${tick ? " has-tick" : ""}"><i class="fill ${kind}" style="width:${w.toFixed(1)}%"></i></i>`;
}

function medalHtml(n, kind, label) {
  return `<b class="medal ${kind}${n ? "" : " none"}" title="${escapeHtml(label)}">${n || "–"}</b>`;
}

function careerRowHtml(o, i, years, latestYear) {
  const tags = [];
  if (o.former) tags.push(`<span class="tag">FORMER</span>`);
  if (o.isNew) tags.push(`<span class="tag">NEW ${latestYear}</span>`);
  const tripsText = `${o.trips} of ${o.completedYears}`;
  const tripsPct = o.completedYears > 0 ? `${Math.round(o.tripPct)}%` : "–";
  const poText = o.poGames > 0 ? HistoryData.recordOf(o.poW, o.poL, o.poT) : "–";
  const regText = o.regGames > 0 ? HistoryData.recordOf(o.regW, o.regL, o.regT) : "–";
  const regPct = o.regGames > 0 ? `${o.regPct.toFixed(1)}%` : "–";
  const poKind = o.poPct >= 50 ? "up" : "down";
  const regKind = o.regPct >= 50 ? "up" : "down";
  return `
      <li class="cr-row${i >= CAREER_PHONE_ROWS ? " cr-extra" : ""}${o.former ? " is-former" : ""}" data-username="${escapeHtml(o.name)}">
        <span class="cr-rank">${i + 1}</span>
        <span class="cr-owner"><a class="subtle-link cr-name" ${o.userId ? `href="teams.html#${encodeURIComponent(o.userId)}"` : ""}>${escapeHtml(o.name)}</a>${tags.join("")}</span>
        <span class="cr-medals">${medalHtml(o.titles, "gold", "Titles")}${medalHtml(o.seconds, "silver", "Runner-up finishes")}${medalHtml(o.thirds, "bronze", "Third places")}</span>
        <span class="cr-strip-cell">${stripHtml(o, years)}</span>
        <span class="cr-trips"><em>${tripsText}</em>${barHtml(o.completedYears > 0 ? o.tripPct : 0, "up", false)}<b>${tripsPct}</b></span>
        <span class="cr-po"><em>${poText}</em>${barHtml(o.poGames > 0 ? o.poPct : 0, poKind, true)}</span>
        <span class="cr-reg"><em>${regText}</em>${barHtml(o.regGames > 0 ? o.regPct : 0, regKind, true)}<b>${regPct}</b></span>
        <span class="cr-line2">${o.trips}/${o.completedYears} playoffs · ${poText} · ${regText}</span>
      </li>`;
}

function careerControlsHtml(ui, owners, latestYear) {
  const active = owners.filter((o) => o.active).length;
  const sortPills = CAREER_SORTS.map(
    (s) =>
      `<button type="button" class="pill${ui.sort === s.key ? " on" : ""}" data-sort="${s.key}" aria-pressed="${ui.sort === s.key}">${
        s.short ? `<span class="pill-long">${escapeHtml(s.label)}</span><span class="pill-short">${escapeHtml(s.short)}</span>` : escapeHtml(s.label)
      }</button>`
  ).join("");
  const showPills = [
    { key: "all", label: `All ${owners.length}` },
    { key: "active", label: `Active in ${latestYear} (${active})` },
  ]
    .map((s) => `<button type="button" class="pill${ui.show === s.key ? " on" : ""}" data-show="${s.key}" aria-pressed="${ui.show === s.key}">${escapeHtml(s.label)}</button>`)
    .join("");
  return `
    <div class="cr-ctl"><span class="cr-ctl-label">Sort</span>${sortPills}</div>
    <div class="cr-ctl"><span class="cr-ctl-label">Show</span>${showPills}</div>`;
}

function careerListHtml(data, ui) {
  const { owners, firstYear, latestYear } = data;
  const shown = HistoryData.sortOwners(HistoryData.filterOwners(owners, ui.show), ui.sort);
  if (!shown.length || firstYear == null) return `<div class="empty-state">No completed seasons yet.</div>`;
  const years = [];
  for (let y = firstYear; y <= latestYear; y++) years.push(y);
  const rows = shown.map((o, i) => careerRowHtml(o, i, years, latestYear)).join("");
  const more = shown.length > CAREER_PHONE_ROWS ? `<button type="button" class="cr-more" data-more="career">${ui.expanded ? "Show fewer owners" : `Show all ${shown.length} owners`}</button>` : "";
  const live = data.owners.some((o) => o.cells.some((c) => !c.complete));
  return `
    <div class="cr-table">
      <div class="cr-head" aria-hidden="true">
        <span class="cr-rank">#</span>
        <span class="cr-owner">Owner</span>
        <span class="cr-medals">Titles · 2nd · 3rd</span>
        <span class="cr-strip-cell">Seasons ${firstYear} → ${latestYear}</span>
        <span class="cr-trips">Playoff trips</span>
        <span class="cr-po">Playoff games</span>
        <span class="cr-reg">Regular season</span>
      </div>
      <ol class="cr-rows${ui.expanded ? " expanded" : ""}">${rows}</ol>
    </div>
    ${more}
    ${seasonLegendHtml(latestYear, live, true)}`;
}

// ---- Championship Rings -----------------------------------------------------

function ringIconsHtml(n) {
  const icon = `<svg class="ring-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="3.6"/></svg>`;
  const shown = Math.min(n, 6);
  return `<span class="rg-rings" role="img" aria-label="${plural(n, "ring")}">${icon.repeat(shown)}${n > shown ? `<b>×${n}</b>` : ""}</span>`;
}

function ringsListHtml(rings) {
  const { ranked, columns, letters } = rings;
  if (!ranked.length) return `<div class="empty-state">No champions crowned yet.</div>`;
  const maxStarts = Math.max(1, ...ranked.map((p) => p.totalGamesStarted));

  const rows = ranked
    .map((p, i) => {
      const squares = columns
        .map((col) => {
          const ring = p.rings.find((r) => r.season === col.year);
          if (!ring) return `<i class="sq sq-empty" title="${col.year}: not on the champion's roster"></i>`;
          const mine = histIsMine(col.ownerKey);
          return `<i class="sq st-champion${mine ? " is-mine" : ""}" title="${escapeHtml(`${col.year}: won with ${col.ownerName}`)}">${escapeHtml(letters.get(col.ownerKey) || "")}</i>`;
        })
        .join("");
      return `
      <li class="rg-row${i >= RINGS_PHONE_ROWS ? " rg-extra" : ""}">
        <span class="rg-rank">${i + 1}</span>
        <span class="rg-player">${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.name, "player-photo-xs"))}<span class="rg-name">${playerLinkHtml(p.playerId, escapeHtml(p.name))}</span></span>
        ${ringIconsHtml(p.rings.length)}
        <span class="rg-squares">${squares}</span>
        <span class="rg-gs">${barHtml((p.totalGamesStarted / maxStarts) * 100, "dim", false)}<b>${p.totalGamesStarted}</b></span>
      </li>`;
    })
    .join("");

  const seen = new Set();
  const legendOwners = columns.filter((c) => (seen.has(c.ownerKey) ? false : (seen.add(c.ownerKey), true)));
  const legend = legendOwners
    .map((c) => `<span class="lg"><i class="sq mini st-champion${histIsMine(c.ownerKey) ? " is-mine" : ""}">${escapeHtml(letters.get(c.ownerKey) || "")}</i>${escapeHtml(c.ownerName)}${histIsMine(c.ownerKey) ? " (you)" : ""}</span>`)
    .join("");
  const more = ranked.length > RINGS_PHONE_ROWS ? `<button type="button" class="cr-more" data-more="rings">${RINGS_UI.expanded ? "Show fewer players" : `Show all ${ranked.length} players`}</button>` : "";

  return `
    <div class="rg-table">
      <div class="rg-head" aria-hidden="true">
        <span class="rg-rank">#</span>
        <span class="rg-player">Player</span>
        <span class="rg-rings">Rings</span>
        <span class="rg-squares">${columns.map((c) => `<span>${c.year}</span>`).join("")}</span>
        <span class="rg-gs">Games started</span>
      </div>
      <ol class="rg-rows${RINGS_UI.expanded ? " expanded" : ""}">${rows}</ol>
    </div>
    ${more}
    <div class="hist-legend">${legend}<span class="lg"><i class="sq mini sq-empty"></i>Not on a champion's roster</span></div>`;
}

function ringsMetaText(columns) {
  if (!columns.length) return "";
  return `Sleeper era · ${columns[0].year} → ${columns[columns.length - 1].year}`;
}

// ---- Where Podiums Come From ------------------------------------------------

function podiumChartHtml(pod) {
  if (!pod.seasons) return `<div class="empty-state">No champions crowned yet.</div>`;
  const rows = pod.rows
    .map((r) => {
      const seg = (cls, n, label) => (n ? `<i class="pc-seg ${cls}" style="flex-grow:${n}" title="${escapeHtml(`${label}: ${n}`)}">${n}</i>` : "");
      return `
      <div class="pc-row">
        <span class="pc-label">Seed ${r.seed}</span>
        <span class="pc-track"><span class="pc-bar" style="width:${((r.total / pod.seasons) * 100).toFixed(2)}%">${seg("title", r.title, "Titles")}${seg("second", r.second, "Runner-ups")}${seg("third", r.third, "Thirds")}</span></span>
        <b class="pc-total">${r.total}</b>
      </div>`;
    })
    .join("");
  return `
    <div class="pc-rows">${rows}</div>
    <div class="hist-legend">
      <span class="lg"><i class="sq mini st-champion"></i>Title</span>
      <span class="lg"><i class="sq mini st-runnerUp"></i>Runner-up</span>
      <span class="lg"><i class="sq mini st-third"></i>Third</span>
      <span class="lg pc-of">Podiums out of ${pod.seasons}</span>
    </div>`;
}

// ---- drawing the page -------------------------------------------------------

function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function renderYou() {
  const picked = histMineName();
  const loading = !!picked && !HIST.ownerData;
  const info = picked && HIST.ownerData ? HistoryData.yourHistory(HIST.ownerData.owners, HIST.ledger, picked) : null;
  setHtml("hist-you", yourHistoryHtml(info, picked, loading));
}

function renderTop() {
  const ledger = HIST.ledger;
  const titles = HistoryData.titlesByOwner(ledger);

  setHtml("hist-tiles", heroTilesHtml(HistoryData.heroStats(ledger)));
  setHtml("titles-bar", titlesBarHtml(titles));
  const meta = document.getElementById("titles-meta");
  if (meta) meta.textContent = titles.owners.length ? titlesMetaText(titles) : "";
  setHtml("trophy-room", trophyRoomHtml(HistoryData.trophyCards(ledger)));
  setHtml("podium-chart", podiumChartHtml(HistoryData.podiumsBySeed(ledger)));
  renderYou();
}

function renderCareer() {
  if (!HIST.ownerData) return;
  setHtml("career-controls", careerControlsHtml(CAREER_UI, HIST.ownerData.owners, HIST.ownerData.latestYear));
  setHtml("career-list", careerListHtml(HIST.ownerData, CAREER_UI));
}

function renderSeasonGrid() {
  if (!HIST.ownerData) return;
  const live = HIST.ledger.length && !HIST.ledger[HIST.ledger.length - 1].complete;
  // The grid keeps the default (Titles) order whatever the Career Records are sorted by.
  const data = { ...HIST.ownerData, owners: HistoryData.sortOwners(HIST.ownerData.owners, "titles") };
  setHtml("season-grid", seasonGridHtml(data, live));
}

function renderRings() {
  if (!HIST.rings) return;
  setHtml("rings-list", ringsListHtml(HIST.rings));
  const meta = document.getElementById("rings-meta");
  if (meta) meta.textContent = ringsMetaText(HIST.rings.columns);
}

// The Career Records controls and the "show all" buttons. Wired once; the
// buttons themselves are redrawn, so this listens on the stable containers.
function initHistoryControls() {
  const controls = document.getElementById("career-controls");
  if (controls) {
    controls.onclick = (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!btn) return;
      if (btn.getAttribute("data-sort")) CAREER_UI.sort = btn.getAttribute("data-sort");
      else if (btn.getAttribute("data-show")) CAREER_UI.show = btn.getAttribute("data-show");
      else return;
      renderCareer();
    };
  }
  const career = document.getElementById("career-list");
  if (career) {
    career.onclick = (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-more]") : null;
      if (!btn) return;
      CAREER_UI.expanded = !CAREER_UI.expanded;
      renderCareer();
    };
  }
  const rings = document.getElementById("rings-list");
  if (rings) {
    rings.onclick = (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("[data-more]") : null;
      if (!btn) return;
      RINGS_UI.expanded = !RINGS_UI.expanded;
      renderRings();
    };
  }
  document.addEventListener("myteam:change", () => {
    renderYou();
    renderRings();
  });
}

function playerName(playerId, playerDirectory) {
  const p = playerDirectory && playerDirectory[playerId];
  if (!p) return "Unknown Player";
  return p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || "Unknown Player";
}

// Everything that needs the weekly results: one pass over the full history feeds
// Every Season, Career Records, Championship Rings and Your History.
async function renderFromFullHistory(seasons, playerDirectory, manual) {
  let deepSeasons;
  try {
    deepSeasons = await DeepHistory.buildAll(seasons, () => {});
  } catch (err) {
    console.error(err);
    ["season-grid", "career-list", "rings-list"].forEach((id) => setHtml(id, `<div class="empty-state">Couldn't load this section.</div>`));
    return;
  }

  try {
    const stats = DeepHistory.computeStats(seasons, deepSeasons, playerDirectory);
    HIST.ownerData = HistoryData.buildOwners(stats.managers, manual, HIST.ledger);
    renderSeasonGrid();
    renderCareer();
    renderYou();
  } catch (err) {
    console.error(err);
    ["season-grid", "career-list"].forEach((id) => setHtml(id, `<div class="empty-state">Couldn't load career records.</div>`));
  }

  try {
    const ranked = HistoryData.computeRings(seasons, deepSeasons, playerDirectory)
      .slice(0, RINGS_SHOWN)
      .map((p) => ({ ...p, name: playerName(p.playerId, playerDirectory) }));
    const columns = HistoryData.ringColumns(HIST.ledger);
    const letters = HistoryData.ownerLetters(columns.map((c) => ({ key: c.ownerKey, name: c.ownerName })));
    HIST.rings = { ranked, columns, letters };
    renderRings();
  } catch (err) {
    console.error(err);
    setHtml("rings-list", `<div class="empty-state">Couldn't load championship rings.</div>`);
  }
}

async function renderHistory() {
  const errorBox = document.getElementById("hist-error");

  try {
    const [seasons, playerDirectory, rawManual] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID), // oldest -> newest
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(MANUAL_HISTORY_FILE, { seasons: [] }),
    ]);
    // Guard against an un-replaced template entry (champion still says
    // "REPLACE_WITH...") ever showing up on the live site.
    const manual = { ...rawManual, seasons: (rawManual.seasons || []).filter((s) => s.champion && !String(s.champion).startsWith("REPLACE_WITH")) };

    if (seasons.length === 0) {
      throw new Error("Couldn't load the league's seasons from Sleeper. Give it a minute and refresh the page.");
    }

    const latest = seasons[seasons.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — History";
    document.getElementById("sb-eyebrow").textContent = "ALL-TIME";
    document.getElementById("sb-title").textContent = "Trophy Case";

    HIST.ledger = HistoryData.buildLedger(seasons, manual);

    const totalSeasons = HIST.ledger.length;
    document.getElementById("sb-sub").textContent = `${totalSeasons} season${totalSeasons === 1 ? "" : "s"} on record`;

    initHistoryControls();
    renderTop();

    // Needs the weekly results, so it lands after the fast sections are on screen.
    renderFromFullHistory(seasons, playerDirectory, manual);
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't load league history — " + err.message;
    errorBox.style.display = "block";
    const errorWrap = document.getElementById("hist-error-wrap");
    if (errorWrap) errorWrap.style.display = "block";
  }
}

document.addEventListener("DOMContentLoaded", renderHistory);
