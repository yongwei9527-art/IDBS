import { useQuery } from '@tanstack/react-query';
import { MessageCircle, Phone, QrCode } from 'lucide-react';
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
  wechat?: string;
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
  const contacts = (data?.contacts ?? []).filter((contact) => {
    const hasName = Boolean(contact.name?.trim());
    const hasContactMethod = Boolean(contact.phone?.trim() || contact.wechat?.trim() || contact.qrcode_url?.trim());
    return contact.enabled !== false && hasName && hasContactMethod;
  });

  return (
    <div className="ops-page-stack mx-auto max-w-6xl">
      <OpsPageHeader
        title="联系工作人员"
        description="通过电话、微信号或二维码联系实验室工作人员。"
      />

      {isLoading ? <p className="rounded-lg border border-border bg-card py-10 text-center text-sm text-muted-foreground">联系方式加载中…</p> : null}

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {contacts.map((contact) => (
          <Card key={contact.key ?? contact.label ?? contact.phone} className="ops-card overflow-hidden shadow-none">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{contact.label ?? '工作人员'}</CardTitle>
                  {contact.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{contact.description}</p>}
                </div>
                <span className="rounded-md bg-primary/10 p-2 text-primary"><QrCode className="h-4 w-4" /></span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-3">
                <div className={`grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted/25 text-center text-xs text-muted-foreground ${contact.qrcode_url ? '' : 'hidden'}`}>
                  {contact.qrcode_url ? (
                    <img src={contact.qrcode_url} alt={`${contact.label ?? contact.name ?? '工作人员'}微信二维码`} className="h-full w-full object-contain" />
                  ) : (
                    '暂无二维码'
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">姓名</p>
                    <p className="truncate font-semibold">{contact.name}</p>
                  </div>
                  {contact.phone ? <div>
                    <p className="text-xs text-muted-foreground">电话</p>
                    <p className="truncate font-semibold">{contact.phone}</p>
                  </div> : null}
                  {contact.wechat ? <div className="flex items-start gap-1.5">
                    <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">微信号</p>
                      <p className="truncate font-semibold">{contact.wechat}</p>
                    </div>
                  </div> : null}
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
        <Card className="ops-card shadow-none">
          <CardContent className="py-10 text-center text-muted-foreground">暂无联系方式</CardContent>
        </Card>
      )}
    </div>
  );
}
