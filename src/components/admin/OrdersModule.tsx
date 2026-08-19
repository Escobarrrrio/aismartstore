import { useMemo, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, RefreshCw, Truck, ChevronDown, ChevronUp, Mail, ShoppingCart, Clock, CheckCircle2, DollarSign, XCircle, History, Download, Printer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// Packing-slip style address label -- a supplement to whatever waybill
// Courier Guy's own app generates at collection, not a replacement for it.
// Opens a plain, self-contained print window (no app CSS/JS dependency)
// so it prints cleanly regardless of screen size or theme.
function printShippingLabel(order: any, dispatchCity: string) {
  const itemLines = (order.order_items || [])
    .map((item: any) => `<div class="item">${escapeHtml(item.products?.name || "Product")} &times; ${item.quantity}</div>`)
    .join("");

  const html = `<!doctype html>
<html><head><title>Shipping Label — Order #${escapeHtml(order.id.slice(0, 8).toUpperCase())}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 24px; color: #111; }
  .label { max-width: 480px; border: 2px solid #111; border-radius: 8px; padding: 20px; }
  .section { margin-bottom: 14px; }
  .caption { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #666; margin-bottom: 4px; }
  .name { font-size: 18px; font-weight: 700; }
  .addr { font-size: 14px; line-height: 1.5; }
  .divider { border-top: 2px dashed #999; margin: 16px 0; }
  .meta { font-size: 12px; color: #444; }
  .item { font-size: 13px; padding: 2px 0; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <div class="label">
    <div class="section">
      <div class="caption">From</div>
      <div class="addr">AI Smart Store<br/>Dispatched from ${escapeHtml(dispatchCity)}</div>
    </div>
    <div class="divider"></div>
    <div class="section">
      <div class="caption">To</div>
      <div class="name">${escapeHtml(order.customer_name)}</div>
      <div class="addr">${escapeHtml(order.address)}<br/>${escapeHtml(order.city)}, ${escapeHtml(order.postal_code)}<br/>${escapeHtml(order.customer_phone || "")}</div>
    </div>
    <div class="divider"></div>
    <div class="section meta">
      Order #${escapeHtml(order.id.slice(0, 8).toUpperCase())} &middot; ${new Date(order.created_at).toLocaleDateString("en-ZA")}
      ${order.tracking_number ? `<br/>Tracking: ${escapeHtml(order.tracking_number)}` : ""}
    </div>
    ${itemLines ? `<div class="section"><div class="caption">Contents</div>${itemLines}</div>` : ""}
  </div>
  <script>window.onload = () => window.print();</script>
</body></html>`;

  const win = window.open("", "_blank", "width=560,height=720");
  if (!win) return;
  win.document.write(html);
  win.document.close();
}


interface OrdersModuleProps {
  orders: any[];
  onReload: () => void;
}

const statusOptions = ["pending", "paid", "packed", "shipped", "delivered", "returned", "cancelled"];

// Fulfilment happy path, in order. Used for the per-order progress strip so an
// admin can see at a glance where a parcel sits without reading the audit log.
const FULFILMENT_STEPS = ["pending", "paid", "packed", "shipped", "delivered"] as const;
const paymentOptions = ["unpaid", "paid", "refunded", "partially_refunded"];

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    packed: "bg-indigo-50 text-indigo-700 border-indigo-200",
    shipped: "bg-blue-50 text-blue-700 border-blue-200",
    delivered: "bg-teal-50 text-teal-700 border-teal-200",
    returned: "bg-red-50 text-red-700 border-red-200",
    cancelled: "bg-slate-100 text-slate-600 border-slate-200",
    unpaid: "bg-gray-50 text-gray-600 border-gray-200",
    refunded: "bg-purple-50 text-purple-700 border-purple-200",
    partially_refunded: "bg-orange-50 text-orange-700 border-orange-200",
  };
  return map[status] || "bg-muted text-muted-foreground border-border";
};

const OrdersModule = ({ orders, onReload }: OrdersModuleProps) => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [auditByOrder, setAuditByOrder] = useState<Record<string, any[]>>({});
  const [auditEventFilter, setAuditEventFilter] = useState("");
  const [exportingAudit, setExportingAudit] = useState(false);
  const [dispatchCity, setDispatchCity] = useState("Gqeberha");

  const AUDIT_EVENT_TYPES = ["order_created", "status_changed", "payment_status_changed", "tracking_updated"];

  useEffect(() => {
    supabase.from("store_settings").select("value").eq("key", "dispatch_city").maybeSingle()
      .then(({ data }) => { if (data?.value) setDispatchCity(data.value); });
  }, []);

  useEffect(() => {
    if (!expandedId || auditByOrder[expandedId]) return;
    supabase
      .from("order_audit_log" as any)
      .select("*")
      .eq("order_id", expandedId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setAuditByOrder((m) => ({ ...m, [expandedId]: (data as any[]) || [] })));
  }, [expandedId]);

  const filtered = orders.filter((o) => {
    const matchSearch = !search || o.customer_name?.toLowerCase().includes(search.toLowerCase()) || o.customer_email?.toLowerCase().includes(search.toLowerCase()) || o.id.includes(search);
    const matchStatus = !statusFilter || o.order_status === statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Every fulfilment move writes the status AND tells the customer. Silently
  // swallowing the update error (the old behaviour) meant a failed write looked
  // identical to a successful one until the next reload contradicted it.
  const updateOrderStatus = async (
    id: string,
    field: "order_status" | "payment_status" | "status",
    value: string,
    opts: { notify?: boolean } = {},
  ) => {
    const { error } = await supabase.from("orders").update({ [field]: value } as any).eq("id", id);
    if (error) {
      toast({ title: "Could not update order", description: error.message, variant: "destructive" });
      return;
    }
    onReload();
    toast({ title: `Order marked ${value.replace(/_/g, " ")}` });

    if (opts.notify) {
      const { error: mailError } = await supabase.functions.invoke("notify-order", {
        body: { orderId: id, event: "status_update", status: value },
      });
      if (mailError) {
        toast({
          title: "Status saved, customer not notified",
          description: mailError.message,
          variant: "destructive",
        });
      } else {
        toast({ title: "Customer notified by email" });
      }
    }
  };

  const updateTracking = async (id: string, tracking: string) => {
    await supabase.from("orders").update({ tracking_number: tracking }).eq("id", id);
    toast({ title: "Tracking number saved" });
  };

  const resendNotification = async (id: string) => {
    const { error } = await supabase.functions.invoke("notify-order", { body: { orderId: id } });
    if (error) toast({ title: "Failed to resend", description: error.message, variant: "destructive" });
    else toast({ title: "Confirmation re-sent" });
  };

  const exportAuditCsv = async () => {
    setExportingAudit(true);
    try {
      // Scope the export to the currently filtered orders so admins can pull
      // audit trails for the subset they're looking at, not the full 5k dump.
      const scopedOrderIds = filtered.map((o) => o.id);
      let query = supabase
        .from("order_audit_log" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (scopedOrderIds.length > 0 && scopedOrderIds.length < orders.length) {
        query = query.in("order_id", scopedOrderIds);
      }
      if (auditEventFilter) query = query.eq("event_type", auditEventFilter);
      const { data, error } = await query;
      if (error) throw error;
      const rows = (data as any[]) || [];
      const headers = ["created_at", "order_id", "event_type", "from_value", "to_value", "actor_id"];
      const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const scope = scopedOrderIds.length && scopedOrderIds.length < orders.length ? "-filtered" : "";
      a.download = `order-audit${scope}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `Exported ${rows.length} audit entries` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally {
      setExportingAudit(false);
    }
  };

  const kpis = useMemo(() => {
    const total = orders.length;
    const pending = orders.filter((o) => (o.order_status || o.status) === "pending").length;
    const shipped = orders.filter((o) => (o.order_status || o.status) === "shipped").length;
    const revenue = orders
      .filter((o) => (o.payment_status || "") === "paid")
      .reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
    return { total, pending, shipped, revenue };
  }, [orders]);

  const kpiCard = (label: string, value: string | number, Icon: any, accent: string) => (
    <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${accent}`}><Icon className="h-4 w-4" /></div>
      <div>
        <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
        <p className="text-lg font-display font-extrabold">{value}</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpiCard("Total", kpis.total, ShoppingCart, "bg-primary/10 text-primary")}
        {kpiCard("Pending", kpis.pending, Clock, "bg-amber-100 text-amber-700")}
        {kpiCard("Shipped", kpis.shipped, CheckCircle2, "bg-blue-100 text-blue-700")}
        {kpiCard("Revenue (paid)", `R${kpis.revenue.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}`, DollarSign, "bg-emerald-100 text-emerald-700")}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search orders..." className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-card text-sm focus:border-primary outline-none transition" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-input bg-card text-sm">
          <option value="">All Status</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <button onClick={onReload} className="px-3 py-2 rounded-lg border border-input bg-card text-sm font-display font-semibold flex items-center gap-1.5 hover:bg-muted transition-colors">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
        <button onClick={exportAuditCsv} disabled={exportingAudit} className="px-3 py-2 rounded-lg border border-input bg-card text-sm font-display font-semibold flex items-center gap-1.5 hover:bg-muted transition-colors disabled:opacity-50">
          <Download className="h-3.5 w-3.5" /> {exportingAudit ? "Exporting…" : "Export audit CSV"}
        </button>
      </div>


      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="divide-y divide-border/50">
          {filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">No orders found.</p>
          ) : (
            filtered.map((order) => {
              const isExpanded = expandedId === order.id;
              return (
                <div key={order.id} className="hover:bg-muted/20 transition-colors">
                  <button onClick={() => setExpandedId(isExpanded ? null : order.id)} className="w-full px-5 py-3.5 flex items-center gap-4 text-left">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">{order.customer_name}</p>
                        <span className="text-[10px] text-muted-foreground font-mono">#{order.id.slice(0, 8)}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{order.customer_email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${statusBadge(order.order_status || order.status)}`}>
                        {order.order_status || order.status}
                      </span>
                      <span className="text-sm font-display font-bold min-w-[80px] text-right">R{Number(order.total_amount).toFixed(2)}</span>
                      <span className="text-[11px] text-muted-foreground min-w-[80px] text-right">{new Date(order.created_at).toLocaleDateString()}</span>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-4 pt-0 border-t border-border/30 bg-muted/10 animate-in fade-in slide-in-from-top-1 duration-150">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-3">
                        {/* Customer info */}
                        <div>
                          <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Customer</p>
                          <p className="text-sm">{order.customer_name}</p>
                          <p className="text-xs text-muted-foreground">{order.customer_email}</p>
                          <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
                          <p className="text-xs text-muted-foreground mt-1">{order.address}, {order.city}, {order.postal_code}</p>
                        </div>

                        {/* Status controls */}
                        <div>
                          <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Status</p>
                          <div className="space-y-2">
                            <div>
                              <label className="text-[10px] font-semibold text-muted-foreground">Order Status</label>
                              <select
                                value={order.order_status || order.status || "pending"}
                                onChange={(e) => updateOrderStatus(order.id, "order_status", e.target.value, { notify: true })}
                                className="w-full mt-0.5 px-2 py-1.5 rounded-md border border-input bg-card text-xs"
                              >
                                {statusOptions.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-semibold text-muted-foreground">Payment</label>
                              <select
                                value={order.payment_status || "unpaid"}
                                onChange={(e) => updateOrderStatus(order.id, "payment_status", e.target.value)}
                                className="w-full mt-0.5 px-2 py-1.5 rounded-md border border-input bg-card text-xs"
                              >
                                {paymentOptions.map((s) => <option key={s} value={s}>{s.replace("_", " ").charAt(0).toUpperCase() + s.replace("_", " ").slice(1)}</option>)}
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* Tracking */}
                        <div>
                          <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Tracking</p>
                          <div className="flex gap-2">
                            <input
                              defaultValue={order.tracking_number || ""}
                              placeholder="Enter tracking number"
                              onBlur={(e) => updateTracking(order.id, e.target.value)}
                              className="flex-1 px-2 py-1.5 rounded-md border border-input bg-card text-xs"
                            />
                            <div className="p-1.5 rounded-md bg-primary/10 text-primary"><Truck className="h-3.5 w-3.5" /></div>
                          </div>
                          <button
                            onClick={() => resendNotification(order.id)}
                            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-input bg-card text-[11px] font-display font-semibold hover:bg-muted transition-colors"
                          >
                            <Mail className="h-3 w-3" /> Resend confirmation email
                          </button>
                          <button
                            onClick={() => printShippingLabel(order, dispatchCity)}
                            className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md border border-input bg-card text-[11px] font-display font-semibold hover:bg-muted transition-colors"
                          >
                            <Printer className="h-3 w-3" /> Print shipping label
                          </button>
                        </div>
                      </div>

                      {/* Quick actions */}
                      <div className="flex flex-wrap gap-2 pt-2 pb-1">
                        <button
                          onClick={() => updateOrderStatus(order.id, "payment_status", "paid")}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-display font-semibold hover:bg-emerald-100 transition-colors"
                        >
                          <CheckCircle2 className="h-3 w-3" /> Mark paid
                        </button>
                        <button
                          onClick={() => updateOrderStatus(order.id, "order_status", "packed", { notify: true })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-display font-semibold hover:bg-indigo-100 transition-colors"
                        >
                          <PackageCheck className="h-3 w-3" /> Mark packed
                        </button>
                        <button
                          onClick={() => updateOrderStatus(order.id, "order_status", "shipped", { notify: true })}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-display font-semibold hover:bg-blue-100 transition-colors"
                        >
                          <Truck className="h-3 w-3" /> Mark shipped
                        </button>
                        <button
                          onClick={() => {
                            if (confirm("Cancel this order? The customer will need to be refunded manually via Yoco/PayPal.")) {
                              updateOrderStatus(order.id, "order_status", "cancelled");
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-red-50 text-red-700 border border-red-200 text-[11px] font-display font-semibold hover:bg-red-100 transition-colors"
                        >
                          <XCircle className="h-3 w-3" /> Cancel order
                        </button>
                      </div>

                      {/* Items */}
                      {order.order_items?.length > 0 && (
                        <div className="border-t border-border/30 pt-3 mt-1">
                          <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Items</p>
                          {order.order_items.map((item: any) => (
                            <div key={item.id} className="flex items-center justify-between text-xs py-1">
                              <span>{item.products?.name || "Product"} × {item.quantity}</span>
                              <span className="font-display font-bold">R{Number(item.unit_price * item.quantity).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Audit trail */}
                      <div className="border-t border-border/30 pt-3 mt-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                            <History className="h-3 w-3" /> Audit trail
                          </p>
                          <select
                            value={auditEventFilter}
                            onChange={(e) => setAuditEventFilter(e.target.value)}
                            className="px-2 py-0.5 rounded-md border border-input bg-card text-[10px]"
                          >
                            <option value="">All events</option>
                            {AUDIT_EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                          </select>
                        </div>
                        {!auditByOrder[order.id] ? (
                          <p className="text-[11px] text-muted-foreground">Loading…</p>
                        ) : (() => {
                          const filtered = auditByOrder[order.id].filter((e) => !auditEventFilter || e.event_type === auditEventFilter);
                          if (filtered.length === 0) return <p className="text-[11px] text-muted-foreground">No entries match.</p>;
                          return (
                            <div className="space-y-1">
                              {filtered.map((e) => (
                                <div key={e.id} className="flex items-center justify-between text-[11px] py-0.5">
                                  <span className="text-muted-foreground">
                                    <span className="font-mono">{new Date(e.created_at).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}</span>
                                    {" · "}
                                    <span className="font-semibold text-foreground">{e.event_type}</span>
                                    {e.from_value || e.to_value ? (
                                      <> · {e.from_value ?? "∅"} → {e.to_value ?? "∅"}</>
                                    ) : null}
                                  </span>
                                  <span className="text-muted-foreground">{e.actor_email || (e.actor_id ? "admin" : "system")}</span>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="px-4 py-2.5 bg-muted/30 border-t border-border text-[11px] text-muted-foreground">
          {filtered.length} orders
        </div>
      </div>
    </div>
  );
};

export default OrdersModule;
