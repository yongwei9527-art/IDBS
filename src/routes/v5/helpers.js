const express = require('express');
const { z } = require('zod');
const { validate } = require('../../lib/validate');
const { wrapV5 } = require('../../lib/v5-http');
const { requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt } = require('../../lib/auth');
const { AppError } = require('../../lib/app-error');

function unwrap(result) {
  if (!result) return null;
  if (result && result.ok === false) {
    const r = result;
    const err = new AppError(r.message || '请求处理失败。', { status: r.status || 400, code: r.code || 2001, data: r.data || null });
    throw err;
  }
  if (result && typeof result === 'object' && 'data' in result) return result.data;
  return result;
}

function serviceAuth(req) {
  return req.auth || '';
}

module.exports = { unwrap, serviceAuth, express, z, validate, wrapV5, requireAuth, optionalAuth, requirePerm, requireRole, verifyJwt, AppError };
