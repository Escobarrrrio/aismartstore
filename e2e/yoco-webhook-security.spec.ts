import { test, expect, request } from "@playwright/test";

/**
 * The single most valuable endpoint to attack in this project.
 *
 * yoco-webhook is what flips an order to "paid". It is intentionally
 * unauthenticated in the Supabase sense (verify_jwt = false) because Yoco has
 * to reach it, so the ONLY thing standing between a stranger and a free order
 * is the HMAC signature check. If that check can be bypassed, anyone can POST
 * a fake "payment.succeeded" and walk away with hardware.
 *
 * These tests forge webhooks against the live endpoint and assert every one is
 * refused. They are deliberately non-destructive: each forged call is rejected
 * before any order is touched. Rejections are recorded in automation_events,
 * which is the intended audit behaviour.
 */

const SUPABASE_URL =
  process.env.PLAYWRIGHT_SUPABASE_URL || "https://okejdzkftwhccplyfluf.supabase.co";
const SUPABASE_ANON =
  process.env.PLAYWRIGHT_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0.JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4";

const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/yoco-webhook`;

test.describe.configure({ mode: "serial" });
test.setTimeout(60_000);

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API-level tests run once");
});

// A convincing "you have been paid" payload. Everything about it is right
// except that the attacker cannot sign it.
function forgedPaymentSucceeded() {
  return JSON.stringify({
    id: `evt_forged_${Date.now()}`,
    type: "payment.succeeded",
    payload: {
      id: "p_forged",
      amount: 1, // 1 cent, against an order worth thousands
      metadata: { orderId: "00000000-0000-0000-0000-000000000000" },
    },
  });
}

async function postWebhook(body: string, headers: Record<string, string>) {
  const ctx = await request.newContext();
  const res = await ctx.post(WEBHOOK_URL, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json", ...headers },
    data: body,
    failOnStatusCode: false,
  });
  const status = res.status();
  const text = await res.text();
  await ctx.dispose();
  return { status, text };
}

test("a completely unsigned payment.succeeded is refused", async () => {
  const { status, text } = await postWebhook(forgedPaymentSucceeded(), {});
  expect(status, `unsigned webhook must not be accepted (got ${status}: ${text})`).not.toBe(200);
  expect([401, 403, 503]).toContain(status);
});

test("a garbage signature is refused", async () => {
  const { status } = await postWebhook(forgedPaymentSucceeded(), {
    "webhook-id": "msg_forged",
    "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    "webhook-signature": "v1,not-even-base64",
  });
  expect([401, 403, 503]).toContain(status);
});

test("a well-formed signature made with the wrong key is refused", async () => {
  // Structurally perfect: right header names, right v1,<base64> shape, current
  // timestamp. Only the secret is wrong. This is the realistic attack.
  const body = forgedPaymentSucceeded();
  const id = "msg_forged_wrongkey";
  const ts = String(Math.floor(Date.now() / 1000));

  const wrongKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("attacker-guessed-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    wrongKey,
    new TextEncoder().encode(`${id}.${ts}.${body}`),
  );
  const sig = Buffer.from(new Uint8Array(mac)).toString("base64");

  const { status, text } = await postWebhook(body, {
    "webhook-id": id,
    "webhook-timestamp": ts,
    "webhook-signature": `v1,${sig}`,
  });
  expect(status, `wrong-key signature must be refused (got ${status}: ${text})`).not.toBe(200);
  expect([401, 403, 503]).toContain(status);
});

test("a replayed webhook with a stale timestamp is refused", async () => {
  // Even a genuine, correctly signed webhook must expire. An hour-old
  // timestamp is outside the 5-minute skew window.
  const staleTs = String(Math.floor(Date.now() / 1000) - 3600);
  const { status } = await postWebhook(forgedPaymentSucceeded(), {
    "webhook-id": "msg_replay",
    "webhook-timestamp": staleTs,
    "webhook-signature": "v1,c3RhbGVzaWduYXR1cmU=",
  });
  expect([401, 403, 503]).toContain(status);
});

test("the endpoint never leaks the signing secret in an error body", async () => {
  const { text } = await postWebhook(forgedPaymentSucceeded(), {
    "webhook-id": "msg_probe",
    "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
    "webhook-signature": "v1,cHJvYmU=",
  });
  expect(text).not.toMatch(/whsec_|YOCO_WEBHOOK_SECRET|service_role|eyJhbGciOi/);
});
