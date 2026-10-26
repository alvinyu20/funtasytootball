// ---------------------------------------------------------------
// Home page state. Everything the "my team" switch needs to redraw
// without asking Sleeper again lives here.
// ---------------------------------------------------------------
const HOME = {
  league: null,
  week: null,
  completed: 0, // weeks every roster's Record already includes (finished weeks only)
  standings: [],
  rawMatchups: [],
  highlights: { week: 0, topScore: null, closest: null }, // from the latest FINISHED week
  feed: null,
  nowMs: null,
};

function currentMyTeam() {
  return typeof MyTeam !== "undefined" ? MyTeam.get() : null;
}

async function renderDashboard() {
  const errorBox = document.getElementById("dash-error");

  try {
    // ---- Phase 1: fast, essential data (standings, matchups, ROS) ----
    const [league, rosters, users, nflState, teamStrength, playerDirectory] = await Promise.all([
      SleeperAPI.getLeague(LEAGUE_ID),
      SleeperAPI.getRosters(LEAGUE_ID),
      SleeperAPI.getUsers(LEAGUE_ID),
      SleeperAPI.getNflState(),
      fetchJsonSafe(TEAM_STRENGTH_FILE, { teams: {} }),
      SleeperAPI.getPlayerDirectory(),
    ]);

    if (!league || league.detail === "not found") {
      throw new Error("League not found.");
    }

    document.title = (SITE_TITLE || league.name || "League") + " \u2014 Home";
    document.getElementById("sb-eyebrow").textContent = `${league.season} SEASON`;
    document.getElementById("sb-title").textContent = league.name || "Fantasy League";

    let week = null;
    if (league.status === "in_season" && String(league.season) === String(nflState.season)) {
      week = nflState.week;
    } else if (league.status === "complete") {
      const playoffStart = (league.settings && league.settings.playoff_week_start) || 15;
      week = Math.max(1, playoffStart - 1); // last regular-season week as a reasonable default
    }

    const standings = SleeperAPI.buildStandings(rosters, users);
    HOME.league = league;
    HOME.week = week;
    HOME.standings = standings;
    // Weeks that are final: the same rule every page uses (see DeepHistory.completedThroughWeek).
    const finishedThrough = DeepHistory.completedThroughWeek({ league, rosters, nflWeek: week });
    HOME.completed = Number.isFinite(finishedThrough) ? finishedThrough : week || 0;
    HOME.nowMs = Date.now();

    renderLeaguePulse();
    renderStandingsTable(standings, teamStrength, league.settings && league.settings.playoff_teams);
    bindStandingsToggle();
    renderStandingsFresh(teamStrength);

    const lastWeek = week && week > 1 ? week - 1 : null;
    const [rawMatchups, rawMatchupsLastWeek] = await Promise.all([
      week ? SleeperAPI.getMatchups(LEAGUE_ID, week).catch(() => []) : Promise.resolve([]),
      lastWeek ? SleeperAPI.getMatchups(LEAGUE_ID, lastWeek).catch(() => []) : Promise.resolve([]),
    ]);
    HOME.rawMatchups = rawMatchups || [];
    const { pairs: matchupPairs } = renderMatchupsAndFeatured(rawMatchups, standings, week);
    const { pairs: lastWeekPairs } = renderLastWeekMatchups(rawMatchupsLastWeek, standings, lastWeek);
    // Top Score and Closest Game come from the latest FINISHED week, never a half-played one.
    const finalWeekMatchups = HOME.completed >= week ? rawMatchups : lastWeek && HOME.completed === lastWeek ? rawMatchupsLastWeek : [];
    HOME.highlights = { week: Math.min(HOME.completed, week || 0), ...weekHighlights(finalWeekMatchups, standings) };
    renderMatchupsFresh();
    renderLeaguePulse();
    openLastWeekOnDesktop();
    applyMyTeam();
    initScrollAnimations();

    fetchJsonSafe(SEASON_AWARDS_FILE, { seasons: {} }).then(renderHistoryCallout);
    fetchJsonSafe(RECORDS_FEED_FILE, null).then(renderLatestRecords);

    // ---- Phase 2: heavier data (full-season fetch), doesn't block the above ----
    const allH2hPairs = [...matchupPairs.map((p) => ({ ...p, idPrefix: "cur" })), ...lastWeekPairs.map((p) => ({ ...p, idPrefix: "last" }))];
    if (league.status !== "pre_draft" && week) {
      renderStreaksAndPowerRankings(league, rosters, users, week, playerDirectory, teamStrength);
      renderRecentActivity(LEAGUE_ID, week, rosters, users, playerDirectory);
      if (allH2hPairs.length) {
        renderMatchupHeadToHead(allH2hPairs, playerDirectory);
      }
    } else {
      document.getElementById("streaks-panel").innerHTML = `<div class="empty-state">Check back once the season starts.</div>`;
      document.getElementById("power-rankings-snapshot").innerHTML = `<div class="empty-state">Check back once the season starts.</div>`;
      document.getElementById("recent-activity-panel").innerHTML = `<div class="empty-state">No activity yet.</div>`;
    }
  } catch (err) {
    console.error(err);
    errorBox.textContent = "Couldn't load league data from Sleeper. Give it a minute and refresh the page.";
    errorBox.style.display = "block";
  }
}

// ---------------------------------------------------------------
// Finished weeks. Sleeper's roster Record and Points For only count a
// week once it's final, but a week in progress already has partial
// scores in the weekly matchup data. Anything built from the weekly data
// (Overall, Luck, Avg/Wk, SOS, streaks) is cut off at the same week the
// Record covers, so one table never mixes two different weeks.
// ---------------------------------------------------------------
function completedWeekCount(standings) {
  let most = 0;
  (standings || []).forEach((t) => {
    most = Math.max(most, (t.wins || 0) + (t.losses || 0) + (t.ties || 0));
  });
  return most;
}

function onlyCompletedWeeks(deepWeeks, completed) {
  return (deepWeeks || []).filter((w) => w.week <= completed);
}

// ---------------------------------------------------------------
// League pulse: week, whether games are on, when waivers run next, the
// week's top score and closest game, and (once a manager has picked a
// team) their own matchup. Eastern Time maths is done with Intl so it is
// right on both sides of the daylight-saving change.
// ---------------------------------------------------------------
const PULSE_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function easternParts(ms) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  const p = {};
  fmt.formatToParts(new Date(ms)).forEach((x) => {
    p[x.type] = x.value;
  });
  return { dow: PULSE_DOW.indexOf(p.weekday), year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

// The instant (ms) when the clocks in New York read this date and hour.
function easternWallToMs(year, month, day, hour) {
  const target = Date.UTC(year, month - 1, day, hour, 0);
  const offsetAt = (t) => {
    const p = easternParts(t);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t;
  };
  const first = target - offsetAt(target);
  return target - offsetAt(first);
}

// Sleeper numbers its waiver day from Monday (0 = Mon ... 6 = Sun).
function nextWaiverRun(nowMs, waiverDayOfWeek, hourEt) {
  if (waiverDayOfWeek == null || waiverDayOfWeek === "" || Number.isNaN(Number(waiverDayOfWeek))) return null;
  const target = (Number(waiverDayOfWeek) + 1) % 7; // -> Sun = 0 ... Sat = 6
  const hour = hourEt == null ? 3 : hourEt;
  const nowEt = easternParts(nowMs);
  for (let add = 0; add <= 7; add++) {
    const d = new Date(Date.UTC(nowEt.year, nowEt.month - 1, nowEt.day + add));
    if (d.getUTCDay() !== target) continue;
    const ms = easternWallToMs(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour);
    if (ms > nowMs) return { ms, dow: PULSE_DOW[target], hour };
  }
  return null;
}

function hourLabel(hour) {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${hour < 12 ? " AM" : " PM"}`;
}

function waiverPulse(nowMs, waiverDayOfWeek, hourEt) {
  const run = nextWaiverRun(nowMs, waiverDayOfWeek, hourEt);
  if (!run) return null;
  const hours = (run.ms - nowMs) / 3600000;
  let sub;
  if (hours < 1) sub = "in under an hour";
  else if (hours < 24) sub = `in ${Math.round(hours)} hr`;
  else sub = `in ${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"}, ${Math.floor(hours % 24)} hr`;
  return { value: `${run.dow} ${hourLabel(run.hour)} ET`, sub };
}

// Your matchup this week: [{ name, username, points }] for you and your opponent.
function findMyMatchup(rawMatchups, standings, me) {
  const key = typeof MyTeam !== "undefined" ? MyTeam.normalize(me) : String(me || "").trim().toLowerCase();
  if (!key) return null;
  const mine = (standings || []).find((t) => t.username && t.username.trim().toLowerCase() === key);
  if (!mine) return null;
  const mineRow = (rawMatchups || []).find((m) => m.roster_id === mine.rosterId);
  if (!mineRow || mineRow.matchup_id == null) return { me: mine, opponent: null, mine: mineRow || null, theirs: null };
  const theirsRow = rawMatchups.find((m) => m.matchup_id === mineRow.matchup_id && m.roster_id !== mine.rosterId);
  const opponent = theirsRow ? standings.find((t) => t.rosterId === theirsRow.roster_id) || null : null;
  return { me: mine, opponent, mine: mineRow, theirs: theirsRow || null };
}

function pulseCellHtml(c) {
  return `
      <div class="ticker-stat pulse-cell${c.wide ? " pulse-wide" : ""}${c.mine ? " pulse-mine" : ""}">
        <span class="label">${escapeHtml(c.label)}</span>
        <span class="value"${c.countUp ? " data-count-up" : ""}>${c.valueHtml != null ? c.valueHtml : escapeHtml(c.value)}</span>
        ${c.sub ? `<span class="sub">${escapeHtml(c.sub)}</span>` : ""}
      </div>`;
}

function buildPulseCells(m) {
  const cells = [];
  if (m.waivers) cells.push({ label: "Next waivers", value: m.waivers.value, sub: m.waivers.sub });
  // Final results only: the latest finished week, named so nobody mistakes it for the one in progress.
  const finalTag = m.highlightWeek ? ` \u00b7 Wk ${m.highlightWeek}` : "";
  if (m.topScore) cells.push({ label: `Top Score${finalTag}`, value: `${m.topScore.pts.toFixed(1)} \u00b7 ${m.topScore.name}`, countUp: true });
  if (m.closest) cells.push({ label: `Closest Game${finalTag}`, value: `${m.closest.diff.toFixed(1)} pt gap`, sub: `${m.closest.a} vs ${m.closest.b}`, countUp: true });
  if (m.week && m.hasMatchups) {
    if (!m.me) {
      cells.push({
        label: "Your matchup",
        valueHtml: `<button class="pulse-cta" type="button" data-myteam-open>Pick your team</button>`,
        sub: "We\u2019ll pin your matchup and highlight you everywhere",
        wide: true,
      });
    } else if (m.myMatch && m.myMatch.opponent) {
      const a = m.myMatch.mine ? m.myMatch.mine.points || 0 : 0;
      const b = m.myMatch.theirs ? m.myMatch.theirs.points || 0 : 0;
      const lead = a === b ? "" : a > b ? " \u00b7 you\u2019re ahead" : " \u00b7 you\u2019re behind";
      cells.push({
        label: "Your matchup",
        valueHtml: `<strong>${a.toFixed(1)}</strong> \u2013 ${b.toFixed(1)}`,
        sub: `vs ${m.myMatch.opponent.username || m.myMatch.opponent.teamName}${m.anyPoints ? lead : ""}`,
        wide: true,
        mine: true,
      });
    } else if (m.myMatch) {
      cells.push({ label: "Your matchup", value: "Bye week", sub: m.me, wide: true, mine: true });
    } else {
      cells.push({
        label: "Your matchup",
        valueHtml: `<button class="pulse-cta" type="button" data-myteam-open>Change team</button>`,
        sub: `${m.me} isn\u2019t in this league`,
        wide: true,
      });
    }
  }
  return cells;
}

function renderLeaguePulse() {
  const league = HOME.league;
  const tickerEl = document.getElementById("sb-ticker");
  const subEl = document.getElementById("sb-sub");
  if (!league || !tickerEl) return;
  const week = HOME.week;
  const nowMs = HOME.nowMs || Date.now();
  const me = currentMyTeam();
  const hasMatchups = HOME.rawMatchups.length > 0;
  const anyPoints = HOME.rawMatchups.some((m) => (m.points || 0) > 0);

  if (subEl) {
    subEl.textContent = league.status === "pre_draft" ? "Preseason" : league.status === "complete" ? "Season complete" : week ? `Week ${week}` : "";
  }

  const inSeason = league.status === "in_season" && week;
  const waivers = inSeason ? waiverPulse(nowMs, league.settings && league.settings.waiver_day_of_week, WAIVER_CLEAR_HOUR_ET) : null;
  const cells = buildPulseCells({
    week,
    waivers,
    highlightWeek: HOME.highlights.week,
    topScore: HOME.highlights.topScore,
    closest: HOME.highlights.closest,
    hasMatchups,
    anyPoints,
    me,
    myMatch: me ? findMyMatchup(HOME.rawMatchups, HOME.standings, me) : null,
  });
  tickerEl.innerHTML = cells.map(pulseCellHtml).join("");
}

// ---------------------------------------------------------------
// Freshness chips on the Home panels
// ---------------------------------------------------------------
function setChip(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html || "";
}

function renderStandingsFresh(teamStrength) {
  const league = HOME.league;
  const inSeason = league && league.status === "in_season";
  setChip(
    "standings-fresh",
    inSeason ? freshnessChipHtml({ through: HOME.completed, current: HOME.week, note: "updates Tuesdays" }) : ""
  );
  const stale = teamStrength && teamStrength.asOf ? daysSinceDate(teamStrength.asOf, HOME.nowMs || Date.now()) : null;
  setChip(
    "ros-note",
    teamStrength && teamStrength.asOf
      ? freshnessChipHtml({
          label: "ROS ranks",
          date: teamStrength.asOf,
          note: "FantasyPros",
          tone: stale != null && stale > 10 ? "behind" : "snap",
          title: "Rest-of-season strength from FantasyPros, refreshed by hand when the league checks it",
        })
      : ""
  );
}

function renderMatchupsFresh() {
  const league = HOME.league;
  const week = HOME.week;
  if (!league || league.status !== "in_season" || !week || !HOME.rawMatchups.length) {
    setChip("matchups-fresh", "");
    return;
  }
  const anyPoints = HOME.rawMatchups.some((m) => (m.points || 0) > 0);
  const state = HOME.completed >= week ? "final" : anyPoints ? "progress" : "upcoming";
  setChip("matchups-fresh", freshnessChipHtml({ label: MATCHUP_STATUS_LABEL[state], week, title: "Scores come straight from Sleeper; a week only counts toward records once it is final" }));
  setChip("last-week-fresh", HOME.week > 1 ? freshnessChipHtml({ label: "Final", week: HOME.week - 1 }) : "");
}

// A feed or snapshot "as of" chip, in the same words everywhere.
function feedFreshChip(asOf, currentSeason, currentWeek) {
  if (!asOf || asOf.week == null) return "";
  const sameSeason = !currentSeason || String(asOf.season) === String(currentSeason);
  return freshnessChipHtml({
    label: sameSeason ? "" : String(asOf.season),
    through: asOf.week,
    current: sameSeason ? currentWeek : null,
    note: "updates Tuesdays",
  });
}

// The Last Week panel is a collapsible: closed on a phone (it is mostly
// history), open on a wide screen where there is room for it.
function openLastWeekOnDesktop() {
  const el = document.getElementById("last-week-panel");
  if (!el || typeof window === "undefined" || !window.matchMedia) return;
  if (window.matchMedia("(min-width: 921px)").matches) el.setAttribute("open", "");
}

// On a phone the Standings table keeps the columns people check first (record, points
// for, luck, ROS, strength of schedule) and tucks PA, Avg/Wk and Overall behind a
// button, so nothing important is off-screen on arrival. Wide screens show them all.
function bindStandingsToggle() {
  const btn = document.getElementById("standings-more");
  const table = document.getElementById("home-standings");
  if (!btn || !table || btn.getAttribute("data-bound")) return;
  btn.setAttribute("data-bound", "1");
  btn.addEventListener("click", () => {
    const on = table.classList.toggle("show-all");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "Show fewer columns" : "Show all columns";
  });
}

// Phase 1 (fast): # / Team / Record / PF / ROS are all available straight
// from the light buildStandings() + team-strength.json fetch, so they
// render immediately. PA / Avg-Wk / Overall / Luck / SOS need the full
// single-season weekly fetch (DeepHistory.computeSeasonSummary), which is
// Phase 2 work -- those columns show "—" here and get filled in for real
// by renderEnrichedStandings below once that data lands. The column COUNT
// never changes between the two passes, just which cells have real values,
// so the table never jumps around.
const STANDINGS_COLSPAN = 10;

function renderStandingsTable(standings, teamStrength, playoffTeams) {
  const strengthByUsername = (teamStrength && teamStrength.teams) || {};
  const tbody = document.getElementById("standings-body");
  tbody.innerHTML = standings
    .map((t, i) => {
      const strength = t.username && strengthByUsername[t.username];
      const row = `
      <tr>
        <td class="rank" data-label="#">${i + 1}</td>
        <td class="team-cell" data-label="Team"${t.username ? ` data-username="${escapeHtml(t.username)}"` : ""}>${t.userId ? `<a href="teams.html#${encodeURIComponent(t.userId)}" class="subtle-link">${escapeHtml(t.teamName)}</a>` : escapeHtml(t.teamName)}</td>
        <td data-label="Record">${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
        <td data-label="PF">${t.fpts.toFixed(1)}</td>
        <td class="col-more" data-label="PA">—</td>
        <td class="col-more" data-label="Avg/Wk">—</td>
        <td class="col-more" data-label="Overall">—</td>
        <td data-label="Luck">—</td>
        <td data-label="ROS">${strength ? "#" + strength.rank : "—"}</td>
        <td data-label="SOS">—</td>
      </tr>`;
      if (playoffTeams && i + 1 === playoffTeams && i + 1 < standings.length) {
        return row + `<tr class="playoff-cutoff-row"><td colspan="${STANDINGS_COLSPAN}" class="playoff-cutoff-label">Playoff Line</td></tr>`;
      }
      return row;
    })
    .join("");
}

// Phase 2: replaces the table above with every column fully populated,
// once the single-season deep fetch (already needed for streaks/Power
// Rankings) is in hand. Reuses DeepHistory.computeSeasonSummary -- the
// same function the Season page itself builds its "Final Standings" table
// from -- so this is the same Record/PF/PA/Avg-Wk/Overall/Luck/SOS data,
// just for the in-progress current season. ROS keeps coming from
// team-strength.json (computeSeasonSummary doesn't know about that file).
function renderEnrichedStandings(league, rosters, users, deep, playerDirectory, teamStrength, playoffTeams) {
  try {
    const seasonEntry = { league, rosters, users, bracket: [] };
    // Only finished weeks, so Overall/Luck/Avg/SOS cover the same weeks as the
    // Record and PF beside them. Before any week is final there's nothing to add.
    const finishedWeeks = onlyCompletedWeeks(deep.weeks, HOME.completed);
    if (!finishedWeeks.length) return;
    const summary = DeepHistory.computeSeasonSummary(seasonEntry, { ...deep, weeks: finishedWeeks }, playerDirectory, null, null, null);
    const strengthByUsername = (teamStrength && teamStrength.teams) || {};

    const avgByRosterId = new Map();
    (summary.teamAverages || []).forEach((t) => {
      if (t.rosterId != null) avgByRosterId.set(t.rosterId, t.average);
    });

    const tbody = document.getElementById("standings-body");
    tbody.innerHTML = summary.standings
      .map((t, i) => {
        const strength = t.username && strengthByUsername[t.username];
        const row = `
        <tr>
          <td class="rank" data-label="#">${i + 1}</td>
          <td class="team-cell" data-label="Team"${t.username ? ` data-username="${escapeHtml(t.username)}"` : ""}>${t.userId ? `<a href="teams.html#${encodeURIComponent(t.userId)}" class="subtle-link">${escapeHtml(t.teamName)}</a>` : escapeHtml(t.teamName)}</td>
          <td data-label="Record">${t.wins}-${t.losses}${t.ties ? "-" + t.ties : ""}</td>
          <td data-label="PF">${t.fpts.toFixed(1)}</td>
          <td class="col-more" data-label="PA">${t.fptsAgainst.toFixed(1)}</td>
          <td class="col-more" data-label="Avg/Wk">${avgByRosterId.has(t.rosterId) ? avgByRosterId.get(t.rosterId).toFixed(1) : "—"}</td>
          <td class="col-more" data-label="Overall">${t.overallWins}-${t.overallLosses}${t.overallTies ? "-" + t.overallTies : ""}</td>
          <td data-label="Luck">${luckBadge(t.luckPct)}</td>
          <td data-label="ROS">${strength ? "#" + strength.rank : "—"}</td>
          <td data-label="SOS">${t.avgOpponentPF != null ? t.avgOpponentPF.toFixed(1) : "—"}</td>
        </tr>`;
        if (playoffTeams && i + 1 === playoffTeams && i + 1 < summary.standings.length) {
          return row + `<tr class="playoff-cutoff-row"><td colspan="${STANDINGS_COLSPAN}" class="playoff-cutoff-label">Playoff Line</td></tr>`;
        }
        return row;
      })
      .join("");
  } catch (err) {
    // Best-effort enhancement -- Phase 1's lighter table above is still
    // correct (just missing a few columns), so leave it as-is rather than
    // replacing working data with an error state.
    console.warn("Couldn't load enriched standings:", err);
  }
}

// ---------------------------------------------------------------
// Matchup status. A matchup is FINAL once its week is over (the same rule
// every other page uses to decide what counts as a result), IN PROGRESS
// once anybody has scored, and UPCOMING before that. Sleeper does not
// publish projections for league matchups, so there is no "projected"
// state to show.
// ---------------------------------------------------------------
const MATCHUP_STATUS_LABEL = { final: "Final", progress: "In progress", upcoming: "Upcoming" };

function matchupStatus(a, b, weekIsFinal) {
  if (weekIsFinal) return "final";
  return (a && (a.points || 0) > 0) || (b && (b.points || 0) > 0) ? "progress" : "upcoming";
}

// The small tag under each side's score: "W +12.4" / "L" once final, "Leads +3.1" while
// it is still being played, nothing before kickoff. `a` and `b` are raw Sleeper matchup rows.
function matchupOutcome(a, b, status) {
  const pa = (a && a.points) || 0;
  const pb = (b && b.points) || 0;
  const margin = Math.abs(pa - pb).toFixed(1);
  const none = { a: null, b: null, lead: null };
  if (status === "upcoming") return none;
  if (pa === pb) return status === "final" ? { a: { text: "T", cls: "tie" }, b: { text: "T", cls: "tie" }, lead: null } : none;
  const aAhead = pa > pb;
  const win = { text: `W +${margin}`, cls: "win" };
  const loss = { text: "L", cls: "loss" };
  const leads = { text: `Leads +${margin}`, cls: "leads" };
  if (status === "final") return { a: aAhead ? win : loss, b: aAhead ? loss : win, lead: aAhead ? "a" : "b" };
  return { a: aAhead ? leads : null, b: aAhead ? null : leads, lead: aAhead ? "a" : "b" };
}

// A manager without a team name is shown by their username already; repeating it as the
// little subtitle just prints the same word twice.
function usernameSubHtml(name, username) {
  if (!username) return "";
  if (String(username).trim().toLowerCase() === String(name || "").trim().toLowerCase()) return "";
  return `<span class="username-sub">${escapeHtml(username)}</span>`;
}

function outcomeTagHtml(tag) {
  return tag ? `<span class="result-tag result-${tag.cls}">${escapeHtml(tag.text)}</span>` : "";
}

function scoreText(points, status) {
  return status === "upcoming" ? "—" : (points || 0).toFixed(1);
}

// Top Score and Closest Game of one finished week.
function weekHighlights(rawMatchups, standings) {
  const nameByRoster = new Map((standings || []).map((t) => [t.rosterId, t.teamName]));
  const byMatchupId = new Map();
  (rawMatchups || []).forEach((m) => {
    if (m.matchup_id == null) return;
    if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
    byMatchupId.get(m.matchup_id).push(m);
  });
  let topScore = null;
  let closest = null;
  byMatchupId.forEach((pair) => {
    if (pair.length < 2) return;
    const [a, b] = pair;
    const aName = nameByRoster.get(a.roster_id) || `Roster ${a.roster_id}`;
    const bName = nameByRoster.get(b.roster_id) || `Roster ${b.roster_id}`;
    [{ name: aName, pts: a.points || 0 }, { name: bName, pts: b.points || 0 }].forEach((t) => {
      if (!topScore || t.pts > topScore.pts) topScore = t;
    });
    const diff = Math.abs((a.points || 0) - (b.points || 0));
    if (!closest || diff < closest.diff) closest = { diff, a: aName, b: bName };
  });
  return { topScore: topScore && topScore.pts > 0 ? topScore : null, closest: topScore && topScore.pts > 0 ? closest : null };
}

// Shared by both the This Week's and Last Week's Matchups sections: one
// matchup card, team name primary (matching the rest of the Home page),
// username as a small subtitle right underneath (only when it adds
// something), score to the side with a W/L tag once it is final, a status
// label, and an empty head-to-head slot (filled in later, in the
// background, by renderMatchupHeadToHead) identified by idPrefix so the
// two sections' cards never collide even when the same two rosters appear
// in both.
function matchupCardHtml(a, b, aName, bName, aUsername, bUsername, idPrefix, order, status) {
  const st = status || "final";
  const users = [aUsername, bUsername].filter(Boolean).map((u) => String(u).trim().toLowerCase()).join("|");
  const out = matchupOutcome(a, b, st);
  const ptsClass = (side) => (out.lead ? (out.lead === side ? "lead" : "trail") : "even");
  return `
      <div class="matchup status-${st}" data-order="${order || 0}" data-users="${escapeHtml(users)}">
        <div class="matchup-row">
          <div class="side${out.lead === "a" && st === "final" ? " winner" : ""}">
            <span class="name">${escapeHtml(aName)}</span>
            ${usernameSubHtml(aName, aUsername)}
            <span class="pts ${ptsClass("a")}">${scoreText(a.points, st)}</span>
            ${outcomeTagHtml(out.a)}
          </div>
          <span class="vs">VS</span>
          <div class="side right${out.lead === "b" && st === "final" ? " winner" : ""}">
            <span class="name">${escapeHtml(bName)}</span>
            ${usernameSubHtml(bName, bUsername)}
            <span class="pts ${ptsClass("b")}">${scoreText(b.points, st)}</span>
            ${outcomeTagHtml(out.b)}
          </div>
        </div>
        <div class="matchup-foot">
          <span class="matchup-status st-${st}">${MATCHUP_STATUS_LABEL[st]}</span>
          <span class="matchup-h2h" id="h2h-${idPrefix}-${a.roster_id}-${b.roster_id}"></span>
        </div>
      </div>`;
}

function renderMatchupsAndFeatured(rawMatchups, standings, week) {
  const matchupsEl = document.getElementById("matchups-list");
  const featuredEl = document.getElementById("featured-matchup-panel");

  if (!week) {
    matchupsEl.innerHTML = `<div class="empty-state">No matchups to show right now.</div>`;
    featuredEl.innerHTML = `<div class="empty-state">No matchups to feature yet.</div>`;
    return { pairs: [] };
  }
  if (!rawMatchups || rawMatchups.length === 0) {
    matchupsEl.innerHTML = `<div class="empty-state">Matchups for week ${week} aren't posted yet.</div>`;
    featuredEl.innerHTML = `<div class="empty-state">Matchups for week ${week} aren't posted yet.</div>`;
    return { pairs: [] };
  }

  const weekIsFinal = HOME.completed >= week;
  const nameByRoster = new Map(standings.map((t) => [t.rosterId, t.teamName]));
  const standingsByRoster = new Map(standings.map((t) => [t.rosterId, t]));
  const byMatchupId = new Map();
  rawMatchups.forEach((m) => {
    if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
    byMatchupId.get(m.matchup_id).push(m);
  });

  const cards = [];
  const pairs = []; // {rosterA, rosterB, userIdA, userIdB, aName, bName} -- for the head-to-head enrichment pass (Phase 2)
  byMatchupId.forEach((pair) => {
    if (pair.length < 2) return; // bye week / odd roster count
    const [a, b] = pair.sort((x, y) => (y.points || 0) - (x.points || 0));
    const aName = nameByRoster.get(a.roster_id) || `Roster ${a.roster_id}`;
    const bName = nameByRoster.get(b.roster_id) || `Roster ${b.roster_id}`;
    const status = matchupStatus(a, b, weekIsFinal);

    const sa = standingsByRoster.get(a.roster_id);
    const sb = standingsByRoster.get(b.roster_id);

    pairs.push({
      rosterA: a.roster_id,
      rosterB: b.roster_id,
      userIdA: sa ? sa.userId : null,
      userIdB: sb ? sb.userId : null,
      aName,
      bName,
    });

    cards.push(matchupCardHtml(a, b, aName, bName, sa && sa.username, sb && sb.username, "cur", cards.length, status));
  });

  matchupsEl.innerHTML = cards.join("") || `<div class="empty-state">No matchups posted yet.</div>`;
  const picked = featuredMatchupPair(rawMatchups, standings);
  const featuredPair = picked && {
    ...picked,
    aName: nameByRoster.get(picked.a.roster_id) || `Roster ${picked.a.roster_id}`,
    bName: nameByRoster.get(picked.b.roster_id) || `Roster ${picked.b.roster_id}`,
    status: matchupStatus(picked.a, picked.b, weekIsFinal),
  };
  featuredEl.innerHTML = featuredPair ? featuredMatchupHtml(featuredPair, week) : `<div class="empty-state">No matchups to feature yet.</div>`;

  return { pairs };
}

// The one matchup picked for the best combined record on the slate. It carries the same
// status label and W/L tags as the cards, so a finished game reads as finished.
function featuredMatchupHtml(f, week) {
  const { a, b, aName, bName, sa, sb, status } = f;
  const out = matchupOutcome(a, b, status);
  const record = (s) => (s ? `${s.wins}-${s.losses}${s.ties ? "-" + s.ties : ""}` : "");
  const ptsClass = (side) => (out.lead ? (out.lead === side ? "lead" : "trail") : "even");
  const side = (name, s, row, key) => `
        <div class="side${out.lead === key && status === "final" ? " winner" : ""}">
          <div class="name">${escapeHtml(name)}</div>
          <div class="record">${record(s)}</div>
          <div class="pts ${ptsClass(key)}">${scoreText(row.points, status)}</div>
          ${outcomeTagHtml(out[key])}
        </div>`;
  return `
      <div class="featured-matchup">${side(aName, sa, a, "a")}
        <div class="vs">VS</div>${side(bName, sb, b, "b")}
      </div>
      <div class="featured-matchup-sub"><span class="matchup-status st-${status}">${MATCHUP_STATUS_LABEL[status]}</span> Week ${week} · picked for the best combined record on the slate</div>`;
}

// Same card format as This Week's Matchups (team name, username subtitle,
// final score with the W/L tags, empty h2h slot filled in later), but no
// ticker/featured side effects -- those are specific to the CURRENT week.
// idPrefix "last" keeps this section's h2h element ids distinct from "cur"'s.
function renderLastWeekMatchups(rawMatchups, standings, lastWeek) {
  const el = document.getElementById("last-week-matchups-list");
  if (!el) return { pairs: [] };

  if (!lastWeek) {
    el.innerHTML = `<div class="empty-state">No prior week yet this season.</div>`;
    return { pairs: [] };
  }
  if (!rawMatchups || rawMatchups.length === 0) {
    el.innerHTML = `<div class="empty-state">Week ${lastWeek} matchups aren't available.</div>`;
    return { pairs: [] };
  }

  const nameByRoster = new Map(standings.map((t) => [t.rosterId, t.teamName]));
  const standingsByRoster = new Map(standings.map((t) => [t.rosterId, t]));
  const byMatchupId = new Map();
  rawMatchups.forEach((m) => {
    if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
    byMatchupId.get(m.matchup_id).push(m);
  });

  // Last week is only "final" if it really is: the week before the current one
  // normally is, but a lagging Sleeper still counts as in progress.
  const weekIsFinal = HOME.completed >= lastWeek;
  const cards = [];
  const pairs = [];
  byMatchupId.forEach((pair) => {
    if (pair.length < 2) return;
    const [a, b] = pair.sort((x, y) => (y.points || 0) - (x.points || 0));
    const aName = nameByRoster.get(a.roster_id) || `Roster ${a.roster_id}`;
    const bName = nameByRoster.get(b.roster_id) || `Roster ${b.roster_id}`;
    const sa = standingsByRoster.get(a.roster_id);
    const sb = standingsByRoster.get(b.roster_id);

    pairs.push({
      rosterA: a.roster_id,
      rosterB: b.roster_id,
      userIdA: sa ? sa.userId : null,
      userIdB: sb ? sb.userId : null,
      aName,
      bName,
    });

    cards.push(matchupCardHtml(a, b, aName, bName, sa && sa.username, sb && sb.username, "last", cards.length, matchupStatus(a, b, weekIsFinal)));
  });

  el.innerHTML = cards.join("") || `<div class="empty-state">No matchups posted that week.</div>`;
  return { pairs };
}

// Fills in each matchup card's all-time head-to-head line (both This
// Week's and Last Week's sections at once -- see idPrefix on each pair),
// once the full season history is available. Deliberately separate from
// (and run after) renderMatchupsAndFeatured/renderLastWeekMatchups: those
// functions' whole job is to get matchups on screen from the fast,
// single-call standings/matchups data, with no multi-season fetch
// blocking them. Head-to-head needs a manager's full career record
// against each opponent, which only exists after walking the entire
// season chain (the same fetchSeasonChain -> buildAll -> computeStats
// pipeline Teams/Records/Rivalries already use) -- a real
// network-and-compute cost best paid in the background, after the
// matchups the person actually came here to see are already on screen.
// The card itself still shows team names (matching the rest of the Home
// page), but the All-Time record line uses usernames, not team names.
async function renderMatchupHeadToHead(pairs, playerDirectory) {
  try {
    const seasonChain = await SleeperAPI.getSeasonChain(LEAGUE_ID);
    if (seasonChain.length === 0) return;
    const deepSeasons = await DeepHistory.buildAll(seasonChain, () => {});
    const { managers } = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);
    const h2hByUserId = new Map(managers.map((m) => [m.userId, m.headToHead]));
    const usernameByUserId = new Map(managers.map((m) => [m.userId, m.username || m.teamName]));

    pairs.forEach(({ rosterA, rosterB, userIdA, userIdB, aName, bName, idPrefix }) => {
      const el = document.getElementById(`h2h-${idPrefix}-${rosterA}-${rosterB}`);
      if (!el || !userIdA || !userIdB) return;
      const aUsername = usernameByUserId.get(userIdA) || aName;
      const bUsername = usernameByUserId.get(userIdB) || bName;
      const list = h2hByUserId.get(userIdA) || [];
      const rec = list.find((h) => h.opponentUserId === userIdB);
      if (!rec) {
        el.textContent = "First-ever meeting";
        return;
      }
      const total = rec.wins + rec.losses + rec.ties;
      if (!total) {
        el.textContent = "First-ever meeting";
        return;
      }
      const tieStr = rec.ties ? `-${rec.ties}` : "";
      el.textContent = `All-Time: ${aUsername} ${rec.wins}-${rec.losses}${tieStr} ${bUsername}`;
    });
  } catch (err) {
    // Best-effort enhancement -- the matchup cards above already rendered
    // fine without this, so a failure here (e.g. a season in the chain
    // failing to fetch) just means the h2h line stays empty, not an error
    // banner over working matchup data.
    console.warn("Couldn't load head-to-head history for this week's matchups:", err);
  }
}

function renderHistoryCallout(seasonAwards) {
  const el = document.getElementById("history-callout");
  const entries = [];
  if (seasonAwards && seasonAwards.seasons) {
    Object.entries(seasonAwards.seasons).forEach(([year, categories]) => {
      Object.entries(categories).forEach(([category, award]) => {
        const winner = award.username || award.winnerName;
        if (winner) entries.push({ year, category, winner, detail: award.detail });
      });
    });
  }
  if (!entries.length) {
    el.innerHTML = `<div class="empty-state">No league history recorded yet.</div>`;
    return;
  }
  // Deterministic pick based on the day of the year, so it changes daily
  // but stays stable within a single day (not re-randomized every reload).
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const pick = entries[dayOfYear % entries.length];
  el.innerHTML = `
    <div class="history-callout-inner">
      <span class="history-callout-icon">📜</span>
      <div>
        <div class="history-callout-eyebrow">From The Archives · ${escapeHtml(String(pick.year))}</div>
        <div class="history-callout-text"><strong>${escapeHtml(pick.winner)}</strong> won <strong>${escapeHtml(pick.category)}</strong>${
    pick.detail ? ` with ${escapeHtml(pick.detail)}` : ""
  }.</div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------
// Latest Records: the newest record changes from data/records-feed.json
// (built by scripts/build-records-feed.js). Pure HTML builder + a thin renderer.
// ---------------------------------------------------------------
const LATEST_RECORDS_LIMIT = 5;

// What happened to the old mark, in a few words (see recordChangeNote in utils.js).
function latestRecordNote(e) {
  return recordChangeNote(e);
}

function latestRecordsHtml(feed, limit) {
  const events = feed && Array.isArray(feed.events) ? feed.events.slice(0, limit || LATEST_RECORDS_LIMIT) : [];
  if (!events.length) return `<div class="empty-state">No record changes tracked yet.</div>`;
  const items = events
    .map((e) => {
      const note = [e.detail, latestRecordNote(e)].filter(Boolean).join(" \u00b7 ");
      return `
      <li class="lr-item">
        <a class="lr-link" href="records.html#${encodeURIComponent(e.category)}/all/${encodeURIComponent(e.id)}">
          <span class="lr-when"><span class="lr-season">${escapeHtml(String(e.season))}</span><span class="lr-week">Week ${escapeHtml(String(e.week))}</span></span>
          <span class="lr-body">
            <span class="lr-title">${escapeHtml(e.title)}</span>
            <span class="lr-holder"><strong>${escapeHtml(e.holder)}</strong><span class="lr-value">${escapeHtml(e.value)}</span></span>
            <span class="lr-note">${escapeHtml(note)}</span>
          </span>
          <span class="lr-cat">${escapeHtml(e.categoryTitle || "")}</span>
        </a>
      </li>`;
    })
    .join("");
  return `
    <ol class="lr-list">${items}</ol>
    <p class="heatmap-note"><a class="subtle-link" href="records.html">Open the Record Book \u2192</a></p>`;
}

function renderLatestRecords(feed) {
  HOME.feed = feed;
  const el = document.getElementById("latest-records");
  if (el) el.innerHTML = latestRecordsHtml(feed);
  const season = HOME.league && HOME.league.season;
  const chip = feed && feed.asOf ? feedFreshChip(feed.asOf, season, HOME.completed) : "";
  setChip("latest-fresh", chip);
  setChip("reach-fresh", chip);
  renderRecordsInReach(feed);
}

// ---------------------------------------------------------------
// Records in Reach: active managers closing in on a record they don't hold yet
// (the feed's `reach` list, built by scripts/lib/records-reach.js).
// ---------------------------------------------------------------
const RECORDS_IN_REACH_LIMIT = 5;

// With a picked team (`me`, a username), that manager's own chases come first.
function recordsInReachHtml(feed, limit, me) {
  const listed = feed && Array.isArray(feed.reach) ? feed.reach : [];
  // Everyone sees each record's closest chaser; the rest only matter to the manager they belong to.
  let all = listed.filter((r) => r.primary !== false);
  const key = String(me || "").trim().toLowerCase();
  let mineCount = 0;
  if (key) {
    const mine = listed.filter((r) => String(r.challenger || "").trim().toLowerCase() === key);
    mineCount = mine.length;
    all = [...mine, ...all.filter((r) => !mine.includes(r))];
  }
  const items = all.slice(0, limit || RECORDS_IN_REACH_LIMIT);
  if (!items.length) return "";
  const rows = items
    .map((r) => {
      const note = r.kind === "streak" ? `Streak still alive \u00b7 ${r.holder}\u2019s record is ${r.record}` : `Chasing ${r.holder}\u2019s ${r.record}`;
      return `
      <li class="lr-item">
        <a class="lr-link" href="records.html#${encodeURIComponent(r.category)}/all/${encodeURIComponent(r.id)}">
          <span class="lr-when"><span class="lr-season">${escapeHtml(String(r.gap))}</span><span class="lr-week">behind</span></span>
          <span class="lr-body">
            <span class="lr-title">${escapeHtml(r.title)}</span>
            <span class="lr-holder"><strong>${escapeHtml(r.challenger)}</strong><span class="lr-value">${escapeHtml(String(r.current))}</span></span>
            <span class="lr-note">${escapeHtml(note)}</span>
          </span>
          <span class="lr-cat">${escapeHtml(r.categoryTitle || "")}</span>
        </a>
      </li>`;
    })
    .join("");
  const lead = key && !mineCount ? `You have no records within range right now \u2014 here\u2019s who\u2019s closest. ` : key && mineCount ? `Your chases are listed first. ` : "";
  return `
    <ol class="lr-list">${rows}</ol>
    <p class="heatmap-note">${lead}Active managers within range of a record they don\u2019t hold.</p>`;
}

function renderRecordsInReach(feed) {
  const panel = document.getElementById("records-reach-panel");
  const el = document.getElementById("records-reach");
  if (!panel || !el) return;
  const html = recordsInReachHtml(feed, null, currentMyTeam());
  panel.style.display = html ? "" : "none";
  if (panel.parentElement && panel.parentElement.classList) panel.parentElement.classList.toggle("section-grid-solo", !html);
  el.innerHTML = html;
}

function computeCurrentStreaks(deepWeeks, rosterInfo) {
  const resultsByRoster = new Map();
  deepWeeks.forEach(({ week, matchups }) => {
    const pairs = new Map();
    matchups.forEach((m) => {
      if (m.matchup_id == null) return;
      if (!pairs.has(m.matchup_id)) pairs.set(m.matchup_id, []);
      pairs.get(m.matchup_id).push(m);
    });
    pairs.forEach((pair) => {
      if (pair.length < 2) return;
      const [a, b] = pair;
      [
        { rid: a.roster_id, own: a.points || 0, opp: b.points || 0 },
        { rid: b.roster_id, own: b.points || 0, opp: a.points || 0 },
      ].forEach(({ rid, own, opp }) => {
        const result = own > opp ? "W" : own < opp ? "L" : "T";
        if (!resultsByRoster.has(rid)) resultsByRoster.set(rid, []);
        resultsByRoster.get(rid).push({ week, result });
      });
    });
  });

  const streaks = [];
  resultsByRoster.forEach((results, rosterId) => {
    results.sort((a, b) => a.week - b.week);
    if (!results.length) return;
    let len = 0;
    let result = null;
    for (let i = results.length - 1; i >= 0; i--) {
      if (result === null) {
        result = results[i].result;
        len = 1;
      } else if (results[i].result === result) {
        len += 1;
      } else {
        break;
      }
    }
    if ((result === "W" || result === "L") && len >= 2) {
      const info = rosterInfo.get(rosterId);
      streaks.push({ teamName: info ? info.username || info.teamName : "Unknown", result, length: len });
    }
  });
  return streaks.sort((a, b) => b.length - a.length);
}

function renderStreaksPanel(streaks) {
  const el = document.getElementById("streaks-panel");
  const hot = streaks.filter((s) => s.result === "W").slice(0, 3);
  const cold = streaks.filter((s) => s.result === "L").slice(0, 3);
  if (!hot.length && !cold.length) {
    el.innerHTML = `<div class="empty-state">No streaks of 2+ games yet.</div>`;
    return;
  }
  el.innerHTML = [...hot, ...cold]
    .map(
      (s) => `
    <div class="streak-row">
      <span class="name">${escapeHtml(s.teamName)}</span>
      <span class="streak-badge ${s.result === "W" ? "hot" : "cold"}">${s.result === "W" ? "🔥" : "🥶"} ${s.length}${s.result}</span>
    </div>`
    )
    .join("");
}

function renderPowerRankingsSnapshot(snapshot, lastWeekRanks) {
  const el = document.getElementById("power-rankings-snapshot");
  if (!snapshot || !snapshot.rows || !snapshot.rows.length) {
    el.innerHTML = `<div class="empty-state">No power rankings yet.</div>`;
    return;
  }
  const fmtRank = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  // Preseason rows are just {rank, username, teamName} — there's no PR
  // Score/record/playoff odds yet to build a real ranking from, so this
  // is a plain top-3 list with no delta column rather than trying to
  // force the full-season row shape onto data that doesn't have it.
  if (snapshot.preseason) {
    const rows = snapshot.rows
      .slice(0, 3)
      .map(
        (r) => `
      <div class="pr-mini-row">
        <span class="pr-mini-rank">#${r.rank}</span>
        <span class="pr-mini-name">${escapeHtml(r.username)}</span>
        <span class="pr-mini-delta muted-inline">PRESEASON</span>
      </div>`
      )
      .join("");
    el.innerHTML = rows + `<a class="dash-more-link" href="power-rankings.html">See Full Power Rankings →</a>`;
    return;
  }

  const top3 = snapshot.rows.slice(0, 3);
  const rows = top3
    .map((r) => {
      let deltaHtml = `<span class="pr-mini-delta muted-inline">NEW</span>`;
      if (lastWeekRanks && lastWeekRanks[r.teamName] != null) {
        const diff = lastWeekRanks[r.teamName] - r.powerRank;
        if (diff > 0) deltaHtml = `<span class="pr-mini-delta luck-positive">▲${fmtRank(diff)}</span>`;
        else if (diff < 0) deltaHtml = `<span class="pr-mini-delta luck-negative">▼${fmtRank(Math.abs(diff))}</span>`;
        else deltaHtml = `<span class="pr-mini-delta muted-inline">–</span>`;
      }
      return `
      <div class="pr-mini-row">
        <span class="pr-mini-rank">#${fmtRank(r.powerRank)}</span>
        <span class="pr-mini-name">${escapeHtml(r.teamName)}</span>
        ${deltaHtml}
      </div>`;
    })
    .join("");
  el.innerHTML = rows + `<a class="dash-more-link" href="power-rankings.html">See Full Power Rankings →</a>`;
}

// Streaks are computed live (deterministic from actual results — no
// randomness involved, so there's nothing to gain from freezing them
// into a snapshot the way Power Rankings needed). Power Rankings and
// the clinch/eliminate hero story, though, both come from
// data/power-rankings-snapshot.json — the same saved-not-live snapshot
// scripts/update-power-rankings.js writes, exactly as on the dedicated
// Power Rankings page. This used to call DeepHistory.computePowerRankings
// directly here too, which re-ran an unseeded Monte Carlo simulation on
// every single page load — different random playoff odds (and
// therefore a different top-3 order) on every refresh. Reading the same
// saved snapshot this page's dedicated view uses fixes that by
// construction: both places now show the exact same numbers, updated
// only when someone actually runs the update script.
async function renderStreaksAndPowerRankings(league, rosters, users, week, playerDirectory, teamStrength) {
  try {
    const seasonEntry = { league, rosters, users, bracket: [] };
    const [deep, snapshot, powerRankHistory] = await Promise.all([
      DeepHistory.fetchSeasonDeep(seasonEntry, () => {}),
      fetchJsonSafe(POWER_RANKINGS_SNAPSHOT_FILE, null),
      fetchJsonSafe(POWER_RANK_HISTORY_FILE, { seasons: {} }),
    ]);

    let streaks = [];
    const finishedWeeks = onlyCompletedWeeks(deep.weeks, HOME.completed);
    setChip("hotcold-fresh", freshnessChipHtml({ through: HOME.completed, current: week, note: "updates Tuesdays" }));
    if (finishedWeeks.length) {
      const usersById = new Map(users.map((u) => [u.user_id, u]));
      const rosterInfo = new Map();
      rosters.forEach((r) => {
        const user = usersById.get(r.owner_id);
        rosterInfo.set(r.roster_id, { teamName: SleeperAPI.teamName(user, r.roster_id), username: user ? user.display_name : null });
      });
      streaks = computeCurrentStreaks(finishedWeeks, rosterInfo);
      renderStreaksPanel(streaks);
    } else {
      document.getElementById("streaks-panel").innerHTML = `<div class="empty-state">No finished games yet \u2014 streaks start after Week 1.</div>`;
    }

    const prRows = snapshot && !snapshot.preseason ? snapshot.rows : null;
    let lastWeekRanks = null;
    if (prRows) {
      const seasonHistory = (powerRankHistory.seasons && powerRankHistory.seasons[String(snapshot.season)]) || {};
      lastWeekRanks = seasonHistory[String(snapshot.week - 1)] || null;
    }
    renderPowerRankingsSnapshot(snapshot, lastWeekRanks);
    setChip(
      "pr-fresh",
      snapshot && !snapshot.preseason
        ? freshnessChipHtml({ label: "Snapshot", through: snapshot.week, current: week, note: "updates Tuesdays" })
        : snapshot
        ? freshnessChipHtml({ label: "Preseason", tone: "snap" })
        : ""
    );

    renderEnrichedStandings(league, rosters, users, deep, playerDirectory, teamStrength, league.settings && league.settings.playoff_teams);
  } catch (err) {
    console.error(err);
    document.getElementById("streaks-panel").innerHTML = `<div class="empty-state">Couldn't load streak data.</div>`;
    document.getElementById("power-rankings-snapshot").innerHTML = `<div class="empty-state">Couldn't load power rankings.</div>`;
  }
}

function describeTransaction(tx, rosterInfoByRosterId, playerDirectory) {
  const teamLabel = (rid) => {
    const roster = rosterInfoByRosterId.get(rid);
    return escapeHtml(roster ? roster.username || roster.teamName : "Unknown");
  };
  const playerLabel = (pid) => playerLinkHtml(pid, escapeHtml(SleeperAPI.playerName(playerDirectory, pid)));

  if (tx.type === "trade") {
    const sides = (tx.roster_ids || []).map(teamLabel);
    if (sides.length < 2) return null;
    return `<div class="activity-item"><strong>Trade</strong> between ${sides.join(" and ")}<span class="activity-meta">Week ${tx.leg}</span></div>`;
  }

  const addedEntries = Object.entries(tx.adds || {});
  if (!addedEntries.length) return null;
  const bid = tx.settings && tx.settings.waiver_bid;
  return addedEntries
    .map(([pid, rid]) => {
      const label = bid ? `for $${bid} on waivers` : "as a free agent";
      return `<div class="activity-item">${teamLabel(rid)} added <strong>${playerLabel(pid)}</strong> ${label}<span class="activity-meta">Week ${tx.leg}</span></div>`;
    })
    .join("");
}

async function renderRecentActivity(leagueId, currentWeek, rosters, users, playerDirectory) {
  const el = document.getElementById("recent-activity-panel");
  try {
    const usersById = new Map(users.map((u) => [u.user_id, u]));
    const rosterInfoByRosterId = new Map(
      rosters.map((r) => {
        const user = usersById.get(r.owner_id);
        return [r.roster_id, { teamName: SleeperAPI.teamName(user, r.roster_id), username: user ? user.display_name : null }];
      })
    );

    const weeksToCheck = [currentWeek, currentWeek - 1].filter((w) => w >= 1);
    const results = await Promise.all(weeksToCheck.map((w) => SleeperAPI.getTransactions(leagueId, w).catch(() => [])));
    const all = results
      .flat()
      .filter((tx) => tx && tx.status === "complete" && (tx.type === "trade" || tx.type === "waiver" || tx.type === "free_agent"));
    all.sort((a, b) => (b.created || 0) - (a.created || 0));
    const recent = all.slice(0, 6);

    if (!recent.length) {
      el.innerHTML = `<div class="empty-state">No moves yet this week.</div>`;
      return;
    }

    const items = recent
      .map((tx) => describeTransaction(tx, rosterInfoByRosterId, playerDirectory))
      .filter(Boolean)
      .join("");
    el.innerHTML = items || `<div class="empty-state">No moves yet this week.</div>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="empty-state">Couldn't load recent activity.</div>`;
  }
}

// ---------------------------------------------------------------
// My team on Home: pin the picked manager's matchup first, then redraw the
// pieces that depend on who it is (the pulse cell and Records in Reach).
// The row highlight itself is js/my-team.js's job.
// ---------------------------------------------------------------

// cards: [{ order, users: ["a", "b"] }] -> the indexes in display order, the
// matchups involving `me` first and everything else in its original order.
function matchupDisplayOrder(cards, me) {
  const key = String(me || "").trim().toLowerCase();
  return cards
    .map((c, i) => ({ i, order: c.order, mine: !!key && c.users.includes(key) }))
    .sort((x, y) => (y.mine ? 1 : 0) - (x.mine ? 1 : 0) || x.order - y.order || x.i - y.i)
    .map((x) => x.i);
}

function pinMyMatchups(me) {
  ["matchups-list", "last-week-matchups-list"].forEach((id) => {
    const list = document.getElementById(id);
    if (!list) return;
    const els = Array.from(list.children).filter((c) => c.classList && c.classList.contains("matchup"));
    els.forEach((c) => {
      const tag = c.querySelector(".matchup-tag");
      if (tag) tag.remove();
    });
    const meta = els.map((c) => ({ order: Number(c.getAttribute("data-order")) || 0, users: (c.getAttribute("data-users") || "").split("|").filter(Boolean) }));
    const key = String(me || "").trim().toLowerCase();
    matchupDisplayOrder(meta, me).forEach((idx) => {
      const c = els[idx];
      list.appendChild(c);
      if (key && meta[idx].users.includes(key)) {
        const tag = document.createElement("span");
        tag.className = "matchup-tag";
        tag.textContent = "Your matchup";
        c.insertBefore(tag, c.firstChild);
      }
    });
  });
}

function applyMyTeam() {
  pinMyMatchups(currentMyTeam());
  renderLeaguePulse();
  if (HOME.feed) renderRecordsInReach(HOME.feed);
  if (typeof MyTeam !== "undefined") MyTeam.decorate(document.body);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("myteam:change", applyMyTeam);
}

document.addEventListener("DOMContentLoaded", renderDashboard);
