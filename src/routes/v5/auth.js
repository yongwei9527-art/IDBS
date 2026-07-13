const express = require('express');
const { z } = require('zod');
const { validate } = require('../../lib/validate');
const { wrapV5 } = require('../../lib/v5-http');
const { issueJwt, verifyJwt, requireAuth } = require('../../lib/auth');
const { AppError } = require('../../lib/app-error');

function createV5AuthRouter(service, { refreshSessions } = {}) {
  const router = express.Router();
  const refreshCookieName = 'idbs.refresh_token';

  function cookieValue(req, name) {
    const raw = String(req.headers.cookie || '');
    for (const pair of raw.split(';')) {
      const index = pair.indexOf('=');
      if (index < 0 || pair.slice(0, index).trim() !== name) continue;
      try { return decodeURIComponent(pair.slice(index + 1).trim()); } catch (_) { return ''; }
    }
    return '';
  }

  function refreshContext(req) {
    return {
      userAgent: req.headers['user-agent'] || '',
      ipAddress: req.ip || req.socket?.remoteAddress || ''
    };
  }

  function setRefreshCookie(req, res, token, maxAgeSeconds) {
    // req.secure already honors X-Forwarded-Proto only when TRUST_PROXY is enabled;
    // do not trust a client-supplied forwarding header on direct connections.
    const secure = Boolean(req.secure);
    const parts = [
      `${refreshCookieName}=${encodeURIComponent(token)}`,
      'HttpOnly',
      'SameSite=Strict',
      'Path=/api/v5/auth',
      `Max-Age=${Math.max(0, Number(maxAgeSeconds) || 0)}`
    ];
    if (secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
    res.setHeader('Cache-Control', 'no-store');
  }



  const phoneSchema = z.object({
    phone: z.string().min(6).max(20),
    password: z.string().min(6).max(128)
  });

  /**
   * 把 2.x 登录返回的 user/role/permissions 转成 v5 JWT payload + 双 token。
   */
  async function toAuthBundle(userRole, perms, user, req, res) {
    const accessPayload = {
      sub: user?.id || 'admin',
      scope: userRole === 'super_admin' ? 'admin' : (userRole === 'admin' ? 'admin' : 'user'),
      role: userRole,
      perms: perms || [],
      name: user?.name || 'admin'
    };
    const access = issueJwt(accessPayload, { type: 'access' });
    const refresh = issueJwt({ ...accessPayload, type: 'refresh' }, { type: 'refresh' });
    const refreshPayload = verifyJwt(refresh, { type: 'refresh' });
    if (!refreshPayload || !refreshSessions) throw new AppError('刷新会话服务不可用', { status: 503, code: 5000 });
    await refreshSessions.createRefreshSession({
      ...refreshContext(req),
      jti: refreshPayload.jti,
      subject: refreshPayload.sub,
      exp: refreshPayload.exp,
      token: refresh
    });
    setRefreshCookie(req, res, refresh, Math.max(0, refreshPayload.exp - Math.floor(Date.now() / 1000)));
    return { access_token: access, token_type: 'Bearer', expires_in: 900, role: userRole, permissions: perms || [], user };
  }

  function contextFromReq(req, fallbackDeviceType = '') {
    return {
      deviceType: req.deviceType || fallbackDeviceType,
      ip: req.ip,
      host: req.headers.host,
      userAgent: req.headers['user-agent'],
      clientKey: req.headers['x-device-fingerprint'] || req.ip
    };
  }

  async function toV5LoginBundle(result, req, res) {
    const data = result?.data || result;
    if (!data) return data;
    if (!data.token && (!data.user || data.need_review)) return data;
    const perms = Array.isArray(data.permissions) ? data.permissions : [];
    const role = data.role || data.user?.role || 'user';
    return toAuthBundle(role, perms, data.user, req, res);
  }

  // 普通用户登录
  router.post('/auth/login', validate({ body: phoneSchema }), wrapV5(async (req, res) => {
    const context = contextFromReq(req);
    const result = await service.loginUser(req.validated.body, context);
    if (!result || result.ok === false) {
      throw new AppError(result?.message || '手机号或密码错误', { status: 401, code: 1001 });
    }
    return toV5LoginBundle(result, req, res);
  }));

  router.get('/auth/wechat/challenge', wrapV5(async (req) => {
    const result = await service.createLoginChallenge(req.query || {}, contextFromReq(req, 'wechat'));
    if (!result || result.ok === false) {
      throw new AppError(result?.message || '生成验证码失败', { status: result?.status || 400, code: result?.code || 2001 });
    }
    return result.data || result;
  }));

  router.get('/auth/wechat/status', validate({ query: z.object({ code: z.string().min(1).max(20) }).passthrough() }), wrapV5(async (req, res) => {
    const result = await service.getLoginChallengeStatus(req.validated.query || {}, contextFromReq(req, 'wechat'));
    if (!result || result.ok === false) {
      throw new AppError(result?.message || '验证码状态异常', { status: result?.status || 400, code: result?.code || 2001 });
    }
    return toV5LoginBundle(result, req, res);
  }));

  router.post('/auth/wechat/bind', validate({ body: z.object({
    temp_code: z.string().min(1).max(20),
    name: z.string().min(1).max(50),
    student_no: z.string().min(1).max(50),
    phone: z.string().min(6).max(20)
  }).passthrough() }), wrapV5(async (req, res) => {
    const result = await service.bindWechatAccount(req.validated.body || {}, contextFromReq(req, 'wechat'));
    if (!result || result.ok === false) {
      throw new AppError(result?.message || '微信绑定失败', { status: result?.status || 400, code: result?.code || 2001 });
    }
    return toV5LoginBundle(result, req, res);
  }));

  // 刷新令牌
  router.post('/auth/refresh', wrapV5(async (req, res) => {
    const currentToken = cookieValue(req, refreshCookieName) || String(req.body?.refresh_token || '').trim();
    const payload = verifyJwt(currentToken, { type: 'refresh' });
    if (!payload) throw new AppError('刷新登录凭证无效或已过期', { status: 401, code: 1001 });
    const accessPayload = { sub: payload.sub, scope: payload.scope, role: payload.role, perms: payload.perms || [], name: payload.name };
    const access = issueJwt(accessPayload, { type: 'access' });
    const nextRefresh = issueJwt({ ...accessPayload, type: 'refresh' }, { type: 'refresh' });
    const nextPayload = verifyJwt(nextRefresh, { type: 'refresh' });
    const rotated = nextPayload && await refreshSessions?.rotateRefreshSession(
      { ...refreshContext(req), jti: payload.jti, subject: payload.sub, exp: payload.exp, token: currentToken },
      { ...refreshContext(req), jti: nextPayload.jti, subject: nextPayload.sub, exp: nextPayload.exp, token: nextRefresh }
    );
    if (!rotated) {
      setRefreshCookie(req, res, '', 0);
      throw new AppError('刷新登录凭证已被使用或撤销，请重新登录', { status: 401, code: 1001 });
    }
    setRefreshCookie(req, res, nextRefresh, Math.max(0, nextPayload.exp - Math.floor(Date.now() / 1000)));
    return { access_token: access, token_type: 'Bearer', expires_in: 900 };
  }));

  router.post('/auth/logout', wrapV5(async (req, res) => {
    const currentToken = cookieValue(req, refreshCookieName) || String(req.body?.refresh_token || '').trim();
    const payload = verifyJwt(currentToken, { type: 'refresh' });
    if (payload) {
      await refreshSessions?.revokeRefreshSession({ ...refreshContext(req), jti: payload.jti, subject: payload.sub, exp: payload.exp, token: currentToken });
    }
    setRefreshCookie(req, res, '', 0);
    return { ok: true };
  }));

  // 当前用户资料（需 access JWT）
  router.get('/me', requireAuth, wrapV5(async (req) => {
    if (req.auth.sub === 'admin') {
      return { id: 'admin', name: 'admin', role: 'super_admin', permissions: ['*'] };
    }
    const result = await service.getProfile(req.auth);
    if (!result || result.ok === false) {
      const r = result;
      throw new AppError(r && r.message ? r.message : '未登录', { status: (r && r.status) || 401, code: (r && r.code) || 1001 });
    }
    const profile = result.data?.user || result.user || result.data || result;
    return {
      ...profile,
      role: req.auth.role || profile.role || 'user',
      permissions: Array.isArray(req.auth.perms) ? req.auth.perms : (profile.permissions || [])
    };
  }));

  return router;
}

module.exports = { createV5AuthRouter };

