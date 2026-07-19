const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), 'backups', 'reports', 'qa-30min');
const outMd = path.join(dir, 'FINAL-multi-agent-evaluation-report.md');
const outJson = path.join(dir, 'FINAL-multi-agent-evaluation-report.json');

function readJson(name) {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

const agents = [
  'agent-student-zhang-report.json',
  'agent-student-li-mobile-report.json',
  'agent-super-admin-report.json',
  'agent-role-admins-report.json',
  'agent-nav-negative-report.json'
].map(readJson).filter(Boolean);

const confirmed = [
  {
    id: 'BUG-001', severity: 'high',
    title: '未登录跳转 redirect 参数错误，深链回跳失败',
    evidence: '匿名访问 /v5/devices、/v5/admin/dashboard、/v5/me/reservations 均落到 /v5/login?redirect=%2Flogin，而不是原始目标路径。',
    impact: '登录后无法回到用户原本想访问的页面；分享链接/书签体验差。',
    likely_cause: 'web/src/features/auth/auth-guard.tsx 的 RequireAuth 在 basepath=/v5 下组装 redirect 异常，或二次跳转把 redirect 写成 /login。',
    expect: '未登录访问 /v5/devices -> /v5/login?redirect=/devices，登录成功后回到 /v5/devices。',
    actual: '固定落到 redirect=/login。'
  },
  {
    id: 'BUG-002', severity: 'high',
    title: '401 登录失败文案被统一改写为“未登录或登录已过期”',
    evidence: '密码错误、封禁账号(13800000004)、驳回账号(13800000005) 调用 POST /api/v5/auth/login 都返回 message=未登录或登录已过期。服务层本应返回手机号或密码不正确/账号已被封禁/审核未通过。',
    impact: '用户无法区分密码错误、封禁、审核驳回；排障困难。',
    likely_cause: 'src/lib/v5-http.js friendlyErrorMessage() 对 status===401 无条件返回固定文案，覆盖 AppError 原始中文 message。',
    expect: '错误密码提示“手机号或密码不正确”；封禁提示封禁；驳回提示审核未通过。',
    actual: '全部显示未登录或登录已过期。'
  },
  {
    id: 'BUG-003', severity: 'medium',
    title: '登录后系统通知弹窗遮罩阻塞页面点击',
    evidence: 'Playwright 点击导航时出现 fixed inset-0 z-50 遮罩 intercepts pointer events；文案为系统通知/使用注意事项。未点“我已了解，确认”无法操作侧栏。',
    impact: '用户若忽略关闭会感觉页面卡死；自动化点击大量失败。',
    likely_cause: 'web/src/features/layout/app-layout.tsx 系统通知 modal；仅确认后 markSystemNoticeRead。',
    expect: '关闭后同版本通知不再挡操作；Esc/遮罩策略应明确。',
    actual: '未确认前完全拦截点击。'
  },
  {
    id: 'BUG-004', severity: 'medium',
    title: '短密码登录返回技术化校验错误',
    evidence: 'password 长度 <6 返回 422 请求体校验失败；>=6 后进入业务层但又被 BUG-002 文案覆盖。',
    impact: '前端直接展示后端 message 时提示不友好。',
    likely_cause: 'routes/v5/auth.js zod password.min(6)。',
    expect: '前端本地校验 + 友好“密码至少6位”。',
    actual: '直接 422 请求体校验失败。'
  },
  {
    id: 'BUG-005', severity: 'medium',
    title: '设备值班管理员权限过宽（含用户管理）',
    evidence: '13900000010 权限含 user.manage/user.approve；可打开 /v5/admin/users 且 API /api/v5/admin/users 返回 200。',
    impact: '若角色本意仅为设备值班，则用户数据暴露与误操作风险偏高。',
    likely_cause: '演示种子角色权限模板过宽。',
    expect: '设备值班默认仅设备/故障/维护相关权限。',
    actual: '可完整查看用户管理页。'
  },
  {
    id: 'BUG-006', severity: 'medium',
    title: '负向/快速切换路径出现 React #185（最大更新深度）',
    evidence: '负向代理大量 pageerror: Minified React error #185。正常业务路由手工复现未稳定出现。',
    impact: '极端导航或状态抖动可能导致页面卡死。',
    likely_cause: 'auth guard + notice + Navigate 在特定条件形成更新环。',
    expect: '任意路由不应无限 render。',
    actual: '负向压测中高频 pageerror #185。'
  },
  {
    id: 'BUG-007', severity: 'low',
    title: '部分前端源码中文 mojibake（当前构建产物正常）',
    evidence: 'login-page.tsx、app-layout.tsx 等源文件中文乱码；运行中 public/v5 中文显示正常。',
    impact: '重新构建时若编码处理不当，文案可能损坏。',
    likely_cause: '文件编码/历史保存问题。',
    expect: '源码 UTF-8 中文可读。',
    actual: '部分 TSX 源码乱码。'
  }
];

const working = [
  '健康检查 /health、/ready 正常，PostgreSQL 连接正常。',
  '演示账号可登录：张三/李四/超管/设备管理员/审批管理员。',
  '学生端核心页可打开：devices/reserve/calendar/me/reservations/borrow/faults/notifications/chat/support/contacts。',
  '超管后台模块可打开：dashboard/devices/reservations/users/faults/maintenance/requests/stats/export/system/audit。',
  '设备值班/审批管理员访问 /admin/system 会被重定向回 dashboard（超管边界有效）。',
  '404 友好页正常：显示“页面不存在”并提供返回设备列表。',
  '清除 token 后访问受保护页会进入登录页（鉴权守卫有效，尽管 redirect 参数错误）。',
  '移动端 Pixel 5 学生页面可渲染，未见白屏主路径失败。',
  '预约审批页展示待审数量等业务数据，运营总览 KPI 有数。'
];

const totalRoutes = agents.reduce((s,a)=>s+(a.stats?.routes||0),0);
const totalLogins = agents.reduce((s,a)=>s+(a.stats?.logins||0),0);
const totalCycles = agents.reduce((s,a)=>s+(a.stats?.cycles||0),0);

const summary = {
  generated_at: new Date().toISOString(),
  base: 'http://127.0.0.1:3000',
  entry: '/v5/',
  duration_target_min: 30,
  overall_rating: 'B-',
  totals: { agents: agents.length, routes: totalRoutes, logins: totalLogins, cycles: totalCycles },
  agents: agents.map(a => ({ id: a.agent, title: a.title, partial: a.partial, stats: a.stats, byType: a.byType, bySeverity: a.bySeverity })),
  confirmed_bugs: confirmed,
  working_features: working
};

const lines = [];
lines.push('# IDBS 5.0 多代理持续用户模拟评估报告');
lines.push('');
lines.push(`- 生成时间: ${summary.generated_at}`);
lines.push('- 目标系统: http://127.0.0.1:3000/v5/');
lines.push('- 审核方式: 5 个并行角色代理 + 持续巡检脚本（Playwright headless）');
lines.push(`- 代理累计轮次/路由/登录: ${totalCycles} / ${totalRoutes} / ${totalLogins}`);
lines.push('- 风险策略: 不执行删除/审批通过驳回/改密/清空等高风险写操作');
lines.push('');
lines.push('## 1. 结论');
lines.push('');
lines.push('系统整体**可登录、可浏览、主流程页面可渲染**，管理员权限边界基本有效。');
lines.push('但存在 **2 个高优先级问题**（登录失败文案被吞、未登录 redirect 深链错误），以及通知弹窗挡操作、角色权限过宽、负向路径 React #185 风险。');
lines.push('');
lines.push('**总体评级: B-（可演示/可试用，上线前建议先修 BUG-001/002）**');
lines.push('');
lines.push('## 2. 代理执行摘要');
lines.push('');
for (const a of agents) {
  lines.push(`### ${a.title || a.agent}`);
  lines.push(`- 轮次: ${a.stats?.cycles || 0}`);
  lines.push(`- 登录成功/失败: ${a.stats?.logins || 0}/${a.stats?.loginFailures || 0}`);
  lines.push(`- 路由访问: ${a.stats?.routes || 0}`);
  lines.push(`- 安全点击: ${a.stats?.clicks || 0}`);
  lines.push(`- 脚本计数问题: ${a.stats?.issues || 0}`);
  lines.push(`- 类型分布: \`${JSON.stringify(a.byType || {})}\``);
  lines.push('');
}
lines.push('## 3. 已确认缺陷（人工复核）');
lines.push('');
for (const b of confirmed) {
  lines.push(`### ${b.id} [${b.severity}] ${b.title}`);
  lines.push(`- 证据: ${b.evidence}`);
  lines.push(`- 影响: ${b.impact}`);
  lines.push(`- 可能原因: ${b.likely_cause}`);
  lines.push(`- 期望: ${b.expect}`);
  lines.push(`- 实际: ${b.actual}`);
  lines.push('');
}
lines.push('## 4. 正常工作的功能');
lines.push('');
for (const w of working) lines.push(`- ${w}`);
lines.push('');
lines.push('## 5. 角色场景观察');
lines.push('');
lines.push('### 学生用户');
lines.push('- 设备列表、预约、日历、我的预约、借还、故障、通知、聊天、联系人页面均可进入并显示业务内容。');
lines.push('- 登录后首屏系统通知需手动确认，否则侧栏点击被遮罩拦截（BUG-003）。');
lines.push('');
lines.push('### 超级管理员');
lines.push('- 总览有业务数字（今日预约/使用中/待审批等），预约审批、系统配置、审计页可打开。');
lines.push('- 未发现后台白屏或主导航 5xx。');
lines.push('');
lines.push('### 角色管理员');
lines.push('- 设备值班: devices/faults/maintenance 可用；system 重定向到 dashboard。');
lines.push('- 预约审批: reservations/requests/calendar 可用；system 同样拦回 dashboard。');
lines.push('- 设备值班仍可打开用户管理（BUG-005）。');
lines.push('');
lines.push('### 负向与导航');
lines.push('- 鉴权守卫存在，但 redirect 深链错误（BUG-001）。');
lines.push('- 404 页文案友好。');
lines.push('- 登录失败/封禁/驳回提示被错误统一（BUG-002）。');
lines.push('');
lines.push('## 6. 修复优先级建议');
lines.push('');
lines.push('1. **P0**: 修复 v5-http 对 401 文案的无条件覆盖，保留业务 message。');
lines.push('2. **P0**: 修复 RequireAuth redirect，保证回到原目标页。');
lines.push('3. **P1**: 通知弹窗关闭策略更明确，避免误判卡死。');
lines.push('4. **P1**: 排查 React #185（auth guard + notice + invalid route）。');
lines.push('5. **P1**: 收紧设备值班角色默认权限（移除不必要的 user.manage）。');
lines.push('6. **P2**: 清理源码中文 mojibake，统一 UTF-8。');
lines.push('');
lines.push('## 7. 产物路径');
lines.push('');
lines.push('- 本报告: `E:\\\\Rental-System\\\\backups\\\\reports\\\\qa-30min\\\\FINAL-multi-agent-evaluation-report.md`');
lines.push('- JSON: `E:\\\\Rental-System\\\\backups\\\\reports\\\\qa-30min\\\\FINAL-multi-agent-evaluation-report.json`');
lines.push('- 各代理: `E:\\\\Rental-System\\\\backups\\\\reports\\\\qa-30min\\\\agent-*-report.md`');
lines.push('- 截图: `E:\\\\Rental-System\\\\backups\\\\reports\\\\qa-30min\\\\agent-*/`');
lines.push('');
lines.push('## 8. 测试账号（本地演示库）');
lines.push('');
lines.push('| 角色 | 手机号 | 密码 |');
lines.push('|---|---|---|');
lines.push('| 学生张三 | 13800000001 | 123456 |');
lines.push('| 学生李四 | 13800000002 | 123456 |');
lines.push('| 超级管理员 | 13900000000 | 123456 |');
lines.push('| 设备值班管理员 | 13900000010 | 123456 |');
lines.push('| 预约审批管理员 | 13900000011 | 123456 |');
lines.push('');

fs.writeFileSync(outMd, lines.join('\n'), 'utf8');
fs.writeFileSync(outJson, JSON.stringify(summary, null, 2), 'utf8');
console.log('wrote', outMd);
console.log(JSON.stringify(summary.totals));
