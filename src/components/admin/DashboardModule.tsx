import { TrendingUp, ShoppingCart, Package, AlertTriangle, RefreshCw } from "lucide-react";

interface DashboardModuleProps {
  products: any[];
  orders: any[];
  onRefresh: () => void;
}

const StatCard = ({ label, value, icon, trend }: { label: string; value: string | number; icon: React.ReactNode; trend?: string }) => (
  <div className="bg-card border border-border rounded-xl p-5 group hover:shadow-card transition-shadow">
    <div className="flex items-start justify-between mb-3">
      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">{icon}</div>
      {trend && <span className="text-[11px] font-display font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{trend}</span>}
    </div>
    <p className="font-display font-extrabold text-2xl">{value}</p>
    <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
  </div>
);

const DashboardModule = ({ products, orders, onRefresh }: DashboardModuleProps) => {
  const totalRevenue = orders.reduce((s, o) => s + Number(o.total_amount), 0);
  const paidOrders = orders.filter((o) => o.payment_status === "paid" || o.status === "paid").length;
  const today = new Date().toDateString();
  const ordersToday = orders.filter((o) => new Date(o.created_at).toDateString() === today).length;
  const lowStock = products.filter((p) => p.stock_status === "low_stock" || (p.stock_quantity > 0 && p.stock_quantity <= 5)).length;
  const outOfStock = products.filter((p) => p.stock_status === "out_of_stock" || (!p.in_stock && p.stock_quantity === 0)).length;

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: "bg-amber-50 text-amber-700 border-amber-200",
      paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
      shipped: "bg-blue-50 text-blue-700 border-blue-200",
      delivered: "bg-teal-50 text-teal-700 border-teal-200",
      returned: "bg-red-50 text-red-700 border-red-200",
      cancelled: "bg-red-50 text-red-700 border-red-200",
    };
    return map[status] || "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Revenue" value={`R${totalRevenue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`} icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Orders Today" value={ordersToday} icon={<ShoppingCart className="h-5 w-5" />} />
        <StatCard label="Products" value={products.length} icon={<Package className="h-5 w-5" />} />
        <StatCard label="Low Stock Alerts" value={lowStock + outOfStock} icon={<AlertTriangle className="h-5 w-5" />} trend={outOfStock > 0 ? `${outOfStock} out` : undefined} />
      </div>

      {/* Low stock alerts */}
      {(lowStock > 0 || outOfStock > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <h3 className="font-display font-bold text-sm text-amber-800 flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4" /> Stock Alerts
          </h3>
          <div className="space-y-1">
            {products
              .filter((p) => p.stock_status === "low_stock" || p.stock_status === "out_of_stock" || p.stock_quantity <= 5)
              .slice(0, 5)
              .map((p) => (
                <div key={p.id} className="flex items-center justify-between text-xs">
                  <span className="text-amber-900 font-medium">{p.name}</span>
                  <span className={`font-display font-bold ${p.stock_quantity === 0 ? "text-red-600" : "text-amber-600"}`}>
                    {p.stock_quantity ?? 0} units
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recent activity */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h3 className="font-display font-bold text-sm">Recent Orders</h3>
          <button onClick={onRefresh} className="text-[11px] text-primary font-display font-semibold hover:underline flex items-center gap-1">
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="bg-muted/50">
                {["Customer", "Items", "Amount", "Status", "Date"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 8).map((order) => (
                <tr key={order.id} className="border-b border-border/50 last:border-none hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold">{order.customer_name}</p>
                    <p className="text-[11px] text-muted-foreground">{order.customer_email}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{order.order_items?.length ?? 0}</td>
                  <td className="px-4 py-3 text-sm font-display font-bold">R{Number(order.total_amount).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${statusBadge(order.order_status || order.status)}`}>
                      {order.order_status || order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">No orders yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DashboardModule;
