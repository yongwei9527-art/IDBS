/**
 * 5.0 API 响应辅助。
 * - 结构：{ code: 0, data, message }（成功）。
 * - 错误对齐 RFC 7807 problem+json：{ code, message, data, status, errors }，
 *   仅当 Accept 含 application/problem+json 或 ?problem=1 时按 problem+json 输出，
 *   否则返回统一的 V5 JSON 失败体。
 */
const { AppError } = require('./app-error');
const { safeRequestPath } = require('./security');

function friendlyErrorMessage(message, status) {
  const text = String(message || '').trim();
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  const lower = text.toLowerCase();
  if (/invalid json|unexpected token|json/.test(lower)) return '提交内容格式不正确，请检查后重试。';
  if (/required|missing|must be|invalid|not valid/.test(lower)) return '提交内容不完整或格式不正确，请补全后重试。';
  if (/unauthorized|jwt|token/.test(lower)) return '未登录或登录已过期。';
  if (/eperm|eacces|operation not permitted|access is denied/.test(lower)) return '文件目录没有写入权限，请检查上传目录配置。';
  if (/forbidden|not allowed|permission|denied/.test(lower)) return '没有访问权限。';
  if (/too many.*request|please slow/.test(lower)) return '操作过于频繁，请稍后再试。';
  if (/duplicate|conflict|already exists/.test(lower)) return '当前数据已存在或状态冲突，请检查后重试。';
  if (/internal server error|cannot read|undefined|null|database|sql|postgres|typeerror|referenceerror/.test(lower)) return '服务器暂时无法处理请求，请稍后再试。';
  if (status === 400) return hasChinese ? text : '提交内容不完整或格式不正确。';
  if (status === 401) return '未登录或登录已过期。';
  if (status === 403) return '没有访问权限。';
  if (status === 404) return '请求的资源不存在。';
  if (status === 409) return hasChinese ? text : '当前数据状态已变化，请刷新后重试。';
  if (status === 413) return '上传或提交内容过大。';
  if (status === 422) return hasChinese ? text : '提交内容未通过校验，请检查后重试。';
  if (status === 429) return '操作过于频繁，请稍后再试。';
  if (status >= 500) return '服务器暂时无法处理请求，请稍后再试。';
  return hasChinese ? text : '请求处理失败。';
}

function publicErrorMessage(error, status) {
  return friendlyErrorMessage(error?.message || String(error || ''), status);
}

function mapStatusToCode(status) {
  if (status === 401) return 1001;
  if (status === 403) return 1003;
  if (status === 404) return 3004;
  if (status === 422) return 2002;
  if (status >= 500) return 5000;
  if (status === 409) return 3001;
  return 2001;
}

function sendOk(res, data, message = 'success') {
  return res.status(200).json({ code: 0, data, message });
}

function wantsProblem(req) {
  const accept = String(req?.headers?.accept || '');
  if (accept.includes('application/problem+json')) return true;
  return String(req?.query?.problem || '') === '1';
}

function sendFail(res, error, req) {
  const status = error?.status || 500;
  const code = error?.code || mapStatusToCode(status);
  const message = publicErrorMessage(error, status);
  const data = error?.data || null;

  if (wantsProblem(req)) {
    return res
      .type('application/problem+json')
      .status(status)
      .json({
        type: 'about:blank',
        title: message,
        status,
        code,
        detail: data,
        instance: safeRequestPath(req)
      });
  }

  return res.status(status).json({
    ok: false,
    code,
    status,
    message,
    data
  });
}

/**
 * 包装一个 5.0 路由处理函数：捕获异常自动 sendFail。
 */
function wrapV5(handler) {
  return async function (req, res, next) {
    try {
      const result = await handler(req, res);
      if (result === undefined || result === null) return;
      if (typeof res.json === 'function' && !res.headersSent) {
        return sendOk(res, result);
      }
    } catch (error) {
      if (error instanceof AppError || error?.status) return sendFail(res, error, req);
      return sendFail(res, new AppError(error.message || '服务器暂时无法处理请求，请稍后再试。', { status: 500 }), req);
    }
  };
}

module.exports = {
  sendOk,
  sendFail,
  wrapV5,
  mapStatusToCode
};



