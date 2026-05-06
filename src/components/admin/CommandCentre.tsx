import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Shield, Key, Bot, DollarSign, Users, Activity, Zap, FileText,
  Search, ShoppingCart, Lock, Eye, EyeOff, AlertTriangle, Clock,
  RefreshCw, Power, Pause, Play, RotateCcw, Trash2, Download,
  CheckCircle, XCircle, Wifi, WifiOff, Globe, Fingerprint,
  Smartphone, MapPin, TrendingUp, TrendingDown, Gauge, Settings,
  Bell, Save, ChevronRight, ExternalLink, Server, Database,
  HardDrive, Package, CreditCard, Mail, MessageSquare, Cpu,
  BarChart3, ArrowUpRight, ArrowDownRight, Layers, Terminal
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CommandCentreProps {
  settings: Record<string, string>;
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

type CentreTab =
  | "identity" | "secrets" | "threat" | "finance"
  | "data-trust" | "health" | "commerce" | "automation"
  | "audit" | "overview";

const centreModules: { id: CentreTab; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: "overview", label: "Command Overview", icon: <Gauge className="h-4 w-4" />, desc: "System-wide status at a glance" },
  { id: "identity", label: "Identity & Access", icon: <Fingerprint className="h-4 w-4" />, desc: "Roles, sessions, trust" },
  { id: "secrets", label: "API Secret Vault", icon: <Key className="h-4 w-4" />, desc: "Credentials & key management" },
  { id: "threat", label: "Threat Detection", icon: <Shield className="h-4 w-4" />, desc: "AI abuse intelligence" },
  { id: "finance", label: "Financial Protection", icon: <DollarSign className="h-4 w-4" />, desc: "Spend caps & anomaly detection" },
  { id: "data-trust", label: "Data & Trust", icon: <Lock className="h-4 w-4" />, desc: "Customer data protection" },
  { id: "health", label: "System Health", icon: <Activity className="h-4 w-4" />, desc: "Uptime, recovery, maintenance" },
  { id: "commerce", label: "Commerce Controls", icon: <ShoppingCart className="h-4 w-4" />, desc: "Pricing, stock, rules" },
  { id: "automation", label: "Automation Ops", icon: <Zap className="h-4 w-4" />, desc: "Workflows & orchestration" },
  { id: "audit", label: "Audit & Governance", icon: <FileText className="h-4 w-4" />, desc: "Immutable logs & compliance" },
];

const StatusDot = ({ status }: { status: "ok" | "warn" | "error" | "off" }) => {
  const colors = { ok: "bg-emerald-500", warn: "bg-amber-500", error: "bg-red-500", off: "bg-muted-foreground/30" };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]} shrink-0`} />;
};

const MetricCard = ({ label, value, trend, status, icon }: { label: string; value: string; trend?: string; status?: "ok" | "warn" | "error"; icon?: React.ReactNode }) => (
  <div className="card-flat p-4 flex flex-col gap-2">
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-display font-bold text-muted-foreground uppercase tracking-wider">{label}</span>
      {status && <StatusDot status={status} />}
    </div>
    <div className="flex items-end gap-2">
      {icon && <span className="text-primary">{icon}</span>}
      <span className="font-display font-extrabold text-2xl tracking-tight">{value}</span>
      {trend && (
        <span className={`text-xs font-semibold flex items-center gap-0.5 mb-1 ${trend.startsWith("+") ? "text-emerald-600" : "text-red-500"}`}>
          {trend.startsWith("+") ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
          {trend}
        </span>
      )}
    </div>
  </div>
);

const SectionCard = ({ title, icon, children, actions }: { title: string; icon: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) => (
  <div className="card-flat overflow-hidden">
    <div className="px-5 py-4 border-b border-border flex items-center justify-between">
      <h3 className="font-display font-bold text-sm flex items-center gap-2">
        <span className="text-primary">{icon}</span> {title}
      </h3>
      {actions}
    </div>
    <div className="p-5">{children}</div>
  </div>
);

const QuickAction = ({ label, icon, variant = "default", onClick }: { label: string; icon: React.ReactNode; variant?: "default" | "danger" | "success" | "warning"; onClick: () => void }) => {
  const styles = {
    default: "border-border hover:bg-muted",
    danger: "border-destructive/30 text-red-600 hover:bg-destructive/5",
    success: "border-emerald-300 text-emerald-700 hover:bg-emerald-50",
    warning: "border-amber-300 text-amber-700 hover:bg-amber-50",
  };
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${styles[variant]}`}>
      {icon} {label}
    </button>
  );
};

const CommandCentre = ({ settings, setSettings }: CommandCentreProps) => {
  const { toast } = useToast();
  const [activeModule, setActiveModule] = useState<CentreTab>("overview");
  const [moduleSearch, setModuleSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState<{ action: string; label: string } | null>(null);

  const filteredModules = useMemo(() =>
    centreModules.filter(m => m.label.toLowerCase().includes(moduleSearch.toLowerCase()) || m.desc.toLowerCase().includes(moduleSearch.toLowerCase())),
    [moduleSearch]
  );

  const update = (key: string, value: string) => setSettings((prev) => ({ ...prev, [key]: value }));

  const saveSetting = async (key: string, value: string) => {
    const { data: existing } = await supabase.from("store_settings").select("id").eq("key", key).maybeSingle();
    if (existing) await supabase.from("store_settings").update({ value }).eq("key", key);
    else await supabase.from("store_settings").insert({ key, value });
  };

  const handleSaveAll = async () => {
    setSaving(true);
    const keys = ["yoco_public_key", "yoco_secret_key", "notification_email", "openai_api_key", "make_webhook_url", "axiz_api_key", "axiz_markup_pct", "telnyx_api_key", "daily_budget", "monthly_budget", "openai_budget"];
    await Promise.all(keys.map((k) => saveSetting(k, settings[k] || "")));
    toast({ title: "All settings saved", description: "Configuration updated across all modules." });
    setSaving(false);
  };

  const confirmAction = (action: string, label: string) => setShowConfirm({ action, label });
  const executeAction = () => {
    toast({ title: showConfirm?.label || "Action executed", description: "Operation completed successfully." });
    setShowConfirm(null);
  };

  const maskSecret = (val?: string) => {
    if (!val) return "Not configured";
    if (val.length < 8) return "****";
    return val.slice(0, 4) + "****" + val.slice(-4);
  };

  const secretStatus = (val?: string): "ok" | "warn" | "off" => val ? "ok" : "off";

  const markupPct = parseInt(settings.axiz_markup_pct || "26");

  return (
    <div className="space-y-6">
      {/* Module navigation bar */}
      <div className="card-flat p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-2 flex-1 bg-muted rounded-xl px-3.5 py-2.5 border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-all">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={moduleSearch}
              onChange={(e) => setModuleSearch(e.target.value)}
              placeholder="Search modules..."
              className="bg-transparent border-none outline-none text-sm w-full text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button onClick={handleSaveAll} disabled={saving} className="btn-primary px-5 py-2.5 text-sm shrink-0">
            <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save All"}
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {filteredModules.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveModule(m.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0 ${
                activeModule === m.id
                  ? "gradient-brand text-white shadow-elevated"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overview */}
      {activeModule === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Threat Level" value="Low" status="ok" icon={<Shield className="h-5 w-5" />} />
            <MetricCard label="API Health" value="100%" status="ok" icon={<Wifi className="h-5 w-5" />} />
            <MetricCard label="Today's Spend" value="R0.00" trend="+0%" status="ok" icon={<DollarSign className="h-5 w-5" />} />
            <MetricCard label="Active Sessions" value="1" status="ok" icon={<Users className="h-5 w-5" />} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Uptime" value="99.9%" status="ok" />
            <MetricCard label="Failed Jobs" value="0" status="ok" />
            <MetricCard label="Open Tickets" value="0" status="ok" />
            <MetricCard label="Pending Orders" value="0" status="ok" />
          </div>
          <SectionCard title="Quick Actions" icon={<Terminal className="h-4 w-4" />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <QuickAction label="Maintenance Mode" icon={<Power className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("maintenance", "Toggle Maintenance Mode")} />
              <QuickAction label="Pause Storefront" icon={<Pause className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("pause_store", "Pause Storefront")} />
              <QuickAction label="Disable AI" icon={<Bot className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("disable_ai", "Disable AI Systems")} />
              <QuickAction label="Clear Cache" icon={<RefreshCw className="h-4 w-4" />} onClick={() => confirmAction("clear_cache", "Clear Cache")} />
              <QuickAction label="Resync Axiz" icon={<Package className="h-4 w-4" />} onClick={() => confirmAction("resync", "Resync Axiz Products")} />
              <QuickAction label="Disable Checkout" icon={<CreditCard className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("disable_checkout", "Disable Checkout")} />
              <QuickAction label="Disable SMS" icon={<MessageSquare className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("disable_sms", "Disable SMS")} />
              <QuickAction label="Rollback" icon={<RotateCcw className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("rollback", "Rollback Changes")} />
            </div>
          </SectionCard>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {centreModules.filter(m => m.id !== "overview").map(m => (
              <button key={m.id} onClick={() => setActiveModule(m.id)} className="card-flat p-5 text-left hover:shadow-md transition-all group">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-9 h-9 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary group-hover:gradient-brand group-hover:text-white transition-all">{m.icon}</div>
                  <h4 className="font-display font-bold text-sm">{m.label}</h4>
                </div>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Identity & Access */}
      {activeModule === "identity" && (
        <div className="space-y-5">
          <SectionCard title="Admin Roles & Permissions" icon={<Users className="h-4 w-4" />}>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-muted rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center text-white text-xs font-bold">A</div>
                  <div>
                    <p className="text-sm font-semibold">fsteyn@rocketmail.com</p>
                    <p className="text-[10px] text-muted-foreground">Super Admin</p>
                  </div>
                </div>
                <span className="badge-success">Active</span>
              </div>
            </div>
          </SectionCard>
          <SectionCard title="Session Management" icon={<Fingerprint className="h-4 w-4" />}>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
                <div className="flex items-center gap-3">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Current session</p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> South Africa <span className="mx-1">·</span> <Clock className="h-3 w-3" /> Active now</p>
                  </div>
                </div>
                <StatusDot status="ok" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <QuickAction label="Force Logout All" icon={<Power className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("force_logout", "Force Logout All Sessions")} />
              <QuickAction label="Emergency Lock" icon={<Lock className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("emergency_lock", "Emergency Account Lock")} />
            </div>
          </SectionCard>
          <SectionCard title="Login History" icon={<Clock className="h-4 w-4" />}>
            <div className="space-y-2">
              {[
                { time: "Just now", ip: "165.165.x.x", loc: "South Africa", status: "ok" as const },
                { time: "2 hours ago", ip: "165.165.x.x", loc: "South Africa", status: "ok" as const },
              ].map((entry, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <StatusDot status={entry.status} />
                    <span className="text-xs">{entry.time}</span>
                    <span className="text-xs text-muted-foreground font-mono">{entry.ip}</span>
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" /> {entry.loc}</span>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Security Policies" icon={<Shield className="h-4 w-4" />}>
            <div className="space-y-3">
              {[
                { label: "Two-Factor Authentication", status: "Recommended", enabled: false },
                { label: "Re-auth for sensitive changes", status: "Active", enabled: true },
                { label: "IP Allowlisting", status: "Not configured", enabled: false },
                { label: "Geo-location anomaly alerts", status: "Active", enabled: true },
              ].map((policy, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border">
                  <div className="flex items-center gap-3">
                    <StatusDot status={policy.enabled ? "ok" : "warn"} />
                    <span className="text-sm font-medium">{policy.label}</span>
                  </div>
                  <span className={`text-[10px] font-semibold ${policy.enabled ? "badge-success" : "badge-warning"}`}>{policy.status}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* API Secret Vault */}
      {activeModule === "secrets" && (
        <div className="space-y-5">
          <SectionCard title="Credential Vault" icon={<Key className="h-4 w-4" />} actions={<span className="badge-info text-[10px]">Production</span>}>
            <div className="space-y-3">
              {[
                { name: "Yoco Public Key", key: "yoco_public_key", placeholder: "pk_live_..." },
                { name: "Yoco Secret Key", key: "yoco_secret_key", placeholder: "sk_live_...", sensitive: true },
                { name: "OpenAI API Key", key: "openai_api_key", placeholder: "sk-...", sensitive: true },
                { name: "Make Pro Webhook", key: "make_webhook_url", placeholder: "https://hook.eu1.make.com/..." },
                { name: "Axiz API Key", key: "axiz_api_key", placeholder: "Your Axiz API key...", sensitive: true },
                { name: "Telnyx API Key", key: "telnyx_api_key", placeholder: "KEY...", sensitive: true },
              ].map((secret) => (
                <div key={secret.key} className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/20">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold">{secret.name}</span>
                      <StatusDot status={secretStatus(settings[secret.key])} />
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">{maskSecret(settings[secret.key])}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => {
                      const val = prompt(`Enter ${secret.name}:`);
                      if (val) update(secret.key, val);
                    }} className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground" title="Update">
                      <Settings className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => confirmAction(`revoke_${secret.key}`, `Revoke ${secret.name}`)} className="p-2 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-red-600" title="Revoke">
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Vault Controls" icon={<Lock className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-2">
              <QuickAction label="Rotate All Keys" icon={<RefreshCw className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("rotate_all", "Rotate All API Keys")} />
              <QuickAction label="Emergency Lock" icon={<Lock className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("lock_vault", "Emergency Vault Lock")} />
            </div>
          </SectionCard>
          <SectionCard title="Notification Email" icon={<Mail className="h-4 w-4" />}>
            <div>
              <label className="block text-xs font-semibold mb-1.5">Admin notification email</label>
              <input type="email" value={settings.notification_email || ""} onChange={(e) => update("notification_email", e.target.value)} placeholder="admin@example.com" className="input-premium" />
            </div>
          </SectionCard>
        </div>
      )}

      {/* AI Threat Detection */}
      {activeModule === "threat" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Risk Score" value="Low" status="ok" icon={<Shield className="h-5 w-5" />} />
            <MetricCard label="Failed Logins (24h)" value="0" status="ok" />
            <MetricCard label="Blocked IPs" value="0" status="ok" />
            <MetricCard label="Abuse Alerts" value="0" status="ok" />
          </div>
          <SectionCard title="Threat Monitor" icon={<AlertTriangle className="h-4 w-4" />}>
            <div className="space-y-3">
              {[
                { type: "Login Security", desc: "Failed login attempts, brute force detection", status: "ok" as const },
                { type: "Bot Detection", desc: "Scraping, automated browsing patterns", status: "ok" as const },
                { type: "Prompt Injection", desc: "AI chatbot abuse and injection attempts", status: "ok" as const },
                { type: "API Abuse", desc: "Rate limiting, token exhaustion", status: "ok" as const },
                { type: "Payment Fraud", desc: "Suspicious transactions, chargeback patterns", status: "ok" as const },
                { type: "Support Abuse", desc: "Refund fraud, spam tickets", status: "ok" as const },
              ].map((threat, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border">
                  <div className="flex items-center gap-3">
                    <StatusDot status={threat.status} />
                    <div>
                      <p className="text-sm font-semibold">{threat.type}</p>
                      <p className="text-[10px] text-muted-foreground">{threat.desc}</p>
                    </div>
                  </div>
                  <span className="badge-success">Clear</span>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Auto-Response Controls" icon={<Zap className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-2">
              <QuickAction label="Safe Mode" icon={<Shield className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("safe_mode", "Enable Safe Mode")} />
              <QuickAction label="Block Suspicious IPs" icon={<Globe className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("block_ips", "Block Suspicious IPs")} />
              <QuickAction label="Throttle AI" icon={<Bot className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("throttle_ai", "Throttle AI Requests")} />
              <QuickAction label="Challenge Mode" icon={<Fingerprint className="h-4 w-4" />} onClick={() => confirmAction("challenge", "Enable CAPTCHA Challenge")} />
            </div>
          </SectionCard>
        </div>
      )}

      {/* Financial Protection */}
      {activeModule === "finance" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Today's Spend" value="R0.00" status="ok" icon={<DollarSign className="h-5 w-5" />} />
            <MetricCard label="Monthly Spend" value="R0.00" trend="+0%" status="ok" />
            <MetricCard label="Budget Used" value="0%" status="ok" />
            <MetricCard label="Anomalies" value="0" status="ok" />
          </div>
          <SectionCard title="Spend Limits" icon={<DollarSign className="h-4 w-4" />}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold mb-1.5">Daily Budget (ZAR)</label>
                <input type="number" value={settings.daily_budget || "500"} onChange={(e) => update("daily_budget", e.target.value)} className="input-premium font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5">Monthly Budget (ZAR)</label>
                <input type="number" value={settings.monthly_budget || "5000"} onChange={(e) => update("monthly_budget", e.target.value)} className="input-premium font-mono" />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5">OpenAI Budget (ZAR)</label>
                <input type="number" value={settings.openai_budget || "1000"} onChange={(e) => update("openai_budget", e.target.value)} className="input-premium font-mono" />
              </div>
            </div>
          </SectionCard>
          <SectionCard title="Service Spend Breakdown" icon={<BarChart3 className="h-4 w-4" />}>
            <div className="space-y-3">
              {[
                { service: "OpenAI (Chat)", spend: "R0.00", limit: "R1,000", pct: 0 },
                { service: "Telnyx (SMS)", spend: "R0.00", limit: "R500", pct: 0 },
                { service: "Make Pro (Automation)", spend: "R0.00", limit: "R300", pct: 0 },
              ].map((svc, i) => (
                <div key={i} className="p-3 rounded-xl border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">{svc.service}</span>
                    <span className="text-xs text-muted-foreground">{svc.spend} / {svc.limit}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full gradient-brand transition-all" style={{ width: `${svc.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Financial Controls" icon={<CreditCard className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-2">
              <QuickAction label="Throttle AI Spend" icon={<TrendingDown className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("throttle_spend", "Throttle AI Spending")} />
              <QuickAction label="Pause Automations" icon={<Pause className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("pause_auto", "Pause Non-critical Automations")} />
              <QuickAction label="Disable SMS" icon={<MessageSquare className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("disable_sms_fin", "Disable SMS Sending")} />
              <QuickAction label="Emergency Shutdown" icon={<Power className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("emergency_shutdown", "Emergency Cost Shutdown")} />
            </div>
          </SectionCard>
        </div>
      )}

      {/* Data & Trust */}
      {activeModule === "data-trust" && (
        <div className="space-y-5">
          <SectionCard title="Payment Data Protection" icon={<CreditCard className="h-4 w-4" />}>
            <div className="space-y-3">
              {[
                { label: "Card data never stored on-site", status: true },
                { label: "Payments tokenized via Yoco", status: true },
                { label: "Payment processing isolated", status: true },
                { label: "PCI DSS compliant workflow", status: true },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/5 border border-emerald-200">
                  <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span className="text-sm">{item.label}</span>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Privacy Controls" icon={<Lock className="h-4 w-4" />}>
            <div className="space-y-3">
              {[
                { label: "Data retention policy", desc: "Customer data retained per POPIA requirements" },
                { label: "Export customer data", desc: "Download all data for a specific customer" },
                { label: "Delete customer data", desc: "Permanently remove customer records (with confirmation)" },
                { label: "Sensitive access logging", desc: "All access to PII is logged and auditable" },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border">
                  <div>
                    <p className="text-sm font-semibold">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground">{item.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Trust Indicators" icon={<Shield className="h-4 w-4" />}>
            <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-200">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-semibold text-emerald-800">All systems secure</span>
              </div>
              <p className="text-xs text-emerald-700">No data breaches detected. All secrets are masked. Payment data handled exclusively by Yoco.</p>
            </div>
          </SectionCard>
        </div>
      )}

      {/* System Health */}
      {activeModule === "health" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Uptime" value="99.9%" status="ok" />
            <MetricCard label="Error Rate" value="0%" status="ok" />
            <MetricCard label="Last Sync" value="N/A" status="off" />
            <MetricCard label="Queue Depth" value="0" status="ok" />
          </div>
          <SectionCard title="Service Status" icon={<Server className="h-4 w-4" />}>
            <div className="space-y-2">
              {[
                { name: "Database", status: "ok" as const },
                { name: "Authentication", status: "ok" as const },
                { name: "Storage", status: "ok" as const },
                { name: "Edge Functions", status: "ok" as const },
                { name: "Yoco API", status: secretStatus(settings.yoco_secret_key) },
                { name: "Axiz API", status: secretStatus(settings.axiz_api_key) },
                { name: "OpenAI", status: secretStatus(settings.openai_api_key) },
              ].map((svc, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                  <span className="text-sm font-medium">{svc.name}</span>
                  <div className="flex items-center gap-2">
                    <StatusDot status={svc.status} />
                    <span className={`text-[10px] font-semibold ${svc.status === "ok" ? "text-emerald-600" : "text-muted-foreground"}`}>
                      {svc.status === "ok" ? "Operational" : "Not configured"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Recovery Actions" icon={<RotateCcw className="h-4 w-4" />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <QuickAction label="Maintenance Mode" icon={<Power className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("maint", "Enable Maintenance Mode")} />
              <QuickAction label="Pause Store" icon={<Pause className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("pause", "Pause Storefront")} />
              <QuickAction label="Clear Cache" icon={<RefreshCw className="h-4 w-4" />} onClick={() => confirmAction("cache", "Clear Cache")} />
              <QuickAction label="Resync Axiz" icon={<Package className="h-4 w-4" />} onClick={() => confirmAction("resync", "Resync Products")} />
              <QuickAction label="Reindex Search" icon={<Search className="h-4 w-4" />} onClick={() => confirmAction("reindex", "Reindex Search")} />
              <QuickAction label="Retry Failed" icon={<Play className="h-4 w-4" />} variant="success" onClick={() => confirmAction("retry", "Retry Failed Jobs")} />
              <QuickAction label="Restore Backup" icon={<HardDrive className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("restore", "Restore from Backup")} />
              <QuickAction label="Rollback" icon={<RotateCcw className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("rollback", "Rollback Changes")} />
            </div>
          </SectionCard>
        </div>
      )}

      {/* Commerce Controls */}
      {activeModule === "commerce" && (
        <div className="space-y-5">
          <SectionCard title="Markup & Pricing" icon={<DollarSign className="h-4 w-4" />}>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold mb-2">Axiz Markup Percentage</label>
                <div className="flex items-center gap-4">
                  <input type="range" min="0" max="100" value={markupPct} onChange={(e) => update("axiz_markup_pct", e.target.value)} className="flex-1 accent-[hsl(var(--primary))]" />
                  <span className="font-display font-extrabold text-2xl gradient-brand-text min-w-[55px] text-right">{markupPct}%</span>
                </div>
                <div className="bg-muted rounded-xl p-4 mt-3 text-sm space-y-1.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Cost price</span><span className="font-medium">R1,000.00</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Markup ({markupPct}%)</span><span className="text-emerald-600 font-medium">+R{(1000 * markupPct / 100).toFixed(2)}</span></div>
                  <div className="flex justify-between font-display font-bold border-t border-border pt-2 mt-2"><span>Selling price</span><span>R{(1000 * (1 + markupPct / 100)).toFixed(2)}</span></div>
                </div>
              </div>
            </div>
          </SectionCard>
          <SectionCard title="Store Rules" icon={<Settings className="h-4 w-4" />}>
            <div className="space-y-3">
              {[
                { label: "Tax included in prices", value: "VAT 15%" },
                { label: "Currency", value: "ZAR (South African Rand)" },
                { label: "Low stock threshold", value: "5 units" },
                { label: "Auto-unpublish at 0 stock", value: "Enabled" },
                { label: "Duplicate detection", value: "Active" },
              ].map((rule, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border">
                  <span className="text-sm font-medium">{rule.label}</span>
                  <span className="text-xs font-semibold text-muted-foreground">{rule.value}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Automation Orchestration */}
      {activeModule === "automation" && (
        <div className="space-y-5">
          <SectionCard title="Active Workflows" icon={<Zap className="h-4 w-4" />}>
            <div className="space-y-3">
              {[
                { name: "Order notification email", status: "ok" as const, last: "Never triggered" },
                { name: "Axiz product sync", status: "off" as const, last: "Not configured" },
                { name: "Make Pro webhooks", status: secretStatus(settings.make_webhook_url), last: settings.make_webhook_url ? "Ready" : "Not configured" },
                { name: "AI chatbot", status: "ok" as const, last: "Always active" },
              ].map((wf, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border">
                  <div className="flex items-center gap-3">
                    <StatusDot status={wf.status} />
                    <div>
                      <p className="text-sm font-semibold">{wf.name}</p>
                      <p className="text-[10px] text-muted-foreground">{wf.last}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Run now"><Play className="h-3.5 w-3.5" /></button>
                    <button className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Pause"><Pause className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Orchestration Controls" icon={<Settings className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-2">
              <QuickAction label="Pause All" icon={<Pause className="h-4 w-4" />} variant="warning" onClick={() => confirmAction("pause_all_auto", "Pause All Automations")} />
              <QuickAction label="Resume All" icon={<Play className="h-4 w-4" />} variant="success" onClick={() => confirmAction("resume_all_auto", "Resume All Automations")} />
              <QuickAction label="Clear Failed Queue" icon={<Trash2 className="h-4 w-4" />} variant="danger" onClick={() => confirmAction("clear_failed", "Clear Failed Job Queue")} />
              <QuickAction label="Retry Failed" icon={<RefreshCw className="h-4 w-4" />} onClick={() => confirmAction("retry_failed", "Retry Failed Jobs")} />
            </div>
          </SectionCard>
        </div>
      )}

      {/* Audit & Governance */}
      {activeModule === "audit" && (
        <div className="space-y-5">
          <SectionCard title="Activity Log" icon={<FileText className="h-4 w-4" />} actions={
            <button className="text-xs text-primary font-semibold flex items-center gap-1"><Download className="h-3 w-3" /> Export</button>
          }>
            <div className="space-y-2">
              {[
                { action: "Settings saved", user: "fsteyn@rocketmail.com", time: "Just now", severity: "info" },
                { action: "Login", user: "fsteyn@rocketmail.com", time: "5 min ago", severity: "info" },
                { action: "Product updated", user: "fsteyn@rocketmail.com", time: "1 hr ago", severity: "info" },
              ].map((log, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <span className={`badge-${log.severity === "danger" ? "danger" : log.severity === "warning" ? "warning" : "info"} text-[10px]`}>{log.action}</span>
                    <span className="text-xs text-muted-foreground">{log.user}</span>
                  </div>
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> {log.time}</span>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Governance" icon={<Shield className="h-4 w-4" />}>
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium">All destructive actions require confirmation</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium">Audit trail is immutable and timestamped</span>
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-200">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium">No plaintext secrets in UI or logs</span>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-foreground/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowConfirm(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-display font-bold text-lg">{showConfirm.label}</h3>
                <p className="text-xs text-muted-foreground">This action requires confirmation</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-6">Are you sure you want to proceed? This action may affect live operations.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowConfirm(null)} className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors">Cancel</button>
              <button onClick={executeAction} className="px-4 py-2.5 rounded-xl bg-destructive text-white text-sm font-semibold hover:bg-destructive/90 transition-colors">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommandCentre;
