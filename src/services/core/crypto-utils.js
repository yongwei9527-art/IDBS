function createCryptoUtils({ crypto, tokenSecret }) {
  const SCRYPT_KEY_LENGTH = 64;
  const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

  function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  function hashPassword(password, salt) {
    return crypto.scryptSync(String(password), String(salt), SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS).toString('hex');
  }

  function legacyPasswordHash(password, salt) {
    return sha256(`${salt}:${password}`);
  }

  function safeEqualText(left, right) {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }

  function needsPasswordRehash(storedHash) {
    return !/^[a-f0-9]{128}$/i.test(String(storedHash || ''));
  }

  function verifyPassword(password, salt, storedHash) {
    const expected = needsPasswordRehash(storedHash)
      ? legacyPasswordHash(password, salt)
      : hashPassword(password, salt);
    return safeEqualText(expected, storedHash);
  }

  function base64url(value) {
    return Buffer.from(value).toString('base64url');
  }

  function sign(value) {
    return crypto.createHmac('sha256', tokenSecret).update(value).digest('base64url');
  }

  function makeToken(payload, days = 7) {
    const full = { ...payload, exp: Date.now() + days * 86400_000 };
    const body = base64url(JSON.stringify(full));
    return `${body}.${sign(body)}`;
  }

  function verifyToken(token) {
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    if (!safeEqualText(sign(body), sig)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!payload.exp || payload.exp < Date.now()) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  return {
    hashPassword,
    makeToken,
    needsPasswordRehash,
    sha256,
    verifyPassword,
    verifySecret: safeEqualText,
    verifyToken
  };
}

module.exports = { createCryptoUtils };
