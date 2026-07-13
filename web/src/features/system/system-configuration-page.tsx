import { briefDateTime } from '@/lib/time-format';
import { useEffect, useMemo, useState } from 'react';
import {
  type DailyReportPreview,
  useAdminRuntimeDiagnostics,
  type PermissionModule,
  type RoleRow,
  type StaffContact,
  useAdminActivitySummary,
  useAdminRoles,
  useAdminSecurityConfig,
  useAdminUsers,
  usePreviewDailyReport,
  useRevokeRole,
  useSendDailyReport,
  useUpdateSecurityConfig,
  useUpsertRole
} from '@/features/platform/operations-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CompactId } from '@/components/ui/compact-id';
import { uploadImage } from '@/lib/api';
import { toast } from 'sonner';
import { PERMISSION_LABELS } from '@/features/auth/permissions';
import { useAuth } from '@/features/auth/use-auth';
import { toFriendlyError } from '@/lib/friendly-error';
import { OpsPageHeader, OpsPermissionHint } from '@/components/ops/design-system';

const ROLE_LABELS: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '实验室主管',
  reservation_admin: '预约管理员',
  equipment_admin: '设备管理员',
  duty_admin: '值班管理员',
  analyst: '运营分析员',
  auditor: '审计员'
};

const STAFF_CONTACT_PRESETS: StaffContact[] = [
  { key: 'admin', label: '管理员（系统维护）', description: '系统登录、账号权限、平台异常与维护' },
  { key: 'reservation', label: '管理员（预约与取消）', description: '预约申请、取消调整、审核进度与排期协调' },
  { key: 'fault', label: '设备维修员', description: '设备故障、维修处理、异常恢复与现场检查' },
  { key: 'usage', label: '值班管理员（紧急联系）', description: '紧急情况、现场协助、无法归类的问题' }
];

type SecurityForm = {
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

type EditRole = { user_id: string; role_key: string; note: string; permissions: string[] };
type SystemSectionKey = 'overview' | 'security' | 'wechat' | 'reports' | 'roles';

const emptyForm: SecurityForm = {
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
  system_notice_title: '',
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

function asText(value: unknown, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function asBool(value: unknown, fallback = false) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

function numberValue(value: string, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeContacts(contacts?: StaffContact[]) {
  const byKey = new Map((contacts ?? []).map((item) => [item.key, item]));
  return STAFF_CONTACT_PRESETS.map((preset) => ({
    ...preset,
    ...(byKey.get(preset.key) ?? {}),
    enabled: byKey.has(preset.key) ? byKey.get(preset.key)?.enabled !== false : true,
    qrcode_url: asText(byKey.get(preset.key)?.qrcode_url)
  }));
}

function normalizePermissions(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function permissionModuleSummary(permissions: string[], modules: PermissionModule[]) {
  if (permissions.includes('*')) return ['全部业务模块'];
  return modules
    .map((module) => {
      const enabledCount = module.permissions.filter((permission) => permissions.includes(permission.key)).length;
      if (!enabledCount) return null;
      return enabledCount === module.permissions.length
        ? module.label
        : `${module.label}（${enabledCount}/${module.permissions.length}）`;
    })
    .filter((item): item is string => Boolean(item));
}

function maskedOpenId(openid?: string) {
  if (!openid) return '-';
  return openid.length > 8 ? `${openid.slice(0, 4)}...${openid.slice(-4)}` : openid;
}

function fmtTime(value?: string) {
  if (!value) return '-';
  return briefDateTime(value);
}

const ACTIVITY_EVENT_LABEL: Record<string, string> = {
  login: '登录',
  logout: '退出登录',
  password_login: '密码登录',
  wechat_login: '微信登录',
  register: '注册',
  bind_wechat: '绑定微信',
  unbind_wechat: '解绑微信',
  update_profile: '更新资料'
};

function activityText(value?: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  let text = String(value);
  Object.entries(ACTIVITY_EVENT_LABEL).forEach(([key, label]) => {
    text = text.replace(new RegExp('\\b' + key + '\\b', 'g'), label);
  });
  return text;
}

function systemText(value?: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  let text = String(value);
  Object.entries(PERMISSION_LABELS).forEach(([key, label]) => {
    if (key === '*') return;
    text = text.split(key).join(label);
  });
  Object.entries(ROLE_LABELS).forEach(([key, label]) => {
    text = text.replace(new RegExp('\\b' + key + '\\b', 'g'), label);
  });
  return activityText(text);
}

export function AdminSystemPage() {
  const { me } = useAuth();
  const { data, isLoading } = useAdminSecurityConfig();
  const update = useUpdateSecurityConfig();
  const { data: activityData } = useAdminActivitySummary();
  const { data: runtimeData, isLoading: isRuntimeLoading } = useAdminRuntimeDiagnostics();
  const { data: rolesData, refetch: refetchRoles } = useAdminRoles();
  const { data: users = [] } = useAdminUsers();
  const upsertRole = useUpsertRole();
  const revokeRole = useRevokeRole();
  const previewReport = usePreviewDailyReport();
  const sendReport = useSendDailyReport();

  const [form, setForm] = useState<SecurityForm>(emptyForm);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [staffContacts, setStaffContacts] = useState<StaffContact[]>(normalizeContacts());
  const [contactFiles, setContactFiles] = useState<Record<string, File | undefined>>({});
  const [contactPreviews, setContactPreviews] = useState<Record<string, string>>({});
  const [reportPreviewText, setReportPreviewText] = useState('');
  const [reportPreview, setReportPreview] = useState<DailyReportPreview | null>(null);
  const [editRole, setEditRole] = useState<EditRole>({ user_id: '', role_key: 'admin', note: '', permissions: [] });
  const [activeSection, setActiveSection] = useState<SystemSectionKey>('overview');

  const cfg = data?.config;
  const roleDefaults = rolesData?.role_defaults ?? {};
  const permissionOptions = rolesData?.permissions ?? [];
  const permissionModules = rolesData?.permission_modules?.length
    ? rolesData.permission_modules
    : [{ key: 'other', label: '其他权限', description: '', permissions: permissionOptions }];
  const selectedPermissions = editRole.permissions;
  const roleCount = rolesData?.roles?.length ?? 0;
  const contactEnabledCount = staffContacts.filter((item) => item.enabled !== false).length;
  const currentUserId = String(me?.id ?? '');

  function isSelfUser(userId?: string) {
    return Boolean(currentUserId && userId && String(userId) === currentUserId);
  }

  const activityCards = useMemo(() => {
    const summary = activityData?.summary ?? {};
    return [
      ['今日注册', summary.registered_today ?? 0],
      ['今日登录', summary.logged_in_today ?? 0],
      ['今日微信绑定', summary.wechat_bind_today ?? 0],
      ['今日微信验证', summary.wechat_scan_today ?? 0]
    ] as const;
  }, [activityData]);

  const sectionCards = useMemo(
    () => [
      {
        key: 'overview' as const,
        title: '运营概览',
        desc: '今日注册、登录、微信绑定与最近活动',
        metric: `${activityCards.reduce((sum, [, value]) => sum + Number(value || 0), 0)} 条`,
        tone: 'from-blue-500/15'
      },
      {
        key: 'security' as const,
        title: '安全策略',
        desc: '密码、验证码、公告、隐私公开和归还照片',
        metric: form.require_return_photo ? '归还拍照' : '普通归还',
        tone: 'from-rose-500/15'
      },
      {
        key: 'wechat' as const,
        title: '微信与联系人',
        desc: '公众号密钥、管理员 OpenID、工作人员二维码',
        metric: `${contactEnabledCount}/${STAFF_CONTACT_PRESETS.length} 启用`,
        tone: 'from-emerald-500/15'
      },
      {
        key: 'reports' as const,
        title: '日报推送',
        desc: '智能运营日报预览、定时和立即发送',
        metric: form.admin_report_enabled ? `${form.admin_report_hour}:${String(form.admin_report_minute).padStart(2, '0')}` : '未启用',
        tone: 'from-amber-500/15'
      },
      {
        key: 'roles' as const,
        title: '角色授权',
        desc: '分权管理员、审计员、运营员权限矩阵',
        metric: `${roleCount} 人`,
        tone: 'from-violet-500/15'
      }
    ],
    [activityCards, contactEnabledCount, form.admin_report_enabled, form.admin_report_hour, form.admin_report_minute, form.require_return_photo, roleCount]
  );

  function sectionClass(key: SystemSectionKey) {
    return activeSection === key ? 'ops-card' : 'hidden';
  }

  useEffect(() => {
    if (!cfg) return;
    setForm({
      captcha_expire_minutes: asText(cfg.captcha_expire_minutes, '3'),
      captcha_hourly_limit: asText(cfg.captcha_hourly_limit, '3'),
      openid_daily_register_limit: asText(cfg.openid_daily_register_limit, '1'),
      enable_image_captcha: asBool(cfg.enable_image_captcha),
      require_return_photo: asBool(cfg.require_return_photo, true),
      block_ip_access_enabled: asBool(cfg.block_ip_access_enabled),
      public_show_reserver_name: asBool(cfg.public_show_reserver_name, true),
      public_show_reserver_phone: asBool(cfg.public_show_reserver_phone, true),
      public_show_reserver_student_no: asBool(cfg.public_show_reserver_student_no),
      site_domain: asText(cfg.site_domain),
      system_notice_enabled: asBool(cfg.system_notice_enabled, true),
      system_notice_title: asText(cfg.system_notice_title),
      system_notice_content: asText(cfg.system_notice_content),
      admin_report_enabled: asBool(cfg.admin_report_enabled),
      admin_report_hour: asText(cfg.admin_report_hour, '9'),
      admin_report_minute: asText(cfg.admin_report_minute, '0'),
      admin_report_timezone: asText(cfg.admin_report_timezone, 'Asia/Shanghai'),
      wechat_token: asText(cfg.wechat_token),
      wechat_app_id: asText(cfg.wechat_app_id),
      wechat_app_secret: '',
      wechat_admin_openids: asText(cfg.wechat_admin_openids)
    });
    setStaffContacts(normalizeContacts(cfg.staff_contacts));
    setContactFiles({});
    setContactPreviews({});
  }, [cfg]);

  useEffect(() => {
    if (!Object.keys(roleDefaults).length || editRole.permissions.length || editRole.user_id) return;
    setEditRole((current) => ({ ...current, permissions: roleDefaults[current.role_key] ?? [] }));
  }, [editRole.permissions.length, editRole.role_key, editRole.user_id, roleDefaults]);

  function setField<K extends keyof SecurityForm>(key: K, value: SecurityForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save(patch: Record<string, unknown>, success = '已保存') {
    update.mutate(patch, {
      onSuccess: () => toast.success(success),
      onError: (e) => toast.error(`保存失败：${toFriendlyError(e)}`)
    });
  }

  function saveAdminPassword() {
    if (!newPassword || newPassword.length < 12) {
      toast.error('新管理员密码至少 12 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新管理员密码不一致');
      return;
    }
    update.mutate(
      { new_admin_password: newPassword },
      {
        onSuccess: () => {
          toast.success('管理员密码已更新');
          setNewPassword('');
          setConfirmPassword('');
        },
        onError: (e) => toast.error(`保存失败：${toFriendlyError(e)}`)
      }
    );
  }

  function saveNotice() {
    save({
      system_notice_enabled: form.system_notice_enabled,
      system_notice_title: form.system_notice_title,
      system_notice_content: form.system_notice_content
    }, '公告已保存');
  }

  function saveSecurity() {
    save({
      captcha_expire_minutes: numberValue(form.captcha_expire_minutes, 3),
      captcha_hourly_limit: numberValue(form.captcha_hourly_limit, 3),
      openid_daily_register_limit: numberValue(form.openid_daily_register_limit, 1),
      enable_image_captcha: form.enable_image_captcha,
      require_return_photo: form.require_return_photo,
      block_ip_access_enabled: form.block_ip_access_enabled,
      public_show_reserver_name: form.public_show_reserver_name,
      public_show_reserver_phone: form.public_show_reserver_phone,
      public_show_reserver_student_no: form.public_show_reserver_student_no,
      site_domain: form.site_domain.trim()
    }, '安全与公开设置已保存');
  }

  function saveWechat() {
    save({
      wechat_token: form.wechat_token.trim(),
      wechat_app_id: form.wechat_app_id.trim(),
      ...(form.wechat_app_secret.trim() ? { wechat_app_secret: form.wechat_app_secret.trim() } : {}),
      wechat_admin_openids: form.wechat_admin_openids.trim()
    }, '微信配置已保存');
    setField('wechat_app_secret', '');
  }

  function saveReportConfig() {
    save({
      admin_report_enabled: form.admin_report_enabled,
      admin_report_hour: numberValue(form.admin_report_hour, 9),
      admin_report_minute: numberValue(form.admin_report_minute, 0),
      admin_report_timezone: form.admin_report_timezone.trim() || 'Asia/Shanghai'
    }, '日报配置已保存');
  }

  async function saveStaffContacts() {
    try {
      const contacts = await Promise.all(staffContacts.map(async (contact) => {
        const file = contactFiles[contact.key];
        const qrcodeUrl = file ? await uploadImage(file) : asText(contact.qrcode_url);
        return { ...contact, qrcode_url: qrcodeUrl };
      }));
      await update.mutateAsync({ staff_contacts: contacts });
      setStaffContacts(contacts);
      setContactFiles({});
      setContactPreviews({});
      toast.success('工作人员联系方式已保存');
    } catch (e) {
      toast.error(`保存失败：${toFriendlyError(e)}`);
    }
  }

  function updateContact(key: string, patch: Partial<StaffContact>) {
    setStaffContacts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function selectContactFile(key: string, file?: File) {
    setContactFiles((current) => ({ ...current, [key]: file }));
    if (file) setContactPreviews((current) => ({ ...current, [key]: URL.createObjectURL(file) }));
  }

  function previewDailyReport() {
    previewReport.mutate(
      { timezone: form.admin_report_timezone },
      {
        onSuccess: (result) => {
          setReportPreview(result);
          setReportPreviewText(result.message || '暂无内容');
        },
        onError: (e) => toast.error(`预览失败：${toFriendlyError(e)}`)
      }
    );
  }

  function sendDailyReportNow() {
    sendReport.mutate(
      { timezone: form.admin_report_timezone },
      {
        onSuccess: (result) => {
          toast.success(`日报发送完成，成功 ${result.sent ?? 0} 条${result.failed ? `，失败 ${result.failed} 条` : ''}`);
          setReportPreview(result.message ? result as DailyReportPreview : null);
          setReportPreviewText(result.message || result.reason || '发送完成');
        },
        onError: (e) => toast.error(`发送失败：${toFriendlyError(e)}`)
      }
    );
  }

  function setRoleKey(roleKey: string) {
    setEditRole((current) => ({ ...current, role_key: roleKey, permissions: roleDefaults[roleKey] ?? [] }));
  }

  function togglePermission(permission: string, checked: boolean) {
    setEditRole((current) => {
      const permissions = checked
        ? [...new Set([...current.permissions, permission])]
        : current.permissions.filter((item) => item !== permission);
      return { ...current, permissions };
    });
  }

  function togglePermissionModule(permissionKeys: string[], checked: boolean) {
    setEditRole((current) => {
      const permissions = checked
        ? [...new Set([...current.permissions, ...permissionKeys])]
        : current.permissions.filter((item) => !permissionKeys.includes(item));
      return { ...current, permissions };
    });
  }

  function submitRole() {
    if (!editRole.user_id) return;
    if (isSelfUser(editRole.user_id)) {
      toast.error('不能修改自己的管理员角色或权限。');
      return;
    }
    upsertRole.mutate(
      { user_id: editRole.user_id, role_key: editRole.role_key, permissions: selectedPermissions.filter((item) => item !== '*'), note: editRole.note },
      {
        onSuccess: () => {
          toast.success('角色已更新');
          setEditRole({ user_id: '', role_key: 'admin', note: '', permissions: [] });
          refetchRoles();
        },
        onError: (e) => toast.error(`失败：${toFriendlyError(e)}`)
      }
    );
  }

  function editExistingRole(role: RoleRow) {
    if (isSelfUser(role.user_id)) {
      toast.error('为了防止监守自盗，不能编辑自己的管理员权限。');
      return;
    }
    setEditRole({
      user_id: role.user_id,
      role_key: role.role_key,
      note: role.note ?? '',
      permissions: normalizePermissions(role.permissions)
    });
  }

  function revoke(userId: string) {
    if (isSelfUser(userId)) {
      toast.error('不能撤销自己的管理员角色。');
      return;
    }
    revokeRole.mutate(userId, {
      onSuccess: () => { toast.success('已撤销'); refetchRoles(); },
      onError: (e) => toast.error(`失败：${toFriendlyError(e)}`)
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <OpsPageHeader
        eyebrow="SUPER ADMIN CONTROL"
        title="系统设置与授权中枢"
        description="集中维护安全、微信、日报、联系人和角色；高危修改会进入审计留痕。"
        aside={
          <OpsPermissionHint
            title="高危区提醒"
            permissions="修改关键配置前请确认影响范围，保存后建议查看审计日志。"
            className="border-white/10 bg-white/10 text-white"
          />
        }
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {sectionCards.map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => setActiveSection(section.key)}
            className={`rounded-2xl border bg-gradient-to-br ${section.tone} to-card p-4 text-left shadow-sm transition hover:-translate-y-px hover:border-primary/40 hover:shadow-md ${
              activeSection === section.key ? 'border-primary ring-2 ring-primary/15' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black">{section.title}</p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{section.desc}</p>
              </div>
              <span className="shrink-0 rounded-full bg-background/80 px-2 py-1 text-xs font-bold text-primary shadow-sm">{section.metric}</span>
            </div>
          </button>
        ))}
      </section>

      <Card className={sectionClass('overview')}>
        <CardHeader><CardTitle className="text-sm">今日运营概览</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-4">
            {activityCards.map(([label, value]) => (
              <div key={label} className="rounded-md border bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-1 text-2xl font-bold">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">{'5.0 \u8fd0\u884c\u72b6\u6001'}</div>
                <div className="mt-1 text-xs text-muted-foreground">{'\u4ec5\u5c55\u793a\u8131\u654f\u8fd0\u884c\u6307\u6807\uff0c\u4e0d\u5305\u542b\u6570\u636e\u5e93\u5730\u5740\u3001\u8d26\u53f7\u6216\u5bc6\u94a5\u3002'}</div>
              </div>
              <span className={runtimeData?.readiness?.status === 'ready' ? 'rounded bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-700' : 'rounded bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-700'}>
                {isRuntimeLoading ? '\u68c0\u6d4b\u4e2d' : runtimeData?.readiness?.status === 'ready' ? '\u670d\u52a1\u5c31\u7eea' : '\u9700\u8981\u5173\u6ce8'}
              </span>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div><span className="text-muted-foreground">{'\u6570\u636e\u5e93'}</span><div className="mt-1 font-medium">{runtimeData?.readiness?.database?.ready ? '\u8fde\u63a5\u6b63\u5e38' : '\u672a\u5c31\u7eea'}</div></div>
              <div><span className="text-muted-foreground">{'\u6570\u636e\u5e93\u5ef6\u8fdf'}</span><div className="mt-1 font-medium">{runtimeData?.readiness?.database?.latency_ms ?? '-'}{runtimeData?.readiness?.database?.latency_ms !== null && runtimeData?.readiness?.database?.latency_ms !== undefined ? ' ms' : ''}</div></div>
              <div><span className="text-muted-foreground">{'\u670d\u52a1\u8fd0\u884c\u65f6\u957f'}</span><div className="mt-1 font-medium">{runtimeData?.process?.uptime_seconds !== undefined ? Math.floor(runtimeData.process.uptime_seconds / 60) + ' \u5206\u949f' : '-'}</div></div>
              <div><span className="text-muted-foreground">{'\u5b9e\u65f6\u7ec4\u4ef6'}</span><div className="mt-1 font-medium">{runtimeData?.components?.realtime_bus === 'active' ? '\u96c6\u7fa4\u540c\u6b65\u5df2\u542f\u7528' : '\u672c\u5730\u6a21\u5f0f'}</div></div>
            </div>
            {(runtimeData?.readiness?.runtime?.warnings?.length ?? 0) > 0 && <div className="mt-3 text-xs text-amber-700">{'\u914d\u7f6e\u63d0\u793a\uff1a'}{runtimeData?.readiness?.runtime?.warnings?.join('\uff1b')}</div>}
          </div>
          <div className="mt-3 max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/70"><tr><th className="p-2">时间</th><th className="p-2">事件</th><th className="p-2">用户</th><th className="p-2">手机</th><th className="p-2">微信</th><th className="p-2">备注</th></tr></thead>
              <tbody>
                {(activityData?.rows ?? []).map((row, index) => (
                  <tr key={row.id ?? `${row.created_at}-${index}`} className="border-t">
                    <td className="p-2">{fmtTime(row.created_at)}</td>
                    <td className="p-2">{activityText(row.event_type)}</td>
                    <td className="p-2">{row.user_name ?? '-'}</td>
                    <td className="p-2">{row.phone ?? '-'}</td>
                    <td className="p-2">{maskedOpenId(row.wechat_openid)}</td>
                    <td className="p-2">{activityText(row.remark)}</td>
                  </tr>
                ))}
                {(activityData?.rows ?? []).length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">今天还没有新的运营记录。</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className={sectionClass('security')}>
        <CardHeader><CardTitle className="text-sm">管理员密码</CardTitle></CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">
            当前：{cfg?.has_custom_admin_password ? '已使用 scrypt 自定义密码' : '使用服务器环境变量 ADMIN_PASSWORD'}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">
              <span className="text-muted-foreground">新密码（≥12 位）</span>
              <Input type="password" showPassword value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">确认新密码</span>
              <Input type="password" showPassword value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </label>
          </div>
          <div className="mt-3">
            <Button disabled={update.isPending} onClick={saveAdminPassword}>更新密码</Button>
          </div>
        </CardContent>
      </Card>

      <Card className={sectionClass('security')}>
        <CardHeader><CardTitle className="text-sm">系统公告</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.system_notice_enabled} onChange={(e) => setField('system_notice_enabled', e.target.checked)} />
              启用登录公告
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">公告标题</span>
              <Input value={form.system_notice_title} onChange={(e) => setField('system_notice_title', e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">公告内容</span>
              <textarea value={form.system_notice_content} onChange={(e) => setField('system_notice_content', e.target.value)} rows={4} className="w-full rounded-md border bg-card px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="mt-3">
            <Button disabled={update.isPending} onClick={saveNotice}>保存公告</Button>
          </div>
        </CardContent>
      </Card>

      <Card className={sectionClass('security')}>
        <CardHeader><CardTitle className="text-sm">安全与公开设置</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            {([
              ['enable_image_captcha', '启用图形验证码'],
              ['require_return_photo', '归还需上传照片'],
              ['block_ip_access_enabled', '阻止纯 IP 访问'],
              ['public_show_reserver_name', '公开预约人姓名'],
              ['public_show_reserver_phone', '公开预约人手机'],
              ['public_show_reserver_student_no', '公开预约人学号']
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input type="checkbox" checked={form[key]} onChange={(e) => setField(key, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-sm">
              <span className="text-muted-foreground">验证码有效分钟数</span>
              <Input type="number" min={1} max={60} value={form.captcha_expire_minutes} onChange={(e) => setField('captcha_expire_minutes', e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">每小时验证码次数</span>
              <Input type="number" min={1} max={50} value={form.captcha_hourly_limit} onChange={(e) => setField('captcha_hourly_limit', e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">同一微信每日绑定上限</span>
              <Input type="number" min={1} max={20} value={form.openid_daily_register_limit} onChange={(e) => setField('openid_daily_register_limit', e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">站点域名</span>
              <Input placeholder="https://example.com" value={form.site_domain} onChange={(e) => setField('site_domain', e.target.value)} />
            </label>
          </div>
          <div className="mt-3">
            <Button disabled={update.isPending} onClick={saveSecurity}>保存安全设置</Button>
          </div>
        </CardContent>
      </Card>

      <Card className={sectionClass('wechat')}>
        <CardHeader><CardTitle className="text-sm">微信公众号配置</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-muted-foreground">公众号回调 Token</span>
              <Input value={form.wechat_token} onChange={(e) => setField('wechat_token', e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">公众号 AppID</span>
              <Input value={form.wechat_app_id} onChange={(e) => setField('wechat_app_id', e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">公众号 AppSecret</span>
              <Input type="password" showPassword placeholder={cfg?.has_wechat_app_secret ? '已保存，留空则不修改' : '尚未设置，请填写 AppSecret'} value={form.wechat_app_secret} onChange={(e) => setField('wechat_app_secret', e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="text-muted-foreground">管理员 OpenID（逗号分隔）</span>
              <Input value={form.wechat_admin_openids} onChange={(e) => setField('wechat_admin_openids', e.target.value)} />
            </label>
          </div>
          <div className="mt-3">
            <Button disabled={update.isPending} onClick={saveWechat}>保存微信配置</Button>
          </div>
        </CardContent>
      </Card>

      <Card className={sectionClass('reports')}>
        <CardHeader><CardTitle className="text-sm">每日报告推送</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.admin_report_enabled} onChange={(e) => setField('admin_report_enabled', e.target.checked)} />
              启用每日报告推送
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm"><span className="text-muted-foreground">日报小时</span><Input type="number" min={0} max={23} value={form.admin_report_hour} onChange={(e) => setField('admin_report_hour', e.target.value)} /></label>
            <label className="text-sm"><span className="text-muted-foreground">日报分钟</span><Input type="number" min={0} max={59} value={form.admin_report_minute} onChange={(e) => setField('admin_report_minute', e.target.value)} /></label>
            <label className="text-sm"><span className="text-muted-foreground">日报时区</span><Input value={form.admin_report_timezone} onChange={(e) => setField('admin_report_timezone', e.target.value)} /></label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={update.isPending} onClick={saveReportConfig}>保存日报配置</Button>
            <Button variant="outline" disabled={previewReport.isPending} onClick={previewDailyReport}>预览日报</Button>
            <Button variant="outline" disabled={sendReport.isPending} onClick={sendDailyReportNow}>立即发送</Button>
          </div>
          {reportPreview?.intelligence_summary && (
            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="text-xs font-semibold text-primary">5.0 智能运营解读</div>
              <div className="mt-3 grid gap-2 sm:grid-cols-5">
                {[
                  ['风险设备', reportPreview.intelligence_summary.risk_devices ?? 0],
                  ['高峰时段', reportPreview.intelligence_summary.high_demand_slots ?? 0],
                  ['待办事项', reportPreview.intelligence_summary.pending_workload ?? 0],
                  ['逾期/异常', reportPreview.intelligence_summary.overdue_or_abnormal ?? 0],
                  ['今日预约', reportPreview.intelligence_summary.today_reservations ?? 0]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border bg-card/70 p-2">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <div className="mt-1 text-lg font-bold tabular-nums text-primary">{value}</div>
                  </div>
                ))}
              </div>
              {reportPreview.smart_insights?.recommendations?.length ? (
                <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                  {reportPreview.smart_insights.recommendations.slice(0, 3).map((item) => (
                    <div key={item.id || item.title} className="rounded-md border bg-card/70 p-2">
                      <div className="font-medium text-foreground">{item.title}</div>
                      <div className="mt-1">{item.description}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          {reportPreviewText && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">{reportPreviewText}</pre>}
        </CardContent>
      </Card>

      <Card className={sectionClass('wechat')}>
        <CardHeader><CardTitle className="text-sm">工作人员联系方式</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 lg:grid-cols-2">
            {staffContacts.map((contact) => {
              const preview = contactPreviews[contact.key] || contact.qrcode_url;
              return (
                <article key={contact.key} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{contact.label}</div>
                      <div className="text-xs text-muted-foreground">{contact.description}</div>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={contact.enabled !== false} onChange={(e) => updateContact(contact.key, { enabled: e.target.checked })} />
                      启用
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[120px_1fr]">
                    <div>
                      <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-md border bg-muted text-xs text-muted-foreground">
                        {preview ? <img src={preview} alt={`${contact.label ?? contact.key}二维码`} className="h-full w-full object-cover" /> : '未上传二维码'}
                      </div>
                      <input className="mt-2 block w-full text-xs" type="file" accept="image/*" onChange={(e) => selectContactFile(contact.key, e.target.files?.[0])} />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm"><span className="text-muted-foreground">姓名</span><Input value={asText(contact.name)} onChange={(e) => updateContact(contact.key, { name: e.target.value })} /></label>
                      <label className="text-sm"><span className="text-muted-foreground">手机号</span><Input value={asText(contact.phone)} onChange={(e) => updateContact(contact.key, { phone: e.target.value })} /></label>
                      <label className="text-sm"><span className="text-muted-foreground">二维码 URL</span><Input value={asText(contact.qrcode_url)} onChange={(e) => updateContact(contact.key, { qrcode_url: e.target.value })} /></label>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="mt-3">
            <Button disabled={update.isPending} onClick={saveStaffContacts}>保存联系方式</Button>
          </div>
        </CardContent>
      </Card>

      <Card className={sectionClass('roles')}>
        <CardHeader><CardTitle className="text-sm">管理员角色</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {(rolesData?.roles ?? []).map((role) => {
              const rolePermissions = normalizePermissions(role.permissions);
              const moduleSummary = permissionModuleSummary(rolePermissions, permissionModules);
              const isSelf = isSelfUser(role.user_id);
              return (
                <div key={role.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                  <div>
                    <span className="font-medium">{role.user_name ?? <CompactId value={role.user_id} prefix="USR" />}</span>{' '}
                    <span className="text-muted-foreground">{role.user_phone ?? ''}</span>{' · '}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{ROLE_LABELS[role.role_key] ?? systemText(role.role_key)}</span>
                    {role.note && <span className="ml-2 text-xs text-muted-foreground">{systemText(role.note)}</span>}
                    {moduleSummary.length > 0 && <div className="mt-1 text-xs text-muted-foreground">已授权模块：{moduleSummary.join('、')}</div>}
                    {isSelf && <div className="mt-1 text-xs font-semibold text-amber-600">当前登录账号：禁止自改权限</div>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={isSelf} onClick={() => editExistingRole(role)}>{isSelf ? '已保护' : '编辑'}</Button>
                    <Button size="sm" variant="outline" disabled={isSelf || role.role_key === 'super_admin' || revokeRole.isPending} onClick={() => revoke(role.user_id)}>
                      撤销
                    </Button>
                  </div>
                </div>
              );
            })}
            {!isLoading && (rolesData?.roles ?? []).length === 0 && <p className="py-2 text-center text-muted-foreground">暂无管理员角色</p>}
          </div>

          <div className="mt-4 rounded-md border p-3">
            <div className="text-sm font-medium">指派/编辑角色</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <select className="rounded-md border bg-card px-3 py-2 text-sm" value={editRole.user_id} onChange={(e) => setEditRole((current) => ({ ...current, user_id: e.target.value }))}>
                <option value="">请选择用户</option>
                {users.filter((user) => !isSelfUser(user.id)).map((user) => <option key={user.id} value={user.id}>{user.name} {user.phone ? `（${user.phone}）` : ''}</option>)}
              </select>
              <select className="rounded-md border bg-card px-3 py-2 text-sm" value={editRole.role_key} onChange={(e) => setRoleKey(e.target.value)}>
                {Object.keys(roleDefaults).map((key) => <option key={key} value={key}>{ROLE_LABELS[key] ?? systemText(key)}</option>)}
              </select>
              <Input placeholder="备注" value={editRole.note} onChange={(e) => setEditRole((current) => ({ ...current, note: e.target.value }))} />
            </div>
            {editRole.role_key === 'super_admin' ? (
              <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                超级管理员拥有全部系统权限，不能按业务模块删减。请仅将此角色授予系统负责人。
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {permissionModules.map((module) => {
                  const moduleKeys = module.permissions.map((permission) => permission.key);
                  const enabledCount = moduleKeys.filter((key) => selectedPermissions.includes(key)).length;
                  const allChecked = moduleKeys.length > 0 && enabledCount === moduleKeys.length;
                  const partialChecked = enabledCount > 0 && !allChecked;
                  return (
                    <section key={module.key} className="rounded-xl border bg-muted/20 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-bold">{module.label}</h4>
                          {module.description && <p className="mt-1 text-xs text-muted-foreground">{module.description}</p>}
                        </div>
                        <label className="flex items-center gap-2 text-xs font-medium">
                          <input
                            type="checkbox"
                            checked={allChecked}
                            ref={(node) => { if (node) node.indeterminate = partialChecked; }}
                            onChange={(event) => togglePermissionModule(moduleKeys, event.target.checked)}
                          />
                          全选模块
                        </label>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        {module.permissions.map((permission) => (
                          <label key={permission.key} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
                            <input type="checkbox" checked={selectedPermissions.includes(permission.key)} onChange={(event) => togglePermission(permission.key, event.target.checked)} />
                            {permission.label ?? PERMISSION_LABELS[permission.key] ?? systemText(permission.key)}
                          </label>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={upsertRole.isPending || !editRole.user_id || isSelfUser(editRole.user_id)} onClick={submitRole}>保存角色</Button>
              <Button size="sm" variant="outline" onClick={() => setEditRole({ user_id: '', role_key: 'admin', note: '', permissions: [] })}>清空</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

