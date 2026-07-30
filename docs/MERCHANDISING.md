# Home-page merchandising engine

**Admin → Catalogue → Home Merchandising**

## What it does

It decides which products a residential shopper sees first, and it can explain
every choice.

Before it existed the home page ran `ORDER BY created_at DESC` against the
residential catalogue. That is close to random, and the residential pool is
dominated by exactly what a household shopper never wants:

| Category | Products | Eligible for the home page |
|---|---:|---:|
| Cables & Connectivity | 313 | 4 |
| Accessories (General) | 308 | 10 |
| Support & Warranty | 132 | **0** |
| Servers & Data Centre | 92 | **0** |
| Storage | 69 | 53 |
| Peripherals | 52 | 52 |
| Networking | 36 | 35 |
| Software & Licensing | 28 | **0** |
| Monitors & Displays | 16 | 14 |
| Memory | 12 | 7 |
| Desktops & Workstations | 7 | 7 |
| Printer Consumables | 6 | 6 |
| Smart Home | 4 | 2 |
| GPUs & AI Accelerators | 4 | 1 |
| Laptops | 3 | 2 |
| Wearables | 1 | 1 |
| Health & Wellness | 1 | 0 |

1 084 residential products, of which ~160 are in stock. Date ordering gave a
shop window of rack rails, C13 power cords and QSFP transceivers, most of them
unbuyable. The engine narrows that to **159 genuinely shoppable products** and
ranks them.

## How a product is scored

Seven factors, each 0–100, combined by weight into a single 0–100 score. Each
one is a separate SQL function that can be tested on its own.

| Factor | Default weight | What it measures |
|---|---:|---|
| `merch_demand_tier` | 0.30 | What South African households actually shop for |
| `merch_availability` | 0.18 | Can it be bought and dispatched today |
| `merch_brand_trust` | 0.15 | Consumer brand recognition |
| `merch_price_fit` | 0.15 | Where online conversion actually happens |
| `merch_name_quality` | 0.12 | Readable title vs distributor part number |
| `merch_media_quality` | 0.05 | Real photography, and more than one angle |
| `merch_signal_score` | 0.05 | Real paid orders and wishlist saves |

Weights are **relative** — the scorer divides by their total, so they need not
sum to 1 and a mistyped value cannot produce a broken scale.

### Demand is two layers, and the second one matters most

The category alone is not enough. `Accessories (General)` holds both
`Dell Pro 14-16 EcoLoop Slim Backpack` (a genuine consumer purchase) and
`HPE MicroSvr Gen10 NHP Converter Kit` (not), with the same category, the same
brand family and a similar price. So:

1. **Category prior** — Laptops 100, Smart Home 96, Wearables 92,
   Peripherals 90 … Cables 22, Servers 4, Support & Warranty 0.
2. **Title keywords** — lifts for real consumer product types (robot vacuum,
   smart bulb, webcam, headset, gaming mouse, SSD, router …), then hard floors
   that crush enterprise spares, transceivers, rack parts, SAS drives, service
   contracts and bulk cabling no matter what category they arrived in.

The floors run last on purpose: a "Smart rack PDU" must not reach the home page
just because it says *smart*.

### Price bands

| Price | Fit |
|---|---:|
| < R80 | 20 |
| R80 – R250 | 70 |
| R250 – R600 | 86 |
| R600 – R1 500 | 96 |
| **R1 500 – R4 000** | **100** |
| R4 000 – R8 000 | 88 |
| R8 000 – R12 000 | 70 |
| R12 000 – R15 000 | 55 |
| > R15 000 | 0 (and gated out) |

### Availability is 20, not 0, for out of stock

Only ~160 of 1 084 residential products are in stock, and the deliberately
curated smart-home and wellness lines (Oura, Govee, Nanoleaf, Withings) are
currently supplier out-of-stock. At 0 the home page would contain no smart-home
product at all and would fill with mice. At 20 an in-stock equivalent always
outranks an out-of-stock one, but a genuinely desirable branded item can still
earn a place — and the card renders an honest backorder dispatch date.

### The `signal` factor is the long game

There are currently **0 paid orders** in the database, so this factor
contributes nothing today. That is why the other six carry marketing priors. As
real orders accumulate, the signal term rises on its own and starts overriding
the priors — no code change required. Launch on judgement, converge on evidence.

## Hard gates — invariants, not weights

`merch_is_home_eligible()` rejects a product outright, whatever its score:

- no real title
- price outside R80 – R15 000
- no image, or a `placeholder.svg`
- category `Support & Warranty` or `Servers & Data Centre`
- demand tier below `merch.min_demand` (default 35)

No amount of weight tuning can put a rack server or a care pack in the shop
window.

## Diversity

Each slot is filled greedily under caps: **max 2 per brand**, **max 3 per
category**. Without them the residential pool (831 of 1 084 products are HPE,
and Dell dominates the in-stock half) would produce eight near-identical Dell
mice.

## Why it cannot break the home page

1. `refresh_home_showcase()` rewrites its own table in one transaction and
   **refuses to write at all** if the candidate set is empty — a broken
   supplier sync degrades to yesterday's shop window, never to a blank page.
2. A unique index on `home_showcase(product_id)` makes the same product
   appearing in both grids structurally impossible.
3. `get_home_showcase()` re-checks `is_active`, so a product deactivated
   between refreshes vanishes rather than linking to a dead page.
4. `fetchShowcase()` returns `[]` on every failure path instead of throwing;
   `Index.tsx` falls back to its previous query, so the page always renders.
5. `merch_setting()` never raises — a mistyped weight silently falls back to
   its documented default rather than stopping the cron.

## Operating it

**Rebuild:** Admin → Home Merchandising → *Rebuild now*, or wait for the cron
(`refresh-home-showcase`, every 3 hours at :43 — offset so it never contends
with `axiz-sync` at `*/15` or `refresh-product-facets` at `:17`).

**Retune:** change a weight in the *The mix* panel, save, rebuild. Or in SQL:

```sql
UPDATE store_settings SET value = '0.40' WHERE key = 'merch.weight.demand';
SELECT public.refresh_home_showcase();
```

**Inspect the full ranking, including products that did not make it:**

```sql
SELECT name, brand, category, price, in_stock, score, reasons
  FROM public.home_showcase_candidates
 ORDER BY score DESC
 LIMIT 50;
```

**Ask why one specific product scores what it does:**

```sql
SELECT jsonb_pretty(public.score_home_product(
  category, name, brand, price, in_stock, stock_quantity, images, is_ai_product, 0))
FROM products WHERE sku = 'YOUR-SKU';
```

**Re-run the invariants** (all must return `true`):

```sql
\i supabase/tests/home_showcase_invariants.sql
```

## Known catalogue gaps this surfaced

These are data problems, not engine problems, and they cap how good the home
page can get:

- **Three curated smart-home products are invisible** — Nanoleaf Elements
  7-Panel Kit, LIFX Color A19 Bulb and Withings Smart Body Analyzer still carry
  `/placeholder.svg`, so the image gate excludes them. Real photographs are the
  only fix.
- **There are effectively no laptops.** Of three products categorised
  `Laptops`, one is a R23 072 Latitude (above the residential ceiling), one is a
  power adapter and one is a privacy filter.
- **Health & Wellness has one product and it has no photo.**
- **Category data is noisy.** A Dell wireless headset is filed under
  `Networking`, a briefcase under `Monitors & Displays`. The title-keyword layer
  rescues these, which is exactly why it exists — but the diversity caps key on
  the stored category, so a miscategorised product can dodge its cap.
