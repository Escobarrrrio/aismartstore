
# 4-Day Launch Plan — Products Page Overhaul + Deployment Readiness

Your DB currently has **153,176 total products, 88,111 active** (35% inactive — mostly blocked images or missing categories). The catalogue is real, but the products page only shows a slice because ~14k active products have **no category** and the current UI hides everything without a category chip. That's the main "products missing" symptom you're seeing.

Below is what needs to happen to ship confidently on day 4, and how I'll rebuild the products page to Takealot/Amazon standards.

---

## Part A — What "deploy-ready" means for this project

### A1. Catalogue integrity (blocker)
- Backfill `category` for the ~14k uncategorised active products via `recategorize_batch()` until zero remain.
- Refresh `product_facets_cache` after backfill so counts match reality.
- Run image blocklist sweep (`deactivate_blocked_products`) so no broken images ship.
- Verify Axiz sync ran in the last 24h; add a launch-day forced re-sync.

### A2. Payments (blocker)
- Confirm Yoco live keys in Cloud secrets (not test mode).
- Smoke-test one real R1 checkout end-to-end on the published site.
- Confirm `notify-order` fires and reaches your inbox.

### A3. Legal / trust (blocker for ZA launch)
- POPIA & PAIA pages already exist — verify links from footer + checkout.
- Cookie/consent banner present on first visit.
- Business signup + quote flow tested end-to-end.

### A4. Performance & SEO (soft blocker)
- Sitemap regenerated at build (already wired) — verify on live.
- Lighthouse pass ≥ 90 for Performance / Accessibility / SEO on `/`, `/products`, `/product/:id`.
- Product images lazy-loaded; hero above-fold LCP under 2.5s.

### A5. Ops & observability
- Order email → owner working (already built).
- Admin dashboard shows real orders + sync logs.
- Rate-limit + honeypot on business signup verified.
- Backups: Cloud snapshots enabled (default on).

### A6. Automated checks in CI
- Playwright E2E: order flow, filter/pagination, business signup, compliance access.
- Accessibility contrast scan (just added).
- CI must be green before publish.

---

## Part B — Products page rebuild (Takealot + Amazon patterns)

### B1. Fix "products missing"
- Modify `search_products` RPC so uncategorised items still appear when no category filter is active (they do now, but the frontend filter chip strip hides them behind category tabs — I'll remove that gating).
- Server-side count: return **true total** from RPC (already returned via `total_count`); surface it as "88,111 products" at the top so users trust the catalogue depth.

### B2. Left-rail faceted filter (Takealot-style)
Sticky sidebar (desktop) / bottom sheet (mobile, already built) with:
- **Category tree** — collapsible, top 8 shown + "Show more (n)". Multi-select.
- **Brand** — searchable list, top 10 + "Show more". Multi-select with live counts.
- **Price** — histogram slider (R min → R max) with numeric inputs.
- **Availability** — In stock only toggle.
- **AI-only** toggle (your differentiator).
- **Rating** (once reviews exist — stub with "Coming soon" for now).
- **Active-filter chips** row above the grid with individual × and "Clear all".

### B3. Amazon-grade grid & sort
- Sort dropdown: Featured / Price ↑ / Price ↓ / Newest / Name A–Z.
- View toggle: Grid (4-col desktop, 2-col mobile) / List (Amazon-style rich rows with description + specs).
- Density: consistent aspect-ratio image tiles — kill the "empty space" issue with a proper CSS grid using `auto-fill, minmax(240px, 1fr)`.
- Infinite scroll with a "Load more" button fallback (Takealot uses both — better SEO than pure infinite).
- Skeleton loaders (already partly there) refined to match final card shape.

### B4. Card polish
- Square image, brand pill, name (2-line clamp), price, "In stock" chip, "Add to cart" quick action on hover (desktop), stock ETA line.
- Wishlist heart (already have `wishlist_items` table).

### B5. Search UX
- URL-synced query params for **every** filter so results are shareable/back-button safe (already partial — extend to brand, price, sort).
- Suggested searches under the search bar when empty.
- "No results" state with cleared-filter suggestions.

### B6. Prefetch & perf
- Prefetch next page on scroll to 70% (already implemented — verify with the new grid).
- Image `srcset` for retina; blur-up placeholder.
- Virtualise only if a page exceeds 96 cards (default 48/page).

---

## Part C — 4-day execution schedule

```
Day 1 (today) — Catalogue backfill + products page rebuild (Part B1–B4)
Day 2         — Filters + sort + URL sync + mobile sheet parity (B2, B3, B5)
Day 3         — Payments smoke test, order email test, SEO/Lighthouse pass, CI green
Day 4 AM      — Final content review, legal links, custom domain check
Day 4 PM      — Publish
```

---

## Part D — What I'll do first (once you approve)

1. Run the category backfill migration (batches of 3k until zero uncategorised remain), then refresh facets.
2. Rebuild `src/pages/Products.tsx` around a real faceted layout (sticky left rail on desktop, sheet on mobile).
3. Rework `ProductCard.tsx` for the Amazon-style grid/list dual mode.
4. Wire every filter into URL params and the RPC.
5. Add a "Showing X of 88,111" trust bar at the top.
6. Ship, then move to Part A blockers on Day 2–3.

Approve this plan and I'll start with the catalogue backfill + Products.tsx rebuild in the same pass.
