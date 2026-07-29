import { type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, GraduationCap, ShieldCheck, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OpsEmptyState, OpsPageHeader } from '@/components/ops/design-system';
import { request } from '@/lib/api';
import { briefDateTime } from '@/lib/time-format';
import { toFriendlyError } from '@/lib/friendly-error';
import { useAuth } from '@/features/auth/use-auth';

interface Profile {
  name?: string;
  phone?: string;
  student_no?: string;
  major?: string;
  mentor_name?: string;
  role?: string;
  status?: string;
  created_at?: string;
  wechat_bound?: boolean;
}

const roleName: Record<string, string> = {
  user: '普通用户', admin: '管理员', super_admin: '系统管理员', auditor: '审计员'
};
const statusName: Record<string, string> = {
  active: '正常', pending: '待审核', disabled: '已停用', banned: '已限制'
};

export function ProfilePage() {
  const auth = useAuth();
  const profile = useQuery({
    queryKey: ['my-profile'],
    queryFn: () => request<Profile>('/me'),
    staleTime: 60_000
  });
  const user: Profile = profile.data ?? (auth.me as Profile | null) ?? {};
  const details = [
    { label: '姓名', value: user.name || '—' },
    { label: '手机号 / 账号', value: user.phone || '—' },
    { label: '学号', value: user.student_no || '—' },
    { label: '专业', value: user.major || '—' },
    { label: '导师姓名', value: user.mentor_name || '—' }
  ];

  return (
    <div className="ops-page-stack mx-auto max-w-[1120px]">
      <OpsPageHeader eyebrow="我的账户" title="个人信息" description="查看当前账号的基础资料和账户状态。资料如需修改，请联系管理员。" />
      {profile.isLoading && !profile.data ? <p className="py-10 text-center text-sm text-muted-foreground">加载中…</p> : null}
      {profile.error && !profile.data ? <OpsEmptyState icon={<UserRound />} title="暂时无法加载个人信息" description={toFriendlyError(profile.error)} /> : null}
      {(profile.data || auth.me) ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="ops-card shadow-none">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="h-4 w-4 text-primary" />基础资料</CardTitle></CardHeader>
          <CardContent className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
            {details.map((item) => <div key={item.label} className="border-b border-border py-3.5 last:border-b-0 sm:last:border-b"><p className="text-xs font-medium text-muted-foreground">{item.label}</p><p className="mt-1 break-words text-sm font-semibold">{item.value}</p></div>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" />账户状态</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatusRow icon={<BadgeCheck className="h-4 w-4" />} label="账户角色" value={roleName[user.role || auth.role || 'user'] || user.role || '普通用户'} />
            <StatusRow icon={<BadgeCheck className="h-4 w-4" />} label="账号状态" value={statusName[user.status || 'active'] || user.status || '正常'} />
            <StatusRow icon={<BadgeCheck className="h-4 w-4" />} label="微信绑定" value={user.wechat_bound ? '已绑定' : '未绑定'} />
            <StatusRow icon={<BadgeCheck className="h-4 w-4" />} label="注册时间" value={briefDateTime(user.created_at)} />
          </CardContent>
        </Card>
      </div> : null}
    </div>
  );
}

function StatusRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex min-h-11 items-center justify-between gap-4 border-b border-border py-2.5 last:border-b-0"><span className="flex items-center gap-2 text-muted-foreground">{icon}{label}</span><span className="text-right font-semibold">{value}</span></div>;
}
