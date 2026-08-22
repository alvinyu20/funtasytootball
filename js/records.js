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
      progressBox.textContent = status === "cached" ? `${season} loaded from cache…` : `Fetching ${season}…`;
    });
    progressBox.style.display = "none";

    const stats = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);
    grid.innerHTML = buildRecordCards(stats);
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
      <p class="record-value">${value}</p>
      ${detail ? `<p class="record-detail">${detail}</p>` : ""}
    </div>`;
}

function buildRecordCards(stats) {
  const r = stats.records;
  const cards = [];

  if (r.highestWeekScore) {
    const x = r.highestWeekScore;
    cards.push(card("Highest Single-Week Score", x.points.toFixed(1), `${escapeHtml(x.teamName)} · ${x.season} Wk ${x.week}`));
  }
  if (r.lowestWeekScore) {
    const x = r.lowestWeekScore;
    cards.push(card("Lowest Single-Week Score", x.points.toFixed(1), `${escapeHtml(x.teamName)} · ${x.season} Wk ${x.week}`));
  }
  if (r.biggestBlowout) {
    const x = r.biggestBlowout;
    cards.push(card("Biggest Blowout", `${x.margin.toFixed(1)} pts`, `${escapeHtml(x.winner)} over ${escapeHtml(x.loser)} · ${x.season} Wk ${x.week}`));
  }
  if (r.closestGame) {
    const x = r.closestGame;
    cards.push(card("Closest Game", `${x.margin.toFixed(1)} pts`, `${escapeHtml(x.winner)} over ${escapeHtml(x.loser)} · ${x.season} Wk ${x.week}`));
  }
  if (r.longestWinStreak) {
    const x = r.longestWinStreak;
    cards.push(card("Longest Win Streak", `${x.length} games`, `${escapeHtml(x.teamName)} · through ${x.end.season} Wk ${x.end.week}`));
  }
  if (r.longestLoseStreak) {
    const x = r.longestLoseStreak;
    cards.push(card("Longest Losing Streak", `${x.length} games`, `${escapeHtml(x.teamName)} · through ${x.end.season} Wk ${x.end.week}`));
  }
  if (r.bestValuePick) {
    const x = r.bestValuePick;
    cards.push(
      card(
        "Best Late-Round Steal",
        escapeHtml(x.player),
        `Rd ${x.round} Pick ${x.pickNo} by ${escapeHtml(x.username || x.teamName)} · ${x.points.toFixed(1)} pts${x.vbd != null ? ` · +${x.vbd.toFixed(1)} VBD` : ""} (${x.season})`,
        gradeBadgeHtml(x.grade)
      )
    );
  }
  if (r.worstValuePick) {
    const x = r.worstValuePick;
    cards.push(
      card(
        "Biggest Draft Bust",
        escapeHtml(x.player),
        `Rd ${x.round} Pick ${x.pickNo} by ${escapeHtml(x.username || x.teamName)} · ${x.points.toFixed(1)} pts${x.vbd != null ? ` · ${x.vbd.toFixed(1)} VBD` : ""} (${x.season})`,
        gradeBadgeHtml(x.grade)
      )
    );
  }
  if (r.mostTrades) {
    cards.push(card("Trade Machine", `${r.mostTrades.count}`, `${escapeHtml(r.mostTrades.teamName)} · most trades made`));
  }
  if (r.mostWaiverAdds) {
    cards.push(card("Waiver Wire Warrior", `${r.mostWaiverAdds.count}`, `${escapeHtml(r.mostWaiverAdds.teamName)} · most adds off waivers/free agency`));
  }
  if (r.mostBenchPointsLeft) {
    const x = r.mostBenchPointsLeft;
    cards.push(
      card(
        "Biggest Bench Blunder",
        `${x.left.toFixed(1)} pts left on bench`,
        `${escapeHtml(x.teamName)} scored ${x.actual.toFixed(1)} of a possible ${x.optimal.toFixed(1)} · ${x.season} Wk ${x.week}`
      )
    );
  }
  if (r.mostConsistentSeason) {
    const x = r.mostConsistentSeason;
    cards.push(card("Mr. Reliable", `±${x.stdDev.toFixed(1)} pts`, `${escapeHtml(x.teamName)} · ${x.season} · lowest weekly score variance`));
  }
  if (r.leastConsistentSeason) {
    const x = r.leastConsistentSeason;
    cards.push(card("Feast Or Famine", `±${x.stdDev.toFixed(1)} pts`, `${escapeHtml(x.teamName)} · ${x.season} · highest weekly score variance`));
  }
  if (r.toughestSchedule) {
    const x = r.toughestSchedule;
    cards.push(card("Toughest Schedule", `${x.avgOpponentPF.toFixed(1)} PPG faced`, `${escapeHtml(x.teamName)} · ${x.season} · avg. regular-season opponent score`));
  }
  if (r.easiestSchedule) {
    const x = r.easiestSchedule;
    cards.push(card("Easiest Schedule", `${x.avgOpponentPF.toFixed(1)} PPG faced`, `${escapeHtml(x.teamName)} · ${x.season} · average opponent score`));
  }

  // A few extra cards computed straight from career totals, no extra fetch needed.
  if (stats.managers.length) {
    const mostChamps = [...stats.managers].sort((a, b) => b.championships - a.championships)[0];
    if (mostChamps.championships > 0) {
      cards.push(card("Most Championships", `${mostChamps.championships}`, escapeHtml(mostChamps.teamName)));
    }

    const bestWinPct = [...stats.managers]
      .filter((m) => m.careerWins + m.careerLosses + m.careerTies >= 5)
      .sort((a, b) => {
        const pa = a.careerWins / (a.careerWins + a.careerLosses + a.careerTies || 1);
        const pb = b.careerWins / (b.careerWins + b.careerLosses + b.careerTies || 1);
        return pb - pa;
      })[0];
    if (bestWinPct) {
      const pct = (bestWinPct.careerWins / (bestWinPct.careerWins + bestWinPct.careerLosses + bestWinPct.careerTies) * 100).toFixed(1);
      cards.push(card("Best All-Time Win %", `${pct}%`, escapeHtml(bestWinPct.teamName)));
    }

    const mostPoints = [...stats.managers].sort((a, b) => b.careerPF - a.careerPF)[0];
    cards.push(card("Most Career Points", mostPoints.careerPF.toFixed(1), escapeHtml(mostPoints.teamName)));

    const mostCareerBenchWaste = [...stats.managers].sort((a, b) => b.careerBenchPointsLeft - a.careerBenchPointsLeft)[0];
    if (mostCareerBenchWaste && mostCareerBenchWaste.careerBenchPointsLeft > 0) {
      cards.push(card("Career Bench Waste", mostCareerBenchWaste.careerBenchPointsLeft.toFixed(1), `${escapeHtml(mostCareerBenchWaste.teamName)} · total points left on the bench, all-time`));
    }
  }

  return cards.join("") || `<div class="empty-state">Not enough completed games yet to crown any records.</div>`;
}

document.addEventListener("DOMContentLoaded", renderRecords);
