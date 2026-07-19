const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({headless:true});
  const p=await b.newPage();
  await p.goto('http://127.0.0.1:3000/v5/login');
  const login=await p.evaluate(async()=>{
    const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13900000010',password:'123456'})});
    const j=await res.json(); localStorage.setItem('idbs.access_token', j.data.access_token);
    return {role:j.data.role, perms:j.data.permissions};
  });
  console.log('login', login);
  // API permission
  const apis=['/api/v5/admin/users','/api/v5/admin/dashboard','/api/v5/admin/system','/api/v5/admin/devices'];
  for(const a of apis){
    const r=await p.evaluate(async(a)=>{
      const res=await fetch(a,{headers:{Authorization:'Bearer '+localStorage.getItem('idbs.access_token')}});
      const t=await res.text(); return {status:res.status, body:t.slice(0,120)};
    }, a);
    console.log('API', a, r);
  }
  await p.goto('http://127.0.0.1:3000/v5/admin/users',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1000);
  const notice=p.getByRole('button',{name:/我已了解/}); if(await notice.count()) await notice.click();
  console.log('users page', p.url(), (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,200));
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
