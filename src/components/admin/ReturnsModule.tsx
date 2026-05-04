import { RotateCcw, Search, Eye } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const ReturnsModule = () => {
  const [returns, setReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadReturns = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("returns")
      .select("*")
      .order("created_at", { ascending: false });
    setReturns(data || []);
    setLoading(false);
  };

  useEffect(() => { loadReturns(); }, []);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      requested: "badge-warning",
      approved: "badge-info",
      received: "badge-info",
      refunded: "badge-success",
      rejected: "badge-danger",
    };
    return map[status] || "badge-neutral";
  };

  const filtered = returns.filter((r) =>
    !search || r.reason?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-5">
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search returns..."
          className="input-premium pl-10"
        />
      </div>

      <div className="card-flat overflow-hidden">
        <table className="w-full table-premium">
          <thead>
            <tr>
              {["Return ID", "Reason", "Status", "Refund Amount", "Date"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r: any) => (
              <tr key={r.id}>
                <td className="font-mono text-xs">{r.id.slice(0, 8)}...</td>
                <td className="max-w-[200px] truncate">{r.reason || "—"}</td>
                <td><span className={statusBadge(r.status)}>{r.status}</span></td>
                <td className="font-display font-bold">R{Number(r.refund_amount || 0).toFixed(2)}</td>
                <td className="text-muted-foreground text-xs">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">
                <RotateCcw className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                No returns yet
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const LoadingSkeleton = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-11 bg-muted rounded-xl w-full max-w-md" />
    <div className="card-flat overflow-hidden">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border/50 last:border-none">
          <div className="flex-1 space-y-2">
            <div className="h-3.5 bg-muted rounded w-1/3" />
            <div className="h-3 bg-muted rounded w-1/5" />
          </div>
          <div className="h-5 bg-muted rounded-full w-16" />
        </div>
      ))}
    </div>
  </div>
);

export default ReturnsModule;
