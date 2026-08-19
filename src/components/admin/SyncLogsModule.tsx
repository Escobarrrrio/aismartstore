import { RefreshCw, CheckCircle, XCircle, Clock, ImageOff, Download, AlertTriangle } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// Distributor feeds we expect to be alive. A feed that silently stops is the
// expensive failure mode here: prices and stock freeze at whatever they were,
// so the store keeps selling yesterday's ZAR price on today's cost.
const FEEDS: { source: string; label: string; staleHours: number }[] = [
  { source: "axiz", label: "Axiz", staleHours: 6 },
  { source: "frontosa", label: "Frontosa", staleHours: 26 },
];

type FeedHealth = {
  source: string;
  label: string;
  staleHours: number;
  lastSuccess: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
};

const hoursSince = (iso: string | null) =>
  iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : null;

const SyncLogsModule = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [health, setHealth] = useState<FeedHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const stopRef = useRef(false);

  const loadLogs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("sync_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs(data || []);

    const feedHealth = await Promise.all(
      FEEDS.map(async (f) => {
        const [{ data: ok }, { data: bad }] = await Promise.all([
          supabase.from("sync_logs").select("completed_at, created_at").eq("source", f.source)
            .eq("status", "success").order("created_at", { ascending: false }).limit(1).maybeSingle(),
          supabase.from("sync_logs").select("error_details, created_at").eq("source", f.source)
            .eq("status", "error").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ]);
        return {
          ...f,
          lastSuccess: (ok as any)?.completed_at ?? (ok as any)?.created_at ?? null,
          lastError: (bad as any)?.error_details ?? null,
          lastErrorAt: (bad as any)?.created_at ?? null,
        };
      }),
    );
    setHealth(feedHealth);
    setLoading(false);
  };

  useEffect(() => { loadLogs(); }, []);


  // Loop an edge function until it reports done, refreshing logs after each pass.
  const runToCompletion = async (
    fn: "axiz-sync" | "validate-product-images",
    doneCheck: (r: any) => boolean,
    label: string,
    reset = false,
  ) => {
    stopRef.current = false;
    let totalChecked = 0;
    let totalDeactivated = 0;
    for (let i = 1; i <= 60; i++) {
      if (stopRef.current) { setProgress(`${label}: stopped`); break; }
      setProgress(`${label}: batch ${i}…`);
      const { data, error } = await supabase.functions.invoke(fn, {
        body: reset && i === 1 ? { reset: true } : {},
      });
      if (error) { toast.error(`${label} failed: ${error.message}`); break; }
      totalChecked += Number(data?.checked ?? data?.synced ?? 0);
      totalDeactivated += Number(data?.deactivated ?? 0);
      await loadLogs();
      if (doneCheck(data)) {
        toast.success(
          fn === "validate-product-images"
            ? `Image validation complete — checked ${totalChecked}, deactivated ${totalDeactivated}`
            : `Axiz sync complete`,
        );
        setProgress("");
        return true;
      }
    }
    setProgress("");
    return false;
  };

  const handleRunSync = async () => {
    setSyncing(true);
    await runToCompletion("axiz-sync", (r) => r?.catalogComplete === true, "Axiz sync");
    setSyncing(false);
  };

  const handleValidateImages = async (autoAfterSync = false) => {
    setValidating(true);
    await runToCompletion(
      "validate-product-images",
      (r) => r?.done === true,
      "Image validation",
      true,
    );
    setValidating(false);
    if (!autoAfterSync) await loadLogs();
  };

  const handleSyncThenValidate = async () => {
    setSyncing(true);
    const ok = await runToCompletion("axiz-sync", (r) => r?.catalogComplete === true, "Axiz sync");
    setSyncing(false);
    if (ok) await handleValidateImages(true);
  };

  const statusIcon = (status: string) => {
    if (status === "success" || status === "completed") return <CheckCircle className="h-4 w-4 text-[hsl(160,84%,39%)]" />;
    if (status === "error" || status === "failed") return <XCircle className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-[hsl(38,92%,50%)]" />;
  };

  const busy = syncing || validating;

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Product synchronization &amp; image health</p>
          {progress && <p className="text-xs text-muted-foreground mt-1">{progress}</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleRunSync} disabled={busy}
            className="btn-secondary px-3 py-2 text-xs disabled:opacity-50">
            <Download className={`h-3.5 w-3.5 ${syncing ? "animate-pulse" : ""}`} />
            {syncing ? "Syncing…" : "Run Axiz sync"}
          </button>
          <button onClick={() => handleValidateImages(false)} disabled={busy}
            className="btn-secondary px-3 py-2 text-xs disabled:opacity-50">
            <ImageOff className={`h-3.5 w-3.5 ${validating ? "animate-pulse" : ""}`} />
            {validating ? "Validating…" : "Validate images"}
          </button>
          <button onClick={handleSyncThenValidate} disabled={busy}
            className="btn-primary px-3 py-2 text-xs disabled:opacity-50">
            Sync + auto-validate
          </button>
          {busy && (
            <button onClick={() => { stopRef.current = true; }} className="btn-secondary px-3 py-2 text-xs">
              Stop
            </button>
          )}
          <button onClick={loadLogs} className="btn-secondary px-3 py-2 text-xs">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
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
