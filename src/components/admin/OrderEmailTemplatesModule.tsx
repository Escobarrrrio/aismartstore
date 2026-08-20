import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, RefreshCw, Save, Send, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

/**
 * Order email control room.
 *
 * Left: the editable copy customers receive at each fulfilment status --
 * changing "your order is packed" is a text edit, not a deploy.
 * Right: the live send queue, including anything that failed and is waiting
 * for its next retry, so a silent delivery failure is visible instead of
 * being discovered by an angry customer a week later.
 */

interface TemplateRow {
  status: string;
  label: string;
  subject: string;
  body_html: string;
  enabled: boolean;
  updated_at: string;
}

interface QueueRow {
  id: string;
  order_id: string;
  template_status: string;
  recipient_email: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
}

const PLACEHOLDERS = [
  "customer_name",
  "order_id",
  "order_short",
  "total",
  "status",
  "tracking",
  "eta",
  "shipping_address",
  "items_table",
];

const queueTone = (status: string) =>
  status === "sent"
    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
    : status === "failed"
      ? "bg-destructive/10 text-destructive border-destructive/20"
      : "bg-amber-500/10 text-amber-600 border-amber-500/20";

const OrderEmailTemplatesModule = () => {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [active, setActive] = useState<string>("");
  const [draft, setDraft] = useState<TemplateRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [draining, setDraining] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: tpl }, { data: q }] = await Promise.all([
      supabase.from("order_email_templates" as never).select("*").order("label"),
      supabase
        .from("order_email_queue" as never)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const list = (tpl as unknown as TemplateRow[]) ?? [];
    setTemplates(list);
    setQueue((q as unknown as QueueRow[]) ?? []);
    setActive((prev) => prev || list[0]?.status || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setDraft(templates.find((t) => t.status === active) ?? null);
  }, [active, templates]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    const { error } = await supabase
      .from("order_email_templates" as never)
      .update({
        subject: draft.subject,
        body_html: draft.body_html,
        enabled: draft.enabled,
      } as never)
      .eq("status", draft.status);
    setSaving(false);
    if (error) {
      toast({ title: "Could not save template", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Saved “${draft.label}” email` });
    load();
  };

  const drainQueue = async () => {
    setDraining(true);
    const { data, error } = await supabase.functions.invoke("process-order-emails", { body: {} });
    setDraining(false);
    if (error) {
      toast({ title: "Queue run failed", description: error.message, variant: "destructive" });
      return;
    }
    const r = data as { processed?: number; sent?: number; retry?: number; failed?: number };
    toast({
      title: `Processed ${r?.processed ?? 0} queued email${r?.processed === 1 ? "" : "s"}`,
      description: `${r?.sent ?? 0} sent · ${r?.retry ?? 0} retrying · ${r?.failed ?? 0} gave up`,
    });
    load();
  };

  const pending = queue.filter((q) => q.status === "queued").length;
  const failed = queue.filter((q) => q.status === "failed").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-2xl flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" /> Order emails
          </h2>
          <p className="text-sm text-muted-foreground">
            Edit the wording customers get at each fulfilment step, and watch the retry queue.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-border">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={drainQueue}
            disabled={draining}
            className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-60"
          >
            <Send className="h-4 w-4" /> {draining ? "Sending…" : "Run queue now"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card-flat p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Waiting to send</p>
          <p className="font-display font-extrabold text-2xl flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-500" /> {pending}
          </p>
        </div>
        <div className="card-flat p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Gave up after retries</p>
          <p className="font-display font-extrabold text-2xl flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" /> {failed}
          </p>
        </div>
        <div className="card-flat p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Templates live</p>
          <p className="font-display font-extrabold text-2xl flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" /> {templates.filter((t) => t.enabled).length}/{templates.length}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="space-y-1" aria-label="Email templates">
          {templates.map((t) => (
            <button
              key={t.status}
              onClick={() => setActive(t.status)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm border ${
                active === t.status ? "bg-primary/10 border-primary/30 text-primary font-semibold" : "border-transparent hover:bg-muted"
              }`}
            >
              {t.label}
              {!t.enabled && <span className="ml-2 text-[10px] uppercase text-muted-foreground">off</span>}
            </button>
          ))}
          {loading && <p className="text-xs text-muted-foreground px-3">Loading…</p>}
        </nav>

        {draft && (
          <div className="card-flat p-5 space-y-4">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject</span>
              <input
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-card text-sm"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Message</span>
              <textarea
                value={draft.body_html}
                onChange={(e) => setDraft({ ...draft, body_html: e.target.value })}
                rows={12}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-input bg-card text-sm font-mono"
              />
            </label>

            <div className="text-xs text-muted-foreground">
              Placeholders:{" "}
              {PLACEHOLDERS.map((p) => (
                <code key={p} className="mr-2 px-1.5 py-0.5 rounded bg-muted">{`{{${p}}}`}</code>
              ))}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Send this email automatically
            </label>

            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-60"
            >
              <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save template"}
            </button>
          </div>
        )}
      </div>

      <div className="card-flat p-5">
        <h3 className="font-display font-bold mb-3">Send queue</h3>
        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing queued — every customer email has been delivered.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left py-2">Recipient</th>
                  <th className="text-left py-2">Step</th>
                  <th className="text-left py-2">State</th>
                  <th className="text-left py-2">Attempts</th>
                  <th className="text-left py-2">Last error</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((q) => (
                  <tr key={q.id} className="border-t border-border">
                    <td className="py-2">{q.recipient_email}</td>
                    <td className="py-2">{q.template_status}</td>
                    <td className="py-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${queueTone(q.status)}`}>
                        {q.status}
                      </span>
                    </td>
                    <td className="py-2">
                      {q.attempts}/{q.max_attempts}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground max-w-[280px] truncate">{q.last_error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderEmailTemplatesModule;
