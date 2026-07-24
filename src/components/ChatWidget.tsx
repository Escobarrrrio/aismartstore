import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Bot, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { COOKIE_BANNER_HEIGHT_VAR } from "@/components/CookieConsentBanner";

// The cookie consent banner is also fixed to the bottom of the viewport
// and, unlike this widget, spans full width -- without offsetting by its
// published height, it renders on top of the launcher and swallows every
// click on it until the visitor deals with the banner.
const bottomOffsetStyle = { bottom: `calc(var(${COOKIE_BANNER_HEIGHT_VAR}, 0px) + 1.5rem)` };

interface Message {
  role: "user" | "assistant";
  content: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

const ChatWidget = () => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  // Move focus into the panel when it opens (keyboard users shouldn't have
  // to tab past the whole page to reach it), and back to the launcher
  // button when it closes so focus isn't lost.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      openButtonRef.current?.focus();
    }
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    let assistantContent = "";

    const upsertAssistant = (chunk: string) => {
      assistantContent += chunk;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantContent } : m));
        }
        return [...prev, { role: "assistant", content: assistantContent }];
      });
    };

    const logCtx = { url: CHAT_URL, ts: new Date().toISOString(), lang: i18n.language || "en" };
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        console.info("[ChatWidget] no session – prompting sign-in", logCtx);
        upsertAssistant(t("chat.signInPrompt"));
        setLoading(false);
        return;
      }

      let resp: Response;
      try {
        resp = await fetch(CHAT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ messages: newMessages, language: i18n.language || "en" }),
        });
      } catch (netErr) {
        console.error("[ChatWidget] network failure calling ai-chat", { ...logCtx, error: netErr });
        upsertAssistant(t("chat.networkError"));
        setLoading(false);
        return;
      }

      const requestId = resp.headers.get("x-request-id") || resp.headers.get("sb-request-id") || undefined;

      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        console.error("[ChatWidget] ai-chat error response", { ...logCtx, status: resp.status, requestId, body: err });
        let friendly = t("chat.genericError");
        if (resp.status === 401 || resp.status === 403) {
          friendly = t("chat.sessionExpired");
        } else if (resp.status === 402) {
          friendly = t("chat.creditsExhausted");
        } else if (resp.status === 429) {
          friendly = t("chat.rateLimited");
        } else if (resp.status === 413) {
          friendly = err.error || t("chat.conversationTooLong");
        } else if (resp.status >= 500) {
          friendly = t("chat.serverError");
        } else if (err?.error) {
          friendly = err.error;
        }
        if (requestId) friendly += `\n(ref: ${requestId})`;
        upsertAssistant(friendly);
        setLoading(false);
        return;
      }


      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }
    } catch (e) {
      console.error("[ChatWidget] unexpected error", { ...logCtx, error: e });
      upsertAssistant(t("chat.unexpectedError"));
    }

    setLoading(false);
  };

  return (
    <>
      {/* FAB */}
      {!open && (
        <button
          ref={openButtonRef}
          onClick={() => setOpen(true)}
          aria-label={t("chat.openLabel")}
          style={bottomOffsetStyle}
          className="fixed right-6 z-50 w-14 h-14 rounded-full gradient-brand text-white flex items-center justify-center shadow-elevated hover:scale-105 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 print:hidden"
        >
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("chat.title")}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          style={bottomOffsetStyle}
          className="fixed right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-4rem)] bg-card border border-border rounded-2xl shadow-elevated flex flex-col overflow-hidden print:hidden"
        >
          {/* Header */}
          <div className="gradient-brand px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2 text-white">
              <Bot className="h-5 w-5" aria-hidden="true" />
              <div>
                <p className="font-display font-bold text-sm">{t("chat.title")}</p>
                <p className="text-[10px] opacity-80">{t("chat.subtitle")}</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label={t("chat.closeLabel")}
              className="text-white/80 hover:text-white p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          {/* Messages -- aria-live so screen readers announce new assistant
              replies and error fallbacks as they arrive, not just on focus. */}
          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="flex-1 overflow-y-auto p-4 space-y-3"
          >
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Bot className="h-10 w-10 text-secondary/40 mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm text-muted-foreground font-display font-semibold">{t("chat.emptyTitle")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("chat.emptyHint")}</p>
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                  {[t("chat.suggestion1"), t("chat.suggestion2"), t("chat.suggestion3")].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); }}
                      className="text-xs bg-muted border border-border rounded-full px-3 py-1.5 text-muted-foreground hover:bg-secondary/10 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full gradient-brand flex items-center justify-center text-white flex-shrink-0 mt-1">
                    <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                )}
                <div className={`max-w-[80%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "gradient-brand text-white rounded-br-sm"
                    : "bg-muted text-foreground rounded-bl-sm"
                }`}>
                  {msg.content}
                </div>
                {msg.role === "user" && (
                  <div className="w-7 h-7 rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground flex-shrink-0 mt-1">
                    <User className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                )}
              </div>
            ))}

            {loading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex gap-2" aria-label={t("chat.title")}>
                <div className="w-7 h-7 rounded-full gradient-brand flex items-center justify-center text-white flex-shrink-0">
                  <Bot className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <div className="bg-muted rounded-xl px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-secondary/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-secondary/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-secondary/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border p-3 flex-shrink-0">
            <div className="flex gap-2">
              <label htmlFor="chat-widget-input" className="sr-only">{t("chat.inputLabel")}</label>
              <input
                id="chat-widget-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder={t("chat.inputPlaceholder")}
                aria-label={t("chat.inputLabel")}
                className="flex-1 px-3 py-2 rounded-full border border-input bg-muted text-sm outline-none focus:border-secondary transition text-foreground placeholder:text-muted-foreground"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                aria-label={t("chat.sendLabel")}
                className="w-9 h-9 rounded-full gradient-brand text-white flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-50 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ChatWidget;
