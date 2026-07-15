// Runs before `vite dev` and `vite build` (predev/prebuild hooks); writes public/sitemap.xml.
// Pulls active products from the Lovable Cloud database so /product/:id routes are discoverable.
import { writeFileSync } from "fs"
import { resolve } from "path"

const BASE_URL = "https://aismartstore.co.za"
const MAX_PRODUCTS = 45000 // stay under the 50k-per-sitemap protocol cap

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || ""
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || ""

interface Entry {
  path: string
  lastmod?: string
  changefreq?: "daily" | "weekly" | "monthly" | "yearly"
  priority?: string
}

const staticEntries: Entry[] = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/products", changefreq: "daily", priority: "0.9" },
  { path: "/ai-pulse", changefreq: "weekly", priority: "0.7" },
  { path: "/procurement", changefreq: "monthly", priority: "0.6" },
  { path: "/compliance", changefreq: "monthly", priority: "0.3" },
]

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

async function fetchProducts(): Promise<Entry[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[sitemap] VITE_SUPABASE_* env vars missing — skipping product entries.")
    return []
  }
  const url = `${SUPABASE_URL}/rest/v1/products?select=id,updated_at&is_active=eq.true&order=updated_at.desc&limit=${MAX_PRODUCTS}`
  try {
    const res = await fetch(url, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    })
    if (!res.ok) {
      console.warn(`[sitemap] product fetch failed: ${res.status}`)
      return []
    }
    const rows = (await res.json()) as Array<{ id: string; updated_at: string }>
    return rows.map((r) => ({
      path: `/product/${r.id}`,
      lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split("T")[0] : undefined,
      changefreq: "weekly" as const,
      priority: "0.8",
    }))
  } catch (e) {
    console.warn("[sitemap] product fetch error:", (e as Error).message)
    return []
  }
}

function xml(entries: Entry[]) {
  const urls = entries.map((e) =>
    [
      `  <url>`,
      `    <loc>${BASE_URL}${escape(e.path)}</loc>`,
      e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      `  </url>`,
    ].filter(Boolean).join("\n"),
  )
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n")
}

const products = await fetchProducts()
const all = [...staticEntries, ...products]
writeFileSync(resolve("public/sitemap.xml"), xml(all))
console.log(`[sitemap] wrote ${all.length} entries (${products.length} product pages)`)
