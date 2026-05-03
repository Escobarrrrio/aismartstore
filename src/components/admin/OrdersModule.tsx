import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, RefreshCw, Truck, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OrdersModuleProps {
  orders: any[];
  onReload: () => void;
}

const statusOptions = ["pending", "paid", "shipped", "delivered", "returned"];
const paymentOptions = ["unpaid", "paid", "refunded", "partially_refunded"];

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700 border-amber-200",
    paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
    shipped: "bg-blue-50 text-blue-700 border-blue-200",
    delivered: "bg-teal-50 text-teal-700 border-teal-200",
    returned: "bg-red-50 text-red-700 border-red-200",
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

  const filtered = orders.filter((o) => {
    const matchSearch = !search || o.customer_name?.toLowerCase().includes(search.toLowerCase()) || o.customer_email?.toLowerCase().includes(search.toLowerCase()) || o.id.includes(search);
    const matchStatus = !statusFilter || o.order_status === statusFilter || o.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const updateOrderStatus = async (id: string, field: "order_status" | "payment_status" | "status", value: string) => {
    await supabase.from("orders").update({ [field]: value } as any).eq("id", id);
    onReload();
    toast({ title: "Order updated" });
  };

  const updateTracking = async (id: string, tracking: string) => {
    await supabase.from("orders").update({ tracking_number: tracking }).eq("id", id);
    toast({ title: "Tracking number saved" });
  };

  return (
    <div className="space-y-4">
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
                                onChange={(e) => updateOrderStatus(order.id, "order_status", e.target.value)}
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
                        </div>
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
