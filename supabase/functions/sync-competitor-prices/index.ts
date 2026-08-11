import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthContext } from "../_shared/auth-guard.ts";
import { withRetry } from "../_shared/retry.ts";
import { startRun, finishRun, deriveRunStatus } from "../_shared/run-log.ts";
import { checkAndAlertOnFailureStreak } from "../_shared/alerts.ts";

// Daily competitor price watch, via SerpAPI's Google Shopping engine
// (gl=za) -- not a direct scrape of individual SA retailers. Direct
// scraping is exactly what kept failing elsewhere in this store's build
// (bot-blocked, JS-rendered prices, ToS risk); SerpAPI already deals with
// all of that and returns clean, parsed shopping results.
//
// This function only ever writes to `competitor_prices`. It never touches
// `products.price` itself -- that's a deliberate, separate admin action
// (admin_apply_competitor_price) taken from the Sourcing & Pricing screen
// after a human has actually looked at the suggested number.
//
// SerpAPI's free tier is 100 searches/month, shared across everything on
// the account, so the watchlist is opt-in per product (products.
// track_competitors) rather than every active product, and this function
// tracks its own spend against a configurable monthly budget rather than
// trusting SerpAPI's own quota error to catch it after the fact.

const DEFAULT_MONTHLY_BUDGET = 90; // leaves ~10/month of headroom under the free tier's 100
const MAX_PRODUCTS_PER_RUN = 5; // daily cron: 5/day keeps a full month comfortably under budget
const SERPAPI_TIMEOUT_MS = 10_000;

interface ShoppingResult {
  source?: string;
  price?: string;
  extracted_price?: number;
  link?: string;
}

async function getSetting(supabase: any, key: string): Promise<string> {
  const { data } = await supabase.from("store_settings").select("value").eq("key", key).maybeSingle();
  return ((data?.value as string) ?? "").trim();
}

/** A match is only useful if it's a plausible price for the same item, not
 *  a bundle, an accessory, or a completely different product Google Shopping
 *  loosely matched on keywords. 0.15x-6x our own listed price is generous
 *  enough to catch real discounting/markup spread while still rejecting the
 *  obviously-wrong matches that would otherwise wreck the suggested average. */
function isPlausibleMatch(price: number, ourPrice: number): boolean {
  if (!Number.isFinite(price) || price <= 0) return false;
  if (!Number.isFinite(ourPrice) || ourPrice <= 0) return true;
  return price >= ourPrice * 0.15 && price <= ourPrice * 6;
}

async function searchOne(query: string, apiKey: string): Promise<ShoppingResult[]> {
  const url = `https://serpapi.com/search.json?engine=google_shopping&q=${encodeURIComponent(query)}&gl=za&hl=en&num=20&api_key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERPAPI_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
    const data = await res.json();
    if (data?.error) throw new Error(String(data.error));
    return Array.isArray(data?.shopping_results) ? data.shopping_results : [];
  } finally {
    clearTimeout(timer);
  }
}

const handler = async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const internalSecret = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const isInternal =
    (internalSecret.length > 0 && providedSecret === internalSecret) ||
    (serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`);
  if (!isInternal) {
    const auth = await getAuthContext(req);
    if (!auth.userId || !auth.isAdmin) {
      return new Response(JSON.stringify({ error: "Admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const run = await startRun(supabase, "sync-competitor-prices");

  // store_settings (Credential vault) first -- see axiz-sync's comment on
  // the same precedence bug: a stale Deno secret must never silently
  // override what the admin actually entered in Settings.
  const apiKey = (await getSetting(supabase, "serpapi_key")) || Deno.env.get("SERPAPI_KEY") || "";
  if (!apiKey) {
    const msg = "SERPAPI_KEY not configured (set it in Admin -> Sourcing & Pricing or as an edge function secret)";
    await finishRun(supabase, run, { status: "failed", items_synced: 0, items_failed: 0, error_details: msg });
    await checkAndAlertOnFailureStreak(supabase, "sync-competitor-prices").catch((e) =>
      console.error("[sync-competitor-prices] alert check failed:", (e as Error).message),
    );
    return new Response(JSON.stringify({ error: msg }), {
      status: 200, // Not a 500: this is a configuration gap, not a runtime failure -- matches the fail-open stance elsewhere (a missing key must never look like the site itself is broken).
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const budgetSetting = await getSetting(supabase, "serpapi_monthly_budget");
  const monthlyBudget = Number(budgetSetting) > 0 ? Number(budgetSetting) : DEFAULT_MONTHLY_BUDGET;

  const { data: usedRows } = await supabase
    .from("sync_logs")
    .select("items_synced")
    .eq("source", "sync-competitor-prices")
    .gte("started_at", monthStart.toISOString());
  const usedThisMonth = (usedRows ?? []).reduce((sum: number, r: any) => sum + (r.items_synced ?? 0), 0);
  const remaining = monthlyBudget - usedThisMonth;

  if (remaining <= 0) {
    await finishRun(supabase, run, {
      status: "success",
      items_synced: 0,
      items_failed: 0,
      error_details: `Monthly SerpAPI budget (${monthlyBudget}) already used this month -- resuming next month.`,
    });
    return new Response(JSON.stringify({ ok: true, skipped: "monthly_budget_exhausted", usedThisMonth, monthlyBudget }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const batchSize = Math.max(0, Math.min(MAX_PRODUCTS_PER_RUN, remaining));

  const { data: watched, error: watchError } = await supabase
    .from("products")
    .select("id, name, brand, price")
    .eq("track_competitors", true)
    .eq("is_active", true)
    .order("competitor_last_checked", { ascending: true, nullsFirst: true })
    .limit(batchSize);

  if (watchError) {
    await finishRun(supabase, run, { status: "failed", items_synced: 0, items_failed: 1, error_details: watchError.message });
    await checkAndAlertOnFailureStreak(supabase, "sync-competitor-prices").catch(() => {});
    return new Response(JSON.stringify({ error: watchError.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!watched || watched.length === 0) {
    await finishRun(supabase, run, { status: "success", items_synced: 0, items_failed: 0 });
    return new Response(JSON.stringify({ ok: true, watched: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let searchesUsed = 0;
  let failures = 0;
  let rowsInserted = 0;
  let lastError: string | null = null;

  for (const product of watched) {
    const query = `${product.brand ?? ""} ${product.name ?? ""}`.trim().slice(0, 120);
    searchesUsed++;
    try {
      const results = await withRetry(() => searchOne(query, apiKey), {
        retries: 1,
        onRetry: (n, e) => console.warn(`[sync-competitor-prices] retry ${n} for "${query}":`, (e as Error).message),
      });

      const rows = results
        .filter((r) => typeof r.extracted_price === "number" && isPlausibleMatch(r.extracted_price!, Number(product.price)))
        .slice(0, 10)
        .map((r) => ({
          product_id: product.id,
          competitor_name: (r.source ?? "Unknown").slice(0, 128),
          price: r.extracted_price!,
          currency: "ZAR",
          source_url: r.link ?? null,
        }));

      if (rows.length > 0) {
        const { error: insertError } = await supabase.from("competitor_prices").insert(rows);
        if (insertError) throw new Error(insertError.message);
        rowsInserted += rows.length;
      }
    } catch (e) {
      failures++;
      lastError = (e as Error).message;
      console.error(`[sync-competitor-prices] "${query}" failed:`, lastError);
    } finally {
      // Rotate this product to the back of the queue regardless of outcome
      // -- a permanently-bad query shouldn't burn the whole month's budget
      // retrying it every single day ahead of everything else on the list.
      await supabase.from("products").update({ competitor_last_checked: new Date().toISOString() }).eq("id", product.id);
    }
  }

  const status = deriveRunStatus(searchesUsed - failures, failures);
  await finishRun(supabase, run, {
    status,
    items_synced: searchesUsed,
    items_failed: failures,
    error_details: lastError,
  });

  if (status === "failed") {
    await checkAndAlertOnFailureStreak(supabase, "sync-competitor-prices").catch((e) =>
      console.error("[sync-competitor-prices] alert check failed:", (e as Error).message),
    );
  }

  return new Response(JSON.stringify({
    ok: true, watched: watched.length, searchesUsed, failures, rowsInserted,
    budgetRemainingAfterRun: Math.max(0, remaining - searchesUsed),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
};

if (import.meta.main) Deno.serve(handler);
