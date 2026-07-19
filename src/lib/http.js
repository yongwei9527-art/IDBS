const { AppError } = require('./app-error');

function responseMeta(requestId = '') {
  return {
    request_id: requestId || '',
    server_time: new Date().toISOString()
  };
}

function success(data = null, message = 'success', requestId = '') {
  return {
    ok: true,
    code: 0,
    message,
    data,
    ...responseMeta(requestId)
  };
}

function failure(message, { status = 400, code = 2001, data = null, requestId = '' } = {}) {
  return {
    ok: false,
    code,
    message,
    data,
    status,
    ...responseMeta(requestId)
  };
}

function fromLegacyResult(result, requestId = '') {
  if (result && result.ok) {
    const { ok, status, message = 'success', ...rest } = result;
    return { status: status || 200, body: success(rest, message, requestId) };
  }

  const failed = result || {};
  return {
    status: failed.status || 400,
    body: failure(friendlyServerMessage(failed.message || '请求处理失败。', failed.status || 400), {
      status: failed.status || 400,
      code: failed.code || mapStatusToCode(failed.status || 400),
      data: failed.data || null,
      requestId
    })
  };
}

function mapStatusToCode(status) {
  if (status === 401) return 1001;
  if (status === 403) return 1003;
  if (status === 404) return 3004;
  if (status >= 500) return 5000;
  if (status === 409) return 3001;
  return 2001;
}

function sendRest(res, result) {
  const requestId = res.getHeader ? res.getHeader('X-Request-Id') : '';
  const normalized = fromLegacyResult(result, requestId);
  res.status(normalized.status).json(normalized.body);
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function friendlyServerMessage(message, status) {
  const text = String(message || '').trim();
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  const lower = text.toLowerCase();
  if (/invalid json|unexpected token|json/.test(lower)) return '提交内容格式不正确，请检查后重试。';
  if (/file is required|missing file/.test(lower)) return '请选择需要上传的文件。';
  if (/file too large|limit_file_size|upload failed|unexpected field/.test(lower)) return '上传文件不符合要求，请检查大小和文件字段后重试。';
  if (/only image|allowed image|content does not match|unsupported file/.test(lower)) return '仅支持上传真实图片文件。';
  if (/required|missing|must be|invalid|not valid/.test(lower)) return '提交内容不完整或格式不正确，请补全后重试。';
  if (/unauthorized|jwt|token/.test(lower)) return '未登录或登录已过期。';
  if (/eperm|eacces|operation not permitted|access is denied/.test(lower)) return '文件目录没有写入权限，请检查上传目录配置。';
  if (/forbidden|not allowed|permission|denied/.test(lower)) return '没有访问权限。';
  if (/duplicate|conflict|already exists/.test(lower)) return '当前数据已存在或状态冲突，请检查后重试。';
  if (/internal server error|cannot read|undefined|null|database|sql|postgres|typeerror|referenceerror/.test(lower)) return '服务器暂时无法处理请求，请稍后再试。';
  if (status === 400) return hasChinese ? text : '提交内容不完整或格式不正确。';
  if (status === 401) return hasChinese ? text : '未登录或登录已过期。';
  if (status === 403) return hasChinese ? text : '没有访问权限。';
  if (status === 404) return '请求的资源不存在。';
  if (status === 409) return hasChinese ? text : '当前数据状态已变化，请刷新后重试。';
  if (status === 413) return '上传或提交内容过大。';
  if (status === 422) return hasChinese ? text : '提交内容未通过校验，请检查后重试。';
  if (status === 429) return '操作过于频繁，请稍后再试。';
  if (status >= 500) return '服务器暂时无法处理请求，请稍后再试。';
  return hasChinese ? text : '请求处理失败。';
}

function publicErrorMessage(error, status) {
  return friendlyServerMessage(error?.message || String(error || ''), status);
}

function errorData(data, requestId) {
  return requestId ? { ...(data || {}), request_id: requestId } : data;
}

function sendError(res, error) {
  const requestId = res.getHeader ? res.getHeader('X-Request-Id') : '';
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json(failure('提交内容格式不正确，请检查后重试。', {
      status: 400,
      code: 2001,
      data: errorData(null, requestId),
      requestId
    }));
  }

  if (error && error.name === 'MulterError') {
    return res.status(400).json(failure(friendlyServerMessage(error.message || 'Upload failed', 400), {
      status: 400,
      code: 2001,
      data: errorData(null, requestId),
      requestId
    }));
  }

  if (error instanceof AppError) {
    return res.status(error.status).json(failure(publicErrorMessage(error, error.status), {
      status: error.status,
      code: error.code,
      data: errorData(error.data, requestId),
      requestId
    }));
  }

  return res.status(500).json(failure(publicErrorMessage(error || new Error('Internal server error'), 500), {
    status: 500,
    code: 5000,
    data: errorData(null, requestId),
    requestId
  }));
}

module.exports = {
  failure,
  mapStatusToCode,
  sendError,
  sendRest,
  success
};


