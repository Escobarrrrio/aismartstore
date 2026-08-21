import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { KeyRound, RefreshCw, ShieldCheck, Copy, Check, TimerReset, BookOpen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Internal cron secret rotation.
 *
 * Scheduled jobs authenticate to the sync edge functions with a shared secret.
 * Rotating it used to mean editing every schedule by hand and risking a window
 * where jobs silently 403. This panel drives the zero-downtime path instead:
 * a new secret is minted, the vault entry every schedule reads is updated in
 * place, and the previous secret stays valid for a grace window.
 */

type Version = {
  id: string;
  fingerprint: string;
  status: "active" | "retiring" | "retired";
  activated_at: string;
  expires_at: string | null;
  note: string | null;
};

const STATUS_STYLE: Record<Version["status"], string> = {
  active: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
  retiring: "bg-amber-500/10 text-amber-600 border-amber-200",
  retired: "bg-muted text-muted-foreground border-border",
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "—";

const CronSecretPanel = () => {
  const { toast } = useToast();
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [grace, setGrace] = useState(60);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("internal_cron_secret_versions" as any)
      .select("id, fingerprint, status, activated_at, expires_at, note")
      .order("activated_at", { ascending: false })
      .limit(10);
    setVersions((data as unknown as Version[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("rotate-cron-secret", { body: payload });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as any;
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    try {
      const data = await call({ action: "rotate", grace_minutes: grace });
      setRevealed(data.new_secret ?? null);
      setCopied(false);
      toast({
        title: "Secret rotated",
        description: `New key ${data.fingerprint} is live. Previous key stays valid until ${fmt(data.grace_until)}.`,
      });
      load();
    } catch (e) {
      toast({ title: "Rotation failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const finalize = async () => {
    try {
      const data = await call({ action: "finalize" });
      toast({ title: "Grace window closed", description: `${data.retired ?? 0} old key(s) retired immediately.` });
      load();
    } catch (e) {
      toast({ title: "Could not close window", description: (e as Error).message, variant: "destructive" });
    }
  };

  const copy = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasGrace = versions.some((v) => v.status === "retiring");

  return (
    <div className="card-flat overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-display font-bold text-sm flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" /> Internal cron secret
        </h3>
        <a
          href="https://github.com/"
          onClick={(e) => e.preventDefault()}
          title="See docs/CRON-SECRET-ROTATION.md in the repository"
          className="text-[11px] inline-flex items-center gap-1.5 text-muted-foreground"
        >
          <BookOpen className="h-3.5 w-3.5" /> docs/CRON-SECRET-ROTATION.md
        </a>
      </div>

      <div className="p-5 space-y-5">
        <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
          Scheduled jobs sign their calls to the sync endpoints with this shared key. Rotating it here mints a fresh
          key, updates the value every schedule reads, and keeps the previous key valid for the grace window below — so
          no job fails mid-run. Only the fingerprint is stored; the key itself is shown once.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="block mb-1.5 font-medium text-muted-foreground">Grace window (minutes)</span>
            <input
              type="number"
              min={5}
              max={1440}
              value={grace}
              onChange={(e) => setGrace(Number(e.target.value))}
              className="h-9 w-32 rounded-lg border border-border bg-background px-3 text-sm"
            />
          </label>
          <button
            onClick={rotate}
            disabled={busy}
            className="h-9 px-4 rounded-lg gradient-brand text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Rotate now
          </button>
          <button
            onClick={finalize}
            disabled={busy || !hasGrace}
            className="h-9 px-4 rounded-lg border border-border text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <TimerReset className="h-3.5 w-3.5" /> Close grace window
          </button>
        </div>

        {revealed && (
          <div className="rounded-xl border border-amber-200 bg-amber-500/10 p-4 space-y-2">
            <p className="text-xs font-semibold text-amber-700">
              Copy this key now — it will not be shown again. Paste it into the INTERNAL_CRON_SECRET function secret to
              keep the fallback in sync.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-lg bg-background border border-border px-3 py-2 text-[11px]">
                {revealed}
              </code>
              <button
                onClick={copy}
                className="h-9 px-3 rounded-lg border border-border text-xs inline-flex items-center gap-1.5"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Fingerprint</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Activated</th>
                <th className="py-2 pr-4 font-medium">Valid until</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={4} className="py-4 text-muted-foreground">
                    Loading key history…
                  </td>
                </tr>
              )}
              {!loading && versions.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-muted-foreground">
                    No key versions recorded yet.
                  </td>
                </tr>
              )}
              {versions.map((v) => (
                <tr key={v.id} className="border-t border-border/60">
                  <td className="py-2.5 pr-4 font-mono">{v.fingerprint}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${STATUS_STYLE[v.status]}`}>
                      {v.status === "active" && <ShieldCheck className="h-3 w-3" />}
                      {v.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{fmt(v.activated_at)}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {v.status === "active" ? "Current" : fmt(v.expires_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CronSecretPanel;
