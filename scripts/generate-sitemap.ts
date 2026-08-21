// Runs before `vite dev` and `vite build` (predev/prebuild hooks); writes public/sitemap.xml.
// Pulls active products from the live database so /product/:id routes are discoverable.
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

// Only publicly indexable routes belong here. /cart, /checkout, /account,
// /auth and /orders/:id are all Disallow-ed in public/robots.txt, and listing
// a disallowed URL in the sitemap is a self-contradiction Search Console
// reports as "Submitted URL blocked by robots.txt" — it wastes crawl budget
// and drags down the sitemap's overall status.
const staticEntries: Entry[] = [
  { path: "/", changefreq: "daily", priority: "1.0" },
  { path: "/products", changefreq: "daily", priority: "0.9" },
  { path: "/ai-pulse", changefreq: "weekly", priority: "0.7" },
  { path: "/about", changefreq: "monthly", priority: "0.7" },
  { path: "/contact", changefreq: "monthly", priority: "0.8" },
  { path: "/vision", changefreq: "monthly", priority: "0.5" },
  { path: "/mission", changefreq: "monthly", priority: "0.5" },
  { path: "/procurement", changefreq: "monthly", priority: "0.6" },
  { path: "/compliance", changefreq: "monthly", priority: "0.3" },
  { path: "/shipping-returns", changefreq: "monthly", priority: "0.4" },
  { path: "/terms", changefreq: "monthly", priority: "0.2" },
  { path: "/cookies", changefreq: "monthly", priority: "0.2" },
]



const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

async function fetchProducts(): Promise<Entry[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn("[sitemap] VITE_SUPABASE_* env vars missing — skipping product entries.")
    return []
  }
  // Paginated with Range headers, NOT `limit`.
  //
  // `limit=45000` looked like it worked and silently produced a 1 000-entry
  // sitemap against 3 488 active products, because PostgREST clamps every
  // response to its `db-max-rows` ceiling (1 000 by default) no matter what
  // `limit` asks for. 2 488 product pages were therefore never submitted to
  // Google. Ranged requests are the documented way past that ceiling, and the
  // loop stops as soon as a page comes back short.
  const PAGE = 1000
  const rows: Array<{ id: string; updated_at: string }> = []
  try {
    for (let from = 0; from < MAX_PRODUCTS; from += PAGE) {
      const to = Math.min(from + PAGE, MAX_PRODUCTS) - 1
      const url =
        `${SUPABASE_URL}/rest/v1/products` +
        `?select=id,updated_at&is_active=eq.true&order=updated_at.desc,id.asc`
      const res = await fetch(url, {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Range: `${from}-${to}`,
          "Range-Unit": "items",
        },
      })
      if (!res.ok) {
        console.warn(`[sitemap] product fetch failed at offset ${from}: ${res.status}`)
        break
      }
      const page = (await res.json()) as Array<{ id: string; updated_at: string }>
      rows.push(...page)
      // A short page means we've reached the end. Without this the loop would
      // keep requesting empty ranges up to MAX_PRODUCTS.
      if (page.length < PAGE) break
    }
  } catch (e) {
    console.warn("[sitemap] product fetch error:", (e as Error).message)
  }

  // `id.asc` is the tiebreaker above because paging over a non-unique sort key
  // is not stable: two products sharing an `updated_at` could otherwise appear
  // on both sides of a page boundary, duplicating one URL and dropping another.
  // Belt and braces, since a duplicate <loc> is a crawl-budget waste.
  const seen = new Set<string>()
  return rows
    .filter((r) => r.id && !seen.has(r.id) && (seen.add(r.id), true))
    .map((r) => ({
      path: `/product/${r.id}`,
      lastmod: r.updated_at ? new Date(r.updated_at).toISOString().split("T")[0] : undefined,
      changefreq: "weekly" as const,
      priority: "0.8",
    }))
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
