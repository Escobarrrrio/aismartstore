import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, TimerReset, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type Probe = {
  label: string;
  args: Record<string, unknown>;
  duration_ms: number;
  ok: boolean;
  row_count: number;
  total_count: number | null;
  error: string | null;
  timeout: boolean;
};

type Report = {
  status: "healthy" | "warning" | "critical";
  flags: string[];
  checked_at: string;
  counts: {
    active: number;
    inactive: number;
    active_missing_images: number;
    active_missing_price: number;
  };
  probes: Probe[];
};

const FLAG_LABEL: Record<string, string> = {
  statement_timeout: "search_products is timing out",
  query_error: "search_products returned an error",
  slow_query: "search_products slower than 2.5s",
  empty_catalog: "No active products in catalog",
  active_missing_images: "Active products without images",
  active_missing_price: "Active products with zero price",
};

const CatalogHealthModule = () => {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const run = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("catalog-health");
      if (error) throw error;
      setReport(data as Report);
    } catch (e: any) {
      toast({ title: "Health check failed", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); }, []);

  const statusStyle =
    report?.status === "healthy" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
    : report?.status === "warning" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
    : "bg-destructive/10 text-destructive border-destructive/30";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-display font-bold text-lg">Catalog Health</h2>
            <p className="text-xs text-muted-foreground">
              Active product counts and live probes of <code className="text-[11px]">search_products</code>.
            </p>
          </div>
        </div>
        <Button onClick={run} disabled={loading} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Re-run
        </Button>
      </div>

      {report && (
        <>
          <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${statusStyle}`}>
            <div className="flex items-center gap-2 font-display font-semibold text-sm">
              {report.status === "healthy" ? <CheckCircle2 className="h-4 w-4" /> :
                report.status === "warning" ? <AlertTriangle className="h-4 w-4" /> :
                <XCircle className="h-4 w-4" />}
              Status: {report.status.toUpperCase()}
            </div>
            <span className="text-[11px] opacity-70">Checked {new Date(report.checked_at).toLocaleString()}</span>
          </div>

          {report.flags.length > 0 && (
            <div className="card-flat p-4">
              <p className="text-xs font-display font-bold uppercase tracking-widest text-muted-foreground mb-2">Flags</p>
              <ul className="space-y-1.5">
                {report.flags.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    <span>{FLAG_LABEL[f] ?? f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Active", value: report.counts.active, tone: "text-emerald-600" },
              { label: "Inactive", value: report.counts.inactive, tone: "text-muted-foreground" },
              { label: "Missing images", value: report.counts.active_missing_images, tone: report.counts.active_missing_images ? "text-amber-600" : "text-muted-foreground" },
              { label: "Missing price", value: report.counts.active_missing_price, tone: report.counts.active_missing_price ? "text-amber-600" : "text-muted-foreground" },
            ].map((k) => (
              <div key={k.label} className="card-flat p-4">
                <p className="text-[11px] font-display font-bold uppercase tracking-widest text-muted-foreground">{k.label}</p>
                <p className={`font-display font-extrabold text-2xl mt-1 ${k.tone}`}>{k.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          <div className="card-flat overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <TimerReset className="h-4 w-4 text-primary" />
              <p className="font-display font-bold text-sm">search_products probes</p>
            </div>
            <div className="divide-y divide-border">
              {report.probes.map((p, i) => (
                <div key={i} className="px-4 py-3 grid grid-cols-12 gap-3 items-center text-sm">
                  <div className="col-span-12 md:col-span-5">
                    <p className="font-medium">{p.label}</p>
                    {p.error && <p className="text-[11px] text-destructive mt-0.5">{p.error}</p>}
                  </div>
                  <div className="col-span-4 md:col-span-2 text-xs text-muted-foreground">
                    {p.row_count} rows{p.total_count != null ? ` / ${p.total_count.toLocaleString()} total` : ""}
                  </div>
                  <div className={`col-span-4 md:col-span-3 font-mono text-xs ${p.duration_ms > 2500 ? "text-amber-600" : "text-muted-foreground"}`}>
                    {p.duration_ms} ms
                  </div>
                  <div className="col-span-4 md:col-span-2 text-right">
                    {p.timeout ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive"><XCircle className="h-3 w-3" /> TIMEOUT</span>
                    ) : p.ok ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><CheckCircle2 className="h-3 w-3" /> OK</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive"><XCircle className="h-3 w-3" /> ERROR</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!report && loading && (
        <div className="card-flat p-10 text-center text-sm text-muted-foreground">Running catalog probes…</div>
      )}
    </div>
  );
};

export default CatalogHealthModule;
