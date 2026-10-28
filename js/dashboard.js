// ---------------------------------------------------------------
// Home page state. Everything the "my team" switch needs to redraw
// without asking Sleeper again lives here, and every panel is drawn from
// it, so a panel can be drawn again whenever more data arrives (the
// season's weekly results, the all-time history) or the picked team changes.
// ---------------------------------------------------------------
const HOME = {
  league: null,
  week: null,
  completed: 0, // weeks every roster's Record already includes (finished weeks only)
  standings: [], // Sleeper's own table: Record and Points For, in Sleeper's order
  rawMatchups: [],
  rawMatchupsLast: [],
  feed: null,
  nowMs: null,
  teamStrength: null,
  playoffTeams: null,
  // Filled in once the season's weekly data and the Power Rankings snapshot are in.
  summary: null, // DeepHistory.computeSeasonSummary over the finished weeks
  results: new Map(), // rosterId -> [{ week, result: "W" | "L" | "T", own, opp }], oldest first
  avgByRoster: new Map(), // rosterId -> points per game over the finished weeks
  snapshot: null, // data/power-rankings-snapshot.json
  powerByRoster: new Map(), // rosterId -> that team's row in the snapshot
  lastWeekRanks: null,
  rankByRoster: new Map(), // rosterId -> place in the Standings table as drawn
  // Filled in last, once the full season chain is read: all-time records between managers.
  h2h: null, // { rec: Map(userId -> Map(opponentUserId -> { wins, losses, ties })), name: Map(userId -> username) }
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

    document.title = (SITE_TITLE || league.name || "League") + " — Home";
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
    HOME.teamStrength = teamStrength;
    HOME.playoffTeams = (league.settings && league.settings.playoff_teams) || null;
    // Weeks that are final: the same rule every page uses (see DeepHistory.completedThroughWeek).
    const finishedThrough = DeepHistory.completedThroughWeek({ league, rosters, nflWeek: week });
    HOME.completed = Number.isFinite(finishedThrough) ? finishedThrough : week || 0;
    HOME.nowMs = Date.now();

    renderLeaguePulse();
    renderStandings();
    bindStandingsToggle();
    renderStandingsNotes();
    renderMyTeamCard();

    const lastWeek = week && week > 1 ? week - 1 : null;
    const [rawMatchups, rawMatchupsLastWeek] = await Promise.all([
      week ? SleeperAPI.getMatchups(LEAGUE_ID, week).catch(() => []) : Promise.resolve([]),
      lastWeek ? SleeperAPI.getMatchups(LEAGUE_ID, lastWeek).catch(() => []) : Promise.resolve([]),
    ]);
    HOME.rawMatchups = rawMatchups || [];
    HOME.rawMatchupsLast = rawMatchupsLastWeek || [];
    renderMatchupsAndFeatured(HOME.rawMatchups, standings, week);
    renderLastWeekMatchups(HOME.rawMatchupsLast, standings, lastWeek);
    renderMatchupsFresh();
    renderLeaguePulse();
    renderMyTeamCard();
    if (typeof MyTeam !== "undefined") MyTeam.decorate(document.body);
    initScrollAnimations();

    fetchJsonSafe(RECORDS_FEED_FILE, null).then(renderLatestRecords);

    // ---- Phase 2: heavier data (full-season fetch), doesn't block the above ----
    if (league.status !== "pre_draft" && week) {
      renderSeasonDetail(league, rosters, users, week, playerDirectory, teamStrength);
      renderRecentActivity(LEAGUE_ID, week, rosters, users, playerDirectory);
      if (HOME.rawMatchups.length || HOME.rawMatchupsLast.length) {
        renderMatchupHeadToHead(playerDirectory);
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
// Your matchup, for the My Team card
// ---------------------------------------------------------------
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

// ---------------------------------------------------------------
// Page header: the week label and the "through Week N" chip
// ---------------------------------------------------------------
function renderLeaguePulse() {
  const league = HOME.league;
  const subEl = document.getElementById("sb-sub");
  if (!league) return;
  const week = HOME.week;

  if (subEl) {
    subEl.textContent = league.status === "pre_draft" ? "Preseason" : league.status === "complete" ? "Season complete" : week ? `Week ${week}` : "";
  }

  const inSeason = league.status === "in_season" && week;
  setChip("home-fresh", inSeason ? freshnessChipHtml({ through: HOME.completed, current: week, note: "updates Tuesdays" }) : "");
}

// ---------------------------------------------------------------
// Freshness chips on the Home panels
// ---------------------------------------------------------------
function setChip(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html || "";
}

// Under the Standings: where the ROS ranks and the playoff odds come from, and how old they are.
function renderStandingsNotes() {
  const teamStrength = HOME.teamStrength;
  const stale = teamStrength && teamStrength.asOf ? daysSinceDate(teamStrength.asOf, HOME.nowMs || Date.now()) : null;
  const rosChip =
    teamStrength && teamStrength.asOf
      ? freshnessChipHtml({
          label: "ROS ranks",
          date: teamStrength.asOf,
          note: "FantasyPros",
          tone: stale != null && stale > 10 ? "behind" : "snap",
          title: "Rest-of-season strength from FantasyPros, refreshed by hand when the league checks it",
        })
      : "";
  const snap = HOME.snapshot;
  const oddsChip =
    snap && !snap.preseason && snap.week != null
      ? freshnessChipHtml({ label: "Playoff odds", through: snap.week, current: HOME.week, note: "updates with each ROS refresh" })
      : "";
  setChip("ros-note", oddsChip + rosChip);
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

// On a phone the Standings are a compact list; "Full table" swaps it for the
// whole table (panning sideways) and back. From 1100px up the table is always
// shown and the button is hidden by CSS.
function bindStandingsToggle() {
  const btn = document.getElementById("standings-more");
  const panel = document.getElementById("standings-panel");
  if (!btn || !panel || btn.getAttribute("data-bound")) return;
  btn.setAttribute("data-bound", "1");
  btn.addEventListener("click", () => {
    const on = panel.classList.toggle("show-full");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.textContent = on ? "Compact list" : "Full table →";
  });
}


// ---------------------------------------------------------------
// Results and form. Everything below that talks about "the last 7" or a
// streak reads the same list: each team's finished games, oldest first.
// ---------------------------------------------------------------
const FORM_GAMES = 7;

// deepWeeks: [{ week, matchups }] -> Map rosterId -> [{ week, result: "W" | "L" | "T", own, opp }].
function teamResultsByRoster(deepWeeks) {
  const out = new Map();
  (deepWeeks || []).forEach(({ week, matchups }) => {
    const pairs = new Map();
    (matchups || []).forEach((m) => {
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
        if (!out.has(rid)) out.set(rid, []);
        out.get(rid).push({ week, result, own, opp });
      });
    });
  });
  out.forEach((list) => list.sort((x, y) => x.week - y.week));
  return out;
}

// The last few results as dots, newest on the right: a filled yellow dot for a
// win, a hollow blue one for a loss, a hollow pale one for a tie.
function formDotsHtml(results, n) {
  const last = (results || []).slice(-(n || FORM_GAMES));
  if (!last.length) return `<span class="form-dots form-none">—</span>`;
  const word = { W: "win", L: "loss", T: "tie" };
  const label = `Last ${last.length}, oldest first: ${last.map((r) => word[r.result]).join(", ")}`;
  return `<span class="form-dots" role="img" aria-label="${label}" title="${label}">${last.map((r) => `<i class="fd ${r.result.toLowerCase()}"></i>`).join("")}</span>`;
}

// "lost the last 2", "won last week": the current run in words ("" before any game).
function formNote(results) {
  const list = results || [];
  if (!list.length) return "";
  const latest = list[list.length - 1].result;
  let len = 0;
  for (let i = list.length - 1; i >= 0 && list[i].result === latest; i--) len++;
  const verb = { W: "won", L: "lost", T: "tied" }[latest];
  return len === 1 ? `${verb} last week` : `${verb} the last ${len}`;
}

// ---------------------------------------------------------------
// Standings: one row per team, drawn twice from the same rows (a wide table and
// a compact list) with CSS choosing which one shows. Playoff odds come from the
// Power Rankings snapshot, so this table and that page always agree.
//
// Two passes, like the rest of Home: the first (Sleeper's own table: Record,
// Points For, ROS) is on screen at once; the second fills in Form, Points
// Against, Avg/Wk, Luck and the odds when the season's weekly data lands. The
// columns never change between the two, only which cells have real values.
// ---------------------------------------------------------------
function homeByeTeams() {
  const snap = HOME.snapshot;
  if (snap && Number.isFinite(snap.byeTeams)) return snap.byeTeams;
  return HOME.playoffTeams === 6 ? 2 : 0;
}

function buildStandingsRows() {
  const full = !!(HOME.summary && HOME.summary.standings && HOME.summary.standings.length);
  const source = full ? HOME.summary.standings : HOME.standings;
  const strength = (HOME.teamStrength && HOME.teamStrength.teams) || {};
  return source.map((t, i) => {
    const power = HOME.powerByRoster.get(t.rosterId) || null;
    const ros = t.username && strength[t.username];
    const pf = Number.isFinite(t.fpts) ? t.fpts : null;
    const pa = full && Number.isFinite(t.fptsAgainst) ? t.fptsAgainst : null;
    return {
      rank: i + 1,
      rosterId: t.rosterId,
      userId: t.userId,
      teamName: t.teamName,
      username: t.username,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      record: recordText(t.wins, t.losses, t.ties),
      ovr: full ? recordText(t.overallWins, t.overallLosses, t.overallTies) : null,
      pf,
      pa,
      diff: pf != null && pa != null ? pf - pa : null,
      avg: HOME.avgByRoster.has(t.rosterId) ? HOME.avgByRoster.get(t.rosterId) : null,
      luck: full && Number.isFinite(t.luckPct) ? t.luckPct : null,
      results: HOME.results.get(t.rosterId) || [],
      playoffPct: power && Number.isFinite(power.playoffPct) ? power.playoffPct : null,
      byePct: power && Number.isFinite(power.byePct) ? power.byePct : null,
      ros: ros ? ros.rank : null,
    };
  });
}

// A dashed divider after the last team that gets a bye and after the last that makes the playoffs.
// The divider itself carries no text (it only keeps a hover label); the Legend under the table says
// "Bye line · Top 2" / "Playoff line · Top 6".
function standingsLineAfter(rank, total, byeTeams, playoffTeams) {
  if (rank >= total || !playoffTeams) return null;
  if (byeTeams && byeTeams < playoffTeams && rank === byeTeams) return { cls: "bye", text: `Bye line · Top ${byeTeams}` };
  if (rank === playoffTeams) return { cls: "playoffs", text: `Playoff line · Top ${playoffTeams}` };
  return null;
}

function diffClass(diff) {
  return diff > 0 ? "pos" : diff < 0 ? "neg" : "zero";
}

// Points for minus points against, as a bar growing out of a centre line: yellow to
// the right for a team scoring more than it allows, blue to the left for the reverse.
// Every row shares one scale (the biggest gap in the table).
function diffBarHtml(diff, maxAbs) {
  if (diff == null) return `<span class="hs-diffbar" aria-hidden="true"></span>`;
  const width = diff === 0 ? 0 : Math.max(1.5, round2((Math.abs(diff) / (maxAbs || 1)) * 50));
  return `<span class="hs-diffbar" aria-hidden="true"><i class="hs-fill ${diffClass(diff)}" style="width:${width}%"></i></span>`;
}

function standingsNameHtml(r) {
  const label = r.userId ? `<a href="teams.html#${encodeURIComponent(r.userId)}" class="subtle-link">${escapeHtml(r.teamName)}</a>` : escapeHtml(r.teamName);
  return `<span class="hs-name"${r.username ? ` data-username="${escapeHtml(r.username)}"` : ""}>${label}</span>`;
}

function oddsCellHtml(r, byeTeams) {
  return r.playoffPct == null ? `<span class="hs-none">—</span>` : `${playoffBarHtml(r, byeTeams)}<span class="hs-pct">${num1(r.playoffPct)}%</span>`;
}

function standingsRowHtml(r, ctx) {
  const diffText = r.diff == null ? "—" : signed1(r.diff);
  const forAgainst = r.pa == null ? (r.pf == null ? "" : `${num1(r.pf)} PF`) : `${num1(r.pf)} PF · ${num1(r.pa)} PA`;
  return `
      <tr class="hs-row">
        <td class="hs-rank">${r.rank}</td>
        <td class="hs-team">${standingsNameHtml(r)}${usernameSubHtml(r.teamName, r.username)}</td>
        <td class="hs-rec"><span class="hs-rec-main">${escapeHtml(r.record)}</span>${r.ovr ? `<span class="hs-sub">${escapeHtml(r.ovr)} Ovr</span>` : ""}</td>
        <td class="hs-form">${r.results.length ? formDotsHtml(r.results) : `<span class="hs-none">—</span>`}</td>
        <td class="hs-pts"><span class="hs-pts-text"><span class="hs-diff ${r.diff == null ? "zero" : diffClass(r.diff)}">${diffText}</span><span class="hs-sub">${forAgainst}</span></span>${diffBarHtml(r.diff, ctx.maxAbs)}</td>
        <td class="hs-avg">${r.avg == null ? "—" : num1(r.avg)}</td>
        <td class="hs-luck">${r.luck == null ? "—" : luckBadge(r.luck)}</td>
        <td class="hs-odds">${oddsCellHtml(r, ctx.byeTeams)}</td>
        <td class="hs-ros">${r.ros == null ? "—" : "#" + r.ros}</td>
      </tr>`;
}

// The compact list: name, record and odds on top; form, point difference and the odds bar under them.
function standingsItemHtml(r, ctx) {
  const diffText = r.diff == null ? "" : signed1(r.diff);
  return `
      <div class="hs-item">
        <div class="hs-l1">
          <span class="hs-prank">${r.rank}</span>
          ${standingsNameHtml(r)}
          <span class="hs-prec">${escapeHtml(r.record)}</span>
          <span class="hs-ppct">${r.playoffPct == null ? "—" : num1(r.playoffPct) + "%"}</span>
        </div>
        <div class="hs-l2">
          ${r.results.length ? formDotsHtml(r.results) : ""}
          <span class="hs-pdiff ${r.diff == null ? "zero" : diffClass(r.diff)}">${diffText}</span>
          ${r.playoffPct == null ? "" : playoffBarHtml(r, ctx.byeTeams)}
        </div>
      </div>`;
}

// The legend also names the two dashed dividers, using the same wording `standingsLineAfter` gives them.
function standingsLegendHtml(byeTeams, withOdds, playoffTeams) {
  // `Infinity` only keeps a line from being suppressed as "after the last team"; a bye for everyone who gets in is one line.
  const lineKeys = [byeTeams, playoffTeams]
    .map((rank) => standingsLineAfter(rank, Infinity, byeTeams, playoffTeams))
    .filter((line, i, all) => line && all.findIndex((l) => l && l.cls === line.cls) === i)
    .map((line) => `<span class="pr-key"><i class="hs-key-line ${line.cls}"></i>${line.text}</span>`);
  return [
    `<span class="pr-key"><i class="fd w"></i>Win</span>`,
    `<span class="pr-key"><i class="fd l"></i>Loss <span class="pr-key-note">(oldest on the left)</span></span>`,
    withOdds && byeTeams ? `<span class="pr-key"><i class="pr-swatch bye"></i>Bye</span>` : "",
    withOdds ? `<span class="pr-key"><i class="pr-swatch playoffs"></i>${byeTeams ? "Playoffs, no bye" : "Playoffs"}</span>` : "",
    withOdds ? `<span class="pr-key"><i class="pr-swatch miss"></i>Miss</span>` : "",
    ...lineKeys,
  ]
    .filter(Boolean)
    .join("");
}

function renderStandings() {
  const body = document.getElementById("standings-body");
  if (!body) return;
  const rows = buildStandingsRows();
  HOME.rankByRoster = new Map(rows.map((r) => [r.rosterId, r.rank]));
  const byeTeams = homeByeTeams();
  const ctx = { byeTeams, maxAbs: Math.max(1, ...rows.map((r) => Math.abs(r.diff || 0))) };
  const COLS = 9;
  const lineHtml = (r, kind) => {
    const line = standingsLineAfter(r.rank, rows.length, byeTeams, HOME.playoffTeams);
    if (!line) return "";
    return kind === "table"
      ? `<tr class="hs-line ${line.cls}" title="${line.text}"><td colspan="${COLS}"></td></tr>`
      : `<div class="hs-line ${line.cls}" title="${line.text}"></div>`;
  };
  body.innerHTML = rows.map((r) => standingsRowHtml(r, ctx) + lineHtml(r, "table")).join("");
  const list = document.getElementById("standings-list");
  if (list) list.innerHTML = rows.map((r) => standingsItemHtml(r, ctx) + lineHtml(r, "list")).join("");
  const legend = document.getElementById("standings-legend");
  if (legend) legend.innerHTML = standingsLegendHtml(byeTeams, HOME.powerByRoster.size > 0, HOME.playoffTeams);
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
    // Winner first, so "McConkey Bonk over Count Pukula's Castle" reads the right way round.
    const aWon = (a.points || 0) >= (b.points || 0);
    if (!closest || diff < closest.diff) closest = { diff, a: aWon ? aName : bName, b: aWon ? bName : aName };
  });
  return { topScore: topScore && topScore.pts > 0 ? topScore : null, closest: topScore && topScore.pts > 0 ? closest : null };
}



// ---------------------------------------------------------------
// Matchup preview. Each game is a small "tale of the tape": the two teams'
// record, Power Rank, points per week, playoff odds, bye odds and last seven
// results side by side, with the brighter mark on whichever side has the edge,
// and the all-time series underneath. The Featured Matchup is the same
// comparison, bigger. Everything is drawn from HOME, so a card draws again,
// fuller, when the season's weekly data and the all-time history arrive.
// ---------------------------------------------------------------
function sameManager(username, me) {
  const key = String(me == null ? "" : me).trim().toLowerCase();
  return !!key && String(username == null ? "" : username).trim().toLowerCase() === key;
}

// A Power Rank as written next to a team: whole ranks plain, a tie between two
// teams (5.5) with its decimal.
function rankText(r) {
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// One side of a game. `row` is Sleeper's matchup row, `team` the team's entry in
// the Standings (may be missing), `nameFallback` what to call it if so.
function matchupSide(row, team, nameFallback) {
  const rid = row.roster_id;
  const power = HOME.powerByRoster.get(rid) || null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    rosterId: rid,
    userId: team ? team.userId : null,
    name: (team && team.teamName) || nameFallback || `Roster ${rid}`,
    username: team ? team.username : null,
    wins: team ? team.wins || 0 : 0,
    losses: team ? team.losses || 0 : 0,
    ties: team ? team.ties || 0 : 0,
    record: team ? recordText(team.wins, team.losses, team.ties) : "",
    points: row.points || 0,
    powerRank: power ? num(power.powerRank) : null,
    avg: HOME.avgByRoster.has(rid) ? HOME.avgByRoster.get(rid) : power ? num(power.avgPpg) : null,
    playoffPct: power ? num(power.playoffPct) : null,
    byePct: power ? num(power.byePct) : null,
    results: HOME.results.get(rid) || [],
  };
}

function winShare(s) {
  const games = s.wins + s.losses + s.ties;
  return games ? (s.wins + s.ties / 2) / games : null;
}

// Which side has the edge on a number: "a", "b", or null when level or unknown.
function edgeOf(av, bv, lowerIsBetter) {
  if (!Number.isFinite(av) || !Number.isFinite(bv) || av === bv) return null;
  const aBetter = lowerIsBetter ? av < bv : av > bv;
  return aBetter ? "a" : "b";
}

function compareRowHtml(label, a, b) {
  const cell = (c, side) => `<span class="cmp-val ${side}${c.edge ? " edge" : ""}">${c.text}</span>`;
  const bar = (c, side) => `<span class="cmp-bar ${side}">${c.bar == null ? "" : `<i class="${c.edge ? "edge" : ""}" style="width:${round2(c.bar * 100)}%"></i>`}</span>`;
  return `<div class="cmp-row">${cell(a, "a")}${bar(a, "a")}<span class="cmp-label">${label}</span>${bar(b, "b")}${cell(b, "b")}</div>`;
}

// The rows of one comparison. A row only appears when both teams have the number.
function matchupCompareHtml(a, b, byeTeams) {
  const rows = [];
  const recEdge = edgeOf(winShare(a), winShare(b));
  rows.push(compareRowHtml("Record", { text: escapeHtml(a.record), edge: recEdge === "a" }, { text: escapeHtml(b.record), edge: recEdge === "b" }));
  if (a.powerRank != null && b.powerRank != null) {
    const e = edgeOf(a.powerRank, b.powerRank, true);
    rows.push(compareRowHtml("Power rank", { text: `#${rankText(a.powerRank)}`, edge: e === "a" }, { text: `#${rankText(b.powerRank)}`, edge: e === "b" }));
  }
  if (a.avg != null && b.avg != null) {
    const e = edgeOf(a.avg, b.avg);
    const top = Math.max(a.avg, b.avg) || 1;
    rows.push(
      compareRowHtml(
        "Avg / wk",
        { text: num1(a.avg), edge: e === "a", bar: Math.max(0.06, a.avg / top) },
        { text: num1(b.avg), edge: e === "b", bar: Math.max(0.06, b.avg / top) }
      )
    );
  }
  const pctRow = (label, key) => {
    if (a[key] == null || b[key] == null) return;
    const e = edgeOf(a[key], b[key]);
    const width = (v) => (v > 0 ? Math.max(0.015, v / 100) : 0);
    rows.push(
      compareRowHtml(
        label,
        { text: `${num1(a[key])}%`, edge: e === "a", bar: width(a[key]) },
        { text: `${num1(b[key])}%`, edge: e === "b", bar: width(b[key]) }
      )
    );
  };
  pctRow("Playoffs", "playoffPct");
  if (byeTeams) pctRow("Bye", "byePct");
  if (a.results.length || b.results.length) {
    rows.push(
      `<div class="cmp-row cmp-form"><span class="cmp-val a"></span><span class="cmp-bar a">${formDotsHtml(a.results)}</span><span class="cmp-label">Last ${FORM_GAMES}</span><span class="cmp-bar b">${formDotsHtml(b.results)}</span><span class="cmp-val b"></span></div>`
    );
  }
  return `<div class="mu-compare">${rows.join("")}</div>`;
}

// ---- all-time series between the two managers (needs the full history) ----------
// Manager A's all-time record against manager B, or null until the history has loaded.
function allTimeRecord(userIdA, userIdB) {
  if (!HOME.h2h || !userIdA || !userIdB) return null;
  const list = HOME.h2h.rec.get(userIdA);
  const r = list && list.get(userIdB);
  const wins = r ? r.wins || 0 : 0;
  const losses = r ? r.losses || 0 : 0;
  const ties = r ? r.ties || 0 : 0;
  return { wins, losses, ties, total: wins + losses + ties };
}

// The series line for a game: "You are 3-6 all-time" when the picked team is one of
// the two, otherwise "All-time: sofarrsogood 4-5 mayshisha" (usernames, like the rest
// of Home's history lines). "" until the history has loaded. `variant` "featured"
// spells it out ("All-time series: you are 3-6 against YuWillLose").
function seriesText(a, b, variant) {
  const rec = allTimeRecord(a.userId, b.userId);
  if (!rec) return "";
  if (!rec.total) return "First-ever meeting";
  const featured = variant === "featured";
  const lead = featured ? "All-time series: " : "";
  const nameOf = (s) => (HOME.h2h.name && HOME.h2h.name.get(s.userId)) || s.username || s.name;
  const me = currentMyTeam();
  if (sameManager(a.username, me) || sameManager(b.username, me)) {
    const mine = sameManager(a.username, me) ? a : b;
    const other = mine === a ? b : a;
    const r = mine === a ? rec : allTimeRecord(b.userId, a.userId);
    const text = recordText(r.wins, r.losses, r.ties);
    return featured ? `${lead}you are ${text} against ${nameOf(other)}` : `You are ${text} all-time`;
  }
  const text = `${nameOf(a)} ${recordText(rec.wins, rec.losses, rec.ties)} ${nameOf(b)}`;
  return featured ? `${lead}${text}` : `All-time: ${text}`;
}

// ---- This Week: one card per game --------------------------------------------------
function matchupSideHtml(s, status, out, key, lead) {
  const winner = lead === key && status === "final";
  const sameName = s.username && String(s.username).trim().toLowerCase() === String(s.name).trim().toLowerCase();
  const user = s.username && !sameName ? `<span class="mu-user">${escapeHtml(s.username)}</span>` : "";
  const pr = s.powerRank != null ? `<span class="mu-pr">PR #${rankText(s.powerRank)}</span>` : "";
  const tone = lead ? (lead === key ? "lead" : "trail") : "even";
  const score = status === "upcoming" ? "" : `<span class="mu-score ${tone}">${scoreText(s.points, status)}</span>${outcomeTagHtml(out[key])}`;
  return `
          <span class="mu-side${key === "b" ? " right" : ""}${winner ? " winner" : ""}">
            <span class="mu-name"${s.username ? ` data-username="${escapeHtml(s.username)}"` : ""}>${escapeHtml(s.name)}</span>
            <span class="mu-sub">${user}<span class="mu-rec">${escapeHtml(s.record)}</span>${pr}</span>
            ${score}
          </span>`;
}

// a, b: the two sides (see matchupSide), a on the left. o: { status, idPrefix, order, byeTeams }.
function matchupPreviewCardHtml(a, b, o) {
  const status = o.status || "final";
  const out = matchupOutcome(a, b, status);
  const users = [a.username, b.username].filter(Boolean).map((u) => String(u).trim().toLowerCase()).join("|");
  const series = seriesText(a, b, "card");
  const id = `mu-${o.idPrefix}-${Math.min(a.rosterId, b.rosterId)}-${Math.max(a.rosterId, b.rosterId)}`;
  return `
      <details class="mu-card status-${status}" id="${id}" data-order="${o.order || 0}" data-users="${escapeHtml(users)}" open>
        <summary class="mu-head">
          ${matchupSideHtml(a, status, out, "a", out.lead)}<span class="mu-vs">VS</span>${matchupSideHtml(b, status, out, "b", out.lead)}
          ${series ? `<span class="mu-glance">${escapeHtml(series)}</span>` : ""}
        </summary>
        <div class="mu-body">
          ${matchupCompareHtml(a, b, o.byeTeams)}
          ${series ? `<div class="mu-series">${escapeHtml(series)}</div>` : ""}
        </div>
      </details>`;
}

// Sleeper's rows for one week -> [[leader, other], ...] for every real game (byes skipped).
function matchupPairs(rawMatchups) {
  const byId = new Map();
  (rawMatchups || []).forEach((m) => {
    if (m.matchup_id == null) return;
    if (!byId.has(m.matchup_id)) byId.set(m.matchup_id, []);
    byId.get(m.matchup_id).push(m);
  });
  const pairs = [];
  byId.forEach((group) => {
    if (group.length < 2) return;
    pairs.push(group.slice().sort((x, y) => (y.points || 0) - (x.points || 0)));
  });
  return pairs;
}

// The picked team's side goes on the left of its own game.
function mineFirst(pair, standingsByRoster, me) {
  const second = standingsByRoster.get(pair[1].roster_id);
  return sameManager(second && second.username, me) ? [pair[1], pair[0]] : pair;
}

function renderMatchupsAndFeatured(rawMatchups, standings, week) {
  const matchupsEl = document.getElementById("matchups-list");
  const featuredEl = document.getElementById("featured-matchup-panel");
  setChip("featured-note", "");

  if (!week) {
    matchupsEl.innerHTML = `<div class="empty-state">No matchups to show right now.</div>`;
    featuredEl.innerHTML = `<div class="empty-state">No matchups to feature yet.</div>`;
    return;
  }
  if (!rawMatchups || rawMatchups.length === 0) {
    matchupsEl.innerHTML = `<div class="empty-state">Matchups for week ${week} aren't posted yet.</div>`;
    featuredEl.innerHTML = `<div class="empty-state">Matchups for week ${week} aren't posted yet.</div>`;
    return;
  }

  const weekIsFinal = HOME.completed >= week;
  const standingsByRoster = new Map(standings.map((t) => [t.rosterId, t]));
  const me = currentMyTeam();
  const byeTeams = homeByeTeams();

  const cards = matchupPairs(rawMatchups).map((pair, i) => {
    const [a, b] = mineFirst(pair, standingsByRoster, me);
    const status = matchupStatus(a, b, weekIsFinal);
    const A = matchupSide(a, standingsByRoster.get(a.roster_id));
    const B = matchupSide(b, standingsByRoster.get(b.roster_id));
    return {
      order: i,
      users: [A.username, B.username].filter(Boolean).map((u) => String(u).trim().toLowerCase()),
      html: matchupPreviewCardHtml(A, B, { status, idPrefix: "cur", order: i, byeTeams }),
    };
  });
  matchupsEl.innerHTML = matchupDisplayOrder(cards, me).map((i) => cards[i].html).join("") || `<div class="empty-state">No matchups posted yet.</div>`;

  const picked = featuredMatchupPair(rawMatchups, standings);
  if (picked) {
    const swap = sameManager(picked.sb && picked.sb.username, me);
    const left = swap ? { row: picked.b, team: picked.sb } : { row: picked.a, team: picked.sa };
    const right = swap ? { row: picked.a, team: picked.sa } : { row: picked.b, team: picked.sb };
    const f = { a: left.row, b: right.row, sa: left.team, sb: right.team, status: matchupStatus(picked.a, picked.b, weekIsFinal) };
    featuredEl.innerHTML = featuredMatchupHtml(f, week);
    const state = f.status === "upcoming" ? "" : `<span class="matchup-status st-${f.status}">${MATCHUP_STATUS_LABEL[f.status]}</span> · `;
    setChip("featured-note", `${state}Best combined record on the slate`);
  } else {
    featuredEl.innerHTML = `<div class="empty-state">No matchups to feature yet.</div>`;
  }

  syncMatchupCards();
}

// The one game picked for the best combined record on the slate, drawn bigger. Same
// comparison as the cards, same status and score treatment once it is under way.
// f: { a, b, sa, sb, status } (Sleeper rows and Standings entries, left side first).
function featuredMatchupHtml(f) {
  const A = matchupSide(f.a, f.sa, f.aName);
  const B = matchupSide(f.b, f.sb, f.bName);
  const status = f.status || "final";
  const out = matchupOutcome(A, B, status);
  const users = [A.username, B.username].filter(Boolean).map((u) => String(u).trim().toLowerCase()).join("|");
  const side = (s, key) => {
    const winner = out.lead === key && status === "final";
    const sameName = s.username && String(s.username).trim().toLowerCase() === String(s.name).trim().toLowerCase();
    const tone = out.lead ? (out.lead === key ? "lead" : "trail") : "even";
    return `
        <div class="mu-side mu-fside${key === "b" ? " right" : ""}${winner ? " winner" : ""}">
          <div class="mu-fname mu-name"${s.username ? ` data-username="${escapeHtml(s.username)}"` : ""}>${escapeHtml(s.name)}</div>
          ${s.username && !sameName ? `<div class="mu-fuser">${escapeHtml(s.username)}</div>` : ""}
          ${status === "upcoming" ? "" : `<div class="mu-score ${tone}">${scoreText(s.points, status)}</div>${outcomeTagHtml(out[key])}`}
        </div>`;
  };
  const series = seriesText(A, B, "featured");
  return `
      <div class="mu-featured status-${status}" data-users="${escapeHtml(users)}">
        <div class="mu-fhead">${side(A, "a")}<div class="mu-vs">VS</div>${side(B, "b")}</div>
        ${matchupCompareHtml(A, B, homeByeTeams())}
        ${series ? `<div class="mu-series">${escapeHtml(series)}</div>` : ""}
      </div>`;
}

// ---- phone: a card is its two names and the series line until it is tapped ----------
const MU_PHONE_QUERY = "(max-width: 720px)";

function isPhoneWidth() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(MU_PHONE_QUERY).matches;
}

const openMatchupCards = new Set();

// Wide screens show every card open; on a phone each starts closed (and stays open
// if it was opened, even when the panel is drawn again with fuller numbers).
function syncMatchupCards() {
  if (typeof document === "undefined" || typeof document.querySelectorAll !== "function") return;
  const phone = isPhoneWidth();
  document.querySelectorAll(".mu-card").forEach((card) => {
    card.open = phone ? openMatchupCards.has(card.id) : true;
  });
}

// ---- Last Week: a plain scoreboard ----------------------------------------------------
// The one game where the lowest-ranked team beat the highest-ranked one, by the widest
// gap in Power Rank. games: [{ winner: { name, rank }, loser: { name, rank } }].
function biggestUpset(games) {
  let best = null;
  (games || []).forEach((g) => {
    if (!g.winner || !g.loser || !Number.isFinite(g.winner.rank) || !Number.isFinite(g.loser.rank)) return;
    const gap = g.winner.rank - g.loser.rank;
    if (gap > 0 && (!best || gap > best.gap)) best = { winner: g.winner, loser: g.loser, gap };
  });
  return best;
}

function rankWord(r) {
  return Number.isInteger(r) ? ordinal(r) : `#${r.toFixed(1)}`;
}

function recapRowHtml(a, b, status, order) {
  const out = matchupOutcome(a, b, status);
  const tie = status !== "upcoming" && a.points === b.points;
  const by = tie ? { label: "Tie", value: "" } : status === "final" ? { label: "Won by", value: `+${Math.abs(a.points - b.points).toFixed(1)}` } : status === "progress" ? { label: "Leads by", value: `+${Math.abs(a.points - b.points).toFixed(1)}` } : { label: "", value: "" };
  const users = [a.username, b.username].filter(Boolean).map((u) => String(u).trim().toLowerCase()).join("|");
  const side = (s, key) => {
    const tone = out.lead ? (out.lead === key ? "lead" : "trail") : "even";
    return `<span class="lw-side ${key}"><span class="lw-name"${s.username ? ` data-username="${escapeHtml(s.username)}"` : ""}>${escapeHtml(s.name)}</span><span class="lw-score ${tone}">${scoreText(s.points, status)}</span></span>`;
  };
  return `
      <div class="lw-row status-${status}" data-order="${order || 0}" data-users="${escapeHtml(users)}">
        ${side(a, "a")}
        <span class="lw-by"><span class="lw-by-label">${by.label}</span><span class="lw-by-value">${by.value}</span></span>
        ${side(b, "b")}
      </div>`;
}

// The one-line wrap-up under the scoreboard: top score, closest game, biggest upset.
function recapFootText(rawMatchups, standings) {
  const h = weekHighlights(rawMatchups, standings);
  if (!h.topScore) return "";
  const parts = [`Top score ${h.topScore.pts.toFixed(1)} (${h.topScore.name})`, `Closest ${h.closest.diff.toFixed(1)}`];
  const byRoster = new Map((standings || []).map((t) => [t.rosterId, t]));
  const games = matchupPairs(rawMatchups)
    .filter((p) => (p[0].points || 0) > (p[1].points || 0))
    .map(([w, l]) => {
      const entry = (row) => {
        const p = HOME.powerByRoster.get(row.roster_id);
        const t = byRoster.get(row.roster_id);
        return { name: (t && t.teamName) || `Roster ${row.roster_id}`, rank: p ? p.powerRank : null };
      };
      return { winner: entry(w), loser: entry(l) };
    });
  const upset = biggestUpset(games);
  if (upset) parts.push(`Biggest upset: ${upset.winner.name} (${rankWord(upset.winner.rank)}) over ${upset.loser.name} (${rankWord(upset.loser.rank)})`);
  return parts.join(" · ");
}

function renderLastWeekMatchups(rawMatchups, standings, lastWeek) {
  const el = document.getElementById("last-week-matchups-list");
  if (!el) return;
  setChip("last-week-fresh", "");
  setChip("last-week-foot", "");

  if (!lastWeek) {
    el.innerHTML = `<div class="empty-state">No prior week yet this season.</div>`;
    return;
  }
  if (!rawMatchups || rawMatchups.length === 0) {
    el.innerHTML = `<div class="empty-state">Week ${lastWeek} matchups aren't available.</div>`;
    return;
  }

  const standingsByRoster = new Map(standings.map((t) => [t.rosterId, t]));
  // Last week is only "final" if it really is: the week before the current one
  // normally is, but a lagging Sleeper still counts as in progress.
  const weekIsFinal = HOME.completed >= lastWeek;
  const me = currentMyTeam();
  const games = matchupPairs(rawMatchups).map((pair, i) => {
    const [a, b] = pair; // leader first
    const status = matchupStatus(a, b, weekIsFinal);
    const A = matchupSide(a, standingsByRoster.get(a.roster_id));
    const B = matchupSide(b, standingsByRoster.get(b.roster_id));
    return {
      order: i,
      users: [A.username, B.username].filter(Boolean).map((u) => String(u).trim().toLowerCase()),
      html: recapRowHtml(A, B, status, i),
    };
  });
  el.innerHTML = matchupDisplayOrder(games, me).map((i) => games[i].html).join("") || `<div class="empty-state">No matchups posted that week.</div>`;

  const scores = rawMatchups.filter((m) => m.matchup_id != null).map((m) => m.points || 0);
  const avg = weekIsFinal && scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : null;
  setChip("last-week-fresh", freshnessChipHtml({ label: weekIsFinal ? "Final" : "In progress", week: lastWeek, note: avg != null ? `Avg ${avg.toFixed(1)}` : "" }));
  const foot = document.getElementById("last-week-foot");
  if (foot) foot.textContent = weekIsFinal ? recapFootText(rawMatchups, standings) : "";
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

// ---------------------------------------------------------------
// Display order of cards: the picked manager's game first, the rest as they were.
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
// My Team card: the picked manager's team at a glance (record, place in the
// table, Power Rank, playoff odds, last seven results) and who they play this week.
// Until a team is picked it holds the prompt to pick one.
// ---------------------------------------------------------------
function myTeamModel() {
  const me = currentMyTeam();
  if (!me) return { state: "none" };
  const team = HOME.standings.find((t) => sameManager(t.username, me));
  if (!team) return { state: "missing", me };
  return {
    state: "ok",
    me,
    team,
    rank: HOME.rankByRoster.get(team.rosterId) || HOME.standings.indexOf(team) + 1,
    power: HOME.powerByRoster.get(team.rosterId) || null,
    results: HOME.results.get(team.rosterId) || [],
    matchup: HOME.week && HOME.rawMatchups.length ? findMyMatchup(HOME.rawMatchups, HOME.standings, me) : null,
  };
}

// "Week 8 vs Big Ole Penix (6-1). You are 3-6 against YuWillLose all-time."
function myTeamNextLine(m) {
  const week = HOME.week;
  if (!week || !m.matchup) return "";
  const opp = m.matchup.opponent;
  if (!opp) return m.matchup.mine ? `Week ${week} · bye week.` : "";
  let line = `Week ${week} vs <b>${escapeHtml(opp.teamName)}</b> (${recordText(opp.wins, opp.losses, opp.ties)}).`;
  const rec = allTimeRecord(m.team.userId, opp.userId);
  if (rec) {
    const who = (HOME.h2h.name && HOME.h2h.name.get(opp.userId)) || opp.username || opp.teamName;
    line += rec.total ? ` You are ${recordText(rec.wins, rec.losses, rec.ties)} against ${escapeHtml(who)} all-time.` : " First-ever meeting.";
  }
  return line;
}

function myTeamCardHtml(m) {
  if (m.state === "none") {
    return `
      <div class="mt-top"><span class="mt-label">My team</span></div>
      <p class="mt-name mt-name-empty">Pick your team</p>
      <p class="mt-next">We’ll pin your matchup and highlight you everywhere.</p>
      <button class="pulse-cta" type="button" data-myteam-open>Pick your team</button>`;
  }
  if (m.state === "missing") {
    return `
      <div class="mt-top"><span class="mt-label">My team</span></div>
      <p class="mt-name mt-name-empty">${escapeHtml(m.me)}</p>
      <p class="mt-next">${escapeHtml(m.me)} isn’t in this league.</p>
      <button class="pulse-cta" type="button" data-myteam-open>Change team</button>`;
  }
  const t = m.team;
  const stat = (label, value, cls) => `<div class="mt-stat"><span class="mt-stat-label">${label}</span><b class="mt-stat-value${cls ? " " + cls : ""}">${value}</b></div>`;
  const stats = [stat("Record", escapeHtml(recordText(t.wins, t.losses, t.ties))), stat("Standing", ordinal(m.rank))];
  if (m.power && Number.isFinite(m.power.powerRank)) stats.push(stat("Power rank", `#${rankText(m.power.powerRank)}`));
  if (m.power && Number.isFinite(m.power.playoffPct)) stats.push(stat("Playoffs", `${num1(m.power.playoffPct)}%`, "gold"));
  const note = formNote(m.results);
  const form = m.results.length
    ? `<div class="mt-form">${formDotsHtml(m.results)}<span class="mt-formnote">Last ${Math.min(FORM_GAMES, m.results.length)}${note ? ` · ${note}` : ""}</span></div>`
    : "";
  const next = myTeamNextLine(m);
  const sameName = t.username && String(t.username).trim().toLowerCase() === String(t.teamName).trim().toLowerCase();
  return `
      <div class="mt-top"><span class="mt-label">My team</span><span class="mt-you">You</span></div>
      <div class="mt-head">
        <span class="mt-avatar">${userAvatarHtml(t.teamAvatar || t.avatar, t.teamName, "mt-avatar-img")}</span>
        <div class="mt-id">
          <p class="mt-name">${escapeHtml(t.teamName)}</p>
          ${t.username && !sameName ? `<p class="mt-user">${escapeHtml(t.username)}</p>` : ""}
        </div>
      </div>
      <div class="mt-stats">${stats.join("")}</div>
      ${form}
      ${next ? `<p class="mt-next">${next}</p>` : ""}`;
}

function renderMyTeamCard() {
  const el = document.getElementById("my-team-card");
  if (!el) return;
  const m = myTeamModel();
  if (el.classList && el.classList.toggle) el.classList.toggle("is-mine", m.state === "ok");
  el.innerHTML = myTeamCardHtml(m);
}

// ---------------------------------------------------------------
// Hot & Cold: each team's current run of 2+ wins or losses, longest first, with
// its last seven results beside it.
// ---------------------------------------------------------------
function computeCurrentStreaks(deepWeeks, rosterInfo) {
  const resultsByRoster = teamResultsByRoster(deepWeeks);
  const streaks = [];
  resultsByRoster.forEach((results, rosterId) => {
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
      streaks.push({
        rosterId,
        teamName: info ? info.teamName || info.username : "Unknown",
        username: info ? info.username : null,
        result,
        length: len,
      });
    }
  });
  return streaks.sort((a, b) => b.length - a.length);
}

function streakRowHtml(s) {
  return `
    <div class="streak-row">
      <span class="name"${s.username ? ` data-username="${escapeHtml(s.username)}"` : ""}>${escapeHtml(s.teamName)}</span>
      ${formDotsHtml(HOME.results.get(s.rosterId) || [])}
      <span class="streak-badge ${s.result === "W" ? "hot" : "cold"}">${s.length}${s.result}</span>
    </div>`;
}

function renderStreaksPanel(streaks) {
  const el = document.getElementById("streaks-panel");
  const hot = streaks.filter((s) => s.result === "W").slice(0, 3);
  const cold = streaks.filter((s) => s.result === "L").slice(0, 3);
  if (!hot.length && !cold.length) {
    el.innerHTML = `<div class="empty-state">No streaks of 2+ games yet.</div>`;
    return;
  }
  const section = (rows, label, cls) => (rows.length ? `<div class="hc-head ${cls}">${label}</div>${rows.map(streakRowHtml).join("")}` : "");
  el.innerHTML = section(hot, "Hot", "hot") + section(cold, "Cold", "cold");
}

// ---------------------------------------------------------------
// Power Rankings preview: the top of the table, with each team's move since last
// week, PR Score and playoff odds. The full table is one tap away.
// ---------------------------------------------------------------
const PR_PREVIEW_ROWS = 5;

function rankMoveHtml(row, lastWeekRanks) {
  const flat = `<span class="pr-mini-delta muted-inline">–</span>`;
  if (!lastWeekRanks || lastWeekRanks[row.teamName] == null) return flat;
  const diff = lastWeekRanks[row.teamName] - row.powerRank; // positive = moved up (rank number fell)
  if (diff > 0) return `<span class="pr-mini-delta luck-positive">▲${rankText(diff)}</span>`;
  if (diff < 0) return `<span class="pr-mini-delta luck-negative">▼${rankText(Math.abs(diff))}</span>`;
  return flat;
}

function renderPowerRankingsSnapshot(snapshot, lastWeekRanks) {
  const el = document.getElementById("power-rankings-snapshot");
  const link = document.getElementById("pr-all-link");
  if (!snapshot || !snapshot.rows || !snapshot.rows.length) {
    el.innerHTML = `<div class="empty-state">No power rankings yet.</div>`;
    return;
  }
  if (link) link.textContent = `All ${snapshot.rows.length} →`;

  // Preseason rows are just {rank, username, teamName}: there's no PR Score or
  // playoff odds yet, so it is a plain list of who is ranked where.
  if (snapshot.preseason) {
    el.innerHTML = snapshot.rows
      .slice(0, PR_PREVIEW_ROWS)
      .map(
        (r) => `
      <div class="pr-mini-row pre">
        <span class="pr-mini-rank">${r.rank}</span>
        <span class="pr-mini-name"${r.username ? ` data-username="${escapeHtml(r.username)}"` : ""}>${escapeHtml(r.teamName || r.username)}</span>
        <span class="pr-mini-delta muted-inline">PRESEASON</span>
      </div>`
      )
      .join("");
    return;
  }

  const teamByRoster = new Map(HOME.standings.map((t) => [t.rosterId, t]));
  const top = [...snapshot.rows].sort((a, b) => a.powerRank - b.powerRank).slice(0, PR_PREVIEW_ROWS);
  el.innerHTML = top
    .map((r) => {
      const t = teamByRoster.get(r.rosterId);
      const name = t ? t.teamName : r.teamName;
      const username = t ? t.username : r.teamName;
      return `
      <div class="pr-mini-row">
        <span class="pr-mini-rank">${rankText(r.powerRank)}</span>
        ${rankMoveHtml(r, lastWeekRanks)}
        <span class="pr-mini-name"${username ? ` data-username="${escapeHtml(username)}"` : ""}>${escapeHtml(name)}</span>
        <span class="pr-mini-score">${Number.isFinite(r.prScore) ? r.prScore.toFixed(2) : "—"}</span>
        <span class="pr-mini-pct">${Number.isFinite(r.playoffPct) ? num1(r.playoffPct) + "%" : ""}</span>
      </div>`;
    })
    .join("");
}

// ---------------------------------------------------------------
// The season's weekly results (phase 2). Streaks are computed live (deterministic
// from actual results, nothing random). Power Rankings, playoff odds and the bye
// line come from data/power-rankings-snapshot.json, the same saved-not-live
// snapshot the Power Rankings page reads, so both places show the same numbers
// and they change only when the update script runs. (This used to run an
// unseeded Monte Carlo on every page load: different odds, and a different top
// three, on every refresh.)
//
// When the data lands, everything that uses it is drawn again: Standings (Form,
// Points Against, Avg/Wk, Luck, odds), the matchup cards and the My Team card.
// ---------------------------------------------------------------
async function renderSeasonDetail(league, rosters, users, week, playerDirectory, teamStrength) {
  try {
    const seasonEntry = { league, rosters, users, bracket: [] };
    const [deep, snapshot, powerRankHistory] = await Promise.all([
      DeepHistory.fetchSeasonDeep(seasonEntry, () => {}),
      fetchJsonSafe(POWER_RANKINGS_SNAPSHOT_FILE, null),
      fetchJsonSafe(POWER_RANK_HISTORY_FILE, { seasons: {} }),
    ]);

    // Only finished weeks, so Overall, Luck, Avg and the form dots cover the same
    // weeks as the Record and PF beside them. Before any week is final there's nothing to add.
    const finishedWeeks = onlyCompletedWeeks(deep.weeks, HOME.completed);
    HOME.results = teamResultsByRoster(finishedWeeks);
    HOME.summary = null;
    HOME.avgByRoster = new Map();
    if (finishedWeeks.length) {
      try {
        const summary = DeepHistory.computeSeasonSummary(seasonEntry, { ...deep, weeks: finishedWeeks }, playerDirectory, null, null, null);
        HOME.summary = summary;
        (summary.teamAverages || []).forEach((t) => {
          if (t.rosterId != null) HOME.avgByRoster.set(t.rosterId, t.average);
        });
      } catch (err) {
        // Best-effort: the first-pass table is still correct, just missing a few columns.
        console.warn("Couldn't build the season summary for Home's standings:", err);
      }
    }

    HOME.snapshot = snapshot || null;
    HOME.powerByRoster = new Map();
    HOME.lastWeekRanks = null;
    if (snapshot && !snapshot.preseason && Array.isArray(snapshot.rows)) {
      snapshot.rows.forEach((r) => HOME.powerByRoster.set(r.rosterId, r));
      const seasonHistory = (powerRankHistory.seasons && powerRankHistory.seasons[String(snapshot.season)]) || {};
      HOME.lastWeekRanks = seasonHistory[String(snapshot.week - 1)] || null;
    }

    if (finishedWeeks.length) {
      const usersById = new Map(users.map((u) => [u.user_id, u]));
      const rosterInfo = new Map();
      rosters.forEach((r) => {
        const user = usersById.get(r.owner_id);
        rosterInfo.set(r.roster_id, { teamName: SleeperAPI.teamName(user, r.roster_id), username: user ? user.display_name : null });
      });
      renderStreaksPanel(computeCurrentStreaks(finishedWeeks, rosterInfo));
    } else {
      document.getElementById("streaks-panel").innerHTML = `<div class="empty-state">No finished games yet — streaks start after Week 1.</div>`;
    }

    renderPowerRankingsSnapshot(snapshot, HOME.lastWeekRanks);
    setChip(
      "pr-fresh",
      snapshot && !snapshot.preseason
        ? freshnessChipHtml({ label: "Snapshot", through: snapshot.week, current: week, note: "updates with each ROS refresh" })
        : snapshot
        ? freshnessChipHtml({ label: "Preseason", tone: "snap" })
        : ""
    );

    renderStandings();
    renderStandingsNotes();
    redrawMatchups();
    renderMyTeamCard();
    if (typeof MyTeam !== "undefined") MyTeam.decorate(document.body);
  } catch (err) {
    console.error(err);
    document.getElementById("streaks-panel").innerHTML = `<div class="empty-state">Couldn't load streak data.</div>`;
    document.getElementById("power-rankings-snapshot").innerHTML = `<div class="empty-state">Couldn't load power rankings.</div>`;
  }
}

// Draws This Week, the Featured Matchup and Last Week again from what is in HOME.
function redrawMatchups() {
  renderMatchupsAndFeatured(HOME.rawMatchups, HOME.standings, HOME.week);
  renderLastWeekMatchups(HOME.rawMatchupsLast, HOME.standings, HOME.week && HOME.week > 1 ? HOME.week - 1 : null);
}

// Reads every manager's all-time record against every other (the same
// fetchSeasonChain -> buildAll -> computeStats pipeline Teams, Records and
// Rivalries use). It is a real network-and-compute cost, so it runs last, in the
// background, after everything the person came here to see is on screen; the
// cards and the My Team card then draw again with the all-time series filled in.
// The series lines use usernames, not team names.
async function renderMatchupHeadToHead(playerDirectory) {
  try {
    const seasonChain = await SleeperAPI.getSeasonChain(LEAGUE_ID);
    if (seasonChain.length === 0) return;
    const deepSeasons = await DeepHistory.buildAll(seasonChain, () => {});
    const { managers } = DeepHistory.computeStats(seasonChain, deepSeasons, playerDirectory);
    HOME.h2h = {
      rec: new Map(
        managers.map((m) => [m.userId, new Map((m.headToHead || []).map((h) => [h.opponentUserId, { wins: h.wins, losses: h.losses, ties: h.ties }]))])
      ),
      name: new Map(managers.map((m) => [m.userId, m.username || m.teamName])),
    };
    renderMatchupsAndFeatured(HOME.rawMatchups, HOME.standings, HOME.week);
    renderMyTeamCard();
    if (typeof MyTeam !== "undefined") MyTeam.decorate(document.body);
  } catch (err) {
    // Best-effort enhancement -- everything above already rendered fine without
    // it, so a failure here (e.g. a season in the chain failing to fetch) just
    // means the series lines stay empty, not an error banner over working data.
    console.warn("Couldn't load head-to-head history for this week's matchups:", err);
  }
}

// ---------------------------------------------------------------
// My team on Home: the picked manager's game goes first and the pieces that
// depend on who it is are drawn again. The row highlight itself is
// js/my-team.js's job.
// ---------------------------------------------------------------
function applyMyTeam() {
  renderLeaguePulse();
  redrawMatchups();
  renderMyTeamCard();
  if (HOME.feed) renderRecordsInReach(HOME.feed);
  if (typeof MyTeam !== "undefined") MyTeam.decorate(document.body);
}

if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("myteam:change", applyMyTeam);
  // On a phone, remember which matchup cards were opened so a redraw keeps them open.
  document.addEventListener(
    "toggle",
    (e) => {
      const card = e.target;
      if (!card || !card.classList || !card.classList.contains("mu-card") || !isPhoneWidth()) return;
      if (card.open) openMatchupCards.add(card.id);
      else openMatchupCards.delete(card.id);
    },
    true
  );
}
if (typeof window !== "undefined" && window.matchMedia) {
  const phoneQuery = window.matchMedia(MU_PHONE_QUERY);
  if (phoneQuery && phoneQuery.addEventListener) phoneQuery.addEventListener("change", syncMatchupCards);
}

document.addEventListener("DOMContentLoaded", renderDashboard);

