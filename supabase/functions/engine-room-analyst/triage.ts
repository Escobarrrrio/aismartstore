// The judgement half of the Engine Room watch, kept apart from the HTTP half.
//
// Separated for one blunt reason: index.ts calls Deno.serve() at the top level,
// so a test that imported triage() from there would start a web server as a
// side effect of asserting on a pure function. Keeping the rules in their own
// module means they can be tested exactly as what they are -- a function from a
// snapshot to a verdict, with no clock, no network and no model in the way.
//
// Nothing here reaches outside its arguments. That is the property the tests
// depend on, and the reason the severity of an alert can be reasoned about
// after the fact rather than re-guessed.

export type Severity = "ok" | "notice" | "warning" | "critical";

export interface Finding {
  severity: Severity;
  area: "engine" | "spend" | "security";
  subject: string;
  detail: string;
}

interface Engine {
  key: string; label: string; critical: boolean; cadence: string;
  status: string; minutes_silent: number | null; last_error: string;
  items_failed: number | null;
}
interface SpendRow {
  provider: string; label: string; daily_cap: number; call_cap: number;
  spent_today: number; calls_today: number; pct_daily: number;
  hard_stop: boolean; enabled: boolean;
}
interface SecuritySummary {
  last_24h: number; high_24h: number;
  recent: Array<{ kind: string; severity: string; actor: string | null }>;
}
export interface Snapshot {
  generated_at: string;
  engines: Engine[];
  spend: SpendRow[];
  security: SecuritySummary;
}

const RANK: Record<Severity, number> = { ok: 0, notice: 1, warning: 2, critical: 3 };
const worst = (a: Severity, b: Severity): Severity => (RANK[a] >= RANK[b] ? a : b);

/**
 * The whole judgement, as a pure function. No network, no model, no clock --
 * the snapshot carries its own timestamps -- so the same snapshot always yields
 * the same verdict and the tests can state exactly what triggers an alert.
 */
export function triage(snap: Snapshot): { severity: Severity; findings: Finding[] } {
  const findings: Finding[] = [];
  let severity: Severity = "ok";
  const raise = (s: Severity) => { severity = worst(severity, s); };

  for (const e of snap.engines ?? []) {
    if (e.status === "stalled") {
      // Critical engines carry the storefront's prices, stock and parcel
      // tracking. A stalled one is not "an error we should look at" -- it is
      // the site quietly lying to customers, so it outranks a loud failure.
      const s: Severity = e.critical ? "critical" : "warning";
      raise(s);
      findings.push({
        severity: s, area: "engine", subject: e.label,
        detail: `Has not run for ${e.minutes_silent ?? "?"} minutes against a ${e.cadence} cadence.`,
      });
    } else if (e.status === "failing") {
      const s: Severity = e.critical ? "critical" : "warning";
      raise(s);
      findings.push({
        severity: s, area: "engine", subject: e.label,
        detail: `Last run failed. ${e.last_error || "No detail recorded."}`.trim(),
      });
    } else if (e.status === "degraded") {
      raise("warning");
      findings.push({
        severity: "warning", area: "engine", subject: e.label,
        detail: `Partial run: ${e.items_failed ?? "some"} items failed. ${e.last_error || ""}`.trim(),
      });
    } else if (e.status === "unknown") {
      // Never having run is a real state and a common one after a deploy, but
      // it is not an incident on its own -- so it is a notice, and it stays
      // visible until the engine's first run rather than being swallowed.
      raise("notice");
      findings.push({
        severity: "notice", area: "engine", subject: e.label,
        detail: "No run recorded yet. Expected if this engine was only just scheduled.",
      });
    }
  }

  for (const s of snap.spend ?? []) {
    const pct = Number(s.pct_daily || 0);
    if (pct >= 100) {
      raise("critical");
      findings.push({
        severity: "critical", area: "spend", subject: s.label,
        detail: s.hard_stop
          ? `Daily cap reached and blocking. Anything relying on ${s.label} is refusing calls until tomorrow.`
          : `Daily cap exceeded and NOT blocking — hard stop is switched off, so spend is continuing past the cap.`,
      });
    } else if (pct >= 80) {
      raise("warning");
      findings.push({
        severity: "warning", area: "spend", subject: s.label,
        detail: `${pct}% of today's cap used (${s.daily_cap > 0 ? `R${s.spent_today} of R${s.daily_cap}` : `${s.calls_today} of ${s.call_cap} calls`}).`,
      });
    }
    // A disabled cap or a cap with hard_stop off is a standing exposure rather
    // than an event, so it is reported every run even when nothing is near it.
    // These are the settings that turn a guardrail into a decoration, and the
    // only moment anybody would notice them otherwise is after the bill.
    if (!s.enabled) {
      raise("warning");
      findings.push({
        severity: "warning", area: "spend", subject: s.label,
        detail: "Cap is disabled entirely — this provider currently has no ceiling.",
      });
    } else if (!s.hard_stop) {
      raise("notice");
      findings.push({
        severity: "notice", area: "spend", subject: s.label,
        detail: "Hard stop is off — this cap will warn but will not block.",
      });
    }
  }

  const sec = snap.security;
  if (sec) {
    if (Number(sec.high_24h) >= 5) {
      raise("critical");
      findings.push({
        severity: "critical", area: "security", subject: "Guardrail refusals",
        detail: `${sec.high_24h} high-severity security events in 24 hours. Sustained refusals at this rate mean something is pushing, not that someone mistyped.`,
      });
    } else if (Number(sec.high_24h) > 0) {
      raise("warning");
      findings.push({
        severity: "warning", area: "security", subject: "Guardrail refusals",
        detail: `${sec.high_24h} high-severity security event(s) in the last 24 hours.`,
      });
    }
    const capChanges = (sec.recent ?? []).filter((e) => e.kind === "spend_cap_changed").length;
    if (capChanges > 0) {
      raise("notice");
      findings.push({
        severity: "notice", area: "security", subject: "Spend caps edited",
        detail: `${capChanges} cap change(s) recorded recently. Expected if you changed them; worth a look if you did not.`,
      });
    }
  }

  return { severity, findings };
}

export function headlineFor(severity: Severity, findings: Finding[]): string {
  if (severity === "ok") return "All engines healthy, all spend inside its caps.";
  const top = findings.filter((f) => f.severity === severity);
  const first = top[0];
  const more = top.length - 1;
  const base = first ? `${first.subject}: ${first.detail}` : "Attention needed.";
  return more > 0 ? `${base} (+${more} more at this level)` : base;
}
