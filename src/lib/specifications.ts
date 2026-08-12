import type { Product } from "@/contexts/CartContext";

/**
 * Product specifications, derived rather than stored.
 *
 * Only 6 of ~3 500 live products carry a `specifications` record, so every other
 * page showed "Detailed specifications will be available once product data is
 * synced from the supplier" — which read as a broken catalogue.
 *
 * The distributor never sends a structured spec sheet, but it does encode the
 * real specs into the product name, densely and consistently:
 *
 *   "HPE 1.92T NVMeRI SFF BC U.3ST V2 MV SSD"
 *   "HPE MSA 1.8TB SAS 10K SFF M2 HDD"
 *   "Dell Latitude 5330/Core i5 1235U/8GB/256GB SSD/13.3" FHD/W11Pro/3Y ProSpt"
 *
 * So specs are extracted at read time instead of backfilled. That means they
 * apply to the whole catalogue immediately, they can never drift out of sync
 * with the product name, and a parser improvement doesn't need a data migration.
 *
 * The rule throughout: only emit a spec when the pattern is unambiguous. A page
 * with four correct rows is worth far more than one with twelve invented ones,
 * so anything uncertain is dropped rather than guessed.
 */

export type SpecItem = { label: string; value: string };
export type SpecGroup = { title: string; items: SpecItem[] };

/** Ordered so the most identifying specs surface first. */
type Rule = { label: string; re: RegExp; format?: (m: RegExpMatchArray) => string };

const TECHNICAL_RULES: Rule[] = [
  {
    label: "Capacity",
    // 960GB, 1.92TB, 15.36TB, and the distributor's clipped "1.92T" form.
    // Deliberately case-SENSITIVE: "GB" is gigabytes, "Gb" is gigabits. Matching
    // case-insensitively reported "HPE 100Gb QSFP28 ... XCVR" -- a 100 gigabit
    // transceiver -- as having 100GB of storage capacity.
    re: /\b(\d+(?:\.\d+)?)\s?(TB|GB|T)\b(?!\/?s)/,
    format: (m) => `${m[1]}${m[2] === "T" ? "TB" : m[2]}`,
  },
  {
    label: "Processor",
    // EPYC part numbers aren't all four digits — "EPYC 73F3" embeds a letter,
    // so a plain \d{4} missed a whole family of CPUs in the feed.
    re: /\b((?:Core\s+)?i[3579][\s-]?\d{4,5}[A-Z]{0,2}|Xeon(?:-[A-Z])?\s+\d{4}[A-Z+]*|Ryzen\s+\d\s+\w+|EPYC\s+\d{2,4}[A-Z]?\d?[A-Z]*)\b/i,
    format: (m) => m[1].replace(/\s+/g, " ").trim(),
  },
  {
    label: "Memory",
    re: /\b(\d+)\s?GB\b[^/]{0,24}?\b(?:UDIMM|RDIMM|DIMM|DDR\d|Mem(?:ory)?)\b/i,
    format: (m) => `${m[1]}GB`,
  },
  { label: "Memory type", re: /\b(DDR[345](?:L)?)\b/i, format: (m) => m[1].toUpperCase() },
  {
    label: "Memory speed",
    re: /\b(\d{3,5})\s?MT\/s\b/i,
    format: (m) => `${m[1]} MT/s`,
  },
  {
    label: "Drive type",
    // No trailing \b after NVMe: the feed concatenates the endurance grade onto
    // it ("NVMeRI" = read intensive, "NVMeMU" = mixed use), so requiring a word
    // boundary there loses the match and the drive falls back to plain "SSD".
    re: /(\bNVMe|\bSSD\b|\bHDD\b)/i,
    format: (m) => (m[1].toUpperCase() === "NVME" ? "NVMe SSD" : m[1].toUpperCase()),
  },
  {
    label: "Interface",
    re: /(\bSAS\b|\bSATA\b|\bNVMe|\bPCIe(?:\s?Gen\s?\d)?|\bFibre Channel\b|\bUSB\s?3(?:\.\d)?\b|\bThunderbolt\s?\d?\b)/i,
    format: (m) => m[1].replace(/\s+/g, " ").toUpperCase().replace("NVME", "NVMe").replace("PCIE", "PCIe"),
  },
  {
    label: "Rotational speed",
    re: /\b(7\.2|10|15)\s?K\b/i,
    format: (m) => `${m[1]}K RPM`,
  },
  {
    label: "Form factor",
    re: /\b(SFF|LFF|M\.2(?:\s?\d{4,5})?|U\.[23]|2\.5"|3\.5")\b/i,
    format: (m) => m[1].toUpperCase().replace("M.2", "M.2"),
  },
  {
    label: "Rack height",
    re: /\b(\d{1,2})U\b(?=\s?(?:Tower|Rack|Chassis|Shock|$|\s))/i,
    format: (m) => `${m[1]}U`,
  },
  {
    label: "Display",
    // 13.3" FHD / 15.6 inch UHD
    re: /\b(\d{2}(?:\.\d)?)\s?(?:"|inch|”)\s*(FHD|UHD|QHD|HD\+?|4K)?/i,
    format: (m) => `${m[1]}"${m[2] ? ` ${m[2].toUpperCase()}` : ""}`,
  },
  {
    label: "Network speed",
    // Also case-SENSITIVE, for the same reason in reverse: with /i this matched
    // the "960GB" in "HPE 960GB SATA ... SSD" and reported a storage drive as
    // having a 960GbE network link.
    re: /\b(\d{1,3})\s?Gb(?:E|it)?\b/,
    format: (m) => `${m[1]}GbE`,
  },
  {
    label: "Power supply",
    re: /\b(\d{3,4})\s?W\b/i,
    format: (m) => `${m[1]}W`,
  },
  {
    label: "Cable length",
    re: /\b(\d+(?:\.\d+)?)\s?(?:M|m)\b(?=\s?(?:C\d|Cable|Cbl|Cord|Jpr|DAC|Pwr))/,
    format: (m) => `${m[1]} m`,
  },
  {
    label: "Operating system",
    re: /\b(W(?:in)?1[01]\s?(?:Pro|Home)?|Windows\s?(?:Server\s?)?\d{4}|Windows\s?1[01](?:\s?Pro)?)\b/i,
    format: (m) => m[1].replace(/^W(?=1)/i, "Windows ").replace(/\s+/g, " ").trim(),
  },
  {
    label: "Warranty",
    re: /\b(\d)\s?-?\s?(?:Y(?:ea)?r?s?)\b/i,
    format: (m) => `${m[1]} year${m[1] === "1" ? "" : "s"}`,
  },
];

/**
 * Internal bookkeeping on manually-sourced rows -- not customer-facing.
 *
 * This list was wrong on two counts that let real internal data reach the
 * live product page: `source_url`/`notes` here never matched the actual
 * stored keys (`product_url`/`note`), so both leaked despite looking
 * handled, and `supplier`, `supplier_status`, `markup_pct` and
 * `supplier_cost_zar` were never listed at all -- the last two are this
 * store's literal cost basis and profit margin, live on 6 products at the
 * time this was found. Verified against the actual distinct keys in
 * production (`SELECT DISTINCT jsonb_object_keys(specifications) ...`)
 * rather than trusted from memory, specifically to catch this class of
 * mismatch instead of repeating it.
 *
 * `warranty_months`, `lead_time_note` and `barcodes` are deliberately NOT
 * hidden -- they're genuine, non-sensitive customer-facing information
 * (barcodes only survive here if they're a plain string; arrays/objects are
 * already dropped below regardless of key name).
 */
const HIDDEN_SPEC_KEYS = new Set([
  "manually_sourced", "checked_at", "supplier_sku", "supplier", "supplier_status",
  "product_url", "source_url", "note", "notes", "pending_photo",
  "markup_pct", "markup_percent", "markup_percentage",
  "supplier_cost_zar", "cost", "cost_zar", "margin", "margin_pct", "margin_percentage",
]);

const titleCaseKey = (key: string) =>
  key.replace(/[_-]+/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Pull unambiguous technical specs out of free text (a product name or
 * description). Returns at most one value per label, first match wins.
 */
export function extractSpecs(text: string | null | undefined): SpecItem[] {
  if (!text || typeof text !== "string") return [];
  // Distributor names are slash- and newline-delimited; flatten to one line so
  // patterns spanning separators still match.
  const haystack = text.replace(/[\n\r]+/g, " / ").replace(/\s+/g, " ");

  const out: SpecItem[] = [];
  const seen = new Set<string>();
  for (const rule of TECHNICAL_RULES) {
    if (seen.has(rule.label)) continue;
    const m = haystack.match(rule.re);
    if (!m) continue;
    const value = (rule.format ? rule.format(m) : m[1] ?? m[0]).trim();
    if (!value) continue;
    seen.add(rule.label);
    out.push({ label: rule.label, value });
  }
  return out;
}

/**
 * Everything worth showing under "Specifications", grouped for display.
 *
 * `stored` is the product's `specifications` jsonb when the caller has it
 * (manually-sourced products carry supplier data there). Stored values are
 * authoritative and win over anything derived from the name.
 */
export function buildSpecifications(
  product: Pick<Product, "name" | "description" | "brand" | "sku" | "category" | "inStock" | "stockQuantity">,
  stored?: Record<string, unknown> | null,
): SpecGroup[] {
  const groups: SpecGroup[] = [];

  const details: SpecItem[] = [];
  if (product.brand) details.push({ label: "Brand", value: product.brand });
  if (product.sku) details.push({ label: "Product code", value: product.sku });
  if (product.category) details.push({ label: "Category", value: product.category });
  details.push({
    label: "Availability",
    value: product.inStock
      ? typeof product.stockQuantity === "number" && product.stockQuantity > 0
        ? `In stock (${product.stockQuantity} available)`
        : "In stock"
      : "Available on backorder",
  });
  if (details.length) groups.push({ title: "Product details", items: details });

  // Supplier-provided values first, so derived ones never overwrite real data.
  const storedItems: SpecItem[] = [];
  const storedLabels = new Set<string>();
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    for (const [key, raw] of Object.entries(stored)) {
      if (HIDDEN_SPEC_KEYS.has(key)) continue;
      if (raw === null || raw === undefined || raw === "") continue;
      if (typeof raw === "object") continue;
      const label = titleCaseKey(key);
      storedLabels.add(label.toLowerCase());
      storedItems.push({ label, value: String(raw) });
    }
  }

  const derived = extractSpecs(`${product.name ?? ""} ${product.description ?? ""}`)
    .filter((s) => !storedLabels.has(s.label.toLowerCase()));

  const technical = [...storedItems, ...derived];
  if (technical.length) groups.push({ title: "Technical specifications", items: technical });

  return groups;
}
