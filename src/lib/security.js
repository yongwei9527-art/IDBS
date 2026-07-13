function safeRateLimitKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return req.ip || forwarded || req.socket?.remoteAddress || 'unknown';
}

function safeRequestPath(req) {
  return String(req?.originalUrl || req?.url || req?.path || '').split('?')[0] || '/';
}

function createMemoryRateLimiter(options = {}) {
  const {
    windowMs = 60_000,
    max = 60,
    maxKeys = 10_000,
    cleanupIntervalMs = Math.max(30_000, windowMs),
    keyGenerator = safeRateLimitKey,
    skip = () => false,
    message = '操作过于频繁，请稍后再试。',
    code = 3001
  } = options;

  const buckets = new Map();
  let lastCleanupAt = 0;

  function cleanup(now) {
    if (now - lastCleanupAt < cleanupIntervalMs && buckets.size <= maxKeys) return;
    lastCleanupAt = now;
    for (const [key, value] of buckets.entries()) {
      if (!value || value.expiresAt <= now) buckets.delete(key);
    }
    if (buckets.size <= maxKeys) return;
    const overflow = buckets.size - maxKeys;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  return function rateLimit(req, res, next) {
    if (skip(req)) return next();

    const now = Date.now();
    cleanup(now);

    const key = String(keyGenerator(req) || 'unknown').slice(0, 200);
    const current = buckets.get(key);

    if (!current || current.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      const retryAfter = Math.ceil((current.expiresAt - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfter, 1)));
      return res.status(429).json({
        ok: false,
        code,
        message,
        data: null,
        status: 429,
        request_id: req.requestId || '',
        server_time: new Date().toISOString()
      });
    }

    return next();
  };
}

function createDistributedRateLimiter(options = {}) {
  const {
    windowMs = 60_000,
    max = 60,
    keyGenerator = safeRateLimitKey,
    skip = () => false,
    consume,
    message = '操作过于频繁，请稍后再试。',
    code = 3001
  } = options;
  if (typeof consume !== 'function') return createMemoryRateLimiter(options);

  return async function distributedRateLimit(req, res, next) {
    if (skip(req)) return next();
    try {
      const key = String(keyGenerator(req) || 'unknown').slice(0, 200);
      const bucket = await consume(key, windowMs);
      if (Number(bucket?.count || 0) <= max) return next();
      const retryAfter = Math.max(1, Math.ceil((new Date(bucket.expiresAt).getTime() - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        ok: false,
        code,
        message,
        data: null,
        status: 429,
        request_id: req.requestId || '',
        server_time: new Date().toISOString()
      });
    } catch (error) {
      return next(error);
    }
  };
}

function createRequestLogger() {
  return function requestLogger(req, res, next) {
    const startedAt = Date.now();
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const userAgent = String(req.headers['user-agent'] || '');
    const deviceType = /mobile|android|iphone|ipad/i.test(userAgent) ? 'mobile' : 'pc';
    req.requestId = requestId;
    req.deviceType = deviceType;
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const duration = Date.now() - startedAt;
      console.log(`${req.method} ${safeRequestPath(req)} ${res.statusCode} ${duration}ms ${deviceType} ${requestId}`);
    });

    next();
  };
}

module.exports = {
  createDistributedRateLimiter,
  createMemoryRateLimiter,
  createRequestLogger,
  safeRequestPath,
  safeRateLimitKey
};
