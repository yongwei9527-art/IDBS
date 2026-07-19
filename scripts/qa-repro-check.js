const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({headless:true});
  const p=await b.newPage();
  const errors=[];
  p.on('pageerror', e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:3000/v5/login',{waitUntil:'domcontentloaded'});
  const login=await p.evaluate(async()=>{
    const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000001',password:'123456'})});
    const j=await res.json(); const d=j.data||j;
    localStorage.setItem('idbs.access_token', d.access_token);
    return {ok:!!d.access_token, status:res.status};
  });
  console.log('login', login);
  await p.goto('http://127.0.0.1:3000/v5/devices',{waitUntil:'networkidle', timeout:30000});
  await p.waitForTimeout(1500);
  const overlay = await p.locator('div.fixed.inset-0.z-50').count();
  const dialogText = await p.locator('div.fixed.inset-0.z-50').first().innerText().catch(()=> '');
  console.log('overlay count', overlay);
  console.log('overlay text', dialogText.replace(/\s+/g,' ').slice(0,400));
  const buttons = await p.locator('div.fixed.inset-0.z-50 button').allTextContents().catch(()=>[]);
  console.log('buttons', buttons);
  // close if possible
  if (buttons.length) {
    await p.locator('div.fixed.inset-0.z-50 button').last().click().catch(()=>{});
    await p.waitForTimeout(500);
  }
  console.log('overlay after close', await p.locator('div.fixed.inset-0.z-50').count());
  // admin
  await p.evaluate(async()=>{
    const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13900000000',password:'123456'})});
    const j=await res.json(); const d=j.data||j;
    localStorage.setItem('idbs.access_token', d.access_token);
  });
  for (const r of ['/admin/dashboard','/admin/system','/admin/reservations','/chat','/this-route-should-not-exist-xyz']) {
    errors.length=0;
    await p.goto('http://127.0.0.1:3000/v5'+r,{waitUntil:'domcontentloaded', timeout:30000});
    await p.waitForTimeout(1200);
    const t=(await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,180);
    console.log('ROUTE', r, 'URL', p.url());
    console.log('  ERR', errors.slice(0,2));
    console.log('  TEXT', t);
  }
  // negative: invalid route while logged out after clear
  await p.evaluate(()=>{localStorage.clear();});
  errors.length=0;
  await p.goto('http://127.0.0.1:3000/v5/this-route-should-not-exist-xyz',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1000);
  console.log('anon invalid', p.url(), errors.slice(0,2), (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,180));
  await b.close();
})().catch(e=>{console.error(e); process.exit(1);});
