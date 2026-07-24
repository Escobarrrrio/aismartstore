import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { startRun, finishRun, deriveRunStatus } from "./run-log.ts";

function makeMockSupabase(
  opts: { insertResult?: { data: any; error: any }; updateResult?: { error: any } } = {},
) {
  const calls: { type: "insert" | "update"; table: string; obj: any }[] = [];
  const insertResult = opts.insertResult ?? { data: { id: "run-123" }, error: null };
  const updateResult = opts.updateResult ?? { error: null };
  return {
    calls,
    from(table: string) {
      return {
        insert(obj: any) {
          calls.push({ type: "insert", table, obj });
          return { select: (_cols: string) => ({ single: async () => insertResult }) };
        },
        update(obj: any) {
          calls.push({ type: "update", table, obj });
          return { eq: async (_col: string, _val: string) => updateResult };
        },
      };
    },
  };
}

Deno.test("startRun inserts a running row into sync_logs and returns its id", async () => {
  const supabase = makeMockSupabase();
  const run = await startRun(supabase, "sync-ai-pulse");
  assertEquals(run.id, "run-123");
  assertEquals(supabase.calls.length, 1);
  assertEquals(supabase.calls[0].type, "insert");
  assertEquals(supabase.calls[0].table, "sync_logs");
  assertEquals(supabase.calls[0].obj.source, "sync-ai-pulse");
  assertEquals(supabase.calls[0].obj.status, "running");
});

Deno.test("startRun returns an empty-id handle (not a throw) when the insert fails", async () => {
  const supabase = makeMockSupabase({ insertResult: { data: null, error: { message: "db down" } } });
  const run = await startRun(supabase, "sync-ai-pulse");
  assertEquals(run.id, "");
});

Deno.test("finishRun updates the row with the final status and counts", async () => {
  const supabase = makeMockSupabase();
  await finishRun(supabase, { id: "run-123" }, { status: "success", items_synced: 5, items_failed: 0 });
  assertEquals(supabase.calls.length, 1);
  const updateCall = supabase.calls[0];
  assertEquals(updateCall.type, "update");
  assertEquals(updateCall.table, "sync_logs");
  assertEquals(updateCall.obj.status, "success");
  assertEquals(updateCall.obj.items_synced, 5);
  assertEquals(updateCall.obj.items_failed, 0);
});

Deno.test("finishRun defaults items_synced/items_failed to 0 and error_details to null when omitted", async () => {
  const supabase = makeMockSupabase();
  await finishRun(supabase, { id: "run-123" }, { status: "success" });
  const updateCall = supabase.calls[0];
  assertEquals(updateCall.obj.items_synced, 0);
  assertEquals(updateCall.obj.items_failed, 0);
  assertEquals(updateCall.obj.error_details, null);
});

Deno.test("finishRun is a no-op (no DB call) when the run handle has an empty id", async () => {
  const supabase = makeMockSupabase();
  await finishRun(supabase, { id: "" }, { status: "success" });
  assertEquals(supabase.calls.length, 0);
});

Deno.test("deriveRunStatus: zero failures is always success", () => {
  assertEquals(deriveRunStatus(10, 0), "success");
  assertEquals(deriveRunStatus(0, 0), "success");
});

Deno.test("deriveRunStatus: failures alongside successes is partial", () => {
  assertEquals(deriveRunStatus(5, 2), "partial");
  assertEquals(deriveRunStatus(1, 100), "partial");
});

Deno.test("deriveRunStatus: failures with nothing synced is failed", () => {
  assertEquals(deriveRunStatus(0, 3), "failed");
  assertEquals(deriveRunStatus(0, 1), "failed");
});
