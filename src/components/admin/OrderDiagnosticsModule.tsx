import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, AlertTriangle, Mail, RefreshCw, Search, Zap, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type OrderRow = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  total_amount: number | string;
  status: string | null;
  payment_status: string | null;
  created_at: string;
};

type EmailRow = {
  message_id: string | null;
  template_name: string;
  recipient_email: string;
  status: string;
  error_message: string | null;
  created_at: string;
  metadata: any;
};

type AuditRow = {
  order_id: string;
  event_type: string;
  metadata: any;
  created_at: string;
};

const StatusPill = ({ ok, label, warn }: { ok: boolean; label: string; warn?: boolean }) => (
  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
    ok
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : warn
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200"
  }`}>
    {ok ? <CheckCircle2 className="h-3 w-3" /> : warn ? <AlertTriangle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
    {label}
  </span>
);

const OrderDiagnosticsModule = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [emails, setEmails] = useState<Record<string, EmailRow[]>>({});
  const [webhooks, setWebhooks] = useState<Record<string, AuditRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: orderRows } = await supabase
      .from("orders")
      .select("id, customer_name, customer_email, total_amount, status, payment_status, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    const rows = (orderRows ?? []) as OrderRow[];
    setOrders(rows);

    const ids = rows.map((r) => r.id);
    if (ids.length) {
      // Emails for these orders — filter via message_id prefix.
      const orFilter = ids.map((id) => `message_id.like.order-notify-${id}%`).join(",");
      const [{ data: emailRows }, { data: auditRows }] = await Promise.all([
        supabase.from("email_send_log")
          .select("message_id, template_name, recipient_email, status, error_message, created_at, metadata")
          .or(orFilter)
          .order("created_at", { ascending: false }),
        supabase.from("order_audit_log" as any)
          .select("order_id, event_type, metadata, created_at")
          .in("order_id", ids)
          .like("event_type", "yoco.%")
          .order("created_at", { ascending: false }),
      ]);

      const emailMap: Record<string, EmailRow[]> = {};
      (emailRows as EmailRow[] | null)?.forEach((row) => {
        const orderId = row.metadata?.orderId ?? row.message_id?.split("-")[2];
        if (!orderId) return;
        (emailMap[orderId] ||= []).push(row);
      });
      setEmails(emailMap);

      const auditMap: Record<string, AuditRow[]> = {};
      (auditRows as unknown as AuditRow[] | null)?.forEach((row) => {
        (auditMap[row.order_id] ||= []).push(row);
      });
      setWebhooks(auditMap);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => orders.filter((o) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return o.id.toLowerCase().includes(s)
      || (o.customer_email ?? "").toLowerCase().includes(s)
      || (o.customer_name ?? "").toLowerCase().includes(s);
  }), [orders, search]);

  const resend = async (orderId: string) => {
    setResendingId(orderId);
    const { error, data } = await supabase.functions.invoke("notify-order", { body: { orderId } });
    if (error) {
      toast({ title: "Resend failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Resend triggered", description: (data as any)?.sent ? "Emails sent" : "Function ran (see log)" });
    }
    setResendingId(null);
    load();
  };

  const kpis = useMemo(() => {
    const paid = orders.filter((o) => o.payment_status === "paid").length;
    const missingEmail = orders.filter((o) => (emails[o.id] ?? []).every((e) => e.status !== "sent")).length;
    const missingWebhook = orders.filter((o) => (webhooks[o.id] ?? []).length === 0).length;
    return { paid, missingEmail, missingWebhook, total: orders.length };
  }, [orders, emails, webhooks]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Orders (recent)", kpis.total, CreditCard, "bg-primary/10 text-primary"],
          ["Paid", kpis.paid, CheckCircle2, "bg-emerald-100 text-emerald-700"],
          ["Missing customer email", kpis.missingEmail, Mail, "bg-amber-100 text-amber-700"],
          ["No Yoco webhook", kpis.missingWebhook, Zap, "bg-red-100 text-red-700"],
        ].map(([label, value, Icon, accent]: any) => (
          <div key={label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg ${accent}`}><Icon className="h-4 w-4" /></div>
            <div>
              <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
              <p className="text-lg font-display font-extrabold">{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order id, email, name..." className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-card text-sm outline-none focus:border-primary" />
        </div>
        <button onClick={load} className="px-3 py-2 rounded-lg border border-input bg-card text-sm font-display font-semibold flex items-center gap-1.5 hover:bg-muted">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-display font-bold text-sm">Order diagnostics — payment, webhook & email</h3>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading diagnostics…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No orders match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-display font-bold">Order</th>
                  <th className="text-left px-4 py-2 font-display font-bold">Payment</th>
                  <th className="text-left px-4 py-2 font-display font-bold">Yoco webhook</th>
                  <th className="text-left px-4 py-2 font-display font-bold">Customer email</th>
                  <th className="text-left px-4 py-2 font-display font-bold">Owner email</th>
                  <th className="text-right px-4 py-2 font-display font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filtered.map((o) => {
                  const orderEmails = emails[o.id] ?? [];
                  const cust = orderEmails.find((e) => e.metadata?.role === "customer" || e.message_id?.endsWith("customer"));
                  const owner = orderEmails.find((e) => e.metadata?.role === "owner" || e.message_id?.endsWith("owner"));
                  const wh = (webhooks[o.id] ?? [])[0];
                  return (
                    <tr key={o.id} className="hover:bg-muted/20 align-top">
                      <td className="px-4 py-3">
                        <p className="font-mono text-[11px] text-muted-foreground">#{o.id.slice(0, 8)}</p>
                        <p className="font-semibold text-[13px]">{o.customer_name || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">{o.customer_email}</p>
                        <p className="text-[11px] text-muted-foreground">{new Date(o.created_at).toLocaleString()}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill ok={o.payment_status === "paid"} warn={o.payment_status !== "paid" && o.payment_status !== null} label={o.payment_status || "unpaid"} />
                      </td>
                      <td className="px-4 py-3">
                        {wh ? (
                          <>
                            <StatusPill ok={wh.event_type === "yoco.payment.succeeded"} warn={wh.event_type.includes("failed")} label={wh.event_type.replace("yoco.", "")} />
                            <p className="text-[10px] text-muted-foreground mt-1">{new Date(wh.created_at).toLocaleString()}</p>
                          </>
                        ) : (
                          <StatusPill ok={false} warn label="none received" />
                        )}
                      </td>
                      {[cust, owner].map((e, i) => (
                        <td key={i} className="px-4 py-3">
                          {e ? (
                            <>
                              <StatusPill ok={e.status === "sent"} warn={e.status === "pending"} label={e.status} />
                              <p className="text-[10px] text-muted-foreground mt-1">{new Date(e.created_at).toLocaleString()}</p>
                              {e.error_message && <p className="text-[10px] text-red-600 mt-0.5 max-w-[200px] truncate" title={e.error_message}>{e.error_message}</p>}
                            </>
                          ) : (
                            <StatusPill ok={false} warn label="not sent" />
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => resend(o.id)}
                          disabled={resendingId === o.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-input bg-card text-[11px] font-display font-semibold hover:bg-muted disabled:opacity-50"
                        >
                          <Mail className="h-3 w-3" />
                          {resendingId === o.id ? "Sending…" : "Resend notify-order"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderDiagnosticsModule;
