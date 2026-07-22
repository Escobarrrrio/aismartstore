import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext, unauthorized, forbidden } from "../_shared/auth-guard.ts";
import { resolveAiProvider } from "../_shared/ai-provider.ts";

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
