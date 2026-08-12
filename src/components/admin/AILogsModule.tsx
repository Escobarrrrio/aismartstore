import { MessageSquare, Search } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const AILogsModule = () => {
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);

  const loadConversations = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("ai_conversations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setConversations(data || []);
    setLoading(false);
  };

  useEffect(() => { loadConversations(); }, []);

  const filtered = conversations.filter((c) =>
    !search || c.session_id?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-5">
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by session ID..."
          className="input-premium input-premium-icon-l"
        />
      </div>

      <div className="card-flat overflow-hidden">
        <table className="w-full table-premium">
          <thead>
            <tr>
              {["Session ID", "Messages", "Status", "Date"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c: any) => {
              const msgs = Array.isArray(c.messages) ? c.messages : [];
              return (
                <tr key={c.id} className="cursor-pointer" onClick={() => setSelected(c)}>
                  <td className="font-mono text-xs">{c.session_id?.slice(0, 16)}...</td>
                  <td>{msgs.length}</td>
                  <td><span className={c.status === "active" ? "badge-success" : "badge-neutral"}>{c.status}</span></td>
                  <td className="text-muted-foreground text-xs">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="text-center py-10 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                No AI conversations recorded yet
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-foreground/50 backdrop-blur-sm" onClick={() => setSelected(null)} />
          <div className="relative bg-background rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[70vh] overflow-y-auto">
            <h3 className="font-display font-bold text-lg mb-4">Conversation Log</h3>
            <div className="space-y-3">
              {(Array.isArray(selected.messages) ? selected.messages : []).map((msg: any, i: number) => (
                <div key={i} className={`p-3 rounded-xl text-sm ${msg.role === "user" ? "bg-muted" : "bg-primary/[0.06]"}`}>
                  <span className="font-semibold text-xs uppercase tracking-wider text-muted-foreground">{msg.role}</span>
                  <p className="mt-1">{msg.content}</p>
                </div>
              ))}
              {(!Array.isArray(selected.messages) || selected.messages.length === 0) && (
                <p className="text-muted-foreground text-sm">No messages in this conversation.</p>
              )}
            </div>
            <button onClick={() => setSelected(null)} className="btn-secondary px-5 py-2.5 text-sm w-full mt-4">Close</button>
          </div>
        </div>
      )}
    </div>
  );
};

const LoadingSkeleton = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-11 bg-muted rounded-xl w-full max-w-md" />
    <div className="card-flat overflow-hidden">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border/50 last:border-none">
          <div className="flex-1 space-y-2"><div className="h-3.5 bg-muted rounded w-1/3" /></div>
        </div>
      ))}
    </div>
  </div>
);

export default AILogsModule;
