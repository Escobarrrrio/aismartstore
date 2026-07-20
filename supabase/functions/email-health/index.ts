// Admin-only deliverability diagnostics. Live DNS checks (via Google's
// public DNS-over-HTTPS resolver, no credentials needed) for SPF, common
// DKIM selectors, and DMARC on every domain this store actually sends
// email from -- so a broken authentication setup shows up here, on demand,
// instead of being discovered days later in a customer's spam folder.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2/cors";
import { getAuthContext } from "../_shared/auth-guard.ts";

// Hardcoded in supabase/functions/auth-email-hook/index.ts (SENDER_DOMAIN) --
// password reset / signup / magic-link emails always send from here via
// Lovable's built-in auth email pipeline, regardless of the Resend setting.
const AUTH_EMAIL_DOMAIN = "notify.aismartstore.co.za";

const COMMON_DKIM_SELECTORS = ["resend", "mailo", "smtp", "k1", "s1", "s2", "mg", "google", "selector1", "selector2"];

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

async function checkDomain(domain: string) {
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

    const domains = await Promise.all([...domainsToCheck].map(checkDomain));

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
