import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, MessageSquare, Send, Clock, CheckCircle, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SupportModuleProps {
  tickets: any[];
  session: any;
  onReload: () => void;
}

const statusIcon = (status: string) => {
  if (status === "open") return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
  if (status === "pending") return <Clock className="h-3.5 w-3.5 text-blue-500" />;
  return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
};

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    open: "bg-amber-50 text-amber-700 border-amber-200",
    pending: "bg-blue-50 text-blue-700 border-blue-200",
    resolved: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return map[status] || "bg-muted text-muted-foreground border-border";
};

const typeBadge = (type: string) => {
  const map: Record<string, string> = {
    return: "bg-purple-50 text-purple-700",
    refund: "bg-red-50 text-red-700",
    inquiry: "bg-blue-50 text-blue-700",
  };
  return map[type] || "bg-muted text-muted-foreground";
};

const SupportModule = ({ tickets, session, onReload }: SupportModuleProps) => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const filtered = tickets.filter((t) => {
    if (!search) return true;
    return t.subject?.toLowerCase().includes(search.toLowerCase()) || t.id.includes(search);
  });

  const updateTicketStatus = async (id: string, status: string) => {
    await supabase.from("support_tickets").update({ status: status as any }).eq("id", id);
    onReload();
    toast({ title: `Ticket marked as ${status}` });
  };

  const sendReply = async () => {
    if (!reply.trim() || !selectedTicket) return;
    setSending(true);
    await supabase.from("ticket_messages").insert({
      ticket_id: selectedTicket.id,
      sender_id: session.user.id,
      message: reply,
      is_admin: true,
    });
    setReply("");
    setSending(false);
    onReload();
    toast({ title: "Reply sent" });
  };

  return (
    <div className="flex gap-4 h-[calc(100vh-160px)] min-h-[400px]">
      {/* Ticket list */}
      <div className="w-full md:w-[340px] shrink-0 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets..." className="w-full pl-8 pr-3 py-1.5 rounded-md border border-input bg-muted text-xs focus:border-primary outline-none" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-border/50">
          {filtered.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">No tickets.</p>
          ) : (
            filtered.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTicket(t)}
                className={`w-full text-left px-4 py-3 hover:bg-muted/30 transition-colors ${selectedTicket?.id === t.id ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {statusIcon(t.status)}
                  <span className="text-xs font-semibold truncate flex-1">{t.subject || `Ticket #${t.id.slice(0, 8)}`}</span>
                  <span className={`text-[9px] font-display font-bold px-1.5 py-0.5 rounded ${typeBadge(t.type)}`}>{t.type}</span>
                </div>
                <p className="text-[10px] text-muted-foreground">{new Date(t.created_at).toLocaleDateString()} · {t.ticket_messages?.length || 0} messages</p>
              </button>
            ))
          )}
        </div>
        <div className="px-3 py-2 bg-muted/30 border-t border-border text-[10px] text-muted-foreground">
          {filtered.length} tickets
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden hidden md:flex">
        {selectedTicket ? (
          <>
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-sm">{selectedTicket.subject || `Ticket #${selectedTicket.id.slice(0, 8)}`}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${statusBadge(selectedTicket.status)}`}>{selectedTicket.status}</span>
                  <span className={`text-[10px] font-display font-bold px-1.5 py-0.5 rounded ${typeBadge(selectedTicket.type)}`}>{selectedTicket.type}</span>
                </div>
              </div>
              <div className="flex gap-1.5">
                {["open", "pending", "resolved"].map((s) => (
                  <button
                    key={s}
                    onClick={() => updateTicketStatus(selectedTicket.id, s)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-display font-bold transition-colors ${selectedTicket.status === s ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {(selectedTicket.ticket_messages || [])
                .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                .map((msg: any) => (
                  <div key={msg.id} className={`flex ${msg.is_admin ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-xl px-4 py-2.5 ${msg.is_admin ? "bg-primary text-white" : "bg-muted"}`}>
                      <p className="text-sm">{msg.message}</p>
                      <p className={`text-[10px] mt-1 ${msg.is_admin ? "text-white/60" : "text-muted-foreground"}`}>
                        {new Date(msg.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              {(!selectedTicket.ticket_messages || selectedTicket.ticket_messages.length === 0) && (
                <p className="text-center text-sm text-muted-foreground py-8">No messages yet.</p>
              )}
            </div>

            {/* Reply */}
            <div className="px-4 py-3 border-t border-border flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Type your reply..."
                onKeyDown={(e) => e.key === "Enter" && sendReply()}
                className="flex-1 px-3 py-2 rounded-lg border border-input bg-muted text-sm focus:border-primary outline-none"
              />
              <button onClick={sendReply} disabled={sending || !reply.trim()} className="px-4 py-2 rounded-lg gradient-brand text-white text-sm font-display font-semibold disabled:opacity-50 flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" /> Send
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Select a ticket to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SupportModule;
