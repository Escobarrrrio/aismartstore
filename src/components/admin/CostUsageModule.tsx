import { useState } from "react";
import { DollarSign, TrendingUp, AlertTriangle, Gauge, BarChart3, ArrowUpRight } from "lucide-react";

const CostUsageModule = () => {
  const [period, setPeriod] = useState<"daily" | "monthly">("monthly");

  const usage = {
    openaiTokens: 142_350,
    estimatedSpend: 14.23,
    budgetCap: 50.00,
    softWarning: 35.00,
    hardStop: 50.00,
    services: [
      { name: "OpenAI GPT", tokens: 120_000, cost: 12.00, pct: 84 },
      { name: "Lovable AI", tokens: 22_350, cost: 2.23, pct: 16 },
    ],
    history: [
      { date: "May 1", spend: 2.10 }, { date: "May 2", spend: 3.45 }, { date: "May 3", spend: 1.80 },
      { date: "May 4", spend: 4.20 }, { date: "May 5", spend: 2.68 },
    ],
  };

  const budgetPct = (usage.estimatedSpend / usage.budgetCap) * 100;
  const isWarning = usage.estimatedSpend >= usage.softWarning;
  const isCritical = usage.estimatedSpend >= usage.hardStop;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
            <DollarSign className="h-5 w-5" />
          </div>
          <p className="font-display font-extrabold text-2xl">R{usage.estimatedSpend.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">Estimated Spend</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center mb-3">
            <Gauge className="h-5 w-5" />
          </div>
          <p className="font-display font-extrabold text-2xl">{usage.openaiTokens.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Tokens Used</p>
        </div>
        <div className="card-flat p-5">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${isWarning ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <p className="font-display font-extrabold text-2xl">R{usage.budgetCap.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">Budget Cap</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-[hsl(160,84%,39%)]/10 text-[hsl(160,84%,39%)] flex items-center justify-center mb-3">
            <TrendingUp className="h-5 w-5" />
          </div>
          <p className="font-display font-extrabold text-2xl">{budgetPct.toFixed(0)}%</p>
          <p className="text-xs text-muted-foreground mt-1">Budget Used</p>
        </div>
      </div>

      {/* Budget progress bar */}
      <div className="card-flat p-5">
        <h3 className="font-display font-bold text-sm mb-4">Budget Progress</h3>
        <div className="w-full h-4 rounded-full bg-muted overflow-hidden mb-2">
          <div className={`h-full rounded-full transition-all ${isCritical ? "bg-red-500" : isWarning ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(budgetPct, 100)}%` }} />
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>R0</span>
          <span className="text-amber-500">Soft: R{usage.softWarning}</span>
          <span className="text-red-500">Hard: R{usage.hardStop}</span>
        </div>
      </div>

      {/* Per-service breakdown */}
      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-sm">Per-Service Breakdown</h3>
        </div>
        <div className="divide-y divide-border/50">
          {usage.services.map((svc, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-sm font-semibold">{svc.name}</p>
                <p className="text-xs text-muted-foreground">{svc.tokens.toLocaleString()} tokens</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-display font-bold">R{svc.cost.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">{svc.pct}%</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Spend history */}
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
          {usage.history.map((h, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full bg-primary/20 rounded-t" style={{ height: `${(h.spend / 5) * 100}%` }}>
                <div className="w-full bg-primary rounded-t" style={{ height: `${Math.min(100, (h.spend / 5) * 100)}%` }} />
              </div>
              <span className="text-[9px] text-muted-foreground">{h.date}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CostUsageModule;
