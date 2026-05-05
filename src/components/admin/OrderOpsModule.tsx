import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ShoppingCart, Truck, CheckCircle, AlertTriangle, RotateCcw, MessageSquare, ArrowUpRight, Search, Filter } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const OrderOpsModule = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showConfirm, setShowConfirm] = useState<{ orderId: string; action: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("orders").select("*, order_items(*, products(name))").order("created_at", { ascending: false });
    setOrders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = orders.filter(o => {
    const matchSearch = !search || o.customer_name?.toLowerCase().includes(search.toLowerCase()) || o.customer_email?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || o.order_status === statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const updateOrder = async (id: string, updates: any) => {
    await supabase.from("orders").update(updates).eq("id", id);
    toast({ title: "Order Updated" });
    load();
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: "bg-amber-500/10 text-amber-600 border-amber-200",
      paid: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
      shipped: "bg-blue-500/10 text-blue-600 border-blue-200",
      delivered: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
      returned: "bg-red-500/10 text-red-600 border-red-200",
      cancelled: "bg-red-500/10 text-red-600 border-red-200",
    };
    return map[status] || "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3"><ShoppingCart className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{orders.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Orders</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center mb-3"><AlertTriangle className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{orders.filter(o => o.order_status === "pending" || o.status === "pending").length}</p>
          <p className="text-xs text-muted-foreground mt-1">Pending</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center mb-3"><Truck className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{orders.filter(o => o.order_status === "shipped").length}</p>
          <p className="text-xs text-muted-foreground mt-1">Shipped</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3"><CheckCircle className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{orders.filter(o => o.order_status === "delivered").length}</p>
          <p className="text-xs text-muted-foreground mt-1">Delivered</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search orders..." className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-card text-sm focus:border-primary outline-none transition" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-input bg-card text-sm">
          <option value="">All Statuses</option>
          {["pending", "paid", "shipped", "delivered", "returned", "cancelled"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="card-flat overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead><tr className="bg-muted/50 border-b border-border">
              {["Customer", "Items", "Amount", "Payment", "Status", "Tracking", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No orders found</td></tr>
              ) : filtered.slice(0, 50).map(o => (
                <tr key={o.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold">{o.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{o.customer_email}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{o.order_items?.length ?? 0}</td>
                  <td className="px-4 py-3 text-sm font-display font-bold">R{Number(o.total_amount).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${statusBadge(o.payment_status || "unpaid")}`}>{o.payment_status || "unpaid"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${statusBadge(o.order_status || o.status)}`}>{o.order_status || o.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{o.tracking_number || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) { setShowConfirm({ orderId: o.id, action: e.target.value }); e.target.value = ""; } }}
                        className="px-2 py-1 rounded border border-border text-[10px] bg-card"
                      >
                        <option value="">Update...</option>
                        <option value="paid">Mark Paid</option>
                        <option value="shipped">Mark Shipped</option>
                        <option value="delivered">Mark Delivered</option>
                        <option value="returned">Mark Returned</option>
                        <option value="cancelled">Cancel</option>
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-foreground/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowConfirm(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-lg mb-2">Confirm Status Change</h3>
            <p className="text-sm text-muted-foreground mb-6">Update order status to "{showConfirm.action}"?</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowConfirm(null)} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold">Cancel</button>
              <button onClick={() => { updateOrder(showConfirm.orderId, { order_status: showConfirm.action }); setShowConfirm(null); }} className="px-4 py-2 rounded-lg gradient-brand text-white text-sm font-semibold">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderOpsModule;
