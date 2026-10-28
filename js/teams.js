/*
  Teams page. The numbers come from teams-data.js (and history-data.js for the
  finishes, titles and playoff trips, so this page and the History page can
  never disagree); this file turns them into markup and wires the few controls.

  Two views share one URL: no hash is the index of every manager (cards or a
  table), and #<Sleeper user id> is that manager's profile. Highlighting the
  picked team is left to my-team.js: every card, pill, row and hero here carries
  data-username and is listed in its ROW_SELECTOR, so there is nothing to redraw
  when the pick changes.
*/

const TEAMS = {
  stats: null, // DeepHistory.computeStats(): the managers, with the ESPN seasons folded in
  ledger: [],
  owners: [], // HistoryData owners (finishes, titles, playoff trips), built before the ESPN merge
  cards: [],
  averages: {}, // the league's points per game for every year
  awards: null,
  trackedYears: null,
  playerDirectory: null,
  nameIndex: null,
  firstYear: null,
  latestYear: null,
  teamNames: {},
};

// What the controls are set to. Sort and view are remembered while the page is open;
// the draft year starts over for every profile.
const TEAMS_UI = { sort: "titles", view: "cards", profileId: null, draftYear: null, picksExpanded: false };

const TEAMS_PICKS_SHOWN = 10;
const TEAMS_SORTS = [
  { key: "titles", label: "Titles" },
  { key: "win", label: "Win %" },
  { key: "rank", label: "" }, // "<year> rank", filled in from the latest season
  { key: "az", label: "A to Z" },
];

const TEAMS_JUMPS = [
  { id: "seasons", label: "Seasons" },
  { id: "h2h", label: "Head-to-head" },
  { id: "draft", label: "Drafts" },
  { id: "lineup", label: "Lineup" },
  { id: "awards", label: "Awards" },
];

const TEAMS_LEGEND = [
  ["st-champion", "Title"],
  ["st-runnerUp", "2nd"],
  ["st-third", "Third"],
  ["st-playoffs", "Made playoffs"],
  ["st-missed", "Missed"],
];

function tmNameIndex() {
  if (!TEAMS.nameIndex) TEAMS.nameIndex = buildPlayerNameIndex(TEAMS.playerDirectory);
  return TEAMS.nameIndex;
}

const tmPlural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
const tmOrd = (n) => HistoryData.ord(n);
const tmPct = (n) => (n == null ? "–" : `${n.toFixed(1)}%`);
const tmSigned = (n) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)}%`;

function tmRingIcon() {
  return `<svg class="ring-icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="3.6"/></svg>`;
}

// A row of title rings; past six it says ×N instead of drawing them all.
function tmRingsHtml(n) {
  if (!n) return "";
  const shown = Math.min(n, 6);
  return `<span class="tm-rings-row" role="img" aria-label="${tmPlural(n, "title")}">${tmRingIcon().repeat(shown)}${n > shown ? `<b>×${n}</b>` : ""}</span>`;
}

// The thin bar that records and win rates share, with the .500 tick unless asked not to.
function tmWinBar(pct, tick) {
  const cls = tick === false ? "bar" : "bar has-tick";
  if (pct == null) return `<i class="${cls}"></i>`;
  return `<i class="${cls}"><i class="fill ${pct >= 50 ? "up" : "down"}" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></i>`;
}

// A bar that grows left (blue) or right (yellow) from a centre line. `half` is 0 to 50 (% of the track).
function tmCenterBar(half, positive, extraClass) {
  const w = Math.max(0, Math.min(50, half));
  if (w < 0.4) return `<i class="tm-cbar${extraClass ? " " + extraClass : ""}"></i>`;
  const style = positive ? `left:50%;width:${w.toFixed(1)}%` : `right:50%;width:${w.toFixed(1)}%`;
  return `<i class="tm-cbar${extraClass ? " " + extraClass : ""}"><i class="fill ${positive ? "up" : "down"}" style="${style}"></i></i>`;
}

// ---- the index: controls, cards, table --------------------------------------

function teamsControlsHtml(ui, latestYear) {
  const sorts = TEAMS_SORTS.map((s) => {
    const label = s.key === "rank" ? `${latestYear} rank` : s.label;
    return `<button type="button" class="pill${ui.sort === s.key ? " on" : ""}" data-sort="${s.key}" aria-pressed="${ui.sort === s.key}">${escapeHtml(label)}</button>`;
  }).join("");
  const views = [
    { key: "cards", label: "Cards" },
    { key: "table", label: "Table" },
  ]
    .map((v) => `<button type="button" class="${ui.view === v.key ? "on" : ""}" data-view="${v.key}" aria-pressed="${ui.view === v.key}">${v.label}</button>`)
    .join("");
  return `
    <div class="tm-sorts"><span class="tm-ctl-label">Sort</span>${sorts}</div>
    <div class="tm-view" role="group" aria-label="View">${views}</div>`;
}

// "8th in 2026"; in the table (whose column header already says the year) just "8th".
function teamsRankPillHtml(card, latestYear, short) {
  if (!card.rank || !card.rank.started) return "";
  // A newcomer's "· NEW" is its own piece so a phone's table can stack it under the place.
  const text = card.rank.isNew ? `${escapeHtml(tmOrd(card.rank.finish))}<span class="tm-dot"> · </span><span class="tm-new">NEW</span>` : escapeHtml(short ? tmOrd(card.rank.finish) : `${tmOrd(card.rank.finish)} in ${latestYear}`);
  return `<span class="tm-rank ${card.rank.inside ? "in" : "out"}">${text}</span>`;
}

function teamsBarsHtml(card) {
  const bars = card.bars
    .map((b) => {
      if (b.empty) return `<i class="tm-bar none" title="${b.year}: not in the league"></i>`;
      const kinds = [];
      if (b.title) kinds.push("title");
      if (b.live) kinds.push("live", b.status === "live-in" ? "in" : b.status === "live-out" ? "out" : "idle");
      const tip = b.live ? `${b.year} so far: ${tmOrd(b.finish)}` : `${b.year}: finished ${tmOrd(b.finish)}${b.title ? " and won the title" : ""}`;
      return `<i class="tm-bar ${kinds.join(" ")}" style="height:${(b.height * 100).toFixed(0)}%" title="${escapeHtml(tip)}"></i>`;
    })
    .join("");
  const first = card.bars.length ? card.bars[0].year : "";
  const last = card.bars.length ? card.bars[card.bars.length - 1].year : "";
  return `<span class="tm-bars" role="img" aria-label="${escapeHtml(`Regular-season finish by year, ${first} to ${last}`)}">${bars}</span>`;
}

function teamsRecordHtml(card) {
  if (!card.games) return `<span class="tm-rec"><em>–</em>${tmWinBar(null)}<b>–</b></span>`;
  return `<span class="tm-rec"><em>${escapeHtml(card.record)}</em>${tmWinBar(card.pct)}<b>${tmPct(card.pct)}</b></span>`;
}

function teamsTitlesHtml(card) {
  if (!card.titles) return `<span class="tm-titles none">NO TITLES YET</span>`;
  return `<span class="tm-titles">${card.titles} ${card.titles === 1 ? "TITLE" : "TITLES"}${tmRingsHtml(card.titles)}</span>`;
}

function teamsCardHtml(card, latestYear) {
  const href = card.userId ? `href="#${encodeURIComponent(card.userId)}"` : "";
  return `
    <a class="tm-card" ${href} data-username="${escapeHtml(card.name)}">
      <span class="tm-card-top">
        <span class="tm-avatar" aria-hidden="true">${escapeHtml(card.name.trim().charAt(0).toUpperCase() || "?")}</span>
        <span class="tm-id"><span class="tm-name-row"><b class="tm-name" title="${escapeHtml(card.name)}">${escapeHtml(card.name)}</b></span><span class="tm-team">${card.teamName ? escapeHtml(card.teamName) : "&nbsp;"}</span></span>
        ${teamsRankPillHtml(card, latestYear)}
      </span>
      ${teamsBarsHtml(card)}
      ${teamsRecordHtml(card)}
      ${teamsTitlesHtml(card)}
    </a>`;
}

function teamsFormerCardHtml(card) {
  const href = card.userId ? `href="#${encodeURIComponent(card.userId)}"` : "";
  return `
    <a class="tm-card former" ${href} data-username="${escapeHtml(card.name)}">
      <span class="tm-card-top">
        <span class="tm-name-row"><b class="tm-name" title="${escapeHtml(card.name)}">${escapeHtml(card.name)}</b></span>
        <span class="tm-seasons-n">${tmPlural(card.seasons, "season").toUpperCase()}</span>
      </span>
      ${teamsRecordHtml(card)}
      ${card.titles ? teamsTitlesHtml(card) : ""}
    </a>`;
}

function teamsTableRowHtml(card, i, latestYear) {
  const link = card.userId ? `<a class="subtle-link tm-name" href="#${encodeURIComponent(card.userId)}">${escapeHtml(card.name)}</a>` : `<span class="tm-name">${escapeHtml(card.name)}</span>`;
  return `
    <tr class="tm-trow${card.former ? " is-former" : ""}" data-username="${escapeHtml(card.name)}">
      <td class="tm-t-n">${i}</td>
      <td class="tm-t-name">${link}${card.teamName ? `<small>${escapeHtml(card.teamName)}</small>` : ""}</td>
      <td class="tm-t-rank">${teamsRankPillHtml(card, latestYear, true) || "–"}</td>
      <td class="tm-t-titles">${card.titles ? `<b class="medal gold">${card.titles}</b>` : `<b class="medal gold none">–</b>`}</td>
      <td class="tm-t-seasons">${card.seasons}</td>
      <td class="tm-t-rec">${card.games ? escapeHtml(card.record) : "–"}</td>
      <td class="tm-t-pct">${card.games ? `<span class="tm-t-pctin">${tmWinBar(card.pct)}<b>${tmPct(card.pct)}</b></span>` : "–"}</td>
      <td class="tm-t-po">${card.completedYears ? `${card.trips} of ${card.completedYears}` : "–"}</td>
      <td class="tm-t-avg">${card.avgFinish != null ? card.avgFinish.toFixed(1) : "–"}</td>
    </tr>`;
}

function teamsTableHtml(active, former, latestYear) {
  const head = `
    <tr>
      <th class="tm-t-n">#</th><th class="tm-t-name">Manager</th><th class="tm-t-rank">${latestYear}</th><th class="tm-t-titles">Titles</th><th class="tm-t-seasons">Seasons</th>
      <th class="tm-t-rec">Record</th><th class="tm-t-pct">Win %</th><th class="tm-t-po">Playoff trips</th><th class="tm-t-avg">Avg finish</th>
    </tr>`;
  const rows = active.map((c, i) => teamsTableRowHtml(c, i + 1, latestYear)).join("");
  const formerRows = former.length
    ? `<tr class="tm-t-group"><td colspan="9">FORMER MANAGERS</td></tr>${former.map((c, i) => teamsTableRowHtml(c, active.length + i + 1, latestYear)).join("")}`
    : "";
  return `<div class="panel tm-table-panel"><div class="tm-table-wrap stay-scrollable"><table class="tm-table"><thead>${head}</thead><tbody>${rows}${formerRows}</tbody></table></div></div>`;
}

function teamsIndexHtml(cards, ui, latestYear) {
  if (!cards.length) return `<div class="empty-state">No managers yet.</div>`;
  const active = TeamsData.sortCards(cards.filter((c) => !c.former), ui.sort);
  const former = TeamsData.sortFormer(cards.filter((c) => c.former), ui.sort);
  if (ui.view === "table") return teamsTableHtml(active, former, latestYear);
  const formerHtml = former.length
    ? `
    <div class="tm-section-label"><span>FORMER MANAGERS</span></div>
    <div class="tm-grid tm-grid-former">${former.map((c) => teamsFormerCardHtml(c)).join("")}</div>`
    : "";
  return `<div class="tm-grid">${active.map((c) => teamsCardHtml(c, latestYear)).join("")}</div>${formerHtml}`;
}

function teamsSubText(ledger, cards) {
  const seasons = ledger.length;
  const active = cards.filter((c) => !c.former).length;
  const former = cards.length - active;
  const parts = [`${tmPlural(seasons, "season")} of history`, `${tmPlural(active, "active manager")}`];
  if (former) parts.push(`${former} former`);
  return parts.join(" · ");
}

// ---- the profile: picker, hero, tiles, season strip -----------------------------

function teamsPickerHtml(activeId) {
  const sorted = [...TeamsData.sortCards(TEAMS.cards.filter((c) => !c.former), "titles"), ...TeamsData.sortFormer(TEAMS.cards.filter((c) => c.former), "titles")];
  return sorted
    .filter((c) => c.userId)
    .map((c) => `<a class="tm-pick${c.userId === activeId ? " on" : ""}${c.former ? " is-former" : ""}" href="#${encodeURIComponent(c.userId)}" data-username="${escapeHtml(c.name)}"${c.userId === activeId ? ` aria-current="page"` : ""}>${escapeHtml(c.name)}</a>`)
    .join("");
}

function teamsHeroHtml(f, teamName, rep) {
  const tagline = [teamName, `playing since ${f.since}`, f.now].filter(Boolean).join(" · ");
  const rings = f.titleYears.length
    ? `<ul class="tm-rings">${f.titleYears.map((y) => `<li>${tmRingIcon()}<span>${y}</span></li>`).join("")}</ul>`
    : "";
  const photo = rep
    ? `
    <figure class="tm-rep-fig">
      ${playerLinkHtml(rep.playerId, playerPhotoHtml(rep.playerId, rep.name, "player-photo-hero"))}
      <figcaption><span>Player rep</span><b>${playerLinkHtml(rep.playerId, escapeHtml(rep.name))}</b><em>${rep.weeks} wks</em></figcaption>
    </figure>`
    : "";
  return `
    <header class="tm-hero${rep ? " has-rep" : ""}" data-username="${escapeHtml(f.name)}">
      <div class="tm-hero-main">
        <p class="tm-eyebrow">TEAM PROFILE</p>
        <h1 class="tm-hero-name">${escapeHtml(f.name)}</h1>
        <p class="tm-tagline">${escapeHtml(tagline)}</p>
      </div>
      <div class="tm-hero-titles">
        <p class="tm-title-line">${escapeHtml(f.titleLine)}</p>
        ${rings}
      </div>
      ${photo}
    </header>`;
}

function teamsBigTileHtml(label, record, pct, note) {
  const has = pct != null && record !== "0-0";
  return `
    <div class="tm-tile big">
      <span class="tm-tile-label">${escapeHtml(label)}</span>
      <div class="tm-tile-main"><b>${has ? escapeHtml(record) : "–"}</b>${has ? `<em class="${pct >= 50 ? "up" : "down"}">${tmPct(pct)}</em>` : ""}</div>
      ${has ? tmWinBar(pct) : `<i class="bar has-tick"></i>`}
      <p>${escapeHtml(note)}</p>
    </div>`;
}

function teamsSmallTileHtml(label, value, note) {
  return `
    <div class="tm-tile small">
      <span class="tm-tile-label">${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
      <p>${escapeHtml(note)}</p>
    </div>`;
}

function teamsTilesHtml(f) {
  const byeNote = f.byes.note;
  const thirdNote = f.third.years.length ? f.third.years.join(", ") : "None yet";
  return `
    <div class="tm-tiles-big">
      ${teamsBigTileHtml("Overall Record", f.overall.record, f.overall.pct, f.overall.note)}
      ${teamsBigTileHtml("Regular Season", f.regular.record, f.regular.pct, f.regular.note)}
      ${teamsBigTileHtml("Playoffs", f.playoffs.record, f.playoffs.pct, f.playoffs.note)}
    </div>
    <div class="tm-tiles-small">
      ${teamsSmallTileHtml("Championship Games", f.titleGames.record, f.titleGames.note)}
      ${teamsSmallTileHtml("Playoff Appearances", f.trips.text, f.trips.note)}
      ${teamsSmallTileHtml("First-Round Byes", f.byes.text, byeNote)}
      ${teamsSmallTileHtml("Third Place", String(f.third.count), thirdNote)}
    </div>`;
}

const TEAMS_CELL_NAMES = {
  champion: "Champion",
  runnerUp: "Runner-up",
  third: "Third place",
  playoffs: "Made the playoffs",
  missed: "Missed the playoffs",
  "live-in": "in the playoff spots so far",
  "live-out": "outside the playoff spots so far",
  live: "not started",
};
const TEAMS_MEDAL_LABEL = { champion: "TITLE", runnerUp: "2ND", third: "3RD", "live-in": "LIVE", "live-out": "LIVE", live: "LIVE" };

function teamsLegendHtml(live) {
  const sw = (cls, text) => `<span class="lg"><i class="sq mini ${cls}"></i>${escapeHtml(text)}</span>`;
  return TEAMS_LEGEND.map(([cls, text]) => sw(cls, text)).join("") + (live ? `${sw("st-live-in", "Live: in")}${sw("st-live-out", "Live: out")}` : "");
}

function teamsStripHtml(owner) {
  const cells = owner.cells;
  const live = cells.some((c) => !c.complete);
  const squares = cells
    .map((c) => {
      const games = c.wins + c.losses + c.ties;
      const label = TEAMS_MEDAL_LABEL[c.status] || "";
      const tip = `${c.year}: ${TEAMS_CELL_NAMES[c.status] || ""} (${tmOrd(c.finish)} in the regular season)`;
      const rec = games ? HistoryData.recordOf(c.wins, c.losses, c.ties) : "–";
      return `
      <li class="tm-sqcell">
        <span class="tm-sq-year${c.complete ? "" : " live"}">${c.year}</span>
        <span class="sq st-${c.status} tm-sq" title="${escapeHtml(tip)}"><b>${c.finish}</b>${label ? `<small>${label}</small>` : ""}</span>
        <span class="tm-sq-rec${games && c.wins < c.losses ? " down" : ""}">${rec}</span>
      </li>`;
    })
    .join("");
  return `
    <section class="panel" id="tm-strip">
      <div class="panel-head"><h2>Seasons at a Glance</h2></div>
      <ol class="tm-strip" style="--n:${cells.length}">${squares}</ol>
      <div class="hist-legend">${teamsLegendHtml(live)}</div>
    </section>`;
}

function teamsJumpHtml(show) {
  const links = TEAMS_JUMPS.filter((j) => show[j.id])
    .map((j) => `<button type="button" class="tm-jump-link" data-jump="${j.id}">${j.label}</button>`)
    .join("");
  return `<nav class="hist-jump tm-jump" aria-label="Jump to a section"><span class="hist-jump-label">Jump to</span>${links}</nav>`;
}

// ---- Season by Season -----------------------------------------------------

function teamsHighlightText(kind, row) {
  const parts = [];
  parts.push(row.record);
  if (row.status === "champion") parts.push("won the title");
  else if (row.status === "runnerUp") parts.push("lost in the final");
  else if (row.status === "third") parts.push("finished third");
  if (kind === "bestScoring") {
    if (row.leagueAvg != null) parts.unshift(`${Math.abs(row.ppgFor - row.leagueAvg).toFixed(1)} ${row.ppgFor >= row.leagueAvg ? "above" : "below"} the league average`);
    return parts.join(" · ");
  }
  if (row.ppgFor != null && row.leagueAvg != null) parts.push(`${row.ppgFor.toFixed(1)} per game against a ${row.leagueAvg.toFixed(1)} league average`);
  if (row.overall) parts.push(`${row.overall.text} against everyone`);
  return parts.join(" · ");
}

function teamsHighlightsHtml(h) {
  const tile = (kind, label, cls, row, head) =>
    row
      ? `
      <div class="tm-hl ${cls}">
        <span class="tm-tile-label">${label}</span>
        <b>${head}</b>
        <p>${escapeHtml(teamsHighlightText(kind, row))}</p>
      </div>`
      : "";
  return `
    <div class="tm-highlights">
      ${tile("unluckiest", "Unluckiest year", "bad", h.unluckiest, h.unluckiest ? `${h.unluckiest.year}, ${tmSigned(h.unluckiest.luck)}` : "")}
      ${tile("luckiest", "Luckiest year", "good", h.luckiest, h.luckiest ? `${h.luckiest.year}, ${tmSigned(h.luckiest.luck)}` : "")}
      ${tile("bestScoring", "Best scoring year", "good", h.bestScoring, h.bestScoring ? `${h.bestScoring.year}, ${h.bestScoring.ppgFor.toFixed(1)} per game` : "")}
    </div>`;
}

function teamsSeasonRowHtml(r, scale) {
  const finish = r.finish != null ? `<span class="sq st-${r.status} tm-fin">#${r.finish}${r.label ? ` <small>${r.label}</small>` : ""}</span>` : "";
  const recBar = r.winPct == null ? "" : tmWinBar(r.winPct, false);
  const pf = r.ppgFor, pa = r.ppgAgainst;
  const w = (v) => (v == null ? 0 : Math.min(100, (v / scale.max) * 100)).toFixed(1);
  const avgTick = r.leagueAvg != null ? `<i class="avg" style="left:${w(r.leagueAvg)}%" title="${escapeHtml(`${r.year} league average: ${r.leagueAvg.toFixed(1)}`)}"></i>` : "";
  const ppgBars = pf != null ? `<span class="tm-ppg-bars"><i class="pf" style="width:${w(pf)}%"></i><i class="pa" style="width:${w(pa)}%"></i>${avgTick}</span>` : `<span class="tm-ppg-bars"></span>`;
  const ppgNums = pf != null ? `<span class="tm-ppg-nums"><b>${pf.toFixed(1)}</b> for<br /><b>${pa.toFixed(1)}</b> against</span>` : `<span class="tm-ppg-nums">–</span>`;
  const vs = r.overall
    ? `<em>${escapeHtml(r.overall.text)}</em>${r.live ? `<small>through Week ${r.games}</small>` : ""}`
    : `<em>n/a</em><small>no matchup data</small>`;
  const luckHtml =
    r.luck == null
      ? `<span class="tm-luck">${tmCenterBar(0, true)}<b class="na">n/a</b></span>`
      : `<span class="tm-luck">${tmCenterBar((Math.abs(r.luck) / scale.luck) * 50, r.luck >= 0)}<b class="${r.luck >= 0 ? "up" : "down"}">${tmSigned(r.luck)}</b></span>`;
  const line2 = [pf != null ? `${pf.toFixed(1)} for · ${pa.toFixed(1)} against` : "", r.overall ? `${r.overall.text} vs everyone` : ""].filter(Boolean).join(" · ");
  return `
      <li class="tm-sbs-row${r.live ? " live" : ""}">
        <span class="tm-year">${r.year}</span>
        <span class="tm-fin-cell">${finish}</span>
        <span class="tm-rec2"><em>${escapeHtml(r.record)}</em>${recBar}</span>
        <span class="tm-ppg">${ppgBars}${ppgNums}</span>
        <span class="tm-vs">${vs}</span>
        ${luckHtml}
        <span class="tm-line2">${escapeHtml(line2)}</span>
      </li>`;
}

function teamsSeasonsHtml(name, rows, highlights) {
  if (!rows.length) return `<div class="empty-state">No seasons yet.</div>`;
  const all = rows.flatMap((r) => [r.ppgFor, r.ppgAgainst, r.leagueAvg]).filter((v) => v != null && isFinite(v));
  const scale = {
    max: (all.length ? Math.max(...all) : 1) * 1.04,
    luck: Math.max(5, ...rows.filter((r) => r.luck != null).map((r) => Math.abs(r.luck))),
  };
  const live = rows.some((r) => r.live);
  return `
    ${teamsHighlightsHtml(highlights)}
    <div class="panel">
      <div class="tm-sbs-head" aria-hidden="true">
        <span>Year</span><span>Finish</span><span>Record</span><span>Points per game · for (gold), against (sage)</span><span>Vs everyone</span>
        <span class="tm-luck-head"><i>Unlucky</i><i>Luck</i><i>Lucky</i></span>
      </div>
      <ol class="tm-sbs-rows">${rows.map((r) => teamsSeasonRowHtml(r, scale)).join("")}</ol>
      <div class="hist-legend"><span class="lg"><i class="tick-key"></i>League average that year</span>${teamsLegendHtml(live)}</div>
    </div>`;
}

// ---- Head to Head ----------------------------------------------------------

function teamsPoCellHtml(r) {
  if (!r.poGames) return `<span class="tm-po none">–</span>`;
  const cls = r.po.wins > r.po.losses ? "up" : r.po.wins < r.po.losses ? "down" : "";
  return `<span class="tm-po ${cls}">${escapeHtml(r.poRecord)}</span>`;
}

function teamsH2hRowHtml(r, tag, small, managerId) {
  const half = r.winPct == null ? 0 : (Math.abs(r.winPct - 50) / 50) * 50;
  const bar = small ? tmCenterBar(half, r.winPct >= 50, "dim") : tmCenterBar(half, r.winPct >= 50);
  const pctCls = small ? "dim" : r.winPct > 50 ? "up" : r.winPct < 50 ? "down" : "";
  const name = r.userId ? `<a class="subtle-link tm-opp-name" href="#${encodeURIComponent(r.userId)}">${escapeHtml(r.name)}</a>` : `<span class="tm-opp-name">${escapeHtml(r.name)}</span>`;
  const riv = r.userId && managerId ? `<a class="tm-riv" href="rivalries.html#${encodeURIComponent(managerId)}-vs-${encodeURIComponent(r.userId)}" aria-label="Rivalry with ${escapeHtml(r.name)}"><span class="tm-riv-long">Rivalry →</span><span class="tm-riv-short">→</span></a>` : `<span class="tm-riv"></span>`;
  return `
      <li class="tm-h2h-row${small ? " small" : ""}" data-username="${escapeHtml(r.name)}">
        <span class="tm-opp">${name}${tag ? `<span class="tm-flag ${tag.cls}">${tag.text}</span>` : ""}</span>
        <span class="tm-h2h-rec">${escapeHtml(r.record)}</span>
        <span class="tm-h2h-gp">${r.games}</span>
        ${bar}
        <span class="tm-h2h-pct ${pctCls}">${r.winPct == null ? "–" : `${Math.round(r.winPct)}%`}</span>
        ${teamsPoCellHtml(r)}
        ${riv}
      </li>`;
}

function teamsH2hCardsHtml(cards) {
  if (!cards.length) return "";
  return `<div class="tm-h2h-cards">${cards
    .map(
      (c) => `
      <div class="tm-h2h-card ${c.kind}">
        <span class="tm-tile-label">${escapeHtml(c.label)}</span>
        <b>${escapeHtml(c.head)}</b>
        <p>${escapeHtml(c.body)}</p>
      </div>`
    )
    .join("")}</div>`;
}

function teamsH2hHtml(manager) {
  const h2h = TeamsData.headToHead(manager);
  if (!h2h.rows.length) return `<div class="panel"><div class="empty-state">No matchups recorded yet.</div></div>`;
  const id = manager.userId;
  const ranked = h2h.ranked.map((r) => teamsH2hRowHtml(r, r.key === h2h.bestKey ? { cls: "best", text: "BEST" } : r.key === h2h.worstKey ? { cls: "worst", text: "WORST" } : null, false, id)).join("");
  const small = h2h.small.length
    ? `<li class="tm-group"><span>UNDER ${TeamsData.MIN_H2H_GAMES} GAMES · TOO SMALL TO RANK</span></li>${h2h.small.map((r) => teamsH2hRowHtml(r, null, true, id)).join("")}`
    : "";
  const groups = TeamsData.playoffOnlyGroups(h2h.playoffOnly);
  const only = groups.length
    ? `<li class="tm-group"><span>PLAYOFFS ONLY</span></li>${groups
        .map((g) => {
          const names = g.names.map((n) => escapeHtml(n)).join(", ");
          const cls = /–|^0-/.test(g.record) ? "" : "up";
          return `
      <li class="tm-h2h-row only" ${g.names.length === 1 ? `data-username="${escapeHtml(g.names[0])}"` : ""}>
        <span class="tm-opp"><span class="tm-opp-name">${names}</span></span>
        <span class="tm-h2h-rec">–</span>
        <span class="tm-h2h-gp">–</span>
        <span class="tm-only-note">${escapeHtml(g.note)}</span>
        <span class="tm-h2h-pct"></span>
        <span class="tm-po ${cls}">${escapeHtml(g.record)}</span>
        <span class="tm-riv"></span>
      </li>`;
        })
        .join("")}`
    : "";
  return `
    <div class="tm-h2h-layout">
      <div class="panel">
        <div class="tm-h2h-head" aria-hidden="true">
          <span>Opponent</span><span>Reg. season</span><span>GP</span>
          <span class="tm-h2h-axis"><i>Losing</i><i>.500</i><i>Winning</i></span>
          <span>Win %</span><span>Playoffs</span><span></span>
        </div>
        <ol class="tm-h2h-rows">${ranked}${small}${only}</ol>
      </div>
      ${teamsH2hCardsHtml(TeamsData.headToHeadCards(h2h))}
    </div>`;
}

// ---- Draft report cards, pick by pick, most common lineup ----------------------------

const TEAMS_ACQ_CLASS = { Draft: "draft", Waivers: "waivers", Trade: "trade", "Free Agency": "fa", Roster: "roster" };

function teamsGradeSquareHtml(g, i) {
  return g ? `<i class="gr gr-${g}" title="Pick ${i + 1}: ${g}">${g}</i>` : `<i class="gr gr-none" title="Pick ${i + 1}: not graded">·</i>`;
}

function teamsGradeKeyHtml() {
  return `<span class="tm-gr-key">${TeamsData.GRADES.map((g) => `<i class="gr gr-${g}">${g}</i>`).join("")}</span>`;
}

function teamsReportCardsHtml(manager, selectedYear) {
  const cards = TeamsData.reportCards(manager);
  if (!cards.length) return `<div class="empty-state">No graded drafts yet.</div>`;
  const rows = cards
    .map(
      (c) => `
      <button type="button" class="tm-rc-row${c.title ? " title" : ""}${c.year === selectedYear ? " on" : ""}" data-year="${c.year}" aria-pressed="${c.year === selectedYear}">
        <span class="tm-rc-year">${c.year}</span>
        <span class="tm-rc-grades">${c.grades.map((g, i) => teamsGradeSquareHtml(g, i)).join("")}${c.title ? `<em>TITLE</em>` : ""}</span>
        <span class="tm-rc-sa">${c.sa}</span>
        <span class="tm-rc-df">${c.df}</span>
      </button>`
    )
    .join("");
  return `
    <div class="tm-rc-head" aria-hidden="true"><span>Year</span><span>Every pick, in order</span><span>S + A</span><span>D + F</span></div>
    <div class="tm-rc-rows">${rows}</div>`;
}

function teamsPicksHtml(table, expanded) {
  if (!table) return `<div class="empty-state">No draft data for this season.</div>`;
  const shown = expanded ? table.picks : table.picks.slice(0, TEAMS_PICKS_SHOWN);
  const rows = shown
    .map((p) => {
      const pos = p.position ? escapeHtml(p.position) : "";
      const vbd =
        p.vbd == null
          ? ""
          : `${tmCenterBar((Math.abs(p.vbd) / (table.maxVbd || 1)) * 50, p.vbd >= 0)}<span class="tm-pk-vbd ${p.vbd >= 0 ? "up" : "down"}">${p.vbd >= 0 ? "+" : "-"}${Math.abs(p.vbd).toFixed(1)}</span><span class="tm-pk-gr">${p.grade ? `<i class="gr gr-${p.grade}">${p.grade}</i>` : ""}</span>`;
      return `
      <li class="tm-pk-row">
        <span class="tm-pk-n">${escapeHtml(p.label)}</span>
        <span class="tm-pk-player">${playerLinkHtml(p.playerId, escapeHtml(p.player))}<small>${pos}</small></span>
        <span class="tm-pk-pos">${pos}</span>
        <span class="tm-pk-pts">${p.points != null ? p.points.toFixed(1) : "–"}</span>
        ${vbd}
      </li>`;
    })
    .join("");
  const more = table.picks.length > TEAMS_PICKS_SHOWN ? `<button type="button" class="tm-more" data-more="picks">${expanded ? "Show fewer picks" : `Show all ${table.picks.length} picks`}</button>` : "";
  const mod = table.graded ? "" : " ungraded";
  const head = table.graded
    ? `<span>Pick</span><span>Player</span><span>Pos</span><span>Points</span><span class="tm-vbd-head">Value over replacement (VBD)</span><span>VBD</span><span>Gr</span>`
    : `<span>Pick</span><span>Player</span><span>Pos</span><span>Points</span>`;
  return `
    <div class="tm-pk-head${mod}" aria-hidden="true">${head}</div>
    <ol class="tm-pk-rows${mod}">${rows}</ol>
    ${more}`;
}

function teamsLineupHtml(lineup) {
  if (!lineup) return `<div class="empty-state">No lineup data for this season.</div>`;
  const total = lineup.mix.reduce((t, m) => t + m.count, 0);
  const mix = total
    ? `
    <div class="tm-mix" role="img" aria-label="${escapeHtml(lineup.mix.map((m) => `${m.label} ${m.count}`).join(", "))}">${lineup.mix.map((m) => `<i class="acq-${TEAMS_ACQ_CLASS[m.label] || "roster"}" style="flex-grow:${m.count}"></i>`).join("")}</div>
    <div class="hist-legend tm-mix-legend">${lineup.mix.map((m) => `<span class="lg"><i class="sq mini tm-acq-sw acq-${TEAMS_ACQ_CLASS[m.label] || "roster"}"></i>${escapeHtml(m.label)} ${m.count}</span>`).join("")}</div>`
    : "";
  const rows = lineup.slots
    .map((s) => {
      const tag = s.acquisition ? `<span class="tm-acq acq-${TEAMS_ACQ_CLASS[s.acquisition] || "roster"}">${escapeHtml(s.acquisition.toUpperCase())}</span>` : "";
      const who = s.player ? `<span class="tm-lu-name">${playerLinkHtml(s.playerId, escapeHtml(s.player))}</span>${tag}` : `<span class="tm-lu-name none">—</span>`;
      return `
      <li class="tm-lu-row">
        <span class="tm-lu-slot">${escapeHtml(s.slot)}</span>
        <span class="tm-lu-player">${who}</span>
        <span class="tm-lu-starts"><i class="bar"><i class="fill sage" style="width:${(s.share * 100).toFixed(0)}%"></i></i><b>${s.starts || "–"}</b></span>
      </li>`;
    })
    .join("");
  return `
    ${mix}
    <div class="tm-lu-head" aria-hidden="true"><span>Slot</span><span>Player · how acquired</span><span>Starts of ${lineup.weeks}</span></div>
    <ol class="tm-lu-rows">${rows}</ol>`;
}

function teamsYearPillsHtml(years, selected) {
  return `<div class="tm-year-pills" role="group" aria-label="Draft year">${years
    .map((y) => `<button type="button" class="pill${y.year === selected ? " on" : ""}" data-year="${y.year}" aria-pressed="${y.year === selected}">${y.year}${y.graded ? "" : ` <small>LIVE</small>`}</button>`)
    .join("")}</div>`;
}

// The year the Draft section is on: the one picked (if this manager has it), else the newest graded.
function teamsDraftYear(manager, ui) {
  const years = TeamsData.draftYears(manager);
  if (!years.length) return null;
  return years.some((y) => y.year === ui.draftYear) ? ui.draftYear : TeamsData.defaultDraftYear(years);
}

function teamsDraftBodyHtml(manager, ui) {
  const years = TeamsData.draftYears(manager);
  if (!years.length) return `<div class="panel"><div class="empty-state">No draft data yet.</div></div>`;
  const year = teamsDraftYear(manager, ui);
  const season = (manager.seasons || []).find((s) => Number(s.season) === year);
  const table = TeamsData.draftTable(season);
  const lineup = TeamsData.lineupView(season);
  const pickNote = table && !table.graded ? "In progress · grades after the season" : table && table.title ? "Title year" : "";
  const lineupNote = lineup ? `${lineup.year}${lineup.title ? " · Title" : ""}` : `${year}`;
  return `
    ${teamsYearPillsHtml(years, year)}
    <div class="tm-draft-layout">
      <div class="tm-draft-main">
        <section class="panel" id="tm-reports">
          <div class="panel-head"><h2>Draft Report Cards</h2>${teamsGradeKeyHtml()}</div>
          ${teamsReportCardsHtml(manager, year)}
        </section>
        <section class="panel" id="tm-picks">
          <div class="panel-head"><h2>${year} Draft, Pick by Pick</h2><span class="panel-note">${escapeHtml(pickNote)}</span></div>
          ${teamsPicksHtml(table, TEAMS_UI.picksExpanded)}
        </section>
      </div>
      <section class="panel" id="tm-lineup">
        <div class="panel-head"><h2>Most Common Lineup</h2><span class="panel-note">${escapeHtml(lineupNote)}</span></div>
        ${teamsLineupHtml(lineup)}
      </section>
    </div>`;
}

// ---- Season Awards and the Player Representative ------------------------------------

function teamsAwardsHtml(awards) {
  const nameIndex = tmNameIndex();
  const rows = awards
    .map((a) => {
      const text = a.detail || (a.category === "Best Team" ? `${a.year} team` : "");
      const pid = a.detail ? findPlayerIdByName(a.detail, nameIndex) : null;
      return `
      <li class="tm-aw-row">
        <span class="tm-aw-year">${a.year}</span>
        <i class="tm-aw-sq ${a.good ? "good" : "bad"}" title="${a.good ? "Best" : "Worst"}"></i>
        <span class="tm-aw-cat">${escapeHtml(a.category)}</span>
        <span class="tm-aw-detail">${text ? playerLinkHtml(pid, escapeHtml(text)) : ""}</span>
      </li>`;
    })
    .join("");
  return `
    <section class="panel" id="tm-awards">
      <div class="panel-head"><h2>Season Awards</h2><span class="tm-aw-key"><span class="lg"><i class="tm-aw-sq good"></i>Best</span><span class="lg"><i class="tm-aw-sq bad"></i>Worst</span></span></div>
      <ol class="tm-aw-rows">${rows}</ol>
    </section>`;
}

function teamsRepHtml(rep) {
  const top = rep[0];
  const rows = rep
    .map(
      (p, i) => `
      <li class="tm-rep-row">
        <span class="tm-rep-name">${playerLinkHtml(p.playerId, escapeHtml(p.name))}</span>
        <i class="bar"><i class="fill ${i === 0 ? "up" : "sage"}" style="width:${(p.share * 100).toFixed(1)}%"></i></i>
        <b>${p.weeks} wks</b>
      </li>`
    )
    .join("");
  return `
    <section class="panel" id="tm-rep">
      <div class="panel-head"><h2>Player Representative</h2></div>
      <p class="tm-rep-top"><b>${playerLinkHtml(top.playerId, escapeHtml(top.name))}</b><span>${top.weeks} weeks on the roster, the most of any player</span></p>
      <ol class="tm-rep-rows">${rows}</ol>
    </section>`;
}

// ---- the whole profile ------------------------------------------------------------------

function teamsSectionHead(name, title) {
  return `<div class="tm-sec-head"><span class="tm-eyebrow">${escapeHtml(name)}</span><h2>${escapeHtml(title)}</h2></div>`;
}

function teamsProfileHtml(owner, manager) {
  const f = TeamsData.profileFacts(owner, TEAMS.owners, TEAMS.ledger, manager);
  const rep = TeamsData.playerRep(manager);
  const rows = TeamsData.seasonRows(owner, manager, TEAMS.averages);
  const awards = TeamsData.awardsFor(owner.name, TEAMS.awards, TEAMS.trackedYears);
  const hasDraft = TeamsData.draftYears(manager).length > 0;
  const card = TEAMS.cards.find((c) => c.key === owner.key);
  const jump = { seasons: true, h2h: true, draft: hasDraft, lineup: hasDraft, awards: awards.length > 0 || rep.length > 0 };

  const bottom =
    awards.length || rep.length
      ? `<div class="wrap tm-pair" id="tm-awards-wrap">${awards.length ? teamsAwardsHtml(awards) : ""}${rep.length ? teamsRepHtml(rep) : ""}</div>`
      : "";

  return `
    <div class="wrap tm-profile-top">
      <a class="back-link" href="#">&larr; All teams</a>
      <nav class="tm-picker" id="tm-picker" aria-label="Pick a team">${teamsPickerHtml(owner.userId)}</nav>
    </div>
    <div class="wrap">${teamsHeroHtml(f, card ? card.teamName : "", rep[0] || null)}</div>
    <div class="wrap tm-tiles">${teamsTilesHtml(f)}</div>
    <div class="wrap">${teamsStripHtml(owner)}</div>
    <div class="wrap">${teamsJumpHtml(jump)}</div>

    <div class="wrap tm-sec" id="tm-seasons">
      ${teamsSectionHead(owner.name, "Season by Season")}
      ${teamsSeasonsHtml(owner.name, rows, TeamsData.seasonHighlights(rows))}
    </div>

    <div class="wrap tm-sec" id="tm-h2h">
      ${teamsSectionHead(owner.name, "Head-to-Head")}
      ${teamsH2hHtml(manager)}
    </div>

    <div class="wrap tm-sec" id="tm-draft">
      ${teamsSectionHead(owner.name, "Draft Picks and Lineups")}
      <div id="tm-draft-body">${teamsDraftBodyHtml(manager, TEAMS_UI)}</div>
    </div>

    ${bottom}`;
}

// ---- drawing the page ---------------------------------------------------------------

function tmSet(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function renderIndex() {
  tmSet("teams-controls", teamsControlsHtml(TEAMS_UI, TEAMS.latestYear));
  tmSet("teams-index", teamsIndexHtml(TEAMS.cards, TEAMS_UI, TEAMS.latestYear));
}

function renderDraft() {
  const owner = TEAMS.owners.find((o) => o.userId === TEAMS_UI.profileId);
  const manager = TEAMS.stats.managers.find((m) => m.userId === TEAMS_UI.profileId);
  if (!owner || !manager) return;
  tmSet("tm-draft-body", teamsDraftBodyHtml(manager, TEAMS_UI));
}

function showIndex() {
  TEAMS_UI.profileId = null;
  document.getElementById("teams-detail-view").style.display = "none";
  document.getElementById("teams-index-view").style.display = "";
  const sub = document.getElementById("sb-sub");
  if (sub) sub.textContent = teamsSubText(TEAMS.ledger, TEAMS.cards);
  renderIndex();
}

function showProfile(owner, manager) {
  const changed = TEAMS_UI.profileId !== owner.userId;
  if (changed) {
    TEAMS_UI.profileId = owner.userId;
    TEAMS_UI.draftYear = null;
    TEAMS_UI.picksExpanded = false;
  }
  document.getElementById("teams-index-view").style.display = "none";
  const view = document.getElementById("teams-detail-view");
  view.innerHTML = teamsProfileHtml(owner, manager);
  view.style.display = "";
  if (changed && typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
  const on = view.querySelector ? view.querySelector(".tm-pick.on") : null;
  const strip = document.getElementById("tm-picker");
  if (on && strip && typeof on.offsetLeft === "number") strip.scrollLeft = Math.max(0, on.offsetLeft - 24);
}

function renderRoute() {
  const id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
  const owner = id ? TEAMS.owners.find((o) => o.userId === id) : null;
  const manager = owner ? TEAMS.stats.managers.find((m) => m.userId === owner.userId) : null;
  if (owner && manager) showProfile(owner, manager);
  else showIndex();
}

function teamsJump(id) {
  const el = document.getElementById(`tm-${id}`) || document.getElementById(`tm-${id}-wrap`);
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// The controls. Wired once: the markup inside is redrawn, so each listener sits on a container that stays.
function initTeamsControls() {
  const controls = document.getElementById("teams-controls");
  if (controls) {
    controls.onclick = (e) => {
      const btn = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!btn) return;
      if (btn.getAttribute("data-sort")) TEAMS_UI.sort = btn.getAttribute("data-sort");
      else if (btn.getAttribute("data-view")) TEAMS_UI.view = btn.getAttribute("data-view");
      else return;
      renderIndex();
    };
  }
  const detail = document.getElementById("teams-detail-view");
  if (detail) {
    detail.onclick = (e) => {
      const target = e.target && e.target.closest ? e.target : null;
      if (!target) return;
      const jump = target.closest("[data-jump]");
      if (jump) {
        teamsJump(jump.getAttribute("data-jump"));
        return;
      }
      const more = target.closest("[data-more]");
      if (more) {
        TEAMS_UI.picksExpanded = !TEAMS_UI.picksExpanded;
        renderDraft();
        return;
      }
      const yearBtn = target.closest("[data-year]");
      if (yearBtn) {
        const year = Number(yearBtn.getAttribute("data-year"));
        if (year !== TEAMS_UI.draftYear) TEAMS_UI.picksExpanded = false;
        TEAMS_UI.draftYear = year;
        renderDraft();
      }
    };
  }
  window.addEventListener("hashchange", renderRoute);
}

// ---- loading ---------------------------------------------------------------------------

async function renderTeams() {
  const errorBox = document.getElementById("teams-error");
  const errorWrap = document.getElementById("teams-error-wrap");
  const progressBox = document.getElementById("progress-status");

  try {
    const [seasonChain, playerDirectory, seasonAwards, rawManual] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(SEASON_AWARDS_FILE, { seasons: {} }),
      fetchJsonSafe(MANUAL_HISTORY_FILE, { seasons: [] }),
    ]);
    // An un-replaced template entry (champion still says "REPLACE_WITH...") never shows up on the live site.
    const manual = { ...rawManual, seasons: (rawManual.seasons || []).filter((s) => s.champion && !String(s.champion).startsWith("REPLACE_WITH")) };

    if (seasonChain.length === 0) {
      throw new Error("Couldn't load the league's seasons from Sleeper. Give it a minute and refresh the page.");
    }

    TEAMS.awards = seasonAwards;
    TEAMS.playerDirectory = playerDirectory;
    TEAMS.trackedYears = new Set(seasonChain.map((s) => String(s.league.season)));
    TEAMS.ledger = HistoryData.buildLedger(seasonChain, manual);
    TEAMS.averages = TeamsData.leagueAverages(seasonChain, manual);

    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Teams";

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    const stats = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);

    // The owners (finishes, titles, playoff trips) are built from the Sleeper seasons alone and folded
    // together with the ESPN rows by name, exactly as the History page does. That has to happen before
    // the ESPN seasons are added to the managers below, which are shaped differently.
    const ownerData = HistoryData.buildOwners(stats.managers, manual, TEAMS.ledger);
    TEAMS.owners = ownerData.owners;
    TEAMS.firstYear = ownerData.firstYear;
    TEAMS.latestYear = ownerData.latestYear;

    // Fold the ESPN-era totals and seasons into each manager who also played in Sleeper (the points,
    // the all-play numbers and the draft come from the manager; the finishes come from the owner).
    const manualStatsByTeam = ManualHistory.computeManagerStats(manual);
    const manualH2HPlayoffs = ManualHistory.computeHeadToHeadPlayoffs(manual);
    stats.managers.forEach((m) => {
      if (!m.username) return;
      const manualForThisManager = manualStatsByTeam.get(m.username);
      if (manualForThisManager) {
        ManualHistory.mergeIntoManager(m, manualForThisManager.totals);
        m.seasons = [...m.seasons, ...manualForThisManager.seasons];
      }
      ManualHistory.mergeHeadToHeadPlayoffs(m, manualH2HPlayoffs.get(m.username));
    });
    TEAMS.stats = stats;

    TEAMS.teamNames = {};
    stats.managers.forEach((m) => {
      if (m.userId && m.teamName) TEAMS.teamNames[m.userId] = m.teamName;
    });
    const years = [];
    for (let y = TEAMS.firstYear; y <= TEAMS.latestYear; y++) years.push(y);
    const teamCountByYear = {};
    TEAMS.ledger.forEach((s) => (teamCountByYear[s.year] = s.teamCount));
    const ctx = { years, teamCountByYear, latestYear: TEAMS.latestYear, teamNames: TEAMS.teamNames };
    TEAMS.cards = TEAMS.owners.map((o) => TeamsData.ownerCard(o, ctx));

    initTeamsControls();
    renderRoute();
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load team history — " + err.message;
    errorBox.style.display = "block";
    if (errorWrap) errorWrap.style.display = "block";
    const sub = document.getElementById("sb-sub");
    if (sub) sub.textContent = "";
    tmSet("teams-index", "");
  }
}

document.addEventListener("DOMContentLoaded", renderTeams);
