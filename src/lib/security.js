function createMemoryRateLimiter(options = {}) {
  const {
    windowMs = 60_000,
    max = 60,
    keyGenerator = (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',
    message = 'Too many requests, please try again later.',
    code = 3001
  } = options;

  const bucket = new Map();

  return function rateLimit(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();
    const current = bucket.get(key);

    if (!current || current.expiresAt <= now) {
      bucket.set(key, { count: 1, expiresAt: now + windowMs });
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
        status: 429
      });
    }

    return next();
  };
}

function createRequestLogger() {
  return function requestLogger(req, res, next) {
    const startedAt = Date.now();
    const requestId = `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const userAgent = String(req.headers['user-agent'] || '');
    const deviceType = /mobile|android|iphone|ipad/i.test(userAgent) ? 'mobile' : 'pc';
    req.requestId = requestId;
    req.deviceType = deviceType;
    res.setHeader('X-Request-Id', requestId);

    res.on('finish', () => {
      const duration = Date.now() - startedAt;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms ${deviceType} ${requestId}`);
    });

    next();
  };
}

module.exports = {
  createMemoryRateLimiter,
  createRequestLogger
};
