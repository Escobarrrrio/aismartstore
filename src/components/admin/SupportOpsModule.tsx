import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { HeadphonesIcon, MessageSquare, AlertTriangle, CheckCircle, Clock, User, ArrowUpRight, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const SupportOpsModule = () => {
  const { toast } = useToast();
  const [tickets, setTickets] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [ticketRes, convRes] = await Promise.all([
      supabase.from("support_tickets").select("*, ticket_messages(*)").order("created_at", { ascending: false }),
      supabase.from("ai_conversations").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    setTickets(ticketRes.data || []);
    setConversations(convRes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const cannedResponses = [
    "Thank you for reaching out. We're looking into this and will get back to you shortly.",
    "Your order has been escalated to our team. We'll update you within 24 hours.",
    "We apologise for the inconvenience. A refund has been initiated.",
    "Could you please provide your order number so we can assist you better?",
  ];

  const priorityBadge = (type: string) => {
    const map: Record<string, string> = {
      return: "bg-red-500/10 text-red-600 border-red-200",
      refund: "bg-amber-500/10 text-amber-600 border-amber-200",
      inquiry: "bg-blue-500/10 text-blue-600 border-blue-200",
    };
    return map[type] || "bg-muted text-muted-foreground border-border";
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      open: "bg-amber-500/10 text-amber-600 border-amber-200",
      pending: "bg-blue-500/10 text-blue-600 border-blue-200",
      resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
    };
    return map[status] || "bg-muted text-muted-foreground border-border";
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3"><HeadphonesIcon className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{tickets.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Tickets</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center mb-3"><Clock className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{tickets.filter(t => t.status === "open").length}</p>
          <p className="text-xs text-muted-foreground mt-1">Open</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-secondary/10 text-secondary flex items-center justify-center mb-3"><MessageSquare className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{conversations.length}</p>
          <p className="text-xs text-muted-foreground mt-1">AI Conversations</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3"><CheckCircle className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{tickets.filter(t => t.status === "resolved").length}</p>
          <p className="text-xs text-muted-foreground mt-1">Resolved</p>
        </div>
      </div>

      {/* Tickets */}
      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-display font-bold text-sm">Support Tickets</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." className="pl-8 pr-3 py-1.5 rounded-lg border border-input bg-card text-xs" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead><tr className="bg-muted/50 border-b border-border">
              {["Subject", "Type", "Priority", "Status", "Messages", "Created"].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</td></tr>
              ) : tickets.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">No tickets</td></tr>
              ) : tickets.map(t => (
                <tr key={t.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSelectedTicket(t)}>
                  <td className="px-4 py-3 text-sm font-semibold">{t.subject || "No subject"}</td>
                  <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${priorityBadge(t.type)}`}>{t.type}</span></td>
                  <td className="px-4 py-3"><span className="text-xs text-muted-foreground">{t.type === "return" ? "High" : "Normal"}</span></td>
                  <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${statusBadge(t.status)}`}>{t.status}</span></td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{t.ticket_messages?.length ?? 0}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Canned Responses */}
      <div className="card-flat p-5">
        <h4 className="font-display font-bold text-sm mb-3">Canned Responses</h4>
        <div className="space-y-2">
          {cannedResponses.map((r, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground truncate mr-4">{r}</p>
              <button onClick={() => { navigator.clipboard.writeText(r); toast({ title: "Copied" }); }} className="text-xs text-primary font-semibold shrink-0">Copy</button>
            </div>
          ))}
        </div>
      </div>

      {/* AI Conversations Review */}
      <div className="card-flat overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-primary" /> Recent AI Conversations
          </h3>
        </div>
        <div className="divide-y divide-border/50">
          {conversations.length === 0 ? (
            <div className="p-5 text-sm text-muted-foreground text-center">No AI conversations yet</div>
          ) : conversations.slice(0, 10).map(c => (
            <div key={c.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-xs text-muted-foreground">Session: {c.session_id?.slice(0, 12)}...</p>
                <p className="text-[10px] text-muted-foreground">{Array.isArray(c.messages) ? c.messages.length : 0} messages</p>
              </div>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${c.status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-200" : "bg-muted text-muted-foreground border-border"}`}>{c.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SupportOpsModule;
