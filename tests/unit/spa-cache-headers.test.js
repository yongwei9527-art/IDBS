const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('create-app configures no-cache for SPA index and hashed asset long-cache', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/app/create-app.js'), 'utf8');
  assert.match(src, /Cache-Control', 'no-cache'/);
  assert.match(src, /max-age=31536000, immutable/);
  assert.match(src, /setHeaders\(res, filePath\)/);
});

test('seedChatDemo binds expires_at for direct conversation', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/seed-demo-data.js'), 'utf8');
  assert.match(src, /last_message_at, expires_at/);
  assert.match(src, /\$2,'direct',null,\$3,\$4,now\(\),\$6,\$7\)/);
});
