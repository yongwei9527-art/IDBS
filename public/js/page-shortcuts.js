(function () {
  function currentPageName() {
    return (window.location.pathname || '').replace(/\\/g, '/').split('/').pop() || 'index.html';
  }

  function queryValue(name) {
    return new URLSearchParams(window.location.search || '').get(name) || '';
  }

  function adminContext() {
    const page = currentPageName();
    return page === 'admin.html' || queryValue('admin') === '1' || document.body?.classList.contains('admin-page') || document.body?.dataset?.area === 'admin';
  }

  function currentArea() {
    return adminContext() ? 'admin' : 'user';
  }

  function scopedHistoryState(overrides = {}) {
    return {
      ...(window.history.state || {}),
      idbs_area: currentArea(),
      ...overrides
    };
  }

  function safeLocalHref(href) {
    const text = String(href || '').trim();
    if (!text) return '';
    try {
      const url = new URL(text, window.location.href);
      if (url.origin !== window.location.origin) return '';
      const page = (url.pathname || '').replace(/\\/g, '/').split('/').pop() || 'index.html';
      if (adminContext()) {
        if (!['admin.html', 'calendar.html', 'calendar-detail.html', 'chat.html'].includes(page)) return '';
        if (['calendar.html', 'calendar-detail.html', 'chat.html'].includes(page) && url.searchParams.get('admin') !== '1') return '';
      } else if (page === 'admin.html' || url.searchParams.get('admin') === '1') {
        return '';
      }
      return `${page}${url.search}${url.hash}`;
    } catch (_) {
      return '';
    }
  }

  function configuredBackHref() {
    const explicit = document.body?.dataset?.backHref || queryValue('back');
    const safeExplicit = safeLocalHref(explicit);
    if (safeExplicit) return safeExplicit;
    const page = currentPageName();
    if (page === 'admin.html') return 'admin.html#overview';
    if (adminContext() && page === 'calendar.html') return 'admin.html#overview';
    if (adminContext() && page === 'chat.html') return 'admin.html#overview';
    if (adminContext() && page === 'calendar-detail.html') {
      const month = queryValue('month') || queryValue('date').slice(0, 7);
      const back = safeLocalHref(queryValue('back')) || 'admin.html#overview';
      return `calendar.html?month=${encodeURIComponent(month)}&admin=1&back=${encodeURIComponent(back)}`;
    }
    return '';
  }

  function configuredHomeHref() {
    const explicit = document.body?.dataset?.homeHref || '';
    const safeExplicit = safeLocalHref(explicit);
    if (safeExplicit) return safeExplicit;
    if (currentPageName() === 'admin.html') return 'admin.html#overview';
    return adminContext() ? 'admin.html#overview' : 'index.html';
  }

  function goAdminOverview() {
    if (typeof window.switchTab === 'function') {
      window.switchTab('overview');
      if (window.location.hash !== '#overview') {
        replaceCurrentUrl('admin.html#overview');
      }
      return true;
    }
    window.location.replace('admin.html#overview');
    return true;
  }

  function goBack() {
    if (currentPageName() === 'admin.html') {
      goAdminOverview();
      return;
    }
    const backHref = configuredBackHref();
    if (backHref) {
      window.location.replace(backHref);
      return;
    }
    window.location.replace(configuredHomeHref());
  }

  function replaceCurrentUrl(href) {
    const safeHref = safeLocalHref(href) || configuredHomeHref();
    window.history.replaceState(scopedHistoryState({ idbs_guard: false }), '', safeHref);
  }

  function initAreaHistoryGuard() {
    let previousArea = '';
    try {
      previousArea = sessionStorage.getItem('IDBS_LAST_AREA') || '';
      sessionStorage.setItem('IDBS_LAST_AREA', currentArea());
    } catch (_) {
      previousArea = '';
    }

    if (!previousArea || previousArea === currentArea()) {
      window.history.replaceState(scopedHistoryState({ idbs_guard: false }), '', window.location.href);
      return;
    }

    const guardKey = `${currentArea()}:${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState(scopedHistoryState({ idbs_guard: true, idbs_guard_key: guardKey }), '', window.location.href);
    window.history.pushState(scopedHistoryState({ idbs_guard: false, idbs_guard_key: guardKey }), '', window.location.href);

    window.addEventListener('popstate', (event) => {
      const state = event.state || {};
      if (state.idbs_area !== currentArea() || !state.idbs_guard) return;

      const fallback = configuredBackHref() || configuredHomeHref();
      const safeFallback = safeLocalHref(fallback) || configuredHomeHref();
      const target = new URL(safeFallback, window.location.href);
      if (target.href === window.location.href) {
        window.history.pushState(scopedHistoryState({ idbs_guard: false, idbs_guard_key: guardKey }), '', window.location.href);
        if (currentPageName() === 'admin.html') goAdminOverview();
        return;
      }
      window.location.replace(safeFallback);
    });
  }

  function initPageShortcuts() {
    if (adminContext()) return;
    if (document.querySelector('.page-shortcuts')) return;
    const nav = document.createElement('nav');
    nav.className = 'page-shortcuts';
    nav.setAttribute('aria-label', '页面快捷操作');
    const homeHref = configuredHomeHref();
    nav.innerHTML = `
      <button class="shortcut-link shortcut-back" type="button" aria-label="返回上一页" title="返回上一页">
        <span aria-hidden="true">←</span>
        <span>返回</span>
      </button>
      <a class="shortcut-link home-shortcut" href="${homeHref}" aria-label="返回主页面" title="返回主页面">
        <span aria-hidden="true">⌂</span>
        <span>主页</span>
      </a>
    `;
    nav.querySelector('.shortcut-back').addEventListener('click', goBack);
    const homeShortcut = nav.querySelector('.home-shortcut');
    if (currentPageName() === 'admin.html') {
      homeShortcut.addEventListener('click', (event) => {
        event.preventDefault();
        goAdminOverview();
      });
      homeShortcut.setAttribute('aria-current', 'page');
    }
    if (currentPageName() === 'index.html') {
      homeShortcut.setAttribute('aria-current', 'page');
    }
    document.body.insertBefore(nav, document.body.firstChild);
  }

  window.IdbsNavigation = {
    adminContext,
    currentArea,
    configuredBackHref,
    configuredHomeHref,
    replaceCurrentUrl,
    goBack,
    goAdminOverview
  };

  initAreaHistoryGuard();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPageShortcuts);
  } else {
    initPageShortcuts();
  }
})();
