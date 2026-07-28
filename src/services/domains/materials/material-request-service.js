function normalizeMaterialRequest(row = {}) {
  const status = String(row.status || 'pending');
  return {
    ...row,
    quantity: Number(row.quantity),
    can_cancel: status === 'pending',
    can_review: status === 'pending' || status === 'approved',
    is_final: ['rejected', 'fulfilled', 'cancelled'].includes(status)
  };
}

function createMaterialRequestService(context = {}) {
  const {
    assertText,
    createUserNotification,
    fail,
    getById,
    log,
    nowIso,
    ok,
    query,
    requireAdminRole,
    requireUser,
    uuid,
    withTransaction
  } = context;

  function parseQuantity(value) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return null;
    return Number(quantity.toFixed(3));
  }

  async function createMaterialRequest(payload, token) {
    const user = await requireUser(token);
    const itemName = assertText(payload.item_name || payload.itemName || payload.name, 'item_name', 120);
    const quantity = parseQuantity(payload.quantity);
    if (quantity === null) return fail('材料数量必须是 0 到 1,000,000 之间的有效数字。', 400, 2001);
    const unit = assertText(payload.unit, 'unit', 30);
    const purpose = String(payload.purpose || payload.note || '').trim().slice(0, 1000);
    const row = {
      id: uuid(), user_id: user.id, item_name: itemName, quantity, unit, purpose: purpose || null,
      status: 'pending', created_at: nowIso(), updated_at: nowIso()
    };
    await query(
      'insert into material_requests (id, user_id, item_name, quantity, unit, purpose, status, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [row.id, row.user_id, row.item_name, row.quantity, row.unit, row.purpose, row.status, row.created_at, row.updated_at]
    );
    await log('create_material_request', { material_request_id: row.id, item_count: 1, quantity: row.quantity }, user, null, row.id);
    return ok({ message: '材料清单申请已提交，等待管理员处理。', request: normalizeMaterialRequest(row) });
  }

  async function listMyMaterialRequests(_, token) {
    const user = await requireUser(token);
    const rows = await query(
      'select id, user_id, item_name, quantity, unit, purpose, status, admin_note, reviewed_at, fulfilled_at, created_at, updated_at from material_requests where user_id = $1 order by created_at desc',
      [user.id]
    );
    return ok({ requests: (rows || []).map(normalizeMaterialRequest) });
  }

  async function cancelMaterialRequest(payload, token) {
    const user = await requireUser(token);
    const requestId = assertText(payload.request_id || payload.id, 'request_id', 60);
    const row = await getById('material_requests', requestId);
    if (!row) return fail('材料申请不存在。', 404, 3004);
    if (row.user_id !== user.id) return fail('不能撤回其他用户的材料申请。', 403, 1003);
    if (row.status !== 'pending') return fail('材料申请开始处理后不能撤回。', 409, 3001);
    const now = nowIso();
    await query('update material_requests set status = $1, updated_at = $2 where id = $3 and status = $4', ['cancelled', now, requestId, 'pending']);
    await log('cancel_material_request', { material_request_id: row.id }, user, null, row.id);
    return ok({ message: '材料清单申请已撤回。' });
  }

  async function adminListMaterialRequests(params, token) {
    await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage']);
    const status = String(params?.status || '').trim();
    const sqlParams = [];
    let where = '';
    if (status) {
      if (!['pending', 'approved', 'rejected', 'fulfilled', 'cancelled'].includes(status)) return fail('不支持的材料申请状态。', 400, 2001);
      sqlParams.push(status);
      where = 'where r.status = $1';
    }
    const rows = await query(
      'select r.*, u.name as user_name, u.student_no as user_student_no from material_requests r join users u on u.id = r.user_id ' + where + ' order by r.created_at desc',
      sqlParams
    );
    return ok({ requests: (rows || []).map(normalizeMaterialRequest) });
  }

  async function adminReviewMaterialRequest(payload, token) {
    const { admin } = await requireAdminRole(token, ['super_admin', 'admin'], ['user.manage']);
    const requestId = assertText(payload.request_id || payload.id, 'request_id', 60);
    const status = String(payload.status || '').trim();
    if (!['approved', 'rejected', 'fulfilled'].includes(status)) return fail('材料申请只能批准、驳回或标记为已发放。', 400, 2001);
    const adminNote = String(payload.admin_note || payload.adminNote || '').trim().slice(0, 500) || null;
    const row = await getById('material_requests', requestId);
    if (!row) return fail('材料申请不存在。', 404, 3004);
    if (['rejected', 'fulfilled', 'cancelled'].includes(row.status)) return fail('该材料申请已结束，不能再次处理。', 409, 3001);
    if (status === 'fulfilled' && row.status !== 'approved') return fail('请先批准材料申请，再标记为已发放。', 409, 3001);
    const now = nowIso();
    await withTransaction(async (client) => {
      const txQuery = (sql, params = []) => client.query(sql, params);
      await txQuery(
        "update material_requests set status=$1, admin_note=$2, reviewed_by=$3, reviewed_at=case when $1 in ('approved','rejected') then $4 else reviewed_at end, fulfilled_by=case when $1='fulfilled' then $3 else fulfilled_by end, fulfilled_at=case when $1='fulfilled' then $4 else fulfilled_at end, updated_at=$4 where id=$5",
        [status, adminNote, admin.user_id || admin.id || null, now, row.id]
      );
      const statusText = status === 'approved' ? '已批准' : status === 'rejected' ? '已驳回' : '已发放';
      await createUserNotification({
        user_id: row.user_id, type: 'material_request', title: '材料清单申请已更新',
        content: '你的材料清单申请已' + statusText + '。', related_type: 'material_request', related_id: row.id,
        level: status === 'rejected' ? 'warning' : 'info'
      }, txQuery);
      await log('review_material_request', { material_request_id: row.id, status }, admin, null, row.id, txQuery);
    });
    return ok({ message: status === 'fulfilled' ? '材料申请已标记为发放完成。' : '材料申请处理结果已保存。', status });
  }

  return { adminListMaterialRequests, adminReviewMaterialRequest, cancelMaterialRequest, createMaterialRequest, listMyMaterialRequests };
}

module.exports = { createMaterialRequestService, normalizeMaterialRequest };
