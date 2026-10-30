let ALL_TRADES = [];

async function renderTradesPage() {
  const errorBox = document.getElementById("trades-error");
  const progressBox = document.getElementById("progress-status");
  const filterBox = document.getElementById("trade-filter");
  const listBox = document.getElementById("trades-list");

  try {
    const [seasonChain, playerDirectory, injuriesData] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(INJURIES_FILE, { players: {} }),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load the league's seasons from Sleeper. Give it a minute and refresh the page.");
    }

    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Trade History";

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    ALL_TRADES = DeepHistory.buildTradeLog(seasonChain, deepSeasons, playerDirectory);
    attachTradeVerdicts(ALL_TRADES, Metrics.analyze(seasonChain, deepSeasons, playerDirectory, injuriesData));

    document.getElementById("sb-title").textContent = `${ALL_TRADES.length} Trade${ALL_TRADES.length === 1 ? "" : "s"}`;
    document.getElementById("sb-sub").textContent = ALL_TRADES.length
      ? "Every trade in league history, most recent first"
      : "No trades yet";

    if (ALL_TRADES.length) {
      filterBox.style.display = "flex";
      filterBox.innerHTML = renderFilterPills("all");
      renderList("all");
    } else {
      listBox.innerHTML = `<div class="empty-state">No trades recorded yet — check back once your league starts wheeling and dealing.</div>`;
    }
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load trade history — " + err.message;
    errorBox.style.display = "block";
  }
}

function tradeSeasons() {
  return [...new Set(ALL_TRADES.map((t) => t.season))].sort((a, b) => Number(b) - Number(a));
}

function renderFilterPills(activeKey) {
  const allPill = `<a href="#" class="season-pill ${activeKey === "all" ? "active" : ""}" data-key="all">ALL</a>`;
  const seasonPills = tradeSeasons()
    .map((s) => `<a href="#" class="season-pill ${String(activeKey) === String(s) ? "active" : ""}" data-key="${escapeHtml(String(s))}">${escapeHtml(String(s))}</a>`)
    .join("");
  return allPill + seasonPills;
}

// Each trade gets its verdict from Metrics: what the trade did to each roster's
// best possible lineup from the trade on (the roster as it was against the roster
// without the players it received and with the ones it sent), plus FAAB at the
// league's own dollars-to-points rate. A trade in a season still being played is
// "Pending".
function attachTradeVerdicts(trades, analysis) {
  const byId = new Map();
  analysis.contexts.forEach((ctx) => analysis.trades(ctx.season).forEach((t) => byId.set(String(t.transactionId), t)));
  trades.forEach((trade) => {
    const verdict = byId.get(String(trade.transactionId));
    if (!verdict) return;
    trade.verdict = verdict;
    trade.teams.forEach((team) => {
      team.verdict = verdict.sides.find((x) => x.rosterId === team.rosterId) || null;
    });
  });
}

function tradePlayerLine(p, verdict) {
  const detail = verdict ? verdict.receivedDetail.find((d) => d.playerId === p.playerId) : null;
  const tail = detail
    ? ` <span class="muted-inline">· ${detail.par >= 0 ? "+" : ""}${detail.par.toFixed(0)} pts above replacement</span>`
    : p.vbd != null
      ? ` <span class="muted-inline">· ${p.vbd >= 0 ? "+" : ""}${p.vbd.toFixed(1)} VBD</span>`
      : "";
  return `<li>${playerLinkHtml(p.playerId, playerPhotoHtml(p.playerId, p.name, "player-photo-xs"))}<span>${playerLinkHtml(p.playerId, escapeHtml(p.name))}${
    p.position ? ` <span class="muted-inline">(${escapeHtml(p.position)})</span>` : ""
  }${tail}</span></li>`;
}

// The verdict line for one side of a trade: net wins, and what it is made of.
function tradeVerdictHtml(team, trade) {
  const v = team.verdict;
  if (!v) return "";
  if (trade.verdict.pending) return `<div class="trade-verdict pending">Pending <span class="muted-inline">· graded when the season ends</span></div>`;
  const sign = (n, d) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}`;
  const cls = v.wins > 0.005 ? "up" : v.wins < -0.005 ? "down" : "flat";
  const parts = [`lineup ${sign(v.lineupPoints, 1)} pts`];
  if (v.faabNet) parts.push(`FAAB ${v.faabNet > 0 ? "+" : "−"}$${Math.abs(v.faabNet)} (${sign(v.faabPoints, 1)} pts)`);
  return `<div class="trade-verdict ${cls}"><span class="trade-net">${sign(v.wins, 2)} W</span><span class="muted-inline">${parts.join(" · ")}${v.startedWeeks ? ` · started ${v.startedWeeks} wk` : ""}</span></div>`;
}

function renderTradeCard(trade) {
  const sides = trade.teams
    .map((t) => {
      const items = [
        ...t.received.players.map((p) => tradePlayerLine(p, t.verdict)),
        ...t.received.picks.map((p) => `<li>${escapeHtml(p)} pick</li>`),
        ...(t.received.faab ? [`<li>$${t.received.faab} FAAB</li>`] : []),
      ].join("");
      return `
      <div class="trade-side">
        <div class="trade-team-name">${escapeHtml(t.info.username || t.info.teamName)}</div>
        <div class="trade-received-label">Received</div>
        <ul class="trade-item-list">${items || "<li>—</li>"}</ul>
        ${tradeVerdictHtml(t, trade)}
      </div>`;
    })
    .join(`<div class="trade-arrow">⇄</div>`);

  return `
    <div class="trade-card">
      <div class="trade-meta">${escapeHtml(String(trade.season))} · Week ${trade.week}</div>
      <div class="trade-sides">${sides}</div>
    </div>`;
}

function renderList(filterKey) {
  const filtered = filterKey === "all" ? ALL_TRADES : ALL_TRADES.filter((t) => String(t.season) === String(filterKey));
  const listBox = document.getElementById("trades-list");
  listBox.innerHTML = filtered.length
    ? filtered.map(renderTradeCard).join("")
    : `<div class="empty-state">No trades for this season.</div>`;
}

document.getElementById("trade-filter").addEventListener("click", (e) => {
  const pill = e.target.closest(".season-pill");
  if (!pill) return;
  e.preventDefault();
  const key = pill.dataset.key;
  document.getElementById("trade-filter").innerHTML = renderFilterPills(key);
  renderList(key);
});

document.addEventListener("DOMContentLoaded", renderTradesPage);
