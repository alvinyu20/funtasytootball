async function renderRecords() {
  const errorBox = document.getElementById("records-error");
  const progressBox = document.getElementById("progress-status");
  const grid = document.getElementById("records-grid");

  try {
    const [seasonChain, playerDirectory] = await Promise.all([
      SleeperAPI.getSeasonChain(LEAGUE_ID),
      SleeperAPI.getPlayerDirectory(),
    ]);

    if (seasonChain.length === 0) {
      throw new Error("Couldn't load any seasons. Double-check LEAGUE_ID in js/config.js.");
    }

    const latest = seasonChain[seasonChain.length - 1].league;
    document.title = (SITE_TITLE || latest.name || "League") + " — Records";
    document.getElementById("sb-sub").textContent = `${seasonChain.length} season${seasonChain.length === 1 ? "" : "s"} of history`;

    progressBox.style.display = "block";
    const deepSeasons = await DeepHistory.buildAll(seasonChain, (season, status) => {
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : status === "archived" ? `${season} loaded from backup…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    const stats = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);
    grid.innerHTML = buildRecordCards(stats);
    initScrollAnimations();
    // Every other expandable panel on the site (lineups, draft picks,
    // bracket games) animates its open/close via this same generic
    // <details> handler — this page just never called it, which is why
    // its Top 5 disclosures snapped open/closed instead of easing like
    // everywhere else.
    initAnimatedDropdowns();
  } catch (err) {
    console.error(err);
    progressBox.style.display = "none";
    errorBox.textContent = "Couldn't load league records — " + err.message;
    errorBox.style.display = "block";
  }
}

function card(label, value, detail, badge) {
  return `
    <div class="record-card">
      <p class="record-label">${escapeHtml(label)}${badge ? ` ${badge}` : ""}</p>
      <p class="record-value" data-count-up>${value}</p>
      ${detail ? `<p class="record-detail">${detail}</p>` : ""}
    </div>`;
}

// Lightweight category dividers woven through the records grid. Mostly
// matters on mobile, where 17+ cards stack into one long undifferentiated
// list — a heading every few cards gives a visitor something to scan for
// instead of reading the whole page top to bottom to find, say, the draft
// records. Spans the full grid width (see .records-group-label in
// styles.css) so it reads fine on the desktop 4-column grid too, not just
// when stacked.
// Cards are pushed in a fixed, deliberately-grouped order already (see
// buildRecordCards below), so this only needs to know which group starts
// at which push — not track membership card-by-card.
function groupLabel(text) {
  return `<h3 class="records-group-label">${escapeHtml(text)}</h3>`;
}

// A small generic table for a category's top 5 — #, Team/Player, Detail
// (season/week/context), Value (the headline stat). Every category's
// rows get shaped into this same {name, detail, value} form before
// reaching here (see TOP5_ROW_FORMATTERS below), so this one table
// layout covers all of them rather than needing bespoke columns per
// category.
function top5Table(rows) {
  return `
    <div class="record-top5">
      <table class="stat-table compact-mobile">
        <thead><tr><th>#</th><th>Team / Player</th><th>Detail</th><th>Value</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r, i) => `
          <tr>
            <td class="rank" data-label="#">${i + 1}</td>
            <td class="team-cell" data-label="Team / Player">${playerLinkHtml(r.playerId, escapeHtml(r.name))}</td>
            <td data-label="Detail">${escapeHtml(r.detail)}</td>
            <td data-label="Value">${escapeHtml(r.value)}</td>
          </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

// Same as card(), but expandable (click/tap anywhere on the panel) to
// reveal a Top 5 table for that category — same <details>/<summary>
// pattern season.js's expandableRecordCard already uses for revealing a
// matchup's lineup, so it gets the same native, keyboard-accessible
// disclosure behavior for free. Falls back to a plain card when there
// isn't more than the #1 entry to show (nothing meaningful to expand).
function expandableCard(label, value, detail, badge, top5Rows) {
  if (!top5Rows || top5Rows.length < 2) return card(label, value, detail, badge);
  return `
    <details class="record-card record-card-expandable top5">
      <summary>
        <span class="record-label">${escapeHtml(label)}${badge ? ` ${badge}` : ""}</span>
        <span class="record-value" data-count-up>${value}</span>
        ${detail ? `<span class="record-detail">${detail}</span>` : ""}
      </summary>
      ${top5Table(top5Rows)}
    </details>`;
}

// Turns one raw top5Records[key] entry into the generic {name, detail,
// value} row shape top5Table renders — one formatter per category,
// matching the wording each category's single-value card already uses
// above, just split into separate columns instead of one detail string.
const TOP5_ROW_FORMATTERS = {
  highestWeekScore: (x) => ({ name: x.teamName, detail: `${x.season} Wk ${x.week}`, value: `${x.points.toFixed(1)} pts` }),
  lowestWeekScore: (x) => ({ name: x.teamName, detail: `${x.season} Wk ${x.week}`, value: `${x.points.toFixed(1)} pts` }),
  biggestBlowout: (x) => ({ name: `${x.winner} over ${x.loser}`, detail: `${x.season} Wk ${x.week}`, value: `${x.margin.toFixed(1)} pts` }),
  closestGame: (x) => ({ name: `${x.winner} over ${x.loser}`, detail: `${x.season} Wk ${x.week}`, value: `${x.margin.toFixed(2)} pts` }),
  longestWinStreak: (x) => ({ name: x.teamName, detail: `through ${x.end.season} Wk ${x.end.week}`, value: `${x.length} games` }),
  longestLoseStreak: (x) => ({ name: x.teamName, detail: `through ${x.end.season} Wk ${x.end.week}`, value: `${x.length} games` }),
  bestValuePick: (x) => ({
    name: x.player,
    playerId: x.playerId,
    detail: `${x.round}.${x.pickInRound} by ${x.username || x.teamName} (${x.season})`,
    value: x.vbd != null ? `+${x.vbd.toFixed(1)} VBD` : `${x.points.toFixed(1)} pts`,
  }),
  worstValuePick: (x) => ({
    name: x.player,
    playerId: x.playerId,
    detail: `${x.round}.${x.pickInRound} by ${x.username || x.teamName} (${x.season})`,
    value: x.vbd != null ? `${x.vbd.toFixed(1)} VBD` : `${x.points.toFixed(1)} pts`,
  }),
  mostTrades: (x) => ({ name: x.teamName, detail: "most trades made", value: `${x.count}` }),
  mostWaiverAdds: (x) => ({ name: x.teamName, detail: "adds off waivers/free agency", value: `${x.count}` }),
  mostBenchPointsLeft: (x) => ({ name: x.teamName, detail: `${x.season} Wk ${x.week}`, value: `${x.left.toFixed(1)} pts left` }),
  mostConsistentSeason: (x) => ({ name: x.teamName, detail: `${x.season}`, value: `±${x.stdDev.toFixed(1)} pts` }),
  leastConsistentSeason: (x) => ({ name: x.teamName, detail: `${x.season}`, value: `±${x.stdDev.toFixed(1)} pts` }),
  toughestSchedule: (x) => ({ name: x.teamName, detail: `${x.season} · avg. opponent score`, value: `${x.avgOpponentPF.toFixed(1)} PPG` }),
  easiestSchedule: (x) => ({ name: x.teamName, detail: `${x.season} · avg. opponent score`, value: `${x.avgOpponentPF.toFixed(1)} PPG` }),
};

function top5RowsFor(stats, recordKey) {
  const formatter = TOP5_ROW_FORMATTERS[recordKey];
  const list = stats.top5Records && stats.top5Records[recordKey];
  if (!formatter || !list) return null;
  return list.map(formatter);
}

function buildRecordCards(stats) {
  const r = stats.records;
  const cards = [];
  // Lazily flushes a pending group label the first time a card in that
  // group actually gets pushed — so a group with every one of its cards
  // conditionally skipped (e.g. no trades logged yet) never leaves an
  // orphaned heading with nothing under it.
  let pendingLabel = null;
  const startGroup = (name) => { pendingLabel = name; };
  const push = (html) => {
    if (pendingLabel) { cards.push(groupLabel(pendingLabel)); pendingLabel = null; }
    cards.push(html);
  };

  startGroup("Scoring & Matchups");
  if (r.highestWeekScore) {
    const x = r.highestWeekScore;
    push(expandableCard("Highest Single-Week Score", x.points.toFixed(1), `${escapeHtml(x.teamName)} · ${x.season} Wk ${x.week}`, null, top5RowsFor(stats, "highestWeekScore")));
  }
  if (r.lowestWeekScore) {
    const x = r.lowestWeekScore;
    push(expandableCard("Lowest Single-Week Score", x.points.toFixed(1), `${escapeHtml(x.teamName)} · ${x.season} Wk ${x.week}`, null, top5RowsFor(stats, "lowestWeekScore")));
  }
  if (r.biggestBlowout) {
    const x = r.biggestBlowout;
    push(
      expandableCard(
        "Biggest Blowout",
        `${x.margin.toFixed(1)} pts`,
        `${escapeHtml(x.winner)} over ${escapeHtml(x.loser)} · ${x.season} Wk ${x.week}`,
        null,
        top5RowsFor(stats, "biggestBlowout")
      )
    );
  }
  if (r.closestGame) {
    const x = r.closestGame;
    push(
      expandableCard(
        "Closest Game",
        `${x.margin.toFixed(2)} pts`,
        `${escapeHtml(x.winner)} over ${escapeHtml(x.loser)} · ${x.season} Wk ${x.week}`,
        null,
        top5RowsFor(stats, "closestGame")
      )
    );
  }
  startGroup("Streaks");
  if (r.longestWinStreak) {
    const x = r.longestWinStreak;
    push(
      expandableCard("Longest Win Streak", `${x.length} games`, `${escapeHtml(x.teamName)} · through ${x.end.season} Wk ${x.end.week}`, null, top5RowsFor(stats, "longestWinStreak"))
    );
  }
  if (r.longestLoseStreak) {
    const x = r.longestLoseStreak;
    push(
      expandableCard(
        "Longest Losing Streak",
        `${x.length} games`,
        `${escapeHtml(x.teamName)} · through ${x.end.season} Wk ${x.end.week}`,
        null,
        top5RowsFor(stats, "longestLoseStreak")
      )
    );
  }
  startGroup("Draft");
  if (r.bestValuePick) {
    const x = r.bestValuePick;
    push(
      expandableCard(
        "Best Late-Round Steal",
        playerLinkHtml(x.playerId, escapeHtml(x.player)),
        `${x.round}.${x.pickInRound} by ${escapeHtml(x.username || x.teamName)} · ${x.points.toFixed(1)} pts${x.vbd != null ? ` · +${x.vbd.toFixed(1)} VBD` : ""} (${x.season})`,
        gradeBadgeHtml(x.grade),
        top5RowsFor(stats, "bestValuePick")
      )
    );
  }
  if (r.worstValuePick) {
    const x = r.worstValuePick;
    push(
      expandableCard(
        "Biggest Draft Bust",
        playerLinkHtml(x.playerId, escapeHtml(x.player)),
        `${x.round}.${x.pickInRound} by ${escapeHtml(x.username || x.teamName)} · ${x.points.toFixed(1)} pts${x.vbd != null ? ` · ${x.vbd.toFixed(1)} VBD` : ""} (${x.season})`,
        gradeBadgeHtml(x.grade),
        top5RowsFor(stats, "worstValuePick")
      )
    );
  }
  startGroup("Roster Management");
  if (r.mostTrades) {
    push(expandableCard("Trade Machine", `${r.mostTrades.count}`, `${escapeHtml(r.mostTrades.teamName)} · most trades made`, null, top5RowsFor(stats, "mostTrades")));
  }
  if (r.mostWaiverAdds) {
    push(
      expandableCard(
        "Waiver Wire Warrior",
        `${r.mostWaiverAdds.count}`,
        `${escapeHtml(r.mostWaiverAdds.teamName)} · most adds off waivers/free agency`,
        null,
        top5RowsFor(stats, "mostWaiverAdds")
      )
    );
  }
  if (r.mostBenchPointsLeft) {
    const x = r.mostBenchPointsLeft;
    push(
      expandableCard(
        "Biggest Bench Blunder",
        `${x.left.toFixed(1)} pts left on bench`,
        `${escapeHtml(x.teamName)} scored ${x.actual.toFixed(1)} of a possible ${x.optimal.toFixed(1)} · ${x.season} Wk ${x.week}`,
        null,
        top5RowsFor(stats, "mostBenchPointsLeft")
      )
    );
  }
  startGroup("Consistency");
  if (r.mostConsistentSeason) {
    const x = r.mostConsistentSeason;
    push(
      expandableCard("Mr. Reliable", `±${x.stdDev.toFixed(1)} pts`, `${escapeHtml(x.teamName)} · ${x.season} · lowest weekly score variance`, null, top5RowsFor(stats, "mostConsistentSeason"))
    );
  }
  if (r.leastConsistentSeason) {
    const x = r.leastConsistentSeason;
    push(
      expandableCard(
        "Feast Or Famine",
        `±${x.stdDev.toFixed(1)} pts`,
        `${escapeHtml(x.teamName)} · ${x.season} · highest weekly score variance`,
        null,
        top5RowsFor(stats, "leastConsistentSeason")
      )
    );
  }
  startGroup("Schedule");
  if (r.toughestSchedule) {
    const x = r.toughestSchedule;
    push(
      expandableCard(
        "Toughest Schedule",
        `${x.avgOpponentPF.toFixed(1)} PPG faced`,
        `${escapeHtml(x.teamName)} · ${x.season} · avg. regular-season opponent score`,
        null,
        top5RowsFor(stats, "toughestSchedule")
      )
    );
  }
  if (r.easiestSchedule) {
    const x = r.easiestSchedule;
    push(
      expandableCard(
        "Easiest Schedule",
        `${x.avgOpponentPF.toFixed(1)} PPG faced`,
        `${escapeHtml(x.teamName)} · ${x.season} · average opponent score`,
        null,
        top5RowsFor(stats, "easiestSchedule")
      )
    );
  }

  startGroup("Career & All-Time");
  // A few extra cards computed straight from career totals, no extra fetch needed.
  if (stats.managers.length) {
    const byChamps = [...stats.managers].sort((a, b) => b.championships - a.championships);
    if (byChamps[0].championships > 0) {
      push(
        expandableCard(
          "Most Championships",
          `${byChamps[0].championships}`,
          escapeHtml(byChamps[0].teamName),
          null,
          byChamps
            .filter((m) => m.championships > 0)
            .slice(0, 5)
            .map((m) => ({ name: m.teamName, detail: "championships", value: `${m.championships}` }))
        )
      );
    }

    const winPctOf = (m) => m.careerWins / (m.careerWins + m.careerLosses + m.careerTies || 1);
    const byWinPct = [...stats.managers].filter((m) => m.careerWins + m.careerLosses + m.careerTies >= 5).sort((a, b) => winPctOf(b) - winPctOf(a));
    if (byWinPct.length) {
      push(
        expandableCard(
          "Best All-Time Win %",
          `${(winPctOf(byWinPct[0]) * 100).toFixed(1)}%`,
          escapeHtml(byWinPct[0].teamName),
          null,
          byWinPct.slice(0, 5).map((m) => ({ name: m.teamName, detail: "career win %", value: `${(winPctOf(m) * 100).toFixed(1)}%` }))
        )
      );
    }

    const byCareerPF = [...stats.managers].sort((a, b) => b.careerPF - a.careerPF);
    push(
      expandableCard(
        "Most Career Points",
        byCareerPF[0].careerPF.toFixed(1),
        escapeHtml(byCareerPF[0].teamName),
        null,
        byCareerPF.slice(0, 5).map((m) => ({ name: m.teamName, detail: "career points for", value: m.careerPF.toFixed(1) }))
      )
    );

    const byBenchWaste = [...stats.managers].sort((a, b) => b.careerBenchPointsLeft - a.careerBenchPointsLeft);
    if (byBenchWaste[0] && byBenchWaste[0].careerBenchPointsLeft > 0) {
      push(
        expandableCard(
          "Career Bench Waste",
          byBenchWaste[0].careerBenchPointsLeft.toFixed(1),
          `${escapeHtml(byBenchWaste[0].teamName)} · total points left on the bench, all-time`,
          null,
          byBenchWaste
            .filter((m) => m.careerBenchPointsLeft > 0)
            .slice(0, 5)
            .map((m) => ({ name: m.teamName, detail: "career points left on bench", value: m.careerBenchPointsLeft.toFixed(1) }))
        )
      );
    }
  }

  return cards.join("") || `<div class="empty-state">Not enough completed games yet to crown any records.</div>`;
}

document.addEventListener("DOMContentLoaded", renderRecords);
