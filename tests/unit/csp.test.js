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