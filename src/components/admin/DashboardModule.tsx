import { TrendingUp, ShoppingCart, Package, AlertTriangle, RefreshCw, DollarSign, Users, ArrowUpRight } from "lucide-react";
import TreasuryWidget from "@/components/admin/TreasuryWidget";

interface DashboardModuleProps {
  products: any[];
  orders: any[];
  customers?: any[];
  onRefresh: () => void;
}

const StatCard = ({ label, value, icon, trend, color = "bg-primary/[0.08] text-primary" }: {
  label: string; value: string | number; icon: React.ReactNode; trend?: string; color?: string;
}) => (
  <div className="card-flat p-5 hover:shadow-md transition-shadow">
    <div className="flex items-start justify-between mb-3">
      <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center`}>{icon}</div>
      {trend && (
        <span className="badge-success text-[10px] flex items-center gap-0.5">
          <ArrowUpRight className="h-3 w-3" />{trend}
        </span>
      )}
    </div>
    <p className="font-display font-extrabold text-2xl tracking-tight">{value}</p>
    <p className="text-xs text-muted-foreground mt-1">{label}</p>
  </div>
);

const DashboardModule = ({ products, orders, customers = [], onRefresh }: DashboardModuleProps) => {
  const totalRevenue = orders.reduce((s: number, o: any) => s + Number(o.total_amount), 0);
  const paidOrders = orders.filter((o: any) => o.payment_status === "paid" || o.status === "paid").length;
  const today = new Date().toDateString();
  const ordersToday = orders.filter((o: any) => new Date(o.created_at).toDateString() === today).length;
  const lowStock = products.filter((p: any) => p.stock_status === "low_stock" || (p.stock_quantity > 0 && p.stock_quantity <= 5)).length;
  const outOfStock = products.filter((p: any) => p.stock_status === "out_of_stock" || (!p.in_stock && p.stock_quantity === 0)).length;

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: "badge-warning",
      paid: "badge-success",
      shipped: "badge-info",
      delivered: "badge-success",
      returned: "badge-danger",
      cancelled: "badge-danger",
    };
    return map[status] || "badge-neutral";
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Revenue"
          value={`R${totalRevenue.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`}
          icon={<DollarSign className="h-5 w-5" />}
          color="bg-[hsl(160,84%,39%)]/10 text-[hsl(160,84%,39%)]"
        />
        <StatCard label="Orders Today" value={ordersToday} icon={<ShoppingCart className="h-5 w-5" />} />
        <StatCard label="Products" value={products.length} icon={<Package className="h-5 w-5" />} color="bg-secondary/10 text-secondary" />
        <StatCard
          label="Stock Alerts"
          value={lowStock + outOfStock}
          icon={<AlertTriangle className="h-5 w-5" />}
          trend={outOfStock > 0 ? `${outOfStock} out` : undefined}
          color="bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,50%)]"
        />
      </div>

      <TreasuryWidget />

      {/* Low stock alerts */}
      {(lowStock > 0 || outOfStock > 0) && (
        <div className="card-flat p-5 border-l-4 border-l-[hsl(38,92%,50%)]">
          <h3 className="font-display font-bold text-sm flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-[hsl(38,92%,50%)]" /> Stock Alerts
          </h3>
          <div className="space-y-2">
            {products
              .filter((p: any) => p.stock_status === "low_stock" || p.stock_status === "out_of_stock" || p.stock_quantity <= 5)
              .slice(0, 5)
              .map((p: any) => (
                <div key={p.id} className="flex items-center justify-between text-sm py-1">
                  <span className="font-medium truncate mr-4">{p.name}</span>
                  <span className={p.stock_quantity === 0 ? "badge-danger" : "badge-warning"}>
                    {p.stock_quantity ?? 0} units
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Recent orders */}
      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-display font-bold text-sm">Recent Orders</h3>
          <button onClick={onRefresh} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] table-premium">
            <thead>
              <tr>
                {["Customer", "Items", "Amount", "Status", "Date"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 8).map((order: any) => (
                <tr key={order.id}>
                  <td>
                    <p className="font-semibold">{order.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{order.customer_email}</p>
                  </td>
                  <td className="text-muted-foreground">{order.order_items?.length ?? 0}</td>
                  <td className="font-display font-bold">R{Number(order.total_amount).toFixed(2)}</td>
                  <td>
                    <span className={statusBadge(order.order_status || order.status)}>
                      {order.order_status || order.status}
                    </span>
                  </td>
                  <td className="text-muted-foreground text-xs">{new Date(order.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">No orders yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DashboardModule;
