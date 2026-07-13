const { AppError } = require('../../../lib/app-error');

function createWechatService(context = {}) {
  const {
    assertPhone,
    assertText,
    crypto,
    escapeXml,
    fail,
    finalizeUserLogin,
    getClientKey,
    getSecurityConfig,
    getWechatConfig,
    hashPassword,
    maskOpenId,
    nowIso,
    ok,
    query,
    queryOne,
    recordUserEvent,
    safeUser,
    sha256,
    shouldBlockIpAccess,
    userAccessMessage,
    uuid
  } = context;

  const challengeStore = new Map();

  function makeChallengeCode() {
    return String(Math.floor(10000 + Math.random() * 90000));
  }

  function cleanupExpiredChallenges() {
    const now = Date.now();
    for (const [code, item] of challengeStore.entries()) {
      if (!item || item.expire_at <= now || item.used_at) {
        challengeStore.delete(code);
      }
    }
  }

  async function getUserByOpenId(openid) {
    return queryOne('select * from users where wechat_openid = $1 limit 1', [openid]);
  }

  async function createLoginChallenge(_, context = {}) {
    cleanupExpiredChallenges();
    if (await shouldBlockIpAccess(context)) {
      return fail('当前系统已关闭 IP 直连注册/浏览，请使用管理员配置的域名访问。', 403, 1003);
    }
    const config = await getSecurityConfig();
    const clientKey = getClientKey(context);
    const now = Date.now();
    const recent = [...challengeStore.values()].filter((item) => item.client_key === clientKey && (now - item.created_at) < 60 * 60 * 1000);
    if (recent.length >= config.captcha_hourly_limit) return fail('验证码请求过于频繁，请一小时后再试。', 429, 2001);
    let code = makeChallengeCode();
    while (challengeStore.has(code)) code = makeChallengeCode();
    challengeStore.set(code, { code, client_key: clientKey, created_at: now, expire_at: now + config.captcha_expire_minutes * 60 * 1000, ip: context.ip || '', user_agent: context.userAgent || '', openid: null, nickname: '', used_at: null });
    return ok({ code, expire_minutes: config.captcha_expire_minutes, hourly_limit: config.captcha_hourly_limit, tips: 'Send this code to the official account within the valid time.' });
  }

  async function getLoginChallengeStatus(query = {}, context = {}) {
    cleanupExpiredChallenges();
    const code = assertText(query.code || query.tempCode, 'code', 20);
    const challenge = challengeStore.get(code);
    if (!challenge) return fail('验证码已过期或不正确。', 404, 3004);
    if (challenge.expire_at <= Date.now()) {
      challengeStore.delete(code);
      return fail('验证码已过期或不正确。', 404, 3004);
    }
    if (!challenge.openid) {
      return ok({ logged_in: false, need_bind: false, status: 'pending', expire_at: new Date(challenge.expire_at).toISOString() });
    }
    const user = await getUserByOpenId(challenge.openid);
    if (user) {
      if (user.is_banned || user.status !== 'active') return fail(userAccessMessage(user), 403, 1003);
      challenge.used_at = Date.now();
      challengeStore.delete(code);
      return finalizeUserLogin(user, { ...context, remark: 'wechat_login', deviceType: context.deviceType || 'wechat' });
    }
    return ok({ logged_in: false, need_bind: true, status: 'need_bind', temp_code: code, openid_masked: maskOpenId(challenge.openid), nickname: challenge.nickname || '', expire_at: new Date(challenge.expire_at).toISOString() });
  }

  async function bindWechatAccount(payload, context = {}) {
    cleanupExpiredChallenges();
    const tempCode = assertText(payload.temp_code || payload.tempCode, 'temp_code', 20);
    const name = assertText(payload.name, 'name', 50);
    const studentNo = assertText(payload.student_no || payload.studentNo, 'student_no', 50);
    const phone = assertPhone(payload.phone);
    const challenge = challengeStore.get(tempCode);
    if (!challenge || !challenge.openid || challenge.expire_at <= Date.now()) {
      if (challenge && challenge.expire_at <= Date.now()) challengeStore.delete(tempCode);
      return fail('验证码已过期或不正确。', 400, 2001);
    }
    const config = await getSecurityConfig();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const bindEvents = await query('select * from user_activity_logs where wechat_openid = $1 and event_type = $2 and created_at >= $3', [challenge.openid, 'wechat_bind', dayStart.toISOString()]);
    if ((bindEvents || []).length >= config.openid_daily_register_limit) {
      return fail('该微信账号今日绑定次数已达上限。', 429, 3001);
    }
    const existingByOpenId = await getUserByOpenId(challenge.openid);
    if (existingByOpenId) {
      return fail('该微信账号已绑定其他用户。', 409, 3001);
    }
    let user = await queryOne('select * from users where name = $1 and student_no = $2 limit 1', [name, studentNo]);
    if (!user) {
      const phoneExists = await queryOne('select id from users where phone = $1 limit 1', [phone]);
      if (phoneExists) return fail('手机号已注册。', 409, 3001);
      const salt = crypto.randomBytes(8).toString('hex');
      user = {
        id: uuid(),
        name,
        phone,
        student_no: studentNo,
        group_name: '',
        email: '',
        password_hash: hashPassword(crypto.randomBytes(16).toString('hex'), salt),
        password_salt: salt,
        role: 'user',
        status: 'pending',
        is_banned: false,
        wechat_openid: challenge.openid,
        wechat_nickname: challenge.nickname || '',
        created_at: nowIso(),
        updated_at: nowIso()
      };
      await query('insert into users (id, name, phone, student_no, group_name, email, password_hash, password_salt, role, status, is_banned, wechat_openid, wechat_nickname, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)', [
        user.id, user.name, user.phone, user.student_no, user.group_name, user.email, user.password_hash, user.password_salt, user.role, user.status, user.is_banned, user.wechat_openid, user.wechat_nickname, user.created_at, user.updated_at
      ]);
      challenge.used_at = Date.now();
      challengeStore.delete(tempCode);
      await recordUserEvent({ user_id: user.id, user_name: user.name, phone: user.phone, wechat_openid: challenge.openid, event_type: 'register', device_type: context.deviceType || 'wechat', client_key: getClientKey(context), ip_address: context.ip || '', remark: `Registered and bound through challenge ${tempCode}` });
      return ok({ message: '注册与绑定已完成，请等待管理员审核。', need_review: true, user: safeUser(user) });
    }
    if (user.is_banned) return fail('该账号已被禁用。', 403, 1003);
    if (user.wechat_openid && user.wechat_openid !== challenge.openid) {
      return fail('该账号已绑定其他微信。', 409, 3001);
    }
    await query('update users set wechat_openid = $1, wechat_nickname = $2, updated_at = $3 where id = $4', [challenge.openid, challenge.nickname || user.wechat_nickname || '', nowIso(), user.id]);
    challenge.used_at = Date.now();
    challengeStore.delete(tempCode);
    const boundUser = { ...user, wechat_openid: challenge.openid, wechat_nickname: challenge.nickname || user.wechat_nickname || '' };
    await recordUserEvent({ user_id: user.id, user_name: user.name, phone: user.phone, wechat_openid: challenge.openid, event_type: 'wechat_bind', device_type: context.deviceType || 'wechat', client_key: getClientKey(context), ip_address: context.ip || '', remark: `Bound through challenge ${tempCode}` });
    if (boundUser.status !== 'active') {
      return ok({ message: '微信绑定已完成，请等待管理员审核。', need_review: true, user: safeUser(boundUser) });
    }
    return finalizeUserLogin(boundUser, { ...context, remark: 'wechat_bind_and_login', deviceType: context.deviceType || 'wechat' });
  }

  async function processWechatCodeLogin(payload = {}) {
    const openid = assertText(payload.openid, 'openid', 150);
    const code = assertText(payload.code, 'code', 20);
    const nickname = String(payload.nickname || '').trim().slice(0, 80);
    cleanupExpiredChallenges();
    const challenge = challengeStore.get(code);
    if (!challenge) {
      return { success: false, message: '验证码已过期或无效，请重新获取。' };
    }
    if (challenge.expire_at <= Date.now()) {
      challengeStore.delete(code);
      return { success: false, message: '验证码已过期，请重新获取。' };
    }
    if (challenge.openid && challenge.openid !== openid) {
      return { success: false, message: '该验证码已被其他微信使用，请重新获取。' };
    }
    challenge.openid = openid;
    challenge.nickname = nickname;
    const user = await getUserByOpenId(openid);
    if (user) {
      if (user.is_banned) {
        return { success: false, message: '您的账号已被限制，请联系管理员。' };
      }
      if (user.status !== 'active') {
        return { success: false, message: `您的账号状态为 ${user.status}，请联系管理员。` };
      }
      await recordUserEvent({ user_id: user.id, user_name: user.name, phone: user.phone, wechat_openid: openid, event_type: 'wechat_scan', device_type: 'wechat', client_key: challenge.client_key, ip_address: challenge.ip, remark: `Challenge ${code} matched an existing user` });
      return { success: true, message: `您好，${user.name}，验证成功，请返回系统页面完成登录。` };
    }
    await recordUserEvent({ event_type: 'wechat_scan', user_name: nickname || '', wechat_openid: openid, device_type: 'wechat', client_key: challenge.client_key, ip_address: challenge.ip, remark: `Challenge ${code} requires first-time binding` });
    return { success: true, message: '验证成功，请返回系统页面继续绑定姓名和学号。' };
  }

  async function verifyWechatSignature({ signature, timestamp, nonce }) {
    const wechatConfig = await getWechatConfig();
    if (!wechatConfig.wechat_token) return true;
    const raw = [wechatConfig.wechat_token, timestamp, nonce].sort().join('');
    return sha256(raw) === signature || crypto.createHash('sha1').update(raw).digest('hex') === signature;
  }

  async function verifyWechatHandshake(query = {}) {
    const { signature, timestamp, nonce, echostr } = query;
    if (!signature || !timestamp || !nonce || !(await verifyWechatSignature({ signature, timestamp, nonce }))) {
      throw new AppError('微信签名校验失败。', { status: 403, code: 1003 });
    }
    return String(echostr || '');
  }

  async function handleWechatMessage(payload = {}) {
    const content = String(payload.content || '').trim();
    const openid = String(payload.openid || '').trim();
    const nickname = String(payload.nickname || '').trim();
    if (!content || !openid) {
      return '消息格式不正确，请发送登录验证码。';
    }
    const result = await processWechatCodeLogin({ code: content, openid, nickname });
    return result.message;
  }

  function buildWechatReply(toUser, fromUser, content) {
    const timestamp = Math.floor(Date.now() / 1000);
    return `<xml>\n<ToUserName><![CDATA[${escapeXml(toUser)}]]></ToUserName>\n<FromUserName><![CDATA[${escapeXml(fromUser)}]]></FromUserName>\n<CreateTime>${timestamp}</CreateTime>\n<MsgType><![CDATA[text]]></MsgType>\n<Content><![CDATA[${escapeXml(content)}]]></Content>\n</xml>`;
  }

  return {
    bindWechatAccount,
    buildWechatReply,
    createLoginChallenge,
    getLoginChallengeStatus,
    handleWechatMessage,
    processWechatCodeLogin,
    verifyWechatHandshake
  };
}

module.exports = { createWechatService };


