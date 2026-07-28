import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext, unauthorized, forbidden } from "../_shared/auth-guard.ts";
import { computeAuthoritativeShippingFee } from "../_shared/shipping.ts";

const RECONCILE_TOLERANCE = 2;

const PAYFAST_LIVE_URL = "https://www.payfast.co.za/eng/process";
const PAYFAST_SANDBOX_URL = "https://sandbox.payfast.co.za/eng/process";

function generateSignature(
  params: Record<string, string>,
  passphrase?: string,
): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== "signature" && params[k] !== "")
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, "+")}`)
    .join("&");
  const toHash = passphrase ? `${sorted}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}` : sorted;
  return md5(toHash);
}

function md5(input: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  function rotl(x: number, n: number) { return (x << n) | (x >>> (32 - n)); }
  function addU32(a: number, b: number) { return ((a & 0xFFFFFFFF) + (b & 0xFFFFFFFF)) >>> 0; }

  const K = [
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391,
  ];
  const S = [
    7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21,
  ];

  const origLen = data.length;
  const bitLen = origLen * 8;
  const padded = new Uint8Array(((origLen + 8) >>> 6) * 64 + 64);
  padded.set(data);
  padded[origLen] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, (bitLen / 0x100000000) >>> 0, true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let i = 0; i < padded.length; i += 64) {
    const M = new Uint32Array(16);
    for (let j = 0; j < 16; j++) M[j] = view.getUint32(i + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let j = 0; j < 64; j++) {
      let F: number, g: number;
      if (j < 16) { F = (B & C) | (~B & D); g = j; }
      else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * j) % 16; }
      F = addU32(addU32(addU32(F >>> 0, A), K[j]), M[g]);
      A = D; D = C; C = B; B = addU32(B, rotl(F >>> 0, S[j]));
    }
    a0 = addU32(a0, A); b0 = addU32(b0, B); c0 = addU32(c0, C); d0 = addU32(d0, D);
  }

  const hex = (n: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, n, true);
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  };
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await getAuthContext(req);
    if (!auth.userId) return unauthorized(corsHeaders);

    const { orderId, cancelUrl, successUrl } = await req.json();
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
      .select("id, user_id, total_amount, status, province, customer_name, customer_email, customer_phone")
      .eq("id", orderId)
      .maybeSingle();
    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.user_id !== auth.userId && !auth.isAdmin) return forbidden(corsHeaders);

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
      await supabase.from("orders").update({ total_amount: authoritativeTotal }).eq("id", orderId);
      await supabase.from("order_audit_log").insert({
        order_id: orderId, actor_email: "create-payfast-checkout",
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

    let merchantId = Deno.env.get("PAYFAST_MERCHANT_ID") ?? "";
    let merchantKey = Deno.env.get("PAYFAST_MERCHANT_KEY") ?? "";
    const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") ?? "";
    const sandbox = Deno.env.get("PAYFAST_SANDBOX") === "true";

    if (!merchantId || !merchantKey) {
      const [{ data: idSetting }, { data: keySetting }] = await Promise.all([
        supabase.from("store_settings").select("value").eq("key", "payfast_merchant_id").maybeSingle(),
        supabase.from("store_settings").select("value").eq("key", "payfast_merchant_key").maybeSingle(),
      ]);
      merchantId = (idSetting?.value as string) ?? merchantId;
      merchantKey = (keySetting?.value as string) ?? merchantKey;
    }
    if (!merchantId || !merchantKey) {
      return new Response(JSON.stringify({ error: "PayFast not configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const projectUrl = Deno.env.get("SUPABASE_URL")!;
    const notifyUrl = `${projectUrl}/functions/v1/payfast-webhook`;

    const nameParts = (order.customer_name ?? "").split(" ");
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || "";

    const pfParams: Record<string, string> = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      return_url: successUrl || "",
      cancel_url: cancelUrl || "",
      notify_url: notifyUrl,
      name_first: firstName,
      name_last: lastName,
      email_address: order.customer_email ?? "",
      cell_number: (order.customer_phone ?? "").replace(/\D/g, ""),
      amount: authoritativeTotal.toFixed(2),
      item_name: `AI Smart Store Order #${orderId.slice(0, 8)}`,
      custom_str1: orderId,
    };

    pfParams.signature = generateSignature(pfParams, passphrase || undefined);

    const actionUrl = sandbox ? PAYFAST_SANDBOX_URL : PAYFAST_LIVE_URL;

    await supabase.from("orders").update({ payment_id: `pf_${orderId.slice(0, 8)}` }).eq("id", orderId);
    await supabase.from("order_audit_log").insert({
      order_id: orderId, actor_email: "create-payfast-checkout",
      event_type: "payfast.checkout_created",
      metadata: { sandbox, amount: authoritativeTotal },
    });

    return new Response(JSON.stringify({
      actionUrl,
      formData: pfParams,
      method: "POST",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
