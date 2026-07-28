const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { collectInlineScriptHashes, createSecurityHeaders } = require('../../src/app/create-app');

test('CSP protects the V5 single-page application without unsafe inline scripts', () => {
  const publicDir = path.resolve(__dirname, '..', '..', 'public', 'v5');
  const hashes = collectInlineScriptHashes(publicDir);
  assert.deepEqual(hashes, []);

  const headers = {};
  let nextCalls = 0;
  createSecurityHeaders(publicDir)({}, { setHeader(name, value) { headers[name] = value; } }, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.match(headers['Content-Security-Policy'], /script-src 'self'/);
  assert.doesNotMatch(headers['Content-Security-Policy'], /script-src[^;]*'unsafe-inline'/);
});

test('CSP permits only explicitly configured HTTP API origins for connections', () => {
  const publicDir = path.resolve(__dirname, '..', '..', 'public', 'v5');
  const headers = {};
  createSecurityHeaders(publicDir, { corsOrigin: 'https://api.example.test,http://192.0.2.15:3000' })(
    {},
    { setHeader(name, value) { headers[name] = value; } },
    () => {}
  );

  const csp = headers['Content-Security-Policy'];
  assert.match(csp, /connect-src[^;]*https:\/\/api\.example\.test/);
  assert.match(csp, /connect-src[^;]*http:\/\/192\.0\.2\.15:3000/);
  assert.doesNotMatch(csp, /connect-src[^;]*\*/);
});
