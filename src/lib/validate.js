const { z } = require('zod');

/**
 * zod 校验辅助：
 * - parseBody(schema, req) → 解析并校验 req.body，失败抛 AppError(422)。
 * - parseQuery(schema, req) → 解析并校验 req.query。
 * - parseParams(schema, req) → 解析并校验 req.params。
 */
const { AppError } = require('./app-error');

function formatZodError(err) {
  const issues = err.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message
  }));
  return issues;
}

function firstZodMessage(err) {
  const msg = String(err?.issues?.[0]?.message || '').trim();
  // Prefer explicit Chinese schema messages over generic validation titles.
  if (/[\u4e00-\u9fa5]/.test(msg)) return msg;
  return '';
}

function parse(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const detail = formatZodError(result.error);
    const friendly = firstZodMessage(result.error);
    throw new AppError(friendly || `${label || '参数'}校验失败`, {
      status: 422,
      code: 2002,
      data: { issues: detail }
    });
  }
  return result.data;
}

function parseBody(schema, req) {
  return parse(schema, req.body || {}, '请求体');
}

function parseQuery(schema, req) {
  return parse(schema, req.query || {}, '查询参数');
}

function parseParams(schema, req) {
  return parse(schema, req.params || {}, '路径参数');
}

/**
 * 中间件工厂：用 schema 校验 body/query/params，挂到 req.validated。
 * 用法：router.post('/x', validate({ body: SomeSchema }), handler)
 */
function validate(schemas = {}) {
  return function (req, _res, next) {
    try {
      req.validated = {};
      if (schemas.body) req.validated.body = parseBody(schemas.body, req);
      if (schemas.query) req.validated.query = parseQuery(schemas.query, req);
      if (schemas.params) req.validated.params = parseParams(schemas.params, req);
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  z,
  validate,
  parse,
  parseBody,
  parseQuery,
  parseParams
};
