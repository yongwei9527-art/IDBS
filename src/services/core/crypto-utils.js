function createCryptoUtils({ crypto, tokenSecret }) {
  function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  function hashPassword(password, salt) {
    return sha256(`${salt}:${password}`);
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
    if (sign(body) !== sig) return null;
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
    sha256,
    verifyToken
  };
}

module.exports = { createCryptoUtils };
