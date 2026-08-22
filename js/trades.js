let ALL_TRADES = [];

async function renderTradesPage() {
  const errorBox = document.getElementById("trades-error");
  const progressBox = document.getElementById("progress-status");
  const filterBox = document.getElementById("trade-filter");
  const listBox = document.getElementById("trades-list");

  try {
    const [seasonChain, playerDirectory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
    ]);
    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Trade History";

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    ALL_TRADES = DeepHistory.buildTradeLog(seasonChain, deepSeasons, playerDirectory);

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

function tradePlayerLine(p) {
  return `<li>${playerPhotoHtml(p.playerId, p.name, "player-photo-xs")}<span>${escapeHtml(p.name)}${
    p.position ? ` <span class="muted-inline">(${escapeHtml(p.position)})</span>` : ""
  }${p.vbd != null ? ` <span class="muted-inline">· ${p.vbd >= 0 ? "+" : ""}${p.vbd.toFixed(1)} VBD</span>` : ""}</span></li>`;
}

function renderTradeCard(trade) {
  const sides = trade.teams
    .map((t) => {
      const items = [
        ...t.received.players.map(tradePlayerLine),
        ...t.received.picks.map((p) => `<li>${escapeHtml(p)} pick</li>`),
        ...(t.received.faab ? [`<li>$${t.received.faab} FAAB</li>`] : []),
      ].join("");
      return `
      <div class="trade-side">
        <div class="trade-team-name">${escapeHtml(t.info.username || t.info.teamName)}</div>
        <div class="trade-received-label">Received</div>
        <ul class="trade-item-list">${items || "<li>—</li>"}</ul>
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
