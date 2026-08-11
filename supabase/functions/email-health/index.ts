// Admin-only deliverability diagnostics. Live DNS checks (via Google's
// public DNS-over-HTTPS resolver, no credentials needed) for SPF, common
// DKIM selectors, and DMARC on every domain this store actually sends
// email from -- so a broken authentication setup shows up here, on demand,
// instead of being discovered days later in a customer's spam folder.
//
// Where a domain comes back unhealthy, this also asks Resend directly --
// its API, not just guessing selector names against DNS -- which exact
// records IT expects for that domain. Resend's own dashboard is normally
// where an admin has to go dig up the DKIM selector/value by hand; this
// surfaces the same information as an exact, copy-pasteable DNS record
// right here instead.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext } from "../_shared/auth-guard.ts";

// Hardcoded in supabase/functions/auth-email-hook/index.ts (SENDER_DOMAIN) --
// password reset / signup / magic-link emails always send from here via
// the platform's built-in auth email pipeline, regardless of the Resend setting.
const AUTH_EMAIL_DOMAIN = "notify.aismartstore.co.za";

const COMMON_DKIM_SELECTORS = ["resend", "mailo", "smtp", "k1", "s1", "s2", "mg", "google", "selector1", "selector2"];

interface ResendDnsRecord {
  record: string; // "SPF" | "DKIM" | "MX" | ...
  name: string;
  type: string;
  ttl: string;
  status: string; // "verified" | "pending" | "not_started" | "failed"
  value: string;
  priority?: number;
}

/** Looks the domain up in Resend's own /domains API and returns the exact
 *  DNS records Resend expects, with their current verification status --
 *  null if Resend isn't configured, the domain isn't registered there, or
 *  the API call itself fails (never lets a diagnostics call fail the whole
 *  response over this optional, best-effort extra). */
async function fetchResendDomainRecords(domain: string, resendKey: string): Promise<ResendDnsRecord[] | null> {
  try {
    const listRes = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${resendKey}` },
    });
    if (!listRes.ok) return null;
    const list = await listRes.json();
    const match = (list?.data ?? []).find((d: { name?: string }) => d.name === domain);
    if (!match?.id) return null;

    const detailRes = await fetch(`https://api.resend.com/domains/${match.id}`, {
      headers: { Authorization: `Bearer ${resendKey}` },
    });
    if (!detailRes.ok) return null;
    const detail = await detailRes.json();
    return Array.isArray(detail?.records) ? detail.records : null;
  } catch (e) {
    console.error("[email-health] Resend domain lookup failed:", (e as Error).message);
    return null;
  }
}

async function dnsQuery(name: string, type: string): Promise<string[]> {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`);
    const data = await res.json();
    return (data.Answer ?? []).map((a: any) => String(a.data ?? "").replace(/^"|"$/g, ""));
  } catch {
    return [];
  }
}

function extractDomain(fromAddress: string): string | null {
  const match = fromAddress.match(/@([^\s>]+)/);
  return match ? match[1] : null;
}

async function checkDomain(domain: string, resendKey: string | null) {
  const [spfRecords, ownDmarc] = await Promise.all([
    dnsQuery(domain, "TXT"),
    dnsQuery(`_dmarc.${domain}`, "TXT"),
  ]);

  const spfRecord = spfRecords.find((r) => r.includes("v=spf1")) ?? null;

  let dmarcRecord = ownDmarc.find((r) => r.includes("v=DMARC1")) ?? null;
  let dmarcSource: "own" | "inherited" | null = dmarcRecord ? "own" : null;
  let parentDomain: string | null = null;
  if (!dmarcRecord) {
    const parts = domain.split(".");
    if (parts.length > 2) {
      parentDomain = parts.slice(1).join(".");
      const parentDmarc = await dnsQuery(`_dmarc.${parentDomain}`, "TXT");
      dmarcRecord = parentDmarc.find((r) => r.includes("v=DMARC1")) ?? null;
      if (dmarcRecord) dmarcSource = "inherited";
    }
  }

  const dkimChecks = await Promise.all(
    COMMON_DKIM_SELECTORS.map(async (sel) => [sel, (await dnsQuery(`${sel}._domainkey.${domain}`, "TXT")).length > 0] as const),
  );
  const dkimSelectorsFound = dkimChecks.filter(([, ok]) => ok).map(([sel]) => sel);

  const dmarcPolicy = dmarcRecord?.match(/p=([a-z]+)/i)?.[1]?.toLowerCase() ?? null;

  const issues: string[] = [];
  if (!spfRecord) issues.push("No SPF record found -- receiving servers can't verify who's allowed to send as this domain.");
  if (dkimSelectorsFound.length === 0) issues.push("No DKIM record found under common selectors -- check your Resend/Mailgun dashboard for the exact selector name and confirm it's published in DNS.");
  if (!dmarcRecord) {
    issues.push("No DMARC record found (own or inherited) -- no policy at all is a weak signal to strict filters like Yahoo/Gmail.");
  } else if (dmarcSource === "inherited" && (dmarcPolicy === "reject" || dmarcPolicy === "quarantine")) {
    issues.push(`This domain has no DMARC record of its own, so it inherits p=${dmarcPolicy} from ${parentDomain}. Unless SPF/DKIM are fully aligned for mail sent as this exact domain, messages will be rejected or spam-filtered.`);
  } else if (dmarcPolicy === "none") {
    issues.push("DMARC policy is p=none -- this only reports, it enforces nothing. Tighten to p=quarantine once SPF/DKIM are confirmed passing.");
  }

  // Only bother asking Resend when DNS itself already looks incomplete --
  // a healthy domain needs no further explanation, and this saves two API
  // calls per domain on every load of a screen an admin may check often.
  const resendRecords =
    issues.length > 0 && resendKey ? await fetchResendDomainRecords(domain, resendKey) : null;
  if (resendRecords) {
    const unverified = resendRecords.filter((r) => r.status !== "verified");
    if (unverified.length > 0) {
      issues.push(
        `Resend has this domain registered but is still waiting on ${unverified.length} DNS record(s) -- see "resendRecords" below for the exact name/type/value to add.`,
      );
    }
  }

  return {
    domain,
    spfRecord,
    dkimSelectorsFound,
    dmarcRecord,
    dmarcPolicy,
    dmarcSource,
    parentDomain,
    healthy: issues.length === 0,
    issues,
    resendRecords,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await getAuthContext(req);
    if (!auth.userId || !auth.isAdmin) {
      return new Response(JSON.stringify({ error: "Admin required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: setting } = await supabase
      .from("store_settings").select("value").eq("key", "email_from_address").maybeSingle();
    const fromAddress = (setting?.value as string | undefined) || null;
    const resendDomain = fromAddress ? extractDomain(fromAddress) : null;

    const domainsToCheck = new Set<string>([AUTH_EMAIL_DOMAIN]);
    if (resendDomain) domainsToCheck.add(resendDomain);

    const resendKey = Deno.env.get("RESEND_API_KEY") || null;
    const domains = await Promise.all([...domainsToCheck].map((d) => checkDomain(d, resendKey)));

    const { count: recentFailures } = await supabase
      .from("email_send_log")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

    const { data: unverifiedWarnings } = await supabase
      .from("automation_events")
      .select("id, created_at, error_message")
      .eq("source", "email")
      .eq("event_type", "from_address.unverified")
      .order("created_at", { ascending: false })
      .limit(5);

    return new Response(JSON.stringify({
      fromAddress,
      domains,
      recentEmailFailures24h: recentFailures ?? 0,
      unverifiedFromWarnings: unverifiedWarnings ?? [],
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[email-health] failure:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
