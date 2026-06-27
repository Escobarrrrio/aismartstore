import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CurrencyCode } from "@/lib/currency";

type RateMap = Partial<Record<CurrencyCode, number>>;

let cachedRates: RateMap | null = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000; // 5 minutes -- rates don't need to be fetched on every render

/**
 * Returns a map of { currencyCode: rateToZar }. All product prices are
 * stored in ZAR, so converting to a display currency is:
 *   displayAmount = zarAmount / rates[displayCurrency]
 */
export function useExchangeRates() {
  const [rates, setRates] = useState<RateMap>(cachedRates || { ZAR: 1 });
  const [loaded, setLoaded] = useState(!!cachedRates);

  useEffect(() => {
    if (cachedRates && Date.now() - cachedAt < CACHE_MS) {
      setRates(cachedRates);
      setLoaded(true);
      return;
    }
    supabase
      .from("exchange_rates")
      .select("currency_code, rate_to_zar")
      .then(({ data }) => {
        if (!data) return;
        const map: RateMap = {};
        for (const row of data) map[row.currency_code as CurrencyCode] = Number(row.rate_to_zar);
        cachedRates = map;
        cachedAt = Date.now();
        setRates(map);
        setLoaded(true);
      });
  }, []);

  /** Converts a ZAR-stored amount into the given display currency. */
  const convert = (zarAmount: number, toCurrency: CurrencyCode): number => {
    if (toCurrency === "ZAR") return zarAmount;
    const rate = rates[toCurrency];
    if (!rate) return zarAmount; // fall back to ZAR-equivalent number rather than crash
    return zarAmount / rate;
  };

  return { rates, convert, loaded };
}
