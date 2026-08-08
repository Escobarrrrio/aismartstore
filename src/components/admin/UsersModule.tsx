import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface UserRow {
  id: string;
  email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed: boolean;
  provider: string;
  name: string | null;
  customer_type: string | null;
  phone: string | null;
  is_admin: boolean;
  order_count: number;
}

/**
 * Account-level view, distinct from Customers (CustomersModule.tsx). That
 * screen answers "who bought something" and reads public.profiles joined
 * with orders. This one answers "who can sign in" -- every real auth.users
 * row, whether or not it ever placed an order, plus role and auth provider.
 */
const UsersModule = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_users");
    setLoading(false);
    if (error) {
      toast({ title: "Couldn't load users", description: error.message, variant: "destructive" });
      return;
    }
    setUsers((data as unknown as UserRow[]) ?? []);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (u.email ?? "").toLowerCase().includes(q) || (u.name ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card-flat p-5">
          <p className="font-display font-extrabold text-2xl">{users.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total accounts</p>
        </div>
        <div className="card-flat p-5">
          <p className="font-display font-extrabold text-2xl">{users.filter((u) => u.is_admin).length}</p>
          <p className="text-xs text-muted-foreground mt-1">Admins</p>
        </div>
        <div className="card-flat p-5">
          <p className="font-display font-extrabold text-2xl">{users.filter((u) => u.email_confirmed).length}</p>
          <p className="text-xs text-muted-foreground mt-1">Email confirmed</p>
        </div>
        <div className="card-flat p-5">
          <p className="font-display font-extrabold text-2xl">{users.filter((u) => u.order_count > 0).length}</p>
          <p className="text-xs text-muted-foreground mt-1">Have placed an order</p>
        </div>
      </div>

      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-display font-bold text-sm">All Users</h3>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email..."
                className="input-premium pl-8 py-1.5 text-xs w-56"
              />
            </div>
            <button onClick={load} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] table-premium">
            <thead>
              <tr>
                {["User", "Role", "Provider", "Orders", "Joined", "Last sign-in"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>
                    <p className="font-semibold">{u.name || u.email || u.id}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </td>
                  <td>
                    {u.is_admin ? (
                      <span className="badge-info inline-flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" /> Admin
                      </span>
                    ) : (
                      <span className="badge-neutral">Customer</span>
                    )}
                  </td>
                  <td className="text-muted-foreground text-xs capitalize">{u.provider}</td>
                  <td className="font-display font-bold">{u.order_count}</td>
                  <td className="text-muted-foreground text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="text-muted-foreground text-xs">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : "Never"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">
                  {users.length === 0 ? "No users yet" : "No users match your search"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UsersModule;
