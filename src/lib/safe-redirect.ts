/**
 * Validation for user-supplied post-login redirect targets.
 *
 * `/auth?redirect=…` is attacker-controllable, so anything that isn't provably
 * an internal path has to be discarded. The previous inline check was:
 *
 *   raw.startsWith("/") && !raw.startsWith("//")
 *
 * which accepts `/\evil.com`. Browsers normalise a backslash to a forward slash
 * while resolving a URL, so that value becomes `//evil.com` — a protocol-
 * relative URL pointing off-site. A shopper following
 * `aismartstore.co.za/auth?redirect=/\evil.com` would log in on the real store
 * and then land on an attacker's copy of it, which is a working phishing flow
 * against a site that takes card details. This is the same bypass class as
 * React Router's CVE-2025-68470 advisory.
 *
 * The rule here is an allowlist rather than a blocklist: the value must begin
 * with a single `/` followed by a character that cannot start an authority, and
 * must contain no backslashes, control characters or scheme separator at all.
 */

export const DEFAULT_REDIRECT = "/";

/**
 * Backslashes and C0/C1 control characters are never legitimate in a path we
 * generated, and are the primary way this check gets bypassed -- browsers strip
 * tab/newline while parsing a URL, so "/\t/evil.com" would otherwise survive.
 * Written as a code-point scan rather than a regex control-character class,
 * which is clearer and doesn't trip `no-control-regex`.
 */
function hasBackslashOrControl(value: string): boolean {
  for (const ch of value) {
    if (ch === "\\") return true;
    const code = ch.codePointAt(0)!;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Returns `raw` when it is a safe same-origin path, otherwise `fallback`.
 * Never throws — callers use the result directly as a navigation target.
 */
export function safeRedirectPath(raw: string | null | undefined, fallback: string = DEFAULT_REDIRECT): string {
  if (typeof raw !== "string") return fallback;

  const value = raw.trim();
  if (value === "") return fallback;

  // Backslashes and control characters are never legitimate in a path we
  // generated, and are the primary way this check gets bypassed. Tab/newline in
  // particular are stripped by browsers during URL parsing, so "/\t/evil.com"
  // must not survive either.
  if (hasBackslashOrControl(value)) return fallback;

  // Must be root-relative. This also rejects "https://evil.com", "//evil.com"
  // and scheme-relative forms outright.
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;

  // "/:" and friends can be reinterpreted as a scheme by some parsers.
  if (value.length > 1 && !/^[A-Za-z0-9\-._~%!$&'()*+,;=@/?#[\]]/.test(value.slice(1, 2))) {
    return fallback;
  }

  // Final authority: resolve against a throwaway origin and confirm nothing
  // moved us off it. Anything the hand-rolled rules missed fails here.
  try {
    const probe = "https://redirect-check.invalid";
    const resolved = new URL(value, probe);
    if (resolved.origin !== probe) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}

/**
 * Payment gateways are the only case where we hand the browser an *external*
 * URL that came back over the wire. If an edge function (or anything able to
 * spoof its response) ever returned an attacker URL, `window.location.href =
 * data.redirectUrl` would be a straight open redirect off a page that has just
 * collected an address and is about to collect card details — and a
 * `javascript:` value there would be script execution.
 *
 * So the target is checked against an allowlist of the gateway hosts we
 * actually integrate with, over https only. Anything else is refused.
 */
const GATEWAY_HOSTS = [
  "yoco.com",
  "payfast.co.za",
  "payfast.io",
  "paypal.com",
  "sandbox.paypal.com",
  "stripe.com",
  "checkout.stripe.com",
];

function isAllowedGatewayHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return GATEWAY_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Returns the URL when it is an https URL on a known payment gateway host,
 * otherwise `null`. Callers must treat `null` as a hard failure rather than
 * navigating anyway.
 */
export function safeGatewayUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  if (hasBackslashOrControl(raw)) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    if (!isAllowedGatewayHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
