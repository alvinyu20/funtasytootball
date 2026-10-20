/*
  ============================================================
  RECORDS PAGE
  ============================================================
  The Record Book: a landing page with six categories, a category page
  listing every record in it (holder + value, click a row for the top 10),
  and a season filter — All seasons, Last 3 seasons, or any single season.

  All the math lives in record-book.js / record-defs.js. This file is the
  view: pure HTML builders (rb*Html, rbParseRoute — unit-tested without a
  browser) plus renderRecords(), the controller that loads the league's
  data, then draws whichever view the URL hash asks for:

    #                      landing (the six categories)
    #careers               Careers, all seasons
    #careers/last3         Careers, last three seasons
    #careers/2024          Careers, 2024 only

  The landing page needs nothing but the static record definitions, so it
  draws immediately while the league data loads behind it.
*/

const RB_ICONS = {
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/>',
  medal: '<circle cx="12" cy="9" r="5"/><path d="M8.5 13.5L7 21l5-3 5 3-1.5-7.5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 .3 1.5 1 2 2 2-.5-3 0-6 1-8z"/>',
  gauge: '<path d="M4 17a8 8 0 1116 0"/><path d="M12 17l4-5"/><circle cx="12" cy="17" r="1"/>',
};

function rbIcon(name) {
  return `<svg class="rb-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RB_ICONS[name] || ""}</svg>`;
}

// ---------------------------------------------------------------
// Routing — "#category" or "#category/era"
// ---------------------------------------------------------------
function rbParseRoute(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const [category, era] = raw.split("/");
  const known = RecordBook.CATEGORIES.some((c) => c.id === category);
  return { category: known ? category : null, era: era || "all" };
}

function rbRouteHash(category, era) {
  if (!category) return "#";
  return `#${category}${era && era !== "all" ? "/" + era : ""}`;
}

function rbPlural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------
// Landing
// ---------------------------------------------------------------
function rbLandingHtml(counts, era) {
  return `
    <div class="rb-landing">
      ${RecordBook.CATEGORIES.map(
        (c) => `
      <a class="rb-cat" href="${rbRouteHash(c.id, era)}">
        <span class="rb-cat-icon">${rbIcon(c.icon)}</span>
        <span class="rb-cat-body">
          <span class="rb-cat-title">${escapeHtml(c.title)}</span>
          <span class="rb-cat-blurb">${escapeHtml(c.blurb)}</span>
        </span>
        <span class="rb-cat-count">${rbPlural(counts[c.id] || 0, "record")}</span>
        <span class="rb-cat-arrow" aria-hidden="true">→</span>
      </a>`
      ).join("")}
    </div>`;
}

// ---------------------------------------------------------------
// Category page
// ---------------------------------------------------------------
function rbEraPillsHtml(categoryId, eras, activeEra) {
  return `
    <div class="season-pills rb-eras" role="group" aria-label="Season filter">
      ${eras
        .map(
          (e) =>
            `<a class="season-pill${e.id === activeEra ? " active" : ""}" href="${rbRouteHash(categoryId, e.id)}"${e.id === activeEra ? ' aria-current="true"' : ""}>${escapeHtml(e.label)}</a>`
        )
        .join("")}
    </div>`;
}

function rbHolderHtml(entry, result) {
  const name = playerLinkHtml(entry.playerId, escapeHtml(entry.name));
  const tied = result.tied > 0 ? ` <span class="rb-tied">+${result.tied} tied</span>` : "";
  return `<span class="rb-holder-name">${name}${tied}</span>${entry.detail ? `<span class="rb-holder-detail">${escapeHtml(entry.detail)}</span>` : ""}`;
}

function rbTopListHtml(result) {
  // Entries that share a rank show it as "T2" so a tie is never mistaken
  // for a gap in the ordering.
  const shared = new Map();
  result.entries.forEach((e) => shared.set(e.rank, (shared.get(e.rank) || 0) + 1));
  return `
    <ol class="rb-top">
      ${result.entries
        .map(
          (e) => `
      <li>
        <span class="rb-top-rank">${shared.get(e.rank) > 1 ? "T" : ""}${e.rank}</span>
        <span class="rb-top-who">
          <span class="rb-top-name">${playerLinkHtml(e.playerId, escapeHtml(e.name))}</span>
          ${e.detail ? `<span class="rb-top-detail">${escapeHtml(e.detail)}</span>` : ""}
        </span>
        <span class="rb-top-value">${escapeHtml(e.valueText)}</span>
      </li>`
        )
        .join("")}
    </ol>`;
}

// `locked` is the text to show when the record has nothing yet because the
// season it needs is still running — or just `true` for the regular-season wording.
function rbRowHtml(def, result, locked) {
  const low = def.tone === "low" ? " rb-low" : "";
  const record = `
    <span class="rb-cell rb-record">
      <span class="rb-title">${escapeHtml(def.title)}</span>
      <span class="rb-desc">${escapeHtml(def.desc || "")}</span>
    </span>`;

  if (result.status !== "ok") {
    const lockText = typeof locked === "string" ? locked : locked ? "Unlocks after the regular season" : "";
    const label = result.status === "pending" ? "Awaiting data" : lockText || "No qualifying entries";
    return `
    <div class="rb-row rb-static${low}" data-record="${escapeHtml(def.id)}">
      <div class="rb-summary">
        ${record}
        <span class="rb-cell rb-holder rb-muted">${label}</span>
        <span class="rb-cell rb-value rb-muted">—</span>
        <span class="rb-chev" aria-hidden="true"></span>
      </div>
    </div>`;
  }

  const lead = result.headline
    ? { name: result.headline.name, playerId: null, detail: result.headline.detail || "", valueText: result.headline.valueText }
    : result.entries[0];
  const holderResult = result.headline ? { tied: 0 } : result;
  return `
    <details class="rb-row${low}" data-record="${escapeHtml(def.id)}">
      <summary class="rb-summary">
        ${record}
        <span class="rb-cell rb-holder">${rbHolderHtml(lead, holderResult)}</span>
        <span class="rb-cell rb-value">${escapeHtml(lead.valueText)}</span>
        <span class="rb-chev" aria-hidden="true"></span>
      </summary>
      <div class="rb-expand">
        ${rbTopListHtml(result)}
        ${result.note ? `<p class="rb-note">${escapeHtml(result.note)}</p>` : ""}
      </div>
    </details>`;
}

function rbEraSummary(seasons) {
  if (!seasons.length) return "";
  return seasons.length === 1 ? seasons[0] : `${seasons[0]}–${seasons[seasons.length - 1]}`;
}

// Which of the selected seasons are still being played, as the page needs it.
// "Regular season over" unlocks single-season records; "season over" (champion
// crowned) is what the Draft records wait for.
function rbSeasonFlags(facts, ctx) {
  const picked = facts.seasons.filter((s) => ctx.seasonSet.has(s.season));
  return {
    hasPartialSeason: picked.some((s) => !s.regularComplete),
    noCompleteSeason: picked.every((s) => !s.regularComplete),
    hasUnfinishedSeason: picked.some((s) => !s.complete),
    noFinishedSeason: picked.every((s) => !s.complete),
  };
}

function rbCategoryHtml(opts) {
  const { category, sections, eras, era, seasons, hasPartialSeason, rawPending, noCompleteSeason, hasUnfinishedSeason, noFinishedSeason } = opts;
  const preSleeper = opts.preSleeper || [];
  const total = sections.reduce((n, s) => n + s.records.length, 0);

  const notices = [];
  if (hasPartialSeason) {
    notices.push("The current season is still in progress. It counts toward career totals, streaks and weekly records, but single-season records unlock once its regular season ends.");
  }
  const hasDraftRecords = sections.some((sec) => sec.records.some((r) => r.def.needsFinishedSeason));
  if (hasDraftRecords && hasUnfinishedSeason) {
    notices.push("Draft records leave out the current season’s draft until that season is over — a pick can’t be judged before its player has played the whole year.");
  }
  if (preSleeper.length) {
    notices.push(
      `Pre-Sleeper seasons (${rbEraSummary(preSleeper)}) count wherever season totals are enough: wins, points, playoffs, titles and Overall Record where it was kept (2017 on). Records built on weekly scores, such as high-score weeks and schedule strength, cover the Sleeper era only.`
    );
  }
  if (rawPending) {
    notices.push("The Team Raw Stats records are waiting on data — run the “Build Team Raw Stats” workflow once (GitHub → Actions → Run workflow) and they fill in.");
  }

  return `
    <div class="rb-category">
      <a class="rb-back" href="#">← Record Book</a>
      <header class="rb-cat-head">
        <span class="rb-cat-icon rb-cat-icon-lg">${rbIcon(category.icon)}</span>
        <div>
          <h2 class="rb-cat-heading">${escapeHtml(category.title)}</h2>
          <p class="rb-cat-sub">${escapeHtml(category.blurb)}</p>
        </div>
        <span class="rb-cat-count">${rbPlural(total, "record")}</span>
      </header>
      ${rbEraPillsHtml(category.id, eras, era)}
      <p class="rb-era-line">Showing <strong>${escapeHtml(rbEraSummary(seasons))}</strong> · tap a record for its top 10</p>
      ${notices.map((n) => `<p class="rb-banner">${escapeHtml(n)}</p>`).join("")}
      <div class="rb-colhead" aria-hidden="true">
        <span>Record</span><span>Record Holder</span><span>Record Value</span><span></span>
      </div>
      ${sections
        .map(
          (s) => `
      <section class="rb-section">
        <h3 class="rb-section-head"><span>${escapeHtml(s.title)}</span><span class="rb-section-count">${rbPlural(s.records.length, "record")}</span></h3>
        <div class="rb-rows">
          ${s.records
            .map((r) => rbRowHtml(r.def, r.result, r.def.needsFinishedSeason ? noFinishedSeason && "Unlocks after the season ends" : noCompleteSeason))
            .join("")}
        </div>
      </section>`
        )
        .join("")}
    </div>`;
}

// ---------------------------------------------------------------
// Controller
// ---------------------------------------------------------------
const RB_STATE = {
  facts: null,
  loadError: null,
  contexts: new Map(),
  categories: new Map(),
  shownCategory: undefined,
};

// Careers and Seasons include the pre-Sleeper seasons (they only need season
// totals); every other category needs weekly detail, so it is Sleeper-only.
function rbContext(eraId, sleeperOnly) {
  const key = `${eraId}|${sleeperOnly ? "s" : "h"}`;
  if (!RB_STATE.contexts.has(key)) RB_STATE.contexts.set(key, RecordBook.context(RB_STATE.facts, eraId, sleeperOnly));
  return RB_STATE.contexts.get(key);
}

function rbCategoryData(categoryId, eraId, sleeperOnly) {
  const key = `${categoryId}|${eraId}`;
  if (!RB_STATE.categories.has(key)) {
    RB_STATE.categories.set(key, RecordBook.computeCategory(categoryId, rbContext(eraId, sleeperOnly)));
  }
  return RB_STATE.categories.get(key);
}

function rbRenderView() {
  const root = document.getElementById("records-root");
  if (!root) return;
  const route = rbParseRoute(location.hash);
  const counts = RecordBook.countByCategory();

  if (!route.category) {
    root.innerHTML = rbLandingHtml(counts, "all");
    RB_STATE.shownCategory = null;
    return;
  }

  if (RB_STATE.loadError) {
    root.innerHTML = `<div class="error-state">Couldn't load league records — ${escapeHtml(RB_STATE.loadError)}</div>`;
    return;
  }
  if (!RB_STATE.facts) {
    root.innerHTML = `<div class="loading">Crunching every season's scores, drafts, and transactions…</div>`;
    return;
  }

  const facts = RB_STATE.facts;
  const category = RecordBook.CATEGORIES.find((c) => c.id === route.category);
  const sleeperOnly = !category.history;
  const eras = RecordBook.eras(facts, sleeperOnly);
  const era = eras.some((e) => e.id === route.era) ? route.era : "all";
  const sections = rbCategoryData(category.id, era, sleeperOnly);
  const ctx = rbContext(era, sleeperOnly);
  const preSleeper = facts.seasons.filter((s) => s.source === "espn" && ctx.seasonSet.has(s.season)).map((s) => s.season);
  const rawPending = sections.some((s) => s.records.some((r) => r.result.status === "pending"));

  root.innerHTML = rbCategoryHtml({ category, sections, eras, era, seasons: ctx.seasons, rawPending, preSleeper, ...rbSeasonFlags(facts, ctx) });
  initAnimatedDropdowns();

  // Opening a different category starts at the top; switching the season
  // filter inside one keeps the visitor's place.
  if (RB_STATE.shownCategory !== category.id && typeof window !== "undefined" && window && window.scrollTo) {
    window.scrollTo(0, 0);
  }
  RB_STATE.shownCategory = category.id;
}

async function renderRecords() {
  const errorBox = document.getElementById("records-error");
  const progressBox = document.getElementById("progress-status");

  // The landing page only needs the static record definitions, so it is
  // on screen straight away while the league data loads.
  rbRenderView();
  if (typeof window !== "undefined" && window && window.addEventListener) {
    window.addEventListener("hashchange", rbRenderView);
  }

  try {
    const [seasonChain, playerDirectory, rawStats, manual, powerRanks] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
      fetchJsonSafe(TEAM_RAW_STATS_FILE, null),
      fetchJsonSafe(MANUAL_HISTORY_FILE, null),
      fetchJsonSafe(POWER_RANK_CSV_HISTORY_FILE, null),
    ]);

    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Records";

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    const stats = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);
    // The Sleeper era has weekly scores, lineups, transactions and drafts;
    // the pre-Sleeper (ESPN) seasons in manual-history.json only have season
    // totals, so only Careers and Seasons use them (see rbContext).
    RB_STATE.facts = RecordBook.buildFacts({ seasonChain, deepSeasons, playerDirectory, stats, rawStats, manual, powerRanks });

    const seasons = RB_STATE.facts.seasons.map((s) => s.season);
    const total = RecordBook.DEFS.length;
    document.getElementById("sb-sub").textContent = seasons.length
      ? `${rbPlural(total, "record")} · ${rbEraSummary(seasons)} · ${rbPlural(seasons.length, "season")} of league history`
      : "No scored weeks yet";
    rbRenderView();
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    RB_STATE.loadError = err.message;
    errorBox.textContent = "Couldn't load league records — " + err.message;
    errorBox.style.display = "block";
    rbRenderView();
  }
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", renderRecords);
}
