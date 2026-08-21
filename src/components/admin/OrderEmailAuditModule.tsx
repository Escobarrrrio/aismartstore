import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { adminRpc } from "@/lib/admin-rpc";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList, RefreshCw, Send, AlertTriangle, CheckCircle2, Clock, RotateCcw, Search,
} from "lucide-react";

/**
 * Order notification audit log.
 *
 * One row per customer/owner email an order produced, with the answer to the
 * only three questions that matter when someone says "I never got anything":
 * did it leave the building, when exactly, and if not — what went wrong and
 * when will it try again.
 */

interface AuditRow {
  id: string;
  order_id: string;
  order_short: string;
  customer_name: string | null;
  template_status: string;
  recipient_email: string;
  subject: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  provider_message_id: string | null;
  created_at: string;
  sent_at: string | null;
  delivery_status: string | null;
  delivery_error: string | null;
  delivery_logged_at: string | null;
}

const FILTERS = [
  { id: "", label: "All" },
  { id: "queued", label: "Waiting" },
  { id: "sent", label: "Delivered" },
  { id: "failed", label: "Failed" },
] as const;

const tone = (status: string) =>
  status === "sent"
    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
    : status === "failed"
      ? "bg-destructive/10 text-destructive border-destructive/20"
      : "bg-amber-500/10 text-amber-600 border-amber-500/20";

const stamp = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-ZA", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
      })
    : "—";

const OrderEmailAuditModule = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draining, setDraining] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await adminRpc<AuditRow[]>("admin_order_email_audit", {
      p_order_id: null,
      p_status: filter || null,
      p_limit: 200,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Could not load the audit log", description: error.message, variant: "destructive" });
      return;
    }
    setRows(data ?? []);
  }, [filter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const requeue = async (id: string) => {
    setBusyId(id);
    const { error } = await adminRpc("admin_requeue_order_email", { p_id: id });
    setBusyId(null);
    if (error) {
      toast({ title: "Could not re-queue", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Queued for another attempt" });
    load();
  };

  const drain = async () => {
    setDraining(true);
    const { data, error } = await supabase.functions.invoke("process-order-emails", { body: {} });
    setDraining(false);
    if (error) {
      toast({ title: "Queue run failed", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as { processed?: number; sent?: number; failed?: number };
    toast({
      title: `Processed ${r?.processed ?? 0} email${r?.processed === 1 ? "" : "s"}`,
      description: `${r?.sent ?? 0} delivered · ${r?.failed ?? 0} gave up`,
    });
    load();
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.recipient_email.toLowerCase().includes(q) ||
        r.order_short.toLowerCase().includes(q) ||
        (r.customer_name ?? "").toLowerCase().includes(q) ||
        r.subject.toLowerCase().includes(q),
    );
  }, [rows, query]);

  const counts = useMemo(
    () => ({
      sent: rows.filter((r) => r.status === "sent").length,
      queued: rows.filter((r) => r.status === "queued").length,
      failed: rows.filter((r) => r.status === "failed").length,
    }),
    [rows],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" /> Notification audit
          </h2>
          <p className="text-sm text-muted-foreground">
            Every order email, its delivery outcome, timestamps and retry history.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border hover:bg-muted">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={drain}
            disabled={draining}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-60"
          >
            <Send className="h-4 w-4" /> {draining ? "Sending…" : "Run queue now"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card-flat p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Delivered</p>
          <p className="font-display font-extrabold text-2xl flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" /> {counts.sent}
          </p>
        </div>
        <div className="card-flat p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Waiting / retrying</p>
          <p className="font-display font-extrabold text-2xl flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" /> {counts.queued}
          </p>
        </div>
        <div className="card-flat p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Gave up</p>
          <p className="font-display font-extrabold text-2xl flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> {counts.failed}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id || "all"}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-xs border ${
              filter === f.id ? "bg-primary/10 border-primary/30 text-primary font-semibold" : "border-border hover:bg-muted"
            }`}
          >
            {f.label}
          </button>
        ))}
        <label className="relative ml-auto">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Order, email or subject"
            aria-label="Search notification audit"
            className="pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-background w-64 max-w-full"
          />
        </label>
      </div>

      <div className="card-flat overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading audit log…</p>
        ) : visible.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No order notifications recorded yet.</p>
        ) : (
          <div className="divide-y divide-border">
            {visible.map((r) => (
              <div key={r.id} className="p-4 flex flex-wrap items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] border font-semibold ${tone(r.status)}`}>
                      {r.status === "sent" ? "Delivered" : r.status === "failed" ? "Failed" : "Waiting"}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">#{r.order_short}</span>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{r.template_status}</span>
                  </div>
                  <p className="text-sm font-medium mt-1 line-clamp-1">{r.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.recipient_email}
                    {r.customer_name ? ` · ${r.customer_name}` : ""}
                  </p>
                  {(r.last_error || r.delivery_error) && (
                    <p className="text-xs text-destructive mt-1 break-words">{r.last_error || r.delivery_error}</p>
                  )}
                </div>

                <dl className="text-[11px] text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-0.5 min-w-[15rem]">
                  <dt>Queued</dt><dd className="text-foreground">{stamp(r.created_at)}</dd>
                  <dt>Delivered</dt><dd className="text-foreground">{stamp(r.sent_at)}</dd>
                  {r.status !== "sent" && (<><dt>Next try</dt><dd className="text-foreground">{stamp(r.next_attempt_at)}</dd></>)}
                  <dt>Attempts</dt><dd className="text-foreground">{r.attempts}/{r.max_attempts}</dd>
                  {r.delivery_status && (<><dt>Provider</dt><dd className="text-foreground">{r.delivery_status}</dd></>)}
                  {r.provider_message_id && (
                    <><dt>Message id</dt><dd className="text-foreground font-mono truncate">{r.provider_message_id}</dd></>
                  )}
                </dl>

                {r.status !== "sent" && (
                  <button
                    onClick={() => requeue(r.id)}
                    disabled={busyId === r.id}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border hover:bg-muted disabled:opacity-60"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> {busyId === r.id ? "Queuing…" : "Retry now"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderEmailAuditModule;
