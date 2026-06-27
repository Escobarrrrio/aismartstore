import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =====================================================================
// Axiz catalog sync -- BEST-PRACTICE SCAFFOLD, NOT A FINISHED INTEGRATION
//
// Axiz's actual API contract (auth scheme, endpoint paths, response
// schema) isn't documented anywhere available to me, and the FIC
// declaration isn't approved yet -- so there is no real API to call
// against right now. Writing code that *pretends* to know Axiz's API
// shape would be worse than not writing it: it would need a full
// rewrite the moment real docs arrive anyway.
//
// What IS real and correct here: everything except fetchAxizCatalog().
// The upsert logic, markup application, error handling, and sync_logs
// audit trail are all genuinely finished. The moment Axiz issues API
// docs and a key, only fetchAxizCatalog() needs to change -- swap the
// placeholder for a real fetch() call matching their actual spec, and
// this function is live.
//
// Until then, this function checks whether axiz_api_key is configured
// in store_settings and exits cleanly (logged, not silently) if not --
// safe to schedule via pg_cron right now; it will simply no-op and log
// "not configured" every run until the key is set.
// =====================================================================

interface RawAxizProduct {
  sku: string;
  name: string;
  description?: string;
  cost_price: number;
  category?: string;
  brand?: string;
  stock_quantity: number;
  images?: string[];
}

/**
 * THE ONE FUNCTION TO REPLACE once real Axiz API access exists.
 * Should return the full (or incrementally changed) product catalog
 * from Axiz's actual distributor API, using axizApiKey for auth.
 */
async function fetchAxizCatalog(axizApiKey: string): Promise<RawAxizProduct[]> {
  throw new Error(
    "Axiz API integration not yet implemented -- waiting on API documentation " +
    "and credentials from Axiz following FIC declaration approval. " +
    "Replace this function body with a real fetch() against their documented endpoint."
  );
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const startedAt = new Date().toISOString();
  const { data: logRow } = await supabase
    .from("sync_logs")
    .insert({ source: "axiz", status: "running", started_at: startedAt })
    .select()
    .single();

  try {
    const { data: settingsRows } = await supabase
      .from("store_settings")
      .select("key, value")
      .in("key", ["axiz_api_key", "axiz_markup_pct"]);

    const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));
    const axizApiKey = settings.axiz_api_key;
    const markupPct = Number(settings.axiz_markup_pct || "26");

    if (!axizApiKey) {
      await supabase
        .from("sync_logs")
        .update({
          status: "skipped",
          items_synced: 0,
          items_failed: 0,
          error_details: "axiz_api_key not configured in Settings -- nothing to sync yet.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", logRow.id);
      return new Response(JSON.stringify({ status: "skipped", reason: "no API key configured" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const catalog = await fetchAxizCatalog(axizApiKey);

    let synced = 0;
    let failed = 0;

    for (const item of catalog) {
      const sellingPrice = item.cost_price * (1 + markupPct / 100);

      const { data: product, error: productError } = await supabase
        .from("products")
        .upsert(
          {
            name: item.name,
            description: item.description,
            price: sellingPrice,
            category: item.category,
            brand: item.brand,
            stock_quantity: item.stock_quantity,
            stock_status: item.stock_quantity > 0 ? "in_stock" : "out_of_stock",
            in_stock: item.stock_quantity > 0,
            images: item.images || [],
            is_active: true,
          },
          { onConflict: "slug" } // adjust once Axiz's real SKU/slug mapping is known
        )
        .select()
        .single();

      if (productError || !product) {
        failed++;
        continue;
      }

      await supabase.from("product_costs").upsert(
        {
          product_id: product.id,
          cost_price: item.cost_price,
          selling_price: sellingPrice,
          margin_percentage: markupPct,
          axiz_product_id: item.sku,
        },
        { onConflict: "product_id" }
      );

      synced++;
    }

    await supabase
      .from("sync_logs")
      .update({
        status: failed === 0 ? "success" : "partial",
        items_synced: synced,
        items_failed: failed,
        completed_at: new Date().toISOString(),
      })
      .eq("id", logRow.id);

    return new Response(JSON.stringify({ status: "completed", synced, failed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    await supabase
      .from("sync_logs")
      .update({
        status: "error",
        error_details: (e as Error).message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", logRow.id);

    return new Response(JSON.stringify({ status: "error", message: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
