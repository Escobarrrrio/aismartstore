import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext, unauthorized, forbidden } from "../_shared/auth-guard.ts";
import { computeAuthoritativeShippingFee } from "../_shared/shipping.ts";

const RECONCILE_TOLERANCE = 2; // rands -- absorbs rounding, not real drift
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logYocoEvent(
  supabase: any,
  status: "error" | "recovered",
  orderId: string,
  detail: Record<string, unknown>,
) {
  await supabase.from("automation_events").insert({
    source: "yoco",
    event_type: "checkout.create",
    status,
    error_message: status === "error" ? String(detail.error ?? "unknown") : null,
    payload: { orderId, ...detail },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await getAuthContext(req);
    if (!auth.userId) return unauthorized(corsHeaders);

    const { orderId, currency, cancelUrl, successUrl, failureUrl } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, total_amount, status, province")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.user_id !== auth.userId && !auth.isAdmin) return forbidden(corsHeaders);

    // SECURITY: never trust the client-supplied total. Recompute it from
    // real product prices and the real shipping table before charging
    // anything -- order.total_amount was written by the browser, not by us.
    const { data: orderItems } = await supabase
      .from("order_items")
      .select("quantity, products(price, name, in_stock, stock_quantity)")
      .eq("order_id", orderId);

    const items = orderItems ?? [];

    const unavailable = items.filter((i: any) => i.products?.in_stock === false);
    if (unavailable.length > 0) {
      const names = unavailable.map((i: any) => i.products?.name ?? "Unknown").join(", ");
      return new Response(JSON.stringify({
        error: `Out of stock: ${names}. Please remove these items and try again.`,
        outOfStock: true,
        items: unavailable.map((i: any) => i.products?.name),
      }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const subtotal = items.reduce(
      (sum: number, i: any) => sum + Number(i.products?.price ?? 0) * Number(i.quantity ?? 0),
      0,
    );
    const weightKg = items.reduce((sum: number, i: any) => sum + Number(i.quantity ?? 0), 0);
    const shippingFee = await computeAuthoritativeShippingFee(supabase, order.province, weightKg);
    const authoritativeTotal = Math.round((subtotal + shippingFee) * 100) / 100;

    const clientTotal = Number(order.total_amount);
    if (Math.abs(authoritativeTotal - clientTotal) > RECONCILE_TOLERANCE) {
      // Don't silently charge a different amount than what the customer
      // saw and approved on screen -- correct the stored total so the
      // next attempt is right, but stop here and tell them, rather than
      // proceeding straight to Yoco with a number they never confirmed.
      await supabase.from("orders").update({ total_amount: authoritativeTotal }).eq("id", orderId);
      await supabase.from("order_audit_log").insert({
        order_id: orderId, actor_email: "create-yoco-checkout",
        event_type: "price.reconciled",
        metadata: { clientTotal, authoritativeTotal, subtotal, shippingFee, province: order.province, weightKg },
      });
      return new Response(JSON.stringify({
        error: "Your order total changed and needs to be reviewed before payment.",
        priceChanged: true,
        previousTotal: clientTotal,
        newTotal: authoritativeTotal,
      }), {
        status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let yocoSecretKey = Deno.env.get("YOCO_SECRET_KEY") ?? "";
    if (!yocoSecretKey) {
      const { data: setting } = await supabase
        .from("store_settings").select("value").eq("key", "yoco_secret_key").maybeSingle();
      yocoSecretKey = (setting?.value as string) ?? "";
    }
    if (!yocoSecretKey) {
      await logYocoEvent(supabase, "error", orderId, { error: "secret key not configured", httpStatus: null });
      return new Response(JSON.stringify({ error: "Yoco secret key not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Retry only on transient failures (network errors, 5xx, 429) -- a 4xx
    // like 403 is a deterministic rejection (bad key/scope) that retrying
    // with the same credentials will never fix, so we fail fast on those
    // and surface the exact response instead of masking it behind retries.
    let lastError: { httpStatus: number | null; body: unknown } | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let yocoResponse: Response;
      try {
        yocoResponse = await fetch("https://payments.yoco.com/api/checkouts", {
          method: "POST",
          headers: { "Authorization": `Bearer ${yocoSecretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: Math.round(authoritativeTotal * 100),
            currency: currency || "ZAR",
            cancelUrl: cancelUrl || "",
            successUrl: successUrl || "",
            failureUrl: failureUrl || "",
            metadata: { orderId },
          }),
        });
      } catch (networkErr) {
        lastError = { httpStatus: null, body: (networkErr as Error).message };
        if (attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        break;
      }

      const yocoData = await yocoResponse.json().catch(() => ({}));

      if (yocoResponse.ok) {
        if (attempt > 1) {
          await logYocoEvent(supabase, "recovered", orderId, { attempt, httpStatus: yocoResponse.status });
        }
        await supabase.from("orders").update({ payment_id: yocoData.id }).eq("id", orderId);
        return new Response(JSON.stringify({ redirectUrl: yocoData.redirectUrl, checkoutId: yocoData.id }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      lastError = { httpStatus: yocoResponse.status, body: yocoData };
      const retryable = yocoResponse.status >= 500 || yocoResponse.status === 429;
      if (retryable && attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      break;
    }

    await logYocoEvent(supabase, "error", orderId, {
      error: `Yoco returned ${lastError?.httpStatus ?? "network error"}`,
      httpStatus: lastError?.httpStatus,
      yocoResponse: lastError?.body,
      attempts: MAX_ATTEMPTS,
    });

    return new Response(JSON.stringify({
      error: "Payment gateway error",
      yocoStatus: lastError?.httpStatus,
      orderId,
    }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
