(function () {
  const vscode = acquireVsCodeApi();

  let idleMs = 0;
  let stealthEnabled = false;
  let hidden = false;
  let unlockClicks = 0;
  let lastUnlockAt = 0;
  let idleTimer = null;
  const UNLOCK_CLICKS = 3;
  const UNLOCK_WINDOW_MS = 1200;

  const root = document.getElementById('root');

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function applyStealth(notify) {
    const zone = document.querySelector('.stealth-zone');
    const overlay = document.querySelector('.stealth-overlay');
    if (!zone || !overlay) return;
    zone.classList.toggle('stealth-hidden', hidden);
    overlay.hidden = !hidden;
    if (hidden) unlockClicks = 0;
    if (notify) {
      vscode.postMessage({ type: hidden ? 'stealthHidden' : 'stealthShown' });
    }
  }

  function resetIdleTimer() {
    if (!stealthEnabled || hidden) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      hidden = true;
      applyStealth(true);
    }, idleMs);
  }

  function tryUnlockByClick() {
    if (!stealthEnabled) return true;
    const now = Date.now();
    if (now - lastUnlockAt > UNLOCK_WINDOW_MS) unlockClicks = 0;
    lastUnlockAt = now;
    unlockClicks += 1;
    if (unlockClicks >= UNLOCK_CLICKS) {
      hidden = false;
      unlockClicks = 0;
      applyStealth(true);
      resetIdleTimer();
      return true;
    }
    return false;
  }

  function renderEmpty() {
    root.innerHTML =
      '<div class="reader-empty">' +
      '<p>打开 EPUB 后在此阅读</p>' +
      '<button data-action="open">打开 EPUB…</button>' +
      '</div>';
  }

  function renderReading(msg) {
    const pageSize = msg.pageSize || 5;
    const prose = msg.prose || '';
    const muted = prose === '（本章暂无正文）';
    root.innerHTML =
      '<div class="reader stealth-zone">' +
      '<div class="stealth-content">' +
      '<div class="reader-header">' +
      '<div class="reader-chapter">' + esc(msg.chapter || '') + '</div>' +
      '<div class="reader-progress">' + esc(msg.progress || '') + '</div>' +
      '</div>' +
      '<div class="reader-body" data-action="nextPage">' +
      '<p class="reader-prose' + (muted ? ' muted' : '') + '">' + esc(prose) + '</p>' +
      '</div>' +
      '<div class="reader-nav">' +
      '<button data-action="prevPage">← ' + pageSize + '</button>' +
      '<button data-action="nextPage">' + pageSize + ' →</button>' +
      '</div>' +
      '</div>' +
      '<div class="stealth-overlay" hidden aria-hidden="true"></div>' +
      '</div>';
  }

  function applyTextColor(color) {
    if (!color) return;
    document.documentElement.style.setProperty('--reader-fg', color);
  }

  function handleUpdate(msg) {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    idleMs = (msg.stealthSeconds || 0) * 1000;
    stealthEnabled = idleMs > 0 || !!msg.hidden;
    applyTextColor(msg.textColor);

    if (msg.mode === 'empty') {
      hidden = false;
      renderEmpty();
      return;
    }

    hidden = !!msg.hidden;
    renderReading(msg);
    applyStealth(false);
    if (!hidden) resetIdleTimer();
  }

  window.addEventListener('message', function (event) {
    const msg = event.data || {};
    if (msg.type === 'update') {
      handleUpdate(msg);
    } else if (msg.type === 'setHidden') {
      hidden = !!msg.hidden;
      if (hidden) stealthEnabled = true;
      applyStealth(false);
      if (!hidden) resetIdleTimer();
    }
  });

  document.addEventListener('click', function (e) {
    const zone = e.target.closest('.stealth-zone');
    if (zone) {
      if (hidden) {
        e.preventDefault();
        e.stopPropagation();
        tryUnlockByClick();
        return;
      }
      if (stealthEnabled) resetIdleTimer();
    }
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const type = el.getAttribute('data-action');
    if (type) vscode.postMessage({ type: type });
  });

  document.addEventListener('contextmenu', function (e) {
    const zone = e.target.closest('.stealth-zone');
    if (!zone) return;
    e.preventDefault();
    // Right-click: quick hide (blank). Unlock still needs 3 clicks / 2 arrow keys.
    if (hidden) {
      tryUnlockByClick();
      return;
    }
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    hidden = true;
    stealthEnabled = true;
    applyStealth(true);
  });

  renderEmpty();
  vscode.postMessage({ type: 'ready' });
})();
