// Single source of truth for which PayFast environment the store is talking to.
//
// Checkout and the ITN webhook MUST agree. If create-payfast-checkout posts a
// customer to sandbox.payfast.co.za while payfast-webhook validates the callback
// against www.payfast.co.za, every notification fails server validation and the
// order silently never gets marked paid. Reading the flag through one helper in
// one place is what makes that class of mismatch impossible.
//
// Switching environments is a secrets change only — no code edit, no redeploy of
// application logic:
//
//   PAYFAST_SANDBOX = "true"   -> sandbox.payfast.co.za, IP allow-list relaxed
//   PAYFAST_SANDBOX unset/other -> www.payfast.co.za (LIVE), IP allow-list enforced
//
// Live is the default on purpose: a typo in the flag must fail safe by keeping
// production real and verified, never by quietly routing live money to sandbox.

/** True only for the exact string "true" (case/whitespace tolerant). */
export function isSandbox(): boolean {
  return (Deno.env.get("PAYFAST_SANDBOX") ?? "").trim().toLowerCase() === "true";
}

/** Host used for both the process redirect and the ITN validation callback. */
export function payfastHost(sandbox: boolean = isSandbox()): string {
  return sandbox ? "sandbox.payfast.co.za" : "www.payfast.co.za";
}

/** Form-POST target the shopper's browser is redirected to. */
export function payfastProcessUrl(sandbox: boolean = isSandbox()): string {
  return `https://${payfastHost(sandbox)}/eng/process`;
}

/** Server-to-server endpoint used to confirm an ITN really came from PayFast. */
export function payfastValidateUrl(sandbox: boolean = isSandbox()): string {
  return `https://${payfastHost(sandbox)}/eng/query/validate`;
}

/**
 * Credentials for the active environment. Merchant ID/key differ between
 * sandbox and live, so they are read together with the mode to keep a live key
 * from ever being posted to sandbox or vice versa.
 */
export function payfastCredentials(): {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  sandbox: boolean;
} {
  return {
    merchantId: (Deno.env.get("PAYFAST_MERCHANT_ID") ?? "").trim(),
    merchantKey: (Deno.env.get("PAYFAST_MERCHANT_KEY") ?? "").trim(),
    passphrase: (Deno.env.get("PAYFAST_PASSPHRASE") ?? "").trim(),
    sandbox: isSandbox(),
  };
}
