import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Download, RefreshCw, Filter, ShieldCheck, AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";

type AuditEvent = {
  id: string;
  event_type: string;
  quote_request_id: string | null;
  email: string | null;
  actor_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const EVENT_META: Record<string, { label: string; tone: string; icon: React.ReactNode }> = {
  quote_submitted: { label: "Quote submitted", tone: "bg-blue-500/10 text-blue-700", icon: <KeyRound className="h-3.5 w-3.5" /> },
  pack_unlock_success: { label: "Pack unlocked", tone: "bg-emerald-500/10 text-emerald-700", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  pack_unlock_denied: { label: "Unlock denied", tone: "bg-red-500/10 text-red-700", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
};

const csvEscape = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ComplianceAuditModule = () => {
  const { toast } = useToast();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [emailFilter, setEmailFilter] = useState("");
  const [quoteIdFilter, setQuoteIdFilter] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("compliance_access_log")
      .select("id, event_type, quote_request_id, email, actor_id, ip_address, user_agent, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (emailFilter.trim()) query = query.ilike("email", `%${emailFilter.trim()}%`);
    if (quoteIdFilter.trim()) query = query.eq("quote_request_id", quoteIdFilter.trim());
    if (eventTypeFilter !== "all") query = query.eq("event_type", eventTypeFilter);
    if (fromDate) query = query.gte("created_at", new Date(fromDate).toISOString());
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      query = query.lte("created_at", end.toISOString());
    }

    const { data, error } = await query;
    if (error) {
      toast({ title: "Could not load audit log", description: error.message, variant: "destructive" });
      setEvents([]);
    } else {
      setEvents((data || []) as AuditEvent[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const stats = useMemo(() => {
    const s = { total: events.length, unlocked: 0, denied: 0, submitted: 0 };
    events.forEach((e) => {
      if (e.event_type === "pack_unlock_success") s.unlocked += 1;
      else if (e.event_type === "pack_unlock_denied") s.denied += 1;
      else if (e.event_type === "quote_submitted") s.submitted += 1;
    });
    return s;
  }, [events]);

  const exportCsv = () => {
    if (events.length === 0) {
      toast({ title: "Nothing to export", description: "The current filter returned no events." });
      return;
    }
    const header = ["created_at", "event_type", "email", "quote_request_id", "actor_id", "ip_address", "user_agent", "metadata"];
    const rows = events.map((e) => [
      e.created_at, e.event_type, e.email, e.quote_request_id, e.actor_id, e.ip_address, e.user_agent, e.metadata,
    ].map(csvEscape).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export complete", description: `${events.length} events exported.` });
  };

  const resetFilters = () => {
    setEmailFilter(""); setQuoteIdFilter(""); setEventTypeFilter("all"); setFromDate(""); setToDate("");
    setTimeout(load, 0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display font-extrabold text-xl">Compliance Audit Trail</h2>
            <p className="text-xs text-muted-foreground">Every quote submission and compliance-pack unlock attempt is logged here.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button onClick={exportCsv} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg gradient-brand text-white text-xs font-semibold hover:opacity-90 transition-opacity">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Events (current view)", value: stats.total, tone: "text-foreground" },
          { label: "Quotes submitted", value: stats.submitted, tone: "text-blue-600" },
          { label: "Packs unlocked", value: stats.unlocked, tone: "text-emerald-600" },
          { label: "Unlock denials", value: stats.denied, tone: "text-red-600" },
        ].map((k) => (
          <div key={k.label} className="card-flat p-4">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">{k.label}</p>
            <p className={`font-display font-extrabold text-2xl mt-1 ${k.tone}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card-flat p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-display font-bold text-sm">Filters</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <input
            type="text" placeholder="Email contains…" value={emailFilter}
            onChange={(e) => setEmailFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-input bg-background text-sm"
          />
          <input
            type="text" placeholder="Quote request ID (uuid)" value={quoteIdFilter}
            onChange={(e) => setQuoteIdFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-input bg-background text-sm"
          />
          <select
            value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-input bg-background text-sm"
          >
            <option value="all">All event types</option>
            <option value="quote_submitted">Quote submitted</option>
            <option value="pack_unlock_success">Pack unlocked</option>
            <option value="pack_unlock_denied">Unlock denied</option>
          </select>
          <input
            type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-input bg-background text-sm"
          />
          <input
            type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="px-3 py-2 rounded-lg border border-input bg-background text-sm"
          />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button onClick={load} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity">
            Apply filters
          </button>
          <button onClick={resetFilters} className="px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors">
            Reset
          </button>
        </div>
      </div>

      {/* Events table */}
      <div className="card-flat overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Event</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Quote ID</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td colSpan={6} className="px-4 py-4"><div className="h-3 bg-muted rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : events.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground text-sm">No audit events match the current filters.</td></tr>
              ) : (
                events.map((e) => {
                  const meta = EVENT_META[e.event_type] ?? { label: e.event_type, tone: "bg-muted text-foreground", icon: null };
                  return (
                    <tr key={e.id} className="border-t border-border/50 hover:bg-muted/30 transition-colors align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${meta.tone}`}>
                          {meta.icon}{meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">{e.email || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{e.quote_request_id ? `${e.quote_request_id.slice(0, 8)}…` : "—"}</td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">{e.actor_id ? `${e.actor_id.slice(0, 8)}…` : "guest"}</td>
                      <td className="px-4 py-3">
                        {e.metadata && Object.keys(e.metadata).length > 0 ? (
                          <code className="text-[11px] text-muted-foreground break-all">{JSON.stringify(e.metadata)}</code>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && events.length === 500 && (
          <p className="px-4 py-2 text-[11px] text-muted-foreground bg-muted/30 border-t border-border">
            Showing the latest 500 events for the current filter. Narrow filters to see older records, or use CSV export.
          </p>
        )}
      </div>
    </div>
  );
};

export default ComplianceAuditModule;
