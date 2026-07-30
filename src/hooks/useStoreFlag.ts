import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Reads a boolean feature flag out of `store_settings`.
 *
 * Flags are public-readable (the RLS whitelist covers the `seo.%` and `merch.%`
 * prefixes), so this works for signed-out shoppers too — a flag that only
 * applied to logged-in users would mean Google and the shop owner saw different
 * pages, which is exactly the cloaking Google penalises.
 *
 * Defaults to `false` on every failure path. A flag that fails open would mean
 * a database blip silently switches a feature on across the whole storefront.
 */
export function useStoreFlag(key: string, fallback = false): { value: boolean; loading: boolean } {
  const [value, setValue] = useState(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("store_settings")
          .select("value")
          .eq("key", key)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setValue(fallback);
        } else {
          const raw = (data.value ?? "").trim().toLowerCase();
          setValue(raw === "true" || raw === "1" || raw === "on" || raw === "yes");
        }
      } catch {
        if (!cancelled) setValue(fallback);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [key, fallback]);

  return { value, loading };
}
