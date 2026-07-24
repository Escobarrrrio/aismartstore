import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withRetry } from "./retry.ts";

Deno.test("withRetry resolves immediately when the function succeeds on the first try", async () => {
  let calls = 0;
  const result = await withRetry(async () => {
    calls++;
    return "ok";
  });
  assertEquals(result, "ok");
  assertEquals(calls, 1);
});

Deno.test("withRetry retries on failure and returns the value once the function recovers", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error(`transient failure #${calls}`);
      return "recovered";
    },
    { retries: 3, baseDelayMs: 1 },
  );
  assertEquals(result, "recovered");
  assertEquals(calls, 3);
});

Deno.test("withRetry gives up after exhausting retries and throws the last error", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      withRetry(
        async () => {
          calls++;
          throw new Error(`always fails #${calls}`);
        },
        { retries: 2, baseDelayMs: 1 },
      ),
    Error,
    "always fails #3",
  );
  // 1 initial attempt + 2 retries = 3 calls total.
  assertEquals(calls, 3);
});

Deno.test("withRetry calls onRetry with a growing delay for each retry attempt", async () => {
  const delays: number[] = [];
  await assertRejects(() =>
    withRetry(
      async () => {
        throw new Error("fail");
      },
      {
        retries: 3,
        baseDelayMs: 10,
        maxDelayMs: 1000,
        onRetry: (_attempt, _err, delayMs) => delays.push(delayMs),
      },
    )
  );
  assertEquals(delays, [10, 20, 40]);
});

Deno.test("withRetry caps the backoff delay at maxDelayMs", async () => {
  const delays: number[] = [];
  await assertRejects(() =>
    withRetry(
      async () => {
        throw new Error("fail");
      },
      { retries: 4, baseDelayMs: 100, maxDelayMs: 250, onRetry: (_a, _e, d) => delays.push(d) },
    )
  );
  assertEquals(delays, [100, 200, 250, 250]);
});

Deno.test("withRetry with retries: 0 makes exactly one attempt and no delay", async () => {
  let calls = 0;
  const onRetryCalls: number[] = [];
  await assertRejects(() =>
    withRetry(
      async () => {
        calls++;
        throw new Error("nope");
      },
      { retries: 0, onRetry: (n) => onRetryCalls.push(n) },
    )
  );
  assertEquals(calls, 1);
  assertEquals(onRetryCalls.length, 0);
});
