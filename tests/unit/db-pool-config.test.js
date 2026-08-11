const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('PostgreSQL statement timeout is configured without a racing connect query', () => {
  const dbModule = path.resolve(__dirname, '../../src/lib/db.js');
  const child = `
    const assert = require('node:assert/strict');
    const { EventEmitter } = require('node:events');
    const Module = require('node:module');
    const originalLoad = Module._load;
    let poolInstance;

    class FakePool extends EventEmitter {
      constructor(options) {
        super();
        this.options = options;
        poolInstance = this;
      }
      async end() {}
    }

    Module._load = function(request, parent, isMain) {
      if (request === 'pg') return { Pool: FakePool };
      return originalLoad.call(this, request, parent, isMain);
    };

    process.env.PG_STATEMENT_TIMEOUT_MS = '3210';
    const { createDb } = require(${JSON.stringify(dbModule)});
    const db = createDb({ connectionString: 'postgresql://example.invalid/test' });

    assert.equal(poolInstance.options.statement_timeout, 3210);
    assert.equal(poolInstance.options.query_timeout, 3210);
    assert.equal(poolInstance.listenerCount('connect'), 0);
    assert.equal(poolInstance.listenerCount('error'), 1);

    db.close().then(() => process.exit(0), (error) => {
      console.error(error);
      process.exit(1);
    });
  `;

  const result = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});