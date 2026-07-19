function createAdminSystemService(context = {}) {
  const {
    assertText,
    DEFAULT_SECURITY_CONFIG,
    fail,
    getAdminAuthConfig,
    getById,
    getReportConfig,
    getWechatConfig,
    hashPassword,
    log,
    normalizeStaffContacts,
    nowIso,
    ok,
    parseBoolean,
    PERMISSION_KEYS,
    PERMISSION_OPTIONS,
    query,
    requireAdminRole,
    ROLE_PERMISSIONS,
    permissionModules,
    saveSystemConfig,
    uuid,
    crypto,
    getSecurityConfig,
    getAdminRoleForUser,
    withTransaction
  } = context;
  const RISK_OPERATION_ACTIONS = [
    'update_security_config',
    'grant_admin_role',
    'upsert_admin_role',
    'revoke_admin_role',
    'delete_user',
    'set_user_status',
    'set_device_available'
  ];

  async function adminGetSecurityConfig(_, token) {
    await requireAdminRole(token, ['super_admin']);
    const wechatConfig = await getWechatConfig();
    const adminAuth = await getAdminAuthConfig();
    return ok({
      config: {
        ...(await getSecurityConfig()),
        ...(await getReportConfig()),
        wechat_token: wechatConfig.wechat_token,
        wechat_app_id: wechatConfig.wechat_app_id,
        wechat_admin_openids: wechatConfig.wechat_admin_openids,
        has_wechat_app_secret: Boolean(wechatConfig.wechat_app_secret),
        has_custom_admin_password: adminAuth.has_custom_admin_password
      }
    });
  }

  async function adminUpdateSecurityConfig(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin']);
    const updates = [
      ['captcha_expire_minutes', 'captcha_expire_minutes', 'Challenge code validity in minutes'],
      ['captcha_hourly_limit', 'captcha_hourly_limit', 'Maximum challenge requests per hour'],
      ['openid_daily_register_limit', 'openid_daily_register_limit', 'Daily bind limit for the same OpenID'],
      ['enable_image_captcha', 'enable_image_captcha', 'Whether image captcha is enabled before challenge issuance', true],
      ['require_return_photo', 'require_return_photo', 'Whether return photos are required before ending usage', true],
      ['block_ip_access_enabled', 'block_ip_access_enabled', 'Whether public pages and login challenge are blocked when accessed by IP host', true],
      ['public_show_reserver_name', 'public_show_reserver_name', 'Whether public users can see reserver name', true],
      ['public_show_reserver_phone', 'public_show_reserver_phone', 'Whether public users can see reserver phone', true],
      ['public_show_reserver_student_no', 'public_show_reserver_student_no', 'Whether public users can see reserver student number', true],
      ['site_domain', 'site_domain', 'Configured public access domain'],
      ['system_notice_enabled', 'system_notice_enabled', 'Whether the user announcement is enabled', true],
      ['admin_report_enabled', 'admin_report_enabled', 'Whether daily usage report push is enabled', true],
      ['admin_report_hour', 'admin_report_hour', 'Daily report push hour'],
      ['admin_report_minute', 'admin_report_minute', 'Daily report push minute'],
      ['admin_report_timezone', 'admin_report_timezone', 'Daily report push timezone'],
      ['wechat_token', 'wechat_token', 'WeChat official account callback token'],
      ['wechat_app_id', 'wechat_app_id', 'WeChat official account AppID'],
      ['wechat_admin_openids', 'wechat_admin_openids', 'Comma-separated admin OpenIDs']
    ];
    for (const [key, payloadKey, description, booleanValue] of updates) {
      if (!Object.prototype.hasOwnProperty.call(payload, payloadKey)) continue;
      const value = booleanValue ? (parseBoolean(payload[payloadKey]) ? '1' : '0') : payload[payloadKey];
      await saveSystemConfig(key, value, description);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'wechat_app_secret') && String(payload.wechat_app_secret || '').trim()) {
      await saveSystemConfig('wechat_app_secret', String(payload.wechat_app_secret).trim(), 'WeChat official account AppSecret');
    }
    let noticeChanged = false;
    if (Object.prototype.hasOwnProperty.call(payload, 'system_notice_title')) {
      noticeChanged = true;
      await saveSystemConfig('system_notice_title', String(payload.system_notice_title || '').trim().slice(0, 120) || DEFAULT_SECURITY_CONFIG.system_notice_title, 'User announcement title');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'system_notice_content')) {
      noticeChanged = true;
      await saveSystemConfig('system_notice_content', String(payload.system_notice_content || '').trim().slice(0, 3000) || DEFAULT_SECURITY_CONFIG.system_notice_content, 'User announcement content');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'system_notice_enabled')) {
      noticeChanged = true;
    }
    if (noticeChanged) {
      await saveSystemConfig('system_notice_version', String(Date.now()), 'User announcement version');
    }
    if (String(payload.new_admin_password || '').trim()) {
      const password = assertText(payload.new_admin_password, 'new_admin_password', 100);
      if (password.length < 12) {
        const error = new Error('管理员入口密码至少需要 12 位。');
        error.status = 400;
        error.code = 2001;
        throw error;
      }
      const salt = crypto.randomBytes(16).toString('hex');
      await saveSystemConfig('admin_password_salt', salt, 'Admin password salt');
      await saveSystemConfig('admin_password_hash', await hashPassword(password, salt), 'Admin password hash');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'staff_contacts')) {
      await saveSystemConfig('staff_contacts', JSON.stringify(normalizeStaffContacts(payload.staff_contacts)), 'Public staff contact cards for user support');
    }
    await log('update_security_config', 'Updated security settings', admin);
    const refreshed = await adminGetSecurityConfig({}, token);
    return ok({ message: '安全配置已更新。', config: refreshed.config });
  }

  async function adminListRoles(_, token) {
    await requireAdminRole(token, ['super_admin']);
    const rows = await query('select ar.*, u.name as user_name, u.phone as user_phone from admin_roles ar left join users u on u.id = ar.user_id order by ar.created_at desc');
    return ok({ roles: rows || [], permissions: PERMISSION_OPTIONS, permission_modules: typeof permissionModules === 'function' ? permissionModules() : [], role_defaults: ROLE_PERMISSIONS });
  }

  async function adminUpsertRole(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin']);
    const userId = assertText(payload.user_id, 'user_id', 60);
    const roleKey = assertText(payload.role_key || payload.role, 'role_key', 30);
    if (!Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, roleKey)) return fail('管理员角色无效。', 400, 2001);
    const permissions = Array.isArray(payload.permissions)
      ? [...new Set(payload.permissions.map((value) => String(value || '').trim()).filter(Boolean))]
      : [];
    const unknownPermissions = permissions.filter((permission) => permission !== '*' && !(PERMISSION_KEYS instanceof Set && PERMISSION_KEYS.has(permission)));
    if (unknownPermissions.length) return fail(`存在未注册的权限：${unknownPermissions.join('、')}`, 400, 2001);
    if (roleKey !== 'super_admin' && permissions.includes('*')) return fail('普通管理员不能拥有全部权限，请按模块显式授权。', 400, 2001);
    const note = String(payload.note || '').trim().slice(0, 200);
    const user = await getById('users', userId);
    if (!user) return fail('用户不存在。', 404, 3004);
    if (user.status !== 'active' || user.is_banned) return fail('仅可为已启用且未禁用的账号配置管理员权限。', 409, 3001);
    const actorId = String(admin.user_id || admin.id || '');
    if (actorId === String(userId) && roleKey !== 'super_admin') return fail('最高权限管理员不能降低自己的权限，请先完成权限交接。', 403, 1003);

    await withTransaction(async (client) => {
      const now = nowIso();
      if (roleKey === 'super_admin') {
        await client.query("update users set role = 'admin', updated_at = $1 where role = 'super_admin' and id <> $2", [now, userId]);
        await client.query("update admin_roles set role_key = 'admin', permissions = '[]'::jsonb, updated_at = $1 where role_key = 'super_admin' and user_id <> $2", [now, userId]);
      }
      await client.query(`
        insert into admin_roles (id, user_id, role_key, permissions, note, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$6)
        on conflict (user_id) do update set
          role_key = excluded.role_key,
          permissions = excluded.permissions,
          note = excluded.note,
          updated_at = excluded.updated_at
      `, [uuid(), userId, roleKey, JSON.stringify(roleKey === 'super_admin' ? ['*'] : permissions), note, now]);
      await client.query('update users set role = $1, updated_at = $2 where id = $3', [roleKey === 'super_admin' ? 'super_admin' : 'admin', now, userId]);
    });
    await log('upsert_admin_role', `Updated admin role to ${roleKey}`, admin, null, userId);
    return ok({ message: roleKey === 'super_admin' ? '最高权限管理员已完成交接。' : '管理员权限已更新。' });
  }
  async function adminRevokeRole(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin']);
    const userId = assertText(payload.user_id, 'user_id', 60);
    const user = await getById('users', userId);
    if (!user) return fail('用户不存在。', 404, 3004);
    if (user.role === 'super_admin') return fail('系统必须始终保留一名最高权限管理员，请先完成权限交接。', 403, 1003);
    if (String(admin.user_id || admin.id || '') === String(userId)) return fail('不能撤销自己的管理员权限。', 403, 1003);
    await query('delete from admin_roles where user_id = $1', [userId]);
    await query('update users set role = $1, updated_at = $2 where id = $3', ['user', nowIso(), userId]);
    await log('revoke_admin_role', `Revoked admin role from ${user.name || user.phone || userId}`, admin, null, userId);
    return ok({ message: '管理员权限已撤销。' });
  }
  async function adminPermissions(_, token) {
    await requireAdminRole(token, ['super_admin'], ['admin.manage']);
    const permissions = await query('select * from permissions order by sort_order asc, permission_key asc');
    const roles = await query('select r.*, coalesce(json_agg(rp.permission_key) filter (where rp.permission_key is not null), $$[]$$::json) as permissions from roles r left join role_permissions rp on rp.role_id = r.id group by r.id order by r.created_at asc');
    return ok({ permissions: permissions || PERMISSION_OPTIONS, roles: roles || [], role_defaults: ROLE_PERMISSIONS });
  }

  async function adminUserRoles(payload, token) {
    return adminUpsertRole(payload, token);
  }

  async function adminOperationLogs(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'auditor'], ['audit.view']);
    const requestedLimit = Number(params.limit) || 100;
    const limit = Math.max(1, Math.min(requestedLimit, 500));
    const requestedOffset = Number(params.offset) || 0;
    const offset = Math.max(0, requestedOffset);
    const conditions = [];
    const values = [];
    const operatorKeyword = String(params.operator || '').trim();
    const action = String(params.action || '').trim();
    const keyword = String(params.keyword || '').trim();
    const riskOnly = String(params.risk || '').trim() === '1';
    const startDate = String(params.start_date || '').trim();
    const endDate = String(params.end_date || '').trim();
    if (operatorKeyword) {
      values.push(`%${operatorKeyword}%`);
      conditions.push(`operator_name ilike $${values.length}`);
    }
    if (action) {
      values.push(`%${action}%`);
      conditions.push(`action ilike $${values.length}`);
    }
    if (riskOnly) {
      values.push(RISK_OPERATION_ACTIONS);
      conditions.push(`action = any($${values.length}::text[])`);
    }
    if (keyword) {
      values.push(`%${keyword}%`);
      conditions.push(`(
        coalesce(detail::text, '') ilike $${values.length}
        or coalesce(device_id::text, '') ilike $${values.length}
        or coalesce(record_id::text, '') ilike $${values.length}
        or case when exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'operation_logs' and column_name = 'target_type'
        ) then coalesce(to_jsonb(operation_logs)->>'target_type', '') else '' end ilike $${values.length}
        or case when exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'operation_logs' and column_name = 'target_id'
        ) then coalesce(to_jsonb(operation_logs)->>'target_id', '') else '' end ilike $${values.length}
        or case when exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'operation_logs' and column_name = 'ip_address'
        ) then coalesce(to_jsonb(operation_logs)->>'ip_address', '') else '' end ilike $${values.length}
      )`);
    }
    if (startDate) {
      values.push(`${startDate} 00:00:00`);
      conditions.push(`created_at >= $${values.length}::timestamptz`);
    }
    if (endDate) {
      values.push(`${endDate} 23:59:59.999`);
      conditions.push(`created_at <= $${values.length}::timestamptz`);
    }
    const whereSql = conditions.length ? `where ${conditions.join(' and ')}` : '';
    const countRows = await query(`select count(*)::int as total from operation_logs ${whereSql}`, values);
    const total = Number(countRows?.[0]?.total) || 0;
    values.push(limit);
    const limitParam = values.length;
    values.push(offset);
    const offsetParam = values.length;
    const rows = await query(`
      select id,
        operator_id,
        operator_name,
        action,
        device_id,
        record_id,
        detail,
        created_at,
        case when exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'operation_logs' and column_name = 'target_type'
        ) then to_jsonb(operation_logs)->>'target_type' else null end as target_type,
        case when exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'operation_logs' and column_name = 'target_id'
        ) then to_jsonb(operation_logs)->>'target_id' else null end as target_id,
        case when exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'operation_logs' and column_name = 'ip_address'
        ) then to_jsonb(operation_logs)->>'ip_address' else null end as ip_address
      from operation_logs
      ${whereSql}
      order by created_at desc
      limit $${limitParam} offset $${offsetParam}
    `, values);
    return ok({ logs: rows || [], total, has_more: offset + (rows || []).length < total });
  }

  async function adminOptions(_, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['stats.view', 'stats.export', 'device.manage', 'reservation.view']);
    const users = await query('select id, name, phone, status from users order by created_at desc');
    const devices = await query('select id, device_code, name from devices order by created_at desc');
    return ok({ users: users || [], devices: devices || [], permissions: PERMISSION_OPTIONS, role_defaults: ROLE_PERMISSIONS });
  }

  return {
    adminGetSecurityConfig,
    adminListRoles,
    adminOperationLogs,
    adminOptions,
    adminPermissions,
    adminRevokeRole,
    adminUpdateSecurityConfig,
    adminUpsertRole,
    adminUserRoles
  };
}

module.exports = { createAdminSystemService };




