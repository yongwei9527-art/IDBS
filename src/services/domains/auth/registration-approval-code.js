function createRegistrationApprovalCodeService({
  crypto,
  secret,
  windowMs = 60_000,
  generation = 0
}) {
  function slotAt(now = Date.now()) {
    return Math.floor(Number(now) / windowMs);
  }

  function codeForSlot(slot) {
    const digest = crypto
      .createHmac('sha256', secret)
      .update(`registration-approval:${generation}:${slot}`)
      .digest();
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const chars = [
      String(digest[0] % 10),
      String.fromCharCode(65 + (digest[1] % 26))
    ];
    for (let index = 2; index < 12; index += 1) {
      chars.push(alphabet[digest[index] % alphabet.length]);
    }
    return chars.join('');
  }

  function get(now = Date.now()) {
    const slot = slotAt(now);
    return {
      code: codeForSlot(slot),
      expires_at: new Date((slot + 1) * windowMs).toISOString(),
      server_time: new Date(now).toISOString(),
      refresh_seconds: windowMs / 1000,
      ttl_minutes: windowMs / 60_000,
      generation
    };
  }

  function verify(value, now = Date.now()) {
    const submitted = String(value || '').trim().toUpperCase();
    if (!/^[0-9A-Z]{12}$/.test(submitted)) return false;
    const slot = slotAt(now);
    return [slot, slot - 1].some((candidateSlot) => {
      const expected = codeForSlot(candidateSlot);
      return crypto.timingSafeEqual(Buffer.from(submitted), Buffer.from(expected));
    });
  }

  return { get, verify };
}

module.exports = { createRegistrationApprovalCodeService };
