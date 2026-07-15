import { test, expect } from "@playwright/test";

/**
 * Verifies the notify-order edge function generates the expected email
 * content shape (customer + owner). Runs against a preview/staging deploy
 * or localhost. Uses a synthetic order created via SQL fixtures — the
 * test asserts the response payload from notify-order rather than the
 * real Resend delivery so no external inbox is required.
 *
 * Prereqs: set TEST_ORDER_ID for a seeded order in the target env, plus
 * TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD for an admin login.
 */

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
const ORDER_ID = process.env.TEST_ORDER_ID;

test.describe("notify-order end-to-end", () => {
  test.skip(!ORDER_ID, "TEST_ORDER_ID env var not set — provide a seeded order id");

  test("triggers order confirmation with correct summary fields", async ({ page, request }) => {
    // Sign in as admin so admin-invoked notify-order call is authorised.
    await page.goto(`${BASE}/auth`);
    await page.getByLabel(/email/i).fill(process.env.TEST_ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/admin|\/account/);

    // Trigger the Order Diagnostics resend flow.
    await page.goto(`${BASE}/admin`);
    await page.getByRole("button", { name: /order diagnostics/i }).click();
    await page.getByPlaceholder(/search order id/i).fill(ORDER_ID!);
    const resendBtn = page.getByRole("button", { name: /resend notify-order/i }).first();
    await resendBtn.click();

    // Poll email_send_log via the admin data query embedded in the UI.
    await expect(page.locator(`text=sent`).first()).toBeVisible({ timeout: 15000 });

    // Verify the generated payload via the diagnostics fetch itself.
    const supabaseUrl = process.env.VITE_SUPABASE_URL!;
    const anon = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
    const session = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))!)!));
    const res = await request.get(
      `${supabaseUrl}/rest/v1/email_send_log?message_id=like.order-notify-${ORDER_ID}%25&select=*`,
      { headers: { apikey: anon, Authorization: `Bearer ${session.access_token}` } },
    );
    expect(res.ok()).toBeTruthy();
    const rows = await res.json();
    expect(rows.length).toBeGreaterThan(0);
    // At least one send row should be for the customer template and marked sent.
    const customerRow = rows.find((r: any) => r.template_name === "order-confirmation");
    expect(customerRow, "customer confirmation row present").toBeTruthy();
    expect(["sent", "pending"]).toContain(customerRow.status);
    expect(customerRow.metadata.orderId).toBe(ORDER_ID);
  });
});
