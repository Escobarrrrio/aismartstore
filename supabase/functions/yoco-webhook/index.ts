// Yoco webhook receiver.
// Syncs order payment_status when Yoco confirms/refunds a checkout.
// Set YOCO_WEBHOOK_SECRET in function secrets and register the webhook URL
// (https://<project>.functions.supabase.co/yoco-webhook) in the Yoco dashboard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MAX_SKEW_SECONDS = 300; // 5 minute replay window

async function verifyYocoSignature(rawBody: string, headers: Headers, secret: string) {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !sigHeader) return { ok: false, reason: "missing_headers" };

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "timestamp_out_of_range" };
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const secretBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  const ok = sigHeader.split(" ").some((part) => part.split(",")[1] === expected);
  return { ok, reason: ok ? "ok" : "signature_mismatch" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    const secret = Deno.env.get("YOCO_WEBHOOK_SECRET");
    // Fail closed: without a configured secret, we can't authenticate the sender.
    if (!secret) {
      console.error("[yoco-webhook] YOCO_WEBHOOK_SECRET not configured -- rejecting");
      return new Response(JSON.stringify({ error: "Webhook not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const verdict = await verifyYocoSignature(rawBody, req.headers, secret);
    if (!verdict.ok) {
      console.warn("[yoco-webhook] rejected:", verdict.reason);
      return new Response(JSON.stringify({ error: "Invalid signature", reason: verdict.reason }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody);
    const event = payload?.type ?? "";
    const metadata = payload?.payload?.metadata ?? {};
    const orderId = metadata.orderId ?? metadata.order_id;

    if (!orderId) {
      console.warn("[yoco-webhook] no orderId in metadata", payload?.id);
      return new Response(JSON.stringify({ received: true, note: "no orderId" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const updates: Record<string, unknown> = {};
    if (event === "payment.succeeded") {
      // SECURITY: verify Yoco actually charged the full order total before marking paid.
      const { data: order } = await supabase
        .from("orders").select("total_amount").eq("id", orderId).maybeSingle();
      const expectedCents = order ? Math.round(Number(order.total_amount) * 100) : null;
      const paidCents = Number(payload?.payload?.amount ?? 0);
      if (expectedCents === null || Math.abs(paidCents - expectedCents) > 1) {
        console.error("[yoco-webhook] amount mismatch", { orderId, expectedCents, paidCents });
        await supabase.from("order_audit_log").insert({
          order_id: orderId,
          event_type: "yoco.amount_mismatch",
          actor_email: "yoco-webhook",
          metadata: { expectedCents, paidCents, payload_id: payload?.id },
        });
        return new Response(JSON.stringify({ error: "amount_mismatch" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      updates.payment_status = "paid";
      updates.status = "paid";
    } else if (event === "payment.failed") {
      updates.payment_status = "unpaid";
    } else if (event === "refund.succeeded") {
      updates.payment_status = "refunded";
    }

    if (Object.keys(updates).length) {
      await supabase.from("orders").update(updates).eq("id", orderId);
      await supabase.from("order_audit_log").insert({
        order_id: orderId,
        event_type: `yoco.${event}`,
        actor_email: "yoco-webhook",
        metadata: { payload_id: payload?.id, amount: payload?.payload?.amount },
      });
      if (updates.payment_status === "paid") {
        await supabase.functions.invoke("notify-order", {
          body: { orderId },
          headers: { "x-internal-secret": Deno.env.get("INTERNAL_CRON_SECRET") ?? "" },
        });
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[yoco-webhook] failure:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
