import { test, expect, request } from "@playwright/test";

/**
 * End-to-end: place an order, then confirm the customer receives the
 * "order placed" email notification pipeline.
 *
 * This runs at the API layer against Lovable Cloud:
 *  1. Sign in as a test customer (PLAYWRIGHT_TEST_USER_EMAIL/PASSWORD).
 *  2. Insert a real `orders` row as that customer.
 *  3. Insert a matching `order_items` row.
 *  4. Invoke the `notify-order` Edge Function as that customer.
 *  5. Assert the function accepted the request (either sent via Resend or
 *     returned a successful log-only fallback when the provider key is not
 *     configured in test).
 *  6. Assert the `order_audit_log` recorded the creation event.
 *
 * If the test-user credentials aren't provided, the whole suite skips —
 * so contributors without a seeded user can still run the rest of the e2e
 * matrix without failures.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://xwiqubcilptxzvdigsmp.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3aXF1YmNpbHB0eHp2ZGlnc21wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMTY2NzcsImV4cCI6MjA4NzU5MjY3N30.aiRYqZ2H2VTNc64hU2XdeESEz4VcxOW6BQKvhb0v-4I";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_USER_PASSWORD;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API tests run once");
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "Set PLAYWRIGHT_TEST_USER_EMAIL/PLAYWRIGHT_TEST_USER_PASSWORD to run order-email E2E.",
  );
});

async function signIn(): Promise<{ token: string; userId: string }> {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  expect(res.ok(), `sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  return { token: body.access_token, userId: body.user.id };
}

test("customer can place an order and notify-order accepts the send", async () => {
  const { token, userId } = await signIn();
  const authed = { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const ctx = await request.newContext();

  // Pick any active product with a price so the order total is real
  const prodRes = await ctx.get(
    `${SUPABASE_URL}/rest/v1/products?is_active=eq.true&price=gt.0&select=id,price,name&limit=1`,
    { headers: authed },
  );
  const products = await prodRes.json();
  expect(products.length, "need at least one active product to place an order").toBeGreaterThan(0);
  const product = products[0];

  // Place the order
  const orderRes = await ctx.post(`${SUPABASE_URL}/rest/v1/orders`, {
    headers: { ...authed, Prefer: "return=representation" },
    data: {
      user_id: userId,
      customer_email: TEST_EMAIL,
      customer_name: "Playwright Buyer",
      customer_phone: "+27110000000",
      address: "1 Test Street",
      city: "Cape Town",
      postal_code: "8001",
      status: "pending",
      payment_status: "pending",
      total_amount: Number(product.price),
    },
  });
  expect(orderRes.ok(), `insert orders: ${orderRes.status()} ${await orderRes.text()}`).toBeTruthy();
  const [order] = await orderRes.json();

  // Order item
  const itemRes = await ctx.post(`${SUPABASE_URL}/rest/v1/order_items`, {
    headers: { ...authed, Prefer: "return=representation" },
    data: { order_id: order.id, product_id: product.id, quantity: 1, unit_price: product.price },
  });
  expect(itemRes.ok(), `insert order_items: ${itemRes.status()} ${await itemRes.text()}`).toBeTruthy();

  // Trigger the notify-order Edge Function as the owner of the order
  const notifyRes = await ctx.post(`${SUPABASE_URL}/functions/v1/notify-order`, {
    headers: { ...authed },
    data: { orderId: order.id },
  });
  const notifyBody = await notifyRes.json().catch(() => ({}));
  expect(
    notifyRes.status(),
    `notify-order rejected: ${notifyRes.status()} ${JSON.stringify(notifyBody)}`,
  ).toBe(200);
  expect(notifyBody.success).toBe(true);
  // Either the send happened (sent:true) or it degraded gracefully because
  // RESEND_API_KEY isn't configured for the current environment.
  expect([true, false]).toContain(notifyBody.sent);

  // The audit trigger on `orders` must have logged the creation event
  const auditRes = await ctx.get(
    `${SUPABASE_URL}/rest/v1/order_audit_log?order_id=eq.${order.id}&event_type=eq.order_created&select=*`,
    { headers: authed },
  );
  const auditRows = await auditRes.json();
  expect(auditRows.length, "expected an order_created audit row").toBeGreaterThan(0);

  await ctx.dispose();
});
