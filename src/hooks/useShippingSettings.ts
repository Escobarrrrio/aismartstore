import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Self-maintained courier fee calculator.
 *
 * Why not a live courier API? Real SA carriers (Courier Guy, DPD Laser,
 * Aramex, Fastway) require a commercial account before they hand out live
 * rate endpoints. Until we open one, we ship from NMBM (Gqeberha) using
 * this static zone × weight table with published 2026 benchmark rates.
 *
 * The zone map + rate table both live in `store_settings` (public-read keys
 * `shipping_zones` and `shipping_rate_table`) so admins can tune them
 * without a code change. Once we have a courier account, swap the pure
 * `computeShippingFee` function for a fetch to that carrier's API and the
 * rest of the app keeps working.
 */

const DEFAULT_FLAT_RATE = 75;
const DEFAULT_FREE_THRESHOLD = 500;

// Midpoints of the published sub-5kg bands. NMBM (Eastern Cape) sits in
// "regional" — cheapest for local Eastern Cape / KZN deliveries.
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
  note?: string;
};

const DEFAULT_RATE_TABLE: RateTable = {
  metro: 98,       // JHB / CPT / DBN / PTA midpoint of R85–R110
  outlying: 128,   // Gauteng/WC outlying midpoint of R110–R145
  regional: 150,   // KZN/EC regional midpoint of R125–R175 (our home turf)
  rest: 195,       // Rest of SA midpoint of R165–R225
  // Estimates — reasonable +30% for 5-10kg and +60% for 10-20kg tiers.
  weight_tiers: [
    { max_kg: 5, multiplier: 1.0 },
    { max_kg: 10, multiplier: 1.3 },
    { max_kg: 20, multiplier: 1.6 },
    { max_kg: 9999, multiplier: 2.0 },
  ],
};

export const SA_PROVINCES = Object.keys(DEFAULT_ZONES);

export function useShippingSettings() {
  const [flatRate, setFlatRate] = useState(DEFAULT_FLAT_RATE);
  const [freeThreshold, setFreeThreshold] = useState(DEFAULT_FREE_THRESHOLD);
  const [zones, setZones] = useState<Record<string, string>>(DEFAULT_ZONES);
  const [rateTable, setRateTable] = useState<RateTable>(DEFAULT_RATE_TABLE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("store_settings")
          .select("key, value")
          .in("key", [
            "shipping_flat_rate",
            "free_shipping_threshold",
            "shipping_zones",
            "shipping_rate_table",
          ]);
        if (cancelled || !data) return;
        const map = Object.fromEntries(data.map((r) => [r.key, r.value]));
        if (map.shipping_flat_rate) setFlatRate(Number(map.shipping_flat_rate));
        if (map.free_shipping_threshold) setFreeThreshold(Number(map.free_shipping_threshold));
        const parse = (v: unknown) => {
          if (!v) return null;
          if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
          return v;
        };
        const z = parse(map.shipping_zones);
        if (z && typeof z === "object") setZones({ ...DEFAULT_ZONES, ...z });
        const rt = parse(map.shipping_rate_table);
        if (rt && typeof rt === "object") setRateTable({ ...DEFAULT_RATE_TABLE, ...rt });
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Zone × weight fee. When `province` is not supplied (e.g. on the Cart
   * page, before the customer picks an address) we fall back to the flat
   * rate so the summary is never blank.
   */
  const computeZonedFee = (province?: string, weightKg = 0) => {
    if (!province) return flatRate;
    const zone = zones[province];
    const base = zone ? (rateTable as any)[zone] ?? flatRate : flatRate;
    const tier = rateTable.weight_tiers.find((t) => weightKg <= t.max_kg)
      ?? rateTable.weight_tiers[rateTable.weight_tiers.length - 1];
    return Math.round(base * tier.multiplier);
  };

  /**
   * Backwards-compatible entry point.
   *   getShippingFee(subtotal)                          -> flat rate
   *   getShippingFee(subtotal, { province, weightKg }) -> zoned rate
   * Free-shipping-over-threshold applies uniformly across zones for now.
   */
  const getShippingFee = (
    subtotal: number,
    opts?: { province?: string; weightKg?: number },
  ) => {
    if (subtotal >= freeThreshold) return 0;
    return computeZonedFee(opts?.province, opts?.weightKg ?? 0);
  };

  return {
    flatRate,
    freeThreshold,
    zones,
    rateTable,
    getShippingFee,
    loaded,
  };
}
