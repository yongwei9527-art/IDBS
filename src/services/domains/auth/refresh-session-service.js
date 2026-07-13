function createRefreshSessionService(context = {}) {
  const { query, sha256, withTransaction } = context;

  function normalizedSession(session = {}) {
    return {
      jti: String(session.jti || '').trim(),
      subject: String(session.subject || '').trim(),
      tokenHash: sha256(String(session.token || '')),
      expiresAt: new Date(Number(session.exp || 0) * 1000).toISOString(),
      userAgent: String(session.userAgent || '').slice(0, 500),
      ipAddress: String(session.ipAddress || '').slice(0, 120)
    };
  }

  async function createRefreshSession(session) {
    const value = normalizedSession(session);
    if (!value.jti || !value.subject) return false;
    await query('delete from refresh_token_sessions where expires_at <= now() or revoked_at < now() - interval \'7 days\'');
    await query(`
      insert into refresh_token_sessions (jti, subject, token_hash, expires_at, user_agent, ip_address, created_at)
      values ($1,$2,$3,$4,$5,$6,now())
    `, [value.jti, value.subject, value.tokenHash, value.expiresAt, value.userAgent, value.ipAddress]);
    return true;
  }

  async function rotateRefreshSession(current, next) {
    const currentValue = normalizedSession(current);
    const nextValue = normalizedSession(next);
    return withTransaction(async (client) => {
      const result = await client.query(`
        select jti, token_hash, expires_at, revoked_at
        from refresh_token_sessions
        where jti = $1
        for update
      `, [currentValue.jti]);
      const row = result.rows?.[0];
      if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now() || row.token_hash !== currentValue.tokenHash) return false;
      await client.query('update refresh_token_sessions set revoked_at = now(), replaced_by = $2 where jti = $1', [currentValue.jti, nextValue.jti]);
      await client.query(`
        insert into refresh_token_sessions (jti, subject, token_hash, expires_at, user_agent, ip_address, created_at)
        values ($1,$2,$3,$4,$5,$6,now())
      `, [nextValue.jti, nextValue.subject, nextValue.tokenHash, nextValue.expiresAt, nextValue.userAgent, nextValue.ipAddress]);
      return true;
    });
  }

  async function revokeRefreshSession(session) {
    const value = normalizedSession(session);
    if (!value.jti) return false;
    const rows = await query(`
      update refresh_token_sessions
      set revoked_at = coalesce(revoked_at, now())
      where jti = $1 and token_hash = $2
      returning jti
    `, [value.jti, value.tokenHash]);
    return rows.length > 0;
  }

  return { createRefreshSession, revokeRefreshSession, rotateRefreshSession };
}

module.exports = { createRefreshSessionService };
