// Yoco webhook receiver.
// Syncs order payment_status when Yoco confirms/refunds a checkout.
// Set YOCO_WEBHOOK_SECRET in function secrets and register the webhook URL
// (https://<project>.functions.supabase.co/yoco-webhook) in the Yoco dashboard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { captureEdgeError } from "../_shared/sentry.ts";

const MAX_SKEW_SECONDS = 300; // 5 minute replay window

// Standard Webhooks / Svix secrets are "whsec_<base64>", so the base64 body is
// the key material. Some dashboards hand out a plain string instead, and
// base64-decoding that threw, which surfaced as a 500 "Failed to decode base64"
// for EVERY signed delivery -- including real ones from Yoco. A crash here does
// not just fail a security check, it silently stops paid orders being marked
// paid. Decode when the value really is base64, otherwise use the raw bytes.
function secretToBytes(secret: string): Uint8Array {
  const body = secret.replace(/^whsec_/, "");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(body) && body.length % 4 === 0) {
    try {
      return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    } catch {
      // Looked like base64 but wasn't; fall through to raw bytes.
    }
  }
  return new TextEncoder().encode(body);
}

// Length-independent compare, so a wrong signature cannot be narrowed down by
// timing how long the rejection took.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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
  let expected: string;
  try {
    const key = await crypto.subtle.importKey(
      "raw", secretToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
    expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  } catch (e) {
    // A secret we cannot turn into a key is a configuration fault, not a
    // forged request. Name it as such so it is fixable from the logs instead
    // of hiding inside a generic 500.
    return { ok: false, reason: "malformed_secret", detail: (e as Error).message };
  }

  const ok = sigHeader
    .split(" ")
    .some((part) => timingSafeEqual(part.split(",")[1] ?? "", expected));
  return { ok, reason: ok ? "ok" : "signature_mismatch" };
}

function requestMetadata(req: Request, rawBody: string) {
  return {
    webhook_id: req.headers.get("webhook-id"),
    webhook_timestamp: req.headers.get("webhook-timestamp"),
    signature_present: Boolean(req.headers.get("webhook-signature")),
    user_agent: req.headers.get("user-agent"),
    forwarded_for: req.headers.get("x-forwarded-for"),
    body_bytes: rawBody.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const rawBody = await req.text();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const secret = Deno.env.get("YOCO_WEBHOOK_SECRET");
    if (!secret) {
      const meta = requestMetadata(req, rawBody);
      await captureEdgeError("yoco-webhook: missing secret", new Error("YOCO_WEBHOOK_SECRET not configured"), {
        level: "error",
        tags: { function: "yoco-webhook", failure: "missing_secret" },
        extra: meta,
        fingerprint: ["yoco-webhook", "missing_secret"],
      });
      await supabase.from("automation_events").insert({
        source: "yoco", event_type: "webhook.rejected", status: "failed",
        error_message: "YOCO_WEBHOOK_SECRET not configured", payload: meta,
      });
      return new Response(JSON.stringify({ error: "Webhook not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verdict = await verifyYocoSignature(rawBody, req.headers, secret);
    if (!verdict.ok) {
      const meta = requestMetadata(req, rawBody);
      await captureEdgeError(
        `yoco-webhook: signature verification failed (${verdict.reason})`,
        new Error(`signature_${verdict.reason}`),
        {
          level: "warning",
          tags: { function: "yoco-webhook", failure: verdict.reason },
          extra: meta,
          fingerprint: ["yoco-webhook", "signature", verdict.reason],
        },
      );
      await supabase.from("automation_events").insert({
        source: "yoco", event_type: "webhook.signature_failed", status: "failed",
        error_message: verdict.reason, payload: meta,
      });
      // 503, not 401, when the fault is ours: Yoco retries a 503 but treats a
      // 401 as "this endpoint is rejecting us", and a misconfigured secret
      // must not look like an attacker in the dashboards either.
      const configFault = verdict.reason === "malformed_secret";
      return new Response(
        JSON.stringify({
          error: configFault ? "Webhook misconfigured" : "Invalid signature",
          reason: verdict.reason,
        }),
        {
          status: configFault ? 503 : 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const payload = JSON.parse(rawBody);
    const event = payload?.type ?? "";
    const metadata = payload?.payload?.metadata ?? {};
    const orderId = metadata.orderId ?? metadata.order_id;

    // Always record the raw event for the diagnostics screen.
    await supabase.from("automation_events").insert({
      source: "yoco", event_type: `webhook.${event || "unknown"}`, status: "received",
      payload: { payload_id: payload?.id, orderId, amount: payload?.payload?.amount, event },
    });

    if (!orderId) {
      console.warn("[yoco-webhook] no orderId in metadata", payload?.id);
      return new Response(JSON.stringify({ received: true, note: "no orderId" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const updates: Record<string, unknown> = {};
    if (event === "payment.succeeded") {
      const { data: order } = await supabase
        .from("orders").select("total_amount").eq("id", orderId).maybeSingle();
      const expectedCents = order ? Math.round(Number(order.total_amount) * 100) : null;
      const paidCents = Number(payload?.payload?.amount ?? 0);
      if (expectedCents === null || Math.abs(paidCents - expectedCents) > 1) {
        await captureEdgeError("yoco-webhook: amount mismatch", new Error("amount_mismatch"), {
          level: "error",
          tags: { function: "yoco-webhook", failure: "amount_mismatch" },
          extra: { orderId, expectedCents, paidCents, payload_id: payload?.id },
        });
        await supabase.from("order_audit_log").insert({
          order_id: orderId, event_type: "yoco.amount_mismatch", actor_email: "yoco-webhook",
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
        order_id: orderId, event_type: `yoco.${event}`, actor_email: "yoco-webhook",
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
    await captureEdgeError("yoco-webhook: handler crashed", error, {
      level: "error",
      tags: { function: "yoco-webhook", failure: "handler_crash" },
      extra: requestMetadata(req, rawBody),
    });
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
