/**
 * Multi-agent parallel persona auditors for IDBS v5 (~30 min).
 * Each agent writes its own report; parent writes combined summary periodically.
 */
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const BASE = (process.env.QA_BASE || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const DURATION_MS = Number(process.env.QA_AGENT_DURATION_MS || 30 * 60 * 1000);
const OUT = path.join(process.cwd(), 'backups', 'reports', 'qa-30min');
const RUN_ID = process.env.QA_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');

const AGENTS = [
  {
    id: 'agent-student-zhang',
    title: '学生用户张三代理',
    phone: '13800000001',
    password: '123456',
    device: null,
    routes: ['/devices','/reserve','/calendar?month=2026-07','/me/reservations','/borrow','/faults','/notifications','/chat','/support/contacts']
  },
  {
    id: 'agent-student-li-mobile',
    title: '学生用户李四移动端代理',
    phone: '13800000002',
    password: '123456',
    device: 'Pixel 5',
    routes: ['/devices','/reserve','/calendar','/me/reservations','/borrow','/faults','/chat','/notifications']
  },
  {
    id: 'agent-super-admin',
    title: '超级管理员代理',
    phone: '13900000000',
    password: '123456',
    device: null,
    routes: ['/admin/dashboard','/admin/devices','/admin/reservations?status=pending','/admin/users','/admin/faults','/admin/maintenance','/admin/requests','/admin/stats','/admin/export','/admin/system','/admin/audit','/devices','/calendar','/chat']
  },
  {
    id: 'agent-role-admins',
    title: '角色管理员代理',
    multiAccounts: [
      { phone: '13900000010', password: '123456', routes: ['/admin/dashboard','/admin/devices','/admin/faults','/admin/maintenance','/admin/system','/admin/users'] },
      { phone: '13900000011', password: '123456', routes: ['/admin/dashboard','/admin/reservations','/admin/requests','/calendar','/admin/system'] }
    ]
  },
  {
    id: 'agent-nav-negative',
    title: '导航与负向用例代理',
    negative: true
  }
];

function ensure(dir){ fs.mkdirSync(dir,{recursive:true}); }
function broken(t){ return /Internal Server Error|TypeError:|ReferenceError:|SyntaxError:|Failed to fetch|NetworkError|Cannot GET|HTTP\s*5\d\d|Unhandled|undefined is not|is not a function/i.test(t||''); }
function mojibake(t){ return /[鍒鍙鏄鏁鏉璐棰璇閿]{4,}/.test(t||'') || /Ã.|Â.|ï¿½/.test(t||''); }

async function login(page, phone, password){
  await page.goto(BASE + '/v5/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  for (let attempt = 1; attempt <= 6; attempt++) {
    const result = await page.evaluate(async ({phone,password}) => {
      const res = await fetch('/api/v5/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({phone,password})});
      const j = await res.json().catch(()=>({}));
      const d = j.data || j;
      if(!res.ok || !d.access_token) return {ok:false,status:res.status,message:j.message||'login failed', retryAfter: Number(res.headers.get('Retry-After')||0)};
      localStorage.setItem('idbs.access_token', d.access_token);
      if(d.refresh_token) localStorage.setItem('idbs.refresh_token', d.refresh_token);
      return {ok:true, role:d.role, name:d.name};
    }, {phone,password});
    if (result.ok) return result;
    if (result.status === 429) {
      await page.waitForTimeout(Math.max(1500, (result.retryAfter||1)*1000) + attempt*500);
      continue;
    }
    return result;
  }
  return {ok:false,status:429,message:'login rate limited after retries'};
}

async function dismissNotice(page){
  try {
    const btn = page.getByRole('button', { name: /我已了解/ });
    if (await btn.count()) {
      await btn.first().click({timeout:2000});
      await page.waitForTimeout(300);
    }
  } catch (_) {}
}
async function auditRoute(page, agent, phone, route, findings, stats, shotDir){
  const target = BASE + '/v5' + route;
  const before = Date.now();
  try {
    const respPromise = page.waitForResponse(r => r.url().includes('/api/v5/') && r.status() >= 400, {timeout: 2500}).catch(()=>null);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(900);
    const badApi = await respPromise;
    const text = await page.locator('body').innerText().catch(()=> '');
    const url = page.url();
    const sample = (text||'').replace(/\s+/g,' ').slice(0,220);
    stats.routes += 1;
    if (broken(text)) {
      findings.push({severity:'high', type:'page_error_text', phone, route, url, detail:sample});
      stats.issues += 1;
    }
    if (!text || text.replace(/\s+/g,'').length < 15) {
      findings.push({severity:'high', type:'blank_page', phone, route, url, detail:'empty body'});
      stats.issues += 1;
    }
    if (mojibake(text)) {
      findings.push({severity:'medium', type:'mojibake', phone, route, url, detail:sample});
      stats.issues += 1;
    }
    if (/\/v5\/login/i.test(url) && route !== '/login') {
      findings.push({severity:'high', type:'unexpected_login_redirect', phone, route, url, detail:'redirected to login'});
      stats.issues += 1;
    }
    if (/页面不存在|Page not found/i.test(text)) {
      findings.push({severity:'high', type:'not_found_page', phone, route, url, detail:sample});
      stats.issues += 1;
    }
    if (badApi) {
      findings.push({severity: badApi.status()>=500?'high':'medium', type:'api_error_during_nav', phone, route, url: badApi.url(), detail: 'status '+badApi.status()});
      stats.issues += 1;
    }
    // safe clicks
    const btns = page.locator('a,button,[role="button"],[role="tab"]');
    const n = Math.min(await btns.count().catch(()=>0), 12);
    for (let i=0;i<n;i++){
      const el = btns.nth(i);
      if (!(await el.isVisible().catch(()=>false))) continue;
      const label = ((await el.innerText().catch(()=>''))||'').trim();
      if (!label) continue;
      if (/(删除|驳回|审批|保存|新增|创建|提交|下载|导出|关闭|禁用|归还|确认|重置|清空|转交|处理|发送|上传|立即|运行|开始|领取|扫码|取消预约|续约|退出|登出|delete|remove|reject|approve|submit|save|create|export|download|logout)/i.test(label)) continue;
      try {
        await el.click({timeout:1200});
        stats.clicks += 1;
        await page.waitForTimeout(350);
      } catch (e) {
        findings.push({severity:'low', type:'click_failed', phone, route, detail: label.slice(0,40)+' -> '+e.message});
      }
    }
    if (stats.routes % 8 === 0) {
      ensure(shotDir);
      await page.screenshot({ path: path.join(shotDir, `${agent.id}-${stats.routes}.png`), fullPage: true }).catch(()=>{});
    }
  } catch (e) {
    findings.push({severity:'high', type:'nav_exception', phone, route, detail:e.message});
    stats.issues += 1;
  }
  stats.ms += Date.now()-before;
}

async function runNegative(agent, deadline){
  const findings=[]; const stats={routes:0,clicks:0,issues:0,logins:0,loginFailures:0,ms:0,cycles:0};
  const browser = await chromium.launch({headless:true});
  const shotDir = path.join(OUT, agent.id);
  ensure(shotDir);
  try {
    while(Date.now()<deadline){
      stats.cycles += 1;
      const ctx = await browser.newContext({locale:'zh-CN', viewport:{width:1280,height:800}});
      const page = await ctx.newPage();
      page.on('pageerror', e => { findings.push({severity:'high', type:'pageerror', detail:e.message}); stats.issues++; });
      // anon protected
      for (const route of ['/devices','/admin/dashboard','/me/reservations']){
        await page.goto(BASE+'/v5'+route,{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
        await page.waitForTimeout(500);
        const url=page.url(); const text=await page.locator('body').innerText().catch(()=> '');
        stats.routes++;
        if(!/login/i.test(url)){
          findings.push({severity:'high', type:'auth_guard_missing', route, url, detail:'protected without login'});
          stats.issues++;
        } else {
          // expected
        }
      }
      // bad password
      await page.goto(BASE+'/v5/login',{waitUntil:'domcontentloaded'});
      const bad = await page.evaluate(async()=>{
        const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000001',password:'wrong-password-xyz'})});
        const j=await res.json().catch(()=>({}));
        return {status:res.status, message:j.message||''};
      });
      if (bad.status === 200) {
        findings.push({severity:'critical', type:'bad_password_accepted', detail:JSON.stringify(bad)});
        stats.issues++;
      } else if (!bad.message) {
        findings.push({severity:'medium', type:'bad_password_no_message', detail:JSON.stringify(bad)});
        stats.issues++;
      }
      // banned / rejected
      for (const phone of ['13800000004','13800000005']){
        const r = await page.evaluate(async(phone)=>{
          const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password:'123456'})});
          const j=await res.json().catch(()=>({}));
          return {status:res.status, message:j.message||'', code:j.code};
        }, phone);
        if (r.status === 200) {
          findings.push({severity:'high', type:'restricted_account_login_allowed', phone, detail:JSON.stringify(r)});
          stats.issues++;
        } else if (/TypeError|Internal|stack|at\s+/i.test(r.message||'')) {
          findings.push({severity:'medium', type:'restricted_login_ugly_error', phone, detail:JSON.stringify(r)});
          stats.issues++;
        }
      }
      // 404 page after login
      const okLogin = await login(page,'13800000001','123456');
      if (okLogin.ok){
        stats.logins++;
        await page.goto(BASE+'/v5/this-route-should-not-exist-xyz',{waitUntil:'domcontentloaded'});
        await page.waitForTimeout(600);
        const text=await page.locator('body').innerText().catch(()=> '');
        const url=page.url();
        stats.routes++;
        if (!/不存在|not found|404|没有对应/i.test(text) && !broken(text)) {
          // maybe redirected; note if blank
          if ((text||'').replace(/\s+/g,'').length<20){
            findings.push({severity:'medium', type:'unknown_route_blank', url, detail:text});
            stats.issues++;
          }
        }
        // clear token
        await page.evaluate(()=>{ localStorage.removeItem('idbs.access_token'); localStorage.removeItem('idbs.refresh_token'); });
        await page.goto(BASE+'/v5/devices',{waitUntil:'domcontentloaded'});
        await page.waitForTimeout(600);
        if (!/login/i.test(page.url())){
          findings.push({severity:'high', type:'session_clear_not_enforced', url:page.url(), detail:'still on protected page after token clear'});
          stats.issues++;
        }
      } else {
        stats.loginFailures++;
        findings.push({severity:'critical', type:'login_failed', detail:JSON.stringify(okLogin)});
      }
      // health
      const health = await page.evaluate(async()=>{
        const h=await fetch('/health'); const r=await fetch('/ready');
        return {h:h.status, r:r.status};
      });
      if (health.h!==200 || health.r!==200){
        findings.push({severity:'critical', type:'health_not_ok', detail:JSON.stringify(health)});
        stats.issues++;
      }
      await page.screenshot({path:path.join(shotDir, `neg-${stats.cycles}.png`)}).catch(()=>{});
      await ctx.close();
      writeAgentReport(agent, findings, stats, true);
      await new Promise(r=>setTimeout(r, 8000));
    }
  } finally {
    writeAgentReport(agent, findings, stats, false);
    await browser.close().catch(()=>{});
  }
  return {agent, findings, stats};
}

function writeAgentReport(agent, findings, stats, partial){
  ensure(OUT);
  const bySev={}; const byType={};
  for(const f of findings){ bySev[f.severity]=(bySev[f.severity]||0)+1; byType[f.type]=(byType[f.type]||0)+1; }
  const json = {
    agent: agent.id, title: agent.title, partial, run_id: RUN_ID, base: BASE,
    finished_at: new Date().toISOString(), stats, bySeverity: bySev, byType,
    findings: findings.slice(-300)
  };
  fs.writeFileSync(path.join(OUT, `${agent.id}-report.json`), JSON.stringify(json,null,2));
  const md = [
    `# ${agent.title} 评估报告`,
    ``,
    `- 代理ID: ${agent.id}`,
    `- 运行ID: ${RUN_ID}`,
    `- 部分结果: ${partial}`,
    `- 轮次: ${stats.cycles||0}`,
    `- 登录成功: ${stats.logins||0}`,
    `- 登录失败: ${stats.loginFailures||0}`,
    `- 路由访问: ${stats.routes||0}`,
    `- 安全点击: ${stats.clicks||0}`,
    `- 问题数: ${stats.issues||0}`,
    ``,
    `## 严重级别`,
    ...Object.entries(bySev).map(([k,v])=>`- ${k}: ${v}`),
    ``,
    `## 问题类型`,
    ...Object.entries(byType).map(([k,v])=>`- ${k}: ${v}`),
    ``,
    `## 问题明细（最多50）`,
    ...findings.slice(0,50).map((f,i)=>`${i+1}. [${f.severity}] ${f.type} ${f.phone||''} ${f.route||''} — ${(f.detail||'').toString().slice(0,180)}`),
    ``
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `${agent.id}-report.md`), md, 'utf8');
}

async function runPersona(agent, deadline){
  if (agent.negative) return runNegative(agent, deadline);
  const findings=[]; const stats={routes:0,clicks:0,issues:0,logins:0,loginFailures:0,ms:0,cycles:0};
  const browser = await chromium.launch({headless:true});
  const shotDir = path.join(OUT, agent.id);
  ensure(shotDir);
  try {
    while(Date.now()<deadline){
      stats.cycles += 1;
      const accounts = agent.multiAccounts || [{phone:agent.phone,password:agent.password,routes:agent.routes}];
      for (const acc of accounts){
        const opts = agent.device ? { ...devices[agent.device], locale:'zh-CN' } : { locale:'zh-CN', viewport:{width:1440,height:900} };
        const ctx = await browser.newContext(opts);
        const page = await ctx.newPage();
        page.on('pageerror', e => { findings.push({severity:'high', type:'pageerror', phone:acc.phone, detail:e.message}); stats.issues++; });
        page.on('console', m => {
          if (m.type()==='error') {
            const t=m.text();
            if (/favicon|React DevTools/i.test(t)) return;
            findings.push({severity:'medium', type:'console_error', phone:acc.phone, detail:t.slice(0,250)});
          }
        });
        page.on('response', res => {
          if (res.status()>=500 && /\/api\/v5\//.test(res.url())) {
            findings.push({severity:'high', type:'api_5xx', phone:acc.phone, detail: res.status()+' '+res.url()});
            stats.issues++;
          }
        });
        const lg = await login(page, acc.phone, acc.password);
        if (!lg.ok){
          stats.loginFailures++;
          findings.push({severity:'critical', type:'login_failed', phone:acc.phone, detail:`${lg.status} ${lg.message}`});
          await ctx.close();
          continue;
        }
        stats.logins++;
        for (const route of acc.routes){
          await auditRoute(page, agent, acc.phone, route, findings, stats, shotDir);
          if (Date.now()>=deadline) break;
        }
        await ctx.close();
      }
      writeAgentReport(agent, findings, stats, true);
      await new Promise(r=>setTimeout(r, 4000));
    }
  } finally {
    writeAgentReport(agent, findings, stats, false);
    await browser.close().catch(()=>{});
  }
  return {agent, findings, stats};
}

async function writeCombined(){
  const parts = [];
  for (const a of AGENTS){
    const p = path.join(OUT, `${a.id}-report.json`);
    if (fs.existsSync(p)) parts.push(JSON.parse(fs.readFileSync(p,'utf8')));
  }
  const allFindings = parts.flatMap(p => (p.findings||[]).map(f => ({...f, agent:p.agent, title:p.title})));
  const summary = {
    run_id: RUN_ID,
    generated_at: new Date().toISOString(),
    agents: parts.map(p => ({id:p.agent, title:p.title, stats:p.stats, bySeverity:p.bySeverity, byType:p.byType})),
    total_findings: allFindings.length,
    top_findings: allFindings.slice(0,80)
  };
  fs.writeFileSync(path.join(OUT, `combined-agents-${RUN_ID}.json`), JSON.stringify(summary,null,2));
  const md = [
    `# IDBS 多代理并行用户模拟评估报告`,
    ``,
    `- 生成时间: ${summary.generated_at}`,
    `- 运行ID: ${RUN_ID}`,
    `- Base: ${BASE}`,
    `- 代理数: ${parts.length}`,
    `- 汇总问题条目: ${allFindings.length}`,
    ``,
    `## 各代理摘要`,
    ...parts.map(p => `- **${p.title}** (${p.agent}): 轮次 ${p.stats?.cycles||0}, 登录 ${p.stats?.logins||0}, 路由 ${p.stats?.routes||0}, 点击 ${p.stats?.clicks||0}, 问题 ${p.stats?.issues||0}`),
    ``,
    `## 关键问题（跨代理）`,
    ...allFindings.slice(0,60).map((f,i)=>`${i+1}. [${f.severity}] ${f.title||f.agent} / ${f.type} ${f.route||''} — ${(f.detail||'').toString().slice(0,160)}`),
    ``
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `combined-agents-${RUN_ID}.md`), md, 'utf8');
  // also stable names
  fs.writeFileSync(path.join(OUT, 'combined-agents-latest.md'), md, 'utf8');
  fs.writeFileSync(path.join(OUT, 'combined-agents-latest.json'), JSON.stringify(summary,null,2));
}

async function main(){
  ensure(OUT);
  const deadline = Date.now() + DURATION_MS;
  console.log(`[multi-agent] start ${AGENTS.length} agents for ${DURATION_MS}ms`);
  const ticker = setInterval(() => { writeCombined().catch(()=>{}); }, 20000);
  try {
    await Promise.all(AGENTS.map(a => runPersona(a, deadline).then(r => {
      console.log(`[multi-agent] done ${a.id} issues=${r.stats.issues} routes=${r.stats.routes}`);
      return r;
    })));
  } finally {
    clearInterval(ticker);
    await writeCombined();
    console.log('[multi-agent] all finished');
  }
}

main().catch(e => { console.error(e); process.exit(1); });


