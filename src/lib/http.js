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
    body: failure(failed.message || 'request failed', {
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

function publicErrorMessage(error, status) {
  if (!isProduction() || status < 500) return error.message || String(error);
  return 'Internal server error';
}

function errorData(data, requestId) {
  return requestId ? { ...(data || {}), request_id: requestId } : data;
}

function sendError(res, error) {
  const requestId = res.getHeader ? res.getHeader('X-Request-Id') : '';
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json(failure('Invalid JSON body', {
      status: 400,
      code: 2001,
      data: errorData(null, requestId),
      requestId
    }));
  }

  if (error && error.name === 'MulterError') {
    return res.status(400).json(failure(error.message || 'Upload failed', {
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
