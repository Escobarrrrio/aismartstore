import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_FLAT_RATE = 75;
const DEFAULT_FREE_THRESHOLD = 500;

/**
 * Reads the two shipping settings that are intentionally public (see the
 * "Anyone can view public store settings" RLS policy, scoped to only these
 * two keys -- everything else in store_settings, like Yoco's secret key,
 * stays admin-only). Falls back to sane defaults if the row is missing or
 * the fetch fails, so Cart/Checkout never show a blank or "undefined" cost.
 */
export function useShippingSettings() {
  const [flatRate, setFlatRate] = useState(DEFAULT_FLAT_RATE);
  const [freeThreshold, setFreeThreshold] = useState(DEFAULT_FREE_THRESHOLD);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("store_settings")
          .select("key, value")
          .in("key", ["shipping_flat_rate", "free_shipping_threshold"]);
        if (cancelled || !data) return;
        const map = Object.fromEntries(data.map((r) => [r.key, r.value]));
        if (map.shipping_flat_rate) setFlatRate(Number(map.shipping_flat_rate));
        if (map.free_shipping_threshold) setFreeThreshold(Number(map.free_shipping_threshold));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const getShippingFee = (subtotal: number) => (subtotal >= freeThreshold ? 0 : flatRate);

  return { flatRate, freeThreshold, getShippingFee, loaded };
}
