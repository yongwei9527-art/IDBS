function createUserService(context = {}) {
  const {
    addNamesToBorrowRows,
    addUserToManagementGroup,
    assertText,
    createUserNotification,
    db,
    fail,
    getById,
    getRegistrationApprovalCode,
    refreshRegistrationApprovalCode,
    hashPassword,
    log,
    nowIso,
    ok,
    parseBoolean,
    query,
    queryOne,
    randomBytes,
    removeUserFromManagementGroup,
    requireAdminRole,
    requireUser,
    safeUser,
    updateRegistrationApprovalCodeTtl,
    verifyPassword,
    withTransaction
  } = context;

  async function getProfile(token) {
    const user = await requireUser(token, { allowPasswordReset: true });
    return ok({ user: safeUser(user) });
  }

  async function listMyNotifications(params = {}, token) {
    const user = await requireUser(token);
    const limit = Math.min(Math.max(Number(params.limit || 50) || 50, 1), 100);
    const rows = await query(`
      select n.*, d.device_code, d.name as device_name,
        ri.start_time as reservation_start_time, ri.end_time as reservation_end_time, ri.status as reservation_status
      from user_notifications n
      left join devices d on d.id = n.device_id
      left join reservation_items ri on ri.id = n.reservation_id or ri.reservation_id = n.reservation_id
      where n.user_id = $1
      order by n.created_at desc
      limit $2
    `, [user.id, limit]);
    const unread = await queryOne('select count(*)::int as count from user_notifications where user_id = $1 and is_read = false', [user.id]);
    return ok({ notifications: rows || [], unread_count: Number(unread?.count || 0) });
  }

  async function markMyNotificationsRead(payload = {}, token) {
    const user = await requireUser(token);
    const ids = Array.isArray(payload.ids) ? payload.ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
    let result;
    if (ids.length) {
      result = await db.query('update user_notifications set is_read = true, read_at = $1 where user_id = $2 and id = any($3) and is_read = false', [nowIso(), user.id, ids]);
    } else {
      result = await db.query('update user_notifications set is_read = true, read_at = $1 where user_id = $2 and is_read = false', [nowIso(), user.id]);
    }
    return ok({ updated: result.rowCount || 0 });
  }

  async function adminGetUserDetail(params = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin', 'auditor'], ['user.manage', 'user.approve', 'reservation.view', 'stats.view']);
    const userId = assertText(params.user_id || params.id, 'user_id', 60);
    const user = await getById('users', userId);
    if (!user) return fail('用户不存在。', 404, 3004);
    const reservations = await query(
      `select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        b.purpose, b.status as batch_status,
        d.device_code, d.name as device_name,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join reservation_batches b on b.id = ri.batch_id
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.user_id = $1
      order by ri.created_at desc
      limit 50`,
      [userId]
    );
    const borrows = await addNamesToBorrowRows(await query('select * from borrow_records where user_id = $1 order by borrow_time desc limit 50', [userId]));
    const faultReports = await query(
      `select f.*, d.device_code, d.name as device_name
      from device_fault_reports f
      left join devices d on d.id = f.device_id
      where f.user_id = $1
      order by f.created_at desc
      limit 50`,
      [userId]
    );
    const requests = await query(
      `select r.*, d.device_code, d.name as device_name
      from user_requests r
      left join devices d on d.id = r.device_id
      where r.user_id = $1
      order by r.created_at desc
      limit 50`,
      [userId]
    );
    const activity = await query('select * from user_activity_logs where user_id = $1 order by created_at desc limit 20', [userId]);
    const [fulfillmentRow] = await query(
      `select
        (select count(*)::int from borrow_records br where br.user_id = $1 and br.status = 'returned' and coalesce(br.is_overdue, false) = false and coalesce(br.return_condition, 'normal') = 'normal') as normal_completed_count,
        (select count(*)::int from reservation_items ri where ri.user_id = $1 and ri.status = 'cancelled') as cancelled_count,
        (select count(*)::int from reservation_items ri where ri.user_id = $1 and ri.status = 'no_show') as no_show_count,
        (select count(*)::int from reservation_items ri where ri.user_id = $1 and ri.status = 'no_show' and ri.start_time >= now() - interval '90 days') as recent_no_show_count,
        (select min(ri.start_time) from reservation_items ri where ri.user_id = $1 and ri.status = 'no_show' and ri.start_time >= now() - interval '90 days') as earliest_recent_no_show_at,
        (select no_show_reason_category from reservation_items ri where ri.user_id = $1 and ri.status = 'no_show' order by ri.start_time desc limit 1) as latest_no_show_reason,
        (select count(*)::int from borrow_records br where br.user_id = $1 and (br.status = 'overdue' or coalesce(br.is_overdue, false) = true)) as overdue_count,
        (select count(*)::int from borrow_records br where br.user_id = $1 and (br.status = 'abnormal_pending' or coalesce(br.return_condition, 'normal') <> 'normal')) as abnormal_return_count,
        (select count(*)::int from borrow_records br where br.user_id = $1 and br.return_material_required = true and br.return_supplemented_at is null) as pending_material_count,
        (select count(*)::int from borrow_records br where br.user_id = $1 and (br.return_material_late = true or (br.return_material_required = true and br.return_supplemented_at is null and br.return_material_deadline < now()))) as material_default_count`,
      [userId]
    );
    const recentNoShowCount = Number(fulfillmentRow?.recent_no_show_count || 0);
    const noShowRestrictionUntil = recentNoShowCount >= 2 && fulfillmentRow?.earliest_recent_no_show_at
      ? new Date(new Date(fulfillmentRow.earliest_recent_no_show_at).getTime() + 90 * 24 * 60 * 60_000).toISOString()
      : null;
    const restriction = user.is_banned
      ? { status: 'restricted', reason: '账号已被封禁', until: null }
      : user.status === 'disabled'
        ? { status: 'restricted', reason: user.disabled_reason || '账号已被停用', until: null }
        : noShowRestrictionUntil
          ? { status: 'restricted', reason: '近 90 天累计 2 次爽约', until: noShowRestrictionUntil }
          : { status: 'normal', reason: null, until: null };
    const fulfillment = {
      normal_completed_count: Number(fulfillmentRow?.normal_completed_count || 0),
      cancelled_count: Number(fulfillmentRow?.cancelled_count || 0),
      no_show_count: Number(fulfillmentRow?.no_show_count || 0),
      overdue_count: Number(fulfillmentRow?.overdue_count || 0),
      abnormal_return_count: Number(fulfillmentRow?.abnormal_return_count || 0),
      pending_material_count: Number(fulfillmentRow?.pending_material_count || 0),
      material_default_count: Number(fulfillmentRow?.material_default_count || 0),
      latest_no_show_reason: fulfillmentRow?.latest_no_show_reason || null,
      restriction_status: restriction.status,
      restriction_reason: restriction.reason,
      restriction_until: restriction.until
    };
    return ok({ user: safeUser(user), fulfillment, reservations, borrows, fault_reports: faultReports || [], requests: requests || [], activity: activity || [] });
  }

  async function adminListUsers(_, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage', 'user.approve']);
    const data = await query('select * from users order by created_at desc');
    return ok({ users: (data || []).map(safeUser) });
  }

  function isSuperAdminOperator(admin = {}) {
    return admin.role === 'super_admin' || admin.admin_role_key === 'super_admin';
  }

  function isHighestAdminOperator(admin = {}, assignedRole = {}) {
    const operatorPermissions = Array.isArray(admin.permissions) ? admin.permissions : [];
    const assignedPermissions = Array.isArray(assignedRole.permissions) ? assignedRole.permissions : [];
    return isSuperAdminOperator(admin)
      || assignedRole.role_key === 'super_admin'
      || operatorPermissions.includes('*')
      || assignedPermissions.includes('*');
  }

  function isSelfTarget(admin, user) {
    const adminUserId = String(admin?.user_id || admin?.id || '');
    return Boolean(adminUserId && user?.id && String(user.id) === adminUserId);
  }

  function ensureCanModifyUser(admin, user) {
    if (!user) return null;
    if (isSelfTarget(admin, user)) {
      return fail('不能操作自己的管理员账号，请由其他最高权限管理员处理。', 403, 1003);
    }
    if (isSuperAdminOperator(admin)) return null;
    if (user.role === 'admin' || user.role === 'super_admin') {
      return fail('只有最高权限管理员可以维护管理员账号。', 403, 1003);
    }
    return null;
  }

  function generateTemporaryPassword() {
    let value = '';
    while (value.length < 12) {
      const bytes = randomBytes(24);
      for (const byte of bytes) {
        if (byte >= 250) continue;
        value += String(byte % 10);
        if (value.length === 12) break;
      }
    }
    return value;
  }

  async function adminResetUserPassword(payload, token) {
    const { admin, role } = await requireAdminRole(token, ['super_admin'], ['*']);
    if (!isHighestAdminOperator(admin, role)) {
      return fail('\u53ea\u6709\u6700\u9ad8\u6743\u9650\u7ba1\u7406\u5458\u53ef\u4ee5\u91cd\u7f6e\u666e\u901a\u7528\u6237\u5bc6\u7801\u3002', 403, 1003);
    }
    const userId = assertText(payload.user_id, 'user_id', 60);
    const password = generateTemporaryPassword();

    const user = await getById('users', userId);
    if (!user) return fail('\u7528\u6237\u4e0d\u5b58\u5728\u3002', 404, 3004);
    const assignedAdminRole = await queryOne('select role_key, permissions from admin_roles where user_id = $1 limit 1', [userId]);
    const targetPermissions = Array.isArray(assignedAdminRole?.permissions) ? assignedAdminRole.permissions : [];
    const targetIsHighestAdmin = user.role === 'super_admin'
      || assignedAdminRole?.role_key === 'super_admin'
      || targetPermissions.includes('*');
    if (isSelfTarget(admin, user) || targetIsHighestAdmin) {
      return fail('\u4e0d\u80fd\u91cd\u7f6e\u5f53\u524d\u6216\u5176\u4ed6\u6700\u9ad8\u6743\u9650\u7ba1\u7406\u5458\u8d26\u53f7\u5bc6\u7801\u3002', 403, 1003);
    }

    const salt = randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(password, salt);
    const changedAt = nowIso();
    const temporaryPasswordExpiresAt = new Date(new Date(changedAt).getTime() + 24 * 60 * 60_000).toISOString();
    let revokedRefreshSessions = 0;
    await withTransaction(async (client) => {
      const updated = await client.query(`
        update users
        set password_hash = $1,
            password_salt = $2,
            password_reset_required = true,
            temporary_password_expires_at = $3,
            updated_at = $4
        where id = $5
          and role <> 'super_admin'
          and not exists (
            select 1
            from admin_roles
            where user_id = $5
              and (role_key = 'super_admin' or permissions ? '*')
          )
      `, [passwordHash, salt, temporaryPasswordExpiresAt, changedAt, userId]);
      if (updated.rowCount !== 1) {
        const error = new Error('\u7528\u6237\u6743\u9650\u72b6\u6001\u5df2\u53d8\u5316\uff0c\u8bf7\u5237\u65b0\u540e\u91cd\u8bd5\u3002');
        error.status = 409;
        error.code = 3001;
        throw error;
      }
      const revoked = await client.query(`
        update refresh_token_sessions
        set revoked_at = $1
        where subject = $2 and revoked_at is null
      `, [changedAt, userId]);
      revokedRefreshSessions = Number(revoked.rowCount || 0);
      const txQuery = (sql, params = []) => client.query(sql, params);
      await log('reset_user_password', {
        message: user.role === 'admin' || assignedAdminRole
          ? '\u6700\u9ad8\u6743\u9650\u7ba1\u7406\u5458\u5df2\u91cd\u7f6e\u666e\u901a\u7ba1\u7406\u5458\u5bc6\u7801'
          : '\u6700\u9ad8\u6743\u9650\u7ba1\u7406\u5458\u5df2\u91cd\u7f6e\u666e\u901a\u7528\u6237\u5bc6\u7801',
        refresh_sessions_revoked: revokedRefreshSessions,
        access_token_max_minutes: 15,
        temporary_password_expires_at: temporaryPasswordExpiresAt
      }, admin, null, userId, txQuery);
    });
    return ok({
      message: '\u5bc6\u7801\u5df2\u91cd\u7f6e\u4e3a\u4e00\u6b21\u6027\u4e34\u65f6\u5bc6\u7801\uff0c\u7528\u6237\u767b\u5f55\u540e\u5fc5\u987b\u7acb\u5373\u8bbe\u7f6e\u65b0\u5bc6\u7801\u3002',
      temporary_password: password,
      temporary_password_expires_at: temporaryPasswordExpiresAt,
      refresh_sessions_revoked: revokedRefreshSessions,
      access_token_max_minutes: 15,
      password_reset_required: true
    });
  }

  async function adminGetRegistrationApprovalCode(_, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['user.approve']);
    return ok(await getRegistrationApprovalCode());
  }

  async function adminRefreshRegistrationApprovalCode(_, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['user.approve']);
    return ok(await refreshRegistrationApprovalCode());
  }

  async function adminUpdateRegistrationApprovalCodeTtl(payload = {}, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['user.approve']);
    return ok(await updateRegistrationApprovalCodeTtl(payload.ttl_minutes));
  }

  function passwordResetError(message, status = 400, code = 2001) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
  }

  async function completeRequiredPasswordReset(payload, token) {
    const user = await requireUser(token, { allowPasswordReset: true });
    const currentPassword = typeof payload.current_password === 'string' ? payload.current_password : '';
    const newPassword = typeof payload.new_password === 'string' ? payload.new_password : '';
    if (!currentPassword || currentPassword.length > 128) {
      return fail('\u8bf7\u8f93\u5165\u5f53\u524d\u4e34\u65f6\u5bc6\u7801\u3002', 400, 2001);
    }
    if (newPassword.length < 12) return fail('\u65b0\u5bc6\u7801\u81f3\u5c11\u9700\u8981 12 \u4f4d\u3002', 400, 2001);
    if (newPassword.length > 128) return fail('\u65b0\u5bc6\u7801\u6700\u591a 128 \u4f4d\u3002', 400, 2001);
    if (newPassword === currentPassword) return fail('\u65b0\u5bc6\u7801\u4e0d\u80fd\u4e0e\u4e34\u65f6\u5bc6\u7801\u76f8\u540c\u3002', 400, 2001);

    const salt = randomBytes(16).toString('hex');
    const changedAt = nowIso();
    let revokedRefreshSessions = 0;

    await withTransaction(async (client) => {
      const lockedResult = await client.query(`
        select id, password_hash, password_salt, password_reset_required, temporary_password_expires_at
        from users
        where id = $1 and status = 'active' and coalesce(is_banned, false) = false
        for update
      `, [user.id]);
      const lockedUser = lockedResult.rows?.[0];
      if (!lockedUser) throw passwordResetError('\u8d26\u53f7\u72b6\u6001\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u65b0\u767b\u5f55\u540e\u518d\u8bd5\u3002', 403, 1003);
      if (!lockedUser.password_reset_required) {
        throw passwordResetError('\u8be5\u8d26\u53f7\u5f53\u524d\u4e0d\u9700\u8981\u5b8c\u6210\u5f3a\u5236\u6539\u5bc6\u3002', 409, 3001);
      }
      if (lockedUser.temporary_password_expires_at && new Date(lockedUser.temporary_password_expires_at).getTime() <= Date.now()) {
        throw passwordResetError('\u4e34\u65f6\u5bc6\u7801\u5df2\u8fc7\u671f\uff0c\u8bf7\u8054\u7cfb\u6700\u9ad8\u6743\u9650\u7ba1\u7406\u5458\u91cd\u65b0\u91cd\u7f6e\u3002', 401, 1001);
      }
      if (!(await verifyPassword(currentPassword, lockedUser.password_salt, lockedUser.password_hash))) {
        throw passwordResetError('\u5f53\u524d\u4e34\u65f6\u5bc6\u7801\u4e0d\u6b63\u786e\u3002', 401, 1001);
      }

      const passwordHash = await hashPassword(newPassword, salt);
      await client.query(`
        update users
        set password_hash = $1,
            password_salt = $2,
            password_reset_required = false,
            temporary_password_expires_at = null,
            updated_at = $3
        where id = $4 and password_reset_required = true
      `, [passwordHash, salt, changedAt, user.id]);
      const revoked = await client.query(`
        update refresh_token_sessions
        set revoked_at = $1
        where subject = $2 and revoked_at is null
      `, [changedAt, user.id]);
      revokedRefreshSessions = Number(revoked.rowCount || 0);
      const txQuery = (sql, params = []) => client.query(sql, params);
      await log('complete_required_password_reset', {
        message: '\u7528\u6237\u5df2\u5b8c\u6210\u7ba1\u7406\u5458\u91cd\u7f6e\u540e\u7684\u5f3a\u5236\u6539\u5bc6',
        refresh_sessions_revoked: revokedRefreshSessions
      }, user, null, user.id, txQuery);
    });

    return ok({
      message: '\u65b0\u5bc6\u7801\u5df2\u751f\u6548\uff0c\u8bf7\u4f7f\u7528\u65b0\u5bc6\u7801\u91cd\u65b0\u767b\u5f55\u3002',
      refresh_sessions_revoked: revokedRefreshSessions,
      password_reset_required: false
    });
  }
  function deleteOperationError(message, status = 400, code = 2001) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
  }

  function normalizeDeleteIds(value, fieldName) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
      throw deleteOperationError(`${fieldName} must contain between 1 and 100 ids.`);
    }
    const ids = value.map((id) => {
      if (typeof id !== 'string' || !id.trim() || id.trim().length > 60) {
        throw deleteOperationError(`${fieldName} contains an invalid id.`);
      }
      return id.trim();
    });
    if (new Set(ids).size !== ids.length) {
      throw deleteOperationError(`${fieldName} must not contain duplicate ids.`);
    }
    return ids;
  }

  async function requireSuperAdminForDeletion(token) {
    const { admin } = await requireAdminRole(token, ['super_admin'], []);
    if (!isSuperAdminOperator(admin)) {
      throw deleteOperationError('\u53ea\u6709\u6700\u9ad8\u6743\u9650\u7ba1\u7406\u5458\u53ef\u4ee5\u5220\u9664\u7528\u6237\u3002', 403, 1003);
    }
    return admin;
  }

  async function deleteUsersByIds(userIds, admin) {
    const linkedChecks = [
      ['reservations', 'user_id'],
      ['borrow_records', 'user_id'],
      ['device_fault_reports', 'user_id'],
      ['reservation_batches', 'user_id'],
      ['reservation_items', 'user_id'],
      ['usage_log', 'user_id'],
      ['user_activity_logs', 'user_id']
    ];

    return withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      const targets = [];
      for (const userId of userIds) {
        const locked = await client.query('select * from users where id = $1 for update', [userId]);
        const user = locked.rows?.[0];
        if (!user) throw deleteOperationError('\u7528\u6237\u4e0d\u5b58\u5728\u3002', 404, 3004);
        const assignedResult = await client.query('select role_key, permissions from admin_roles where user_id = $1 limit 1 for update', [userId]);
        const assignedRole = assignedResult.rows?.[0] || {};
        if (user.role === 'super_admin' || isHighestAdminOperator({}, assignedRole)) {
          throw deleteOperationError('\u4e0d\u80fd\u5220\u9664\u6700\u9ad8\u6743\u9650\u7ba1\u7406\u5458\u3002', 403, 1003);
        }
        if (isSelfTarget(admin, user)) {
          throw deleteOperationError('\u4e0d\u80fd\u5220\u9664\u5f53\u524d\u767b\u5f55\u7684\u7ba1\u7406\u5458\u8d26\u53f7\u3002', 403, 1003);
        }
        targets.push({ userId, user });
      }

      const results = [];
      for (const { userId } of targets) {
        let linkedCount = 0;
        for (const [table, column] of linkedChecks) {
          const countResult = await client.query(`select count(*)::int as count from ${table} where ${column} = $1`, [userId]);
          linkedCount += Number(countResult.rows?.[0]?.count || 0);
        }

        await client.query('delete from admin_roles where user_id = $1', [userId]);
        await client.query('delete from user_roles where user_id = $1', [userId]);
        if (linkedCount > 0) {
          await client.query(`
            update users
            set status = $1,
                is_banned = true,
                wechat_openid = null,
                wechat_nickname = null,
                password_hash = '',
                password_salt = '',
                updated_at = $2
            where id = $3
          `, ['disabled', nowIso(), userId]);
          await log('disable_user', {
            message: '\u7528\u6237\u5b58\u5728\u5173\u8054\u5386\u53f2\uff0c\u5df2\u505c\u7528\u5e76\u64a4\u9500\u7ba1\u7406\u6743\u9650',
            linked_count: linkedCount
          }, admin, null, userId, txQuery);
        } else {
          await client.query('delete from user_activity_logs where user_id = $1', [userId]);
          await client.query('delete from users where id = $1', [userId]);
          await log('delete_user', { message: '\u7528\u6237\u5df2\u5220\u9664', linked_count: 0 }, admin, null, userId, txQuery);
        }
        results.push({ user_id: userId, soft_deleted: linkedCount > 0, linked_count: linkedCount });
      }
      return results;
    });
  }

  async function adminDeleteUser(payload, token) {
    const admin = await requireSuperAdminForDeletion(token);
    const userIds = normalizeDeleteIds([payload.user_id], 'user_ids');
    const [result] = await deleteUsersByIds(userIds, admin);
    return ok({
      message: result.soft_deleted ? '\u7528\u6237\u5b58\u5728\u5173\u8054\u8bb0\u5f55\uff0c\u5df2\u6539\u4e3a\u505c\u7528\u3002' : '\u7528\u6237\u5df2\u5220\u9664\u3002',
      ...result
    });
  }

  async function adminDeleteUsers(payload, token) {
    const admin = await requireSuperAdminForDeletion(token);
    const userIds = normalizeDeleteIds(payload.user_ids, 'user_ids');
    const results = await deleteUsersByIds(userIds, admin);
    return ok({
      message: '\u7528\u6237\u6279\u91cf\u5220\u9664\u5df2\u5b8c\u6210\u3002',
      requested_count: userIds.length,
      deleted_count: results.filter((item) => !item.soft_deleted).length,
      soft_deleted_count: results.filter((item) => item.soft_deleted).length,
      deleted_ids: userIds,
      failed_ids: [],
      results
    });
  }

  async function adminSetUserStatus(payload, token) {
    const { admin, role } = await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage', 'user.approve']);
    const userId = assertText(payload.user_id, 'user_id', 60);
    const status = assertText(payload.status, 'status', 20);
    const reason = String(payload.reason ?? payload.admin_note ?? payload.disabled_reason ?? '').trim().slice(0, 500);
    if (!['active', 'disabled', 'pending', 'rejected'].includes(status)) return fail('用户状态不正确。', 400, 2001);
    if (status === 'rejected' && !reason) return fail('请填写驳回原因。', 400, 2001);
    const user = await getById('users', userId);
    if (!user) return fail('用户不存在。', 404, 3004);
    const denied = ensureCanModifyUser(admin, user);
    if (denied) return denied;
    const granted = Array.isArray(role?.permissions) ? role.permissions : [];
    const canManageUsers = admin.role === 'super_admin' || admin.admin_role_key === 'super_admin' || granted.includes('*') || granted.includes('user.manage');
    if (!canManageUsers && (!['pending', 'rejected'].includes(user.status) || !['active', 'rejected'].includes(status))) {
      return fail('\u7528\u6237\u5ba1\u6838\u6743\u9650\u4ec5\u53ef\u901a\u8fc7\u6216\u9a73\u56de\u5f85\u5ba1\u6838\u8d26\u53f7\u3002', 403, 1003);
    }
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      const changedAt = nowIso();
      if (status === 'active') {
        await client.query('update users set status = $1, disabled_reason = null, approved_by = $2, approved_at = $3, updated_at = $3 where id = $4', [
          status, admin.user_id || admin.id || null, changedAt, userId
        ]);
        await addUserToManagementGroup(userId, txQuery);
        if (typeof createUserNotification === 'function') {
          await createUserNotification({
            user_id: userId,
            type: 'account_review',
            title: '账号审核已通过',
            content: '你的账号已通过管理员审核，现在可以预约和使用设备。'
          }, txQuery);
        }
      } else {
        const disabledReason = status === 'pending' ? null : (reason || null);
        await client.query('update users set status = $1, disabled_reason = $2, approved_by = null, approved_at = null, updated_at = $3 where id = $4', [
          status, disabledReason, changedAt, userId
        ]);
        await removeUserFromManagementGroup(userId, txQuery);
        if (typeof createUserNotification === 'function' && status === 'rejected') {
          await createUserNotification({
            user_id: userId,
            type: 'account_review',
            title: '账号审核未通过',
            content: `你的账号审核未通过。原因：${reason}`
          }, txQuery);
        }
      }
      await log('set_user_status', { message: `用户状态已更新为 ${status}`, status, reason: reason || null }, admin, null, userId, txQuery);
    });
    return ok({ message: '用户状态已更新。' });
  }

  async function adminSetUserBan(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage']);
    const userId = assertText(payload.user_id, 'user_id', 60);
    const banned = parseBoolean(payload.is_banned ?? payload.banned);
    const user = await getById('users', userId);
    if (!user) return fail('用户不存在。', 404, 3004);
    const denied = ensureCanModifyUser(admin, user);
    if (denied) return denied;
    await query('update users set is_banned = $1, updated_at = $2 where id = $3', [banned, nowIso(), userId]);
    await log('set_user_ban', banned ? 'Banned user account' : 'Unbanned user account', admin, null, userId);
    return ok({ message: banned ? '用户已禁用。' : '用户已解除禁用。' });
  }

  async function adminUnbindWechat(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage']);
    const userId = assertText(payload.user_id, 'user_id', 60);
    const user = await getById('users', userId);
    if (!user) return fail('用户不存在。', 404, 3004);
    const denied = ensureCanModifyUser(admin, user);
    if (denied) return denied;
    await query('update users set wechat_openid = null, wechat_nickname = null, updated_at = $1 where id = $2', [nowIso(), userId]);
    await log('unbind_wechat', 'Removed WeChat binding', admin, null, userId);
    return ok({ message: '微信绑定已解除。' });
  }

  return {
    adminDeleteUser,
    adminDeleteUsers,
    adminGetUserDetail,
    adminGetRegistrationApprovalCode,
    adminRefreshRegistrationApprovalCode,
    adminUpdateRegistrationApprovalCodeTtl,
    adminListUsers,
    adminSetUserBan,
    adminSetUserStatus,
    adminUnbindWechat,
    adminResetUserPassword,
    completeRequiredPasswordReset,
    getProfile,
    listMyNotifications,
    markMyNotificationsRead
  };
}

module.exports = { createUserService };
