import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkAndAlertOnFailureStreak, DEFAULT_FAILURE_THRESHOLD } from "./alerts.ts";

// RESEND_API_KEY / SLACK_WEBHOOK_URL are intentionally left unset in this
// test environment -- checkAndAlertOnFailureStreak() must degrade
// gracefully (skip the actual send, still record the alert_sent event)
// rather than throwing or making a real network call.

const failedRun = (id: string, started_at: string) => ({ id, status: "failed", started_at, error_details: "boom" });
const successRun = (id: string, started_at: string) => ({ id, status: "success", started_at, error_details: null });

function makeMockSupabase(
  opts: { syncLogs?: any[]; alreadyAlerted?: any | null; notificationEmail?: string | null } = {},
) {
  const inserted: any[] = [];
  const syncLogs = opts.syncLogs ?? [];
  const alreadyAlerted = opts.alreadyAlerted ?? null;
  const notificationEmail = opts.notificationEmail ?? null;

  return {
    inserted,
    from(table: string) {
      if (table === "sync_logs") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async (_n: number) => ({ data: syncLogs, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "store_settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: notificationEmail ? { value: notificationEmail } : null, error: null }),
            }),
          }),
        };
      }
      if (table === "automation_events") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: alreadyAlerted, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: (obj: any) => {
            inserted.push(obj);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table in mock: ${table}`);
    },
  };
}

Deno.test("DEFAULT_FAILURE_THRESHOLD is 3", () => {
  assertEquals(DEFAULT_FAILURE_THRESHOLD, 3);
});

Deno.test("does not alert when fewer runs exist than the threshold", async () => {
  const supabase = makeMockSupabase({
    syncLogs: [failedRun("2", "2026-01-01T00:01:00Z"), failedRun("1", "2026-01-01T00:00:00Z")],
  });
  await checkAndAlertOnFailureStreak(supabase, "sync-ai-pulse", 3);
  assertEquals(supabase.inserted.length, 0);
});

Deno.test("does not alert when the most recent runs are not all failures", async () => {
  const supabase = makeMockSupabase({
    syncLogs: [successRun("3", "t3"), failedRun("2", "t2"), failedRun("1", "t1")],
  });
  await checkAndAlertOnFailureStreak(supabase, "sync-ai-pulse", 3);
  assertEquals(supabase.inserted.length, 0);
});

Deno.test("alerts exactly once when the threshold consecutive failures is reached", async () => {
  const supabase = makeMockSupabase({
    syncLogs: [failedRun("3", "t3"), failedRun("2", "t2"), failedRun("1", "t1")],
    alreadyAlerted: null,
  });
  await checkAndAlertOnFailureStreak(supabase, "sync-ai-pulse", 3);
  assertEquals(supabase.inserted.length, 1);
  assertEquals(supabase.inserted[0].event_type, "alert_sent");
  assertEquals(supabase.inserted[0].source, "sync-ai-pulse");
  assertEquals(supabase.inserted[0].payload.threshold, 3);
  assertEquals(supabase.inserted[0].payload.emailSent, false);
  assertEquals(supabase.inserted[0].payload.slackSent, false);
});

Deno.test("does not re-alert when an alert was already sent for this failure streak", async () => {
  const supabase = makeMockSupabase({
    syncLogs: [failedRun("3", "t3"), failedRun("2", "t2"), failedRun("1", "t1")],
    alreadyAlerted: { id: "alert-1" },
  });
  await checkAndAlertOnFailureStreak(supabase, "sync-ai-pulse", 3);
  assertEquals(supabase.inserted.length, 0);
});

Deno.test("respects a custom threshold", async () => {
  const supabase = makeMockSupabase({
    syncLogs: [failedRun("2", "t2"), failedRun("1", "t1")],
  });
  await checkAndAlertOnFailureStreak(supabase, "cleanup-blocked-products", 2);
  assertEquals(supabase.inserted.length, 1);
});
