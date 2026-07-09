import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =====================================================================
// Axiz catalog sync -- LIVE INTEGRATION v2
// - OAuth2 client_credentials against identity.goaxiz.co.za
// - POST /api/services/app/PriceList/SearchPriceList (paginated)
// - BATCHED upserts (500/call) so large markets fit in the time limit
// - Per-market error tolerance: one failing market never kills the run
// - AI-related products auto-flagged via is_ai_product
// =====================================================================

const AXIZ_TOKEN_URL = "https://identity.goaxiz.co.za/connect/token";
const AXIZ_API_BASE = "https://api.goaxiz.co.za";
const PAGE_SIZE = 1000;
const MAX_PAGES_SAFETY_CAP = 50;
const UPSERT_BATCH_SIZE = 500;

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
  if (!data.access_token) throw new Error("Axiz token response had no access_token");
  return data.access_token as string;
}

async function fetchMarket(accessToken: string, market: number, brandFilter: number[]): Promise<RawAxizProduct[]> {
  const items: RawAxizProduct[] = [];
  let pageIndex = 0;
  let keepGoing = true;

  while (keepGoing && pageIndex < MAX_PAGES_SAFETY_CAP) {
    const res = await fetch(`${AXIZ_API_BASE}/api/services/app/PriceList/SearchPriceList`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ maxResultCount: PAGE_SIZE, pageIndex, market, brandFilter }),
    });

    if (!res.ok) {
      // Log and stop THIS market only -- other markets continue.
      console.error(`Axiz PriceList failed (market ${market}, page ${pageIndex}): ${res.status}`);
      break;
    }

    const data = await res.json();
    const pageItems = data?.result?.items ?? data?.result ?? [];

    for (const item of pageItems) {
      if (!item.productCode) continue;
      items.push({
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

    keepGoing = pageItems.length === PAGE_SIZE;
    pageIndex++;
  }
  return items;
}

// Word-boundary match: "AI" only as its own token, never inside
// words like "chair", "main", "said".
function isAiRelated(p: RawAxizProduct): boolean {
  const s = `${p.category ?? ""} ${p.brand ?? ""} ${p.name ?? ""} ${p.description ?? ""}`;
  if (/\bAI\b/i.test(s)) return true;
  if (/artificial intelligence/i.test(s)) return true;
  if (/\b(machine learning|neural|edge ai|genai|deep learning)\b/i.test(s)) return true;
  return false;
}

function slugify(name: string, sku: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${base}-${sku.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.slice(0, 120);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: logRow } = await supabase
    .from("sync_logs")
    .insert({ source: "axiz", status: "running", started_at: new Date().toISOString() })
    .select()
    .single();

  try {
    const clientId = Deno.env.get("AXIZ_CLIENT_ID");
    const clientSecret = Deno.env.get("AXIZ_CLIENT_SECRET");
    const scope = Deno.env.get("AXIZ_SCOPE");

    if (!clientId || !clientSecret || !scope) {
      await supabase.from("sync_logs").update({
        status: "skipped",
        error_details: "AXIZ_CLIENT_ID / AXIZ_CLIENT_SECRET / AXIZ_SCOPE not set.",
        completed_at: new Date().toISOString(),
      }).eq("id", logRow.id);
      return new Response(JSON.stringify({ status: "skipped" }), { headers: { "Content-Type": "application/json" } });
    }

    const { data: settingsRows } = await supabase
      .from("store_settings")
      .select("key, value")
      .in("key", ["axiz_markup_pct", "axiz_markets", "axiz_brand_filter"]);

    const settings = Object.fromEntries((settingsRows || []).map((r) => [r.key, r.value]));
    const markupPct = Number(settings.axiz_markup_pct || "26");
    const markets = (settings.axiz_markets || "14").split(",").map((m) => Number(m.trim())).filter((n) => !isNaN(n));
    const brandFilter = (settings.axiz_brand_filter || "").split(",").filter(Boolean).map((b) => Number(b.trim()));

    const accessToken = await getAxizToken(clientId, clientSecret, scope);

    // Fetch all configured markets; failures are per-market, not fatal.
    const marketErrors: string[] = [];
    const bySku = new Map<string, RawAxizProduct>();
    for (const market of markets) {
      try {
        const items = await fetchMarket(accessToken, market, brandFilter);
        for (const it of items) bySku.set(it.sku, it); // de-dupe across markets
      } catch (e) {
        marketErrors.push(`market ${market}: ${(e as Error).message}`);
      }
    }

    const catalog = [...bySku.values()];
    let aiFlagged = 0;

    const productRows = catalog.map((item) => {
      const aiRelated = isAiRelated(item);
      if (aiRelated) aiFlagged++;
      return {
        sku: item.sku,
        slug: slugify(item.name, item.sku),
        name: item.name,
        description: item.description,
        price: item.cost_price * (1 + markupPct / 100),
        category: item.category,
        brand: item.brand,
        stock_quantity: item.stock_quantity,
        stock_status: item.stock_quantity > 0 ? "in_stock" : "out_of_stock",
        in_stock: item.stock_quantity > 0,
        images: item.images || [],
        is_active: true,
        is_ai_product: aiRelated,
        last_synced_at: new Date().toISOString(),
      };
    });

    // BATCHED upserts: ~500 rows per call instead of 1.
    let synced = 0;
    let failed = 0;
    for (const batch of chunk(productRows, UPSERT_BATCH_SIZE)) {
      const { error } = await supabase.from("products").upsert(batch, { onConflict: "sku" });
      if (error) {
        console.error("Batch upsert failed:", error.message);
        failed += batch.length;
      } else {
        synced += batch.length;
      }
    }

    // Batched cost records: map skus to product ids in one query per batch.
    if (synced > 0) {
      const { data: idRows } = await supabase
        .from("products")
        .select("id, sku")
        .not("sku", "is", null);
      const idBySku = new Map((idRows || []).map((r) => [r.sku, r.id]));
      const costRows = catalog
        .filter((c) => idBySku.has(c.sku))
        .map((c) => ({
          product_id: idBySku.get(c.sku),
          cost_price: c.cost_price,
          selling_price: c.cost_price * (1 + markupPct / 100),
          margin_percentage: markupPct,
          axiz_product_id: c.sku,
        }));
      for (const batch of chunk(costRows, UPSERT_BATCH_SIZE)) {
        const { error } = await supabase.from("product_costs").upsert(batch, { onConflict: "product_id" });
        if (error) console.error("Cost batch failed:", error.message);
      }
    }

    // Deactivate synced-source products that vanished from the feed.
    if (catalog.length > 0) {
      await supabase.rpc("deactivate_missing_skus", { active_skus: catalog.map((c) => c.sku) }).then(
        () => {},
        () => {} // rpc may not exist yet; non-fatal
      );
    }

    const errNote = marketErrors.length ? ` | market errors: ${marketErrors.join("; ")}` : "";
    await supabase.from("sync_logs").update({
      status: failed === 0 ? "success" : "partial",
      items_synced: synced,
      items_failed: failed,
      error_details: `AI-flagged: ${aiFlagged}${errNote}`,
      completed_at: new Date().toISOString(),
    }).eq("id", logRow.id);

    return new Response(JSON.stringify({ status: "completed", synced, failed, aiFlagged }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    await supabase.from("sync_logs").update({
      status: "error",
      error_details: (e as Error).message,
      completed_at: new Date().toISOString(),
    }).eq("id", logRow.id);
    return new Response(JSON.stringify({ status: "error", message: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
