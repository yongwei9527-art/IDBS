const fs=require('fs');const {spawn}=require('child_process');const path=require('path');
const log=path.join('logs','qa-progress-watch.log');
function w(s){fs.appendFileSync(log, `[${new Date().toISOString()}] ${s}\n`);}
const end=Date.now()+10*60*1000;
(async()=>{
  w('progress watch start');
  while(Date.now()<end){
    try{
      const dir='backups/reports/qa-30min';
      const rows=[];
      for(const f of fs.readdirSync(dir).filter(x=>x.startsWith('agent-')&&x.endsWith('-report.json'))){
        const j=JSON.parse(fs.readFileSync(dir+'/'+f,'utf8'));
        const s=j.stats||{};
        rows.push(`${j.agent||f}:c${s.cycles}/r${s.routes}/L${s.logins}/i${s.issues}`);
      }
      w(rows.join(' | '));
      // health
      try{const r=await fetch('http://127.0.0.1:3000/health'); w('health '+r.status);}catch(e){w('health fail '+e.message)}
    }catch(e){w('err '+e.message)}
    await new Promise(r=>setTimeout(r,30000));
  }
  w('progress watch end');
})();
