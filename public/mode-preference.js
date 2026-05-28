(() => {
  const STORAGE_KEY = 'eqlog-display-mode';
  const COOKIE_NAME = 'eqlog-mode';
  const currentMode = document.body?.dataset?.mode;

  function saveMode(mode) {
    if (!['modern', 'classic'].includes(mode)) return;
    localStorage.setItem(STORAGE_KEY, mode);
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(mode)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-mode-link]');
    if (!link) return;
    saveMode(link.dataset.modeLink);
  });

  if (currentMode) {
    saveMode(currentMode);
    return;
  }

  if (!localStorage.getItem(STORAGE_KEY)) {
    saveMode('modern');
  }
})();
