/*
  ============================================================
  SLEEPER API WRAPPER
  ============================================================
  Talks directly to Sleeper's public, read-only API from the
  visitor's browser (https://api.sleeper.app/v1). No key needed.
  This is why the site is always up to date: every page load
  pulls fresh data straight from Sleeper.

  Docs: https://docs.sleeper.com/
*/

const SLEEPER_BASE = "https://api.sleeper.app/v1";

// Simple in-memory cache, scoped to this page view only (not persisted
// across reloads — freshness matters more than speed here, and it keeps
// us from hitting the same endpoint twice while rendering one page).
const _cache = new Map();

async function sleeperGet(path) {
  if (_cache.has(path)) return _cache.get(path);
  const res = await fetch(`${SLEEPER_BASE}${path}`);
  if (!res.ok) {
    throw new Error(`Sleeper API error ${res.status} on ${path}`);
  }
  const data = await res.json();
  _cache.set(path, data);
  return data;
}

const SleeperAPI = {
  getLeague: (leagueId) => sleeperGet(`/league/${leagueId}`),
  getRosters: (leagueId) => sleeperGet(`/league/${leagueId}/rosters`),
  getUsers: (leagueId) => sleeperGet(`/league/${leagueId}/users`),
  getMatchups: (leagueId, week) => sleeperGet(`/league/${leagueId}/matchups/${week}`),
  getWinnersBracket: (leagueId) => sleeperGet(`/league/${leagueId}/winners_bracket`),
  getTransactions: (leagueId, week) => sleeperGet(`/league/${leagueId}/transactions/${week}`),
  getNflState: () => sleeperGet(`/state/nfl`),
  getDrafts: (leagueId) => sleeperGet(`/league/${leagueId}/drafts`),
  getDraftPicks: (draftId) => sleeperGet(`/draft/${draftId}/picks`),

  /*
    The full NFL player directory is ~5MB and Sleeper explicitly asks
    that it not be fetched more than once a day per client, so this is
    cached in localStorage (not the in-memory _cache, which resets on
    every page load) with a timestamp. Reused across every page and
    every visit until it's a week old.
  */
  async getPlayerDirectory() {
    const CACHE_KEY = "sleeper_players_nfl_v1";
    const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) {
        return cached.players;
      }
    } catch (err) {
      // corrupt cache entry — fall through and refetch
    }
    const players = await sleeperGet(`/players/nfl`);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), players }));
    } catch (err) {
      console.warn("Couldn't cache player directory (localStorage full/unavailable):", err);
    }
    return players;
  },

  playerName(playerDirectory, playerId) {
    const p = playerDirectory && playerDirectory[playerId];
    if (!p) return playerId === "0" ? "Empty" : `Unknown Player (${playerId})`;
    return p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || playerId;
  },

  avatarUrl(avatarId, thumb = true) {
    if (!avatarId) return null;
    return `https://sleepercdn.com/avatars/${thumb ? "thumbs/" : ""}${avatarId}`;
  },

  // Prefer a manager's custom team name if they set one, fall back to
  // their Sleeper display name, then to a generic label.
  teamName(user, rosterId) {
    if (!user) return `Team ${rosterId ?? "?"}`;
    return (user.metadata && user.metadata.team_name) || user.display_name || `Team ${rosterId ?? "?"}`;
  },

  /*
    Walks backwards through a league's season history using Sleeper's
    own previous_league_id chain, starting at the given (current)
    league ID. Returns an array of { league, rosters, users, bracket }
    ordered OLDEST -> NEWEST. Stops when previous_league_id is empty,
    missing, or "0". Caps at 40 seasons as a safety net against a
    corrupt/circular chain.
  */
  async getSeasonChain(startLeagueId) {
    const seasons = [];
    let currentId = startLeagueId;
    let guard = 0;

    while (currentId && currentId !== "0" && guard < 40) {
      guard++;
      let league;
      try {
        league = await SleeperAPI.getLeague(currentId);
      } catch (err) {
        console.warn(`Stopped walking season chain at ${currentId}:`, err);
        break;
      }
      if (!league) break;

      const [rosters, users, bracket] = await Promise.all([
        SleeperAPI.getRosters(currentId).catch(() => []),
        SleeperAPI.getUsers(currentId).catch(() => []),
        SleeperAPI.getWinnersBracket(currentId).catch(() => []),
      ]);

      seasons.push({ league, rosters, users, bracket });
      currentId = league.previous_league_id;
    }

    return seasons.reverse(); // oldest -> newest
  },

  /*
    Given a winners_bracket response, find the championship game and
    return its winning roster_id, or null if the season isn't finished
    (or the league doesn't use Sleeper's bracket feature).
  */
  findChampionRosterId(bracket) {
    if (!Array.isArray(bracket) || bracket.length === 0) return null;
    // Sleeper marks the game that decides 1st place with p: 1.
    const finalGame = bracket.find((g) => g.p === 1);
    if (finalGame && finalGame.w != null) return finalGame.w;
    return null;
  },

  // Same idea as findChampionRosterId, but the loser of the championship game.
  findRunnerUpRosterId(bracket) {
    if (!Array.isArray(bracket) || bracket.length === 0) return null;
    const finalGame = bracket.find((g) => g.p === 1);
    if (finalGame && finalGame.l != null) return finalGame.l;
    return null;
  },

  // Same idea again, but the WINNER of the 3rd-place game (Sleeper marks
  // that game with p: 3). Returns null if the league doesn't play one.
  findThirdPlaceRosterId(bracket) {
    if (!Array.isArray(bracket) || bracket.length === 0) return null;
    const thirdPlaceGame = bracket.find((g) => g.p === 3);
    if (thirdPlaceGame && thirdPlaceGame.w != null) return thirdPlaceGame.w;
    return null;
  },

  // Resolves the roster_id in a bracket game's t1/t2 slot, following
  // t1_from/t2_from (winner-of or loser-of an earlier game) when that
  // slot isn't filled in directly yet.
  resolveBracketTeamId(bracket, game, slotKey) {
    if (game[slotKey] != null) return game[slotKey];
    const from = game[slotKey + "_from"];
    if (!from) return null;
    const gameById = new Map(bracket.map((g) => [g.m, g]));
    if (from.w != null) {
      const src = gameById.get(from.w);
      return src ? src.w : null;
    }
    if (from.l != null) {
      const src = gameById.get(from.l);
      return src ? src.l : null;
    }
    return null;
  },

  // Returns { round, t1Id, t2Id } for the 5th-place game (Sleeper marks
  // it with p: 5), or null if the league doesn't play one. Used to leave
  // it out of the bracket display and out of Playoff Head-to-Head.
  findFifthPlaceGame(bracket) {
    if (!Array.isArray(bracket) || bracket.length === 0) return null;
    const game = bracket.find((g) => g.p === 5);
    if (!game) return null;
    return {
      round: game.r,
      t1Id: SleeperAPI.resolveBracketTeamId(bracket, game, "t1"),
      t2Id: SleeperAPI.resolveBracketTeamId(bracket, game, "t2"),
    };
  },

  // Walks backward from the championship (p:1) and 3rd-place (p:3) games
  // through their t1_from/t2_from references to find every earlier-round
  // game that's genuinely on the path to a top-3 finish. Anything NOT
  // reached this way (the 5th-place game and whatever consolation games
  // feed only into it) is not "relevant" — this is what lets the site
  // know which playoff weeks actually count for a given team once
  // they're no longer in contention for 1st or 3rd.
  relevantBracketGames(bracket) {
    if (!Array.isArray(bracket) || bracket.length === 0) return [];
    const gameById = new Map(bracket.map((g) => [g.m, g]));
    const relevant = new Set();
    function markRelevant(matchupId) {
      if (matchupId == null || relevant.has(matchupId)) return;
      const game = gameById.get(matchupId);
      if (!game) return;
      relevant.add(matchupId);
      [game.t1_from, game.t2_from].forEach((from) => {
        if (!from) return;
        if (from.w != null) markRelevant(from.w);
        if (from.l != null) markRelevant(from.l);
      });
    }
    const champGame = bracket.find((g) => g.p === 1);
    const thirdGame = bracket.find((g) => g.p === 3);
    if (champGame) markRelevant(champGame.m);
    if (thirdGame) markRelevant(thirdGame.m);
    return bracket.filter((g) => relevant.has(g.m));
  },

  // Builds a standings array: [{ rosterId, userId, teamName, username, avatar,
  // wins, losses, ties, fpts, fptsAgainst }], sorted by wins then points.
  buildStandings(rosters, users) {
    const usersById = new Map(users.map((u) => [u.user_id, u]));
    return rosters
      .map((r) => {
        const user = usersById.get(r.owner_id);
        const s = r.settings || {};
        return {
          rosterId: r.roster_id,
          userId: r.owner_id,
          teamName: SleeperAPI.teamName(user, r.roster_id),
          username: user ? user.display_name : null,
          avatar: user ? SleeperAPI.avatarUrl(user.avatar) : null,
          wins: s.wins || 0,
          losses: s.losses || 0,
          ties: s.ties || 0,
          fpts: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
          fptsAgainst: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
        };
      })
      .sort((a, b) => (b.wins - a.wins) || (b.fpts - a.fpts));
  },
};
