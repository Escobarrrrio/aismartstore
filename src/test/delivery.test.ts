import { describe, it, expect } from "vitest";
import {
  easterSunday, saPublicHolidays, isBusinessDay, addBusinessDays,
  estimateDelivery, formatArrivalWindow, PROVINCE_ZONES, DISPATCH_CUTOFF_HOUR,
} from "@/lib/delivery";

const utc = (y: number, m: number, d: number, h = 9) => new Date(Date.UTC(y, m - 1, d, h));
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("easterSunday", () => {
  // Known-good values; the algorithm must reproduce them exactly, because Good
  // Friday and Family Day are derived from it.
  it("matches published Easter dates", () => {
    expect(iso(easterSunday(2024))).toBe("2024-03-31");
    expect(iso(easterSunday(2025))).toBe("2025-04-20");
    expect(iso(easterSunday(2026))).toBe("2026-04-05");
    expect(iso(easterSunday(2027))).toBe("2027-03-28");
    expect(iso(easterSunday(2030))).toBe("2030-04-21");
  });
});

describe("saPublicHolidays", () => {
  it("includes the fixed and Easter-derived holidays", () => {
    const h = saPublicHolidays(2026);
    for (const d of [
      "2026-01-01", "2026-03-21", "2026-04-27", "2026-05-01",
      "2026-06-16", "2026-09-24", "2026-12-16", "2026-12-25", "2026-12-26",
    ]) expect(h.has(d), d).toBe(true);

    // Easter 2026-04-05 → Good Friday 3 Apr, Family Day 6 Apr.
    expect(h.has("2026-04-03")).toBe(true);
    expect(h.has("2026-04-06")).toBe(true);
  });

  it("observes the Monday when a holiday falls on a Sunday", () => {
    // 2026-08-09 (Women's Day) is a Sunday, so the 10th is also observed.
    expect(new Date("2026-08-09T00:00:00Z").getUTCDay()).toBe(0);
    const h = saPublicHolidays(2026);
    expect(h.has("2026-08-09")).toBe(true);
    expect(h.has("2026-08-10")).toBe(true);
  });

  it("does not invent a Monday for a weekday holiday", () => {
    const h = saPublicHolidays(2026);
    // Freedom Day 2026-04-27 is a Monday already; the 28th must stay a work day.
    expect(h.has("2026-04-28")).toBe(false);
  });
});

describe("isBusinessDay", () => {
  it("excludes weekends and holidays", () => {
    expect(isBusinessDay(utc(2026, 7, 31))).toBe(true);   // Friday
    expect(isBusinessDay(utc(2026, 8, 1))).toBe(false);   // Saturday
    expect(isBusinessDay(utc(2026, 8, 2))).toBe(false);   // Sunday
    expect(isBusinessDay(utc(2026, 12, 25))).toBe(false); // Christmas
    expect(isBusinessDay(utc(2026, 4, 3))).toBe(false);   // Good Friday
  });
});

describe("addBusinessDays", () => {
  it("rolls a weekend start forward before counting", () => {
    // Saturday 1 Aug 2026 + 0 days = Monday 3 Aug.
    expect(iso(addBusinessDays(utc(2026, 8, 1), 0))).toBe("2026-08-03");
  });

  it("skips weekends while counting", () => {
    // Friday 31 Jul + 1 business day = Monday 3 Aug.
    expect(iso(addBusinessDays(utc(2026, 7, 31), 1))).toBe("2026-08-03");
  });

  it("skips public holidays and their observed Mondays", () => {
    // Friday 7 Aug + 1 business day: 8th Sat, 9th Sun (Women's Day),
    // 10th observed Monday -> lands Tuesday 11 Aug.
    expect(iso(addBusinessDays(utc(2026, 8, 7), 1))).toBe("2026-08-11");
  });

  it("handles a long run across the festive season", () => {
    // From Tue 15 Dec 2026: 16th (Reconciliation), 25th, 26th and weekends out.
    const d = addBusinessDays(utc(2026, 12, 15), 10);
    expect(isBusinessDay(d)).toBe(true);
    expect(d.getTime()).toBeGreaterThan(utc(2026, 12, 25).getTime());
  });
});

describe("estimateDelivery", () => {
  it("dispatches an in-stock metro order the same day before the cut-off", () => {
    // 09:00 SAST on Monday 3 Aug 2026 (07:00 UTC).
    const e = estimateDelivery({ inStock: true, province: "Gauteng", now: utc(2026, 8, 3, 7) });
    expect(e.missedCutoff).toBe(false);
    expect(iso(e.dispatchOn)).toBe("2026-08-03");
    expect(e.zone).toBe("metro");
    expect(iso(e.earliestArrival)).toBe("2026-08-04");
  });

  it("pushes dispatch out by a day after the cut-off", () => {
    // 16:00 SAST = 14:00 UTC, past the 13:00 cut-off.
    const e = estimateDelivery({ inStock: true, province: "Gauteng", now: utc(2026, 8, 3, 14) });
    expect(e.missedCutoff).toBe(true);
    expect(iso(e.dispatchOn)).toBe("2026-08-04");
  });

  it("never quotes an arrival before dispatch", () => {
    for (const province of Object.keys(PROVINCE_ZONES)) {
      for (const inStock of [true, false]) {
        const e = estimateDelivery({ inStock, province, now: utc(2026, 8, 3, 7) });
        expect(e.earliestArrival.getTime()).toBeGreaterThan(e.dispatchOn.getTime());
        expect(e.latestArrival.getTime()).toBeGreaterThanOrEqual(e.earliestArrival.getTime());
      }
    }
  });

  it("only ever lands on business days", () => {
    for (let dayOffset = 0; dayOffset < 40; dayOffset++) {
      for (const hour of [7, 14]) {
        const now = new Date(utc(2026, 8, 1, hour).getTime() + dayOffset * 86400000);
        for (const inStock of [true, false]) {
          const e = estimateDelivery({ inStock, province: "Eastern Cape", now });
          expect(isBusinessDay(e.dispatchOn)).toBe(true);
          expect(isBusinessDay(e.earliestArrival)).toBe(true);
          expect(isBusinessDay(e.latestArrival)).toBe(true);
        }
      }
    }
  });

  it("quotes backorder slower than in stock", () => {
    const now = utc(2026, 8, 3, 7);
    const stocked = estimateDelivery({ inStock: true, province: "Gauteng", now });
    const backorder = estimateDelivery({ inStock: false, province: "Gauteng", now });
    expect(backorder.latestArrival.getTime()).toBeGreaterThan(stocked.latestArrival.getTime());
  });

  it("falls back to the slowest zone for an unknown province", () => {
    // Guessing metro speed for an unclassifiable address is the exact
    // over-promise this module exists to prevent.
    for (const province of [null, undefined, "", "Atlantis"]) {
      expect(estimateDelivery({ inStock: true, province, now: utc(2026, 8, 3, 7) }).zone).toBe("rest");
    }
  });

  it("is slower to outlying provinces than to metro ones", () => {
    const now = utc(2026, 8, 3, 7);
    const metro = estimateDelivery({ inStock: true, province: "Gauteng", now });
    const rest = estimateDelivery({ inStock: true, province: "Northern Cape", now });
    expect(rest.latestArrival.getTime()).toBeGreaterThan(metro.latestArrival.getTime());
  });

  it("does not promise delivery over the Christmas shutdown", () => {
    // Ordered Wed 23 Dec 2026: the 25th and 26th are holidays.
    const e = estimateDelivery({ inStock: true, province: "Gauteng", now: utc(2026, 12, 23, 7) });
    expect(iso(e.earliestArrival)).not.toBe("2026-12-25");
    expect(iso(e.earliestArrival)).not.toBe("2026-12-26");
    expect(isBusinessDay(e.earliestArrival)).toBe(true);
  });

  it("exposes the cut-off hour it actually uses", () => {
    expect(DISPATCH_CUTOFF_HOUR).toBeGreaterThan(0);
    expect(DISPATCH_CUTOFF_HOUR).toBeLessThan(24);
  });
});

describe("formatArrivalWindow", () => {
  it("renders a range", () => {
    const e = estimateDelivery({ inStock: true, province: "Gauteng", now: utc(2026, 8, 3, 7) });
    const s = formatArrivalWindow(e);
    expect(s).toMatch(/–/);
    expect(s.length).toBeGreaterThan(4);
  });

  it("collapses a single-day window to one date", () => {
    const e = estimateDelivery({ inStock: true, province: "Gauteng", now: utc(2026, 8, 3, 7) });
    const single = { ...e, latestArrival: e.earliestArrival };
    expect(formatArrivalWindow(single)).not.toMatch(/–/);
  });
});
