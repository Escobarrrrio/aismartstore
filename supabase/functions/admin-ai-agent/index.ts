import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext, unauthorized, forbidden } from "../_shared/auth-guard.ts";
import { resolveAiProvider } from "../_shared/ai-provider.ts";
import { guard, record } from "../_shared/guardrails.ts";

// Stand-in cost, in rand, for a turn whose real token usage the provider did
// not return. Used only as a fallback -- see the record() call at the end.
const AGENT_EST_COST_ZAR = 0.12;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are the internal operations assistant for AI Smart Store's admin. You are talking
to the store owner/admin only -- never a customer. You've been given a live data snapshot below;
use it directly rather than guessing.

You can:
- Answer reporting questions using the snapshot (orders, revenue, low stock, recent audit activity).
- Draft (not send) replies to customers, product descriptions, or pricing suggestions when asked.

You CANNOT:
- Actually charge, refund, change order status, send emails, or modify the database.
Any time the admin asks you to DO something rather than draft/report, tell them plainly which
admin panel section performs that action (e.g. "Mark Shipped in Admin -> Orders"), since you can only
report and draft, never execute.

Be direct and concise -- this is an internal business tool, not a customer-facing chat.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await getAuthContext(req);
    if (!auth.userId) return unauthorized(corsHeaders);
    if (!auth.isAdmin) return forbidden(corsHeaders);

    const { message, history } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "message is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (message.length > 4000) {
      return new Response(JSON.stringify({ error: "Message too long (max 4000 characters)." }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const safeHistory = Array.isArray(history) ? history.slice(-20) : [];

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // The same ceiling the customer chat is held to, applied to the owner's own
    // agent. That is the point rather than an oversight: the account most able
    // to run up a bill here is the admin one, and it is also the account an
    // attacker would most like to be holding. A cap with an admin exemption
    // protects nobody from the case that actually costs money.
    //
    // The burst allowance is smaller than ai-chat's because this is one human
    // typing, not a shop full of them; 6 back-to-back questions is a generous
    // reading of a conversation and a tight one for a script.
    const agentGate = await guard(supabase, {
      provider: "lovable-ai",
      source: "admin-ai-agent",
      bucket: `admin-agent:${auth.userId}`,
      capacity: 6,
      refillPerMin: 1,
      estimatedCostZar: AGENT_EST_COST_ZAR,
    });
    if (!agentGate.ok) return agentGate.response!;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const [todayOrders, lowStock, recentAudit, activeProductCount] = await Promise.all([
      supabase.from("orders").select("total_amount, payment_status").gte("created_at", todayStart.toISOString()),
      supabase.from("products").select("name, stock_status, stock_quantity").in("stock_status", ["low_stock", "out_of_stock"]).eq("is_active", true).limit(20),
      supabase.from("order_audit_log").select("event_type, actor_email, created_at").order("created_at", { ascending: false }).limit(10),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
    ]);

    const todayOrderRows = todayOrders.data || [];
    const todayRevenue = todayOrderRows.filter((o: any) => o.payment_status === "paid").reduce((s: number, o: any) => s + Number(o.total_amount || 0), 0);

    const snapshot = `
LIVE DATA SNAPSHOT (as of ${new Date().toISOString()}):
- Orders today: ${todayOrderRows.length}, revenue today (paid only): R${todayRevenue.toFixed(2)}
- Active products: ${activeProductCount.count ?? "unknown"}
- Low/out of stock (${(lowStock.data || []).length} shown, max 20): ${(lowStock.data || []).map((p: any) => `${p.name} (${p.stock_status}, qty ${p.stock_quantity})`).join("; ") || "none"}
- Recent audit log: ${(recentAudit.data || []).map((a: any) => `${a.event_type} by ${a.actor_email || "system"} at ${new Date(a.created_at).toLocaleString("en-ZA")}`).join("; ") || "none"}
`;

    const provider = await resolveAiProvider(supabase);
    if (!provider) {
      return new Response(JSON.stringify({ error: "No AI API key configured. Add an OpenAI key in admin settings." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch(provider.apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT + snapshot },
          ...safeHistory,
          { role: "user", content: message },
        ],
      }),
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("admin-ai-agent: AI API error", response.status, t);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content ?? "No response generated.";

    const usage = data?.usage;
    // Hoisted out of the block below so the spend ledger can use the same
    // figure. Declared null rather than 0 so "we could not price this call" and
    // "this call was free" stay distinguishable downstream.
    let estimatedCostUsd: number | null = null;
    if (usage) {
      const isOpenAi = provider.apiUrl.includes("api.openai.com");
      // gpt-4o-mini published rates: $0.15 / 1M input tokens, $0.60 / 1M
      // output tokens. Left null for the AI gateway fallback -- its
      // per-token markup isn't publicly documented, so we log real tokens
      // without guessing a dollar figure we can't verify.
      estimatedCostUsd = isOpenAi
        ? (Number(usage.prompt_tokens || 0) * 0.15 + Number(usage.completion_tokens || 0) * 0.60) / 1_000_000
        : null;
      await supabase.from("ai_usage_log").insert({
        source: "admin-ai-agent",
        provider: isOpenAi ? "openai" : "ai-gateway-fallback",
        model: provider.model,
        prompt_tokens: usage.prompt_tokens ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        total_tokens: usage.total_tokens ?? null,
        estimated_cost_usd: estimatedCostUsd,
        user_id: auth.userId,
      });
    }

    // Unlike ai-chat, this call is not streamed, so the provider's own token
    // counts came back with the reply. Where those give a real dollar figure it
    // is converted and used; where they do not, the flat estimate stands in and
    // is flagged as one. The ledger is what the daily cap reads, so an
    // unrecorded call is an invisible one.
    let costZar = AGENT_EST_COST_ZAR;
    let isEstimate = true;
    if (estimatedCostUsd !== null) {
      const { data: fx } = await supabase
        .from("exchange_rates").select("rate_to_zar").eq("currency_code", "USD").maybeSingle();
      // The fallback is a deliberately high rand-per-dollar rate. If the FX
      // sync is stale the cap should bind slightly early rather than slightly
      // late -- erring towards under-spending is the cheap mistake here.
      const rate = Number(fx?.rate_to_zar) || 20;
      costZar = estimatedCostUsd * rate;
      isEstimate = false;
    }
    await record(supabase, {
      provider: "lovable-ai",
      source: "admin-ai-agent",
      costZar,
      meta: { model: provider.model, user_id: auth.userId, cost_is_estimate: isEstimate },
    });

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("admin-ai-agent error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
