import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/currency";
import {
  AlertTriangle, CheckCircle2, Copy, RefreshCw, ShieldAlert, Repeat, XCircle,
} from "lucide-react";

/**
 * PayFast ITN troubleshooting.
 *
 * Every callback the webhook receives lands in `payment_events` — verified or
 * not, processed or not. This surfaces it so a failed payment can be diagnosed
 * without opening a SQL console: what PayFast sent, whether it passed signature
 * and IP checks, what was decided, and whether the confirmation email went out.
 */

type PaymentEvent = {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  order_id: string | null;
  event_type: string;
  payment_status: string | null;
  amount_gross: number | string | null;
  amount_fee: number | string | null;
  amount_net: number | string | null;
  outcome: string;
  sandbox: boolean;
  source_ip: string | null;
  signature_valid: boolean | null;
  notified: boolean;
  error_message: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
};

// Outcomes that mean money may have moved without the order reflecting it, or
// that something hostile is hitting the endpoint. These are what you scan for.
const NEEDS_ATTENTION = new Set([
  "rejected_signature", "rejected_ip", "rejected_validation",
  "amount_mismatch", "error", "unknown_order",
]);

const OUTCOME_STYLE: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  processed:           { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" />, label: "Processed" },
  duplicate_ignored:   { cls: "bg-slate-50 text-slate-600 border-slate-200",       icon: <Repeat className="h-3 w-3" />,       label: "Duplicate ignored" },
  rejected_signature:  { cls: "bg-red-50 text-red-700 border-red-200",             icon: <ShieldAlert className="h-3 w-3" />,  label: "Bad signature" },
  rejected_ip:         { cls: "bg-red-50 text-red-700 border-red-200",             icon: <ShieldAlert className="h-3 w-3" />,  label: "Untrusted IP" },
  rejected_validation: { cls: "bg-amber-50 text-amber-800 border-amber-200",       icon: <AlertTriangle className="h-3 w-3" />, label: "Not confirmed by PayFast" },
  amount_mismatch:     { cls: "bg-red-50 text-red-700 border-red-200",             icon: <AlertTriangle className="h-3 w-3" />, label: "Amount mismatch" },
  unknown_order:       { cls: "bg-amber-50 text-amber-800 border-amber-200",       icon: <AlertTriangle className="h-3 w-3" />, label: "No order id" },
  error:               { cls: "bg-red-50 text-red-700 border-red-200",             icon: <XCircle className="h-3 w-3" />,      label: "Handler error" },
};

const money = (v: number | string | null) =>
  v === null || v === "" ? "—" : formatMoney(Number(v));

const PaymentEventsModule = () => {
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("payment_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (err) setError(err.message);
    else {
      setError(null);
      setEvents((data as PaymentEvent[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const attentionCount = useMemo(
    () => events.filter((e) => NEEDS_ATTENTION.has(e.outcome)).length,
    [events],
  );
  const visible = useMemo(
    () => (filter === "attention" ? events.filter((e) => NEEDS_ATTENTION.has(e.outcome)) : events),
    [events, filter],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-bold">Payment Events</h2>
          <p className="text-sm text-muted-foreground">
            Every PayFast ITN callback, verified or not. Newest 200.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-muted p-1" role="radiogroup" aria-label="Filter payment events">
            {([["all", `All (${events.length})`], ["attention", `Needs attention (${attentionCount})`]] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={filter === v}
                onClick={() => setFilter(v)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filter === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button onClick={load} className="btn-secondary px-3 py-2 text-sm" aria-label="Refresh payment events">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {attentionCount > 0 && (
        <div className="card-flat border-amber-300 bg-amber-50/60 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">
            <strong>{attentionCount}</strong> callback{attentionCount === 1 ? "" : "s"} did not complete
            normally. A rejected signature or untrusted IP means traffic hitting the webhook could not be
            verified as PayFast; a mismatch or handler error may mean a customer paid without their order
            being marked paid.
          </p>
        </div>
      )}

      {error && (
        <div className="card-flat border-destructive/30 p-4 text-sm text-destructive">
          Couldn't load payment events: {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="card-flat p-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <p className="font-display font-semibold">
            {filter === "attention" ? "No failed callbacks" : "No payment events yet"}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {filter === "attention"
              ? "Every callback received so far was verified and processed."
              : "Events appear here as soon as PayFast sends its first ITN."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((e) => {
            const style = OUTCOME_STYLE[e.outcome] ?? {
              cls: "bg-slate-50 text-slate-600 border-slate-200", icon: null, label: e.outcome,
            };
            const isOpen = expanded === e.id;
            return (
              <div key={e.id} className="card-flat overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : e.id)}
                  aria-expanded={isOpen}
                  className="w-full flex flex-wrap items-center gap-3 p-4 text-left hover:bg-muted/40 transition-colors"
                >
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}>
                    {style.icon}{style.label}
                  </span>
                  {e.sandbox && (
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700">
                      Sandbox
                    </span>
                  )}
                  <span className="font-mono text-xs text-muted-foreground">
                    {e.provider_payment_id ?? "no pf_payment_id"}
                  </span>
                  <span className="text-sm font-semibold">{money(e.amount_gross)}</span>
                  {e.payment_status && (
                    <span className="text-xs text-muted-foreground">{e.payment_status}</span>
                  )}
                  {e.outcome === "processed" && (
                    <span className={`text-[11px] font-semibold ${e.notified ? "text-emerald-700" : "text-amber-700"}`}>
                      {e.notified ? "Emailed" : "Not emailed"}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString("en-ZA")}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-3 text-sm">
                    {e.error_message && (
                      <p className="rounded-lg bg-destructive/[0.06] p-3 text-destructive text-[13px]">
                        {e.error_message}
                      </p>
                    )}
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-[13px]">
                      {([
                        ["Order", e.order_id ?? "—"],
                        ["Event", e.event_type],
                        ["Gross", money(e.amount_gross)],
                        ["Fee", money(e.amount_fee)],
                        ["Net", money(e.amount_net)],
                        ["Source IP", e.source_ip ?? "—"],
                        ["Signature", e.signature_valid === null ? "—" : e.signature_valid ? "Valid" : "Invalid"],
                        ["Environment", e.sandbox ? "Sandbox" : "Live"],
                      ] as const).map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-xs text-muted-foreground">{k}</dt>
                          <dd className="font-medium break-all">{String(v)}</dd>
                        </div>
                      ))}
                    </dl>
                    {e.order_id && (
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(e.order_id!)}
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <Copy className="h-3 w-3" /> Copy order id
                      </button>
                    )}
                    {e.raw_payload && (
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
                          Raw ITN payload
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-background p-3 text-[11px] leading-relaxed">
                          {JSON.stringify(e.raw_payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PaymentEventsModule;
