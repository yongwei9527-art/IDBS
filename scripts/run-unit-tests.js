const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const unitDir = path.resolve(__dirname, '..', 'tests', 'unit');
const files = fs.readdirSync(unitDir)
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => path.join(unitDir, file));

if (!files.length) throw new Error('No unit test files found.');
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
