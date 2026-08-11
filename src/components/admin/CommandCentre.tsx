// Admin -> Settings.
//
// WHAT THIS USED TO BE, AND WHY IT IS NOT THAT ANY MORE
//
// This screen was a 684-line "Command Centre" with ten sub-modules, and almost
// all of it was scenery:
//
//   * Nineteen metric cards were string literals. "Threat Level: Low",
//     "Blocked IPs: 0", "Abuse Alerts: 0", "Uptime: 99.9%", "Today's Spend:
//     R0.00". Not defaults awaiting data -- constants. The security tiles would
//     have read all-clear in the middle of an attack and the spend tiles would
//     have read R0.00 through a runaway bill, which is exactly when someone
//     looks at them.
//
//   * "Threat Monitor" and "Service Status" listed six services each with a
//     hardcoded green dot and the word "Clear".
//
//   * Roughly twenty action buttons -- Pause Storefront, Block Suspicious IPs,
//     Retry Failed Jobs, Restore Backup, Rollback -- all routed to one handler
//     that showed a toast reading "Operation completed successfully" and did
//     nothing else. In an incident you would click Block Suspicious IPs, be
//     told it worked, and be no safer than before.
//
// A dashboard that cannot be wrong is not a dashboard, it is wallpaper, and
// wallpaper that looks like instrumentation is worse than a blank panel
// because it gets trusted.
//
// What is left is what was real: the credential vault, the store rules, and
// the order audit trail. The numbers at the top now come from
// `admin_command_metrics()`, which reads tables that are actually written to.
// Metrics that could not be sourced honestly -- uptime, active sessions, API
// health, error rate -- are gone rather than invented, because "we do not
// measure that" is true and "99.9%" was not.
//
// The operational work those buttons pretended to do lives in modules that
// genuinely do it: Engine Room, Security, Sync Logs, Sourcing & Pricing,
// Catalogue Health.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Shield, Key, DollarSign, Eye, EyeOff, AlertTriangle,
  RefreshCw, Save, Package, Loader2, FileText, Bell, ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CommandCentreProps {
  settings: Record<string, string>;
  setSettings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

/** Exactly the shape `admin_command_metrics()` returns. */
interface Metrics {
  generated_at: string;
  blocked_now: number;
  quarantined_open: number;
  quarantined_24h: number;
  security_events_24h: number;
  security_events_critical_24h: number;
  spend_today_zar: number;
  spend_month_zar: number;
  monthly_cap_zar: number;
  caps_hit_24h: number;
  failed_jobs_24h: number;
  last_sync_at: string | null;
  open_tickets: number;
  pending_orders: number;
  orders_24h: number;
  products_live: number;
  products_in_stock: number;
  products_stale_7d: number;
  products_below_cost: number;
}

const SECRET_FIELDS = [
  // Yoco's real key format is yoco_live_... / yoco_test_..., not Stripe's
  // sk_live_ -- see supabase/functions/yoco-health for the fuller story of how
  // that assumption cost a false "Fail" on a correctly configured key.
  { name: "Yoco Secret Key", key: "yoco_secret_key", placeholder: "yoco_live_…", sensitive: true },
  { name: "Axiz API Key", key: "axiz_api_key", placeholder: "Your Axiz API key…", sensitive: true },
  { name: "Telnyx API Key", key: "telnyx_api_key", placeholder: "KEY…", sensitive: true },
  { name: "Make Pro Webhook", key: "make_webhook_url", placeholder: "https://hook.eu1.make.com/…", sensitive: false },
  // Powers the Competitor Watch panel in Sourcing & Pricing (daily SerpAPI
  // Google Shopping lookups) -- see sync-competitor-prices. Free-tier
  // accounts get 100 searches/month; the "Monthly search budget" field
  // below keeps the sync well under that automatically.
  { name: "SerpAPI Key", key: "serpapi_key", placeholder: "Your SerpAPI key…", sensitive: true },
  // Not consumed by anything shipped yet -- stored here so it's ready the
  // moment a feature needs real-time web search/research (Tavily's own
  // product) instead of scraping sites directly, the same trade-off that
  // made SerpAPI the right call for competitor pricing above.
  { name: "Tavily API Key", key: "tavily_api_key", placeholder: "tvly-…", sensitive: true },
];

const rand = (n: number | null | undefined) =>
  n == null ? "—" : `R${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const timeAgo = (iso: string | null) => {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const StatusDot = ({ status }: { status: "ok" | "warn" | "error" | "off" }) => {
  const colors = { ok: "bg-emerald-500", warn: "bg-amber-500", error: "bg-red-500", off: "bg-muted-foreground/30" };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]} shrink-0`} />;
};

/**
 * One real number.
 *
 * `value` is always something the caller read from the database. There is no
 * default and no placeholder: a tile with nothing behind it is not rendered.
 */
const Metric = ({ label, value, tone = "ok", hint }: {
  label: string; value: string; tone?: "ok" | "warn" | "error"; hint?: string;
}) => (
  <div className={`rounded-xl border p-4 ${
    tone === "error" ? "border-destructive/50 bg-destructive/5"
    : tone === "warn" ? "border-amber-500/50 bg-amber-500/5"
    : "border-border"
  }`}>
    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{label}</p>
    <p className={`text-2xl font-extrabold tracking-tight mt-1 ${
      tone === "error" ? "text-destructive" : tone === "warn" ? "text-amber-600" : ""
    }`}>{value}</p>
    {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
  </div>
);

const SectionCard = ({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) => (
  <section className="rounded-xl border border-border overflow-hidden">
    <div className="px-4 sm:px-5 py-3 border-b border-border flex items-center gap-2">
      {icon}
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
    <div className="p-4 sm:p-5">{children}</div>
  </section>
);

const CommandCentre = ({ settings, setSettings }: CommandCentreProps) => {
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [auditLog, setAuditLog] = useState<Array<{ event_type: string; actor_email: string | null; created_at: string }>>([]);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_command_metrics");
    // A failure is shown, not swallowed into zeroes. Zeroes are what the old
    // screen displayed unconditionally, and they are indistinguishable from
    // "everything is fine".
    setMetricsError(error ? error.message : null);
    setMetrics(error ? null : (data as unknown as Metrics));
    setLoading(false);
  }, []);

  useEffect(() => { void loadMetrics(); }, [loadMetrics]);

  useEffect(() => {
    supabase
      .from("order_audit_log")
      .select("event_type, actor_email, created_at")
      .order("created_at", { ascending: false })
      .limit(8)
      .then(({ data }) => setAuditLog((data ?? []) as Array<{ event_type: string; actor_email: string | null; created_at: string }>));
  }, []);

  const update = (key: string, value: string) => setSettings((prev) => ({ ...prev, [key]: value }));

  const saveSetting = async (key: string, value: string) => {
    // Skip masked previews (e.g. "__MASKED__:1234") so viewing a secret never
    // overwrites the real one with its own placeholder.
    if (value.startsWith("__MASKED__:")) return;
    const { data: existing } = await supabase.from("store_settings").select("id").eq("key", key).maybeSingle();
    if (existing) await supabase.from("store_settings").update({ value }).eq("key", key);
    else await supabase.from("store_settings").insert({ key, value });
  };

  const handleSaveAll = async () => {
    setSaving(true);
    const keys = [...SECRET_FIELDS.map((f) => f.key), "notification_email", "min_sellable_price", "serpapi_monthly_budget"];
    try {
      await Promise.all(keys.map((k) => saveSetting(k, settings[k] ?? "")));
      toast({ title: "Settings saved" });
    } catch (err) {
      toast({
        title: "Not everything saved",
        description: err instanceof Error ? err.message : "Check the values and try again.",
        variant: "destructive",
      });
    }
    setSaving(false);
  };

  const maskSecret = (val?: string) => {
    if (!val) return "Not configured";
    if (val.startsWith("__MASKED__:")) return "•••• " + val.slice("__MASKED__:".length);
    if (val.length < 8) return "****";
    return val.slice(0, 4) + "****" + val.slice(-4);
  };

  const m = metrics;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Settings</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {m ? `Live figures, read ${timeAgo(m.generated_at)}.` : "Credentials and store configuration."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMetrics()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted min-h-[40px]"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {metricsError && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">Could not read the live figures</p>
            <p className="text-xs text-muted-foreground mt-0.5">{metricsError}</p>
          </div>
        </div>
      )}

      {loading && !m ? (
        <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading live figures…
        </p>
      ) : m ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric
              label="Spend today"
              value={rand(m.spend_today_zar)}
              hint={`${rand(m.spend_month_zar)} this month${m.monthly_cap_zar > 0 ? ` of ${rand(m.monthly_cap_zar)}` : ""}`}
              tone={m.monthly_cap_zar > 0 && m.spend_month_zar > m.monthly_cap_zar * 0.8 ? "warn" : "ok"}
            />
            <Metric
              label="Blocked right now"
              value={String(m.blocked_now)}
              hint={`${m.quarantined_24h} quarantined in 24h`}
              tone={m.blocked_now > 0 ? "warn" : "ok"}
            />
            <Metric
              label="Critical events 24h"
              value={String(m.security_events_critical_24h)}
              hint={`${m.security_events_24h} security events total`}
              tone={m.security_events_critical_24h > 0 ? "error" : "ok"}
            />
            <Metric
              label="Failed jobs 24h"
              value={String(m.failed_jobs_24h)}
              hint={`last good sync ${timeAgo(m.last_sync_at)}`}
              tone={m.failed_jobs_24h > 0 ? "warn" : "ok"}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Pending orders" value={String(m.pending_orders)} hint={`${m.orders_24h} placed in 24h`} />
            <Metric label="Open tickets" value={String(m.open_tickets)} tone={m.open_tickets > 0 ? "warn" : "ok"} />
            <Metric
              label="Live products"
              value={m.products_live.toLocaleString("en-ZA")}
              hint={`${m.products_in_stock.toLocaleString("en-ZA")} in stock`}
            />
            <Metric
              label="Priced below cost"
              value={String(m.products_below_cost)}
              hint={m.products_stale_7d > 0 ? `${m.products_stale_7d.toLocaleString("en-ZA")} prices over a week old` : undefined}
              tone={m.products_below_cost > 0 ? "error" : m.products_stale_7d > 0 ? "warn" : "ok"}
            />
          </div>
        </>
      ) : null}

      <SectionCard title="Credential vault" icon={<Key className="h-4 w-4" />}>
        <div className="space-y-3">
          {SECRET_FIELDS.map((f) => (
            <div key={f.key} className="rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold">{f.name}</span>
                <StatusDot status={settings[f.key] ? "ok" : "off"} />
                <span className="text-xs text-muted-foreground">
                  {settings[f.key] ? "configured" : "not configured"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type={f.sensitive && !revealed[f.key] ? "password" : "text"}
                  value={settings[f.key] ?? ""}
                  onChange={(e) => update(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 min-w-[12rem] rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                />
                {f.sensitive && (
                  <button
                    type="button"
                    onClick={() => setRevealed((r) => ({ ...r, [f.key]: !r[f.key] }))}
                    aria-label={revealed[f.key] ? `Hide ${f.name}` : `Show ${f.name}`}
                    className="grid place-items-center h-10 w-10 rounded-lg border border-border hover:bg-muted"
                  >
                    {revealed[f.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-2 truncate">{maskSecret(settings[f.key])}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Store rules" icon={<Package className="h-4 w-4" />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5" htmlFor="notification_email">
              Notification email
            </label>
            <input
              id="notification_email"
              type="email"
              value={settings.notification_email ?? ""}
              onChange={(e) => update("notification_email", e.target.value)}
              placeholder="you@aismartstore.co.za"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">Order alerts and Engine Room warnings go here.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" htmlFor="min_sellable_price">
              Minimum sellable price (R)
            </label>
            <input
              id="min_sellable_price"
              type="number"
              min={0}
              step="1"
              value={settings.min_sellable_price ?? ""}
              onChange={(e) => update("min_sellable_price", e.target.value)}
              placeholder="50"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Distributor lines below this are treated as feed artefacts, not products.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" htmlFor="serpapi_monthly_budget">
              SerpAPI monthly search budget
            </label>
            <input
              id="serpapi_monthly_budget"
              type="number"
              min={0}
              step="1"
              value={settings.serpapi_monthly_budget ?? ""}
              onChange={(e) => update("serpapi_monthly_budget", e.target.value)}
              placeholder="90"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Competitor Watch (Sourcing &amp; Pricing) stops itself here each month, below your SerpAPI plan's real limit.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-4 inline-flex items-center gap-1.5">
          <DollarSign className="h-3.5 w-3.5" />
          Margin is set per category in <strong>Sourcing &amp; Pricing</strong>, not here.
        </p>
      </SectionCard>

      <SectionCard title="Recent order activity" icon={<FileText className="h-4 w-4" />}>
        {auditLog.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border -my-2">
            {auditLog.map((row, i) => (
              <li key={i} className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{row.event_type.replace(/_/g, " ")}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {row.actor_email ?? "system"} · {timeAgo(row.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Where the operational controls actually are. The buttons that used to
          sit here -- Pause Storefront, Block Suspicious IPs, Retry Failed Jobs,
          Restore Backup, Rollback -- all called one handler that showed
          "Operation completed successfully" and did nothing. Pointing at the
          modules that really do the work is worth more than a button that
          lies. */}
      <SectionCard title="Where the controls are" icon={<Shield className="h-4 w-4" />}>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          {[
            ["Engine Room", "spend caps, guardrails, health assessments"],
            ["Security", "threat blocks, quarantine, security events"],
            ["Sync Logs", "catalogue sync runs and failures"],
            ["Sourcing & Pricing", "margin by category, cost and freshness"],
            ["Catalogue Health", "image and category integrity"],
            ["Yoco Health", "payment gateway configuration checks"],
          ].map(([name, desc]) => (
            <li key={name} className="rounded-lg border border-border p-3">
              <span className="font-semibold inline-flex items-center gap-1.5">
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />{name}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </li>
          ))}
        </ul>
      </SectionCard>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleSaveAll()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-5 py-2.5 text-sm font-semibold disabled:opacity-50 min-h-[44px]"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </button>
      </div>

      <p className="text-xs text-muted-foreground inline-flex items-start gap-1.5">
        <Bell className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        Secrets used by edge functions (Resend, Courier Guy, the Axiz OAuth pair) live in the
        Supabase dashboard, not here — they are write-only and never sent to a browser.
      </p>
    </div>
  );
};

export default CommandCentre;
