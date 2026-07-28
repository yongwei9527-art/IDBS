import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { toFriendlyError } from '@/lib/friendly-error';
import { briefDateTime } from '@/lib/time-format';
import { Button } from '@/components/ui/button';
import { useActionDialog } from '@/components/ui/action-dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PERMISSIONS, useCapability } from '@/features/auth/permissions';
import { OpsDataToolbar, OpsDetailDrawer, OpsEmptyState, OpsPageHeader } from '@/components/ops/design-system';
import {
  useAdminRoles,
  useAdminUserDetail,
  useAdminUsers,
  useAdminOperationsOverview,
  useDeleteUser,
  useRevokeRole,
  useResetUserPassword,
  useRegistrationApprovalCode,
  useSetUserBan,
  useSetUserStatus,
  useUnbindUserWechat,
  useUpsertRole,
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
  user: '用户',
  admin: '管理员',
  super_admin: '超管'
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

function RegistrationApprovalCodeCard() {
  const query = useRegistrationApprovalCode();
  const [now, setNow] = useState(Date.now());
  const [revealed, setRevealed] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const revealTimer = useRef<number | null>(null);
  const didLongPress = useRef(false);
  const expiresAt = new Date(query.data?.expires_at || 0).getTime();
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
      if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
      if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    };
  }, []);

  function cancelPress() {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  function revealTemporarily() {
    if (!query.data?.code) return;
    setRevealed(true);
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    revealTimer.current = window.setTimeout(() => {
      revealTimer.current = null;
      setRevealed(false);
    }, 10_000);
  }

  async function copyCode() {
    const code = query.data?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast.success('批准码已复制，将按倒计时自动更新。');
    } catch {
      const area = document.createElement('textarea');
      area.value = code;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast.success('批准码已复制，将按倒计时自动更新。');
    }
  }

  function beginPress() {
    cancelPress();
    didLongPress.current = false;
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      didLongPress.current = true;
      void copyCode();
    }, 650);
  }

  function handleCodeClick() {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (revealed) {
      if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
      setRevealed(false);
      return;
    }
    revealTemporarily();
  }

  return (
    <Card className="border-primary/25 bg-primary/[0.035]">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">普通用户注册批准码</p>
          <p className="mt-1 text-xs text-muted-foreground">仅有用户审批权限的管理员可见。注册人填写有效批准码后立即通过普通用户审批。</p>
        </div>
        <button
          type="button"
          aria-label="长按复制注册批准码"
          className="min-h-12 min-w-48 select-none rounded-lg border bg-card px-4 py-2 text-left font-mono text-lg font-bold tracking-[0.18em] shadow-none touch-manipulation"
          onPointerDown={beginPress}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          onContextMenu={(event) => event.preventDefault()}
          onClick={handleCodeClick}
        >
          <span className="block [overflow-wrap:anywhere]" data-sensitive-approval-code>
            {query.isLoading ? '读取中…' : query.data?.code ? (revealed ? query.data.code : '•••• •••• ••••') : '暂不可用'}
          </span>
          <span className="mt-1 block font-sans text-[11px] font-normal tracking-normal text-muted-foreground">
            {query.data ? `${remainingSeconds} 秒后更新 · 点击显示 10 秒 · 长按复制` : '请稍后重试'}
          </span>
        </button>
      </CardContent>
    </Card>
  );
}

export function AdminUsersPage() {
  const capability = useCapability();
  const { confirm, prompt, ActionDialog } = useActionDialog();
  const initialStatus = new URLSearchParams(window.location.search).get('status') ?? '';
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [selectedId, setSelectedId] = useState<string>();
  const usersQuery = useAdminUsers();
  const rolesQuery = useAdminRoles({ enabled: capability.isSuperAdmin });
  const detailQuery = useAdminUserDetail(selectedId);
  const setStatus = useSetUserStatus();
  const setBan = useSetUserBan();
  const unbindWechat = useUnbindUserWechat();
  const deleteUser = useDeleteUser();
  const upsertRole = useUpsertRole();
  const revokeRole = useRevokeRole();
  const resetPassword = useResetUserPassword();

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
      { label: '全部', value: users.length, hint: '', tone: 'info' as const },
      { label: '待审核', value: pending, hint: '', tone: 'warning' as const },
      { label: '管理员', value: admins, hint: '', tone: 'default' as const },
      { label: '已封禁', value: banned, hint: bound ? `微信${bound}` : '', tone: banned > 0 ? 'danger' as const : 'success' as const }
    ];
  }, [users]);

  const selectedUser = detailQuery.data?.user ?? users.find((user) => user.id === selectedId);
  const isMutating = setStatus.isPending || setBan.isPending || unbindWechat.isPending || deleteUser.isPending || upsertRole.isPending || revokeRole.isPending || resetPassword.isPending;
  const canApproveUsers = capability.canAny([PERMISSIONS.USER_APPROVE, PERMISSIONS.USER_MANAGE]);
  const canViewRegistrationApprovalCode = capability.isSuperAdmin || capability.can(PERMISSIONS.USER_APPROVE);
  const canManageUsers = capability.can(PERMISSIONS.USER_MANAGE);
  const canOperateUser = (user: AdminUser) => (capability.isSuperAdmin || user.role === 'user');
  const canDeleteUser = (user: AdminUser) => canManageUsers && capability.isSuperAdmin && user.role !== 'super_admin';
  const canResetPassword = (user: AdminUser) => capability.isSuperAdmin && user.role !== 'super_admin';
  const canManageRoles = capability.isSuperAdmin;
  const canGrantAdmin = (user: AdminUser) => (
    canManageRoles
    && user.role === 'user'
    && user.status === 'active'
    && !user.is_banned
  );
  const canRevokeAdmin = (user: AdminUser) => (
    canManageRoles
    && user.role === 'admin'
  );


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
      description: `驳回 ${displayName(user)} 的原因（用户可见）`,
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
      toast.error('请填写驳回原因');
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
      description: `解绑 ${displayName(user)} 的微信？`,
      confirmText: '确认解绑',
      tone: 'warning'
    });
    if (!ok) return;
    unbindWechat.mutate(user.id, {
      onSuccess: () => toast.success('已解绑微信'),
      onError: (error) => toast.error(`解绑失败：${toFriendlyError(error)}`)
    });
  }

  async function handleResetPassword(user: AdminUser) {
    if (!canResetPassword(user)) {
      toast.error('\u4ec5\u6700\u9ad8\u6743\u9650\u7ba1\u7406\u5458\u53ef\u91cd\u7f6e\u666e\u901a\u7528\u6237\u6216\u666e\u901a\u7ba1\u7406\u5458\u5bc6\u7801\u3002');
      return;
    }
    const targetLabel = user.role === 'admin' ? '\u666e\u901a\u7ba1\u7406\u5458' : '\u666e\u901a\u7528\u6237';
    const accepted = await confirm({
      title: `\u91cd\u7f6e${targetLabel}\u5bc6\u7801`,
      description: (
        <div className="space-y-2">
          <p>系统将生成 12 位数字的一次性临时密码，只显示一次。</p>
          <p className="font-medium text-foreground">用户首次登录后必须立即设置新密码；刷新会话立即失效，旧访问令牌最长 15 分钟后失效。</p>
        </div>
      ),
      confirmText: '确认重置',
      tone: 'warning'
    });
    if (!accepted) return;
    resetPassword.mutate(
      { id: user.id },
      {
        onSuccess: async (data) => {
          await confirm({
            title: '一次性临时密码（仅显示一次）',
            description: (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">请通过安全方式交给对应用户。关闭后系统无法再次查看，只能重新重置。</p>
                <p className="rounded-lg border bg-muted/40 px-4 py-3 text-center font-mono text-2xl font-bold tracking-[0.2em]">{data.temporary_password}</p>
                <p className="text-xs text-muted-foreground">有效期至 {briefDateTime(data.temporary_password_expires_at)}；用户登录后必须设置 12–128 位新密码。</p>
              </div>
            ),
            confirmText: '我已安全保存',
            cancelText: '关闭',
            tone: 'default'
          });
          resetPassword.reset();
        },
        onError: (error) => toast.error(`密码重置失败：${toFriendlyError(error)}`)
      }
    );
  }
  async function handleDelete(user: AdminUser) {
    const ok = await confirm({
      title: '确认删除用户',
      description: `删除 ${displayName(user)}？不可恢复。`,
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

  async function handleGrantAdmin(user: AdminUser) {
    if (!canGrantAdmin(user)) {
      toast.error('仅可对正常状态的普通用户授予管理员权限。');
      return;
    }
    const ok = await confirm({
      title: '设为管理员',
      description: `将 ${displayName(user)} 设为管理员？默认授予实验室主管权限，可在系统配置中继续细化权限矩阵。`,
      confirmText: '确认授予',
      tone: 'warning'
    });
    if (!ok) return;
    if (rolesQuery.isLoading) {
      toast.error('管理员权限模板加载中，请稍后再试。');
      return;
    }
    if (rolesQuery.isError) {
      toast.error(`管理员权限模板加载失败：${toFriendlyError(rolesQuery.error)}`);
      return;
    }
    const defaultPermissions = rolesQuery.data?.role_defaults?.admin ?? [];
    if (!defaultPermissions.length) {
      toast.error('未获取到管理员默认权限模板，请改到系统配置页授权。');
      return;
    }
    upsertRole.mutate(
      {
        user_id: user.id,
        role_key: 'admin',
        permissions: defaultPermissions.filter((item) => item !== '*'),
        note: '用户管理页快捷授予管理员'
      },
      {
        onSuccess: () => toast.success(`已将 ${displayName(user)} 设为管理员`),
        onError: (error) => toast.error(`授予管理员失败：${toFriendlyError(error)}`)
      }
    );
  }

  async function handleRevokeAdmin(user: AdminUser) {
    if (!canRevokeAdmin(user)) {
      toast.error('仅可撤销普通管理员权限，超级管理员需先完成权限交接。');
      return;
    }
    const ok = await confirm({
      title: '撤销管理员权限',
      description: `撤销 ${displayName(user)} 的管理员权限？撤销后将恢复为普通用户，并失去后台管理入口。`,
      confirmText: '确认撤销',
      tone: 'danger'
    });
    if (!ok) return;
    revokeRole.mutate(user.id, {
      onSuccess: () => toast.success(`已撤销 ${displayName(user)} 的管理员权限`),
      onError: (error) => toast.error(`撤销管理员失败：${toFriendlyError(error)}`)
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <ActionDialog />
      <OpsPageHeader title="用户管理" className="ops-page-header--compact" />
      {canViewRegistrationApprovalCode ? <RegistrationApprovalCodeCard /> : null}
      {capability.isSuperAdmin ? <SuperAdminOperationsOverview onOpenUser={setSelectedId} /> : null}

      <div className="user-admin-metrics">
        {metrics.map((item) => (
          <div key={item.label} className={`user-admin-metric user-admin-metric--${item.tone}`}>
            <span className="user-admin-metric-label">{item.label}</span>
            <span className="user-admin-metric-value">{usersQuery.isLoading ? '—' : item.value}</span>
            {item.hint ? <span className="user-admin-metric-hint">{item.hint}</span> : null}
          </div>
        ))}
      </div>

      <Card className="ops-card overflow-hidden">
        <CardContent className="space-y-4 p-4">
          <OpsDataToolbar
            title="用户"
            meta={<>{filteredUsers.length}/{users.length}</>}
            filters={
              <div className="ops-segment-group flex flex-wrap gap-1">
                {FILTERS.map((item) => (
                  <Button key={item.key || 'all'} size="sm" variant={statusFilter === item.key ? 'default' : 'outline'} onClick={() => setStatusFilter(item.key)}>
                    {item.label}
                  </Button>
                ))}
              </div>
            }
            actions={
              <Input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="姓名 / 手机 / 学号"
                clearable
                onClear={() => setKeyword('')}
                className="w-full sm:w-80"
              />
            }
          />
          {usersQuery.isLoading && <p className="py-8 text-center text-muted-foreground">加载中…</p>}
          {usersQuery.error && <p className="py-8 text-center text-destructive">用户加载失败：{toFriendlyError(usersQuery.error)}</p>}
          {!usersQuery.isLoading && filteredUsers.length === 0 && <OpsEmptyState title="暂无用户" />}
          <div className="hidden lg:block">
            <div className="user-admin-table overflow-x-auto rounded-lg border">
            <div className="user-admin-table-head hidden min-w-[720px] md:grid">
              <span>用户</span>
              <span>联系方式</span>
              <span>角色</span>
              <span>微信</span>
              <span>注册</span>
              <span>状态</span>
              <span className="text-right">操作</span>
            </div>
            {filteredUsers.map((user) => {
              const lockedAdmin = !canOperateUser(user);
              const statusText = user.is_banned ? '已封禁' : STATUS_LABEL[user.status] ?? user.status ?? '-';
              return (
                <div
                  key={user.id}
                  className={['user-admin-row', selectedId === user.id ? 'user-admin-row--active' : '', lockedAdmin ? 'user-admin-row--locked' : ''].filter(Boolean).join(' ')}
                >
                  <button type="button" className="user-admin-cell user-admin-cell--name text-left" onClick={() => setSelectedId(user.id)}>
                    <span className="user-admin-name">{displayName(user)}</span>
                    <span className="user-admin-sub md:hidden">{user.phone || '-'} · {ROLE_LABEL[user.role] ?? user.role ?? '-'}</span>
                  </button>
                  <div className="user-admin-cell">
                    <span className="user-admin-main">{user.phone || '-'}</span>
                    <span className="user-admin-sub">{user.student_no || '-'}</span>
                  </div>
                  <div className="user-admin-cell">
                    <span className="user-admin-main">{ROLE_LABEL[user.role] ?? user.role ?? '-'}</span>
                    {lockedAdmin ? <span className="user-admin-sub">受保护</span> : null}
                  </div>
                  <div className="user-admin-cell">
                    <span className="user-admin-main">{user.wechat_bound ? '已绑' : '未绑'}</span>
                  </div>
                  <div className="user-admin-cell">
                    <span className="user-admin-main tabular-nums">{formatDate(user.created_at)}</span>
                  </div>
                  <div className="user-admin-cell">
                    <span className={`badge-pill ${user.is_banned ? 'badge-danger' : statusTone(user.status)}`}>{statusText}</span>
                  </div>
                  <div className="user-admin-cell user-admin-cell--actions">
                    <Button size="sm" variant="outline" onClick={() => setSelectedId(user.id)}>档案</Button>
                    {canApproveUsers && (user.status === 'pending' || user.status === 'rejected') && canOperateUser(user) && (
                      <Button size="sm" disabled={isMutating} onClick={() => handleSetStatus(user, 'active')}>通过</Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </div>

          <div className="space-y-3 lg:hidden">
            {filteredUsers.map((user) => {
              const lockedAdmin = !canOperateUser(user);
              const statusText = user.is_banned ? '???' : STATUS_LABEL[user.status] ?? user.status ?? '-';
              return (
                <article key={user.id} className={['rounded-lg border border-border bg-card p-3 shadow-none', selectedId === user.id ? 'ring-1 ring-primary/40' : '', lockedAdmin ? 'opacity-90' : ''].filter(Boolean).join(' ')}>
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 text-left" onClick={() => setSelectedId(user.id)}>
                      <p className="truncate font-semibold text-foreground">{displayName(user)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{ROLE_LABEL[user.role] ?? user.role ?? '-'}</p>
                    </button>
                    <span className={'badge-pill shrink-0 ' + (user.is_banned ? 'badge-danger' : statusTone(user.status))}>{statusText}</span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div className="min-w-0"><dt className="text-muted-foreground">???</dt><dd className="truncate text-foreground">{user.phone || '-'}</dd></div>
                    <div className="min-w-0"><dt className="text-muted-foreground">??</dt><dd className="truncate text-foreground">{user.student_no || '-'}</dd></div>
                    <div className="min-w-0"><dt className="text-muted-foreground">??</dt><dd className="truncate text-foreground">{user.wechat_bound ? '???' : '???'}</dd></div>
                    <div className="min-w-0"><dt className="text-muted-foreground">????</dt><dd className="truncate text-foreground">{formatDate(user.created_at)}</dd></div>
                  </dl>
                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                    <Button size="sm" variant="outline" onClick={() => setSelectedId(user.id)}>????</Button>
                    {canApproveUsers && (user.status === 'pending' || user.status === 'rejected') && canOperateUser(user) ? <Button size="sm" disabled={isMutating} onClick={() => handleSetStatus(user, 'active')}>??</Button> : null}
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
        subtitle={selectedUser ? `${ROLE_LABEL[selectedUser.role] ?? selectedUser.role ?? '-'} · ${selectedUser.phone || '-'}` : ''}
        onClose={() => setSelectedId(undefined)}
        footer={selectedUser && (canOperateUser(selectedUser) || canGrantAdmin(selectedUser) || canRevokeAdmin(selectedUser) || canResetPassword(selectedUser) || canDeleteUser(selectedUser)) ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canOperateUser(selectedUser) && canApproveUsers && (selectedUser.status === 'pending' || selectedUser.status === 'rejected') ? (
              <Button size="sm" disabled={isMutating} onClick={() => handleSetStatus(selectedUser, 'active')}>通过</Button>
            ) : null}
            {canOperateUser(selectedUser) && canApproveUsers && selectedUser.status === 'pending' ? (
              <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleRejectUser(selectedUser)}>驳回</Button>
            ) : null}
            {canOperateUser(selectedUser) && canManageUsers && selectedUser.status !== 'disabled' ? (
              <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/5" disabled={isMutating} onClick={() => handleSetStatus(selectedUser, 'disabled')}>停用</Button>
            ) : null}
            {canOperateUser(selectedUser) && canManageUsers && selectedUser.status === 'disabled' ? (
              <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleSetStatus(selectedUser, 'active')}>启用账号</Button>
            ) : null}
            {canOperateUser(selectedUser) && canManageUsers ? (
              <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleSetBan(selectedUser)}>{selectedUser.is_banned ? '解除封禁' : '封禁账号'}</Button>
            ) : null}
            {canOperateUser(selectedUser) && canManageUsers && selectedUser.wechat_bound ? (
              <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleUnbindWechat(selectedUser)}>解绑微信</Button>
            ) : null}
            {canGrantAdmin(selectedUser) ? (
              <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleGrantAdmin(selectedUser)}>设为管理员</Button>
            ) : null}
            {canRevokeAdmin(selectedUser) ? (
              <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleRevokeAdmin(selectedUser)}>撤销权限</Button>
            ) : null}
            {canResetPassword(selectedUser) ? (
              <Button size="sm" variant="outline" disabled={isMutating} onClick={() => handleResetPassword(selectedUser)}>重置密码</Button>
            ) : null}
            {canDeleteUser(selectedUser) ? (
              <Button size="sm" variant="destructive" disabled={isMutating} onClick={() => handleDelete(selectedUser)}>删除</Button>
            ) : null}
          </div>
        ) : undefined}
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
function SuperAdminOperationsOverview({ onOpenUser }: { onOpenUser: (id: string) => void }) {
  // It is only mounted for super administrators, preventing ordinary admins from issuing this privileged request.
  const query = useAdminOperationsOverview({ limit: 6, offset: 0, enabled: true });
  const overview = query.data;
  const users = overview?.users;
  const trend = users?.registration_trend ?? [];
  const maxTrendCount = Math.max(1, ...trend.map((point) => point.count));
  const distribution = users?.status_distribution ?? {};
  const userMetrics = [
    ['注册人数', users?.total ?? 0, 'text-primary'],
    ['待审核', distribution.pending ?? 0, 'text-amber-600 dark:text-amber-400'],
    ['正常用户', distribution.active ?? 0, 'text-emerald-600 dark:text-emerald-400']
  ] as const;
  const deviceMetrics = [
    ['成功', overview?.device_usage.successful ?? 0], ['失败/取消', overview?.device_usage.failed ?? 0],
    ['待审批', overview?.device_usage.pending ?? 0], ['已归还', overview?.device_usage.returned ?? 0],
    ['使用中', overview?.device_usage.in_use ?? 0], ['逾期', overview?.device_usage.overdue ?? 0], ['异常', overview?.device_usage.abnormal ?? 0]
  ] as const;

  return (
    <Card className="ops-card overflow-hidden">
      <CardContent className="space-y-5 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div><h2 className="text-base font-semibold text-foreground">用户运营概览</h2><p className="mt-1 text-xs text-muted-foreground">注册、审核与设备使用情况仅对最高管理员可见</p></div>
          {query.isLoading ? <span className="text-xs text-muted-foreground">正在加载…</span> : null}
        </div>
        {query.error ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">运营概览加载失败：{toFriendlyError(query.error)}</p> : <>
          <section aria-label="用户统计" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {userMetrics.map(([label, value, tone]) => <div key={label} className="rounded-lg border border-border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className={'mt-1 text-2xl font-bold tabular-nums ' + tone}>{value}</p></div>)}
          </section>
          <section aria-labelledby="registration-trend-heading" className="rounded-lg border border-border bg-muted/15 p-3">
            <div className="mb-3 flex items-baseline justify-between gap-2"><h3 id="registration-trend-heading" className="text-sm font-semibold text-foreground">近 14 天注册趋势</h3><span className="text-xs text-muted-foreground">每日新增</span></div>
            {trend.length ? <div className="grid h-24 grid-cols-[repeat(14,minmax(0,1fr))] items-end gap-1" aria-label="近十四天每日注册人数">
              {trend.slice(-14).map((point) => <div key={point.date} className="flex h-full min-w-0 flex-col justify-end gap-1 text-center" title={point.date + '：' + point.count + ' 人'}><span className="text-[10px] font-medium tabular-nums text-foreground">{point.count || ''}</span><span className="min-h-1 rounded-sm bg-primary/75" style={{ height: Math.max(4, Math.round((point.count / maxTrendCount) * 64)) + 'px' }} /><span className="truncate text-[9px] text-muted-foreground">{formatDate(point.date)}</span></div>)}
            </div> : <p className="py-4 text-center text-sm text-muted-foreground">暂无近 14 天注册数据</p>}
          </section>
          <section aria-labelledby="device-usage-heading"><h3 id="device-usage-heading" className="mb-3 text-sm font-semibold text-foreground">设备使用汇总</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {deviceMetrics.map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-card px-3 py-2"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</p></div>)}
          </div></section>
          <section aria-labelledby="recent-users-heading">
            <div className="mb-3 flex items-baseline justify-between gap-2"><h3 id="recent-users-heading" className="text-sm font-semibold text-foreground">最近注册用户</h3><span className="text-xs text-muted-foreground">点击卡片查看用户档案</span></div>
            {users?.rows.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{users.rows.map((user) => <button key={user.id} type="button" onClick={() => onOpenUser(user.id)} className="rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate font-semibold text-foreground">{user.name || user.phone || user.id}</span><span className={'badge-pill shrink-0 ' + statusTone(user.status)}>{STATUS_LABEL[user.status] ?? user.status}</span></div>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div className="min-w-0"><dt className="text-muted-foreground">专业</dt><dd className="truncate text-foreground">{user.major || '-'}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">导师</dt><dd className="truncate text-foreground">{user.mentor_name || '-'}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">学号</dt><dd className="truncate text-foreground">{user.student_no || '-'}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">注册时间</dt><dd className="truncate text-foreground">{formatDate(user.created_at)}</dd></div></dl>
            </button>)}</div> : <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">暂无最近注册用户</p>}
          </section>
        </>}
      </CardContent>
    </Card>
  );
}
function UserDetailPanel({ user, detail }: { user: AdminUser; detail?: AdminUserDetail }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="user-detail-grid">
        <Info label="状态" value={user.is_banned ? '已封禁' : STATUS_LABEL[user.status] ?? user.status ?? '-'} />
        <Info label="角色" value={ROLE_LABEL[user.role] ?? user.role ?? '-'} />
        <Info label="手机" value={user.phone || '-'} />
        <Info label="学号" value={user.student_no || '-'} />
        <Info label="专业" value={user.major || '-'} />
        <Info label="导师" value={user.mentor_name || '-'} />
        <Info label="微信" value={user.wechat_bound ? user.wechat_nickname || '已绑' : '未绑'} />
        <Info label="最近登录" value={formatTime(user.last_login_at)} />
        <Info label="注册" value={formatTime(user.created_at)} />
        {(user.status === 'rejected' || user.status === 'disabled') && user.disabled_reason && (
          <Info label={user.status === 'rejected' ? '驳回原因' : '停用原因'} value={user.disabled_reason} />
        )}
      </dl>
      <FulfillmentPanel fulfillment={detail?.fulfillment} />
      <div className="space-y-3 border-t pt-4">
        {DETAIL_SECTIONS.map((section) => {
          const rows = Array.isArray(detail?.[section.key]) ? detail?.[section.key] ?? [] : [];
          return (
            <UserRecordSection key={section.key} sectionKey={section.key} label={section.label} rows={rows} />
          );
        })}
      </div>
    </div>
  );
}

function UserRecordSection({
  sectionKey,
  label,
  rows
}: {
  sectionKey: (typeof DETAIL_SECTIONS)[number]['key'];
  label: string;
  rows: Array<Record<string, unknown>>;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const visible = rows.slice(0, 12);
  return (
    <div className="rounded-lg border bg-muted/20 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs text-muted-foreground">{rows.length}</span>
      </div>
      {visible.length ? (
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {visible.map((row, index) => {
            const id = String(row.id || row.item_id || `${sectionKey}-${index}`);
            const open = expandedId === id;
            const summary = formatRecordSummary(sectionKey, row);
            return (
              <div key={id} className={`user-record-item ${open ? 'user-record-item--open' : ''}`}>
                <button
                  type="button"
                  className="user-record-summary"
                  onClick={() => setExpandedId(open ? null : id)}
                >
                  <span className="user-record-summary-main">{summary.title}</span>
                  <span className="user-record-summary-meta">
                    {summary.badge ? <span className={`badge-pill ${summary.badgeTone || 'badge-muted'}`}>{summary.badge}</span> : null}
                    {summary.time ? <span className="user-record-time">{summary.time}</span> : null}
                    <span className="user-record-chevron">{open ? '收起' : '详情'}</span>
                  </span>
                </button>
                {open ? (
                  <div className="user-record-detail">
                    {formatRecordDetails(sectionKey, row).map((item) => (
                      <div key={item.label} className="user-record-detail-row">
                        <span>{item.label}</span>
                        <p>{item.value}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          {rows.length > visible.length ? (
            <p className="px-1 pt-1 text-[11px] text-muted-foreground">仅显示最近 {visible.length} 条</p>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">暂无记录</p>
      )}
    </div>
  );
}

function FulfillmentPanel({ fulfillment }: { fulfillment?: AdminUserDetail['fulfillment'] }) {
  if (!fulfillment) return null;
  const restricted = fulfillment.restriction_status === 'restricted';
  return (
    <section className="rounded-lg border bg-muted/15 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">履约</h3>
        <span className={restricted ? 'badge-pill badge-warn' : 'badge-pill badge-success'}>{restricted ? '受限' : '正常'}</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        <Mini label="完成" value={String(fulfillment.normal_completed_count || 0)} />
        <Mini label="取消" value={String(fulfillment.cancelled_count || 0)} />
        <Mini label="爽约" value={String(fulfillment.no_show_count || 0)} />
        <Mini label="逾期" value={String(fulfillment.overdue_count || 0)} />
        <Mini label="异常" value={String(fulfillment.abnormal_return_count || 0)} />
        <Mini label="待补" value={String(fulfillment.pending_material_count || 0)} />
        <Mini label="未补" value={String(fulfillment.material_default_count || 0)} />
      </div>
      {restricted ? (
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
          {fulfillment.restriction_reason || '需复核'}
          {fulfillment.restriction_until ? ` · 至 ${formatTime(fulfillment.restriction_until)}` : ''}
        </p>
      ) : fulfillment.latest_no_show_reason ? (
        <p className="mt-2 text-xs text-muted-foreground">近爽约：{fulfillment.latest_no_show_reason}</p>
      ) : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="user-detail-item">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="user-mini-stat">
      <p>{label}</p>
      <strong>{value}</strong>
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
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const nowY = new Date().getFullYear();
  return y === nowY ? `${m}/${d}` : `${String(y).slice(2)}/${m}/${d}`;
}

function formatTime(value?: string | null) {
  return briefDateTime(value);
}

const REQUEST_CATEGORY_LABEL: Record<string, string> = {
  feature: '功能建议',
  reservation: '预约/借还',
  device: '设备相关',
  account: '账号/权限',
  rule: '规则说明',
  maintenance: '维护排查',
  ui: '交互体验',
  access: '访问权限',
  safety: '安全归还',
  other: '其他'
};

const REQUEST_PRIORITY_LABEL: Record<string, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急'
};

const REQUEST_STATUS_LABEL: Record<string, string> = {
  pending: '待确认',
  confirmed: '已确认',
  change_requested: '申请修改',
  rejected: '已驳回',
  closed: '已关闭',
  cancelled: '已撤回'
};

const RESERVATION_STATUS_LABEL: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
  in_use: '使用中',
  completed: '已完成',
  no_show: '缺席',
  faulted: '异常结束'
};

const RETURN_CONDITION_LABEL: Record<string, string> = {
  normal: '正常',
  abnormal: '异常',
  minor_scratch: '轻微划痕',
  temperature_unstable: '温度不稳',
  missing_accessory: '配件缺失',
  appearance_damage: '外观损坏',
  operation_abnormal: '运行异常',
  other: '其他异常'
};

const BORROW_STATUS_LABEL: Record<string, string> = {
  in_use: '使用中',
  returned: '已归还',
  overdue: '逾期',
  abnormal_pending: '异常待处理'
};

const FAULT_STATUS_LABEL: Record<string, string> = {
  open: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭'
};

function statusBadgeTone(status?: string) {
  if (!status) return 'badge-muted';
  if (['pending', 'change_requested', 'open', 'processing', 'abnormal_pending', 'overdue'].includes(status)) return 'badge-warn';
  if (['confirmed', 'approved', 'active', 'returned', 'completed', 'resolved', 'closed'].includes(status)) return 'badge-success';
  if (['rejected', 'cancelled', 'banned', 'no_show', 'faulted'].includes(status)) return 'badge-danger';
  if (['in_use'].includes(status)) return 'badge-info';
  return 'badge-muted';
}

function labelStatus(map: Record<string, string>, status?: unknown) {
  const key = String(status || '');
  return map[key] || key || '-';
}

function textOf(value: unknown, fallback = '-') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

function formatRecordSummary(sectionKey: string, row: Record<string, unknown>) {
  if (sectionKey === 'requests') {
    const title = textOf(row.title || '诉求');
    const device = [row.device_name, row.device_code].filter(Boolean).map(String).join(' · ');
    return {
      title: device && device !== title ? `${title} · ${device}` : title,
      badge: labelStatus(REQUEST_STATUS_LABEL, row.status),
      badgeTone: statusBadgeTone(String(row.status || '')),
      time: formatTime(String(row.created_at || ''))
    };
  }
  if (sectionKey === 'reservations') {
    const device = [row.device_name, row.device_code].filter(Boolean).map(String).join(' · ') || '预约';
    return {
      title: device,
      badge: labelStatus(RESERVATION_STATUS_LABEL, row.status),
      badgeTone: statusBadgeTone(String(row.status || '')),
      time: formatTime(String(row.start_time || row.created_at || ''))
    };
  }
  if (sectionKey === 'borrows') {
    const device = [row.device_name, row.device_code].filter(Boolean).map(String).join(' · ') || '借还';
    return {
      title: device,
      badge: labelStatus(BORROW_STATUS_LABEL, row.status),
      badgeTone: statusBadgeTone(String(row.status || '')),
      time: formatTime(String(row.borrow_time || row.borrowed_at || row.created_at || ''))
    };
  }
  if (sectionKey === 'fault_reports') {
    const device = [row.device_name, row.device_code].filter(Boolean).map(String).join(' · ') || textOf(row.issue_type, '故障');
    return {
      title: device,
      badge: labelStatus(FAULT_STATUS_LABEL, row.status),
      badgeTone: statusBadgeTone(String(row.status || '')),
      time: formatTime(String(row.created_at || ''))
    };
  }
  // activity
  return {
    title: textOf(row.action || row.event || row.activity_type || row.path || '操作记录'),
    badge: '',
    badgeTone: 'badge-muted',
    time: formatTime(String(row.created_at || ''))
  };
}

function formatRecordDetails(sectionKey: string, row: Record<string, unknown>): Array<{ label: string; value: string }> {
  if (sectionKey === 'requests') {
    return [
      { label: '标题', value: textOf(row.title) },
      { label: '内容', value: textOf(row.description) },
      { label: '设备', value: [row.device_name, row.device_code].filter(Boolean).map(String).join(' · ') || '-' },
      { label: '分类', value: REQUEST_CATEGORY_LABEL[String(row.category || '')] || textOf(row.category) },
      { label: '优先级', value: REQUEST_PRIORITY_LABEL[String(row.priority || '')] || textOf(row.priority) },
      { label: '状态', value: labelStatus(REQUEST_STATUS_LABEL, row.status) },
      { label: '管理员备注', value: textOf(row.admin_note) },
      { label: '修改说明', value: textOf(row.change_request_note) },
      { label: '提交', value: formatTime(String(row.created_at || '')) },
      { label: '更新', value: formatTime(String(row.updated_at || '')) }
    ].filter((item) => item.value && item.value !== '-');
  }
  if (sectionKey === 'reservations') {
    return [
      { label: '设备', value: [row.device_name, row.device_code].filter(Boolean).map(String).join(' · ') || '-' },
      { label: '用途', value: textOf(row.purpose) },
      { label: '状态', value: labelStatus(RESERVATION_STATUS_LABEL, row.status) },
      { label: '时段', value: [formatTime(String(row.start_time || '')), formatTime(String(row.end_time || ''))].filter((v) => v && v !== '—').join(' – ') || '-' },
      { label: '批次状态', value: labelStatus(RESERVATION_STATUS_LABEL, row.batch_status) },
      { label: '备注', value: textOf(row.admin_note || row.note) }
    ].filter((item) => item.value && item.value !== '-');
  }
  if (sectionKey === 'borrows') {
    return [
      { label: '设备', value: [row.device_name, row.device_code].filter(Boolean).map(String).join(' · ') || '-' },
      { label: '状态', value: labelStatus(BORROW_STATUS_LABEL, row.status) },
      { label: '开始', value: formatTime(String(row.borrow_time || row.borrowed_at || '')) },
      { label: '应还', value: formatTime(String(row.expected_return_time || '')) },
      { label: '实还', value: formatTime(String(row.return_time || '')) },
      { label: '归还情况', value: RETURN_CONDITION_LABEL[String(row.return_condition || '')] || textOf(row.return_condition) }
    ].filter((item) => item.value && item.value !== '-');
  }
  if (sectionKey === 'fault_reports') {
    return [
      { label: '设备', value: [row.device_name, row.device_code].filter(Boolean).map(String).join(' · ') || '-' },
      { label: '问题', value: textOf(row.issue_type || row.title) },
      { label: '描述', value: textOf(row.description || row.detail) },
      { label: '状态', value: labelStatus(FAULT_STATUS_LABEL, row.status) },
      { label: '严重级别', value: textOf(row.severity) },
      { label: '上报', value: formatTime(String(row.created_at || '')) }
    ].filter((item) => item.value && item.value !== '-');
  }
  return [
    { label: '操作', value: textOf(row.action || row.event || row.activity_type) },
    { label: '说明', value: textOf(row.detail || row.description || row.message) },
    { label: '路径', value: textOf(row.path) },
    { label: '时间', value: formatTime(String(row.created_at || '')) }
  ].filter((item) => item.value && item.value !== '-');
}
