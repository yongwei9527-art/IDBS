function postgresSslOptions(env = process.env) {
  const enabled = ['1', 'true', 'yes', 'on'].includes(String(env.PGSSL || '').toLowerCase());
  if (!enabled) return undefined;
  const rejectUnauthorized = !['0', 'false', 'no', 'off'].includes(String(env.PGSSL_REJECT_UNAUTHORIZED || 'true').toLowerCase());
  const ca = String(env.PGSSL_CA || '').replace(/\\n/g, '\n').trim();
  return { rejectUnauthorized, ...(ca ? { ca } : {}) };
}

module.exports = { postgresSslOptions };
