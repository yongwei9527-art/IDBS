import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Activity, AlertTriangle, CalendarCheck, MonitorCheck, RefreshCw, UsersRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { request } from '@/lib/api';
import { toFriendlyError } from '@/lib/friendly-error';

export function DashboardPlaceholder() {
  const dashboard = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => request<DashboardData>('/admin/dashboard')
  });
  const kpi = dashboard.data?.kpi ?? {};
  const status = dashboard.data?.device_status ?? {};
  const cards = [
    { title: '待审预约', value: kpi.pending_reservations ?? 0, icon: CalendarCheck, tone: 'text-amber-600' },
    { title: '可用设备', value: kpi.available_devices ?? 0, icon: MonitorCheck, tone: 'text-emerald-600' },
    { title: '异常设备', value: kpi.abnormal_devices ?? 0, icon: AlertTriangle, tone: 'text-rose-600' },
    { title: '未读消息', value: kpi.unread_chat_messages ?? 0, icon: Activity, tone: 'text-blue-600' }
  ];

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">后台总览</h1>
          <p className="text-sm text-muted-foreground">IDBS 5.0 工作台</p>
        </div>
        <Button variant="outline" onClick={() => dashboard.refetch()} disabled={dashboard.isFetching}>
          <RefreshCw className="mr-2 h-4 w-4" />
          刷新
        </Button>
      </div>
      {dashboard.error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="pt-6 text-sm text-destructive">
            {toFriendlyError(dashboard.error, '加载工作台失败')}
          </CardContent>
        </Card>
      )}
      <div className="grid auto-rows-min gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((item) => (
          <Card key={item.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{item.title}</CardTitle>
              <item.icon className={`h-4 w-4 ${item.tone}`} />
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>设备状态</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 text-sm">
              {Object.entries(status).length ? Object.entries(status).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                  <span className="text-muted-foreground">{statusLabel(key)}</span>
                  <strong className="tabular-nums">{value}</strong>
                </div>
              )) : (
                <p className="text-muted-foreground">暂无设备状态数据。</p>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>今日运行</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              <Metric label="今日预约" value={kpi.today_reservations ?? 0} />
              <Metric label="本周使用" value={kpi.week_usage_count ?? 0} />
              <Metric label="待审用户" value={kpi.pending_users ?? 0} icon={<UsersRound className="h-4 w-4" />} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function statusLabel(value: string) {
  const map: Record<string, string> = {
    available: '可用',
    in_use: '使用中',
    maintenance: '维护',
    disabled: '停用',
    abnormal_pending: '异常待处理'
  };
  return map[value] ?? value;
}

interface DashboardData {
  kpi?: Record<string, number>;
  device_status?: Record<string, number>;
}
