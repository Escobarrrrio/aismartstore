// Validates product image URLs via HEAD checks and deactivates products
// whose image URLs all 404 (or otherwise fail). Runs in bounded batches so a
// single invocation never exceeds the edge-function idle timeout; a cursor in
// store_settings.image_validation_cursor lets the admin UI loop to completion.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAuthContext } from "../_shared/auth-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

const BATCH_SIZE = 1200;   // products per invocation
const CONCURRENCY = 24;    // parallel HEAD requests
const HEAD_TIMEOUT_MS = 6000;

async function headOk(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
    let res = await fetch(url, { method: "HEAD", signal: ctrl.signal, redirect: "follow" });
    // Some CDNs (Azure blob) return 405 for HEAD but 200 for GET-range.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: ctrl.signal,
        redirect: "follow",
      });
    }
    clearTimeout(t);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Auth: admin OR internal cron secret (matches axiz-sync).
  const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const isInternal = internalSecret.length > 0 && providedSecret === internalSecret;
  if (!isInternal) {
    const auth = await getAuthContext(req);
    if (!auth.userId || !auth.isAdmin) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const body = await req.json().catch(() => ({}));
  const reset: boolean = body?.reset === true;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Load / initialise cursor
  const { data: cursorRow } = await supabase
    .from("store_settings")
    .select("value")
    .eq("key", "image_validation_cursor")
    .maybeSingle();
  let cursor = reset ? "" : (cursorRow?.value ?? "");

  // Start a run row so progress is visible in Sync Logs
  const { data: logRow } = await supabase
    .from("sync_logs")
    .insert({
      source: "image_validation",
      status: "running",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  try {
    // Fetch a bounded batch of active products past the cursor
    let q = supabase
      .from("products")
      .select("id, images")
      .eq("is_active", true)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);
    if (cursor) q = q.gt("id", cursor);

    const { data: products, error } = await q;
    if (error) throw error;

    const rows = products ?? [];
    let checked = 0;
    let deactivated = 0;
    const badIds: string[] = [];

    // For each product: consider it broken when NO image URL resolves.
    // Products with an empty images array are already handled by the sync
    // guardrail (is_active=false), so we won't see them here.
    for (const p of rows) {
      const urls: string[] = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
      if (urls.length === 0) {
        badIds.push(p.id);
        continue;
      }
      checked++;
      // Short-circuit: as soon as one URL is OK, keep the product.
      let ok = false;
      const results = await mapWithConcurrency(urls, Math.min(CONCURRENCY, urls.length), headOk);
      ok = results.some(Boolean);
      if (!ok) badIds.push(p.id);
    }

    // Deactivate broken products in chunks
    for (let i = 0; i < badIds.length; i += 200) {
      const slice = badIds.slice(i, i + 200);
      const { error: uErr } = await supabase
        .from("products")
        .update({ is_active: false })
        .in("id", slice);
      if (!uErr) deactivated += slice.length;
    }

    const done = rows.length < BATCH_SIZE;
    const nextCursor = done ? "" : rows[rows.length - 1].id;

    await supabase.from("store_settings").upsert(
      { key: "image_validation_cursor", value: nextCursor, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

    await supabase.from("sync_logs").update({
      status: "success",
      items_synced: checked,
      items_failed: deactivated,
      error_details: done
        ? `image_validation complete | checked ${checked} | deactivated ${deactivated}`
        : `image_validation batch | checked ${checked} | deactivated ${deactivated} | next cursor ${nextCursor}`,
      completed_at: new Date().toISOString(),
    }).eq("id", logRow.id);

    return new Response(
      JSON.stringify({ status: "ok", done, checked, deactivated, nextCursor, batchSize: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    await supabase.from("sync_logs").update({
      status: "error",
      error_details: `image_validation: ${(e as Error).message}`,
      completed_at: new Date().toISOString(),
    }).eq("id", logRow.id);
    return new Response(JSON.stringify({ status: "error", message: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
