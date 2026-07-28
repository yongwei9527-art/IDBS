const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const WebSocket = require('ws');

const ROUTES = [
  ['admin-dashboard', '/admin/dashboard'],
  ['admin-devices', '/admin/devices'],
  ['admin-reservations', '/admin/reservations'],
  ['admin-users', '/admin/users'],
  ['admin-faults', '/admin/faults'],
  ['admin-maintenance', '/admin/maintenance'],
  ['admin-requests', '/admin/requests'],
  ['admin-stats', '/admin/stats'],
  ['admin-export', '/admin/export'],
  ['admin-system', '/admin/system'],
  ['admin-audit', '/admin/audit'],
  ['notifications', '/notifications'],
  ['chat', '/chat'],
  ['devices', '/devices'],
  ['reserve', '/reserve'],
  ['my-reservations', '/me/reservations'],
  ['calendar', '/calendar'],
  ['borrow', '/borrow'],
  ['faults', '/faults'],
  ['support-contacts', '/support/contacts']
];

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const outputDir = path.resolve(arg('--output', path.join(process.cwd(), 'work', 'layout-audit')));
const orientation = arg('--orientation', 'portrait');
const theme = arg('--theme', 'day');
const onlyIds = arg('--only', '').split(',').map((value) => value.trim()).filter(Boolean);
const selectedRoutes = onlyIds.length ? ROUTES.filter(([id]) => onlyIds.includes(id)) : ROUTES;
if (selectedRoutes.length !== (onlyIds.length || ROUTES.length)) throw new Error('Unknown route id in --only.');
fs.mkdirSync(outputDir, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const METRICS_EXPRESSION = `(() => {
  const page = document.querySelector('.ops-page-area');
  const main = document.querySelector('.ops-main');
  if (!page || !main) return null;
  page.scrollTop = 0;
  const pageRect = page.getBoundingClientRect();
  const availableHeight = Math.max(1, page.clientHeight);
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
  };
  const clip = (rect) => ({
    left: Math.max(pageRect.left, rect.left),
    right: Math.min(pageRect.right, rect.right),
    top: Math.max(pageRect.top, rect.top),
    bottom: Math.min(pageRect.bottom, rect.bottom)
  });
  const blockSelector = '.ops-card,.ops-surface,section,form,table,[class*="chart"],.recharts-responsive-container,img,video';
  const blocks = Array.from(main.querySelectorAll(blockSelector)).filter(visible);
  const firstScreenBlocks = blocks.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > pageRect.top && rect.top < pageRect.bottom;
  });
  const gridColumns = 24;
  const gridRows = 36;
  let occupied = 0;
  for (let row = 0; row < gridRows; row++) {
    for (let column = 0; column < gridColumns; column++) {
      const x = pageRect.left + ((column + 0.5) / gridColumns) * pageRect.width;
      const y = pageRect.top + ((row + 0.5) / gridRows) * pageRect.height;
      if (firstScreenBlocks.some((element) => {
        const rect = clip(element.getBoundingClientRect());
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      })) occupied++;
    }
  }
  const horizontalOffenders = Array.from(main.querySelectorAll('*')).filter((element) => {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.right > pageRect.right + 1 || rect.left < pageRect.left - 1;
  });
  const media = Array.from(main.querySelectorAll('img,video,.recharts-responsive-container,.recharts-wrapper,[class*="chart"]')).filter(visible);
  const oversizedBlocks = blocks.filter((element) => element.getBoundingClientRect().height > availableHeight + 1);
  const mediaWidthOverflow = media.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left < pageRect.left - 1 || rect.right > pageRect.right + 1;
  });
  const mediaHeightOverflow = media.filter((element) => element.getBoundingClientRect().height > availableHeight + 1);
  const cards = Array.from(main.querySelectorAll('.ops-card,.ops-surface')).filter(visible);
  const firstScreenCards = cards.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > pageRect.top && rect.top < pageRect.bottom;
  });
  const buttonsFirstScreen = Array.from(main.querySelectorAll('button,a[role="button"]')).filter((element) => {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom > pageRect.top && rect.top < pageRect.bottom;
  }).length;
  const rowsFirstScreen = Array.from(main.querySelectorAll('tbody tr,[role="row"]')).filter((element) => {
    if (!visible(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom > pageRect.top && rect.top < pageRect.bottom;
  }).length;
  const maxScrollTop = Math.max(0, page.scrollHeight - page.clientHeight);
  page.scrollTop = maxScrollTop;
  const reachedBottom = maxScrollTop === 0 || page.scrollTop >= maxScrollTop - 1;
  page.scrollTop = 0;
  return {
    innerWidth,
    innerHeight,
    documentScrollHeight: document.documentElement.scrollHeight,
    pageClientHeight: page.clientHeight,
    pageScrollHeight: page.scrollHeight,
    pageHasVerticalOverflow: maxScrollTop > 1,
    pageCanReachBottom: reachedBottom,
    pageOverflowY: getComputedStyle(page).overflowY,
    pageTouchAction: getComputedStyle(page).touchAction,
    documentHorizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    horizontalOverflowCount: horizontalOffenders.length,
    firstScreenBlankRateApprox: Number((1 - occupied / (gridColumns * gridRows)).toFixed(3)),
    firstScreenBlockCount: firstScreenBlocks.length,
    firstScreenCardCount: firstScreenCards.length,
    firstScreenButtonCount: buttonsFirstScreen,
    firstScreenRowCount: rowsFirstScreen,
    totalCardCount: cards.length,
    oversizedBlockCount: oversizedBlocks.length,
    mediaBlockCount: media.length,
    mediaWidthOverflowCount: mediaWidthOverflow.length,
    mediaHeightOverflowCount: mediaHeightOverflow.length,
    maxBlockHeightRatio: Number((Math.max(0, ...blocks.map((element) => element.getBoundingClientRect().height)) / availableHeight).toFixed(3))
  };
})()`;

const REDACTION_EXPRESSION = `(() => {
  document.getElementById('__layout_audit_redaction')?.remove();
  const secretControls = new Set(Array.from(document.querySelectorAll([
    'input[type="password"]',
    'input[autocomplete*="password" i]',
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
    'textarea[name*="token" i]',
    'textarea[name*="cookie" i]',
    'textarea[name*="secret" i]',
    '[data-secret]',
    '[data-token]'
  ].join(','))));
  const credentialLabelKeywords = ['密码', 'token', 'cookie', 'secret', '密钥', '凭据'];
  document.querySelectorAll('label,span').forEach((label) => {
    const labelText = String(label.textContent || '').trim().toLowerCase();
    if (!credentialLabelKeywords.some((keyword) => labelText.includes(keyword))) return;
    const container = label.closest('label') || label.parentElement;
    container?.querySelectorAll('input,textarea,select').forEach((control) => secretControls.add(control));
  });
  secretControls.forEach((control) => {
    control.setAttribute('data-layout-audit-secret', 'true');
    control.style.setProperty('color', 'transparent', 'important');
    control.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    control.style.setProperty('caret-color', 'transparent', 'important');
    control.style.setProperty('text-shadow', 'none', 'important');
  });
  const style = document.createElement('style');
  style.id = '__layout_audit_redaction';
  style.textContent = \`
    .ops-user-panel,
    [data-sonner-toaster] { visibility: hidden !important; }
    [data-layout-audit-secret="true"],
    [data-layout-audit-secret="true"]::placeholder {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      caret-color: transparent !important;
      text-shadow: none !important;
    }
  \`;
  document.head.appendChild(style);
  document.querySelectorAll('.ops-user-panel,[data-sonner-toaster]').forEach((element) => {
    element.style.setProperty('visibility', 'hidden', 'important');
  });
  document.querySelector('.ops-page-area')?.scrollTo(0, 0);
  const isTransparentColor = (value) => {
    const normalized = String(value || '').split(' ').join('');
    if (normalized === 'transparent') return true;
    if (!normalized.startsWith('rgba(')) return false;
    const alpha = normalized.slice(normalized.lastIndexOf(',') + 1, -1);
    return Number(alpha) === 0;
  };
  return {
    redactionInstalled: !!document.getElementById('__layout_audit_redaction'),
    secretControlCount: secretControls.size,
    secretControlsMasked: Array.from(secretControls).every((control) => {
      const computed = getComputedStyle(control);
      return computed.visibility === 'hidden' || isTransparentColor(computed.webkitTextFillColor) || isTransparentColor(computed.color);
    }),
    userPanelHidden: Array.from(document.querySelectorAll('.ops-user-panel')).every((element) => getComputedStyle(element).visibility === 'hidden'),
    drawerClosed: !document.querySelector('aside.ops-sidebar.translate-x-0')
  };
})()`;
(async () => {
  const { socket, send, routeErrors } = await connect();
  const origin = await evaluate(send, 'location.origin');
  if (origin !== 'http://127.0.0.1:5173') throw new Error('Audit requires the fixed USB Vite origin.');
  if (!['day', 'night'].includes(theme)) throw new Error('Theme must be day or night.');
  await evaluate(
    send,
    `localStorage.setItem('LABORATORY_MANAGEMENT_SYSTEM_AMBIENT', ${JSON.stringify(theme)}); true`
  );
  const results = [];
  for (const [id, route] of selectedRoutes) {
    const errorsBefore = { ...routeErrors };
    await send('Page.navigate', { url: origin + '/v5' + route });
    await wait(1800);
    const access = await evaluate(send, `({
      fixedOrigin: location.origin === 'http://127.0.0.1:5173',
      loggedIn: !location.pathname.endsWith('/login'),
      routeMatched: location.pathname === ${JSON.stringify('/v5' + route)},
      appLayout: !!document.querySelector('.ops-layout-shell')
    })`);
    if (!access.fixedOrigin) throw new Error('Origin changed during audit.');
    if (!access.loggedIn) throw new Error('Authentication was lost during route audit.');
    if (!access.routeMatched || !access.appLayout) {
      results.push({ id, route, accessible: false });
      continue;
    }
    await wait(500);
    const metrics = await evaluate(send, METRICS_EXPRESSION);
    const redaction = await evaluate(send, REDACTION_EXPRESSION);
    if (!redaction.redactionInstalled || !redaction.secretControlsMasked || !redaction.userPanelHidden || !redaction.drawerClosed) {
      throw new Error(`Redaction precondition failed for ${route}: ${JSON.stringify(redaction)}`);
    }
    await wait(150);
    const screenshotFile = path.join(outputDir, `${id}-${orientation}-${theme}.png`);
    const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { encoding: null, maxBuffer: 32 * 1024 * 1024 });
    fs.writeFileSync(screenshotFile, png);
    results.push({
      id,
      route,
      accessible: true,
      screenshot: path.basename(screenshotFile),
      metrics,
      runtime: {
        exceptions: routeErrors.exceptions - errorsBefore.exceptions,
        logErrors: routeErrors.logErrors - errorsBefore.logErrors,
        failedLoads: routeErrors.failedLoads - errorsBefore.failedLoads,
        httpErrors: routeErrors.httpErrors - errorsBefore.httpErrors
      }
    });
  }
  fs.writeFileSync(
    path.join(outputDir, `layout-audit-${orientation}-${theme}${onlyIds.length ? '-selected' : ''}.json`),
    JSON.stringify({ orientation, theme, fixedOrigin: true, routes: results }, null, 2)
  );
  console.log(JSON.stringify({ orientation, theme, routeCount: results.length, accessibleCount: results.filter((item) => item.accessible).length }, null, 2));
  socket.close();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});