/**
 * Delivery date estimation.
 *
 * Every card previously said a hardcoded "Ships in 3–7 days" (or "2–4 days")
 * regardless of stock, destination, the time of day, or whether the next four
 * days happened to be a long weekend. A wrong delivery promise is the fastest
 * route to a chargeback, so this computes real dates from real rules instead.
 *
 * The model mirrors the shipping-fee zones in `_shared/shipping.ts` so a quote
 * and a delivery estimate can never disagree about where a parcel is going:
 *
 *   dispatch = now
 *            + (same-day if in stock and before cut-off, else next business day)
 *            + handling days (0–1 in stock, supplier lead time on backorder)
 *   arrival  = dispatch + courier transit business days for the zone
 *
 * Weekends and South African public holidays are excluded throughout. Holidays
 * are *computed*, including Easter and the Sunday→Monday observance rule, rather
 * than pasted in as a list of 2026 dates that would silently rot in January.
 */

export type DeliveryZone = "metro" | "regional" | "outlying" | "rest";

/** Province → zone. Same mapping as the shipping-fee calculation. */
export const PROVINCE_ZONES: Record<string, DeliveryZone> = {
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

/** Courier transit in business days, [min, max], measured from dispatch. */
export const ZONE_TRANSIT_DAYS: Record<DeliveryZone, [number, number]> = {
  metro: [1, 2],
  regional: [2, 3],
  outlying: [3, 4],
  rest: [3, 5],
};

/** Warehouse handling before hand-off to the courier, in business days. */
const IN_STOCK_HANDLING: [number, number] = [0, 1];
/** Distributor lead time for anything not on the shelf. */
const BACKORDER_HANDLING: [number, number] = [3, 7];

/** Orders placed after this hour (SAST) are picked the next business day. */
export const DISPATCH_CUTOFF_HOUR = 13;

/** South Africa is UTC+2 year-round, with no daylight saving. */
const SAST_OFFSET_MINUTES = 120;

/**
 * Easter Sunday for a Gregorian year (Anonymous Gregorian algorithm). Good
 * Friday and Family Day both derive from it, so they can't be hardcoded.
 */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Public holidays observed in South Africa for a given year, as YYYY-MM-DD.
 *
 * Under the Public Holidays Act, a holiday falling on a Sunday is observed on
 * the following Monday — so the Monday must also count as a non-working day.
 */
export function saPublicHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  const addDays = (base: Date, n: number) =>
    new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + n));

  const dates: Date[] = [
    new Date(Date.UTC(year, 0, 1)),   // New Year's Day
    new Date(Date.UTC(year, 2, 21)),  // Human Rights Day
    addDays(easter, -2),              // Good Friday
    addDays(easter, 1),               // Family Day
    new Date(Date.UTC(year, 3, 27)),  // Freedom Day
    new Date(Date.UTC(year, 4, 1)),   // Workers' Day
    new Date(Date.UTC(year, 5, 16)),  // Youth Day
    new Date(Date.UTC(year, 7, 9)),   // National Women's Day
    new Date(Date.UTC(year, 8, 24)),  // Heritage Day
    new Date(Date.UTC(year, 11, 16)), // Day of Reconciliation
    new Date(Date.UTC(year, 11, 25)), // Christmas Day
    new Date(Date.UTC(year, 11, 26)), // Day of Goodwill
  ];

  const out = new Set<string>();
  for (const d of dates) {
    out.add(iso(d));
    // Sunday (0) → also observe the Monday.
    if (d.getUTCDay() === 0) out.add(iso(addDays(d, 1)));
  }
  return out;
}

const holidayCache = new Map<number, Set<string>>();
function holidaysFor(year: number): Set<string> {
  let s = holidayCache.get(year);
  if (!s) { s = saPublicHolidays(year); holidayCache.set(year, s); }
  return s;
}

/** True when the courier and warehouse are both working that day. */
export function isBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidaysFor(date.getUTCFullYear()).has(iso(date));
}

/**
 * Advance `count` business days from `from`. `count = 0` returns `from` itself
 * when it is already a business day, otherwise the next one — which is what
 * "dispatched today if you order before the cut-off" has to mean on a Sunday.
 */
export function addBusinessDays(from: Date, count: number): Date {
  let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (!isBusinessDay(d)) d = new Date(d.getTime() + 86400000);
  let remaining = Math.max(0, Math.floor(count));
  while (remaining > 0) {
    d = new Date(d.getTime() + 86400000);
    if (isBusinessDay(d)) remaining--;
  }
  return d;
}

/** Wall-clock date/hour in SAST for an instant, as a UTC-midnight Date + hour. */
function toSast(now: Date): { day: Date; hour: number } {
  const shifted = new Date(now.getTime() + SAST_OFFSET_MINUTES * 60000);
  return {
    day: new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())),
    hour: shifted.getUTCHours(),
  };
}

export type DeliveryEstimate = {
  /** Business day the parcel leaves the warehouse. */
  dispatchOn: Date;
  earliestArrival: Date;
  latestArrival: Date;
  zone: DeliveryZone;
  /** True when the order missed today's cut-off. */
  missedCutoff: boolean;
  inStock: boolean;
};

export type EstimateInput = {
  inStock: boolean;
  /** Destination province. Unknown provinces fall back to the slowest zone. */
  province?: string | null;
  /** Injected in tests; defaults to now. */
  now?: Date;
};

export function estimateDelivery({ inStock, province, now = new Date() }: EstimateInput): DeliveryEstimate {
  // An unrecognised or missing province must not quote metro speed — promising
  // 1–2 days to an address we can't classify is the failure this exists to stop.
  const zone: DeliveryZone = (province && PROVINCE_ZONES[province]) || "rest";

  const { day, hour } = toSast(now);
  const missedCutoff = hour >= DISPATCH_CUTOFF_HOUR;

  const [minHandling, maxHandling] = inStock ? IN_STOCK_HANDLING : BACKORDER_HANDLING;
  // Missing the cut-off costs one extra picking day, even on a same-day item.
  const cutoffPenalty = missedCutoff ? 1 : 0;

  const dispatchOn = addBusinessDays(day, minHandling + cutoffPenalty);
  const latestDispatch = addBusinessDays(day, maxHandling + cutoffPenalty);

  const [minTransit, maxTransit] = ZONE_TRANSIT_DAYS[zone];
  return {
    dispatchOn,
    earliestArrival: addBusinessDays(dispatchOn, minTransit),
    latestArrival: addBusinessDays(latestDispatch, maxTransit),
    zone,
    missedCutoff,
    inStock,
  };
}

/** Whole days between two UTC-midnight dates. */
export const daysBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86400000);

/**
 * Short arrival window for a product card, e.g. "Mon 3 – Wed 5 Aug".
 * Collapses to a single date when the window is one day.
 */
export function formatArrivalWindow(e: DeliveryEstimate, locale = "en-ZA"): string {
  const short = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });
  const full = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  if (iso(e.earliestArrival) === iso(e.latestArrival)) return full.format(e.earliestArrival);
  const sameMonth = e.earliestArrival.getUTCMonth() === e.latestArrival.getUTCMonth();
  return `${(sameMonth ? short : full).format(e.earliestArrival)} – ${full.format(e.latestArrival)}`;
}
