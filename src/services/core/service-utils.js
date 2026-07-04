function ok(data = {}) {
  return { ok: true, ...data };
}

function fail(message, status = 400, code) {
  return { ok: false, status, code, message };
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function nowIso() {
  return new Date().toISOString();
}

function safeFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isSafeUrl(url) {
  const text = String(url || '').trim();
  return /^https?:\/\//i.test(text) || text.startsWith('/uploads/');
}

module.exports = {
  fail,
  isSafeUrl,
  nowIso,
  ok,
  parseBoolean,
  safeFilename
};
