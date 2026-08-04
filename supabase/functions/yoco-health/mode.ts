// Classifies a Yoco secret key as live, test, or unrecognised.
//
// Pulled out to its own tested module because the inline version of this got
// it wrong in a way that mattered: it checked for `sk_live_` / `sk_test_` --
// Stripe's convention, assumed rather than verified against Yoco's actual key
// format -- so a correctly configured, genuinely live `YOCO_SECRET_KEY`
// (`yoco_live_...`) still reported "Fail / UNKNOWN" on the one screen built to
// answer "does this actually work". The bug never touched a real transaction
// -- `create-yoco-checkout` passes the key straight through as a bearer token
// and never inspects its shape -- but it did produce a false alarm at exactly
// the moment reassurance was needed.

export type YocoMode = "live" | "test" | "unknown";

/**
 * Yoco's convention is `yoco_live_*` / `yoco_test_*`. Stripe's `sk_live_` /
 * `sk_test_` is matched too, tolerantly: if the format ever changes again, or
 * an older-style key is in use somewhere, this should degrade to "unknown"
 * as rarely as possible rather than repeating the false-failure this file
 * exists to fix.
 *
 * Trims first. A trailing space or newline from a copy-paste is the single
 * most common way a correct key fails a prefix check, and it is invisible in
 * a password-masked input field.
 */
export function detectYocoMode(secretKey: string | null | undefined): YocoMode {
  const trimmed = (secretKey ?? "").trim();
  if (/^(yoco|sk)_live_/i.test(trimmed)) return "live";
  if (/^(yoco|sk)_test_/i.test(trimmed)) return "test";
  return "unknown";
}
