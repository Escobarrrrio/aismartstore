// Edge Function: stock-sanity-check
// Scheduled sanity check for the product catalogue's stock state.
// Detects spikes in "Out of Stock" products (i.e. false-negative Axiz syncs
// that mass-flip products to unavailable) and emails the store owner.
//
// Auth: caller must be an admin OR provide the INTERNAL_CRON_SECRET header.
// Trigger: pg_cron (hourly) or manual invocation from the admin panel.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.1";
import { getAuthContext } from "../_shared/auth-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FROM_ADDRESS =
  Deno.env.get("ORDER_FROM_ADDRESS") ?? "Alerts <alerts@resend.dev>";

// Threshold defaults — overridable via store_settings.
const DEFAULTS = {
  min_active: 500,          // ignore tiny catalogues
  spike_abs: 1000,          // absolute OOS jump to alert on
  spike_pct: 5,             // OR percentage-point jump in OOS share
  oos_share_ceiling: 60,    // OR absolute OOS share % ceiling
};

type Baseline = {
  active: number;
  out_of_stock: number;
  oos_share: number;
  checked_at: string;
};

function pct(n: number, d: number) {
  return d === 0 ? 0 : Math.round((n / d) * 10000) / 100;
}

function buildAlertHtml(args: {
  active: number;
  oos: number;
  oosShare: number;
  baseline: Baseline | null;
  deltaAbs: number;
  deltaPct: number;
  reason: string;
}) {
  const { active, oos, oosShare, baseline, deltaAbs, deltaPct, reason } = args;
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0f172a">
    <h1 style="font-size:20px;margin:0 0 4px;color:#b91c1c">Stock anomaly detected</h1>
    <p style="color:#64748b;margin:0 0 20px">${reason}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
      <tr><td style="padding:6px 0;color:#64748b">Active products</td><td style="padding:6px 0"><strong>${active.toLocaleString()}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Out of stock now</td><td style="padding:6px 0"><strong>${oos.toLocaleString()}</strong> (${oosShare}%)</td></tr>
      ${baseline ? `
      <tr><td style="padding:6px 0;color:#64748b">Baseline OOS</td><td style="padding:6px 0">${baseline.out_of_stock.toLocaleString()} (${baseline.oos_share}%)</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Delta</td><td style="padding:6px 0"><strong>+${deltaAbs.toLocaleString()}</strong> products / +${deltaPct}pp</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Last check</td><td style="padding:6px 0">${baseline.checked_at}</td></tr>
      ` : ""}
    </table>
    <p style="color:#475569;font-size:13px;margin:16px 0 0">
      Check <strong>Admin → Sync Logs</strong> first: if the Axiz sync has been deferring on the same
      cursor, this figure is frozen rather than current, and the stock picture is simply stale.
      If the sync is running clean, then the distributor genuinely has this much out of stock and the
      number is correct.
    </p>
    <p style="color:#475569;font-size:13px;margin:12px 0 0">
      Do <strong>not</strong> mass-set <code>in_stock = true</code> to clear this alert. The sync already
      treats an unknown quantity (<code>onHand: null</code>) as in stock; anything showing out of stock
      was reported as zero by the distributor. Overriding it advertises stock that does not exist, which
      is a Consumer Protection Act problem, not a display problem.
    </p>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Auth: internal cron secret OR service-role bearer (what pg_cron
  // actually sends -- see the stock-sanity-check-hourly cron job) OR admin
  // JWT. The Bearer branch was missing entirely, and the cron job's
  // x-internal-secret was a literal NULL placeholder that was never wired
  // up to a real value -- both meant every cron-triggered run hit the
  // admin-JWT fallback with no session and got rejected with 403.
  const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const isInternal =
    (internalSecret.length > 0 && providedSecret === internalSecret) ||
    (serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`);

  if (!isInternal) {
    const ctx = await getAuthContext(req);
    if (!ctx?.isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    // Load thresholds + baseline + recipient in parallel.
    const [{ data: settings }, { count: active }, { count: oos }] = await Promise.all([
      supabase.from("store_settings")
        .select("key,value")
        .in("key", ["stock_sanity_baseline", "stock_sanity_thresholds", "notification_email"]),
      supabase.from("products").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("products").select("*", { count: "exact", head: true })
        .eq("is_active", true).eq("in_stock", false),
    ]);

    const settingsMap = Object.fromEntries((settings ?? []).map((r: any) => [r.key, r.value]));
    const parseJson = (v: unknown) => {
      if (v && typeof v === "object") return v as Record<string, unknown>;
      if (typeof v === "string" && v.trim().startsWith("{")) {
        try { return JSON.parse(v); } catch { return {}; }
      }
      return {};
    };
    const thresholds = { ...DEFAULTS, ...parseJson(settingsMap.stock_sanity_thresholds) };
    const baseline: Baseline | null = (parseJson(settingsMap.stock_sanity_baseline) as any) ?? null;
    const baselineValid = baseline && typeof (baseline as any).out_of_stock === "number";
    const recipient: string | null =
      typeof settingsMap.notification_email === "string"
        ? settingsMap.notification_email
        : (settingsMap.notification_email?.email ?? null);

    const activeCount = active ?? 0;
    const oosCount = oos ?? 0;
    const oosShare = pct(oosCount, activeCount);

    const current: Baseline = {
      active: activeCount,
      out_of_stock: oosCount,
      oos_share: oosShare,
      checked_at: new Date().toISOString(),
    };

    let alert = false;
    let reason = "";
    let deltaAbs = 0;
    let deltaPct = 0;

    if (activeCount >= thresholds.min_active) {
      if (baselineValid && baseline) {
        deltaAbs = oosCount - baseline.out_of_stock;
        deltaPct = Math.round((oosShare - baseline.oos_share) * 100) / 100;
        if (deltaAbs >= thresholds.spike_abs || deltaPct >= thresholds.spike_pct) {
          alert = true;
          reason = `Out-of-stock count jumped by ${deltaAbs.toLocaleString()} products (+${deltaPct}pp) since last check.`;
        }
      }
      // The ceiling alerts on *crossing* it, not on *being above* it.
      //
      // As written before, this fired on every run for as long as the share
      // stayed high: twenty-four identical emails a day, each one reporting a
      // delta of "+0 products / +0pp" -- the system saying "nothing has
      // changed" in the form of an alarm. Dozens of them arrived while a
      // genuinely stuck Axiz sync sat behind them, unnoticed, because by then
      // the alert had trained its only reader to ignore it.
      //
      // A level that has been reported once and has not moved is not news. It
      // becomes news again only when it materially worsens, so re-alerting
      // requires a full percentage point of deterioration against the level
      // last reported.
      const lastAlerted = (baseline as (Baseline & { alerted_share?: number }) | null)?.alerted_share;
      const alertedBefore = typeof lastAlerted === "number";
      const worthReporting = oosShare >= thresholds.oos_share_ceiling &&
        (!alertedBefore || oosShare >= lastAlerted + 1);

      if (!alert && worthReporting) {
        alert = true;
        reason = alertedBefore
          ? `Out-of-stock share worsened to ${oosShare}% (last reported at ${lastAlerted}%), above the ${thresholds.oos_share_ceiling}% ceiling.`
          : `Out-of-stock share is ${oosShare}%, above the ${thresholds.oos_share_ceiling}% ceiling.`;
      }
    }

    // Carry the last-reported level forward so the ceiling check above can
    // tell "already told you" from "this is new". Without it the baseline
    // records the level but not the fact that it was reported, and the alert
    // re-fires on every run for as long as the condition lasts.
    const previouslyAlertedShare =
      (baseline as (Baseline & { alerted_share?: number }) | null)?.alerted_share;
    const currentWithAlertState = {
      ...current,
      ...(alert
        ? { alerted_share: oosShare }
        : typeof previouslyAlertedShare === "number"
          ? { alerted_share: previouslyAlertedShare }
          : {}),
    };

    // Persist new baseline (upsert). value column is text — store JSON string.
    await supabase.from("store_settings").upsert(
      { key: "stock_sanity_baseline", value: JSON.stringify(currentWithAlertState) },
      { onConflict: "key" },
    );

    let emailed = false;
    let emailError: string | null = null;

    if (alert && recipient) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) {
        emailError = "RESEND_API_KEY not configured";
        console.warn("[stock-sanity-check]", emailError);
      } else {
        try {
          const resend = new Resend(resendKey);
          await resend.emails.send({
            from: FROM_ADDRESS,
            to: [recipient],
            subject: `⚠️ Stock anomaly: ${oosCount.toLocaleString()} products marked Out of Stock`,
            html: buildAlertHtml({
              active: activeCount, oos: oosCount, oosShare,
              baseline, deltaAbs, deltaPct, reason,
            }),
          });
          emailed = true;
        } catch (e) {
          emailError = e instanceof Error ? e.message : String(e);
          console.error("[stock-sanity-check] send failed", emailError);
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      alert,
      reason,
      emailed,
      email_error: emailError,
      current,
      baseline,
      thresholds,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[stock-sanity-check] error", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
