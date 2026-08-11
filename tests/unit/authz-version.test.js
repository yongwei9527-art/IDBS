const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { AppError } = require('../../src/lib/app-error');
const { issueJwt, requireRole, verifyJwt } = require('../../src/lib/auth');
const { createV5AuthRouter } = require('../../src/routes/v5/auth');
const { createAuthPrincipalService } = require('../../src/services/domains/auth/auth-principal-service');

const ROOT = path.resolve(__dirname, '..', '..');
const SUPER_ID = '00000000-0000-4000-8000-000000000001';

function permissionsFor(role = {}) {
  const permissions = Array.isArray(role.permissions) ? role.permissions : [];
  return role.role_key === 'super_admin' || permissions.includes('*') ? ['*'] : [...permissions];
}

test('database principal rejects stale tokens and supports historical highest-admin rows', async () => {
  let row = {
    id: SUPER_ID,
    name: 'Script super administrator',
    role: 'super_admin',
    status: 'active',
    is_banned: false,
    deleted_at: null,
    authz_version: '7',
    admin_role_key: null,
    admin_permissions: null
  };
  const principals = createAuthPrincipalService({
    effectiveRolePermissions: permissionsFor,
    queryOne: async () => (row?.deleted_at ? null : row)
  });

  const current = await principals.validateAccessTokenAuth({ sub: SUPER_ID, authz_version: 7 });
  assert.equal(current.role, 'super_admin');
  assert.equal(current.scope, 'admin');
  assert.deepEqual(current.permissions, ['*']);

  await assert.rejects(
    principals.validateAccessTokenAuth({ sub: SUPER_ID, role: 'super_admin', perms: ['*'], authz_version: 6 }),
    (error) => error.status === 401
  );

  row = {
    ...row,
    role: 'admin',
    authz_version: 8,
    admin_role_key: 'super_admin',
    admin_permissions: ['*']
  };
  const historical = await principals.validateAccessTokenAuth({ sub: SUPER_ID, authz_version: 8 });
  assert.equal(historical.role, 'super_admin');
  assert.deepEqual(historical.permissions, ['*']);

  row = { ...row, status: 'disabled', authz_version: 9 };
  await assert.rejects(
    principals.validateAccessTokenAuth({ sub: SUPER_ID, authz_version: 9 }),
    (error) => error.status === 401
  );

  row = { ...row, status: 'active', is_banned: true, authz_version: 10 };
  await assert.rejects(
    principals.validateAccessTokenAuth({ sub: SUPER_ID, authz_version: 10 }),
    (error) => error.status === 401
  );

  row = { ...row, is_banned: false, deleted_at: new Date().toISOString(), authz_version: 11 };
  await assert.rejects(
    principals.validateAccessTokenAuth({ sub: SUPER_ID, authz_version: 11 }),
    (error) => error.status === 401
  );
});

async function startAuthServer() {
  const state = {
    user: {
      id: SUPER_ID,
      name: 'Script super administrator',
      phone: '13900000000',
      role: 'super_admin',
      admin_role_key: 'super_admin',
      permissions: ['*'],
      password_reset_required: false,
      authz_version: 4
    }
  };
  const refreshSessions = new Map();

  function principal() {
    const user = state.user;
    if (!user || user.status === 'disabled' || user.is_banned || user.deleted_at) {
      throw new AppError('Unauthorized', { status: 401, code: 1001 });
    }
    return {
      sub: user.id,
      user_id: user.id,
      id: user.id,
      scope: user.role === 'user' ? 'user' : 'admin',
      role: user.role,
      admin_role_key: user.admin_role_key,
      perms: [...user.permissions],
      permissions: [...user.permissions],
      password_reset_required: Boolean(user.password_reset_required),
      authz_version: user.authz_version,
      name: user.name
    };
  }

  const service = {
    async loginUser(input) {
      if (input.phone !== '13900000000' || input.password !== '123456') {
        return { ok: false, status: 401, code: 1001, message: 'Wrong credentials' };
      }
      return { ok: true, token: 'legacy-bridge', role: 'super_admin', permissions: ['*'], user: { ...state.user } };
    },
    async resolveCurrentAuthPrincipal(identity) {
      if (identity.sub !== state.user?.id) throw new AppError('Unauthorized', { status: 401, code: 1001 });
      return principal();
    },
    async validateAccessTokenAuth(auth) {
      const current = principal();
      if (auth.sub !== current.sub || Number(auth.authz_version) !== current.authz_version) {
        throw new AppError('Unauthorized', { status: 401, code: 1001 });
      }
      return current;
    },
    async getProfile() {
      return { ok: true, user: { ...state.user } };
    }
  };
  const sessions = {
    async createRefreshSession(session) {
      refreshSessions.set(session.jti, { ...session, revoked: false });
      return true;
    },
    async rotateRefreshSession(current, next) {
      const stored = refreshSessions.get(current.jti);
      if (!stored || stored.revoked || stored.subject !== current.subject) return false;
      stored.revoked = true;
      refreshSessions.set(next.jti, { ...next, revoked: false });
      return true;
    },
    async revokeRefreshSession(session) {
      const stored = refreshSessions.get(session.jti);
      if (!stored) return false;
      stored.revoked = true;
      return true;
    }
  };

  const app = express();
  app.use(express.json());
  app.use('/api/v5', createV5AuthRouter(service, { refreshSessions: sessions }));
  app.get('/api/v5/direct-super-only', requireRole('super_admin'), (_req, res) => res.json({ ok: true }));
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return { base: `http://127.0.0.1:${server.address().port}/api/v5`, server, state };
}

test('real login, /me and refresh use current database authority for script accounts', async () => {
  const previousSecret = process.env.TOKEN_SECRET;
  process.env.TOKEN_SECRET = 'authz-version-route-test-secret-at-least-32-characters';
  const fixture = await startAuthServer();
  try {
    const login = await fetch(`${fixture.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13900000000', password: '123456' })
    });
    const loginBody = await login.json();
    assert.equal(login.status, 200);
    assert.ok(loginBody.data.access_token);
    assert.equal(loginBody.data.role, 'super_admin');
    assert.deepEqual(loginBody.data.permissions, ['*']);
    const claims = verifyJwt(loginBody.data.access_token, { type: 'access' });
    assert.equal(claims.authz_version, 4);
    assert.equal(claims.role, 'super_admin');
    const refreshCookie = login.headers.get('set-cookie').split(';', 1)[0];

    const me = await fetch(`${fixture.base}/me`, {
      headers: { Authorization: `Bearer ${loginBody.data.access_token}` }
    });
    const meBody = await me.json();
    assert.equal(me.status, 200);
    assert.equal(meBody.data.role, 'super_admin');
    assert.deepEqual(meBody.data.permissions, ['*']);

    // A signed JWT's role/perms are not an authority source. /me reports the
    // current database principal instead of the forged claims.
    fixture.state.user = {
      ...fixture.state.user,
      role: 'user',
      admin_role_key: undefined,
      permissions: [],
      authz_version: 5
    };
    const forgedClaims = issueJwt({
      sub: SUPER_ID,
      role: 'super_admin',
      scope: 'admin',
      perms: ['*'],
      authz_version: 5
    });
    const currentMe = await fetch(`${fixture.base}/me`, {
      headers: { Authorization: `Bearer ${forgedClaims}` }
    });
    const currentMeBody = await currentMe.json();
    assert.equal(currentMe.status, 200);
    assert.equal(currentMeBody.data.role, 'user');
    assert.deepEqual(currentMeBody.data.permissions, []);

    const directSuperOnly = await fetch(`${fixture.base}/direct-super-only`, {
      headers: { Authorization: `Bearer ${forgedClaims}` }
    });
    assert.equal(directSuperOnly.status, 403);

    const staleAccess = await fetch(`${fixture.base}/me`, {
      headers: { Authorization: `Bearer ${loginBody.data.access_token}` }
    });
    assert.equal(staleAccess.status, 401);

    const staleRefresh = await fetch(`${fixture.base}/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: refreshCookie }
    });
    assert.equal(staleRefresh.status, 401);
    assert.match(staleRefresh.headers.get('set-cookie') || '', /Max-Age=0/);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
    if (previousSecret === undefined) delete process.env.TOKEN_SECRET;
    else process.env.TOKEN_SECRET = previousSecret;
  }
});

test('canonical schema and forward migration install authz version invalidation', () => {
  const schema = fs.readFileSync(path.join(ROOT, 'sql/schema.sql'), 'utf8');
  const migration = fs.readFileSync(
    path.join(ROOT, 'sql/migrations/2026-08-10_authz_version_token_revocation.sql'),
    'utf8'
  );
  for (const sql of [schema, migration]) {
    assert.match(sql, /authz_version BIGINT/i);
    assert.match(sql, /users_authz_version_bump_trigger/);
    assert.match(sql, /users_authz_refresh_revoke_trigger/);
    assert.match(sql, /admin_roles_authz_version_trigger/);
    assert.match(sql, /password_hash IS DISTINCT FROM NEW\.password_hash/);
    assert.match(sql, /OLD\.deleted_at IS DISTINCT FROM NEW\.deleted_at/);
    assert.match(sql, /UPDATE refresh_token_sessions/i);
  }
});
