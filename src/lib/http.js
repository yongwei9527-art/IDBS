const { AppError } = require('./app-error');

function success(data = null, message = 'success') {
  return {
    ok: true,
    code: 0,
    message,
    data
  };
}

function failure(message, { status = 400, code = 2001, data = null } = {}) {
  return {
    ok: false,
    code,
    message,
    data,
    status
  };
}

function fromLegacyResult(result) {
  if (result && result.ok) {
    const { ok, status, message = 'success', ...rest } = result;
    return { status: status || 200, body: success(rest, message) };
  }

  const failed = result || {};
  return {
    status: failed.status || 400,
    body: failure(failed.message || 'request failed', {
      status: failed.status || 400,
      code: failed.code || mapStatusToCode(failed.status || 400),
      data: failed.data || null
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

function sendLegacy(res, result) {
  res.status(result.ok ? 200 : (result.status || 400)).json(result);
}

function sendRest(res, result) {
  const normalized = fromLegacyResult(result);
  res.status(normalized.status).json(normalized.body);
}

function sendError(res, error) {
  if (error && error.type === 'entity.parse.failed') {
    return res.status(400).json(failure('Invalid JSON body', {
      status: 400,
      code: 2001
    }));
  }

  if (error && error.name === 'MulterError') {
    return res.status(400).json(failure(error.message || 'Upload failed', {
      status: 400,
      code: 2001
    }));
  }

  if (error instanceof AppError) {
    return res.status(error.status).json(failure(error.message, {
      status: error.status,
      code: error.code,
      data: error.data
    }));
  }

  return res.status(500).json(failure(error.message || String(error), {
    status: 500,
    code: 5000
  }));
}

module.exports = {
  failure,
  mapStatusToCode,
  sendError,
  sendLegacy,
  sendRest,
  success
};
