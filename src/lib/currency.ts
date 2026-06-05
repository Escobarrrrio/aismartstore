// Centralized money model: amount + currency code, formatted only at display time.
export type CurrencyCode =
  | "ZAR" | "USD" | "EUR" | "GBP" | "JPY" | "AUD"
  | "CAD" | "NZD" | "CHF" | "CNY" | "INR";

export const SUPPORTED_CURRENCIES: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: "ZAR", label: "South African Rand", symbol: "R" },
  { code: "USD", label: "US Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" },
  { code: "GBP", label: "British Pound", symbol: "£" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "CAD", label: "Canadian Dollar", symbol: "C$" },
  { code: "NZD", label: "New Zealand Dollar", symbol: "NZ$" },
  { code: "CHF", label: "Swiss Franc", symbol: "Fr" },
  { code: "CNY", label: "Chinese Yuan", symbol: "¥" },
  { code: "INR", label: "Indian Rupee", symbol: "₹" },
];

const LOCALE_BY_CURRENCY: Record<CurrencyCode, string> = {
  ZAR: "en-ZA", USD: "en-US", EUR: "de-DE", GBP: "en-GB",
  JPY: "ja-JP", AUD: "en-AU", CAD: "en-CA", NZD: "en-NZ",
  CHF: "de-CH", CNY: "zh-CN", INR: "en-IN",
};

// Ambiguous symbols where we should also show the code.
const AMBIGUOUS = new Set<CurrencyCode>(["CNY", "AUD", "CAD", "NZD"]);

export function formatMoney(
  amount: number | string | null | undefined,
  currency: CurrencyCode = "ZAR",
  locale?: string,
): string {
  const value = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  if (Number.isNaN(value)) return "—";
  const loc = locale || LOCALE_BY_CURRENCY[currency] || "en-ZA";
  try {
    const formatted = new Intl.NumberFormat(loc, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      minimumFractionDigits: currency === "JPY" ? 0 : 2,
      maximumFractionDigits: currency === "JPY" ? 0 : 2,
    }).format(value);
    // South African rand: prefer "R 1 234,56" form -> Intl already gives "R 1 234,56" in en-ZA
    if (AMBIGUOUS.has(currency)) return `${formatted} ${currency}`;
    return formatted;
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatNumber(value: number, locale = "en-ZA"): string {
  return new Intl.NumberFormat(locale).format(value);
}
