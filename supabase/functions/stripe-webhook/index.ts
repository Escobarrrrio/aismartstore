import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Verifies Stripe's webhook signature before trusting "payment succeeded"
// -- unlike a plain redirect-based success page (which anyone could
// reach by just typing the URL), this only marks an order paid when
// Stripe itself, cryptographically signed, says so. This is the
// difference between a payment flow that *looks* legitimate and one
// that actually is.

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const signature = parts["v1"];
  if (!timestamp || !signature) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected === signature;
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: setting } = await supabase
    .from("store_settings")
    .select("value")
    .eq("key", "stripe_webhook_secret")
    .maybeSingle();

  const payload = await req.text();
  const sigHeader = req.headers.get("stripe-signature");

  if (!setting?.value || !sigHeader) {
    return new Response("Webhook not configured or missing signature", { status: 400 });
  }

  const valid = await verifyStripeSignature(payload, sigHeader, setting.value);
  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(payload);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.client_reference_id;
    if (orderId) {
      await supabase.from("orders").update({ status: "paid" }).eq("id", orderId);
      await supabase.functions.invoke("notify-order", { body: { orderId } });
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
