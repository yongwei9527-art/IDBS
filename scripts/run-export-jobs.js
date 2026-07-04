require('dotenv').config();

const crypto = require('crypto');
const { loadConfig } = require('../src/config/env');
const { createDb } = require('../src/lib/db');
const { createRentalService } = require('../src/services/create-rental-service');

async function main() {
  const config = loadConfig();
  const db = createDb({ connectionString: config.databaseUrl, ssl: config.pgssl });
  const service = createRentalService({
    db,
    crypto,
    adminPassword: config.adminPassword,
    tokenSecret: config.tokenSecret,
    uploadDir: config.uploadDir,
    wechatToken: config.wechatToken,
    wechatAppId: config.wechatAppId,
    wechatAppSecret: config.wechatAppSecret,
    wechatAdminOpenids: config.wechatAdminOpenids
  });

  try {
    const adminLogin = await service.adminLogin({ password: process.env.EXPORT_JOB_ADMIN_PASSWORD || config.adminPassword });
    if (!adminLogin?.token) throw new Error('Admin token is not available');
    const limit = Math.max(1, Math.min(Number(process.env.EXPORT_JOB_LIMIT || 10), 100));
    let processed = 0;
    for (let index = 0; index < limit; index += 1) {
      const result = await service.adminRunNextExportJob({}, adminLogin.token);
      if (!result.job) break;
      processed += 1;
      console.log(`export job ${result.job.id} -> ${result.job.status}`);
    }
    console.log(`Processed ${processed} export job(s).`);
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
