const MODAL_CSS = `
  .auth-modal, .modalWhiteout, .webAuthContainerWrapper, .onetapAuthContainer { display: none !important; }
  body.show-onetap, body.g-overflow-hidden { overflow: auto !important; }
`;

const REMOVE_MODALS_SCRIPT = `
  (function() {
    const style = document.createElement('style');
    style.textContent = \`
      .modal, .modal__modal, .modal__overlay, .signupOverlay, .signinModal,
      [role="dialog"], [aria-modal="true"], dialog[open] { display: none !important; }
      body { overflow: auto !important; }
    \`;
    (document.head || document.documentElement).appendChild(style);

    function killModals() {
      document.querySelectorAll('iframe').forEach(f => {
        if (!f.src) return;
        if (!/secure\.soundcloud\.com|accounts\.google\.com\/gsi|api-auth\.soundcloud\.com/i.test(f.src)) return;
        let target = f;
        let cur = f.parentElement;
        for (let i = 0; i < 8 && cur; i++) {
          if (getComputedStyle(cur).position === 'fixed') { target = cur; break; }
          cur = cur.parentElement;
        }
        try { target.remove(); } catch {}
      });
      document.querySelectorAll('.auth-modal, .webAuthContainerWrapper, .onetapAuthContainer, .modalWhiteout').forEach(el => {
        try { el.remove(); } catch {}
      });
      document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open], [class*="signupModal"], [class*="signinModal"], [class*="onboardingModal"]').forEach(el => {
        try { el.remove(); } catch {}
      });
      if (document.body) {
        document.body.classList.remove('show-onetap', 'g-overflow-hidden', 'modalOpen', 'no-scroll');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
      }
    }

    killModals();
    try {
      let pending = null;
      const observer = new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => { pending = null; killModals(); }, 100);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (error) {
      console.error('[CF observer]', error);
    }
  })()
`;

const FIND_HERO_PLAY_BUTTON = `
  (function() {
    const audio = document.querySelector('audio');
    if (audio && !audio.paused) return { playing: true };

    const sels = [
      '.fullListenHero a.playButton',
      '.soundTitle__playButtonHero a',
      '.fullHero a.playButton',
      '.l-listen-hero a.sc-button-play',
    ];
    for (const sel of sels) {
      const btn = document.querySelector(sel);
      if (!btn) continue;
      if (btn.getAttribute('title') === 'Pause') continue;
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return {
          playing: false,
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
    }
    return { playing: false };
  })()
`;

function isSoundCloudUrl(url) {
  return typeof url === 'string' && url.includes('soundcloud.com');
}

function preparePlayback(view, { getCurrentView, isQuitting }) {
  if (!view || view.webContents.isDestroyed()) return;

  view.webContents.insertCSS(MODAL_CSS)
    .catch((error) => console.error('[CF insertCSS]', error));

  view.webContents.once('did-finish-load', () => {
    if (view.webContents.isDestroyed()) return;
    view.webContents.executeJavaScript(REMOVE_MODALS_SCRIPT)
      .catch((error) => console.error('[CF killModals]', error));

    let attempts = 0;
    const tryClick = async () => {
      const currentView = getCurrentView();
      if (
        isQuitting()
        || !currentView
        || currentView !== view
        || view.webContents.isDestroyed()
        || attempts >= 20
      ) return;

      attempts += 1;
      try {
        const state = await view.webContents.executeJavaScript(FIND_HERO_PLAY_BUTTON);
        if (state.playing) return;
        if (state.x && state.y) {
          const x = Math.round(state.x);
          const y = Math.round(state.y);
          view.webContents.sendInputEvent({ type: 'mouseMove', x, y });
          view.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
          view.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        }
      } catch {}
      setTimeout(tryClick, 700);
    };

    setTimeout(tryClick, 600);
  });
}

module.exports = {
  isSoundCloudUrl,
  preparePlayback,
};
