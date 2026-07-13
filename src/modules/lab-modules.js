/**
 * Laboratory business module registry.
 * One source of truth for administrator permission catalog and role templates.
 */
const MODULES = [
  {
    key: 'users', label: '用户与准入', description: '处理用户注册审核、账号状态与预约资格。',
    permissions: [
      { key: 'user.approve', label: '审核用户注册' },
      { key: 'user.manage', label: '管理用户、封禁与删除' }
    ]
  },
  {
    key: 'reservations', label: '预约与排期', description: '查看、审批和调整实验室设备预约。',
    permissions: [
      { key: 'reservation.view', label: '查看预约记录' },
      { key: 'reservation.approve', label: '审批预约与当天取消申请' },
      { key: 'reservation.change_plan', label: '调整预约计划' }
    ]
  },
  {
    key: 'returns', label: '借还与归还验收', description: '处理归还记录、照片复核和归档导出。',
    permissions: [
      { key: 'return.view', label: '查看归还记录' },
      { key: 'return.confirm', label: '确认设备归还' },
      { key: 'return.image_review', label: '复核归还照片' },
      { key: 'return.export', label: '导出归还归档' }
    ]
  },
  {
    key: 'equipment', label: '设备与维护', description: '维护设备资料、可预约状态和维修安排。',
    permissions: [
      { key: 'device.view', label: '查看设备管理信息' },
      { key: 'device.manage', label: '管理设备与维护计划' },
      { key: 'fault.manage', label: '处理故障报备' }
    ]
  },
  {
    key: 'analytics', label: '运营分析与导出', description: '查看实验室运营数据并导出业务报表。',
    permissions: [
      { key: 'stats.view', label: '查看运营分析' },
      { key: 'stats.export', label: '导出运营数据' }
    ]
  },
  {
    key: 'audit', label: '安全与审计', description: '查看关键操作留痕与风险处置记录。',
    permissions: [
      { key: 'audit.view', label: '查看操作审计日志' }
    ]
  },
  {
    key: 'communication', label: '通知与协作', description: '在实验室协作群内发布通知和维持秩序。',
    permissions: [
      { key: 'chat.announce', label: '群发公告与 @全体成员' },
      { key: 'chat.kick', label: '移除群成员与暂停预约资格' }
    ]
  }
];

const PERMISSION_OPTIONS = MODULES.flatMap((module) => module.permissions.map((permission) => ({
  ...permission,
  module: module.key,
  module_label: module.label,
  module_description: module.description
})));
const PERMISSION_KEYS = new Set(PERMISSION_OPTIONS.map((permission) => permission.key));
const ALL_ASSIGNABLE_PERMISSIONS = PERMISSION_OPTIONS.map((permission) => permission.key);

const ROLE_PERMISSIONS = {
  super_admin: ['*'],
  admin: ALL_ASSIGNABLE_PERMISSIONS,
  reservation_admin: ['reservation.view', 'reservation.approve', 'reservation.change_plan'],
  equipment_admin: ['device.view', 'device.manage', 'fault.manage', 'return.view', 'return.confirm', 'return.image_review', 'return.export'],
  duty_admin: ['reservation.view', 'reservation.approve', 'return.view', 'return.confirm', 'return.image_review', 'device.view', 'fault.manage'],
  analyst: ['stats.view', 'stats.export', 'reservation.view', 'device.view'],
  auditor: ['audit.view', 'reservation.view', 'return.view', 'device.view']
};

function permissionModules() {
  return MODULES.map((module) => ({
    key: module.key,
    label: module.label,
    description: module.description,
    permissions: PERMISSION_OPTIONS.filter((permission) => permission.module === module.key)
  }));
}

module.exports = { ALL_ASSIGNABLE_PERMISSIONS, MODULES, PERMISSION_KEYS, PERMISSION_OPTIONS, ROLE_PERMISSIONS, permissionModules };
