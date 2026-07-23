import { test, expect, type Page } from "@playwright/test";

/**
 * E2E coverage for the in-store ChatWidget.
 *
 * Rather than depend on a real Supabase session + AI provider (flaky and
 * costly in CI), we stub the ai-chat edge function response via
 * page.route() and stub supabase.auth.getSession() via window-injected
 * localStorage so the anonymous vs signed-in branches are both covered
 * deterministically.
 */

const AI_CHAT_GLOB = "**/functions/v1/ai-chat";

async function openWidget(page: Page) {
  await page.goto("/");
  const fab = page.getByRole("button", { name: /open customer support chat/i });
  await fab.click();
  await expect(page.getByText(/Smart Store AI/i)).toBeVisible();
}

async function send(page: Page, text: string) {
  const input = page.getByPlaceholder(/ask me anything/i);
  await input.fill(text);
  await input.press("Enter");
}

async function stubSession(page: Page, token: string | null) {
  // Force supabase.auth.getSession() to resolve to the shape ChatWidget expects.
  await page.addInitScript((accessToken) => {
    // Wait for supabase client module to be evaluated, then monkey-patch.
    const patch = () => {
      // @ts-expect-error test-only hook
      const w = window as any;
      if (!w.__supabaseAuthPatched) {
        w.__supabaseAuthPatched = true;
        w.__stubToken = accessToken;
      }
    };
    patch();
  }, token);

  // Intercept the module by hooking into fetch is not enough — instead we
  // patch after load by injecting into the page context via a script tag.
  await page.addInitScript(() => {
    const orig = Object.getOwnPropertyDescriptor(window, "fetch");
    // Monkey-patch supabase getSession by intercepting the module later —
    // easier route: override supabase.auth via a script that runs after
    // the app boots. We use a MutationObserver hook to await client load.
    const install = () => {
      // @ts-expect-error runtime
      const s = (window as any).supabase;
      if (s?.auth?.getSession) {
        const token = (window as any).__stubToken;
        s.auth.getSession = async () => ({
          data: { session: token ? { access_token: token, user: { id: "test-user" } } : null },
          error: null,
        });
        return true;
      }
      return false;
    };
    const iv = setInterval(() => install() && clearInterval(iv), 50);
    setTimeout(() => clearInterval(iv), 10000);
    void orig;
  });
}

test.describe("ChatWidget – anonymous user", () => {
  test("shows sign-in fallback and does not call ai-chat", async ({ page }) => {
    await stubSession(page, null);

    let called = false;
    await page.route(AI_CHAT_GLOB, (route) => {
      called = true;
      return route.fulfill({ status: 200, body: "" });
    });

    await openWidget(page);
    await send(page, "Hi there");

    await expect(
      page.getByText(/sign in to chat with our AI assistant/i)
    ).toBeVisible({ timeout: 5000 });
    expect(called).toBe(false);
  });
});

test.describe("ChatWidget – signed-in user", () => {
  test("streams assistant reply from ai-chat with bearer token", async ({ page }) => {
    await stubSession(page, "test-access-token");

    let authHeader: string | null = null;
    await page.route(AI_CHAT_GLOB, async (route) => {
      authHeader = route.request().headers()["authorization"] ?? null;
      const sse =
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ delta: { content: "there!" } }] })}\n\n` +
        `data: [DONE]\n\n`;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "x-request-id": "req-test-123" },
        body: sse,
      });
    });

    await openWidget(page);
    await send(page, "Ping");

    await expect(page.getByText(/Hello there!/)).toBeVisible({ timeout: 8000 });
    expect(authHeader).toBe("Bearer test-access-token");
  });

  test("shows session-expired message on 401", async ({ page }) => {
    await stubSession(page, "expired-token");
    await page.route(AI_CHAT_GLOB, (route) =>
      route.fulfill({
        status: 401,
        headers: { "content-type": "application/json", "x-request-id": "req-401" },
        body: JSON.stringify({ error: "unauthorized" }),
      })
    );

    await openWidget(page);
    await send(page, "Hello?");
    await expect(page.getByText(/session expired/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/req-401/)).toBeVisible();
  });

  test("shows rate-limit fallback on 429", async ({ page }) => {
    await stubSession(page, "good-token");
    await page.route(AI_CHAT_GLOB, (route) =>
      route.fulfill({
        status: 429,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "rate limited" }),
      })
    );

    await openWidget(page);
    await send(page, "Hey");
    await expect(page.getByText(/lots of questions/i)).toBeVisible({ timeout: 5000 });
  });

  test("shows credits-exhausted fallback on 402", async ({ page }) => {
    await stubSession(page, "good-token");
    await page.route(AI_CHAT_GLOB, (route) =>
      route.fulfill({
        status: 402,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "credits exhausted" }),
      })
    );

    await openWidget(page);
    await send(page, "Hey");
    await expect(page.getByText(/temporarily unavailable/i)).toBeVisible({ timeout: 5000 });
  });

  test("shows server-snag fallback on 500", async ({ page }) => {
    await stubSession(page, "good-token");
    await page.route(AI_CHAT_GLOB, (route) =>
      route.fulfill({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "boom" }),
      })
    );

    await openWidget(page);
    await send(page, "Hey");
    await expect(page.getByText(/hit a snag/i)).toBeVisible({ timeout: 5000 });
  });
});
