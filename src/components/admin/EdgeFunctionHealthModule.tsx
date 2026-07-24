import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle2, Clock, Play, RefreshCw, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Functions this module tracks. Each has its own pg_cron schedule and now
// logs one row per run to `sync_logs` (source = the key below) via the
// shared run-log/retry/alert helpers in supabase/functions/_shared.
const TRACKED_FUNCTIONS: { source: string; label: string; schedule: string }[] = [
  { source: "sync-ai-pulse", label: "AI Pulse sync", schedule: "every 6 hours" },
  { source: "cleanup-blocked-products", label: "Blocked-product cleanup", schedule: "daily 04:00" },
  { source: "sync-courier-tracking", label: "Courier tracking sync", schedule: "every 30 minutes" },
];

type LogRow = {
  id: string;
  source: string;
  status: string;
  items_synced: number | null;
  items_failed: number | null;
  error_details: string | null;
  started_at: string | null;
  completed_at: string | null;
};

type SourceHealth = {
  source: string;
  label: string;
  schedule: string;
  latest: LogRow | null;
  lastSuccessAt: string | null;
  errorCount24h: number;
  runCount24h: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const EdgeFunctionHealthModule = () => {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sync_logs")
      .select("id, source, status, items_synced, items_failed, error_details, started_at, completed_at")
      .in("source", TRACKED_FUNCTIONS.map((f) => f.source))
      .order("started_at", { ascending: false })
      .limit(200);
    setRows((data as LogRow[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const health: SourceHealth[] = useMemo(() => {
    const cutoff = Date.now() - DAY_MS;
    return TRACKED_FUNCTIONS.map(({ source, label, schedule }) => {
      const sourceRows = rows.filter((r) => r.source === source);
      const latest = sourceRows[0] ?? null;
      const lastSuccess = sourceRows.find((r) => r.status === "success");
      const recent = sourceRows.filter((r) => r.started_at && new Date(r.started_at).getTime() >= cutoff);
      const errorCount24h = recent.filter((r) => r.status === "failed" || r.status === "error").length;
      return {
        source, label, schedule, latest,
        lastSuccessAt: lastSuccess?.started_at ?? null,
        errorCount24h,
        runCount24h: recent.length,
      };
    });
  }, [rows]);

  const runNow = async (source: string) => {
    setRunning(source);
    try {
      const { error } = await supabase.functions.invoke(source);
      if (error) throw error;
      toast({ title: `${source} finished`, description: "Run logged below." });
    } catch (e: any) {
      toast({ title: `${source} failed`, description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setRunning(null);
      await load();
    }
  };

  const statusIcon = (status?: string) => {
    if (status === "success") return <CheckCircle2 className="h-4 w-4 text-[hsl(160,84%,39%)]" />;
    if (status === "failed" || status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
    if (status === "running") return <RefreshCw className="h-4 w-4 text-primary animate-spin" />;
    return <Clock className="h-4 w-4 text-[hsl(38,92%,50%)]" />;
  };

  const statusBadge = (status?: string) => {
    if (status === "success") return "badge-success";
    if (status === "failed" || status === "error") return "badge-danger";
    return "badge-warning";
  };

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display font-bold text-lg">Edge Function Health</h2>
            <p className="text-xs text-muted-foreground">
              Run status, last success and error counts for the automated background jobs.
            </p>
          </div>
        </div>
        <button onClick={load} className="btn-secondary px-3 py-2 text-xs">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {health.map((h) => (
          <div key={h.source} className="card-flat p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="font-display font-bold text-sm">{h.label}</p>
                <p className="text-[11px] text-muted-foreground">{h.schedule}</p>
              </div>
              {statusIcon(h.latest?.status)}
            </div>

            <div className="flex items-center gap-2 mb-3">
              <span className={`${statusBadge(h.latest?.status)} text-[10px]`}>
                {h.latest?.status ?? "never run"}
              </span>
              {h.errorCount24h > 0 && (
                <span className="badge-danger text-[10px]">{h.errorCount24h} error{h.errorCount24h === 1 ? "" : "s"} / 24h</span>
              )}
            </div>

            <dl className="space-y-1.5 text-xs mb-4">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Last run</dt>
                <dd>{h.latest?.started_at ? new Date(h.latest.started_at).toLocaleString() : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Last success</dt>
                <dd>{h.lastSuccessAt ? new Date(h.lastSuccessAt).toLocaleString() : "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Runs (24h)</dt>
                <dd>{h.runCount24h}</dd>
              </div>
            </dl>

            <button
              onClick={() => runNow(h.source)}
              disabled={running !== null}
              className="btn-secondary w-full px-3 py-2 text-xs disabled:opacity-50"
            >
              <Play className={`h-3.5 w-3.5 ${running === h.source ? "animate-pulse" : ""}`} />
              {running === h.source ? "Running…" : "Run now"}
            </button>
          </div>
        ))}
      </div>

      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-sm">Recent runs</h3>
        </div>
        <table className="w-full table-premium">
          <thead>
            <tr>
              {["Function", "Status", "Synced", "Failed", "Started", "Error"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map((log) => (
              <tr key={log.id}>
                <td className="font-semibold">{TRACKED_FUNCTIONS.find((f) => f.source === log.source)?.label ?? log.source}</td>
                <td>
                  <div className="flex items-center gap-2">
                    {statusIcon(log.status)}
                    <span className={`${statusBadge(log.status)} text-[10px]`}>{log.status}</span>
                  </div>
                </td>
                <td>{log.items_synced ?? 0}</td>
                <td>{log.items_failed ?? 0}</td>
                <td className="text-muted-foreground text-xs">{log.started_at ? new Date(log.started_at).toLocaleString() : "—"}</td>
                <td className="text-xs text-muted-foreground max-w-[240px] truncate" title={log.error_details ?? ""}>
                  {log.error_details ?? "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">
                <RefreshCw className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                No runs logged yet. Runs will appear here after the next scheduled sync or a manual "Run now".
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
    <div className="h-8 bg-muted rounded w-64" />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[...Array(3)].map((_, i) => <div key={i} className="card-flat p-5 h-40" />)}
    </div>
  </div>
);

export default EdgeFunctionHealthModule;
