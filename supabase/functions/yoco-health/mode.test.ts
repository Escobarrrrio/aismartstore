import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectYocoMode } from "./mode.ts";

// The actual incident: a correctly configured live key, from a real Yoco
// account, reported as UNKNOWN because the check assumed Stripe's naming.
Deno.test("detectYocoMode: recognises Yoco's real live key format", () => {
  assertEquals(detectYocoMode("yoco_live_abc123def456"), "live");
});

Deno.test("detectYocoMode: recognises Yoco's real test key format", () => {
  assertEquals(detectYocoMode("yoco_test_abc123def456"), "test");
});

Deno.test("detectYocoMode: still accepts the Stripe-style prefix, tolerantly", () => {
  assertEquals(detectYocoMode("sk_live_abc123"), "live");
  assertEquals(detectYocoMode("sk_test_abc123"), "test");
});

Deno.test("detectYocoMode: is case-insensitive", () => {
  assertEquals(detectYocoMode("YOCO_LIVE_abc123"), "live");
});

Deno.test("detectYocoMode: trims whitespace before matching", () => {
  // The other likely real-world cause of the same false failure: a
  // leading/trailing space or newline from copy-pasting into a masked field.
  assertEquals(detectYocoMode("  yoco_live_abc123\n"), "live");
  assertEquals(detectYocoMode("\tyoco_test_abc123 "), "test");
});

Deno.test("detectYocoMode: a publishable key is not a secret key", () => {
  // pk_live_ / yoco_pk_live_ style values are the browser-side key, handed
  // out freely and not what create-yoco-checkout needs. Classifying it as
  // unknown rather than guessing "live" is the safer failure.
  assertEquals(detectYocoMode("pk_live_abc123"), "unknown");
});

Deno.test("detectYocoMode: empty or missing key is unknown, not a crash", () => {
  assertEquals(detectYocoMode(""), "unknown");
  assertEquals(detectYocoMode(null), "unknown");
  assertEquals(detectYocoMode(undefined), "unknown");
});

Deno.test("detectYocoMode: unrecognised text is unknown", () => {
  assertEquals(detectYocoMode("some-random-string"), "unknown");
});
