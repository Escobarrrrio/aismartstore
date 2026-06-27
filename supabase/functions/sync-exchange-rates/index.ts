import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Keeps exchange_rates current using a free, no-API-key-required FX
// rate source. Runs daily via pg_cron. Without this, switching currency
// in the UI would either show static/stale rates or (before this table
// existed at all) the exact same number relabeled with a different
// currency symbol -- which reads as broken or fraudulent to any
// international customer who notices the math doesn't work.

const SUPPORTED = ["ZAR", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NZD", "CHF", "CNY", "INR"];

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    // open.er-api.com is free, no key, CORS-enabled, updated daily.
    const res = await fetch("https://open.er-api.com/v6/latest/ZAR");
    const data = await res.json();

    if (data.result !== "success" || !data.rates) {
      throw new Error("Unexpected response from exchange rate source");
    }

    // The API gives rates AS "1 ZAR = X currency". We store the inverse
    // (rate_to_zar = how many ZAR is 1 unit of that currency) since
    // that's what formatMoney needs to convert a ZAR-stored price into
    // the display currency.
    const rows = SUPPORTED.map((code) => {
      if (code === "ZAR") return { currency_code: "ZAR", rate_to_zar: 1 };
      const zarPerUnit = data.rates[code] ? 1 / data.rates[code] : null;
      return zarPerUnit ? { currency_code: code, rate_to_zar: zarPerUnit } : null;
    }).filter(Boolean);

    for (const row of rows) {
      await supabase.from("exchange_rates").upsert(
        { ...row, updated_at: new Date().toISOString() },
        { onConflict: "currency_code" }
      );
    }

    return new Response(JSON.stringify({ status: "success", updated: rows.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ status: "error", message: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
