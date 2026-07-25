import { useState } from "react";
import { Search, User, Mail, Phone, ShoppingCart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface CustomersModuleProps {
  customers: any[];
  orders: any[];
}

const CustomersModule = ({ customers, orders }: CustomersModuleProps) => {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Local optimistic overrides so a type change reflects immediately without
  // needing to thread a refetch callback down from Admin.tsx -- the DB write
  // is the source of truth; this just avoids a stale row until the next
  // parent-level refresh.
  const [typeOverrides, setTypeOverrides] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const { toast } = useToast();

  const changeCustomerType = async (userId: string, newType: string) => {
    setSavingId(userId);
    const { error } = await supabase.from("profiles").update({ customer_type: newType } as any).eq("user_id", userId);
    setSavingId(null);
    if (error) {
      toast({ title: "Couldn't update account type", description: error.message, variant: "destructive" });
      return;
    }
    setTypeOverrides((prev) => ({ ...prev, [userId]: newType }));
    toast({ title: "Account type updated", description: `Now registered as ${newType}.` });
  };

  const filtered = customers.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.name || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q);
  });

  const getCustomerOrders = (userId: string) => orders.filter((o) => o.user_id === userId);

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers..." className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-card text-sm focus:border-primary outline-none transition" />
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                {["Customer", "Email", "Phone", "Type", "Orders", "Total Spent", "Joined"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">No customers found.</td></tr>
              ) : (
                filtered.map((c) => {
                  const custOrders = getCustomerOrders(c.user_id);
                  const totalSpent = custOrders.reduce((s: number, o: any) => s + Number(o.total_amount), 0);
                  const isExpanded = expandedId === c.id;
                  const currentType = typeOverrides[c.user_id] ?? c.customer_type ?? "residential";
                  return (
                    <>
                      <tr key={c.id} className="border-b border-border/50 last:border-none hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : c.id)}>
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-display font-bold">
                              {(c.name || c.email || "?").charAt(0).toUpperCase()}
                            </div>
                            <span className="text-sm font-semibold">{c.name || "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : c.id)}>{c.email || "—"}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : c.id)}>{c.phone || "—"}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={currentType}
                            disabled={savingId === c.user_id}
                            onChange={(e) => changeCustomerType(c.user_id, e.target.value)}
                            className={`text-[11px] font-display font-bold rounded-full border px-2 py-1 capitalize outline-none disabled:opacity-50 ${
                              currentType === "business" ? "bg-secondary/10 text-secondary border-secondary/30" : "bg-primary/10 text-primary border-primary/30"
                            }`}
                          >
                            <option value="residential">Residential</option>
                            <option value="business">Business</option>
                          </select>
                        </td>
                        <td className="px-4 py-3 text-sm font-display font-semibold cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : c.id)}>{custOrders.length}</td>
                        <td className="px-4 py-3 text-sm font-display font-bold cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : c.id)}>R{totalSpent.toFixed(2)}</td>
                        <td className="px-4 py-3 text-[11px] text-muted-foreground cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : c.id)}>{new Date(c.created_at).toLocaleDateString()}</td>
                      </tr>
                      {isExpanded && custOrders.length > 0 && (
                        <tr key={`${c.id}-orders`}>
                          <td colSpan={7} className="bg-muted/10 px-6 py-3 border-b border-border">
                            <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider mb-2">Order History</p>
                            {custOrders.map((o: any) => (
                              <div key={o.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border/30 last:border-none">
                                <span className="font-mono text-muted-foreground">#{o.id.slice(0, 8)}</span>
                                <span>R{Number(o.total_amount).toFixed(2)}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${
                                  o.order_status === "paid" || o.status === "paid" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}>{o.order_status || o.status}</span>
                                <span className="text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</span>
                              </div>
                            ))}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 bg-muted/30 border-t border-border text-[11px] text-muted-foreground">
          {filtered.length} customers
        </div>
      </div>
    </div>
  );
};

export default CustomersModule;
