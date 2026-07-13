import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Ban, ShieldCheck, Smartphone, UserCheck, UsersRound } from 'lucide-react';
import { toFriendlyError } from '@/lib/friendly-error';
import { briefDateTime } from '@/lib/time-format';
import { Button } from '@/components/ui/button';
import { useActionDialog } from '@/components/ui/action-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PERMISSIONS, useCapability } from '@/features/auth/permissions';
import { OpsDataToolbar, OpsDetailDrawer, OpsEmptyState, OpsMetricCard, OpsPageHeader, OpsPermissionHint } from '@/components/ops/design-system';
import {
  useAdminUserDetail,
  useAdminUsers,
  useDeleteUser,
  useSetUserBan,
  useSetUserStatus,
  useUnbindUserWechat,
  type AdminUser,
  type AdminUserDetail
} from '@/features/platform/operations-api';

const STATUS_LABEL: Record<string, string> = {
  pending: '待审核',
  active: '正常',
  approved: '已通过',
  rejected: '已驳回',
  disabled: '已停用',
  banned: '已封禁'
};

const ROLE_LABEL: Record<string, string> = {
  user: '普通用户',
  admin: '管理员',
  super_admin: '最高权限管理员'
};

const DETAIL_SECTIONS = [
  { key: 'reservations', label: '预约记录' },
  { key: 'borrows', label: '借还记录' },
  { key: 'fault_reports', label: '故障上报' },
  { key: 'requests', label: '诉求记录' },
  { key: 'activity', label: '活跃日志' }
] as const;

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'active', label: '正常' },
  { key: 'rejected', label: '已驳回' },
  { key: 'disabled', label: '已停用' },
  { key: 'banned', label: '已封禁' }
];

export function AdminUsersPage() {
  const capability = useCapability();
  const { confirm, prompt, ActionDialog } = useActionDialog();
  const initialStatus = new URLSearchParams(window.location.search).get('status') ?? '';
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [selectedId, setSelectedId] = useState<string>();
  const usersQuery = useAdminUsers();
  const detailQuery = useAdminUserDetail(selectedId);
  const setStatus = useSetUserStatus();
  const setBan = useSetUserBan();
  const unbindWechat = useUnbindUserWechat();
  const deleteUser = useDeleteUser();

  const users = usersQuery.data ?? [];
  const filteredUsers = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return users.filter((user) => {
      if (statusFilter === 'banned') {
        if (!user.is_banned) return false;
      } else if (statusFilter && user.status !== statusFilter) return false;
      if (!kw) return true;
      return [user.name, user.phone, user.student_no, user.role, user.status, user.wechat_nickname]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(kw));
    });
  }, [keyword, statusFilter, users]);

  const metrics = useMemo(() => {
    const pending = users.filter((item) => item.status === 'pending').length;
    const banned = users.filter((item) => item.is_banned).length;
    const admins = users.filter((item) => item.role === 'admin' || item.role === 'super_admin').length;
    const bound = users.filter((item) => item.wechat_bound).length;
    return [
      { label: '用户总数', value: users.length, hint: '普通用户与管理员', tone: 'info' as const, icon: <UsersRound className="h-4 w-4" /> },
      { label: '待审核', value: pending, hint: '需要尽快处理', tone: 'warning' as const, icon: <UserCheck className="h-4 w-4" /> },
      { label: '管理员账号', value: admins, hint: '按授权显示后台', tone: 'default' as const, icon: <ShieldCheck className="h-4 w-4" /> },
      { label: '微信已绑定', value: bound, hint: `${banned} 个账号封禁`, tone: banned > 0 ? 'danger' as const : 'success' as const, icon: <Smartphone className="h-4 w-4" /> }
    ];
  }, [users]);

  const selectedUser = detailQuery.data?.user ?? users.find((user) => user.id === selectedId);
  const isMutating = setStatus.isPending || setBan.isPending || unbindWechat.isPending || deleteUser.isPending;
  const canApproveUsers = capability.canAny([PERMISSIONS.USER_APPROVE, PERMISSIONS.USER_MANAGE]);
  const canManageUsers = capability.can(PERMISSIONS.USER_MANAGE);
  const canOperateUser = (user: AdminUser) => (capability.isSuperAdmin || user.role === 'user');
  const canDeleteUser = (user: AdminUser) => canManageUsers && capability.isSuperAdmin && user.role !== 'super_admin';


  function handleSetStatus(user: AdminUser, status: string) {
    setStatus.mutate(
      { id: user.id, status },
      {
        onSuccess: () => toast.success(`已更新 ${displayName(user)} 的状态`),
        onError: (error) => toast.error(`状态更新失败：${toFriendlyError(error)}`)
      }
    );
  }

  async function handleRejectUser(user: AdminUser) {
    const reason = await prompt({
      title: '驳回账号审核',
      description: `请填写驳回 ${displayName(user)} 审核的原因，用户会看到该原因并据此修改资料。`,
      placeholder: '例如：请补充真实学号或联系方式',
      defaultValue: user.disabled_reason || '',
      confirmText: '确认驳回',
      required: true,
      maxLength: 120,
      tone: 'warning'
    });
    if (reason === null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error('驳回审核需要填写原因，方便用户修改资料。');
      return;
    }
    setStatus.mutate(
      { id: user.id, status: 'rejected', reason: trimmed },
      {
        onSuccess: () => toast.success(`已驳回 ${displayName(user)} 的账号申请`),
        onError: (error) => toast.error(`驳回审核失败：${toFriendlyError(error)}`)
      }
    );
  }

  function handleSetBan(user: AdminUser) {
    const banned = !user.is_banned;
    setBan.mutate(
      { id: user.id, banned },
      {
        onSuccess: () => toast.success(banned ? '已封禁用户' : '已解除封禁'),
        onError: (error) => toast.error(`封禁状态更新失败：${toFriendlyError(error)}`)
      }
    );
  }

  async function handleUnbindWechat(user: AdminUser) {
    const ok = await confirm({
      title: '确认解绑微信',
      description: `将解除 ${displayName(user)} 的微信绑定，用户需要重新绑定后才能使用微信相关能力。`,
      confirmText: '确认解绑',
      tone: 'warning'
    });
    if (!ok) return;
    unbindWechat.mutate(user.id, {
      onSuccess: () => toast.success('已解绑微信'),
      onError: (error) => toast.error(`解绑失败：${toFriendlyError(error)}`)
    });
  }

  async function handleDelete(user: AdminUser) {
    const ok = await confirm({
      title: '确认删除用户',
      description: `将删除用户 ${displayName(user)}。该操作不可撤销，请确认已完成数据留存。`,
      confirmText: '确认删除',
      tone: 'danger'
    });
    if (!ok) return;
    deleteUser.mutate(user.id, {
      onSuccess: () => {
        toast.success('用户已删除');
        if (selectedId === user.id) setSelectedId(undefined);
      },
      onError: (error) => toast.error(`删除失败：${toFriendlyError(error)}`)
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ActionDialog />
      <OpsPageHeader
        eyebrow="USER OPERATIONS"
        title="用户权限中心"
        description="审核账号、调整状态、查看用户轨迹；管理员相关操作按最高权限和授权边界自动收口。"
        aside={
          <OpsPermissionHint
            title={capability.isSuperAdmin ? '最高权限模式' : '分权管理模式'}
            permissions={capability.isSuperAdmin ? '可维护用户、管理员角色与授权。' : '管理员账号、删除和敏感授权已锁定。'}
            className="border-white/10 bg-white/10 text-white"
          />
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((item) => (
          <OpsMetricCard key={item.label} label={item.label} value={item.value} hint={item.hint} tone={item.tone} icon={item.icon} loading={usersQuery.isLoading} />
        ))}
      </div>

      <Card className="ops-card overflow-hidden">
        <CardContent className="space-y-4 p-4">
          <OpsDataToolbar
            title="用户队列"
            description="仅展示当前账号允许查看和处理的操作入口。"
            meta={<>显示 {filteredUsers.length} / {users.length} 人</>}
            filters={
              <>
                {FILTERS.map((item) => (
                  <Button key={item.key || 'all'} size="sm" variant={statusFilter === item.key ? 'default' : 'outline'} onClick={() => setStatusFilter(item.key)}>
                    {item.label}
                  </Button>
                ))}
              </>
            }
            actions={
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索姓名、手机号、学号、角色"
                clearable
                onClear={() => setKeyword('')}
                className="w-full sm:w-80"
              />
            }
          />
          {usersQuery.isLoading && <p className="py-8 text-center text-muted-foreground">加载用户中…</p>}
          {usersQuery.error && <p className="py-8 text-center text-destructive">用户加载失败：{toFriendlyError(usersQuery.error)}</p>}
          {!usersQuery.isLoading && filteredUsers.length === 0 && <OpsEmptyState title="暂无匹配用户" description="可切换状态或清空关键词后再查看。" />}
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {filteredUsers.map((user) => {
              const lockedAdmin = !canOperateUser(user);
              return (
                <article key={user.id} className={`rounded-2xl border p-3 transition hover:-translate-y-0.5 hover:shadow-md ${selectedId === user.id ? 'border-primary bg-primary/5' : 'bg-card/80'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 text-left" onClick={() => setSelectedId(user.id)}>
                      <p className="truncate text-base font-bold text-foreground">{displayName(user)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{user.phone || '-'} · 学号 {user.student_no || '-'}</p>
                    </button>
                    <span className={`badge-pill ${user.is_banned ? 'badge-danger' : statusTone(user.status)}`}>
                      {user.is_banned ? '已封禁' : STATUS_LABEL[user.status] ?? user.status ?? '-'}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                    <Mini label="角色" value={ROLE_LABEL[user.role] ?? user.role ?? '-'} />
                    <Mini label="微信" value={user.wechat_bound ? '已绑定' : '未绑定'} />
                    <Mini label="注册" value={formatDate(user.created_at)} />
                  </div>
                  {lockedAdmin && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                      <Ban className="h-3.5 w-3.5" />管理员账号受保护
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setSelectedId(user.id)}>详情</Button>
                    {canApproveUsers && (user.status === 'pending' || user.status === 'rejected') && canOperateUser(user) && (
                      <Button size="sm" disabled={isMutating} onClick={() => handleSetStatus(user, 'active')}>通过</Button>
                    )}
                    {canApproveUsers && user.status === 'pending' && canOperateUser(user) && (
                      <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleRejectUser(user)}>驳回</Button>
                    )}
                    {canManageUsers && user.status !== 'disabled' && canOperateUser(user) && (
                      <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleSetStatus(user, 'disabled')}>停用</Button>
                    )}
                    {canManageUsers && user.status === 'disabled' && canOperateUser(user) && (
                      <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleSetStatus(user, 'active')}>启用</Button>
                    )}
                    {canManageUsers && canOperateUser(user) && (
                      <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleSetBan(user)}>{user.is_banned ? '解封' : '封禁'}</Button>
                    )}
                    {canManageUsers && user.wechat_bound && canOperateUser(user) && (
                      <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleUnbindWechat(user)}>解绑微信</Button>
                    )}
                    {canDeleteUser(user) && (
                      <Button size="sm" variant="destructive" disabled={isMutating} onClick={() => handleDelete(user)}>删除</Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <OpsDetailDrawer
        open={Boolean(selectedId)}
        title={selectedUser ? displayName(selectedUser) : '用户详情'}
        subtitle={selectedUser ? `${ROLE_LABEL[selectedUser.role] ?? selectedUser.role ?? '-'} · ${selectedUser.phone || '无手机号'}` : '查看轨迹和记录'}
        onClose={() => setSelectedId(undefined)}
      >
        {detailQuery.isLoading ? (
          <p className="py-8 text-center text-muted-foreground">详情加载中…</p>
        ) : detailQuery.error ? (
          <p className="py-8 text-center text-destructive">详情加载失败：{toFriendlyError(detailQuery.error)}</p>
        ) : selectedUser ? (
          <UserDetailPanel user={selectedUser} detail={detailQuery.data} />
        ) : (
          <OpsEmptyState title="未找到该用户" description="该用户可能已被删除或不在当前权限范围。" />
        )}
      </OpsDetailDrawer>
    </div>
  );
}
function UserDetailPanel({ user, detail }: { user: AdminUser; detail?: AdminUserDetail }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 p-4 text-white shadow-sm">
        <h2 className="text-lg font-bold">{displayName(user)}</h2>
        <p className="mt-1 text-white/70">{ROLE_LABEL[user.role] ?? user.role ?? '-'} · {user.phone || '-'}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <Info label="状态" value={user.is_banned ? '已封禁' : STATUS_LABEL[user.status] ?? user.status ?? '-'} />
        <Info label="学号" value={user.student_no || '-'} />
        <Info label="微信" value={user.wechat_bound ? user.wechat_nickname || user.wechat_openid_masked || '已绑定' : '未绑定'} />
        <Info label="最近登录" value={formatTime(user.last_login_at)} />
        <Info label="创建时间" value={formatTime(user.created_at)} />
        <Info label="更新时间" value={formatTime(user.updated_at)} />
        {(user.status === 'rejected' || user.status === 'disabled') && user.disabled_reason && (
          <Info label={user.status === 'rejected' ? '驳回原因' : '停用原因'} value={user.disabled_reason} />
        )}
      </dl>
      <div className="space-y-3 border-t pt-4">
        {DETAIL_SECTIONS.map((section) => {
          const rows = Array.isArray(detail?.[section.key]) ? detail?.[section.key] ?? [] : [];
          return (
            <div key={section.key} className="rounded-2xl border bg-muted/20 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold">{section.label}</span>
                <span className="text-xs text-muted-foreground">{rows.length} 条</span>
              </div>
              {rows.length > 0 ? (
                <div className="max-h-36 space-y-2 overflow-y-auto text-xs text-muted-foreground">
                  {rows.slice(0, 6).map((row, index) => (
                    <p key={index} className="truncate rounded-lg bg-background/70 px-2 py-1">{summarizeRow(row)}</p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">暂无记录</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-muted/40 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-semibold">{value}</dd>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-semibold text-foreground">{value}</p>
    </div>
  );
}

function displayName(user: AdminUser) {
  return user.name || user.phone || user.id;
}

function statusTone(status?: string) {
  if (status === 'active' || status === 'approved') return 'badge-success';
  if (status === 'pending') return 'badge-warn';
  if (status === 'disabled' || status === 'rejected') return 'badge-muted';
  return 'badge-info';
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
}

function formatTime(value?: string | null) {
  return briefDateTime(value);
}

function summarizeRow(row: Record<string, unknown>) {
  const candidates = [
    row.device_name,
    row.device_code,
    row.title,
    row.issue_type,
    row.status,
    row.created_at,
    row.start_time,
    row.borrowed_at
  ].filter(Boolean);
  if (candidates.length > 0) return candidates.map((value) => String(value)).join(' · ');
  return JSON.stringify(row);
}




