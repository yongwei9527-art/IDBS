const { Pool } = require('pg');

let pool;

function createPool(options = {}) {
  if (pool) return pool;

  const connectionString = options.connectionString || process.env.DATABASE_URL || '';
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }

  pool = new Pool({
    connectionString,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_TIMEOUT_MS || 30_000),
    connectionTimeoutMillis: Number(process.env.PGPOOL_CONN_TIMEOUT_MS || 10_000)
  });

  pool.on('error', (error) => {
    console.error('PostgreSQL pool error:', error);
  });

  return pool;
}

function createDb(options = {}) {
  const activePool = createPool(options);

  return {
    async query(text, params = []) {
      return activePool.query(text, params);
    },
    async healthCheck() {
      const result = await activePool.query('select 1 as ok');
      return !!result.rows?.[0]?.ok;
    },
    async close() {
      if (pool) {
        const current = pool;
        pool = null;
        await current.end();
      }
    }
  };
}

module.exports = { createDb };
