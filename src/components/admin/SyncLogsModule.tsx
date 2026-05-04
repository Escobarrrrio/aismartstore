import { RefreshCw, Search, CheckCircle, XCircle, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const SyncLogsModule = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sync_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs(data || []);
    setLoading(false);
  };

  useEffect(() => { loadLogs(); }, []);

  const statusIcon = (status: string) => {
    if (status === "completed") return <CheckCircle className="h-4 w-4 text-[hsl(160,84%,39%)]" />;
    if (status === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-[hsl(38,92%,50%)]" />;
  };

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Product synchronization history</p>
        <button onClick={loadLogs} className="btn-secondary px-4 py-2 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="card-flat overflow-hidden">
        <table className="w-full table-premium">
          <thead>
            <tr>
              {["Source", "Status", "Synced", "Failed", "Started", "Completed"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log: any) => (
              <tr key={log.id}>
                <td className="font-semibold capitalize">{log.source}</td>
                <td>
                  <div className="flex items-center gap-2">
                    {statusIcon(log.status)}
                    <span className={log.status === "completed" ? "badge-success" : log.status === "failed" ? "badge-danger" : "badge-warning"}>
                      {log.status}
                    </span>
                  </div>
                </td>
                <td>{log.items_synced ?? 0}</td>
                <td>{log.items_failed ?? 0}</td>
                <td className="text-muted-foreground text-xs">{log.started_at ? new Date(log.started_at).toLocaleString() : "—"}</td>
                <td className="text-muted-foreground text-xs">{log.completed_at ? new Date(log.completed_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">
                <RefreshCw className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                No sync logs yet. Sync logs will appear when products are synced from a supplier.
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
    <div className="h-8 bg-muted rounded w-48" />
    <div className="card-flat overflow-hidden">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border/50 last:border-none">
          <div className="flex-1 space-y-2"><div className="h-3.5 bg-muted rounded w-1/4" /></div>
        </div>
      ))}
    </div>
  </div>
);

export default SyncLogsModule;
