import { describe, it, expect } from "vitest";
import {
  tokenize, similarity, scorePair, matchFolders, folderOf, orderPhotos, MATCH_THRESHOLD,
  type ProductLike,
} from "@/lib/photoMatch";

// The real catalogue rows these folders have to find. Names copied exactly as
// they are stored, punctuation and all, because the punctuation is precisely
// what a naive comparison trips on.
const PRODUCTS: ProductLike[] = [
  { id: "lifx", name: "LIFX Color A19 Bulb", brand: "LIFX", sku: "GW-T-LIFX Color A19/E26" },
  { id: "nanoleaf", name: "Nanoleaf Elements 7-Panel Kit", brand: "Nanoleaf", sku: "NL52-K-7002HB-7PK" },
  { id: "oura", name: "Oura Ring 4 (Silver, Size 9)", brand: "Oura", sku: "GW-T-Oura Ring 4-Silver-Size 9" },
  { id: "govee", name: "Govee Smart Outdoor Wall Light", brand: "Govee", sku: "H7078" },
  { id: "switchbot", name: "SwitchBot Hub Mini", brand: "SwitchBot", sku: "GW-T-Switchbot Hub Mini Smart remote" },
  { id: "withings", name: "Withings Smart Body Analyzer", brand: "Withings", sku: "WS-50" },
];

// Exactly what is on the owner's desktop, transcribed from the folder listing.
const REAL_FOLDERS = [
  "Elements Hexagons Starter Kit (7 Panels)",
  "Govee Smart Outdoor Wall light",
  "LIFX Color A19 Bulb",
  "Oura Ring 4-Brushed Silver-Size 9",
  "SwitchBot",
];

describe("tokenize", () => {
  it("splits on punctuation and case", () => {
    expect(tokenize("Oura Ring 4-Brushed Silver-Size 9"))
      .toEqual(["oura", "ring", "4", "brushed", "silver", "size", "9"]);
  });

  it("folds plurals so Panels and Panel agree", () => {
    expect(tokenize("7 Panels")).toEqual(["7", "panel"]);
    expect(tokenize("7-Panel Kit")).toEqual(["7", "panel", "kit"]);
  });

  it("leaves short words that only look plural alone", () => {
    expect(tokenize("GPS OS")).toEqual(["gps", "os"]);
  });

  it("drops packaging filler that appears on everything", () => {
    expect(tokenize("New Official Govee Pack")).toEqual(["govee"]);
  });
});

describe("similarity", () => {
  it("is 1 for the same string in different dress", () => {
    expect(similarity("Govee Smart Outdoor Wall light", "Govee Smart Outdoor Wall Light")).toBe(1);
  });

  it("is 0 when nothing is shared", () => {
    expect(similarity("SwitchBot", "Withings Smart Body Analyzer")).toBe(0);
  });

  it("survives an empty side without dividing by zero", () => {
    expect(similarity("", "LIFX Color A19 Bulb")).toBe(0);
  });
});

describe("scorePair", () => {
  it("rates a folder whose words are all in the product name as a strong match", () => {
    // "SwitchBot" -> "SwitchBot Hub Mini". Dice alone gives 0.5 here, which is
    // near the threshold; containment is what makes this an obvious yes.
    const score = scorePair("SwitchBot", PRODUCTS.find((p) => p.id === "switchbot")!);
    expect(score).toBeGreaterThan(0.8);
  });

  it("does not reward containment for a one-word folder that means something else", () => {
    expect(scorePair("SwitchBot", PRODUCTS.find((p) => p.id === "withings")!)).toBe(0);
  });

  it("treats an SKU-named folder as near-certain", () => {
    expect(scorePair("H7078", PRODUCTS.find((p) => p.id === "govee")!)).toBeGreaterThan(0.9);
  });
});

describe("matchFolders", () => {
  const matches = matchFolders(REAL_FOLDERS, PRODUCTS);
  const at = (folder: string) => matches.find((m) => m.folder === folder)!;

  it("matches every folder the owner actually has", () => {
    expect(at("LIFX Color A19 Bulb").productId).toBe("lifx");
    expect(at("Govee Smart Outdoor Wall light").productId).toBe("govee");
    expect(at("Oura Ring 4-Brushed Silver-Size 9").productId).toBe("oura");
    expect(at("SwitchBot").productId).toBe("switchbot");
  });

  it("matches the Nanoleaf kit despite the folder using the retail box name", () => {
    // The box says "Elements Hexagons Starter Kit (7 Panels)"; the catalogue
    // says "Nanoleaf Elements 7-Panel Kit". No brand word in common position,
    // no shared word order -- this is the case that justifies token scoring
    // over any kind of prefix or substring test.
    expect(at("Elements Hexagons Starter Kit (7 Panels)").productId).toBe("nanoleaf");
  });

  it("never assigns one product to two folders", () => {
    const assigned = matches.map((m) => m.productId).filter(Boolean);
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("returns null rather than guessing when a folder is unrelated", () => {
    const [m] = matchFolders(["Holiday photos 2024"], PRODUCTS);
    expect(m.productId).toBeNull();
    expect(m.score).toBe(0);
  });

  it("prefers the better pairing when two folders compete for one product", () => {
    // Greedy per-folder would let whichever folder is processed first take
    // "SwitchBot Hub Mini", leaving the other unmatched. Global ordering gives
    // the product to the folder that names it best.
    const [vague, exact] = matchFolders(["SwitchBot", "SwitchBot Hub Mini"], PRODUCTS);
    expect(exact.productId).toBe("switchbot");
    expect(vague.productId).toBeNull();
  });

  it("offers alternatives for a folder it could not place", () => {
    const [m] = matchFolders(["Ring"], PRODUCTS);
    expect(m.productId).toBeNull();
    expect(m.alternatives.some((a) => a.productId === "oura")).toBe(true);
  });

  it("keeps the threshold above the score of a merely plausible pairing", () => {
    // "Smart" alone appears in three product names. If a folder called "Smart"
    // ever matched something, the design has failed.
    const [m] = matchFolders(["Smart"], PRODUCTS);
    expect(m.score).toBeLessThan(MATCH_THRESHOLD);
    expect(m.productId).toBeNull();
  });
});

describe("folderOf", () => {
  it("takes the folder holding the file, not the one that was selected", () => {
    expect(folderOf("ai_products/LIFX Color A19 Bulb/front.jpg")).toBe("LIFX Color A19 Bulb");
  });

  it("handles a deeper tree", () => {
    expect(folderOf("Desktop/aismartstore/ai_products/SwitchBot/1.png")).toBe("SwitchBot");
  });

  it("returns empty for a file with no folder above it", () => {
    expect(folderOf("loose.jpg")).toBe("");
    expect(folderOf("")).toBe("");
  });
});

describe("orderPhotos", () => {
  it("sorts numerically so 10 comes after 2", () => {
    expect(orderPhotos(["10.jpg", "2.jpg", "1.jpg"])).toEqual(["1.jpg", "2.jpg", "10.jpg"]);
  });
});

// The production incident, reproduced as a test.
//
// PostgREST caps every response at 1,000 rows regardless of `.limit()`. The
// Photos screen fetched the catalogue in one request, so the browser only ever
// held the first 1,000 products by name. Of the owner's five folders, only
// Govee (alphabetical index 847) fell inside that window; LIFX, Nanoleaf, Oura
// and SwitchBot all sit past index 3,100 and were simply not in the list being
// matched against. The screen said "no confident match" -- literally true, and
// entirely misleading.
describe("matching against a truncated catalogue", () => {
  // Products the real folders need, positioned as they are in production:
  // Govee early, the rest far past a 1,000-row cut.
  const filler = (n: number, prefix: string): ProductLike[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}-${i}`,
      name: `${prefix} Filler Product ${i}`,
      brand: prefix,
      sku: `${prefix}-SKU-${i}`,
    }));

  const FULL: ProductLike[] = [
    ...filler(800, "Aaa"),
    { id: "govee", name: "Govee Smart Outdoor Wall Light", brand: "Govee", sku: "H7078" },
    ...filler(2200, "Zzz"),
    { id: "lifx", name: "LIFX Color A19 Bulb", brand: "LIFX", sku: "GW-T-LIFX Color A19/E26" },
    { id: "nanoleaf", name: "Nanoleaf Elements 7-Panel Kit", brand: "Nanoleaf", sku: "NL52-K-7002HB-7PK" },
    { id: "oura", name: "Oura Ring 4 (Silver, Size 9)", brand: "Oura", sku: "GW-T-Oura Ring 4-Silver-Size 9" },
    { id: "switchbot", name: "SwitchBot Hub Mini", brand: "SwitchBot", sku: "GW-T-Switchbot Hub Mini Smart remote" },
  ];

  it("reproduces the failure when only the first 1,000 rows are loaded", () => {
    const truncated = FULL.slice(0, 1000);
    const matched = matchFolders(REAL_FOLDERS, truncated).filter((m) => m.productId);
    // Exactly what the owner saw: one folder of five, and it is Govee.
    expect(matched).toHaveLength(1);
    expect(matched[0].productId).toBe("govee");
  });

  it("matches all five once the whole catalogue is loaded", () => {
    const matched = matchFolders(REAL_FOLDERS, FULL).filter((m) => m.productId);
    expect(matched).toHaveLength(5);
    expect(new Set(matched.map((m) => m.productId))).toEqual(
      new Set(["govee", "lifx", "nanoleaf", "oura", "switchbot"]),
    );
  });
});
