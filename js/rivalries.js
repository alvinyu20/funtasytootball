let LEAGUE_STATS = null;

async function renderRivalriesPage() {
  const errorBox = document.getElementById("rivalries-error");
  const progressBox = document.getElementById("progress-status");
  const pickerBox = document.getElementById("rivalry-picker");

  try {
    const [seasonChain, playerDirectory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load the league's seasons from Sleeper. Give it a minute and refresh the page.");
    }
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

    LEAGUE_STATS = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);

    if (LEAGUE_STATS.managers.length < 2) {
      document.getElementById("rivalry-content").innerHTML = `<div class="wrap"><div class="empty-state">Need at least 2 managers with history to compare.</div></div>`;
      return;
    }

    const sortedManagers = [...LEAGUE_STATS.managers].sort((a, b) => (a.username || a.teamName).localeCompare(b.username || b.teamName));
    const selectA = document.getElementById("rivalry-select-a");
    const selectB = document.getElementById("rivalry-select-b");
    const optionsHtml = sortedManagers.map((m) => `<option value="${escapeHtml(m.userId)}">${escapeHtml(m.username || m.teamName)}</option>`).join("");
    selectA.innerHTML = optionsHtml;
    selectB.innerHTML = optionsHtml;

    const validIds = new Set(sortedManagers.map((m) => m.userId));
    const featured = await featuredPromise;
    const hot = hottestRivalries(LEAGUE_STATS.pairGameLog, LEAGUE_STATS.managers, HOTLIST_SIZE * 2);
    const opening = pickOpeningPair({
      hashPair: parseHash(),
      validIds,
      me: typeof MyTeam !== "undefined" ? MyTeam.get() : null,
      managers: LEAGUE_STATS.managers,
      featured,
      pairGameLog: LEAGUE_STATS.pairGameLog,
      hot,
      fallback: [sortedManagers[0].userId, sortedManagers[1] ? sortedManagers[1].userId : sortedManagers[0].userId],
    });
    selectA.value = opening.a;
    selectB.value = opening.b;

    pickerBox.style.display = "flex";
    renderHotlist(hot.slice(0, HOTLIST_SIZE));
    showWhy(opening.reason);
    renderRivalry(opening.a, opening.b);
    window.location.hash = `${selectA.value}-vs-${selectB.value}`;

    function show(a, b, reason) {
      selectA.value = a;
      selectB.value = b;
      window.location.hash = `${a}-vs-${b}`;
      showWhy(reason || "");
      renderRivalry(a, b);
    }
    selectA.addEventListener("change", () => show(selectA.value, selectB.value, ""));
    selectB.addEventListener("change", () => show(selectA.value, selectB.value, ""));
    document.getElementById("rivalry-swap").addEventListener("click", () => show(selectB.value, selectA.value, ""));
    document.getElementById("rivalry-hotlist").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rivalry-a]");
      if (!btn) return;
      show(btn.getAttribute("data-rivalry-a"), btn.getAttribute("data-rivalry-b"), "From the hotlist");
      const target = document.getElementById("rivalry-picker");
      if (target && target.scrollIntoView) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load rivalry data — " + err.message;
    errorBox.style.display = "block";
  }
}

// ---------------------------------------------------------------
// Which rivalry to open on. A link wins; then your own hottest rivalry
// (if you picked a team); then this week's featured matchup (if those two
// have met before); then the league's hottest rivalry. Never a random pair.
// ---------------------------------------------------------------
const HOTLIST_SIZE = 6;

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

// A short reason a pair is on the hotlist.
function hotTag(r) {
  if (r.playoffs >= 2) return "Playoff history";
  if (r.meetings >= 4 && Math.abs(r.winsA - r.winsB) <= 1) return "Dead even";
  if (r.meetings >= 6) return "Most played";
  return "Heating up";
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

function showWhy(reason) {
  const el = document.getElementById("rivalry-why");
  if (!el) return;
  el.textContent = reason ? `Opening on: ${reason}` : "";
  el.style.display = reason ? "" : "none";
}

function hotlistItemsHtml(rows) {
  return rows
    .map(
      (r) => `
      <button type="button" class="hot-rivalry" data-rivalry-a="${escapeHtml(r.a)}" data-rivalry-b="${escapeHtml(r.b)}">
        <span class="hot-rivalry-names"><span data-username="${escapeHtml(r.nameA)}">${escapeHtml(r.nameA)}</span> <span class="hot-rivalry-vs">vs</span> <span data-username="${escapeHtml(r.nameB)}">${escapeHtml(r.nameB)}</span></span>
        <span class="hot-rivalry-record">${r.winsA}-${r.winsB}${r.ties ? "-" + r.ties : ""}</span>
        <span class="hot-rivalry-meta">${r.meetings} meeting${r.meetings === 1 ? "" : "s"}${r.playoffs ? ` \u00b7 ${r.playoffs} playoff` : ""} \u00b7 ${escapeHtml(hotTag(r))}</span>
      </button>`
    )
    .join("");
}

function renderHotlist(rows) {
  const box = document.getElementById("rivalry-hotlist");
  if (!box) return;
  const wrap = document.getElementById("rivalry-hotlist-panel");
  if (!rows.length) {
    if (wrap) wrap.style.display = "none";
    return;
  }
  box.innerHTML = hotlistItemsHtml(rows);
  if (wrap) wrap.style.display = "";
  // Open on a wide screen, folded on a phone (the rivalry itself should be what you see first).
  const details = document.getElementById("rivalry-hotlist-details");
  if (details && typeof window !== "undefined" && window.matchMedia && window.matchMedia("(min-width: 721px)").matches) details.setAttribute("open", "");
}

function parseHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const parts = hash.split("-vs-");
  return [parts[0], parts[1]];
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

function recordCardHtml(label, value, detail) {
  return `
    <div class="record-card">
      <p class="record-label">${escapeHtml(label)}</p>
      <p class="record-value">${value}</p>
      ${detail ? `<p class="record-detail">${detail}</p>` : ""}
    </div>`;
}

// Closest Meeting and Biggest Blowout. With only one meeting (or every game the same
// margin) they are the same game, so say that once instead of two identical cards.
function marginCardsHtml(closest, blowout, meetings) {
  if (!closest || !blowout) return "";
  const detail = (g) => `${g.season} Wk ${g.week}${g.isPlayoff ? " \u00b7 Playoffs" : ""}`;
  const sameGame = closest.season === blowout.season && closest.week === blowout.week;
  if (sameGame || closest.margin === blowout.margin) {
    return recordCardHtml(meetings === 1 ? "Their Only Meeting" : "Every Game Was This Close", `${closest.margin.toFixed(1)} pts`, detail(closest));
  }
  return (
    recordCardHtml("Closest Meeting", `${closest.margin.toFixed(1)} pts`, detail(closest)) +
    recordCardHtml("Biggest Blowout", `${blowout.margin.toFixed(1)} pts`, detail(blowout))
  );
}

function renderRivalry(userIdA, userIdB) {
  const content = document.getElementById("rivalry-content");
  if (userIdA === userIdB) {
    content.innerHTML = `<div class="wrap"><div class="empty-state">Pick two different managers.</div></div>`;
    return;
  }
  const mgrA = LEAGUE_STATS.managers.find((m) => m.userId === userIdA);
  const mgrB = LEAGUE_STATS.managers.find((m) => m.userId === userIdB);
  const nameA = escapeHtml(mgrA.username || mgrA.teamName);
  const nameB = escapeHtml(mgrB.username || mgrB.teamName);
  const games = (LEAGUE_STATS.pairGameLog[pairKey(userIdA, userIdB)] || [])
    .slice()
    .sort((x, y) => Number(y.season) - Number(x.season) || y.week - x.week);

  if (!games.length) {
    content.innerHTML = `<div class="wrap"><div class="empty-state">${nameA} and ${nameB} haven't played each other yet.</div></div>`;
    return;
  }

  let winsA = 0,
    winsB = 0,
    ties = 0,
    playoffWinsA = 0,
    playoffWinsB = 0,
    playoffTies = 0;
  let closest = null;
  let blowout = null;

  games.forEach((g) => {
    const aIsA = g.aUserId === userIdA;
    const scoreA = aIsA ? g.aScore : g.bScore;
    const scoreB = aIsA ? g.bScore : g.aScore;
    if (scoreA > scoreB) {
      winsA += 1;
      if (g.isPlayoff) playoffWinsA += 1;
    } else if (scoreB > scoreA) {
      winsB += 1;
      if (g.isPlayoff) playoffWinsB += 1;
    } else {
      ties += 1;
      if (g.isPlayoff) playoffTies += 1;
    }
    const margin = Math.abs(scoreA - scoreB);
    const marginEntry = { margin, season: g.season, week: g.week, isPlayoff: g.isPlayoff };
    if (!closest || margin < closest.margin) closest = marginEntry;
    if (!blowout || margin > blowout.margin) blowout = marginEntry;
  });

  const gameRows = games
    .map((g) => {
      const aIsA = g.aUserId === userIdA;
      const scoreA = aIsA ? g.aScore : g.bScore;
      const scoreB = aIsA ? g.bScore : g.aScore;
      const margin = Math.abs(scoreA - scoreB);
      const isTie = scoreA === scoreB;
      // The winning side's score is bolded gold (same convention the
      // playoff bracket already uses for a winning team), with its
      // margin of victory right alongside it -- enough on its own to
      // read "who won, and by how much" at a glance without needing a
      // separate column repeating the winner's name in text, or having
      // to subtract the two numbers yourself.
      const cellA = isTie
        ? `<td data-label="${nameA}">${scoreA.toFixed(1)}</td>`
        : scoreA > scoreB
        ? `<td data-label="${nameA}" class="rivalry-score-win">${scoreA.toFixed(1)} <span class="rivalry-score-margin">+${margin.toFixed(1)}</span></td>`
        : `<td data-label="${nameA}" class="rivalry-score-loss">${scoreA.toFixed(1)}</td>`;
      const cellB = isTie
        ? `<td data-label="${nameB}">${scoreB.toFixed(1)}</td>`
        : scoreB > scoreA
        ? `<td data-label="${nameB}" class="rivalry-score-win">${scoreB.toFixed(1)} <span class="rivalry-score-margin">+${margin.toFixed(1)}</span></td>`
        : `<td data-label="${nameB}" class="rivalry-score-loss">${scoreB.toFixed(1)}</td>`;
      return `
    <tr>
      <td data-label="Season">${escapeHtml(String(g.season))}</td>
      <td data-label="Week">Wk ${g.week}${g.isPlayoff ? ` <span class="rivalry-playoff-badge">Playoffs</span>` : ""}</td>
      ${cellA}
      ${cellB}
    </tr>`;
    })
    .join("");

  const playoffNote = playoffWinsA + playoffWinsB + playoffTies ? ` · Playoffs: ${playoffWinsA}-${playoffWinsB}${playoffTies ? "-" + playoffTies : ""}` : "";

  content.innerHTML = `
    <div class="wrap"><div class="panel">
      <div class="rivalry-series-score">
        <div class="rivalry-series-name">${nameA}</div>
        <div class="rivalry-series-record">${winsA}-${winsB}${ties ? "-" + ties : ""}</div>
        <div class="rivalry-series-name">${nameB}</div>
      </div>
      <p class="rivalry-series-vs" style="text-align:center;">${games.length} meeting${games.length === 1 ? "" : "s"} all-time${playoffNote}</p>
    </div></div>

    <div class="wrap"><div class="records-grid">
      ${marginCardsHtml(closest, blowout, games.length)}
    </div></div>

    <div class="yard-divider">
      <span class="tick"></span><div class="line"></div>
      <span class="label">Full Game Log</span>
      <div class="line"></div>
    </div>
    <div class="wrap"><div class="panel">
      <div class="heatmap-table-wrap">
        <table class="stat-table responsive-stack">
          <thead><tr><th>Season</th><th>Week</th><th>${nameA}</th><th>${nameB}</th></tr></thead>
          <tbody>${gameRows}</tbody>
        </table>
      </div>
      <p class="heatmap-note">Gold is the winning score each week, with the margin of victory alongside it.</p>
    </div></div>
  `;
}

document.addEventListener("DOMContentLoaded", renderRivalriesPage);
