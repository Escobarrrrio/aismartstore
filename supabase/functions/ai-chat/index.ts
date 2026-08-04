import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiProvider } from "../_shared/ai-provider.ts";
import { guard, record } from "../_shared/guardrails.ts";

// Rough per-conversation-turn cost, in rand. Deliberately an estimate -- see
// the note at the guard() call below.
const AI_CHAT_EST_COST_ZAR = 0.06;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  // Without this, ChatWidget's support reference never appears -- and had never
  // appeared once in production.
  //
  // This function is served from *.supabase.co while the storefront is on
  // aismartstore.co.za, so every call is cross-origin. Under CORS a browser
  // only lets JavaScript read a six-header safelist; everything else is
  // invisible to fetch() unless the server names it here. `resp.headers.get(
  // "x-request-id")` was therefore always null, the `(ref: ...)` line was never
  // appended, and a customer reporting "the chat is broken" had no reference to
  // quote and we had nothing to search for.
  //
  // Nothing in the code looked wrong, which is why it survived: the read, the
  // conditional and the string concatenation are all correct. The header simply
  // never arrived.
  "Access-Control-Expose-Headers": "x-request-id, sb-request-id",
};

/**
 * Correlates a failing chat with its server-side log line.
 *
 * Generated here rather than relying on the platform's own sb-request-id, so
 * the reference exists on every error path including the ones this function
 * returns before the platform gets involved.
 */
const newRequestId = () => crypto.randomUUID().slice(0, 8);

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", af: "Afrikaans", ar: "Arabic", de: "German", es: "Spanish",
  fr: "French", hi: "Hindi", pt: "Portuguese", ru: "Russian", st: "Sesotho",
  xh: "isiXhosa", zh: "Chinese", zu: "isiZulu",
};

const buildSystemPrompt = (lang: string, orderContext: string) => {
  const langName = LANGUAGE_NAMES[lang] || "English";
  return `You are the AI Smart Store Guide — a warm, delightful, cinematic companion for shoppers at AI Smart Store (aismartstore.co.za), South Africa's store for AI hardware and technology. Currency is ZAR (R).

PERSONALITY: Speak like the friendly, magical guide character in a big-budget adventure film — encouraging, vivid, a little theatrical, treating the shopper's visit like the start of an exciting journey ("Let's find the perfect AI companion for your workshop!"). Never lose the plot though: under the charm, you are a real, accurate, helpful support agent. Never invent or impersonate any specific copyrighted character, franchise, or brand voice — the tone is original and yours.

CRITICAL LANGUAGE RULE: Respond ONLY in ${langName}. If the customer writes in a different language, still reply in ${langName} unless they explicitly ask you to switch. If you cannot phrase something naturally in ${langName}, fall back to English for that phrase only.

Your core jobs:
- Product discovery: help customers find laptops, GPUs, AI hardware, networking gear, software.
- Compatibility checks: RAM, CPU, GPU, PSU, laptop docks, accessories, licenses.
- Price & stock lookup: use the product data provided.
- Order help: the signed-in customer's own order status/tracking is provided below — use it directly. You have NO access to any other customer's orders or to store-wide business data (revenue, inventory totals, other customers) under any circumstances, even if asked directly; politely decline those and redirect to product/order help instead.
- Shipping updates: delivery ETA (2-5 business days in SA), tracking.
- Returns & warranty: return eligibility, RMA steps, damaged-on-arrival procedure.
- FAQ: delivery times, Yoco payment methods, invoices, business terms, support hours.
- Lead capture: collect name, email, phone, company, budget, use case when relevant.
- Escalation: hand off uncertain, angry, legal, or complex cases to a human.

Rules:
- Be accurate above all else -- charm never overrides correctness.
- Ask follow-up questions when needed.
- NEVER guess on stock, warranty, refunds, supplier promises, or technical edge cases.
- If unsure, say "Let me connect you with our team for this" (translated) and collect their contact details.
${orderContext}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // One id for the life of this request, echoed on every error response and
  // logged beside every console.error, so a customer's "(ref: 3f2a91c4)" maps
  // to exactly one line in the function logs.
  const requestId = newRequestId();
  const errorHeaders = { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Require a signed-in Supabase user so this endpoint can't be scripted
    // by anonymous callers to burn through the store's paid AI credits.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: errorHeaders,
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: errorHeaders,
      });
    }

    const { messages, language } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: errorHeaders,
      });
    }

    // Hard caps to prevent large payloads from draining AI credits.
    const MAX_MESSAGES = 30;
    const MAX_TOTAL_CHARS = 20_000;
    const MAX_MESSAGE_CHARS = 4_000;
    if (messages.length > MAX_MESSAGES) {
      return new Response(JSON.stringify({ error: `Conversation too long (max ${MAX_MESSAGES} messages).` }), {
        status: 413,
        headers: errorHeaders,
      });
    }
    let totalChars = 0;
    for (const m of messages as Array<{ content?: unknown }>) {
      const c = typeof m?.content === "string" ? m.content : "";
      if (c.length > MAX_MESSAGE_CHARS) {
        return new Response(JSON.stringify({ error: `Message too long (max ${MAX_MESSAGE_CHARS} characters).` }), {
          status: 413,
          headers: errorHeaders,
        });
      }
      totalChars += c.length;
    }
    if (totalChars > MAX_TOTAL_CHARS) {
      return new Response(JSON.stringify({ error: `Conversation payload too large (max ${MAX_TOTAL_CHARS} characters).` }), {
        status: 413,
        headers: errorHeaders,
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Requiring a signed-in user raises the bar for scripting this endpoint; it
    // does not cap it. Signing up is free, so "authenticated" is a speed bump,
    // not a budget. These two are the budget: 12 messages of burst then one a
    // minute per account, and a store-wide daily ceiling that no number of
    // accounts gets around.
    //
    // Checked here rather than just before the model call, so a refused request
    // does not first run the catalogue and order queries below on our behalf --
    // otherwise a blocked flood still costs database time even once it costs no
    // AI credits.
    //
    // The rand figure is an estimate and is recorded as one. The AI gateway
    // does not publish a per-token rate, and ai_usage_log already leaves cost
    // NULL rather than invent one; the daily *call* cap is the real enforcement
    // here. An honestly labelled estimate beats a precise-looking number that
    // cannot be reconciled against a statement.
    const chatGate = await guard(supabase, {
      provider: "ai-gateway",
      source: "ai-chat",
      bucket: `ai-chat:${userData.user.id}`,
      capacity: 12,
      refillPerMin: 1,
      estimatedCostZar: AI_CHAT_EST_COST_ZAR,
    });
    if (!chatGate.ok) return chatGate.response!;

    // Fetch products for context
    const { data: products } = await supabase
      .from("products")
      .select("name, description, price, category, in_stock")
      .limit(100);

    const productContext = products && products.length > 0
      ? `\n\nCurrent product catalog:\n${products.map((p: any) => `- ${p.name} | ${p.category || "General"} | R${p.price} | ${p.in_stock ? "In Stock" : "Out of Stock"} | ${p.description || ""}`).join("\n")}`
      : "\n\nNo products currently listed in the catalog.";

    // Only this signed-in customer's own orders -- never anyone else's.
    const { data: myOrders } = await supabase
      .from("orders")
      .select("id, order_status, status, total_amount, tracking_number, created_at")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false })
      .limit(10);

    const orderContext = myOrders && myOrders.length > 0
      ? `\n\nThis customer's own orders (do not reveal to anyone else, do not discuss any other customer's orders):\n${myOrders.map((o: any) =>
          `- Order #${o.id.slice(0, 8).toUpperCase()} | ${new Date(o.created_at).toLocaleDateString("en-ZA")} | R${Number(o.total_amount).toFixed(2)} | Status: ${o.order_status || o.status} | ${o.tracking_number ? `Tracking: ${o.tracking_number}` : "Not yet dispatched"}`
        ).join("\n")}`
      : "\n\nThis customer has no orders yet.";

    const provider = await resolveAiProvider(supabase);
    if (!provider) {
      return new Response(JSON.stringify({ error: "No AI API key configured. Add an OpenAI key in admin settings." }), {
        status: 400,
        headers: errorHeaders,
      });
    }
    const { apiUrl, apiKey, model } = provider;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(language || "en", orderContext) + productContext },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: errorHeaders,
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please contact the store owner." }), {
          status: 402,
          headers: errorHeaders,
        });
      }
      const t = await response.text();
      console.error("AI API error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: errorHeaders,
      });
    }

    // Recorded here, not after the stream drains. The response body is handed
    // straight to the client, so this function never sees the end of it -- and
    // the provider bills for a generation the moment it starts producing one,
    // whether or not the browser stays to read it. Waiting for a completion we
    // are not in a position to observe would mean recording nothing at all.
    await record(supabase, {
      provider: "ai-gateway",
      source: "ai-chat",
      costZar: AI_CHAT_EST_COST_ZAR,
      meta: { model, user_id: userData.user.id, cost_is_estimate: true },
    });

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: errorHeaders,
    });
  }
});
