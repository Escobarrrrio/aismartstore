import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

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
const PROJECT_REF = "okejdzkftwhccplyfluf";
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

/**
 * Locale forced via the same localStorage key i18next-browser-languagedetector
 * reads (see src/lib/i18n.ts detection.lookupLocalStorage), set before the
 * app boots so the very first render picks it up -- same pattern as
 * seedSession() above.
 */
async function setLanguage(page: Page, code: string) {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: "ai-smart-store.lang", value: code }
  );
}

test.describe("ChatWidget – accessibility", () => {
  test("launcher button and panel have no axe violations, anonymous user", async ({ page }) => {
    await seedSession(page, null);
    await openWidget(page);

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"][aria-label="Smart Store AI"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("panel has no axe violations after an error fallback is shown, signed-in user", async ({ page }) => {
    await seedSession(page, "good-token");
    await page.route(AI_CHAT_GLOB, (route) =>
      route.fulfill({ status: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "boom" }) })
    );
    await openWidget(page);
    await send(page, "Hey");
    await expect(page.getByText(/hit a snag/i)).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"][aria-label="Smart Store AI"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
  });

  test("chat input, send button, and close button expose accessible names", async ({ page }) => {
    await seedSession(page, null);
    await openWidget(page);

    await expect(page.getByRole("textbox", { name: /chat message/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /send message/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /close chat/i })).toBeVisible();
  });

  test("messages region is a live region so replies are announced to screen readers", async ({ page }) => {
    await seedSession(page, null);
    await openWidget(page);

    const log = page.getByRole("log");
    await expect(log).toBeVisible();
    await expect(log).toHaveAttribute("aria-live", "polite");
  });

  test("launcher is keyboard-reachable, opening moves focus to the input, Escape closes and returns focus", async ({ page }) => {
    await seedSession(page, null);
    await page.goto("/");

    const launcher = page.getByRole("button", { name: /open customer support chat/i });
    await launcher.focus();
    await expect(launcher).toBeFocused();
    await page.keyboard.press("Enter");

    const input = page.getByRole("textbox", { name: /chat message/i });
    await expect(input).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /smart store ai/i })).toBeHidden();
    await expect(launcher).toBeFocused();
  });
});

test.describe("ChatWidget – fallback messages across locales", () => {
  const LOCALES = ["en", "af", "zu", "ar"]; // mix of bundled (en/af/zu) + lazy-loaded (ar)

  for (const locale of LOCALES) {
    test(`anonymous sign-in prompt renders in "${locale}" locale, not a raw i18n key`, async ({ page }) => {
      await setLanguage(page, locale);
      await seedSession(page, null);

      let aiCalled = false;
      await page.route(AI_CHAT_GLOB, async (route) => {
        aiCalled = true;
        await route.fulfill({ status: 200, body: "" });
      });

      await openWidget(page);
      await send(page, "Hi there");

      const prompt = page.getByText(/sign in to chat with our AI assistant/i);
      await expect(prompt).toBeVisible({ timeout: 5000 });
      // Guards against a missing translation key silently rendering
      // "chat.signInPrompt" literally instead of resolved text.
      await expect(page.getByText("chat.signInPrompt")).toHaveCount(0);
      expect(aiCalled).toBe(false);
    });

    test(`signed-in server-error fallback renders in "${locale}" locale, not a raw i18n key`, async ({ page }) => {
      await setLanguage(page, locale);
      await seedSession(page, "good-token");
      await page.route(AI_CHAT_GLOB, (route) =>
        route.fulfill({ status: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "boom" }) })
      );

      await openWidget(page);
      await send(page, "Hey");

      await expect(page.getByText(/hit a snag/i)).toBeVisible({ timeout: 5000 });
      await expect(page.getByText("chat.serverError")).toHaveCount(0);
    });
  }
});
