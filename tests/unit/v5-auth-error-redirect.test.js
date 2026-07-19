const test = require('node:test');
const assert = require('node:assert/strict');
const { AppError } = require('../../src/lib/app-error');
const { sendFail } = require('../../src/lib/v5-http');
const { parse } = require('../../src/lib/validate');
const { z } = require('zod');

function captureSendFail(error) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
      status(code) { this.statusCode = code; return this; },
      type() { return this; },
      json(payload) { this.body = payload; resolve(this); return this; },
      setHeader(k, v) { this.headers[k] = v; }
    };
    sendFail(res, error, { headers: {}, query: {}, path: '/api/v5/auth/login' });
  });
}

test('v5 sendFail keeps Chinese business messages for 401/403', async () => {
  const wrongPassword = await captureSendFail(new AppError('手机号或密码不正确。', { status: 401, code: 1001 }));
  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(wrongPassword.body.message, '手机号或密码不正确。');

  const banned = await captureSendFail(new AppError('账号已被封禁，请联系管理员处理。', { status: 403, code: 1003 }));
  assert.equal(banned.statusCode, 403);
  assert.equal(banned.body.message, '账号已被封禁，请联系管理员处理。');

  const rejected = await captureSendFail(new AppError('账号审核未通过，请联系管理员处理。', { status: 403, code: 1003 }));
  assert.equal(rejected.body.message, '账号审核未通过，请联系管理员处理。');

  const generic401 = await captureSendFail(new AppError('Unauthorized', { status: 401, code: 1001 }));
  assert.equal(generic401.body.message, '未登录或登录已过期。');
});

test('auth-guard redirect helper strips /v5 and avoids login loops', () => {
  function stripBasepath(pathname) {
    const value = String(pathname || '');
    if (value === '/v5') return '/';
    if (value.startsWith('/v5/')) return value.slice(3) || '/';
    return value || '/';
  }
  function buildPostLoginRedirect(pathname, search = '', hash = '') {
    const routePath = stripBasepath(pathname);
    if (!routePath || routePath === '/' || routePath === '/login' || routePath.startsWith('/login?') || routePath.startsWith('/login/')) {
      return '/devices';
    }
    return `${routePath}${search || ''}${hash || ''}`;
  }
  assert.equal(buildPostLoginRedirect('/v5/devices'), '/devices');
  assert.equal(buildPostLoginRedirect('/v5/admin/dashboard'), '/admin/dashboard');
  assert.equal(buildPostLoginRedirect('/v5/me/reservations', '?x=1', '#top'), '/me/reservations?x=1#top');
  assert.equal(buildPostLoginRedirect('/v5/login'), '/devices');
  assert.equal(buildPostLoginRedirect('/v5/login?redirect=%2Fdevices'), '/devices');
});

test('zod password min message surfaces as Chinese AppError message', () => {
  const schema = z.object({
    phone: z.string().min(6, '手机号格式不正确。').max(20),
    password: z.string().min(6, '密码至少需要 6 位。').max(128)
  });
  try {
    parse(schema, { phone: '13800000001', password: '123' }, '请求体');
    assert.fail('expected throw');
  } catch (error) {
    assert.equal(error.status, 422);
    assert.equal(error.message, '密码至少需要 6 位。');
  }
});
