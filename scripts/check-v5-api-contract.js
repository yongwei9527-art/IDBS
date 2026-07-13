const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const contractPath = path.join(root, 'docs', 'v5-api-contract.md');
const sources = [
  path.join(root, 'src', 'routes', 'v5', 'auth.js'),
  path.join(root, 'src', 'routes', 'v5', 'index.js')
];
const contract = fs.readFileSync(contractPath, 'utf8');
const documented = new Set(
  [...contract.matchAll(/`(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/v5\/[^`\s]+)`/g)]
    .map(([, method, endpoint]) => `${method} ${endpoint}`)
);

const implemented = new Set();
for (const sourcePath of sources) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const [, method, endpoint] of source.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)/g)) {
    implemented.add(`${method.toUpperCase()} /api/v5${endpoint}`);
  }
}

const missing = [...implemented].filter((endpoint) => !documented.has(endpoint));
assert.equal(missing.length, 0, `Missing IDBS 5.0 API documentation:\n${missing.join('\n')}`);
assert.match(contract, /WS `?\/api\/v5\/ws`?/);
assert.match(contract, /GET `?\/health`?/);
assert.match(contract, /GET `?\/ready`?/);
console.log(`IDBS 5.0 API contract covers ${implemented.size} HTTP routes plus WebSocket and operational endpoints.`);
