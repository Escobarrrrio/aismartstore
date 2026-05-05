import { useState, useEffect } from "react";
import { Activity, Database, Zap, RefreshCw, CheckCircle, AlertTriangle, XCircle, Clock, Server } from "lucide-react";

const StatusPill = ({ status }: { status: "healthy" | "degraded" | "down" }) => {
  const map = {
    healthy: { cls: "bg-emerald-500/10 text-emerald-600 border-emerald-200", icon: CheckCircle, label: "Healthy" },
    degraded: { cls: "bg-amber-500/10 text-amber-600 border-amber-200", icon: AlertTriangle, label: "Degraded" },
    down: { cls: "bg-red-500/10 text-red-600 border-red-200", icon: XCircle, label: "Down" },
  };
  const s = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-display font-bold border ${s.cls}`}>
      <s.icon className="h-3 w-3" />{s.label}
    </span>
  );
};

const SystemHealthModule = () => {
  const [health, setHealth] = useState({
    uptime: "99.97%",
    api: "healthy" as const,
    database: "healthy" as const,
    automations: "healthy" as const,
    sync: "healthy" as const,
    errorRate: "0.03%",
    queueDepth: 2,
    lastSuccessfulSync: new Date(Date.now() - 3600000).toLocaleString(),
    lastFailedSync: "None",
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Uptime", value: health.uptime, icon: Server, color: "bg-emerald-500/10 text-emerald-600" },
          { label: "Error Rate", value: health.errorRate, icon: AlertTriangle, color: "bg-amber-500/10 text-amber-600" },
          { label: "Queue Depth", value: health.queueDepth, icon: Clock, color: "bg-primary/10 text-primary" },
          { label: "Active Services", value: "5/5", icon: Activity, color: "bg-secondary/10 text-secondary" },
        ].map((s, i) => (
          <div key={i} className="card-flat p-5">
            <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mb-3`}>
              <s.icon className="h-5 w-5" />
            </div>
            <p className="font-display font-extrabold text-2xl">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-sm">Service Status</h3>
        </div>
        <div className="divide-y divide-border">
          {[
            { name: "API Gateway", status: health.api, desc: "Primary API endpoint" },
            { name: "Database", status: health.database, desc: "PostgreSQL primary" },
            { name: "Automations Engine", status: health.automations, desc: "Make Pro webhooks" },
            { name: "Product Sync", status: health.sync, desc: "Axiz integration" },
            { name: "Payment Gateway", status: "healthy" as const, desc: "Yoco checkout" },
          ].map((svc, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-sm font-semibold">{svc.name}</p>
                <p className="text-xs text-muted-foreground">{svc.desc}</p>
              </div>
              <StatusPill status={svc.status} />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card-flat p-5">
          <h4 className="font-display font-bold text-sm mb-3 flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-emerald-500" /> Last Successful Sync
          </h4>
          <p className="text-sm text-muted-foreground">{health.lastSuccessfulSync}</p>
        </div>
        <div className="card-flat p-5">
          <h4 className="font-display font-bold text-sm mb-3 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-500" /> Last Failed Sync
          </h4>
          <p className="text-sm text-muted-foreground">{health.lastFailedSync}</p>
        </div>
      </div>
    </div>
  );
};

export default SystemHealthModule;
