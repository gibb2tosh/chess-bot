// Adds a floating "Review with Chess Coach" button on chess.com game pages.
// It opens the Chess Coach app with the game URL; the app fetches the PGN
// from chess.com's public API and reviews it.
(async () => {
  const { appUrl = 'http://localhost:5173/', username = '' } = await chrome.storage.sync.get(['appUrl', 'username']);

  const gameId = () => location.pathname.match(/\/game\/(?:live\/|daily\/)?(\d+)/)?.[1];

  const btn = document.createElement('button');
  btn.textContent = '♞ Review with Chess Coach';
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
  btn.addEventListener('click', () => {
    const id = gameId();
    if (!id) return;
    if (!username) {
      alert('Set your chess.com username in the Chess Coach extension options first.');
      chrome.runtime.openOptionsPage?.();
      return;
    }
    const url = new URL(appUrl);
    url.searchParams.set('user', username);
    url.searchParams.set('game', location.href.split('?')[0]);
    window.open(url.toString(), 'chess-coach');
  });

  // chess.com is a single-page app: show the button only while on a game URL.
  const sync = () => {
    if (gameId() && !btn.isConnected) document.body.appendChild(btn);
    if (!gameId() && btn.isConnected) btn.remove();
  };
  sync();
  setInterval(sync, 1000);
})();
