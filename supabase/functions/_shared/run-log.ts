// Wraps the existing `sync_logs` table (already used by axiz-sync /
// validate-product-images -- see SyncLogsModule.tsx) so sync-ai-pulse,
// cleanup-blocked-products and sync-courier-tracking get the same "one row
// per run" history the admin dashboard reads from. Same table, same
// columns (source, status, items_synced, items_failed, error_details,
// started_at, completed_at) -- no new migration needed.

export type RunHandle = { id: string };

export async function startRun(supabase: any, source: string): Promise<RunHandle> {
  const { data, error } = await supabase
    .from("sync_logs")
    .insert({ source, status: "running", started_at: new Date().toISOString() })
    .select("id")
    .single();
  if (error || !data) {
    // Run-logging must never take down the actual sync. Callers get back
    // an empty id, and finishRun() below silently no-ops on it.
    console.error(`[run-log] failed to start run for ${source}:`, error?.message);
    return { id: "" };
  }
  return { id: data.id };
}

export type RunOutcome = {
  status: "success" | "partial" | "failed";
  items_synced?: number;
  items_failed?: number;
  error_details?: string | null;
};

/**
 * Shared success/partial/failed classification for edge functions that
 * pull from multiple independent sources per run (sync-ai-pulse's
 * arxiv/hn/local feeds, sync-courier-tracking's tracking-lookup + email
 * phases): zero failures is a clean success, some failures alongside some
 * successes is a partial run, and failures with nothing synced is a
 * genuine failure worth counting toward an alert streak.
 */
export function deriveRunStatus(itemsSynced: number, itemsFailed: number): "success" | "partial" | "failed" {
  if (itemsFailed === 0) return "success";
  return itemsSynced > 0 ? "partial" : "failed";
}

export async function finishRun(supabase: any, run: RunHandle, outcome: RunOutcome): Promise<void> {
  if (!run.id) return;
  const { error } = await supabase
    .from("sync_logs")
    .update({
      status: outcome.status,
      items_synced: outcome.items_synced ?? 0,
      items_failed: outcome.items_failed ?? 0,
      error_details: outcome.error_details ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", run.id);
  if (error) console.error(`[run-log] failed to finish run ${run.id}:`, error.message);
}
