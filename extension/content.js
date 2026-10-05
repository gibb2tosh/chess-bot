// Adds a "Review with Chess Coach" button to chess.com game pages — but only
// once the game is over. Using engine analysis during a game breaks chess.com's
// fair-play rules, so the button stays hidden until the game appears in the
// player's public archive (which only lists finished games).
(async () => {
  const { gameIdFromPath, isFinishedGame, buildAppUrl, pollDelay } = globalThis.ChessCoachExt;
  const { appUrl = 'http://localhost:5173/', username = '' } = await chrome.storage.sync.get(['appUrl', 'username']);
  if (!username) {
    console.info('[Chess Coach] Set your chess.com username in the extension options to enable the review button.');
    return;
  }

  const btn = document.createElement('button');
  btn.textContent = '♞ Review with Chess Coach';
  btn.dataset.chessCoach = 'review';
  Object.assign(btn.style, {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: 99999,
    padding: '10px 14px',
    borderRadius: '10px',
    border: 'none',
    background: '#2f6f4f',
    color: '#fff',
    font: '600 14px system-ui, sans-serif',
    boxShadow: '0 2px 10px rgba(0,0,0,.3)',
    cursor: 'pointer',
  });
  btn.addEventListener('click', () => window.open(buildAppUrl(appUrl, username, location.href), 'chess-coach'));

  let watching = null; // game id being watched
  let finished = false;
  let since = 0;
  let timer = null;
  let checks = 0;

  const check = async () => {
    const id = watching;
    if (!id || finished) return;
    if (document.visibilityState === 'visible') {
      try {
        // First look covers older games you open from your history; later polls only need this month.
        const done = await isFinishedGame(fetch, username, id, checks === 0 ? 3 : 1);
        checks++;
        if (id !== watching) return;
        if (done) {
          finished = true;
          document.body.appendChild(btn);
          return;
        }
      } catch (e) {
        console.debug('[Chess Coach] archive check failed', e);
      }
    }
    timer = setTimeout(check, pollDelay(Date.now() - since));
  };

  // chess.com is a single-page app: follow URL changes.
  const sync = () => {
    const id = gameIdFromPath(location.pathname);
    if (id === watching) return;
    clearTimeout(timer);
    btn.remove();
    watching = id;
    finished = false;
    checks = 0;
    since = Date.now();
    if (id) check();
  };
  sync();
  setInterval(sync, 1000);
})();
