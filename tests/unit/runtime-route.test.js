const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const { createV5Router } = require('../../src/routes/v5');
const { issueJwt } = require('../../src/lib/auth');

function request(port, token) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/admin/system/runtime',
      headers: token ? { Authorization: 'Bearer ' + token } : {}
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('runtime diagnosis is visible only to super administrators', async () => {
  const previousSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'runtime-route-test-secret-at-least-32-characters';
  const app = express();
  app.use(createV5Router({}, {
    runtimeDiagnostics: async () => ({
      product_version: '5.0.0',
      readiness: { status: 'ready', database: { ready: true, latency_ms: 4 } }
    })
  }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const port = server.address().port;
    const regularToken = issueJwt({ sub: 'student-1', role: 'student', perms: [] });
    const superToken = issueJwt({ sub: 'admin-1', role: 'super_admin', perms: ['*'] });
    const denied = await request(port, regularToken);
    const allowed = await request(port, superToken);
    assert.equal(denied.status, 403);
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.data.product_version, '5.0.0');
    assert.equal(allowed.body.data.readiness.database.latency_ms, 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousSecret === undefined) delete process.env.TOKEN_SECRET;
    else process.env.TOKEN_SECRET = previousSecret;
  }
});
