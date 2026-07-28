import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { captureEdgeError } from "../_shared/sentry.ts";

const PAYFAST_VALID_IPS = [
  "197.97.145.144", "197.97.145.145", "197.97.145.146", "197.97.145.147",
  "197.97.145.148", "197.97.145.149", "197.97.145.150", "197.97.145.151",
  "41.74.179.192", "41.74.179.193", "41.74.179.194", "41.74.179.195",
  "41.74.179.196", "41.74.179.197", "41.74.179.198", "41.74.179.199",
  "41.74.179.200", "41.74.179.201", "41.74.179.202", "41.74.179.203",
  "41.74.179.204", "41.74.179.205", "41.74.179.206", "41.74.179.207",
  "41.74.179.208", "41.74.179.209", "41.74.179.210", "41.74.179.211",
  "41.74.179.212", "41.74.179.213", "41.74.179.214", "41.74.179.215",
  "41.74.179.216", "41.74.179.217", "41.74.179.218", "41.74.179.219",
  "41.74.179.220", "41.74.179.221", "41.74.179.222", "41.74.179.223",
];

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

function verifySignature(params: Record<string, string>, passphrase?: string): boolean {
  const receivedSig = params.signature;
  if (!receivedSig) return false;
  const sorted = Object.keys(params)
    .filter((k) => k !== "signature" && params[k] !== "")
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, "+")}`)
    .join("&");
  const toHash = passphrase ? `${sorted}&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, "+")}` : sorted;
  return md5(toHash) === receivedSig;
}

async function validateWithPayFast(params: Record<string, string>, sandbox: boolean): Promise<boolean> {
  const host = sandbox ? "sandbox.payfast.co.za" : "www.payfast.co.za";
  const body = Object.keys(params)
    .filter((k) => k !== "signature")
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k]).replace(/%20/g, "+")}`)
    .join("&");
  try {
    const res = await fetch(`https://${host}/eng/query/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await res.text();
    return text.trim() === "VALID";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const sourceIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const sandbox = Deno.env.get("PAYFAST_SANDBOX") === "true";

    if (!sandbox && sourceIp && !PAYFAST_VALID_IPS.includes(sourceIp)) {
      await supabase.from("automation_events").insert({
        source: "payfast", event_type: "webhook.ip_rejected", status: "failed",
        error_message: `Untrusted IP: ${sourceIp}`,
        payload: { ip: sourceIp },
      });
      return new Response("Forbidden", { status: 403 });
    }

    const rawBody = await req.text();
    const params: Record<string, string> = {};
    for (const pair of rawBody.split("&")) {
      const [k, ...v] = pair.split("=");
      params[decodeURIComponent(k)] = decodeURIComponent(v.join("="));
    }

    await supabase.from("automation_events").insert({
      source: "payfast", event_type: `webhook.${params.payment_status ?? "unknown"}`, status: "received",
      payload: {
        pf_payment_id: params.pf_payment_id,
        payment_status: params.payment_status,
        amount_gross: params.amount_gross,
        orderId: params.custom_str1,
        item_name: params.item_name,
      },
    });

    const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") ?? "";
    if (!verifySignature(params, passphrase || undefined)) {
      await captureEdgeError("payfast-webhook: signature verification failed", new Error("signature_mismatch"), {
        level: "warning",
        tags: { function: "payfast-webhook", failure: "signature_mismatch" },
        extra: { pf_payment_id: params.pf_payment_id, orderId: params.custom_str1 },
        fingerprint: ["payfast-webhook", "signature_mismatch"],
      });
      await supabase.from("automation_events").insert({
        source: "payfast", event_type: "webhook.signature_failed", status: "failed",
        error_message: "Signature mismatch",
        payload: { pf_payment_id: params.pf_payment_id },
      });
      return new Response("Invalid signature", { status: 401 });
    }

    const valid = await validateWithPayFast(params, sandbox);
    if (!valid) {
      await supabase.from("automation_events").insert({
        source: "payfast", event_type: "webhook.validation_failed", status: "failed",
        error_message: "PayFast server validation rejected",
        payload: { pf_payment_id: params.pf_payment_id },
      });
      return new Response("Validation failed", { status: 400 });
    }

    const orderId = params.custom_str1;
    if (!orderId) {
      console.warn("[payfast-webhook] no orderId in custom_str1");
      return new Response("OK", { status: 200 });
    }

    const paymentStatus = params.payment_status;

    if (paymentStatus === "COMPLETE") {
      const { data: order } = await supabase
        .from("orders").select("total_amount").eq("id", orderId).maybeSingle();
      const expectedAmount = order ? Number(order.total_amount).toFixed(2) : null;
      const paidAmount = params.amount_gross;

      if (expectedAmount && expectedAmount !== paidAmount) {
        await captureEdgeError("payfast-webhook: amount mismatch", new Error("amount_mismatch"), {
          level: "error",
          tags: { function: "payfast-webhook", failure: "amount_mismatch" },
          extra: { orderId, expectedAmount, paidAmount, pf_payment_id: params.pf_payment_id },
        });
        await supabase.from("order_audit_log").insert({
          order_id: orderId, event_type: "payfast.amount_mismatch", actor_email: "payfast-webhook",
          metadata: { expectedAmount, paidAmount, pf_payment_id: params.pf_payment_id },
        });
        return new Response("Amount mismatch", { status: 400 });
      }

      await supabase.from("orders").update({
        payment_status: "paid",
        status: "paid",
        payment_id: params.pf_payment_id,
      }).eq("id", orderId);

      await supabase.from("order_audit_log").insert({
        order_id: orderId, event_type: "payfast.payment_complete", actor_email: "payfast-webhook",
        metadata: { pf_payment_id: params.pf_payment_id, amount_gross: paidAmount, payment_status: paymentStatus },
      });

      await supabase.functions.invoke("notify-order", {
        body: { orderId },
        headers: { "x-internal-secret": Deno.env.get("INTERNAL_CRON_SECRET") ?? "" },
      });
    } else if (paymentStatus === "FAILED" || paymentStatus === "CANCELLED") {
      await supabase.from("orders").update({ payment_status: "unpaid" }).eq("id", orderId);
      await supabase.from("order_audit_log").insert({
        order_id: orderId, event_type: `payfast.${paymentStatus.toLowerCase()}`, actor_email: "payfast-webhook",
        metadata: { pf_payment_id: params.pf_payment_id, payment_status: paymentStatus },
      });
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    await captureEdgeError("payfast-webhook: handler crashed", error, {
      level: "error",
      tags: { function: "payfast-webhook", failure: "handler_crash" },
    });
    return new Response("Internal error", { status: 500 });
  }
});
