/**
 * Continuous multi-persona UI audit for IDBS v5.
 * Simulates normal user and admin flows for DURATION_MS, recording
 * display/navigation/operation errors without high-risk destructive actions.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = (process.env.QA_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const DURATION_MS = Number(process.env.QA_DURATION_MS || 30 * 60 * 1000);
const OUT_DIR = process.env.QA_OUT_DIR || path.join(process.cwd(), 'backups', 'reports', 'qa-30min');
const STARTED = new Date().toISOString();
const RUN_ID = process.env.QA_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');

const PERSONAS = [
  {
    id: 'student_zhang',
    name: '学生用户-张三',
    phone: '13800000001',
    password: '123456',
    routes: [
      '/devices', '/reserve', '/calendar?month=2026-07', '/me/reservations',
      '/borrow', '/faults', '/notifications', '/chat', '/support/contacts'
    ],
    interactions: ['devices', 'reserve', 'calendar', 'my_reservations', 'borrow', 'notifications', 'chat']
  },
  {
    id: 'student_li',
    name: '学生用户-李四',
    phone: '13800000002',
    password: '123456',
    routes: [
      '/devices', '/reserve', '/calendar', '/me/reservations', '/borrow', '/faults', '/chat'
    ],
    interactions: ['devices', 'reserve', 'my_reservations', 'faults', 'chat']
  },
  {
    id: 'super_admin',
    name: '超级管理员',
    phone: '13900000000',
    password: '123456',
    routes: [
      '/admin/dashboard', '/admin/devices', '/admin/reservations?status=pending',
      '/admin/users', '/admin/faults', '/admin/maintenance', '/admin/requests',
      '/admin/stats', '/admin/export', '/admin/system', '/admin/audit',
      '/devices', '/calendar', '/chat'
    ],
    interactions: ['admin_dashboard', 'admin_reservations', 'admin_devices', 'admin_users', 'admin_system']
  },
  {
    id: 'device_admin',
    name: '设备值班管理员',
    phone: '13900000010',
    password: '123456',
    routes: ['/admin/dashboard', '/admin/devices', '/admin/faults', '/admin/maintenance', '/devices', '/borrow'],
    interactions: ['admin_devices', 'admin_dashboard']
  },
  {
    id: 'approval_admin',
    name: '预约审批管理员',
    phone: '13900000011',
    password: '123456',
    routes: ['/admin/dashboard', '/admin/reservations', '/admin/requests', '/calendar', '/me/reservations'],
    interactions: ['admin_reservations', 'admin_dashboard']
  }
];

const findings = [];
const pageVisits = [];
const consoleErrors = [];
const networkFailures = [];
const navIssues = [];
const displayIssues = [];
const opIssues = [];
const personaStats = {};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function pushFinding(f) {
  findings.push({ ...f, at: new Date().toISOString() });
}

function textLooksBroken(text) {
  return /Internal Server Error|TypeError:|ReferenceError:|SyntaxError:|Failed to fetch|NetworkError|Cannot GET|HTTP\s*5\d\d|Unhandled|白屏|页面不存在|Something went wrong|undefined is not|is not a function/i.test(text || '');
}

function hasMojibake(text) {
  // common UTF-8 misread patterns in Chinese UI
  return /[鍒鍙鏄鏁鏉璐棰璇閿]{4,}/.test(text || '') || /Ã.|Â.|ï¿½/.test(text || '');
}

async function apiLogin(page, phone, password) {
  await page.goto(`${BASE}/v5/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const result = await page.evaluate(async ({ phone, password }) => {
    const res = await fetch('/api/v5/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    const json = await res.json().catch(() => ({}));
    const data = json.data || json;
    if (!res.ok || !data.access_token) {
      return { ok: false, status: res.status, message: json.message || json.error || 'login failed' };
    }
    localStorage.setItem('idbs.access_token', data.access_token);
    if (data.refresh_token) localStorage.setItem('idbs.refresh_token', data.refresh_token);
    return { ok: true, role: data.role, name: data.name || data.user?.name };
  }, { phone, password });
  return result;
}

async function captureSnapshot(page, persona, route, label) {
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const title = await page.title().catch(() => '');
  const url = page.url();
  const emptyish = !bodyText || bodyText.replace(/\s+/g, '').length < 20;
  const broken = textLooksBroken(bodyText);
  const mojibake = hasMojibake(bodyText);
  const visit = {
    persona: persona.id,
    route,
    label,
    url,
    title,
    emptyish,
    broken,
    mojibake,
    textSample: (bodyText || '').replace(/\s+/g, ' ').slice(0, 240),
    at: new Date().toISOString()
  };
  pageVisits.push(visit);
  if (broken) {
    pushFinding({ severity: 'high', type: 'page_error_text', persona: persona.id, route, url, detail: visit.textSample });
    displayIssues.push(visit);
  }
  if (emptyish) {
    pushFinding({ severity: 'high', type: 'blank_or_empty_page', persona: persona.id, route, url, detail: 'Body text too short' });
    displayIssues.push(visit);
  }
  if (mojibake) {
    pushFinding({ severity: 'medium', type: 'mojibake_or_encoding', persona: persona.id, route, url, detail: visit.textSample });
    displayIssues.push(visit);
  }
  // unexpected bounce to login while authenticated
  if (/\/v5\/login/i.test(url) && route !== '/login') {
    pushFinding({ severity: 'high', type: 'unexpected_login_redirect', persona: persona.id, route, url, detail: 'Redirected to login while session should exist' });
    navIssues.push(visit);
  }
  // not-found page
  if (/页面不存在|Page not found|404/i.test(bodyText)) {
    pushFinding({ severity: 'high', type: 'not_found', persona: persona.id, route, url, detail: visit.textSample });
    navIssues.push(visit);
  }
  return visit;
}

async function safeClicks(page, persona, route) {
  // Click low-risk navigation/tab/filter controls only.
  const candidates = page.locator('a,button,[role="button"],[role="tab"],[role="link"]');
  const count = Math.min(await candidates.count().catch(() => 0), 18);
  let clicked = 0;
  for (let i = 0; i < count; i += 1) {
    const el = candidates.nth(i);
    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;
    const text = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label').catch(() => '')) || '').trim();
    if (!text) continue;
    if (/(删除|驳回|审批|保存|新增|创建|提交|下载|导出|关闭|禁用|归还|确认|重置|清空|转交|处理|发送|上传|立即|运行|开始|领取|扫码|取消预约|续约|退出|登出|delete|remove|reject|approve|submit|save|create|export|download|logout)/i.test(text)) {
      continue;
    }
    const before = page.url();
    try {
      await el.click({ timeout: 1500, trial: false });
      clicked += 1;
      await page.waitForTimeout(400);
      const after = page.url();
      if (after !== before) {
        await captureSnapshot(page, persona, route, `after-click:${text.slice(0, 40)}`);
        // return to original route if navigated away
        if (!after.includes(route.split('?')[0])) {
          await page.goto(`${BASE}/v5${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        }
      }
    } catch (err) {
      pushFinding({
        severity: 'low',
        type: 'click_failed',
        persona: persona.id,
        route,
        detail: `${text.slice(0, 60)} -> ${err.message}`
      });
      opIssues.push({ persona: persona.id, route, text, error: err.message, at: new Date().toISOString() });
    }
  }
  return clicked;
}

async function simulatePersonaCycle(context, persona, cycle) {
  const page = await context.newPage();
  const errorsLocal = [];
  page.on('pageerror', (e) => {
    const item = { persona: persona.id, cycle, message: e.message, at: new Date().toISOString() };
    consoleErrors.push(item);
    pushFinding({ severity: 'high', type: 'pageerror', persona: persona.id, detail: e.message });
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const msg = m.text();
      if (/favicon|Download the React DevTools/i.test(msg)) return;
      consoleErrors.push({ persona: persona.id, cycle, message: msg, at: new Date().toISOString() });
      pushFinding({ severity: 'medium', type: 'console_error', persona: persona.id, detail: msg.slice(0, 300) });
    }
  });
  page.on('response', (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && /\/api\/v5\//.test(url)) {
      networkFailures.push({ persona: persona.id, cycle, status, url, at: new Date().toISOString() });
      if (status >= 500) {
        pushFinding({ severity: 'high', type: 'api_5xx', persona: persona.id, detail: `${status} ${url}` });
      } else if (status === 404) {
        pushFinding({ severity: 'medium', type: 'api_404', persona: persona.id, detail: `${status} ${url}` });
      }
    }
  });

  if (!personaStats[persona.id]) {
    personaStats[persona.id] = { name: persona.name || persona.id, logins: 0, loginFailures: 0, routes: 0, clicks: 0 };
  }
  const login = await apiLogin(page, persona.phone, persona.password);
  if (!login.ok) {
    pushFinding({ severity: 'critical', type: 'login_failed', persona: persona.id, detail: `${login.status} ${login.message}` });
    personaStats[persona.id].loginFailures += 1;
    await page.close().catch(() => {});
    return;
  }
  personaStats[persona.id].logins += 1;

  for (const route of persona.routes) {
    try {
      const target = `${BASE}/v5${route}`;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(700);
      await captureSnapshot(page, persona, route, `visit-cycle-${cycle}`);
      const clicked = await safeClicks(page, persona, route);
      personaStats[persona.id].clicks += clicked;
      personaStats[persona.id].routes += 1;
    } catch (err) {
      pushFinding({ severity: 'high', type: 'navigation_exception', persona: persona.id, route, detail: err.message });
      navIssues.push({ persona: persona.id, route, error: err.message, at: new Date().toISOString() });
    }
  }

  // unauthenticated redirect check occasionally
  if (cycle % 3 === 0 && persona.id === 'student_zhang') {
    const anon = await context.browser().newPage();
    try {
      await anon.goto(`${BASE}/v5/devices`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await anon.waitForTimeout(500);
      const url = anon.url();
      if (!/login/i.test(url)) {
        pushFinding({ severity: 'high', type: 'auth_guard_missing', persona: 'anonymous', route: '/devices', url, detail: 'Protected page accessible without login' });
        navIssues.push({ persona: 'anonymous', route: '/devices', url, at: new Date().toISOString() });
      }
    } catch (err) {
      pushFinding({ severity: 'medium', type: 'anon_nav_exception', detail: err.message });
    } finally {
      await anon.close().catch(() => {});
    }
  }

  await page.close().catch(() => {});
}

function writeReport(partial = false) {
  ensureDir(OUT_DIR);
  const finished = new Date().toISOString();
  const byType = {};
  const bySeverity = {};
  for (const f of findings) {
    byType[f.type] = (byType[f.type] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }
  const report = {
    run_id: RUN_ID,
    partial,
    base: BASE,
    started_at: STARTED,
    finished_at: finished,
    duration_ms_target: DURATION_MS,
    duration_ms_actual: Date.now() - Date.parse(STARTED),
    summary: {
      findings: findings.length,
      pageVisits: pageVisits.length,
      consoleErrors: consoleErrors.length,
      networkFailures: networkFailures.length,
      navIssues: navIssues.length,
      displayIssues: displayIssues.length,
      opIssues: opIssues.length,
      byType,
      bySeverity,
      personaStats
    },
    findings: findings.slice(-500),
    recentVisits: pageVisits.slice(-100),
    consoleErrors: consoleErrors.slice(-100),
    networkFailures: networkFailures.slice(-100),
    navIssues: navIssues.slice(-100),
    displayIssues: displayIssues.slice(-100),
    opIssues: opIssues.slice(-100)
  };
  const jsonPath = path.join(OUT_DIR, `continuous-audit-${RUN_ID}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  const md = [
    `# IDBS 持续用户模拟审核报告`,
    ``,
    `- 运行 ID: ${RUN_ID}`,
    `- 目标地址: ${BASE}`,
    `- 开始: ${STARTED}`,
    `- 结束: ${finished}`,
    `- 是否中途快照: ${partial}`,
    `- 发现问题: ${findings.length}`,
    `- 页面访问: ${pageVisits.length}`,
    `- 控制台错误: ${consoleErrors.length}`,
    `- API 失败: ${networkFailures.length}`,
    `- 跳转问题: ${navIssues.length}`,
    `- 显示问题: ${displayIssues.length}`,
    `- 操作问题: ${opIssues.length}`,
    ``,
    `## 按严重级别`,
    ...Object.entries(bySeverity).map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `## 按类型`,
    ...Object.entries(byType).map(([k, v]) => `- ${k}: ${v}`),
    ``,
    `## 角色统计`,
    '```json',
    JSON.stringify(personaStats, null, 2),
    '```',
    ``,
    `## 关键问题（最多 40 条）`,
    ...findings.slice(0, 40).map((f, i) => `${i + 1}. [${f.severity}] ${f.type} @ ${f.persona || '-'} ${f.route || ''} — ${f.detail || ''}`),
    ``
  ].join('\n');
  const mdPath = path.join(OUT_DIR, `continuous-audit-${RUN_ID}.md`);
  fs.writeFileSync(mdPath, md, 'utf8');
  return { jsonPath, mdPath, report };
}

async function main() {
  ensureDir(OUT_DIR);
  for (const p of PERSONAS) {
    personaStats[p.id] = { name: p.name, logins: 0, loginFailures: 0, routes: 0, clicks: 0 };
  }
  const browser = await chromium.launch({ headless: true });
  const deadline = Date.now() + DURATION_MS;
  let cycle = 0;
  console.log(`[qa] continuous audit started for ${DURATION_MS}ms -> ${BASE}`);
  try {
    while (Date.now() < deadline) {
      cycle += 1;
      console.log(`[qa] cycle ${cycle} remaining_ms=${Math.max(0, deadline - Date.now())}`);
      // run personas mostly sequentially to reduce DB/rate-limit pressure; two at a time
      for (let i = 0; i < PERSONAS.length; i += 2) {
        const batch = PERSONAS.slice(i, i + 2);
        await Promise.all(batch.map(async (persona) => {
          const context = await browser.newContext({
            viewport: persona.id.includes('admin') ? { width: 1440, height: 900 } : { width: 1280, height: 800 },
            locale: 'zh-CN'
          });
          try {
            await simulatePersonaCycle(context, persona, cycle);
          } finally {
            await context.close().catch(() => {});
          }
        }));
      }
      // mobile viewport pass for student every cycle
      {
        const persona = PERSONAS[0];
        const context = await browser.newContext({
          ...require('playwright').devices['Pixel 5'],
          locale: 'zh-CN'
        });
        try {
          await simulatePersonaCycle(context, { ...persona, id: persona.id + '_mobile', name: persona.name + '(移动端)' }, cycle);
          if (!personaStats[persona.id + '_mobile']) {
            personaStats[persona.id + '_mobile'] = { name: persona.name + '(移动端)', logins: 0, loginFailures: 0, routes: 0, clicks: 0 };
          }
        } finally {
          await context.close().catch(() => {});
        }
      }
      writeReport(true);
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    const out = writeReport(false);
    await browser.close().catch(() => {});
    console.log(`[qa] finished findings=${findings.length} report=${out.mdPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  try { writeReport(true); } catch (_) {}
  process.exit(1);
});

