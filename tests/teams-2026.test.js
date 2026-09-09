const test = require("node:test");
const assert = require("node:assert");
const { loadSiteModules } = require("./helpers/site-env.js");

function setup() {
  return loadSiteModules(["config.js", "utils.js", "sleeper-api.js", "2026.js"]);
}

const ROSTER_POSITIONS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K", "BN", "BN", "BN"];

function fakeRoster(overrides) {
  return {
    roster_id: 1,
    owner_id: "u1",
    players: ["p_qb", "p_rb1", "p_rb2", "p_wr1", "p_wr2", "p_te", "p_flex", "p_def", "p_k", "p_bench1", "p_bench2"],
    starters: ["p_qb", "p_rb1", "p_rb2", "p_wr1", "p_wr2", "p_te", "p_flex", "p_def", "p_k"],
    metadata: null,
    ...overrides,
  };
}

const PLAYER_DIRECTORY = {
  p_qb: { full_name: "Quinn Backer", position: "QB", team: "SF" },
  p_rb1: { full_name: "Randy Bacon", position: "RB", team: "KC" },
};

test("buildRosterGroups: splits starters (in roster_positions slot order, non-BN only) from bench, labeling each starter slot", () => {
  const ctx = setup();
  const roster = fakeRoster();
  const { starterRows, benchIds } = ctx.buildRosterGroups(roster, ROSTER_POSITIONS);
  assert.strictEqual(starterRows.length, 9, "9 non-BN slots in the fixture roster_positions");
  assert.deepStrictEqual(
    starterRows.map((r) => r.slot),
    ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DEF", "K"]
  );
  assert.strictEqual(starterRows[0].playerId, "p_qb");
  assert.deepStrictEqual(benchIds, ["p_bench1", "p_bench2"]);
});

test("buildRosterGroups: a starter slot with no player yet renders as null, not skipped or shifted", () => {
  const ctx = setup();
  const roster = fakeRoster({ starters: ["p_qb", "", "p_rb2"] }); // Sleeper uses "" for an empty slot, not always undefined
  const { starterRows } = ctx.buildRosterGroups(roster, ROSTER_POSITIONS);
  assert.strictEqual(starterRows[0].playerId, "p_qb");
  assert.strictEqual(starterRows[1].playerId, null, "an empty slot should be null, not an empty string, so the caller's `if (!playerId)` check catches it");
  assert.strictEqual(starterRows[2].playerId, "p_rb2");
});

test("buildRosterGroups: handles a missing roster (no players fetched yet) without throwing", () => {
  const ctx = setup();
  const { starterRows, benchIds } = ctx.buildRosterGroups(null, ROSTER_POSITIONS);
  assert.strictEqual(starterRows.length, 9);
  assert.ok(starterRows.every((r) => r.playerId === null));
  assert.strictEqual(benchIds.length, 0); // deepStrictEqual against [] fails here: benchIds is an Array from the VM's own realm, a different constructor than this file's own Array
});

test("nicknameFor: reads a league-assigned nickname from the roster's own metadata, keyed by player ID", () => {
  const ctx = setup();
  const roster = fakeRoster({ metadata: { p_nick_p_qb: "Gabraham Lincoln 🎩" } });
  assert.strictEqual(ctx.nicknameFor(roster, "p_qb"), "Gabraham Lincoln 🎩");
});

test("nicknameFor: returns null (not undefined, not an empty string) for a player with no nickname set", () => {
  const ctx = setup();
  const roster = fakeRoster({ metadata: { p_nick_p_qb: "Something" } });
  assert.strictEqual(ctx.nicknameFor(roster, "p_rb1"), null);
});

test("nicknameFor: treats a blank/whitespace nickname the same as no nickname — Sleeper stores cleared nicknames as empty strings, not missing keys", () => {
  const ctx = setup();
  const roster = fakeRoster({ metadata: { p_nick_p_qb: "", p_nick_p_rb1: "   " } });
  assert.strictEqual(ctx.nicknameFor(roster, "p_qb"), null);
  assert.strictEqual(ctx.nicknameFor(roster, "p_rb1"), null);
});

test("nicknameFor: handles a roster with no metadata at all without throwing", () => {
  const ctx = setup();
  assert.strictEqual(ctx.nicknameFor(fakeRoster({ metadata: null }), "p_qb"), null);
  assert.strictEqual(ctx.nicknameFor(null, "p_qb"), null);
});

test("renderRosterPlayerCard: renders a placeholder for an empty slot rather than a broken player card", () => {
  const ctx = setup();
  const html = ctx.renderRosterPlayerCard(null, "QB", [], PLAYER_DIRECTORY);
  assert.ok(html.includes("empty"));
  assert.ok(!html.includes("player-photo-wrap"), "no photo markup at all for an empty slot");
});

test("renderRosterPlayerCard: shows the player's name, position, team, and slot label", () => {
  const ctx = setup();
  const html = ctx.renderRosterPlayerCard("p_qb", "QB", [], PLAYER_DIRECTORY);
  assert.ok(html.includes("Quinn Backer"));
  assert.ok(html.includes("QB"));
  assert.ok(html.includes("SF"));
});

test("renderRosterPlayerCard: suppresses a slot label that just repeats the position (a plain QB starter doesn't need 'QB · QB'), but keeps one that says something new (FLEX)", () => {
  const ctx = setup();
  const plainSlot = ctx.renderRosterPlayerCard("p_qb", "QB", [], PLAYER_DIRECTORY);
  const metaLine = plainSlot.match(/team-2026-player-meta">([^<]*)</)[1];
  assert.strictEqual(metaLine, "QB · SF", "slot label dropped since it's identical to the position");

  const flexSlot = ctx.renderRosterPlayerCard("p_rb1", "FLEX", [], PLAYER_DIRECTORY);
  const flexMetaLine = flexSlot.match(/team-2026-player-meta">([^<]*)</)[1];
  assert.strictEqual(flexMetaLine, "RB · KC · FLEX", "FLEX is genuinely informative, so it stays");
});

test("renderRosterPlayerCard: shows where the player was drafted when a matching pick exists", () => {
  const ctx = setup();
  const picks = [{ player_id: "p_qb", round: 1, pick_no: 3 }];
  const html = ctx.renderRosterPlayerCard("p_qb", null, picks, PLAYER_DIRECTORY);
  assert.ok(html.includes("Rd 1, Pick 3"));
});

test("renderRosterPlayerCard: omits draft info for a player with no matching pick (e.g. a waiver add)", () => {
  const ctx = setup();
  const html = ctx.renderRosterPlayerCard("p_qb", null, [], PLAYER_DIRECTORY);
  assert.ok(!html.includes("team-2026-player-pick"));
});

test("renderRosterPlayerCard: falls back to 'Unknown' for a player ID that isn't in the directory, rather than throwing or showing 'undefined'", () => {
  const ctx = setup();
  const html = ctx.renderRosterPlayerCard("p_ghost", null, [], PLAYER_DIRECTORY);
  assert.ok(html.includes("Unknown"));
  assert.ok(!html.includes("undefined"));
});

test("renderRosterPlayerCard: shows the player's real name AND their league-assigned nickname, in quotes, when one exists", () => {
  const ctx = setup();
  const roster = fakeRoster({ metadata: { p_nick_p_qb: "Gabraham Lincoln 🎩" } });
  const html = ctx.renderRosterPlayerCard("p_qb", "QB", [], PLAYER_DIRECTORY, roster);
  assert.ok(html.includes("Quinn Backer"), "real name still shown");
  assert.ok(html.includes('"Gabraham Lincoln 🎩"'), "nickname shown in quotes");
});

test("renderRosterPlayerCard: omits the nickname tag entirely when the player has none — no empty quotes left behind", () => {
  const ctx = setup();
  const roster = fakeRoster({ metadata: {} });
  const html = ctx.renderRosterPlayerCard("p_qb", "QB", [], PLAYER_DIRECTORY, roster);
  assert.ok(!html.includes("team-2026-nickname"));
});

test("renderRosterPlayerCard: nicknames are shown as-is, unfiltered, including crude/NSFW ones — this is the league's own data, displayed at the user's explicit request", () => {
  const ctx = setup();
  const roster = fakeRoster({ metadata: { p_nick_p_qb: "My Hoe" } });
  const html = ctx.renderRosterPlayerCard("p_qb", "QB", [], PLAYER_DIRECTORY, roster);
  assert.ok(html.includes('"My Hoe"'));
});

test("renderTopPicksTrio: renders nothing at all when the draft hasn't happened yet (no picks for this team)", () => {
  const ctx = setup();
  const html = ctx.renderTopPicksTrio(1, "Test Team", [], PLAYER_DIRECTORY, "2026");
  assert.strictEqual(html, "");
});

test("renderTopPicksTrio: shows exactly the first 3 picks (by pick order), not all of them", () => {
  const ctx = setup();
  const picks = [
    { player_id: "p_qb", round: 1, pick_no: 1 },
    { player_id: "p_rb1", round: 2, pick_no: 11 },
    { player_id: "p1", round: 3, pick_no: 21 },
    { player_id: "p2", round: 4, pick_no: 31 },
  ];
  const html = ctx.renderTopPicksTrio(1, "Test Team", picks, { ...PLAYER_DIRECTORY, p1: { full_name: "Third Pick" }, p2: { full_name: "Fourth Pick" } }, "2026");
  assert.ok(html.includes("Quinn Backer"));
  assert.ok(html.includes("Randy Bacon"));
  assert.ok(html.includes("Third Pick"));
  assert.ok(!html.includes("Fourth Pick"), "only the top 3 picks should be shown");
});

test("renderTopPicksTrio: the image slot's path is keyed by season and roster ID, and has a graceful fallback wired up via onerror", () => {
  const ctx = setup();
  const picks = [{ player_id: "p_qb", round: 1, pick_no: 1 }];
  const html = ctx.renderTopPicksTrio(7, "Test Team", picks, PLAYER_DIRECTORY, "2026");
  assert.ok(html.includes("data/team-photos/2026-7.jpg"), "photo path should be season- and roster-specific");
  assert.ok(html.includes("onerror="), "missing photo should fall back gracefully, not show a broken image icon");
});

test("renderTopPicksTrio: shows a player's nickname (from the roster's metadata) in the featured trio too, not just the roster grid", () => {
  const ctx = setup();
  const roster = fakeRoster({ metadata: { p_nick_p_qb: "God of Winning" } });
  const picks = [{ player_id: "p_qb", round: 1, pick_no: 1 }];
  const html = ctx.renderTopPicksTrio(1, "Test Team", picks, PLAYER_DIRECTORY, "2026", roster);
  assert.ok(html.includes('"God of Winning"'));
});

test("trioPlayerName: prefers the player directory's name, falling back to the draft pick's own metadata name when the player isn't in the directory", () => {
  const ctx = setup();
  const fromDirectory = ctx.trioPlayerName({ player_id: "p_qb", metadata: { first_name: "Wrong", last_name: "Name" } }, PLAYER_DIRECTORY);
  assert.strictEqual(fromDirectory, "Quinn Backer");

  const fromMetadata = ctx.trioPlayerName({ player_id: "p_ghost", metadata: { first_name: "Meta", last_name: "Data" } }, PLAYER_DIRECTORY);
  assert.strictEqual(fromMetadata, "Meta Data");

  const withNeither = ctx.trioPlayerName({ player_id: "p_ghost", metadata: {} }, PLAYER_DIRECTORY);
  assert.strictEqual(withNeither, "Unknown");
});

test("renderTeamJumpNav: one pill per team, linking to that team's section anchor", () => {
  const ctx = setup();
  ctx.document.getElementById("team-jump-nav"); // ensure the fake element exists in the harness's map
  const standings = [
    { rosterId: 1, username: "alice", teamName: "Alice's Team" },
    { rosterId: 2, username: null, teamName: "Bob's Team" }, // no Sleeper username set — should fall back to the team name
  ];
  ctx.renderTeamJumpNav(standings);
  const html = ctx.document.getElementById("team-jump-nav").innerHTML;
  assert.ok(html.includes('href="#team-1"') && html.includes("alice"));
  assert.ok(html.includes('href="#team-2"') && html.includes("Bob&#39;s Team")); // escapeHtml turns the apostrophe into an entity
});

test("renderTeamSection: shows the record without a trailing '-0' when there are no ties, but includes ties when there are any", () => {
  const ctx = setup();
  const standingsEntry = { rosterId: 1, teamName: "Test", username: "test", avatar: null, wins: 8, losses: 5, ties: 0, fpts: 1000, fptsAgainst: 950 };
  const league = { roster_positions: ROSTER_POSITIONS };
  const html = ctx.renderTeamSection(standingsEntry, fakeRoster(), league, [], PLAYER_DIRECTORY, "2026");
  assert.ok(html.includes(">8-5<"), "no '-0' suffix for zero ties");

  const withTies = { ...standingsEntry, ties: 1 };
  const htmlWithTies = ctx.renderTeamSection(withTies, fakeRoster(), league, [], PLAYER_DIRECTORY, "2026");
  assert.ok(htmlWithTies.includes(">8-5-1<"));
});

test("renderTeamSection: shows the manager's Sleeper username as the main heading and the fun team name as a subtitle, only when they differ", () => {
  const ctx = setup();
  const league = { roster_positions: ROSTER_POSITIONS };
  const standingsEntry = { rosterId: 1, teamName: "The Fun Name", username: "realuser", avatar: null, wins: 0, losses: 0, ties: 0, fpts: 0, fptsAgainst: 0 };
  const html = ctx.renderTeamSection(standingsEntry, fakeRoster(), league, [], PLAYER_DIRECTORY, "2026");
  assert.ok(html.includes("realuser"));
  assert.ok(html.includes("The Fun Name"));

  // No Sleeper username at all (falls back to the team name for the
  // heading) -- shouldn't then ALSO repeat the team name as a subtitle.
  const noUsername = { ...standingsEntry, username: null };
  const html2 = ctx.renderTeamSection(noUsername, fakeRoster(), league, [], PLAYER_DIRECTORY, "2026");
  const occurrences = html2.split("The Fun Name").length - 1;
  assert.strictEqual(occurrences, 1, "the team name shouldn't be shown twice when there's no separate username");
});

test("renderTeamSection: includes an anchor matching the roster ID, for the jump nav to link to", () => {
  const ctx = setup();
  const league = { roster_positions: ROSTER_POSITIONS };
  const standingsEntry = { rosterId: 42, teamName: "Test", username: "test", avatar: null, wins: 0, losses: 0, ties: 0, fpts: 0, fptsAgainst: 0 };
  const html = ctx.renderTeamSection(standingsEntry, fakeRoster({ roster_id: 42 }), league, [], PLAYER_DIRECTORY, "2026");
  assert.ok(html.includes('id="team-42"'));
});

test("renderTeamSection: omits the Bench heading entirely when every rostered player is a starter (a short/incomplete roster)", () => {
  const ctx = setup();
  const league = { roster_positions: ["QB", "BN"] };
  const roster = { roster_id: 1, players: ["p_qb"], starters: ["p_qb"] };
  const standingsEntry = { rosterId: 1, teamName: "Test", username: "test", avatar: null, wins: 0, losses: 0, ties: 0, fpts: 0, fptsAgainst: 0 };
  const html = ctx.renderTeamSection(standingsEntry, roster, league, [], PLAYER_DIRECTORY, "2026");
  assert.ok(!html.includes(">Bench<"));
});
