import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { triage, headlineFor, type Snapshot } from "./triage.ts";

// The point of these tests is that the alerting threshold is stated somewhere
// a person can read and argue with. triage() is pure, so "what wakes the owner
// at 3am" is a question with an exact answer rather than a model's mood.

const base = (over: Partial<Snapshot> = {}): Snapshot => ({
  generated_at: "2026-07-30T14:00:00Z",
  engines: [],
  spend: [],
  security: { last_24h: 0, high_24h: 0, recent: [] },
  ...over,
});

const engine = (over: Record<string, unknown> = {}) => ({
  key: "x", label: "Some engine", critical: false, cadence: "hourly",
  status: "ok", minutes_silent: 5, last_error: "", items_failed: 0, ...over,
// deno-lint-ignore no-explicit-any
}) as any;

const cap = (over: Record<string, unknown> = {}) => ({
  provider: "p", label: "Some provider", daily_cap: 40, call_cap: 0,
  spent_today: 0, calls_today: 0, pct_daily: 0, hard_stop: true, enabled: true, ...over,
// deno-lint-ignore no-explicit-any
}) as any;

Deno.test("a healthy store is ok and says so plainly", () => {
  const r = triage(base({ engines: [engine(), engine({ key: "y" })], spend: [cap()] }));
  assertEquals(r.severity, "ok");
  assertEquals(r.findings.length, 0);
  assertEquals(headlineFor(r.severity, r.findings), "All engines healthy, all spend inside its caps.");
});

Deno.test("a stalled critical engine is critical; a stalled minor one is only a warning", () => {
  const crit = triage(base({ engines: [engine({ status: "stalled", critical: true, minutes_silent: 200 })] }));
  assertEquals(crit.severity, "critical");

  const minor = triage(base({ engines: [engine({ status: "stalled", critical: false, minutes_silent: 200 })] }));
  assertEquals(minor.severity, "warning");
});

Deno.test("a partial run is a warning, not a failure", () => {
  // axiz-sync spent an afternoon in exactly this state -- syncing most rows
  // and silently dropping batches. It is real and it is not an outage.
  const r = triage(base({ engines: [engine({ status: "degraded", items_failed: 500, critical: true })] }));
  assertEquals(r.severity, "warning");
  assert(r.findings[0].detail.includes("500"));
});

Deno.test("an engine that has never run is a notice, not an alert", () => {
  const r = triage(base({ engines: [engine({ status: "unknown", minutes_silent: null })] }));
  assertEquals(r.severity, "notice");
});

Deno.test("a cap at 100% with hard stop on is critical and says it is blocking", () => {
  const r = triage(base({ spend: [cap({ pct_daily: 100, spent_today: 40, hard_stop: true })] }));
  assertEquals(r.severity, "critical");
  assert(r.findings[0].detail.includes("blocking"));
});

Deno.test("a cap over 100% with hard stop OFF is critical for the opposite reason", () => {
  // Still spending past the ceiling is worse than being stopped at it, and the
  // wording has to make that unmistakable -- these two states look identical
  // on a progress bar.
  const r = triage(base({ spend: [cap({ pct_daily: 140, hard_stop: false })] }));
  assertEquals(r.severity, "critical");
  assert(r.findings.some((f) => f.detail.includes("NOT blocking")));
});

Deno.test("80% of a cap is a warning, 79% is not", () => {
  assertEquals(triage(base({ spend: [cap({ pct_daily: 80 })] })).severity, "warning");
  assertEquals(triage(base({ spend: [cap({ pct_daily: 79 })] })).severity, "ok");
});

Deno.test("a disabled cap is reported every run even when spend is zero", () => {
  // A standing exposure, not an event. Nothing else would ever surface it.
  const r = triage(base({ spend: [cap({ enabled: false, pct_daily: 0 })] }));
  assertEquals(r.severity, "warning");
  assert(r.findings.some((f) => f.detail.includes("no ceiling")));
});

Deno.test("hard stop switched off is a standing notice on its own", () => {
  const r = triage(base({ spend: [cap({ hard_stop: false, pct_daily: 0 })] }));
  assertEquals(r.severity, "notice");
});

Deno.test("five high-severity security events in a day is critical, one is a warning", () => {
  assertEquals(triage(base({ security: { last_24h: 9, high_24h: 5, recent: [] } })).severity, "critical");
  assertEquals(triage(base({ security: { last_24h: 2, high_24h: 1, recent: [] } })).severity, "warning");
});

Deno.test("a spend cap edit is always surfaced, at notice level", () => {
  const r = triage(base({
    security: { last_24h: 1, high_24h: 0, recent: [{ kind: "spend_cap_changed", severity: "high", actor: "u" }] },
  }));
  assertEquals(r.severity, "notice");
  assert(r.findings.some((f) => f.subject === "Spend caps edited"));
});

Deno.test("severity is the worst finding, not the last one", () => {
  const r = triage(base({
    engines: [engine({ status: "stalled", critical: true }), engine({ key: "b", status: "unknown" })],
    spend: [cap({ hard_stop: false })],
  }));
  assertEquals(r.severity, "critical");
});

Deno.test("the headline names the worst thing and counts the rest at that level", () => {
  const r = triage(base({
    engines: [
      engine({ key: "a", label: "Axiz", status: "stalled", critical: true, minutes_silent: 120 }),
      engine({ key: "b", label: "Courier", status: "failing", critical: true }),
    ],
  }));
  const h = headlineFor(r.severity, r.findings);
  assert(h.startsWith("Axiz:"), h);
  assert(h.includes("+1 more"), h);
});

Deno.test("missing sections are tolerated rather than throwing", () => {
  // The snapshot RPC returns [] for empty sections, but a partially applied
  // migration could return fewer keys. A monitor that crashes on odd input is
  // a monitor that is off.
  // deno-lint-ignore no-explicit-any
  const r = triage({ generated_at: "x" } as any);
  assertEquals(r.severity, "ok");
});

const threats = (over: Record<string, unknown> = {}) => ({
  active_blocks: 0, blocked_24h: 0, suspicious_24h: 0, quarantined_24h: 0, ...over,
// deno-lint-ignore no-explicit-any
}) as any;

Deno.test("a quarantined submission always produces a finding", () => {
  // The only thing standing between a false positive and a silently lost
  // customer. The sender was told nothing and nothing else logs it.
  const r = triage(base({ threats: threats({ quarantined_24h: 1 }) }));
  assertEquals(r.severity, "notice");
  assert(r.findings.some((f) => f.subject === "Quarantined submissions"), JSON.stringify(r.findings));
});

Deno.test("ten blocked sources in a day is a campaign, nine is weather", () => {
  assertEquals(triage(base({ threats: threats({ blocked_24h: 10 }) })).severity, "warning");
  assertEquals(triage(base({ threats: threats({ blocked_24h: 9 }) })).severity, "ok");
});

Deno.test("a snapshot with no threats section still grades cleanly", () => {
  // The threat migration can land after the analyst deploys. A monitor that
  // throws on a field it has not met yet is a monitor that is off.
  assertEquals(triage(base()).severity, "ok");
});
