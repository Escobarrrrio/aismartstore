/**
 * Deterministic E2E database seed.
 *
 * Runs against the Supabase project defined by the E2E_SUPABASE_URL and
 * E2E_SUPABASE_SERVICE_ROLE_KEY environment variables. The seed uses fixed
 * UUIDs and slugs so every Playwright run sees the exact same data, which
 * lets specs assert on IDs, pagination totals, and search results without
 * flakiness.
 *
 * The seed is idempotent — it upserts by primary key so re-running never
 * duplicates rows. When the env vars are missing (e.g. local dev without the
 * service role key), the seeder exits 0 without touching the database and
 * logs a clear warning so CI does not fail on Lovable Cloud projects where
 * the service role key is intentionally unavailable.
 */

import { createClient } from "@supabase/supabase-js";

export const SEED_TAG = "e2e-fixture";

export const SEED_CATEGORIES = [
  {
    id: "00000000-0000-4000-8000-00000000c001",
    slug: "e2e-ai-hardware",
    name: "E2E AI Hardware",
  },
  {
    id: "00000000-0000-4000-8000-00000000c002",
    slug: "e2e-gov-compliance",
    name: "E2E Government Compliance",
  },
] as const;

export const SEED_PRODUCTS = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    sku: "E2E-AI-0001",
    name: "E2E AI Inference Card",
    price_zar: 12999,
    category_id: SEED_CATEGORIES[0].id,
    is_business_only: false,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    sku: "E2E-AI-0002",
    name: "E2E AI Edge Gateway",
    price_zar: 8499,
    category_id: SEED_CATEGORIES[0].id,
    is_business_only: false,
  },
  {
    id: "00000000-0000-4000-8000-0000000000b1",
    sku: "E2E-GOV-0001",
    name: "E2E Gov Secure Workstation",
    price_zar: 45999,
    category_id: SEED_CATEGORIES[1].id,
    is_business_only: true,
  },
] as const;

export interface SeedResult {
  skipped: boolean;
  reason?: string;
  categories: number;
  products: number;
}

export async function runSeed(): Promise<SeedResult> {
  const url = process.env.E2E_SUPABASE_URL;
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return {
      skipped: true,
      reason:
        "E2E_SUPABASE_URL or E2E_SUPABASE_SERVICE_ROLE_KEY not set — skipping deterministic seed.",
      categories: 0,
      products: 0,
    };
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: catErr } = await admin
    .from("categories")
    .upsert(
      SEED_CATEGORIES.map((c) => ({ ...c, seed_tag: SEED_TAG })),
      { onConflict: "id" },
    );
  if (catErr) throw new Error(`seed categories failed: ${catErr.message}`);

  const { error: prodErr } = await admin
    .from("products")
    .upsert(
      SEED_PRODUCTS.map((p) => ({ ...p, is_active: true, seed_tag: SEED_TAG })),
      { onConflict: "id" },
    );
  if (prodErr) throw new Error(`seed products failed: ${prodErr.message}`);

  return {
    skipped: false,
    categories: SEED_CATEGORIES.length,
    products: SEED_PRODUCTS.length,
  };
}
