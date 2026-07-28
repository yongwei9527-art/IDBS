const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const WebSocket = require('ws');

const FIXED_ORIGIN = 'http://127.0.0.1:5173';
const APP_BASE = '/v5';
const THEME_KEY = 'LABORATORY_MANAGEMENT_SYSTEM_AMBIENT';

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const outputDir = path.resolve(arg('--output', path.join(process.cwd(), 'work', 'secondary-layout-audit')));
const theme = arg('--theme', 'day');
if (!['day', 'night'].includes(theme)) throw new Error('Theme must be day or night.');
fs.mkdirSync(outputDir, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SCENES = [
  {
    routeLabel: 'mobile-sidebar',
    basePath: '/admin/dashboard',
    prepare: `(async () => {
      const waitFor = async (get, timeout = 5000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = get();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
        return null;
      };
      const openButton = await waitFor(() => document.querySelector('button[aria-label="打开导航"]'));
      if (!openButton) return false;
      openButton.click();
      return Boolean(await waitFor(() => {
        const sidebar = document.querySelector('#app-navigation.translate-x-0');
        const insideClose = sidebar?.querySelector('button[aria-label="关闭导航"]');
        const backdrop = Array.from(document.querySelectorAll('button[aria-label="关闭导航"]'))
          .find((element) => !element.closest('#app-navigation'));
        return sidebar && insideClose && backdrop;
      }));
    })()`,
    ready: `Boolean(
      document.querySelector('#app-navigation.translate-x-0 button[aria-label="关闭导航"]')
      && Array.from(document.querySelectorAll('button[aria-label="关闭导航"]'))
        .some((element) => !element.closest('#app-navigation'))
    )`
  },  {
    routeLabel: 'calendar-detail',
    basePath: '/calendar/2026-07-27',
    prepare: 'true',
    ready: "location.pathname === '/v5/calendar/2026-07-27'"
  },
  {
    routeLabel: 'device-detail',
    basePath: '/devices',
    prepare: `(async () => {
      const waitFor = async (get, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = get();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return null;
      };
      const button = await waitFor(() => Array.from(document.querySelectorAll('.ops-main button'))
        .find((element) => String(element.textContent || '').trim() === '详情'));
      if (!button) return false;
      button.click();
      return Boolean(await waitFor(() => /^\\/v5\\/devices\\/[^/]+$/.test(location.pathname) && document.querySelector('.ops-main')));
    })()`,
    ready: "/^\\/v5\\/devices\\/[^/]+$/.test(location.pathname)"
  },
  {
    routeLabel: 'chat-detail',
    basePath: '/chat',
    prepare: `(async () => {
      const waitFor = async (get, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = get();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return null;
      };
      const item = await waitFor(() => document.querySelector('.ops-main .ops-list-item'));
      if (!item) return false;
      item.click();
      return Boolean(await waitFor(() => /^\\/v5\\/chat\\/[^/]+$/.test(location.pathname) && document.querySelector('.ops-main')));
    })()`,
    ready: "/^\\/v5\\/chat\\/[^/]+$/.test(location.pathname)"
  },
  {
    routeLabel: 'admin-users-drawer',
    basePath: '/admin/users',
    prepare: `(async () => {
      const waitFor = async (get, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = get();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return null;
      };
      const button = await waitFor(() => Array.from(document.querySelectorAll('.ops-main button'))
        .find((element) => String(element.textContent || '').trim() === '档案'));
      if (!button) return false;
      button.click();
      return Boolean(await waitFor(() => document.querySelector('.ops-drawer-backdrop .ops-drawer-panel')));
    })()`,
    ready: "Boolean(document.querySelector('.ops-drawer-backdrop .ops-drawer-panel'))"
  },
  {
    routeLabel: 'admin-reservations-drawer',
    basePath: '/admin/reservations',
    prepare: `(async () => {
      const waitFor = async (get, timeout = 9000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = get();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return null;
      };
      const batch = await waitFor(() => document.querySelector('.approval-batch-card'));
      if (!batch) return false;
      batch.click();
      const button = await waitFor(() => Array.from(document.querySelectorAll('.approval-page button'))
        .find((element) => String(element.textContent || '').trim() === '详情'));
      if (!button) return false;
      button.click();
      return Boolean(await waitFor(() => document.querySelector('.ops-drawer-backdrop .ops-drawer-panel')));
    })()`,
    ready: "Boolean(document.querySelector('.ops-drawer-backdrop .ops-drawer-panel'))"
  },
  {
    routeLabel: 'calendar-empty-day-dialog',
    basePath: '/calendar',
    prepare: `(async () => {
      const waitFor = async (get, timeout = 8000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = get();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return null;
      };
      const cell = await waitFor(() => Array.from(document.querySelectorAll('.calendar-day-cell'))
        .find((element) => !element.querySelector('.calendar-event-chip') && element.querySelector('button[aria-label]')));
      if (!cell) return false;
      cell.querySelector('button[aria-label]').click();
      return Boolean(await waitFor(() => document.querySelector('.ui-dialog-backdrop .ops-dialog-surface')));
    })()`,
    ready: "Boolean(document.querySelector('.ui-dialog-backdrop .ops-dialog-surface'))"
  },
  {
    routeLabel: 'admin-password-reset-dialog',
    basePath: '/admin/users',
    prepare: `(async () => {
      const waitFor = async (get, timeout = 9000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const value = get();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
        return null;
      };
      const ordinaryUserRow = await waitFor(() => Array.from(document.querySelectorAll('.user-admin-row'))
        .find((row) => {
          const cells = Array.from(row.querySelectorAll(':scope > .user-admin-cell'));
          return String(cells[2]?.querySelector('.user-admin-main')?.textContent || '').trim() === '用户';
        }));
      if (!ordinaryUserRow) return false;
      const profileButton = Array.from(ordinaryUserRow.querySelectorAll('button'))
        .find((element) => String(element.textContent || '').trim() === '档案');
      if (!profileButton) return false;
      profileButton.click();
      const drawer = await waitFor(() => document.querySelector('.ops-drawer-backdrop .ops-drawer-panel'));
      if (!drawer) return false;
      const resetButton = await waitFor(() => Array.from(drawer.querySelectorAll('button'))
        .find((element) => String(element.textContent || '').trim() === '重置密码'));
      if (!resetButton) return false;
      resetButton.click();
      const dialog = await waitFor(() => document.querySelector('.ui-dialog-panel[role="dialog"]'));
      if (!dialog) return false;
      const passwordInputs = dialog.querySelectorAll('input[type="password"]');
      const disabledSubmit = Array.from(dialog.querySelectorAll('button[type="submit"]'))
        .some((element) => element.disabled);
      return passwordInputs.length === 2 && disabledSubmit;
    })()`,
    ready: `Boolean((() => {
      const dialog = document.querySelector('.ui-dialog-panel[role="dialog"]');
      if (!dialog) return false;
      return dialog.querySelectorAll('input[type="password"]').length === 2
        && Array.from(dialog.querySelectorAll('button[type="submit"]')).some((element) => element.disabled);
    })())`
  }
];

async function connect() {
  const targets = await fetch('http://127.0.0.1:9222/json').then((response) => response.json());
  const target = targets.find((item) => item.type === 'page');
  if (!target) throw new Error('No debuggable WebView page found.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  const routeErrors = { exceptions: 0, logErrors: 0, failedLoads: 0, httpErrors: 0 };

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.id && pending.has(message.id)) {
      const promise = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) promise.reject(new Error(message.error.message));
      else promise.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') routeErrors.exceptions++;
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') routeErrors.logErrors++;
    if (message.method === 'Network.loadingFailed' && !message.params?.canceled) routeErrors.failedLoads++;
    if (message.method === 'Network.responseReceived' && message.params?.response?.status >= 400) routeErrors.httpErrors++;
  });

  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await Promise.all([send('Runtime.enable'), send('Page.enable'), send('Network.enable'), send('Log.enable')]);
  return { socket, send, routeErrors };
}

async function evaluate(send, expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (result.exceptionDetails) throw new Error('WebView evaluation failed.');
  return result.result.value;
}

const ACCESS_EXPRESSION = `(readyExpression => ({
  fixedOrigin: location.origin === ${JSON.stringify(FIXED_ORIGIN)},
  loggedIn: !location.pathname.endsWith('/login'),
  appLayout: Boolean(document.querySelector('.ops-layout-shell')),
  stateReady: Boolean(eval(readyExpression))
}))`;

const METRICS_EXPRESSION = `(() => {
  const page = document.querySelector('.ops-page-area');
  const overlay = document.querySelector('.ui-dialog-panel')
    || document.querySelector('.ops-dialog-surface')
    || document.querySelector('.ops-drawer-panel')
    || document.querySelector('#app-navigation.translate-x-0');
  const root = overlay || document.querySelector('.ops-main');
  if (!page || !root) return null;
  const scrollSurface = overlay
    ? (root.querySelector('[class*="overflow-y-auto"]') || root)
    : page;
  scrollSurface.scrollTop = 0;
  const viewport = {
    left: Math.max(0, root.getBoundingClientRect().left),
    right: Math.min(innerWidth, root.getBoundingClientRect().right),
    top: Math.max(0, root.getBoundingClientRect().top),
    bottom: Math.min(innerHeight, root.getBoundingClientRect().bottom)
  };
  const viewportWidth = Math.max(1, viewport.right - viewport.left);
  const viewportHeight = Math.max(1, viewport.bottom - viewport.top);
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
  };
  const blockSelector = '.ops-card,.ops-surface,section,form,table,[class*="chart"],.recharts-responsive-container,img,video';
  const blocks = Array.from(root.querySelectorAll(blockSelector)).filter(visible);
  const firstScreenBlocks = blocks.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom && rect.right > viewport.left && rect.left < viewport.right;
  });
  const gridColumns = 24;
  const gridRows = 36;
  let occupied = 0;
  for (let row = 0; row < gridRows; row++) {
    for (let column = 0; column < gridColumns; column++) {
      const x = viewport.left + ((column + 0.5) / gridColumns) * viewportWidth;
      const y = viewport.top + ((row + 0.5) / gridRows) * viewportHeight;
      if (firstScreenBlocks.some((element) => {
        const rect = element.getBoundingClientRect();
        return x >= Math.max(viewport.left, rect.left)
          && x <= Math.min(viewport.right, rect.right)
          && y >= Math.max(viewport.top, rect.top)
          && y <= Math.min(viewport.bottom, rect.bottom);
      })) occupied++;
    }
  }
  const horizontalOffenders = Array.from(root.querySelectorAll('*')).filter((element) => {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.right > viewport.right + 1 || rect.left < viewport.left - 1;
  });
  const media = Array.from(root.querySelectorAll('img,video,.recharts-responsive-container,.recharts-wrapper,[class*="chart"]')).filter(visible);
  const oversizedBlocks = blocks.filter((element) => element.getBoundingClientRect().height > viewportHeight + 1);
  const mediaWidthOverflow = media.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left < viewport.left - 1 || rect.right > viewport.right + 1;
  });
  const mediaHeightOverflow = media.filter((element) => element.getBoundingClientRect().height > viewportHeight + 1);
  const cards = Array.from(root.querySelectorAll('.ops-card,.ops-surface')).filter(visible);
  const firstScreenCards = cards.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  });
  const firstScreenButtons = Array.from(root.querySelectorAll('button,a[role="button"]')).filter((element) => {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  }).length;
  const firstScreenRows = Array.from(root.querySelectorAll('tbody tr,[role="row"]')).filter((element) => {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom > viewport.top && rect.top < viewport.bottom;
  }).length;
  const maxScrollTop = Math.max(0, scrollSurface.scrollHeight - scrollSurface.clientHeight);
  scrollSurface.scrollTop = maxScrollTop;
  const reachedBottom = maxScrollTop === 0 || scrollSurface.scrollTop >= maxScrollTop - 1;
  scrollSurface.scrollTop = 0;
  const overflowY = getComputedStyle(scrollSurface).overflowY;
  const touchAction = getComputedStyle(scrollSurface).touchAction;
  return {
    viewportWidth: Math.round(viewportWidth),
    viewportHeight: Math.round(viewportHeight),
    scrollClientHeight: scrollSurface.clientHeight,
    scrollHeight: scrollSurface.scrollHeight,
    hasVerticalOverflow: maxScrollTop > 1,
    canReachBottom: reachedBottom,
    verticalOverflowEnabled: ['auto', 'scroll', 'overlay'].includes(overflowY) || maxScrollTop === 0,
    touchPanYAllowed: !String(touchAction).includes('none'),
    documentHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    horizontalOverflowCount: horizontalOffenders.length,
    firstScreenBlankRateApprox: Number((1 - occupied / (gridColumns * gridRows)).toFixed(3)),
    firstScreenBlockCount: firstScreenBlocks.length,
    firstScreenCardCount: firstScreenCards.length,
    firstScreenButtonCount: firstScreenButtons,
    firstScreenRowCount: firstScreenRows,
    totalCardCount: cards.length,
    oversizedBlockCount: oversizedBlocks.length,
    mediaBlockCount: media.length,
    mediaWidthOverflowCount: mediaWidthOverflow.length,
    mediaHeightOverflowCount: mediaHeightOverflow.length,
    maxBlockHeightRatio: Number((Math.max(0, ...blocks.map((element) => element.getBoundingClientRect().height)) / viewportHeight).toFixed(3)),
    overlayOpen: Boolean(overlay)
  };
})()`;

const CREDENTIAL_MASK_EXPRESSION = `(() => {
  document.getElementById('__secondary_layout_audit_mask')?.remove();
  const secretSelector = [
    'input[type="password"]',
    'input[autocomplete="current-password" i]',
    'input[autocomplete="new-password" i]',
    'input[name*="password" i]',
    'input[id*="password" i]',
    'input[name*="token" i]',
    'input[id*="token" i]',
    'input[name*="cookie" i]',
    'input[id*="cookie" i]',
    'input[name*="secret" i]',
    'input[id*="secret" i]',
    'input[name*="key" i]',
    'input[id*="key" i]',
    'textarea[name*="password" i]',
    'textarea[id*="password" i]',
    'textarea[name*="token" i]',
    'textarea[id*="token" i]',
    'textarea[name*="cookie" i]',
    'textarea[id*="cookie" i]',
    'textarea[name*="secret" i]',
    'textarea[id*="secret" i]',
    '[data-secret]',
    '[data-token]',
    '[data-cookie]'
  ].join(',');
  const controls = new Set(Array.from(document.querySelectorAll(secretSelector)));
  const credentialWords = ['密码', '口令', '访问令牌', '刷新令牌', 'token', 'cookie', 'secret', '密钥', 'credential'];
  document.querySelectorAll('label').forEach((label) => {
    const text = String(label.textContent || '').trim().toLowerCase();
    if (!credentialWords.some((word) => text.includes(word))) return;
    const container = label.closest('label') || label.parentElement;
    container?.querySelectorAll('input,textarea,select,code,pre').forEach((element) => controls.add(element));
  });
  controls.forEach((element) => element.setAttribute('data-secondary-audit-secret', 'true'));
  const style = document.createElement('style');
  style.id = '__secondary_layout_audit_mask';
  style.textContent = \`
    .ops-user-panel,
    [data-sonner-toaster] {
      visibility: hidden !important;
    }
    [data-secondary-audit-secret="true"],
    [data-secondary-audit-secret="true"]::placeholder {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      caret-color: transparent !important;
      text-shadow: none !important;
    }
  \`;
  document.head.appendChild(style);
  const transparent = (value) => {
    const normalized = String(value || '').replaceAll(' ', '');
    if (normalized === 'transparent') return true;
    if (!normalized.startsWith('rgba(')) return false;
    return Number(normalized.slice(normalized.lastIndexOf(',') + 1, -1)) === 0;
  };
  return {
    maskInstalled: Boolean(document.getElementById('__secondary_layout_audit_mask')),
    credentialControlCount: controls.size,
    credentialControlsMasked: Array.from(controls).every((element) => {
      const computed = getComputedStyle(element);
      return computed.visibility === 'hidden'
        || transparent(computed.color)
        || transparent(computed.webkitTextFillColor);
    }),
    userPanelHidden: Array.from(document.querySelectorAll('.ops-user-panel'))
      .every((element) => getComputedStyle(element).visibility === 'hidden'),
    fixedOrigin: location.origin === ${JSON.stringify(FIXED_ORIGIN)},
    loggedIn: !location.pathname.endsWith('/login'),
    themeApplied: document.documentElement.dataset.ambient === ${JSON.stringify(theme)}
  };
})()`;

async function inspectAccess(send, readyExpression) {
  return evaluate(send, `${ACCESS_EXPRESSION}(${JSON.stringify(readyExpression)})`);
}

async function navigateToBase(send, basePath) {
  await send('Page.navigate', { url: FIXED_ORIGIN + APP_BASE + basePath });
  await wait(1800);
}

(async () => {
  const { socket, send, routeErrors } = await connect();
  const originIsFixed = await evaluate(send, `location.origin === ${JSON.stringify(FIXED_ORIGIN)}`);
  if (!originIsFixed) throw new Error('Secondary audit requires the fixed USB Vite origin.');

  await evaluate(
    send,
    `localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(theme)}); true`
  );

  const results = [];
  for (const scene of SCENES) {
    const errorsBefore = { ...routeErrors };
    await navigateToBase(send, scene.basePath);

    const baseAccess = await inspectAccess(send, 'true');
    if (!baseAccess.fixedOrigin) throw new Error('Origin changed during secondary audit.');
    if (!baseAccess.loggedIn) throw new Error('Authentication was lost during secondary audit.');
    if (!baseAccess.appLayout) {
      results.push({
        routeLabel: scene.routeLabel,
        baseAccessible: false,
        available: false,
        screenshotCaptured: false
      });
      continue;
    }

    const prepared = Boolean(await evaluate(send, scene.prepare));
    await wait(900);
    const stateAccess = await inspectAccess(send, scene.ready);
    if (!stateAccess.fixedOrigin) throw new Error('Origin changed during secondary audit.');
    if (!stateAccess.loggedIn) throw new Error('Authentication was lost during secondary audit.');

    const available = prepared && stateAccess.appLayout && stateAccess.stateReady;
    if (!available) {
      results.push({
        routeLabel: scene.routeLabel,
        baseAccessible: true,
        available: false,
        screenshotCaptured: false,
        runtime: {
          exceptions: routeErrors.exceptions - errorsBefore.exceptions,
          logErrors: routeErrors.logErrors - errorsBefore.logErrors,
          failedLoads: routeErrors.failedLoads - errorsBefore.failedLoads,
          httpErrors: routeErrors.httpErrors - errorsBefore.httpErrors
        }
      });
      continue;
    }

    const mask = await evaluate(send, CREDENTIAL_MASK_EXPRESSION);
    if (!mask.maskInstalled
      || !mask.credentialControlsMasked
      || !mask.userPanelHidden
      || !mask.fixedOrigin
      || !mask.loggedIn
      || !mask.themeApplied) {
      throw new Error(`Credential-mask precondition failed for ${scene.routeLabel}.`);
    }

    const finalAccess = await inspectAccess(send, scene.ready);
    if (!finalAccess.fixedOrigin || !finalAccess.loggedIn || !finalAccess.appLayout || !finalAccess.stateReady) {
      throw new Error(`Screenshot precondition failed for ${scene.routeLabel}.`);
    }

    const metrics = await evaluate(send, METRICS_EXPRESSION);
    const portrait = await evaluate(send, 'innerHeight >= innerWidth');
    const orientation = portrait ? 'portrait' : 'landscape';
    const screenshotFile = `${scene.routeLabel}-${orientation}-${theme}.png`;
    const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], {
      encoding: null,
      maxBuffer: 32 * 1024 * 1024
    });
    fs.writeFileSync(path.join(outputDir, screenshotFile), png);

    results.push({
      routeLabel: scene.routeLabel,
      baseAccessible: true,
      available: true,
      screenshotCaptured: true,
      screenshotFile,
      portrait,
      credentialControlCount: mask.credentialControlCount,
      metrics,
      runtime: {
        exceptions: routeErrors.exceptions - errorsBefore.exceptions,
        logErrors: routeErrors.logErrors - errorsBefore.logErrors,
        failedLoads: routeErrors.failedLoads - errorsBefore.failedLoads,
        httpErrors: routeErrors.httpErrors - errorsBefore.httpErrors
      }
    });
  }

  const reportFile = `secondary-layout-audit-${theme}.json`;
  fs.writeFileSync(
    path.join(outputDir, reportFile),
    JSON.stringify({
      theme,
      fixedOrigin: true,
      sceneCount: results.length,
      availableCount: results.filter((item) => item.available).length,
      scenes: results
    }, null, 2)
  );
  console.log(JSON.stringify({
    theme,
    sceneCount: results.length,
    availableCount: results.filter((item) => item.available).length
  }, null, 2));
  socket.close();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
