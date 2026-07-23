import { useEffect, useState } from "react";
import { DollarSign, Gauge, BarChart3, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type UsageRow = {
  id: string;
  source: string;
  provider: string;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
};

type DayBucket = { date: string; spendZar: number };

const CostUsageModule = () => {
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [usdToZar, setUsdToZar] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: usageRows }, { data: rate }] = await Promise.all([
        supabase
          .from("ai_usage_log")
          .select("id, source, provider, total_tokens, estimated_cost_usd, created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase.from("exchange_rates").select("rate_to_zar").eq("currency_code", "USD").maybeSingle(),
      ]);
      setRows(usageRows || []);
      setUsdToZar(rate?.rate_to_zar ? Number(rate.rate_to_zar) : null);
      setLoading(false);
    })();
  }, []);

  const totalTokens = rows.reduce((s, r) => s + (r.total_tokens || 0), 0);
  const totalCostUsd = rows.reduce((s, r) => s + (r.estimated_cost_usd || 0), 0);
  const totalCostZar = usdToZar !== null ? totalCostUsd * usdToZar : null;
  const rowsWithoutCost = rows.filter((r) => r.estimated_cost_usd === null).length;

  const bySource = new Map<string, { tokens: number; costUsd: number; count: number }>();
  for (const r of rows) {
    const entry = bySource.get(r.source) || { tokens: 0, costUsd: 0, count: 0 };
    entry.tokens += r.total_tokens || 0;
    entry.costUsd += r.estimated_cost_usd || 0;
    entry.count += 1;
    bySource.set(r.source, entry);
  }

  const bucketKey = (iso: string) => {
    const d = new Date(iso);
    return period === "daily"
      ? d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" })
      : d.toLocaleDateString("en-ZA", { month: "short", year: "numeric" });
  };
  const buckets = new Map<string, number>();
  for (const r of rows) {
    if (r.estimated_cost_usd === null || usdToZar === null) continue;
    const key = bucketKey(r.created_at);
    buckets.set(key, (buckets.get(key) || 0) + r.estimated_cost_usd * usdToZar);
  }
  const history: DayBucket[] = Array.from(buckets.entries())
    .map(([date, spendZar]) => ({ date, spendZar }))
    .slice(-14);
  const maxHistorySpend = Math.max(1, ...history.map((h) => h.spendZar));

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card-flat p-5 h-24 animate-pulse bg-muted/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card-flat p-4 flex items-start gap-3 bg-primary/[0.03] border-primary/20">
        <Info className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Tracks real usage from the admin AI agent only. The customer-facing chat streams its
          response and isn't instrumented yet -- so figures here undercount total AI usage.
          {rowsWithoutCost > 0 && ` ${rowsWithoutCost} logged call(s) used the AI gateway fallback, whose per-token cost isn't publicly documented, so tokens are counted but cost isn't estimated for those.`}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="card-flat p-12 text-center">
          <Gauge className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
          <p className="font-display font-bold text-lg mb-1">No AI usage recorded yet</p>
          <p className="text-sm text-muted-foreground">Usage will appear here once the admin AI agent is used.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="card-flat p-5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                <DollarSign className="h-5 w-5" />
              </div>
              <p className="font-display font-extrabold text-2xl">
                {totalCostZar !== null ? `R${totalCostZar.toFixed(2)}` : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Estimated Spend (OpenAI-billed calls)</p>
            </div>
            <div className="card-flat p-5">
              <div className="w-10 h-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center mb-3">
                <Gauge className="h-5 w-5" />
              </div>
              <p className="font-display font-extrabold text-2xl">{totalTokens.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Tokens Logged</p>
            </div>
            <div className="card-flat p-5">
              <div className="w-10 h-10 rounded-xl bg-[hsl(160,84%,39%)]/10 text-[hsl(160,84%,39%)] flex items-center justify-center mb-3">
                <BarChart3 className="h-5 w-5" />
              </div>
              <p className="font-display font-extrabold text-2xl">{rows.length.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">Logged AI Calls</p>
            </div>
          </div>

          <div className="card-flat overflow-hidden">
            <div className="px-5 py-4 border-b border-border">
              <h3 className="font-display font-bold text-sm">Per-Service Breakdown</h3>
            </div>
            <div className="divide-y divide-border/50">
              {Array.from(bySource.entries()).map(([source, s]) => (
                <div key={source} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <p className="text-sm font-semibold">{source}</p>
                    <p className="text-xs text-muted-foreground">{s.tokens.toLocaleString()} tokens · {s.count} call(s)</p>
                  </div>
                  <p className="text-sm font-display font-bold">
                    {s.costUsd > 0 && usdToZar !== null ? `R${(s.costUsd * usdToZar).toFixed(2)}` : "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {history.length > 0 && (
            <div className="card-flat p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-bold text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" /> Spend History
                </h3>
                <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                  <button onClick={() => setPeriod("daily")} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${period === "daily" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Daily</button>
                  <button onClick={() => setPeriod("monthly")} className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${period === "monthly" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Monthly</button>
                </div>
              </div>
              <div className="flex items-end gap-2 h-32">
                {history.map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-primary/20 rounded-t flex items-end" style={{ height: "100%" }}>
                      <div className="w-full bg-primary rounded-t" style={{ height: `${Math.max(2, (h.spendZar / maxHistorySpend) * 100)}%` }} />
                    </div>
                    <span className="text-[9px] text-muted-foreground">{h.date}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CostUsageModule;
