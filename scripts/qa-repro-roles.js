const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({headless:true});
  async function run(phone, routes){
    const p=await b.newPage();
    const errors=[]; p.on('pageerror', e=>errors.push(e.message));
    await p.goto('http://127.0.0.1:3000/v5/login',{waitUntil:'domcontentloaded'});
    const login=await p.evaluate(async({phone})=>{
      const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password:'123456'})});
      const j=await res.json(); const d=j.data||j;
      if(d.access_token) localStorage.setItem('idbs.access_token', d.access_token);
      return {ok:!!d.access_token,status:res.status,role:d.role,msg:j.message};
    },{phone});
    console.log('LOGIN', phone, login);
    // dismiss notice if any
    await p.goto('http://127.0.0.1:3000/v5/devices',{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(800);
    const btn=p.locator('div.fixed.inset-0.z-50 button', {hasText:'我已了解'});
    if(await btn.count()) await btn.first().click().catch(()=>{});
    for(const r of routes){
      errors.length=0;
      await p.goto('http://127.0.0.1:3000/v5'+r,{waitUntil:'domcontentloaded',timeout:20000}).catch(e=>errors.push('nav:'+e.message));
      await p.waitForTimeout(900);
      const text=(await p.locator('body').innerText().catch(()=> '')).replace(/\s+/g,' ').slice(0,140);
      const ov=await p.locator('div.fixed.inset-0.z-50').count();
      console.log(phone, r, 'url='+p.url().replace('http://127.0.0.1:3000',''), 'ov='+ov, 'err='+(errors[0]||'').slice(0,80), 'text='+text);
    }
    await p.close();
  }
  await run('13900000010', ['/admin/dashboard','/admin/devices','/admin/faults','/admin/maintenance','/admin/system','/admin/users']);
  await run('13900000011', ['/admin/dashboard','/admin/reservations','/admin/requests','/admin/system','/calendar']);
  // invalid route with login
  const p=await b.newPage(); const errors=[]; p.on('pageerror', e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:3000/v5/login');
  await p.evaluate(async()=>{
    const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000001',password:'123456'})});
    const j=await res.json(); localStorage.setItem('idbs.access_token', j.data.access_token);
  });
  await p.goto('http://127.0.0.1:3000/v5/this-route-should-not-exist-xyz',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1500);
  console.log('INVALID', p.url(), 'errors', errors.slice(0,3), 'text', (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,200));
  // banned accounts
  for (const phone of ['13800000004','13800000005']){
    const r=await p.evaluate(async(phone)=>{
      const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password:'123456'})});
      const j=await res.json().catch(()=>({})); return {status:res.status,message:j.message,code:j.code};
    }, phone);
    console.log('RESTRICTED', phone, r);
  }
  await b.close();
})().catch(e=>{console.error(e);process.exit(1);});
