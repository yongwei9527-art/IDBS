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
    nowIso,
    ok,
    query,
    queryOne,
    randomBytes,
    uuid,
    verifyPassword,
    verifyRegistrationApprovalCode,
    verifySecret,
    userAccessMessage,
    recordUserEvent,
    withTransaction
  } = context;
  const runInTransaction = typeof withTransaction === 'function'
    ? withTransaction
    : (work) => work({ query, queryOne });

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

  async function registerUser(payload, context = {}) {
    const name = assertText(payload.name, 'name', 50);
    const studentNo = assertText(payload.student_no, 'student_no', 50);
    const phone = assertPhone(payload.phone);
    const major = assertText(payload.major, 'major', 80);
    const mentorName = assertText(payload.mentor_name, 'mentor_name', 80);
    const password = assertPassword(payload.password);
    if (password.length < 12) return fail('密码至少需要 12 位。', 400, 2001);

    const registration = await runInTransaction(async (tx) => {
      const duplicate = await tx.queryOne(
        'select id, phone, student_no from users where phone = $1 or student_no = $2 limit 1',
        [phone, studentNo]
      );
      if (duplicate?.phone === phone) return { response: fail('手机号已注册。', 409, 3001) };
      if (duplicate?.student_no === studentNo) return { response: fail('学号已注册。', 409, 3001) };

      const createdAt = nowIso();
      const salt = randomBytes(16).toString('hex');
      const passwordHash = await hashPassword(password, salt);
      const approvalCodeAccepted = Boolean(
        payload.approval_code && await verifyRegistrationApprovalCode(payload.approval_code, {
          query: tx.query,
          lock: true
        })
      );
      const user = {
        id: uuid(),
        name,
        phone,
        student_no: studentNo,
        major,
        mentor_name: mentorName,
        password_hash: passwordHash,
        password_salt: salt,
        password_reset_required: false,
        role: 'user',
        status: approvalCodeAccepted ? 'active' : 'pending',
        is_banned: false,
        approved_at: approvalCodeAccepted ? createdAt : null,
        created_at: createdAt,
        updated_at: createdAt
      };
      const insertResult = await tx.query(`
        insert into users (
          id, name, phone, student_no, major, mentor_name,
          password_hash, password_salt, password_reset_required,
          role, status, is_banned, approved_at, created_at, updated_at
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        on conflict (phone) do nothing
        returning *
      `, [
        user.id, user.name, user.phone, user.student_no, user.major, user.mentor_name,
        user.password_hash, user.password_salt, user.password_reset_required,
        user.role, user.status, user.is_banned, user.approved_at, user.created_at, user.updated_at
      ]);
      const inserted = Array.isArray(insertResult) ? insertResult : (insertResult?.rows || []);
      return { saved: inserted[0], approvalCodeAccepted };
    });
    if (registration.response) return registration.response;
    const { saved, approvalCodeAccepted } = registration;
    if (!saved) return fail('手机号已注册。', 409, 3001);
    if (typeof recordUserEvent === 'function') {
      await recordUserEvent({
        user_id: saved.id,
        user_name: saved.name,
        phone: saved.phone,
        event_type: 'register',
        device_type: context.deviceType || '',
        client_key: context.clientKey || '',
        ip_address: context.ip || '',
        remark: approvalCodeAccepted ? 'approval_code_accepted' : 'pending_review'
      }).catch(() => {});
    }

    if (approvalCodeAccepted) {
      return finalizeUserLogin(saved, { ...context, remark: 'register_approval_code' });
    }
    return ok({
      message: '注册已提交，请等待有审批权限的管理员审核后再登录。',
      need_review: true,
      status: 'pending'
    });
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
    if (user.password_reset_required && user.temporary_password_expires_at
      && new Date(user.temporary_password_expires_at).getTime() <= Date.now()) {
      return fail('临时密码已过期，请联系最高权限管理员重新重置。', 401, 1001);
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
