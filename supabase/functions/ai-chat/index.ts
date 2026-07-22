import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiProvider } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { messages, language } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hard caps to prevent large payloads from draining AI credits.
    const MAX_MESSAGES = 30;
    const MAX_TOTAL_CHARS = 20_000;
    const MAX_MESSAGE_CHARS = 4_000;
    if (messages.length > MAX_MESSAGES) {
      return new Response(JSON.stringify({ error: `Conversation too long (max ${MAX_MESSAGES} messages).` }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let totalChars = 0;
    for (const m of messages as Array<{ content?: unknown }>) {
      const c = typeof m?.content === "string" ? m.content : "";
      if (c.length > MAX_MESSAGE_CHARS) {
        return new Response(JSON.stringify({ error: `Message too long (max ${MAX_MESSAGE_CHARS} characters).` }), {
          status: 413,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      totalChars += c.length;
    }
    if (totalChars > MAX_TOTAL_CHARS) {
      return new Response(JSON.stringify({ error: `Conversation payload too large (max ${MAX_TOTAL_CHARS} characters).` }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);


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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please contact the store owner." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI API error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("Chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
