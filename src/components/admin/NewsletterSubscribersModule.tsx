import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search, Users, UserCheck, UserX } from "lucide-react";
import { adminRpc } from "@/lib/admin-rpc";
import { useToast } from "@/hooks/use-toast";


interface SubscriberRow {
  id: string;
  email: string;
  name: string | null;
  source: string | null;
  interested_categories: string[] | null;
  subscribed_at: string;
  unsubscribed_at: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI & ML",
  networking: "Networking",
  computing: "Computing",
  software: "Software",
};

/**
 * The actual list behind the "Active subscribers" count that already lives
 * in NewsletterModule's campaign composer -- on its own screen, as asked,
 * rather than a number with nothing to drill into.
 */
const NewsletterSubscribersModule = () => {
  const { toast } = useToast();
  const [subscribers, setSubscribers] = useState<SubscriberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_newsletter_subscribers");
    setLoading(false);
    if (error) {
      toast({ title: "Couldn't load subscribers", description: error.message, variant: "destructive" });
      return;
    }
    setSubscribers((data as unknown as SubscriberRow[]) ?? []);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const active = subscribers.filter((s) => !s.unsubscribed_at);
  const unsubscribed = subscribers.filter((s) => s.unsubscribed_at);

  const filtered = subscribers.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return s.email.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card-flat p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-display font-extrabold">{subscribers.length}</p>
            <p className="text-xs text-muted-foreground">Total ever subscribed</p>
          </div>
        </div>
        <div className="card-flat p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[hsl(160,84%,39%)]/10 flex items-center justify-center text-[hsl(160,84%,39%)]">
            <UserCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-display font-extrabold">{active.length}</p>
            <p className="text-xs text-muted-foreground">Active recipients</p>
          </div>
        </div>
        <div className="card-flat p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
            <UserX className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-display font-extrabold">{unsubscribed.length}</p>
            <p className="text-xs text-muted-foreground">Unsubscribed</p>
          </div>
        </div>
      </div>

      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <h3 className="font-display font-bold text-sm">Recipients</h3>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email..."
                className="input-premium input-premium-icon-l-sm py-1.5 text-xs w-56"
              />
            </div>
            <button onClick={load} className="text-xs text-primary font-semibold hover:underline flex items-center gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-premium">
            <thead>
              <tr>
                {["Recipient", "Interests", "Source", "Subscribed", "Status"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>
                    <p className="font-semibold">{s.name || s.email}</p>
                    {s.name && <p className="text-xs text-muted-foreground">{s.email}</p>}
                  </td>
                  <td className="text-xs text-muted-foreground">
                    {s.interested_categories?.length
                      ? s.interested_categories.map((c) => CATEGORY_LABEL[c] ?? c).join(", ")
                      : "Everything"}
                  </td>
                  <td className="text-xs text-muted-foreground">{s.source || "—"}</td>
                  <td className="text-muted-foreground text-xs">{new Date(s.subscribed_at).toLocaleDateString()}</td>
                  <td>
                    {s.unsubscribed_at ? (
                      <span className="badge-neutral">Unsubscribed</span>
                    ) : (
                      <span className="badge-success">Active</span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">
                  {subscribers.length === 0 ? "No subscribers yet" : "No subscribers match your search"}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default NewsletterSubscribersModule;
