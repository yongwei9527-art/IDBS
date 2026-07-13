const { AppError } = require('../../lib/app-error');

const FIELD_LABELS = {
  batch_id: '预约批次',
  code: '验证码',
  content: '内容',
  conversation_id: '会话',
  date: '日期',
  description: '说明',
  device_code: '设备编号',
  device_id: '设备',
  id: '记录',
  name: '名称',
  new_admin_password: '管理员入口密码',
  openid: '微信身份',
  password: '密码',
  phone: '手机号',
  reason: '原因',
  record_id: '使用记录',
  report_id: '故障记录',
  request_id: '诉求记录',
  reservation_id: '预约记录',
  reservation_item_id: '预约设备',
  role_key: '管理员角色',
  status: '状态',
  student_no: '学号/工号',
  temp_code: '临时验证码',
  title: '标题',
  user_id: '用户'
};

function fieldLabel(label) {
  return FIELD_LABELS[label] || String(label || '字段').replace(/_/g, ' ');
}

function assertText(value, label, max = 200) {
  const text = String(value || '').trim();
  const readable = fieldLabel(label);
  if (!text) throw new AppError(`${readable}不能为空。`, { status: 400, code: 2001 });
  if (text.length > max) throw new AppError(`${readable}不能超过 ${max} 个字符。`, { status: 400, code: 2001 });
  return text;
}

function assertPhone(value) {
  const phone = assertText(value, 'phone', 20);
  if (!/^\+?[0-9-]{6,20}$/.test(phone)) {
    throw new AppError('手机号格式不正确。', { status: 400, code: 2001 });
  }
  return phone;
}

function assertOptionalEmail(value) {
  const email = String(value || '').trim();
  if (!email) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('邮箱格式不正确。', { status: 400, code: 2001 });
  }
  return email.slice(0, 120);
}

function assertPassword(value) {
  const password = assertText(value, 'password', 100);
  if (password.length < 6) {
    throw new AppError('密码至少需要 6 位。', { status: 400, code: 2001 });
  }
  return password;
}

module.exports = {
  assertOptionalEmail,
  assertPassword,
  assertPhone,
  assertText
};
