import { test, expect, type Page } from "@playwright/test";

/**
 * E2E coverage for the in-store ChatWidget.
 *
 * The ai-chat edge function response is stubbed via page.route() so both
 * the anonymous fallback branch and the signed-in streaming branch run
 * deterministically in CI, without spending AI credits.
 *
 * Signed-in state is faked by seeding the supabase-js localStorage key
 * with a session whose expires_at is well in the future — supabase.auth
 * .getSession() then returns the session synchronously without hitting
 * the network to refresh.
 */

const AI_CHAT_GLOB = "**/functions/v1/ai-chat";
const PROJECT_REF = "xwiqubcilptxzvdigsmp";
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

async function seedSession(page: Page, accessToken: string | null) {
  await page.addInitScript(
    ({ key, token }) => {
      try {
        if (token === null) {
          window.localStorage.removeItem(key);
          return;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const session = {
          access_token: token,
          token_type: "bearer",
          expires_in: 3600,
          expires_at: nowSec + 3600,
          refresh_token: "test-refresh",
          user: {
            id: "00000000-0000-0000-0000-000000000001",
            aud: "authenticated",
            email: "test@example.com",
          },
        };
        window.localStorage.setItem(key, JSON.stringify(session));
      } catch {
        // ignore
      }
    },
    { key: STORAGE_KEY, token: accessToken }
  );
}

async function openWidget(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /open customer support chat/i }).click();
  await expect(page.getByText(/Smart Store AI/i)).toBeVisible();
}

async function send(page: Page, text: string) {
  const input = page.getByPlaceholder(/ask me anything/i);
  await input.fill(text);
  await input.press("Enter");
}

test.describe("ChatWidget – anonymous user", () => {
  test("shows sign-in fallback and never calls ai-chat", async ({ page }) => {
    await seedSession(page, null);

    let aiCalled = false;
    await page.route(AI_CHAT_GLOB, async (route) => {
      aiCalled = true;
      await route.fulfill({ status: 200, body: "" });
    });

    await openWidget(page);
    await send(page, "Hi there");

    await expect(
      page.getByText(/sign in to chat with our AI assistant/i)
    ).toBeVisible({ timeout: 5000 });
    expect(aiCalled).toBe(false);
  });
});

test.describe("ChatWidget – signed-in user", () => {
  test("streams assistant reply and forwards bearer token", async ({ page }) => {
    await seedSession(page, "test-access-token");

    let authHeader: string | null = null;
    await page.route(AI_CHAT_GLOB, async (route) => {
      authHeader = route.request().headers()["authorization"] ?? null;
      const sse =
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [{ delta: { content: "there!" } }] })}\n\n` +
        `data: [DONE]\n\n`;
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req-test-123",
        },
        body: sse,
      });
    });

    await openWidget(page);
    await send(page, "Ping");

    await expect(page.getByText(/Hello there!/)).toBeVisible({ timeout: 8000 });
    expect(authHeader).toBe("Bearer test-access-token");
  });

  test("shows session-expired fallback on 401 with request-id", async ({ page }) => {
    await seedSession(page, "expired-token");
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
    await seedSession(page, "good-token");
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
    await seedSession(page, "good-token");
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
    await seedSession(page, "good-token");
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

  test("shows network-failure fallback when ai-chat is unreachable", async ({ page }) => {
    await seedSession(page, "good-token");
    await page.route(AI_CHAT_GLOB, (route) => route.abort("failed"));

    await openWidget(page);
    await send(page, "Hey");
    await expect(page.getByText(/couldn't reach our AI service/i)).toBeVisible({ timeout: 5000 });
  });
});
