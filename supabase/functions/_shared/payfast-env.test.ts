import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSandbox, payfastHost, payfastProcessUrl, payfastValidateUrl } from "./payfast-env.ts";

function withSandbox<T>(value: string | undefined, fn: () => T): T {
  const previous = Deno.env.get("PAYFAST_SANDBOX");
  if (value === undefined) Deno.env.delete("PAYFAST_SANDBOX");
  else Deno.env.set("PAYFAST_SANDBOX", value);
  try {
    return fn();
  } finally {
    if (previous === undefined) Deno.env.delete("PAYFAST_SANDBOX");
    else Deno.env.set("PAYFAST_SANDBOX", previous);
  }
}

Deno.test("defaults to LIVE when PAYFAST_SANDBOX is unset", () => {
  withSandbox(undefined, () => {
    assertEquals(isSandbox(), false);
    assertEquals(payfastHost(), "www.payfast.co.za");
  });
});

Deno.test("only the exact string 'true' selects sandbox", () => {
  withSandbox("true", () => assertEquals(isSandbox(), true));
  withSandbox("TRUE", () => assertEquals(isSandbox(), true));
  withSandbox("  true  ", () => assertEquals(isSandbox(), true));

  // Anything ambiguous must fail safe to LIVE rather than silently routing
  // real money at the sandbox (where it would never actually be collected).
  for (const v of ["false", "1", "yes", "sandbox", "", "no"]) {
    withSandbox(v, () => assertEquals(isSandbox(), false, `"${v}" must not enable sandbox`));
  }
});

Deno.test("process and validate URLs stay on the same host", () => {
  for (const sandbox of [true, false]) {
    const host = payfastHost(sandbox);
    assertEquals(payfastProcessUrl(sandbox), `https://${host}/eng/process`);
    assertEquals(payfastValidateUrl(sandbox), `https://${host}/eng/query/validate`);
  }
});

Deno.test("sandbox and live hosts are distinct", () => {
  assertEquals(payfastHost(true), "sandbox.payfast.co.za");
  assertEquals(payfastHost(false), "www.payfast.co.za");
});
