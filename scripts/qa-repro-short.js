const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({headless:true});
  const p=await b.newPage();
  async function login(phone){
    await p.goto('http://127.0.0.1:3000/v5/login',{waitUntil:'domcontentloaded'});
    return p.evaluate(async(phone)=>{
      const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password:'123456'})});
      const j=await res.json(); const d=j.data||j; if(d.access_token) localStorage.setItem('idbs.access_token',d.access_token);
      return {status:res.status, role:d.role, msg:j.message, ok:!!d.access_token};
    }, phone);
  }
  console.log('approval login', await login('13900000011'));
  for (const r of ['/admin/reservations','/admin/requests','/admin/system','/calendar']){
    await p.goto('http://127.0.0.1:3000/v5'+r,{waitUntil:'domcontentloaded',timeout:15000});
    await p.waitForTimeout(600);
    console.log('A11', r, p.url().replace('http://127.0.0.1:3000',''), (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,120));
  }
  console.log('user login', await login('13800000001'));
  const errors=[]; p.on('pageerror', e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:3000/v5/not-a-real-page-xyz',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1000);
  console.log('invalid', p.url(), errors[0]||'no-err', (await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,160));
  for (const phone of ['13800000004','13800000005']){
    const r=await p.evaluate(async(phone)=>{
      const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,password:'123456'})});
      const j=await res.json().catch(()=>({})); return {status:res.status,message:j.message,code:j.code};
    }, phone);
    console.log('restricted', phone, r);
  }
  // wrong password
  const bad=await p.evaluate(async()=>{
    const res=await fetch('/api/v5/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'13800000001',password:'bad'})});
    const j=await res.json().catch(()=>({})); return {status:res.status,message:j.message};
  });
  console.log('bad pwd', bad);
  // token clear
  await login('13800000001');
  await p.evaluate(()=>{localStorage.removeItem('idbs.access_token'); localStorage.removeItem('idbs.refresh_token');});
  await p.goto('http://127.0.0.1:3000/v5/devices',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(800);
  console.log('after clear', p.url());
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
