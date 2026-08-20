import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import i18n from "@/lib/i18n";
import AiCapabilityPanel from "@/components/AiCapabilityPanel";
import { deriveAiHighlights, deriveUseCaseBadges } from "@/lib/ai-specs";
import en from "@/lib/locales/en.json";
import af from "@/lib/locales/af.json";
import xh from "@/lib/locales/xh.json";
import zu from "@/lib/locales/zu.json";
import st from "@/lib/locales/st.json";

/**
 * Two pieces of copy carry most of the trust in this storefront: the
 * "Why am I seeing this?" explanation under recommendation bundles, and the
 * AI-outcome badging that turns "45 TOPS" into a sentence a shopper
 * understands. Both were shipped English-first and are easy to regress when
 * new keys are added, so this suite asserts:
 *   1. every South African locale defines the full key set (no silent
 *      fallback to English mid-paragraph), and
 *   2. the panel actually renders translated strings, not raw key paths.
 */

const LOCALES: Record<string, Record<string, unknown>> = { en, af, xh, zu, st };
const SA_LOCALES = ["af", "xh", "zu", "st"] as const;

/** Flattens a nested locale object into dotted key paths -> string values. */
const flatten = (obj: unknown, prefix = ""): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v, path));
    else if (typeof v === "string") out[path] = v;
  }
  return out;
};

const subtree = (locale: Record<string, unknown>, root: string) =>
  flatten(locale[root], root);

// A laptop with a Copilot+-class NPU, a discrete GPU and plenty of RAM, so
// every highlight branch and several use-case badges are exercised at once.
const AI_LAPTOP = {
  ai_npu_tops: 45,
  ai_gpu_model: "RTX 4060",
  ai_ram_gb: 32,
  ai_use_cases: ["video_rendering", "data_science"],
  name: "Test AI Laptop",
  category: "Laptops",
} as never;

describe("AI copy translation coverage", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  for (const root of ["recommendWhy", "aiSpecs"] as const) {
    it(`defines every ${root} key in all South African locales`, () => {
      const expected = Object.keys(subtree(en as never, root));
      expect(expected.length).toBeGreaterThan(5);

      for (const code of SA_LOCALES) {
        const actual = subtree(LOCALES[code] as never, root);
        const missing = expected.filter((k) => !actual[k]);
        expect(missing, `${code}.json is missing ${root} keys`).toEqual([]);

        // Placeholders such as {{metric}} must survive translation, or the
        // rendered string shows an empty gap instead of the spec name.
        for (const key of expected) {
          const placeholders = (flatten(en as never)[key]?.match(/{{\s*\w+\s*}}/g) ?? []).sort();
          const translated = (actual[key].match(/{{\s*\w+\s*}}/g) ?? []).sort();
          expect(translated, `${code}.json ${key} lost a placeholder`).toEqual(placeholders);
        }
      }
    });
  }

  it("does not leave translated strings identical to English across the board", () => {
    // A locale file copy-pasted from en.json is a silent regression: the UI
    // "supports" the language but nothing is actually translated.
    const enKeys = subtree(en as never, "aiSpecs");
    for (const code of SA_LOCALES) {
      const actual = subtree(LOCALES[code] as never, "aiSpecs");
      const differing = Object.keys(enKeys).filter((k) => actual[k] !== enKeys[k]);
      expect(differing.length, `${code}.json looks untranslated`).toBeGreaterThan(0);
    }
  });
});

describe("AI outcome badging renders in every portal language", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("derives highlights and badges from hardware specs", () => {
    const highlights = deriveAiHighlights(AI_LAPTOP);
    const badges = deriveUseCaseBadges(AI_LAPTOP);
    expect(highlights.length).toBeGreaterThan(0);
    expect(badges.length).toBeGreaterThan(0);
    // 45 TOPS must resolve to the Copilot+ outcome, not the baseline one.
    expect(highlights.some((h) => h.outcomeKey?.includes("outcomeHigh"))).toBe(true);
  });

  for (const code of ["en", ...SA_LOCALES] as const) {
    it(`renders the capability panel in "${code}" without leaking key paths`, async () => {
      await i18n.changeLanguage(code);
      const { container, unmount } = render(<AiCapabilityPanel product={AI_LAPTOP} />);

      await waitFor(() => {
        expect(screen.getByText(LOCALES[code]["aiSpecs"] &&
          (LOCALES[code] as never as Record<string, Record<string, string>>)["aiSpecs"]["panelTitle"])).toBeTruthy();
      });

      // Untranslated i18next lookups fall through as the raw dotted key.
      expect(container.textContent ?? "").not.toMatch(/aiSpecs\.[a-zA-Z.]+/);
      expect(container.textContent ?? "").not.toMatch(/{{\s*\w+\s*}}/);
      unmount();
    });
  }
});
