import { test, expect, request } from "@playwright/test";

/**
 * API contract tests for the ai-chat Edge Function.
 *
 * These hit the deployed function directly over HTTP (no browser), pinning
 * the exact status code + response body shape that ChatWidget.tsx's
 * fallback-message branches depend on (see src/components/ChatWidget.tsx
 * sendMessage()). If this function's error contract ever drifts -- a
 * renamed error key, a changed status code -- this fails here instead of
 * silently breaking the widget's fallback UI in production.
 *
 * Scope: only status/shape contracts that are deterministically forceable
 * over a live HTTP call are tested here (401, 400, 413). 402 (AI credits
 * exhausted), 403, 429 (upstream rate limit), and 5xx all depend on live
 * upstream AI-provider state (billing, rate limits, real outages) that
 * can't be forced deterministically against the real deployed function
 * without adding test-mode dependency injection to the function itself,
 * which is out of scope here. Those five codes'
 * exact fallback-message contract is covered instead by the mocked-route
 * tests in e2e/chat-widget.spec.ts, which pin the same status codes and
 * response shapes at the point ChatWidget actually consumes them.
 */

const SUPABASE_URL = process.env.PLAYWRIGHT_SUPABASE_URL
  || "https://okejdzkftwhccplyfluf.supabase.co";
const SUPABASE_ANON = process.env.PLAYWRIGHT_SUPABASE_ANON_KEY
  || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rZWpkemtmdHdoY2NwbHlmbHVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5NDU0MjAsImV4cCI6MjEwMTUyMTQyMH0.JHSxZe_hSQtAH7nABmlRQlV2QlNJDYmOYbkcGnpKbj4";

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_USER_EMAIL;
const TEST_PASSWORD = process.env.PLAYWRIGHT_TEST_USER_PASSWORD;

const FN_URL = `${SUPABASE_URL}/functions/v1/ai-chat`;

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "desktop-chromium", "API contract tests run once");
});

async function signIn(): Promise<string> {
  const ctx = await request.newContext();
  const res = await ctx.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON, "Content-Type": "application/json" },
    data: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  expect(res.ok(), `sign-in failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = await res.json();
  await ctx.dispose();
  return body.access_token;
}

test.describe("ai-chat contract – no auth required", () => {
  test("missing Authorization header -> 401 { error: \"Authentication required\" }", async ({ request: rq }) => {
    const res = await rq.post(FN_URL, {
      headers: { "Content-Type": "application/json" },
      data: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Authentication required" });
  });

  test("malformed bearer token -> 401 { error: \"Authentication required\" }", async ({ request: rq }) => {
    const res = await rq.post(FN_URL, {
      headers: { "Content-Type": "application/json", Authorization: "Bearer not-a-real-jwt" },
      data: { messages: [{ role: "user", content: "hi" }] },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Authentication required" });
  });
});

test.describe("ai-chat contract – requires a real signed-in user", () => {
  test.beforeEach(() => {
    test.skip(
      !TEST_EMAIL || !TEST_PASSWORD,
      "Set PLAYWRIGHT_TEST_USER_EMAIL/PLAYWRIGHT_TEST_USER_PASSWORD to run authed ai-chat contract tests.",
    );
  });

  test("missing messages field -> 400 { error: \"messages array required\" }", async ({ request: rq }) => {
    const token = await signIn();
    const res = await rq.post(FN_URL, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "messages array required" });
  });

  test("messages is not an array -> 400 { error: \"messages array required\" }", async ({ request: rq }) => {
    const token = await signIn();
    const res = await rq.post(FN_URL, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      data: { messages: "not an array" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "messages array required" });
  });

  test("more than 30 messages -> 413 with the exact too-long-conversation message", async ({ request: rq }) => {
    const token = await signIn();
    const messages = Array.from({ length: 31 }, (_, i) => ({ role: "user", content: `msg ${i}` }));
    const res = await rq.post(FN_URL, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      data: { messages },
    });
    expect(res.status()).toBe(413);
    const body = await res.json();
    expect(body).toEqual({ error: "Conversation too long (max 30 messages)." });
  });

  test("a single message over 4000 characters -> 413 with the exact too-long-message error", async ({ request: rq }) => {
    const token = await signIn();
    const res = await rq.post(FN_URL, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      data: { messages: [{ role: "user", content: "x".repeat(4001) }] },
    });
    expect(res.status()).toBe(413);
    const body = await res.json();
    expect(body).toEqual({ error: "Message too long (max 4000 characters)." });
  });

  test("total conversation over 20000 characters -> 413 with the exact payload-too-large error", async ({ request: rq }) => {
    const token = await signIn();
    // 6 messages of 3500 chars each = 21000 total, each individually under
    // the 4000-char single-message cap so this exercises the total-chars
    // branch specifically, not the single-message branch above.
    const messages = Array.from({ length: 6 }, () => ({ role: "user", content: "x".repeat(3500) }));
    const res = await rq.post(FN_URL, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      data: { messages },
    });
    expect(res.status()).toBe(413);
    const body = await res.json();
    expect(body).toEqual({ error: "Conversation payload too large (max 20000 characters)." });
  });

  test("minimal valid request succeeds with a streaming response", async ({ request: rq }) => {
    const token = await signIn();
    const res = await rq.post(FN_URL, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      data: { messages: [{ role: "user", content: "hi" }], language: "en" },
    });
    expect(res.status(), `ai-chat rejected a minimal valid request: ${await res.text()}`).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/event-stream");
  });
});
