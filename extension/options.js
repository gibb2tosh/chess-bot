const $ = (id) => document.getElementById(id);
chrome.storage.sync.get(['username', 'appUrl']).then(({ username = '', appUrl = 'http://localhost:5173/' }) => {
  $('username').value = username;
  $('appUrl').value = appUrl;
});
$('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({ username: $('username').value.trim(), appUrl: $('appUrl').value.trim() || 'http://localhost:5173/' });
  $('saved').textContent = 'Saved ✓';
});
