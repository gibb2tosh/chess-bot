// Pure helpers shared by content.js (loaded first by the manifest) and the tests.
// Plain script (no modules) so it can run as a content script.
(function (root) {
  const API = 'https://api.chess.com/pub';

  /** chess.com game id from a page path, or null if this isn't a game page. */
  function gameIdFromPath(pathname) {
    const m = pathname.match(/^\/(?:analysis\/)?game\/(?:live\/|daily\/)?(\d+)/);
    return m ? m[1] : null;
  }

  async function getJson(fetchFn, url) {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error('chess.com API ' + res.status);
    return res.json();
  }

  /**
   * Is this game finished? chess.com's public archives only ever contain
   * finished games, so a game in progress is never found here. That keeps the
   * review button (and any engine help) off the screen until the game is over.
   * `months` limits how many monthly archives (newest first) are searched.
   */
  async function isFinishedGame(fetchFn, username, gameId, months) {
    const { archives = [] } = await getJson(fetchFn, API + '/player/' + encodeURIComponent(username.toLowerCase()) + '/games/archives');
    const recent = archives.slice(-(months || 1)).reverse();
    for (const url of recent) {
      const { games = [] } = await getJson(fetchFn, url);
      if (games.some((g) => typeof g.url === 'string' && g.url.endsWith('/' + gameId))) return true;
    }
    return false;
  }

  function buildAppUrl(appUrl, username, gameUrl) {
    const url = new URL(appUrl);
    url.searchParams.set('user', username);
    url.searchParams.set('game', gameUrl.split('?')[0]);
    return url.toString();
  }

  /** Poll gently: every 15s for the first 10 minutes on a page, then once a minute. */
  function pollDelay(msOnPage) {
    return msOnPage < 10 * 60 * 1000 ? 15000 : 60000;
  }

  root.ChessCoachExt = { gameIdFromPath, isFinishedGame, buildAppUrl, pollDelay };
})(globalThis);
