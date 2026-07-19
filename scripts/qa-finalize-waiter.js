// Wait until multi-agent duration elapses (~22m), then write final report.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const waitMs = Number(process.env.QA_FINALIZE_WAIT_MS || 22 * 60 * 1000);
const log = path.join(process.cwd(), 'logs', 'qa-finalize.out.log');
function w(s){ fs.appendFileSync(log, `[${new Date().toISOString()}] ${s}\n`); }
(async()=>{
  w('finalize waiter started, waitMs='+waitMs);
  await new Promise(r=>setTimeout(r, waitMs));
  w('wait done, writing report');
  const child = spawn(process.execPath, ['scripts/qa-write-final-report.js'], {cwd: process.cwd(), stdio:['ignore','pipe','pipe']});
  let out=''; child.stdout.on('data',d=>out+=d); child.stderr.on('data',d=>out+=d);
  child.on('exit', code => {
    w('report writer exit '+code+' '+out);
    // mark complete
    fs.writeFileSync(path.join(process.cwd(),'backups/reports/qa-30min/FINALIZE-DONE.txt'), new Date().toISOString()+'\n'+out);
  });
})();
