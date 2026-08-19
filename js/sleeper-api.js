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

  // Builds a standings array: [{ rosterId, userId, teamName, avatar, wins,
  // losses, ties, fpts, fptsAgainst }], sorted by wins then points.
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
