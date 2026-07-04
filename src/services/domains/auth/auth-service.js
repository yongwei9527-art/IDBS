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
    ok,
    queryOne,
    userAccessMessage
  } = context;

  async function adminLogin(payload) {
    const password = assertText(payload.password, 'password', 100);
    const adminAuth = await getAdminAuthConfig();
    if (!adminAuth.has_custom_admin_password && password === adminAuth.default_admin_password_seed) {
      const token = makeToken({ scope: 'admin', role: 'super_admin', name: 'admin' }, 7);
      return ok({ token, seeded: true });
    }
    if (adminAuth.has_custom_admin_password) {
      if (hashPassword(password, adminAuth.admin_password_salt) !== adminAuth.admin_password_hash) {
        return fail('Invalid admin password', 401, 1001);
      }
    } else {
      if (!adminPassword) return fail('ADMIN_PASSWORD is not configured', 500, 5000);
      if (password !== adminPassword) return fail('Invalid admin password', 401, 1001);
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
    if (!user || user.password_hash !== hashPassword(password, user.password_salt)) {
      return fail('Invalid phone or password', 401, 1001);
    }
    if (user.is_banned) {
      return fail(userAccessMessage(user), 403, 1003);
    }
    if (user.status !== 'active') {
      return fail(userAccessMessage(user), 403, 1003);
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
