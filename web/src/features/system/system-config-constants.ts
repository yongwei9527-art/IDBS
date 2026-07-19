import type { StaffContact } from '@/features/platform/operations-api';

export const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '实验室主管',
  reservation_admin: '预约管理员',
  equipment_admin: '设备管理员',
  duty_admin: '值班管理员',
  analyst: '运营分析员',
  auditor: '审计员'
};

export const STAFF_CONTACT_PRESETS: StaffContact[] = [
  { key: 'admin', label: '管理员（系统维护）', description: '系统登录、账号权限、平台异常与维护' },
  { key: 'reservation', label: '管理员（预约与取消）', description: '预约申请、取消调整、审核进度与排期协调' },
  { key: 'fault', label: '设备维修员', description: '设备故障、维修处理、异常恢复与现场检查' },
  { key: 'usage', label: '值班管理员（紧急联系）', description: '紧急情况、现场协助、无法归类的问题' }
];

export type SecurityForm = {
  captcha_expire_minutes: string;
  captcha_hourly_limit: string;
  openid_daily_register_limit: string;
  enable_image_captcha: boolean;
  require_return_photo: boolean;
  block_ip_access_enabled: boolean;
  public_show_reserver_name: boolean;
  public_show_reserver_phone: boolean;
  public_show_reserver_student_no: boolean;
  site_domain: string;
  system_notice_enabled: boolean;
  system_notice_title: string;
  system_notice_content: string;
  admin_report_enabled: boolean;
  admin_report_hour: string;
  admin_report_minute: string;
  admin_report_timezone: string;
  wechat_token: string;
  wechat_app_id: string;
  wechat_app_secret: string;
  wechat_admin_openids: string;
};

export type EditRole = { user_id: string; role_key: string; note: string; permissions: string[] };
export type SystemSectionKey = 'overview' | 'security' | 'wechat' | 'reports' | 'roles';

export const emptySecurityForm: SecurityForm = {
  captcha_expire_minutes: '3',
  captcha_hourly_limit: '3',
  openid_daily_register_limit: '1',
  enable_image_captcha: false,
  require_return_photo: true,
  block_ip_access_enabled: false,
  public_show_reserver_name: true,
  public_show_reserver_phone: true,
  public_show_reserver_student_no: false,
  site_domain: '',
  system_notice_enabled: true,
  system_notice_title: '使用注意事项',
  system_notice_content: '',
  admin_report_enabled: false,
  admin_report_hour: '9',
  admin_report_minute: '0',
  admin_report_timezone: 'Asia/Shanghai',
  wechat_token: '',
  wechat_app_id: '',
  wechat_app_secret: '',
  wechat_admin_openids: ''
};
