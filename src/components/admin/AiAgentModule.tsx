import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bot, Send, User, Loader2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How are we doing today?",
  "What's low on stock right now?",
  "Show me recent account activity",
  "Draft a reply to a customer asking about a delayed order",
];

const AiAgentModule = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const history = messages;
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke("admin-ai-agent", {
        body: { message: trimmed, history },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (e: any) {
      setError(e.message || "Something went wrong talking to the AI agent.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card-flat p-5">
        <h3 className="font-display font-bold text-sm flex items-center gap-2 mb-1">
          <Bot className="h-4 w-4 text-primary" /> AI Agent
        </h3>
        <p className="text-xs text-muted-foreground">
          Ask about today's orders, revenue, and stock, or ask it to draft a reply/description/pricing suggestion.
          It reports and drafts only — it can't charge, refund, email, or change order status for you; use the
          relevant admin section for that.
        </p>
      </div>

      <div className="card-flat overflow-hidden flex flex-col h-[520px]">
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <Bot className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Ask a question or try one of these:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border bg-muted/50 hover:bg-muted transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${m.role === "user" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {m.role === "user" ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                </div>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.content}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
            </div>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="border-t border-border p-3 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(input); }}
            placeholder="Ask the AI agent..."
            className="flex-1 px-3 py-2 rounded-lg border border-input bg-card text-sm focus:border-primary outline-none"
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="p-2.5 rounded-lg gradient-brand text-white disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiAgentModule;
