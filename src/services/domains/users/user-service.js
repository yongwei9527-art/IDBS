function createUserService(context = {}) {
  const {
    addNamesToBorrowRows,
    addUserToManagementGroup,
    assertText,
    createUserNotification,
    db,
    fail,
    getById,
    log,
    nowIso,
    ok,
    parseBoolean,
    query,
    queryOne,
    removeUserFromManagementGroup,
    requireAdminRole,
    requireUser,
    safeUser,
    withTransaction
  } = context;

  async function getProfile(token) {
    const user = await requireUser(token);
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
    const reservations = await query(`
      select ri.*, ri.id as item_id, coalesce(ri.reservation_id, ri.id) as id,
        b.purpose, b.status as batch_status,
        d.device_code, d.name as device_name,
        u.name as user_name, u.phone as user_phone, u.student_no as user_student_no
      from reservation_items ri
      join reservation_batches b on b.id = ri.batch_id
      join devices d on d.id = ri.device_id
      join users u on u.id = ri.user_id
      where ri.user_id = $1
      order by ri.created_at desc
      limit 50
    `, [userId]);
    const borrows = await addNamesToBorrowRows(await query('select * from borrow_records where user_id = $1 order by borrow_time desc limit 50', [userId]));
    const faultReports = await query(`
      select f.*, d.device_code, d.name as device_name
      from device_fault_reports f
      left join devices d on d.id = f.device_id
      where f.user_id = $1
      order by f.created_at desc
      limit 50
    `, [userId]);
    const requests = await query(`
      select r.*, d.device_code, d.name as device_name
      from user_requests r
      left join devices d on d.id = r.device_id
      where r.user_id = $1
      order by r.created_at desc
      limit 50
    `, [userId]);
    const activity = await query('select * from user_activity_logs where user_id = $1 order by created_at desc limit 20', [userId]);
    return ok({ user: safeUser(user), reservations, borrows, fault_reports: faultReports || [], requests: requests || [], activity: activity || [] });
  }

  async function adminListUsers(_, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage', 'user.approve']);
    const data = await query('select * from users order by created_at desc');
    return ok({ users: (data || []).map(safeUser) });
  }

  function isSuperAdminOperator(admin = {}) {
    return admin.role === 'super_admin' || admin.admin_role_key === 'super_admin';
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

  async function adminDeleteUser(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage']);
    const userId = assertText(payload.user_id, 'user_id', 60);
    const user = await getById('users', userId);
    if (!user) return fail('用户不存在。', 404, 3004);
    if (user.role === 'super_admin') return fail('不能删除最高权限管理员。', 403, 1003);
    const denied = ensureCanModifyUser(admin, user);
    if (denied) return denied;
    const linkedChecks = [
      ['reservations', 'user_id'],
      ['borrow_records', 'user_id'],
      ['device_fault_reports', 'user_id'],
      ['reservation_batches', 'user_id'],
      ['reservation_items', 'user_id'],
      ['usage_log', 'user_id'],
      ['user_activity_logs', 'user_id']
    ];
    let linkedCount = 0;
    for (const [table, column] of linkedChecks) {
      const row = await queryOne(`select count(*)::int as count from ${table} where ${column} = $1`, [userId]);
      linkedCount += Number(row?.count || 0);
    }

    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
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
        await log('disable_user', `Disabled user with ${linkedCount} linked records: ${user.name || user.phone || userId}`, admin, null, userId, txQuery);
        return;
      }
      await client.query('delete from user_activity_logs where user_id = $1', [userId]);
      await client.query('delete from users where id = $1', [userId]);
      await log('delete_user', `Deleted user ${user.name || user.phone || userId}`, admin, null, userId, txQuery);
    });
    return ok({ message: linkedCount > 0 ? '用户存在关联记录，已改为停用。' : '用户已删除。', soft_deleted: linkedCount > 0, linked_count: linkedCount });
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
    adminGetUserDetail,
    adminListUsers,
    adminSetUserBan,
    adminSetUserStatus,
    adminUnbindWechat,
    getProfile,
    listMyNotifications,
    markMyNotificationsRead
  };
}

module.exports = { createUserService };

