import { useQuery } from '@tanstack/react-query';
import { Phone, QrCode } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { request } from '@/lib/api';
import { OpsPageHeader } from '@/components/ops/design-system';

type StaffContact = {
  key?: string;
  label?: string;
  description?: string;
  enabled?: boolean;
  name?: string;
  phone?: string;
  qrcode_url?: string;
};

function useStaffContacts() {
  return useQuery({
    queryKey: ['staff-contacts'],
    queryFn: () => request<{ contacts?: StaffContact[] }>('/system/staff-contacts')
  });
}

export function StaffContactsPage() {
  const { data, isLoading } = useStaffContacts();
  const contacts = (data?.contacts ?? []).filter((contact) => contact.enabled !== false);

  return (
    <div className="ops-page-stack">
      <OpsPageHeader
        title="联系工作人员"
      />

      {isLoading ? <p className="rounded-2xl border bg-card/70 py-8 text-center text-sm text-muted-foreground">联系方式加载中…</p> : null}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {contacts.map((contact) => (
          <Card key={contact.key ?? contact.label ?? contact.phone} className="ops-card overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{contact.label ?? '工作人员'}</CardTitle>
                  {contact.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{contact.description}</p>}
                </div>
                <span className="rounded-2xl bg-primary/10 p-2 text-primary"><QrCode className="h-4 w-4" /></span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <div className="grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-2xl border bg-muted/35 text-center text-xs text-muted-foreground">
                  {contact.qrcode_url ? (
                    <img src={contact.qrcode_url} alt={`${contact.label ?? contact.name ?? '工作人员'}微信二维码`} className="h-full w-full object-contain" />
                  ) : (
                    '暂无二维码'
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">姓名</p>
                    <p className="truncate font-semibold">{contact.name || '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">电话</p>
                    <p className="truncate font-semibold">{contact.phone || '-'}</p>
                  </div>
                </div>
              </div>
              {contact.phone && (
                <Button variant="outline" className="w-full" onClick={() => { window.location.href = `tel:${contact.phone}`; }}>
                  <Phone className="h-4 w-4" /> 拨打电话
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {!isLoading && contacts.length === 0 && (
        <Card className="ops-card">
          <CardContent className="py-10 text-center text-muted-foreground">暂无联系方式</CardContent>
        </Card>
      )}
    </div>
  );
}
