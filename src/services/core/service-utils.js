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
  const text = String(name || 'file')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}._-]/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);
  return text || 'file';
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
