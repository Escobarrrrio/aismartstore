import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Zap, ShieldCheck } from "lucide-react";

type YocoHealth = {
  mode: "live" | "test" | "unknown";
  secret_key_configured: boolean;
  webhook_secret_configured: boolean;
  endpoint: string;
  endpoint_reachable: boolean;
  endpoint_status: number | null;
  signature_failures_24h: number;
  events: Array<{ id: string; event_type: string; status: string; error_message: string | null; payload: any; created_at: string }>;
};

const Row = ({ label, ok, detail, warn }: { label: string; ok: boolean; detail?: string; warn?: boolean }) => (
  <div className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-none">
    <span className="text-sm font-medium">{label}</span>
    <span className="flex items-center gap-2 text-xs">
      {detail && <span className="text-muted-foreground font-mono">{detail}</span>}
      {ok
        ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 font-semibold"><CheckCircle2 className="h-3 w-3" />OK</span>
        : warn
          ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 font-semibold"><AlertTriangle className="h-3 w-3" />Warning</span>
          : <span className="inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 font-semibold"><XCircle className="h-3 w-3" />Fail</span>}
    </span>
  </div>
);

const YocoHealthModule = () => {
  const [data, setData] = useState<YocoHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data: res, error } = await supabase.functions.invoke("yoco-health");
    if (error) setErr(error.message);
    else setData(res as YocoHealth);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-display font-bold text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />Yoco integration diagnostics</h3>
          <button onClick={load} className="px-3 py-1.5 rounded-lg border border-input bg-card text-xs font-display font-semibold flex items-center gap-1.5 hover:bg-muted">
            <RefreshCw className="h-3.5 w-3.5" /> Re-check
          </button>
        </div>
        <div className="p-5">
          {loading ? (
            <p className="text-sm text-muted-foreground">Running checks…</p>
          ) : err ? (
            <p className="text-sm text-red-600">Diagnostics failed: {err}</p>
          ) : data ? (
            <>
              <Row label="Yoco mode" ok={data.mode === "live"} warn={data.mode === "test"} detail={data.mode.toUpperCase()} />
              <Row label="YOCO_SECRET_KEY configured" ok={data.secret_key_configured} />
              <Row label="YOCO_WEBHOOK_SECRET configured" ok={data.webhook_secret_configured} />
              <Row label="Webhook endpoint reachable" ok={data.endpoint_reachable} detail={data.endpoint_status ? `HTTP ${data.endpoint_status}` : "no response"} />
              <Row label="Signature failures (24h)" ok={data.signature_failures_24h === 0} warn={data.signature_failures_24h > 0 && data.signature_failures_24h < 5} detail={String(data.signature_failures_24h)} />
              <p className="text-[11px] text-muted-foreground mt-3 break-all">Endpoint: <code>{data.endpoint}</code></p>
            </>
          ) : null}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="font-display font-bold text-sm">Latest 20 webhook events</h3>
        </div>
        {data && data.events.length ? (
          <div className="divide-y divide-border/50">
            {data.events.map((e) => (
              <div key={e.id} className="px-5 py-3 text-sm flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-mono text-[12px] truncate">{e.event_type}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(e.created_at).toLocaleString()}</p>
                  {e.error_message && <p className="text-[11px] text-red-600 mt-0.5">{e.error_message}</p>}
                </div>
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  e.status === "received"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-red-50 text-red-700 border-red-200"
                }`}>{e.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-muted-foreground">No webhook events recorded yet.</p>
        )}
      </div>
    </div>
  );
};

export default YocoHealthModule;
