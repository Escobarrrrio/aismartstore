// The Engine Room's watch.
//
// Runs every three hours (cron job `engine-room-watch`), reads the same
// snapshot the admin screen reads, decides whether anything needs a human, and
// writes an assessment. Escalates by email when it does.
//
// THE SPLIT THAT MATTERS
// ---------------------
// `triage()` below is a pure function over the snapshot, and it -- not the
// model -- decides the severity and whether to wake anybody. The model is
// asked afterwards for a paragraph a tired person can read at 6am.
//
// The reason is not distrust of the model in the abstract. It is that an
// AI-judged monitor stops judging at exactly the wrong moment: when the AI
// budget is exhausted, which on this store is a symptom of the thing being
// monitored. A watchman that goes quiet when the alarm is loudest is worse
// than no watchman, because its silence reads as an all-clear.
//
// So: rules decide, the model narrates, and every path still produces an
// assessment row and still alerts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext } from "../_shared/auth-guard.ts";
import { resolveAiProvider } from "../_shared/ai-provider.ts";
import { resolveEmailFromAddress } from "../_shared/email-from.ts";
import { guard, record } from "../_shared/guardrails.ts";
import { triage, headlineFor, type Severity, type Finding, type Snapshot } from "./triage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const ANALYST_EST_COST_ZAR = 0.08;

// Do not email about the same thing more often than this. A stalled engine
// stays stalled; six identical emails a day trains the reader to archive on
// sight, and then the seventh -- the one about a different, worse thing -- gets
// archived too.
const ALERT_COOLDOWN_HOURS = 6;

function alertHtml(severity: Severity, headline: string, findings: Finding[], narrative: string | null) {
  const colour = severity === "critical" ? "#b91c1c" : "#b45309";
  const rows = findings
    .filter((f) => f.severity === "critical" || f.severity === "warning")
    .map((f) => `<li style="margin-bottom:8px"><strong>${esc(f.subject)}</strong> — ${esc(f.detail)}</li>`)
    .join("");
  return `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;padding:24px">
    <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#64748b;margin:0 0 8px">AI Smart Store · Engine Room</p>
    <h1 style="font-size:18px;color:${colour};margin:0 0 14px">${severity === "critical" ? "Critical" : "Needs attention"}: ${esc(headline)}</h1>
    ${narrative ? `<p style="color:#334155;font-size:14px;line-height:1.65">${esc(narrative)}</p>` : ""}
    <ul style="color:#334155;font-size:14px;line-height:1.6;padding-left:18px">${rows}</ul>
    <p style="color:#64748b;font-size:12px;margin-top:22px">
      Admin &rarr; Engine Room has the live picture. This alert repeats at most once every ${ALERT_COOLDOWN_HOURS} hours.
    </p>
  </div>`;
}

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SYSTEM_PROMPT = `You are the operations analyst for AI Smart Store, a small South African online technology retailer run by one person.

You will be given a machine-generated triage of the store's automated systems: which engines are healthy or stalled, how much has been spent against each provider's daily cap, and any security refusals.

Write ONE short paragraph (maximum 90 words) for the owner, in plain South African English.

Rules:
- The severity has already been decided. Do not argue with it, re-rate it, or say "this may be fine".
- Explain what the findings MEAN for the business -- lost sales, stale prices, money leaving -- not what the fields are called.
- If something needs doing, say the single most important thing to do first.
- No greeting, no sign-off, no bullet points, no markdown.
- Never invent a number, a cause or a system that is not in the input.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Same auth shape as the other scheduled functions: the internal secret, a
  // service-role bearer, or an admin session. Anything else is refused before
  // it can learn anything about the state of the store -- this endpoint's
  // response is a map of exactly where the store is weakest.
  const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const isInternal =
    (internalSecret.length > 0 && providedSecret === internalSecret) ||
    (serviceKey.length > 0 && authHeader === `Bearer ${serviceKey}`);
  if (!isInternal) {
    const ctx = await getAuthContext(req);
    if (!ctx?.isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const { data: snapRaw, error: snapErr } = await supabase.rpc("engine_room_snapshot");
    if (snapErr) throw new Error(`snapshot failed: ${snapErr.message}`);
    const snap = snapRaw as unknown as Snapshot;

    const { severity, findings } = triage(snap);
    const headline = headlineFor(severity, findings);

    // The model runs only when there is something to explain. An "all clear"
    // needs no prose, and paying for a paragraph saying nothing is wrong --
    // eight times a day, forever -- is the kind of small, permanent leak this
    // whole subsystem exists to stop.
    let narrative: string | null = null;
    let aiModel: string | null = null;
    if (severity !== "ok") {
      const gate = await guard(supabase, {
        provider: "ai-gateway",
        source: "engine-room-analyst",
        estimatedCostZar: ANALYST_EST_COST_ZAR,
      });
      if (gate.ok) {
        try {
          const provider = await resolveAiProvider(supabase);
          if (provider) {
            const res = await fetch(provider.apiUrl, {
              method: "POST",
              headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: provider.model,
                messages: [
                  { role: "system", content: SYSTEM_PROMPT },
                  { role: "user", content: JSON.stringify({ severity, findings }, null, 1) },
                ],
              }),
            });
            if (res.ok) {
              const j = await res.json();
              narrative = j?.choices?.[0]?.message?.content?.trim() ?? null;
              aiModel = provider.model;
              await record(supabase, {
                provider: "ai-gateway", source: "engine-room-analyst",
                costZar: ANALYST_EST_COST_ZAR, meta: { model: provider.model, cost_is_estimate: true },
              });
            } else {
              console.error("[engine-room-analyst] model call failed", res.status);
            }
          }
        } catch (e) {
          // Narration is the optional half. Losing it must not lose the
          // assessment or the alert.
          console.error("[engine-room-analyst] narrative failed", String(e));
        }
      }
    }

    // Cooldown is checked against assessments we actually alerted on, not
    // against all assessments -- otherwise a quiet run resets nothing and a
    // noisy one is suppressed by the run before it.
    let alertSent = false;
    if (severity === "critical" || severity === "warning") {
      const since = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 3600_000).toISOString();
      const { data: recentAlert } = await supabase
        .from("engine_room_assessments")
        .select("id")
        .eq("alert_sent", true)
        .gte("created_at", since)
        .limit(1)
        .maybeSingle();

      if (!recentAlert) {
        const { data: setting } = await supabase
          .from("store_settings").select("value").eq("key", "notification_email").maybeSingle();
        const recipient = ((setting?.value as string) ?? "").trim();
        const resendKey = Deno.env.get("RESEND_API_KEY") || "";
        if (recipient && resendKey) {
          try {
            const from = await resolveEmailFromAddress(supabase);
            const res = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                from, to: recipient,
                subject: `${severity === "critical" ? "🔴" : "🟠"} Engine Room: ${headline.slice(0, 90)}`,
                html: alertHtml(severity, headline, findings, narrative),
              }),
            });
            alertSent = res.ok;
          } catch (e) {
            console.error("[engine-room-analyst] alert email failed", String(e));
          }
        }
      }
    }

    await supabase.from("engine_room_assessments").insert({
      severity, headline, findings, narrative, ai_model: aiModel,
      snapshot: snap as unknown as Record<string, unknown>, alert_sent: alertSent,
    });

    return new Response(JSON.stringify({ severity, headline, findings, narrative, alertSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[engine-room-analyst] failed", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
