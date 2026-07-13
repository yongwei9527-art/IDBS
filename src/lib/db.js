const { Pool } = require('pg');
const crypto = require('crypto');
const { postgresSslOptions } = require('./postgres-ssl');

let pool;

function createPool(options = {}) {
  if (pool) return pool;

  const connectionString = options.connectionString || process.env.DATABASE_URL || '';
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }

  pool = new Pool({
    connectionString,
    ssl: options.ssl && typeof options.ssl === 'object' ? options.ssl : (options.ssl ? postgresSslOptions() : undefined),
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
    pool: activePool,
    async query(text, params = []) {
      return activePool.query(text, params);
    },
    async transaction(work) {
      const client = await activePool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('PostgreSQL rollback error:', rollbackError);
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async healthStatus() {
      const startedAt = process.hrtime.bigint();
      const result = await activePool.query(`
        select (
          to_regclass('public.users') is not null
          and to_regclass('public.refresh_token_sessions') is not null
          and to_regclass('public.rate_limit_buckets') is not null
          and to_regclass('public.scheduled_job_runs') is not null
        ) as ok
      `);
      return {
        ready: !!result.rows?.[0]?.ok,
        latency_ms: Math.max(0, Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000)),
        checked_at: new Date().toISOString()
      };
    },
    async healthCheck() {
      return (await this.healthStatus()).ready;
    },
    async claimScheduledJob({ key, name, scheduledFor }) {
      const result = await activePool.query(`
        insert into scheduled_job_runs (job_key, job_name, scheduled_for, status, instance_id, started_at)
        values ($1,$2,$3,'running',$4,now())
        on conflict (job_key) do update set
          status = 'running',
          instance_id = excluded.instance_id,
          error_message = null,
          started_at = now(),
          finished_at = null
        where (scheduled_job_runs.status = 'failed' and scheduled_job_runs.finished_at <= now() - interval '30 seconds')
           or (scheduled_job_runs.status = 'running' and scheduled_job_runs.started_at <= now() - interval '5 minutes')
        returning job_key
      `, [key, name, scheduledFor, `${process.pid}-${process.env.HOSTNAME || 'local'}`]);
      return result.rowCount > 0;
    },
    async completeScheduledJob(key, status, errorMessage = '') {
      await activePool.query(`
        update scheduled_job_runs
        set status = $2, error_message = nullif($3, ''), finished_at = now()
        where job_key = $1
      `, [key, status, String(errorMessage || '').slice(0, 2000)]);
    },
    async consumeRateLimit(key, windowMs) {
      const now = Date.now();
      const bucketStart = new Date(Math.floor(now / windowMs) * windowMs);
      const expiresAt = new Date(bucketStart.getTime() + windowMs);
      const result = await activePool.query(`
        insert into rate_limit_buckets (bucket_key, window_start, count, expires_at)
        values ($1,$2,1,$3)
        on conflict (bucket_key, window_start)
        do update set count = rate_limit_buckets.count + 1
        returning count, expires_at
      `, [String(key).slice(0, 200), bucketStart.toISOString(), expiresAt.toISOString()]);
      if (Math.random() < 0.01) {
        activePool.query('delete from rate_limit_buckets where expires_at < now() - interval \'1 hour\'').catch(() => {});
      }
      return { count: Number(result.rows?.[0]?.count || 1), expiresAt: result.rows?.[0]?.expires_at || expiresAt };
    },
    async createRealtimeBus(onMessage) {
      const source = crypto.randomUUID();
      const client = await activePool.connect();
      const handler = (event) => {
        if (event.channel !== 'idbs_realtime' || !event.payload) return;
        try {
          const envelope = JSON.parse(event.payload);
          if (envelope.source !== source) onMessage(envelope.message);
        } catch (_) {}
      };
      client.on('notification', handler);
      await client.query('listen idbs_realtime');
      return {
        async publish(message) {
          let safeMessage = message;
          let serialized = JSON.stringify({ source, message: safeMessage });
          if (Buffer.byteLength(serialized, 'utf8') > 7000) {
            safeMessage = {
              type: message?.type || 'changed',
              channel: message?.channel || '',
              payload: {
                conversation_id: message?.payload?.conversation_id || '',
                server_time: message?.payload?.server_time || new Date().toISOString(),
                truncated: true
              }
            };
            serialized = JSON.stringify({ source, message: safeMessage });
          }
          await activePool.query("select pg_notify('idbs_realtime', $1)", [serialized]);
        },
        async close() {
          client.off('notification', handler);
          await client.query('unlisten idbs_realtime').catch(() => {});
          client.release();
        }
      };
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
