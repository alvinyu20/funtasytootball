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

/*
  Static backup access (data/sleeper-archive/, refreshed weekly by the data
  pipeline). A finished season can't change on Sleeper's end, so the backup
  is exactly as correct as asking Sleeper again and far faster: one
  same-origin file instead of a chain of live requests. Each file is only
  fetched once per page view, however many callers ask for it.
*/
const _archiveCache = new Map();
function archiveFetchOnce(key, path) {
  if (!_archiveCache.has(key)) _archiveCache.set(key, fetchJsonSafe(path, null));
  return _archiveCache.get(key);
}

// The only player-directory fields the site reads (every page, checked by
// running them against a directory that logs what gets touched).
const SLIM_PLAYER_FIELDS = ["full_name", "first_name", "last_name", "position", "team"];
// Positions a fantasy roster in this league can hold. Anyone else only
// makes the slim directory by appearing in the league's own history (the
// build script passes those ids in as keepIds).
const SLIM_PLAYER_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "FB"];

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
    The player directory (player ID -> name/position/team) every page uses
    to turn IDs into names.

    Sleeper's full directory is ~14 MB unzipped (about 2 MB over the wire).
    That is too big for localStorage, so caching it silently failed and every
    page on every visit downloaded it again. The pages only ever read five
    fields from it, so the weekly data pipeline writes a slim copy
    (data/players-slim.json, ~80 KB zipped, see scripts/build-fast-data.js)
    and that is what gets loaded now.

    If the slim file is missing, this falls back to the old route (browser
    cache, then Sleeper live, then the repo's full backup) but trims the
    result to the slim fields, so at least the browser cache works.
  */
  async getPlayerDirectory() {
    const slimPath = typeof PLAYERS_SLIM_FILE === "string" ? PLAYERS_SLIM_FILE : "data/players-slim.json";
    const slimFile = await fetchJsonSafe(slimPath, null);
    if (slimFile && slimFile.players && typeof slimFile.players === "object") return slimFile.players;

    const CACHE_KEY = "sleeper_players_nfl_v2";
    const MAX_AGE_MS = 24 * 60 * 60 * 1000; // Sleeper asks for at most one full download a day per client
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached && cached.players && Date.now() - cached.fetchedAt < MAX_AGE_MS) {
        return cached.players;
      }
    } catch (err) {
      // corrupt cache entry — fall through and refetch
    }

    let players;
    try {
      players = await sleeperGet(`/players/nfl`);
    } catch (err) {
      // Sleeper's live API is unreachable — fall back to this site's own
      // backed-up copy (see scripts/backup-sleeper-data.js) rather than
      // failing outright. It won't be as fresh as a live fetch (new
      // players, updated teams), but a slightly-stale player directory
      // is far better than the whole site being unable to render
      // anything at all over one failed request.
      const archived = await fetchJsonSafe("data/sleeper-archive/players.json", null);
      if (!archived) throw err; // nothing to fall back to — surface the original error
      players = archived;
    }

    const slim = SleeperAPI.slimPlayerDirectory(players);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), players: slim }));
    } catch (err) {
      console.warn("Couldn't cache player directory (localStorage full/unavailable):", err);
    }
    return slim;
  },

  // Trims a full Sleeper player directory to the fields the site reads and
  // to the players a roster here could hold. `positions` adds extra
  // positions (say, IDP slots); `keepIds` keeps those players whatever their
  // position. Entries keep the full directory's order.
  slimPlayerDirectory(players, { positions = [], keepIds = [] } = {}) {
    const wanted = new Set([...SLIM_PLAYER_POSITIONS, ...positions]);
    const keep = new Set(Array.from(keepIds, String));
    const out = {};
    Object.keys(players || {}).forEach((pid) => {
      const p = players[pid];
      if (!p || typeof p !== "object") return;
      const alsoPlays = Array.isArray(p.fantasy_positions) ? p.fantasy_positions : [];
      if (!keep.has(pid) && !wanted.has(p.position) && !alsoPlays.some((x) => wanted.has(x))) return;
      const entry = {};
      SLIM_PLAYER_FIELDS.forEach((f) => {
        if (p[f] != null && p[f] !== "") entry[f] = p[f];
      });
      out[pid] = entry;
    });
    return out;
  },

  // The whole saved list of seasons in the backup, or null if there is none.
  getArchiveIndex() {
    const file = typeof SLEEPER_ARCHIVE_INDEX_FILE === "string" ? SLEEPER_ARCHIVE_INDEX_FILE : "data/sleeper-archive/index.json";
    return archiveFetchOnce("index", file).then((idx) => (Array.isArray(idx) ? idx : null));
  },

  // The backed-up copy of one season, or null when there isn't one the site
  // can trust: no file, a different league, or a copy saved before the
  // season finished (status not "complete") that the weekly backup hasn't
  // refreshed yet.
  async getArchivedSeason(season, leagueId) {
    const data = await archiveFetchOnce(`season:${season}`, `data/sleeper-archive/${season}.json`);
    const league = data && data.league;
    if (!league || league.status !== "complete") return null;
    if (leagueId != null && String(league.league_id) !== String(leagueId)) return null;
    return data;
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

  // The picture Sleeper shows for a team in this league: the team's own upload
  // when the manager set one (user.metadata.avatar is already a full URL), else
  // their profile picture at full size. null when there is neither.
  teamAvatarUrl(user) {
    if (!user) return null;
    const own = user.metadata && user.metadata.avatar;
    if (typeof own === "string" && /^https:\/\//.test(own)) return own;
    return SleeperAPI.avatarUrl(user.avatar, false);
  },

  // Undocumented but well-established Sleeper CDN pattern for player
  // headshots (mirrors the avatar URL convention above). Not every player
  // has a photo (notably team defenses), so callers should handle a
  // failed image load gracefully — see utils.js's playerPhotoHtml().
  playerImageUrl(playerId) {
    if (!playerId) return null;
    return `https://sleepercdn.com/content/nfl/players/${playerId}.jpg`;
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

    The starting (current) league always comes live from Sleeper. Every
    earlier season that the backup holds as finished (see getArchiveIndex /
    getArchivedSeason) is read from the backup instead, all downloaded in
    parallel, with no Sleeper requests at all. A season the backup doesn't
    have, or has only mid-season, is fetched live exactly as before.
  */
  async getSeasonChain(startLeagueId) {
    const seasons = [];
    const fromBackup = []; // positions in `seasons` that were read from the backup
    let currentId = startLeagueId;
    let guard = 0;

    // Start the backup downloads as soon as the (tiny) index arrives, in
    // parallel with the live request for the current league below.
    const indexPromise = SleeperAPI.getArchiveIndex();
    indexPromise
      .then((idx) => {
        (idx || []).forEach((e) => {
          if (e && e.status === "complete" && e.season != null) SleeperAPI.getArchivedSeason(e.season, e.leagueId);
        });
      })
      .catch(() => {});
    let index = null;

    while (currentId && currentId !== "0" && guard < 40) {
      guard++;

      if (seasons.length > 0) {
        if (index === null) index = (await indexPromise) || [];
        const hit = index.find((e) => e && String(e.leagueId) === String(currentId));
        const data = hit ? await SleeperAPI.getArchivedSeason(hit.season, currentId) : null;
        if (data && Array.isArray(data.rosters) && Array.isArray(data.users)) {
          seasons.push({ league: data.league, rosters: data.rosters, users: data.users, bracket: data.bracket || [] });
          fromBackup.push(seasons.length - 1);
          currentId = data.league.previous_league_id;
          continue;
        }
      }

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

    // Sleeper's league-users list always shows a manager's CURRENT display
    // name and avatar, even for an old season. The backup froze those at
    // backup time, so bring them up to date from the live current league
    // (team names stay per season, as they are on Sleeper).
    if (fromBackup.length && seasons[0] && !fromBackup.includes(0)) {
      const live = new Map((seasons[0].users || []).map((u) => [u.user_id, u]));
      fromBackup.forEach((i) => {
        seasons[i].users = seasons[i].users.map((u) => {
          const now = live.get(u.user_id);
          return now ? { ...u, display_name: now.display_name, avatar: now.avatar } : u;
        });
      });
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

  /*
    Which roster_ids got a first-round bye — i.e. genuinely relevant
    playoff teams (see relevantBracketGames) who don't appear in the
    earliest relevant round at all, but enter directly (via a literal
    seed, not a t1_from/t2_from result) in a later round. Works for any
    bracket size (4/6/8-team), not just one specific format.
  */
  byeRosterIds(bracket) {
    const relevant = SleeperAPI.relevantBracketGames(bracket);
    if (!relevant.length) return [];
    const minRound = Math.min(...relevant.map((g) => g.r));
    const firstRoundIds = new Set();
    relevant
      .filter((g) => g.r === minRound)
      .forEach((g) => {
        if (g.t1 != null) firstRoundIds.add(g.t1);
        if (g.t2 != null) firstRoundIds.add(g.t2);
      });
    const byeIds = new Set();
    relevant
      .filter((g) => g.r > minRound)
      .forEach((g) => {
        if (g.t1 != null && !firstRoundIds.has(g.t1)) byeIds.add(g.t1);
        if (g.t2 != null && !firstRoundIds.has(g.t2)) byeIds.add(g.t2);
      });
    return [...byeIds];
  },

  // Turns a literal roster_positions slot-type string into a short
  // display label — e.g. "SUPER_FLEX" -> "SFLX". Plain positions (QB, RB,
  // K, DEF...) pass through unchanged. Used anywhere a slot type is shown.
  friendlySlotLabel(slotType) {
    if (slotType === "FLEX") return "FLEX";
    if (slotType === "SUPER_FLEX") return "SFLX";
    if (slotType.includes("FLEX")) return slotType.replace(/_FLEX$/, "").replace(/_/g, "") + " FLEX";
    return slotType;
  },

  // Builds a standings array: [{ rosterId, userId, teamName, username, avatar,
  // teamAvatar, wins, losses, ties, fpts, fptsAgainst }], sorted by wins then points.
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
          teamAvatar: SleeperAPI.teamAvatarUrl(user),
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
