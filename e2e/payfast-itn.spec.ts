import { test, expect, request as pwRequest } from "@playwright/test";
import { createHash } from "node:crypto";

/**
 * End-to-end proof that a PayFast payment notification actually settles an order.
 *
 * This posts a **correctly signed ITN** at the deployed `payfast-webhook` exactly
 * the way PayFast does — `application/x-www-form-urlencoded`, MD5 signature over
 * the sorted non-empty fields — then reads the database back to confirm:
 *
 *   1. the order flipped to paid,
 *   2. a `payment_events` row was written with outcome `processed`,
 *   3. `notified` was set, i.e. notify-order was invoked (the customer email and
 *      the owner email carrying the customer's phone number),
 *   4. a redelivery of the same notification is recognised as a duplicate and
 *      does NOT re-notify — the exactly-once guarantee.
 *
 * Why it is written this way:
 *
 * - It runs against real infrastructure rather than mocks, because the whole
 *   point is that signature verification, RLS, the idempotency index and the
 *   function's own logic agree with each other. A mocked webhook proves nothing
 *   about any of those.
 * - It requires `PAYFAST_SANDBOX=true` on the deployed function. In live mode the
 *   webhook enforces PayFast's IP allow-list and calls PayFast's server-side
 *   validation, neither of which a test runner can satisfy — so in live mode this
 *   spec skips rather than reporting a false failure.
 * - Credentials come from the environment. Nothing is hardcoded, and the test
 *   cleans up every row it creates.
 *
 * Required env:
 *   E2E_SUPABASE_URL              https://<project>.supabase.co
 *   E2E_SUPABASE_SERVICE_ROLE_KEY service-role key (test/staging project)
 *   E2E_PAYFAST_PASSPHRASE        optional, must match PAYFAST_PASSPHRASE
 */

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "";
const PASSPHRASE = process.env.E2E_PAYFAST_PASSPHRASE ?? "";

const configured = Boolean(SUPABASE_URL && SERVICE_KEY);

/** PayFast's encoding: RFC1738 (spaces as +), uppercase percent escapes. */
function pfEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+").replace(/%[0-9a-f]{2}/g, (m) => m.toUpperCase());
}

/** Signature over sorted, non-empty fields, with the passphrase appended. */
function signParams(params: Record<string, string>, passphrase: string): string {
  const body = Object.keys(params)
    .filter((k) => k !== "signature" && params[k] !== "")
    .sort()
    .map((k) => `${k}=${pfEncode(params[k])}`)
    .join("&");
  const toHash = passphrase ? `${body}&passphrase=${pfEncode(passphrase)}` : body;
  return createHash("md5").update(toHash).digest("hex");
}

function formBody(params: Record<string, string>): string {
  return Object.keys(params).map((k) => `${k}=${pfEncode(params[k])}`).join("&");
}

test.describe("PayFast ITN settles an order end to end", () => {
  test.skip(!configured,
    "Set E2E_SUPABASE_URL and E2E_SUPABASE_SERVICE_ROLE_KEY to run the PayFast ITN e2e test.");
  // One worker: the spec creates and deletes a specific order.
  test.describe.configure({ mode: "serial" });

  let api: Awaited<ReturnType<typeof pwRequest.newContext>>;
  let orderId = "";
  const pfPaymentId = `E2E-${Date.now()}`;
  const amount = "1234.56";

  const db = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`;
  const dbHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };

  test.beforeAll(async () => {
    api = await pwRequest.newContext();

    const res = await api.post(db("orders"), {
      headers: { ...dbHeaders, Prefer: "return=representation" },
      data: {
        customer_name: "E2E Test Buyer",
        customer_email: "e2e-payfast@example.invalid",
        customer_phone: "+27000000000",
        total_amount: Number(amount),
        status: "pending",
        payment_status: "unpaid",
        province: "Gauteng",
      },
    });
    expect(res.ok(), `order insert failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    orderId = (await res.json())[0].id;
    expect(orderId).toBeTruthy();
  });

  test.afterAll(async () => {
    if (!api) return;
    if (orderId) {
      await api.delete(db(`payment_events?order_id=eq.${orderId}`), { headers: dbHeaders });
      await api.delete(db(`order_audit_log?order_id=eq.${orderId}`), { headers: dbHeaders });
      await api.delete(db(`orders?id=eq.${orderId}`), { headers: dbHeaders });
    }
    await api.dispose();
  });

  const buildItn = () => {
    const params: Record<string, string> = {
      m_payment_id: orderId,
      pf_payment_id: pfPaymentId,
      payment_status: "COMPLETE",
      item_name: `AI Smart Store Order #${orderId.slice(0, 8)}`,
      amount_gross: amount,
      amount_fee: "-25.00",
      amount_net: "1209.56",
      name_first: "E2E",
      name_last: "Test Buyer",
      email_address: "e2e-payfast@example.invalid",
      custom_str1: orderId,
    };
    params.signature = signParams(params, PASSPHRASE);
    return params;
  };

  test("a signed COMPLETE notification marks the order paid and notifies once", async () => {
    const itn = buildItn();

    const res = await api.post(`${SUPABASE_URL}/functions/v1/payfast-webhook`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: formBody(itn),
    });

    // 403 means the deployed function is in LIVE mode and enforcing PayFast's IP
    // allow-list, which a CI runner can never be inside.
    test.skip(res.status() === 403,
      "payfast-webhook is in live mode (IP allow-list enforced). Set PAYFAST_SANDBOX=true to run this test.");
    expect(res.status(), `webhook rejected the signed ITN: ${await res.text()}`).toBe(200);

    // 1. The order settled.
    const orderRes = await api.get(db(`orders?id=eq.${orderId}&select=status,payment_status,payment_id`), { headers: dbHeaders });
    const [order] = await orderRes.json();
    expect(order.payment_status).toBe("paid");
    expect(order.status).toBe("paid");
    expect(order.payment_id).toBe(pfPaymentId);

    // 2 & 3. Audited as processed, and the notification fired.
    const evRes = await api.get(
      db(`payment_events?order_id=eq.${orderId}&select=outcome,notified,amount_gross,signature_valid,sandbox&order=created_at.asc`),
      { headers: dbHeaders },
    );
    const events = await evRes.json();
    const processed = events.filter((e: { outcome: string }) => e.outcome === "processed");
    expect(processed, "expected exactly one processed payment_event").toHaveLength(1);
    expect(processed[0].signature_valid).toBe(true);
    expect(Number(processed[0].amount_gross)).toBeCloseTo(Number(amount), 2);
    expect(processed[0].notified, "notify-order should have been invoked").toBe(true);
  });

  test("a redelivered notification is ignored and does not re-notify", async () => {
    // PayFast retries until it gets a 200, so this is normal traffic, not abuse.
    const itn = buildItn();
    const res = await api.post(`${SUPABASE_URL}/functions/v1/payfast-webhook`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: formBody(itn),
    });
    test.skip(res.status() === 403, "payfast-webhook is in live mode.");
    expect(res.status()).toBe(200);

    const evRes = await api.get(
      db(`payment_events?order_id=eq.${orderId}&select=outcome&order=created_at.asc`),
      { headers: dbHeaders },
    );
    const events = await evRes.json();
    // Still exactly one processed row -- the partial unique index held.
    expect(events.filter((e: { outcome: string }) => e.outcome === "processed")).toHaveLength(1);
    expect(events.filter((e: { outcome: string }) => e.outcome === "duplicate_ignored").length)
      .toBeGreaterThanOrEqual(1);
  });

  test("a tampered signature is rejected and the order is untouched", async () => {
    const itn = buildItn();
    // Same shape, but claim a larger amount without re-signing.
    const forged = { ...itn, amount_gross: "9999.99" };

    const res = await api.post(`${SUPABASE_URL}/functions/v1/payfast-webhook`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: formBody(forged),
    });
    test.skip(res.status() === 403, "payfast-webhook is in live mode.");
    expect(res.status(), "an unsigned amount change must not be accepted").toBe(401);

    const orderRes = await api.get(db(`orders?id=eq.${orderId}&select=total_amount`), { headers: dbHeaders });
    const [order] = await orderRes.json();
    expect(Number(order.total_amount)).toBeCloseTo(Number(amount), 2);
  });
});
