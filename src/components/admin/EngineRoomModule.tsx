import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  RefreshCw, ShieldAlert, Gauge, Cpu, AlertTriangle, CheckCircle2,
  PauseCircle, HelpCircle, Loader2, Lock,
} from "lucide-react";

/**
 * The Engine Room.
 *
 * There are already several health screens in this admin. What none of them do
 * is answer the one question worth asking first: is anything about to cost me
 * money I have not agreed to. So this screen leads with spend against caps and
 * with engines that have gone quiet, and only then shows the detail.
 *
 * All of it comes from one RPC (`engine_room_snapshot`). Building it from six
 * separate queries would let the page render a confident all-clear while the
 * one failing call is still in flight -- which is worse than no screen at all,
 * because a green dashboard actively discourages looking further.
 */

type EngineStatus = "ok" | "running" | "degraded" | "failing" | "stalled" | "unknown";

interface Engine {
  key: string;
  label: string;
  kind: string;
  cadence: string;
  critical: boolean;
  notes: string | null;
  last_run: string | null;
  last_status: string | null;
  last_error: string;
  items_synced: number | null;
  items_failed: number | null;
  minutes_silent: number | null;
  status: EngineStatus;
}

interface SpendRow {
  provider: string;
  label: string;
  daily_cap: number;
  monthly_cap: number;
  call_cap: number;
  hard_stop: boolean;
  enabled: boolean;
  spent_today: number;
  calls_today: number;
  spent_month: number;
  pct_daily: number;
}

interface SecurityEvent {
  kind: string;
  severity: string;
  actor: string | null;
  detail: Record<string, unknown>;
  at: string;
}

interface Snapshot {
  generated_at: string;
  engines: Engine[];
  spend: SpendRow[];
  security: { last_24h: number; high_24h: number; recent: SecurityEvent[] };
}

const STATUS_STYLE: Record<EngineStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  stalled:  { label: "Stalled",  cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: PauseCircle },
  failing:  { label: "Failing",  cls: "bg-destructive/10 text-destructive border-destructive/30", Icon: AlertTriangle },
  degraded: { label: "Degraded", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", Icon: AlertTriangle },
  unknown:  { label: "No data",  cls: "bg-muted text-muted-foreground border-border", Icon: HelpCircle },
  running:  { label: "Running",  cls: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30", Icon: Loader2 },
  ok:       { label: "Healthy",  cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", Icon: CheckCircle2 },
};

const SEVERITY_CLS: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/15 text-destructive",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  low: "bg-muted text-muted-foreground",
  info: "bg-muted text-muted-foreground",
};

const rand = (n: number) =>
  `R${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function silenceLabel(mins: number | null) {
  if (mins === null) return "never run";
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

const EngineRoomModule = () => {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingCap, setSavingCap] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: e } = await supabase.rpc("engine_room_snapshot" as never);
    if (e) {
      // The RPC raises 42501 for non-admins rather than returning an empty
      // shell, so a permission failure reads as a permission failure instead of
      // silently looking like a store with no engines and no spend.
      setError(e.message);
      setSnap(null);
    } else {
      setError(null);
      setSnap(data as unknown as Snapshot);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // Two minutes. Fast enough that an incident surfaces while someone is
    // watching, slow enough that leaving this tab open overnight is not itself
    // a load pattern worth noticing.
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, [load]);

  const saveCap = async (provider: string, patch: Record<string, unknown>) => {
    setSavingCap(provider);
    const { error: e } = await supabase.from("spend_caps" as never).update(patch as never).eq("provider", provider);
    setSavingCap(null);
    if (e) {
      // The schema refuses anything above the hard ceiling. Say which one, so
      // this reads as a designed boundary rather than a bug in the form.
      toast.error(
        e.message.includes("spend_caps_") || e.message.includes("check")
          ? "Outside the built-in ceiling. Caps can be lowered freely, but raising them past the ceiling needs a code change."
          : e.message,
      );
      return;
    }
    toast.success("Cap updated — the change is recorded in the security log.");
    load();
  };

  if (loading && !snap) {
    return (
      <div className="flex items-center gap-3 text-muted-foreground p-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading the engine room…
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6 border-destructive/30">
        <div className="flex items-start gap-3">
          <Lock className="h-5 w-5 text-destructive mt-0.5" />
          <div>
            <h3 className="font-semibold mb-1">Could not read the engine room</h3>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </div>
      </Card>
    );
  }

  const engines = snap?.engines ?? [];
  const spend = snap?.spend ?? [];
  const sec = snap?.security;

  const unhealthy = engines.filter((e) => ["stalled", "failing", "degraded"].includes(e.status));
  const nearCap = spend.filter((s) => s.pct_daily >= 80);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-bold">Engine Room</h2>
          <p className="text-sm text-muted-foreground">
            Every automated engine, every rand of external spend, and everything the guardrails refused.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Headline. Deliberately three numbers and no chart: this strip has one
          job, which is to be readable from across a room. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-wider mb-2">
            <Cpu className="h-3.5 w-3.5" /> Engines
          </div>
          <p className="text-2xl font-display font-extrabold">
            {engines.length - unhealthy.length}<span className="text-muted-foreground text-base">/{engines.length}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {unhealthy.length === 0 ? "all healthy" : `${unhealthy.length} need attention`}
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-wider mb-2">
            <Gauge className="h-3.5 w-3.5" /> Spend today
          </div>
          <p className="text-2xl font-display font-extrabold">
            {rand(spend.reduce((t, s) => t + Number(s.spent_today || 0), 0))}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {nearCap.length === 0 ? "no provider near its cap" : `${nearCap.length} provider(s) past 80%`}
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-semibold uppercase tracking-wider mb-2">
            <ShieldAlert className="h-3.5 w-3.5" /> Security events (24h)
          </div>
          <p className="text-2xl font-display font-extrabold">{sec?.last_24h ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {Number(sec?.high_24h ?? 0) > 0 ? `${sec?.high_24h} high severity` : "nothing high severity"}
          </p>
        </Card>
      </div>

      {/* Spend caps */}
      <Card className="p-5">
        <h3 className="font-display font-bold mb-1">Spend caps</h3>
        <p className="text-xs text-muted-foreground mb-5">
          Checked before every billable call, including ones you trigger yourself. Caps can be lowered
          freely; raising one past its built-in ceiling requires a code change, on purpose.
        </p>
        <div className="space-y-4">
          {spend.map((s) => {
            const metered = s.daily_cap > 0;
            const used = metered ? s.spent_today : s.calls_today;
            const cap = metered ? s.daily_cap : s.call_cap;
            const pct = Math.min(100, Number(s.pct_daily || 0));
            return (
              <div key={s.provider} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{s.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {metered
                        ? `${rand(used)} of ${rand(cap)} today · ${rand(s.spent_month)} this month`
                        : `${used.toLocaleString("en-ZA")} of ${cap.toLocaleString("en-ZA")} calls today`}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={s.hard_stop}
                        disabled={savingCap === s.provider}
                        onCheckedChange={(v) => saveCap(s.provider, { hard_stop: v })}
                      />
                      Hard stop
                    </label>
                    {metered && (
                      <div className="flex items-center gap-2">
                        <Input
                          className="h-8 w-24 text-sm"
                          inputMode="decimal"
                          value={draft[s.provider] ?? String(s.daily_cap)}
                          onChange={(ev) => setDraft((d) => ({ ...d, [s.provider]: ev.target.value }))}
                        />
                        <Button
                          size="sm" variant="outline"
                          disabled={savingCap === s.provider || (draft[s.provider] ?? String(s.daily_cap)) === String(s.daily_cap)}
                          onClick={() => saveCap(s.provider, { daily_cap_zar: Number(draft[s.provider]) })}
                        >
                          Set
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {!s.hard_stop && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                    Hard stop is off — this cap will warn but not block.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Engines */}
      <Card className="p-5">
        <h3 className="font-display font-bold mb-1">Engines</h3>
        <p className="text-xs text-muted-foreground mb-5">
          Worst first. “Stalled” means it has not run inside its own cadence — the failure nothing else
          in this admin notices, because a stopped job produces no errors to display.
        </p>
        <div className="space-y-2">
          {engines.map((e) => {
            const st = STATUS_STYLE[e.status] ?? STATUS_STYLE.unknown;
            const Icon = st.Icon;
            return (
              <div key={e.key} className="flex flex-wrap items-start gap-3 rounded-xl border border-border p-4">
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${e.status === "running" ? "animate-spin" : ""} ${
                  e.status === "ok" ? "text-emerald-600" : e.status === "degraded" ? "text-amber-600"
                  : e.status === "unknown" ? "text-muted-foreground" : "text-destructive"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-sm">{e.label}</p>
                    <Badge variant="outline" className={`text-[10px] ${st.cls}`}>{st.label}</Badge>
                    {e.critical && <Badge variant="outline" className="text-[10px]">critical</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {e.cadence} · last run {silenceLabel(e.minutes_silent)}
                    {e.items_synced !== null && ` · ${e.items_synced.toLocaleString("en-ZA")} items`}
                    {e.items_failed ? ` · ${e.items_failed.toLocaleString("en-ZA")} failed` : ""}
                  </p>
                  {e.last_error && (
                    <p className="text-xs text-destructive mt-1.5 break-words font-mono">{e.last_error}</p>
                  )}
                  {e.notes && e.status !== "ok" && (
                    <p className="text-xs text-muted-foreground mt-1.5 italic">{e.notes}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Security */}
      <Card className="p-5">
        <h3 className="font-display font-bold mb-1">Refusals and changes</h3>
        <p className="text-xs text-muted-foreground mb-5">
          Written by the guardrails themselves. Nobody — including an admin session — can edit or delete
          rows here, which is the only thing that makes it worth reading after an incident.
        </p>
        {(sec?.recent?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
            {sec!.recent.map((ev, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border px-3 py-2">
                <Badge className={`text-[10px] ${SEVERITY_CLS[ev.severity] ?? SEVERITY_CLS.info}`}>
                  {ev.severity}
                </Badge>
                <span className="text-sm font-medium">{ev.kind.replace(/_/g, " ")}</span>
                {ev.actor && <span className="text-xs text-muted-foreground">· {ev.actor}</span>}
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(ev.at).toLocaleString("en-ZA")}
                </span>
                <pre className="w-full text-[11px] text-muted-foreground font-mono whitespace-pre-wrap break-all mt-1">
                  {JSON.stringify(ev.detail)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </Card>

      {snap && (
        <p className="text-[11px] text-muted-foreground text-center">
          Snapshot taken {new Date(snap.generated_at).toLocaleString("en-ZA")} · refreshes every 2 minutes
        </p>
      )}
    </div>
  );
};

export default EngineRoomModule;
