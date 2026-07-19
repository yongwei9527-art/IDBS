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
const serviceMethods = new Set();
for (const sourcePath of sources) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const [, method, endpoint] of source.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)/g)) {
    implemented.add(`${method.toUpperCase()} /api/v5${endpoint}`);
  }
  for (const [, method] of source.matchAll(/\bservice\.([A-Za-z][A-Za-z0-9_]*)\s*\(/g)) {
    serviceMethods.add(method);
  }
}

const missing = [...implemented].filter((endpoint) => !documented.has(endpoint));
assert.equal(missing.length, 0, `Missing IDBS 5.0 API documentation:\n${missing.join('\n')}`);
const serviceSource = fs.readFileSync(path.join(root, 'src', 'services', 'create-rental-service.js'), 'utf8');
const finalReturn = serviceSource.match(/return \{ runReservationReminderLifecycle,([^}]+)\};/);
assert.ok(finalReturn, 'Unable to inspect the rental-service public method map.');
const publicMethods = new Set(['runReservationReminderLifecycle', ...finalReturn[1].split(',').map((value) => value.trim()).filter(Boolean)]);
const missingServiceMethods = [...serviceMethods].filter((method) => !publicMethods.has(method));
assert.equal(missingServiceMethods.length, 0, `V5 routes reference methods not exported by createRentalService:\n${missingServiceMethods.join('\n')}`);
assert.match(contract, /WS `?\/api\/v5\/ws`?/);
assert.match(contract, /GET `?\/health`?/);
assert.match(contract, /GET `?\/ready`?/);
console.log(`IDBS 5.0 API contract covers ${implemented.size} HTTP routes plus WebSocket and operational endpoints.`);
