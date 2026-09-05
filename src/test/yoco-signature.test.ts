import { describe, it, expect } from "vitest";

/**
 * Mirrors the signature verification in supabase/functions/yoco-webhook.
 *
 * The deployed function was returning 500 "Failed to decode base64" for every
 * signed delivery, because it assumed the webhook secret is always Svix-style
 * base64. A plain-string secret threw inside atob() and took the whole handler
 * down -- meaning genuine "payment.succeeded" callbacks never marked orders
 * paid. These tests pin both secret shapes so that cannot regress silently.
 *
 * Kept in the Vitest suite rather than e2e because it needs no network and
 * must run on every push.
 */

function secretToBytes(secret: string): Uint8Array {
  const body = secret.replace(/^whsec_/, "");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(body) && body.length % 4 === 0) {
    try {
      return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    } catch {
      /* fall through */
    }
  }
  return new TextEncoder().encode(body);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(secret: string, id: string, ts: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw", secretToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

const BODY = JSON.stringify({ type: "payment.succeeded", payload: { amount: 736164 } });
const ID = "msg_2abc";
const TS = "1788557151";

describe("yoco webhook signature", () => {
  it("accepts a correctly signed delivery when the secret is Svix base64", async () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const sig = await sign(secret, ID, TS, BODY);
    const expected = await sign(secret, ID, TS, BODY);
    expect(timingSafeEqual(sig, expected)).toBe(true);
  });

  it("accepts a correctly signed delivery when the secret is a plain string", async () => {
    // The case that was crashing the live endpoint.
    const secret = "not-base64-at-all!!";
    const sig = await sign(secret, ID, TS, BODY);
    const expected = await sign(secret, ID, TS, BODY);
    expect(timingSafeEqual(sig, expected)).toBe(true);
  });

  it("never throws while turning a secret into key material", () => {
    // Any of these previously took the handler to a 500.
    for (const s of ["whsec_!!!not-base64", "", "short", "whsec_", "ünicode-secret"]) {
      expect(() => secretToBytes(s)).not.toThrow();
    }
  });

  it("rejects a signature produced with a different secret", async () => {
    const good = await sign("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", ID, TS, BODY);
    const forged = await sign("whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ID, TS, BODY);
    expect(timingSafeEqual(forged, good)).toBe(false);
  });

  it("rejects a signature over a tampered body", async () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const good = await sign(secret, ID, TS, BODY);
    // Attacker keeps the signature but rewrites the amount they "paid".
    const tampered = await sign(secret, ID, TS, BODY.replace("736164", "1"));
    expect(timingSafeEqual(tampered, good)).toBe(false);
  });

  it("rejects when lengths differ instead of leaking via early exit", () => {
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "a")).toBe(false);
  });
});
