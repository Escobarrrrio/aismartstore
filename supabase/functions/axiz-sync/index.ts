import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =====================================================================
// Axiz catalog sync -- LIVE INTEGRATION
// Auth: OAuth2 client_credentials against identity.goaxiz.co.za
// Catalog: POST /api/services/app/PriceList/SearchPriceList (paginated)
// =====================================================================

const AXIZ_TOKEN_URL = "https://identity.goaxiz.co.za/connect/token";
const AXIZ_API_BASE = "https://api.goaxiz.co.za";
const PAGE_SIZE = 1000;
const MAX_PAGES_SAFETY_CAP = 50; // stop after 50k items even if something's wrong

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

async function getAxizToken(clientId: string, clientSecret: string, scope: string): Promise<string> {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(AXIZ_TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });

  if (!res.ok) {
    throw new Error(`Axiz token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Axiz token response had no access_token");
  }
  return data.access_token as string;
}

async function fetchAxizCatalog(
  accessToken: string,
  markets: number[],
  brandFilter: number[] = []
): Promise<RawAxizProduct[]> {
  const allItems: RawAxizProduct[] = [];

  for (const market of markets) {
    let pageIndex = 0;
    let keepGoing = true;

    while (keepGoing && pageIndex < MAX_PAGES_SAFETY_CAP) {
      const res = await fetch(`${AXIZ_API_BASE}/api/services/app/PriceList/SearchPriceList`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          maxResultCount: PAGE_SIZE,
          pageIndex,
          market,
          brandFilter,
        }),
      });

      if (!res.ok) {
        throw new Error(`Axiz PriceList call failed (market ${market}, page ${pageIndex}): ${res.status} ${await res.text()}`);
      }

      const data = await res.json();
      const items = data?.result?.items ?? data?.result ?? [];

      for (const item of items) {
        if (!item.productCode) continue;
        allItems.push({
          sku: String(item.productCode),
          name: item.productDescription || item.productCode,
          description: item.productDescription,
          cost_price: Number(item.price ?? 0),
          category: item.productCategory,
          brand: item.brand?.brandName,
          stock_quantity: Number(item.onHand ?? 0),
          images: item.imageGallery ? [item.imageGallery].flat() : [],
        });
      }

      keepGoing = items.length === PAGE_SIZE;
      pageIndex++;
    }
  }

  return allItems;
}

function slugify(name: string, sku: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base}-${sku.toLowerCase()}`.slice(0, 120);
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
    const clientId = Deno.env.get("AXIZ_CLIENT_ID");
    const clientSecret = Deno.env.get("AXIZ_CLIENT_SECRET");
    const scope = Deno.env.get("AXIZ_SCOPE");

    if (!clientId || !clientSecret || !scope) {
      await supabase
        .from("sync_logs")
        .update({
          status: "skipped",
          items_synced: 0,
          items_failed: 0,
          error_details: "AXIZ_CLIENT_ID / AXIZ_CLIENT_SECRET / AXIZ_SCOPE not set as Supabase Edge Function secrets.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", logRow.id);
      return new Response(JSON.stringify({ status: "skipped", reason: "credentials not configured" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: settingsRows } = await supabase
      .from("store_settings")
      .select("key, value")
      .in("key", ["axiz_markup_pct", "axiz_markets", "axiz_brand_filter"]);

    const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));
    const markupPct = Number(settings.axiz_markup_pct || "26");
    // Default: 14 = General Store/Hardware Market. Add more via store_settings
    // "axiz_markets" as comma-separated enum IDs, e.g. "14,2,4" once you know
    // which additional Axiz markets (Microsoft=2, Cisco=4, HP=15, Adobe=16, Redhat=17) you want.
    const markets = (settings.axiz_markets || "14").split(",").map((m) => Number(m.trim()));
    const brandFilter = settings.axiz_brand_filter
      ? settings.axiz_brand_filter.split(",").map((b) => Number(b.trim()))
      : [];

    const accessToken = await getAxizToken(clientId, clientSecret, scope);
    const catalog = await fetchAxizCatalog(accessToken, markets, brandFilter);

    let synced = 0;
    let failed = 0;

    for (const item of catalog) {
      const sellingPrice = item.cost_price * (1 + markupPct / 100);

      const { data: product, error: productError } = await supabase
        .from("products")
        .upsert(
          {
            sku: item.sku,
            slug: slugify(item.name, item.sku),
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
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "sku" }
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

    // Mark products that disappeared from this sync as inactive (non-destructive)
    const syncedSkus = catalog.map((c) => c.sku);
    if (syncedSkus.length > 0) {
      await supabase
        .from("products")
        .update({ is_active: false })
        .not("sku", "in", `(${syncedSkus.map((s) => `"${s}"`).join(",")})`)
        .not("sku", "is", null);
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
