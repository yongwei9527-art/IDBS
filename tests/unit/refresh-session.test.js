const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createRefreshSessionService } = require('../../src/services/domains/auth/refresh-session-service');

test('refresh sessions rotate once and can be revoked', async () => {
  const sessions = new Map();
  async function execute(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.startsWith('delete from refresh_token_sessions')) return { rows: [] };
    if (normalized.startsWith('insert into refresh_token_sessions')) {
      sessions.set(params[0], {
        jti: params[0], subject: params[1], token_hash: params[2], expires_at: params[3],
        user_agent: params[4], ip_address: params[5], revoked_at: null, replaced_by: null
      });
      return { rows: [] };
    }
    if (normalized.startsWith('select jti')) return { rows: sessions.has(params[0]) ? [sessions.get(params[0])] : [] };
    if (normalized.startsWith('update refresh_token_sessions set revoked_at = now(), replaced_by')) {
      const row = sessions.get(params[0]);
      row.revoked_at = new Date().toISOString();
      row.replaced_by = params[1];
      return { rows: [] };
    }
    if (normalized.startsWith('update refresh_token_sessions set revoked_at = coalesce')) {
      const row = sessions.get(params[0]);
      if (!row || row.token_hash !== params[1]) return { rows: [] };
      row.revoked_at ||= new Date().toISOString();
      return { rows: [{ jti: row.jti }] };
    }
    throw new Error(`Unexpected SQL in test: ${normalized}`);
  }

  const service = createRefreshSessionService({
    query: async (sql, params) => (await execute(sql, params)).rows,
    sha256: (value) => crypto.createHash('sha256').update(value).digest('hex'),
    withTransaction: async (work) => work({ query: execute })
  });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const first = { jti: '00000000-0000-4000-8000-000000000001', subject: 'user-1', token: 'refresh-1', exp };
  const second = { jti: '00000000-0000-4000-8000-000000000002', subject: 'user-1', token: 'refresh-2', exp };

  assert.equal(await service.createRefreshSession(first), true);
  assert.equal(await service.rotateRefreshSession(first, second), true);
  assert.equal(await service.rotateRefreshSession(first, { ...second, jti: '00000000-0000-4000-8000-000000000003' }), false);
  assert.equal(await service.revokeRefreshSession(second), true);
});
