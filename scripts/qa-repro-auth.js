const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({headless:true});
  const p=await b.newPage();
  // anon protect
  for (const r of ['/devices','/admin/dashboard','/me/reservations']){
    await p.goto('http://127.0.0.1:3000/v5'+r,{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(500);
    console.log('ANON', r, '->', p.url());
  }
  // login then clear on devices
  await p.goto('http://127.0.0.1:3000/v5/login');
  await p.evaluate(async()=>{
    const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000001',password:'123456'})});
    const j=await res.json(); localStorage.setItem('idbs.access_token', j.data.access_token);
  });
  await p.goto('http://127.0.0.1:3000/v5/devices',{waitUntil:'networkidle'});
  await p.waitForTimeout(800);
  // dismiss notice
  const btn=p.getByRole('button',{name:/我已了解/});
  if(await btn.count()) await btn.click();
  console.log('on devices', p.url());
  await p.evaluate(()=>{localStorage.removeItem('idbs.access_token'); localStorage.removeItem('idbs.refresh_token');});
  // trigger by navigation client-side: click calendar
  await p.goto('http://127.0.0.1:3000/v5/calendar',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1000);
  console.log('after clear nav calendar', p.url());
  // password validation variants
  for (const body of [
    {phone:'13800000001',password:'bad'},
    {phone:'13800000001',password:'badbad'},
    {phone:'13800000001',password:'123457'},
    {phone:'13800000099',password:'123456'},
  ]){
    const r=await p.evaluate(async(body)=>{
      const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j=await res.json().catch(()=>({}));
      return {status:res.status, message:j.message, code:j.code, details:j.details||j.errors||j.data};
    }, body);
    console.log('LOGINTRY', body, r);
  }
  // user pages sample after login+dismiss
  await p.evaluate(async()=>{
    const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000001',password:'123456'})});
    const j=await res.json(); localStorage.setItem('idbs.access_token', j.data.access_token);
  });
  for (const r of ['/devices','/reserve','/calendar','/me/reservations','/borrow','/faults','/notifications','/chat','/support/contacts']){
    await p.goto('http://127.0.0.1:3000/v5'+r,{waitUntil:'domcontentloaded'});
    await p.waitForTimeout(700);
    const btn2=p.getByRole('button',{name:/我已了解/});
    if(await btn2.count()) await btn2.click().catch(()=>{});
    const t=(await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,100);
    const broken=/Internal Server Error|TypeError|页面不存在|Failed to fetch/i.test(t);
    console.log('USER', r, broken?'BAD':'ok', t);
  }
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
