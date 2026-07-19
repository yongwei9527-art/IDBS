function createAuthService(context = {}) {
  const {
    adminPassword,
    assertPassword,
    assertPhone,
    assertText,
    fail,
    finalizeUserLogin,
    getAdminAuthConfig,
    hashPassword,
    makeToken,
    needsPasswordRehash,
    ok,
    query,
    queryOne,
    verifyPassword,
    verifySecret,
    userAccessMessage,
    recordUserEvent
  } = context;

  async function upgradeStoredPassword(table, idColumn, id, password, salt) {
    const upgradedHash = await hashPassword(password, salt);
    await query(`update ${table} set password_hash = $1 where ${idColumn} = $2`, [upgradedHash, id]);
  }

  async function upgradeAdminPassword(password, salt) {
    const upgradedHash = await hashPassword(password, salt);
    await query(`
      insert into system_configs (config_key, config_value, description, updated_at)
      values ('admin_password_hash', $1, 'Admin password hash', now())
      on conflict (config_key) do update set config_value = excluded.config_value, updated_at = now()
    `, [upgradedHash]);
  }

  async function adminLogin(payload) {
    const password = assertText(payload.password, 'password', 100);
    const adminAuth = await getAdminAuthConfig();
    if (adminAuth.has_custom_admin_password) {
      if (!(await verifyPassword(password, adminAuth.admin_password_salt, adminAuth.admin_password_hash))) {
        return fail('管理员密码不正确。', 401, 1001);
      }
      if (needsPasswordRehash(adminAuth.admin_password_hash)) {
        await upgradeAdminPassword(password, adminAuth.admin_password_salt);
      }
    } else {
      if (!adminPassword) return fail('管理员入口密码未配置。', 500, 5000);
      if (!verifySecret(password, adminPassword)) return fail('管理员密码不正确。', 401, 1001);
    }
    const token = makeToken({ scope: 'admin', role: 'super_admin', name: 'admin' }, 7);
    return ok({ token });
  }

  async function registerUser() {
    return fail('普通账号密码注册已关闭，请通过公众号验证码完成首次注册/绑定。', 403, 1003);
  }

  async function loginUser(payload, context = {}) {
    const phone = assertPhone(payload.phone);
    const password = assertPassword(payload.password);
    const user = await queryOne('select * from users where phone = $1 limit 1', [phone]);
    if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
      if (typeof recordUserEvent === 'function') {
        await recordUserEvent({
          user_id: user?.id || null,
          user_name: user?.name || '',
          phone,
          event_type: 'login_failed',
          device_type: context.deviceType || '',
          client_key: context.clientKey || '',
          ip_address: context.ip || '',
          remark: user ? 'bad_password' : 'unknown_phone'
        }).catch(() => {});
      }
      return fail('手机号或密码不正确。', 401, 1001);
    }
    if (user.is_banned) {
      if (typeof recordUserEvent === 'function') {
        await recordUserEvent({
          user_id: user.id,
          user_name: user.name,
          phone,
          event_type: 'login_denied',
          device_type: context.deviceType || '',
          client_key: context.clientKey || '',
          ip_address: context.ip || '',
          remark: 'banned'
        }).catch(() => {});
      }
      return fail(userAccessMessage(user), 403, 1003);
    }
    if (user.status !== 'active') {
      if (typeof recordUserEvent === 'function') {
        await recordUserEvent({
          user_id: user.id,
          user_name: user.name,
          phone,
          event_type: 'login_denied',
          device_type: context.deviceType || '',
          client_key: context.clientKey || '',
          ip_address: context.ip || '',
          remark: user.status || 'inactive'
        }).catch(() => {});
      }
      return fail(userAccessMessage(user), 403, 1003);
    }
    if (needsPasswordRehash(user.password_hash)) {
      await upgradeStoredPassword('users', 'id', user.id, password, user.password_salt);
    }
    return finalizeUserLogin(user, { ...context, remark: 'password_login' });
  }

  return {
    adminLogin,
    loginUser,
    registerUser
  };
}

module.exports = { createAuthService };
