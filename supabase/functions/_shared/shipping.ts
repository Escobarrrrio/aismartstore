// Server-side mirror of src/hooks/useShippingSettings.ts' computeZonedFee.
// Must stay in sync with that file -- both read the exact same
// store_settings rows (shipping_flat_rate / shipping_zones /
// shipping_rate_table) that the Admin Settings panel edits, so a fee
// computed here always agrees with what a shopper was quoted client-side.
// This is the authoritative calculation: never trust a client-supplied
// shipping fee when charging a payment gateway.

const DEFAULT_FLAT_RATE = 75;

const DEFAULT_ZONES: Record<string, string> = {
  "Gauteng": "metro",
  "Western Cape": "metro",
  "KwaZulu-Natal": "regional",
  "Eastern Cape": "regional",
  "Free State": "outlying",
  "North West": "outlying",
  "Mpumalanga": "outlying",
  "Limpopo": "rest",
  "Northern Cape": "rest",
};

type WeightTier = { max_kg: number; multiplier: number };
type RateTable = {
  metro: number;
  outlying: number;
  regional: number;
  rest: number;
  weight_tiers: WeightTier[];
};

const DEFAULT_RATE_TABLE: RateTable = {
  metro: 98,
  outlying: 128,
  regional: 150,
  rest: 195,
  weight_tiers: [
    { max_kg: 5, multiplier: 1.0 },
    { max_kg: 10, multiplier: 1.3 },
    { max_kg: 20, multiplier: 1.6 },
    { max_kg: 9999, multiplier: 2.0 },
  ],
};

function parseJson(v: unknown): any {
  if (!v) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v;
}

export async function computeAuthoritativeShippingFee(
  supabase: any,
  province: string | null | undefined,
  weightKg: number,
): Promise<number> {
  const { data } = await supabase
    .from("store_settings")
    .select("key, value")
    .in("key", ["shipping_flat_rate", "shipping_zones", "shipping_rate_table"]);

  const map = Object.fromEntries((data ?? []).map((r: any) => [r.key, r.value]));
  const flatRate = map.shipping_flat_rate ? Number(map.shipping_flat_rate) : DEFAULT_FLAT_RATE;

  if (!province) return flatRate;

  const zones = { ...DEFAULT_ZONES, ...(parseJson(map.shipping_zones) || {}) };
  const rateTable: RateTable = { ...DEFAULT_RATE_TABLE, ...(parseJson(map.shipping_rate_table) || {}) };

  const zone = zones[province] as keyof Omit<RateTable, "weight_tiers"> | undefined;
  const base = zone ? rateTable[zone] ?? flatRate : flatRate;
  const tier =
    rateTable.weight_tiers.find((t) => weightKg <= t.max_kg) ??
    rateTable.weight_tiers[rateTable.weight_tiers.length - 1];

  return Math.round(base * tier.multiplier);
}
