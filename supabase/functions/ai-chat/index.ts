import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  af: "Afrikaans",
  xh: "isiXhosa",
  zu: "isiZulu",
  st: "Sesotho",
};

const buildSystemPrompt = (lang: string) => {
  const langName = LANGUAGE_NAMES[lang] || "English";
  return `You are the AI Smart Store assistant — a trained sales and support agent for a South African tech & AI products store (store.aijobchommie.co.za). Currency is ZAR (R).

CRITICAL LANGUAGE RULE: Respond ONLY in ${langName}. If the customer writes in a different language, still reply in ${langName} unless they explicitly ask you to switch. If you cannot phrase something naturally in ${langName}, fall back to English for that phrase only.

Your core jobs:
- Product discovery: help customers find laptops, GPUs, AI hardware, networking gear, software.
- Compatibility checks: RAM, CPU, GPU, PSU, laptop docks, accessories, licenses.
- Price & stock lookup: use the product data provided.
- Order help: cart questions, checkout guidance, payment confirmation, order status.
- Shipping updates: delivery ETA (2-5 business days in SA), tracking.
- Returns & warranty: return eligibility, RMA steps, damaged-on-arrival procedure.
- FAQ: delivery times, Yoco payment methods, invoices, business terms, support hours.
- Lead capture: collect name, email, phone, company, budget, use case when relevant.
- Escalation: hand off uncertain, angry, legal, or complex cases to a human.

Rules:
- Be professional, brief, accurate.
- Ask follow-up questions when needed.
- NEVER guess on stock, warranty, refunds, supplier promises, or technical edge cases.
- If unsure, say "Let me connect you with our team for this" (translated) and collect their contact details.`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { messages, language } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch products for context
    const { data: products } = await supabase
      .from("products")
      .select("name, description, price, category, in_stock")
      .limit(100);

    const productContext = products && products.length > 0
      ? `\n\nCurrent product catalog:\n${products.map((p: any) => `- ${p.name} | ${p.category || "General"} | R${p.price} | ${p.in_stock ? "In Stock" : "Out of Stock"} | ${p.description || ""}`).join("\n")}`
      : "\n\nNo products currently listed in the catalog.";

    // Check for OpenAI key in store settings
    const { data: openaiSetting } = await supabase
      .from("store_settings")
      .select("value")
      .eq("key", "openai_api_key")
      .maybeSingle();

    const openaiKey = openaiSetting?.value;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    let apiUrl: string;
    let apiKey: string;
    let model: string;

    if (openaiKey) {
      apiUrl = "https://api.openai.com/v1/chat/completions";
      apiKey = openaiKey;
      model = "gpt-4o-mini";
    } else if (lovableKey) {
      apiUrl = "https://ai.gateway.lovable.dev/v1/chat/completions";
      apiKey = lovableKey;
      model = "google/gemini-3-flash-preview";
    } else {
      return new Response(JSON.stringify({ error: "No AI API key configured. Add an OpenAI key in admin settings." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(language || "en") + productContext },
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
