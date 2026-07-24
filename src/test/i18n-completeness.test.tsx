import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import i18n from "@/lib/i18n";
import { LocaleProvider } from "@/contexts/LocaleContext";
import { ProductProvider } from "@/contexts/ProductContext";
import Index from "@/pages/Index";

// ProductContext, Index's AI-picks query, and the hero's StorefrontShowcase
// all fetch from Supabase on mount. The homepage's static copy (hero,
// category cards, trust row, feature bar) doesn't depend on that data, so
// we stub it out with a generic chainable query-builder mock rather than
// hit the network in a unit test -- every filter/order/limit call just
// returns the same thenable builder, which resolves to an empty result.
const FILTER_METHODS = [
  "select", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is",
  "in", "contains", "containedBy", "not", "or", "filter", "order", "limit", "range",
] as const;

const makeQueryBuilder = (): any => {
  const builder: any = {
    then: (resolve: any) => resolve({ data: [], error: null, count: 0 }),
  };
  for (const method of FILTER_METHODS) builder[method] = () => builder;
  return builder;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => makeQueryBuilder(),
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}));

const renderHome = () =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <LocaleProvider>
          <ProductProvider>
            <Index />
          </ProductProvider>
        </LocaleProvider>
      </MemoryRouter>
    </HelmetProvider>
  );

// English strings that previously remained on screen after switching the
// language selector -- this is the bug a customer screenshotted (the hero
// heading, category descriptions, and trust badges stayed in English while
// the nav and search box translated). If any of these reappear after a
// language switch, full-site i18n coverage has regressed.
const ENGLISH_LANDMARKS = [
  "Secure Payments",
  "SA-Wide Delivery",
  "Trusted Supplier",
  "Shop by Category",
];

describe("i18n completeness (homepage)", () => {
  afterEach(() => {
    void i18n.changeLanguage("en");
  });

  it("shows the expected English landmarks in the default English locale", async () => {
    await i18n.changeLanguage("en");
    renderHome();
    await waitFor(() => {
      expect(screen.getByText(/Secure Payments/)).toBeInTheDocument();
    });
    for (const phrase of ["SA-Wide Delivery", "Shop by Category", "Trusted Supplier"]) {
      expect(screen.getByText(phrase)).toBeInTheDocument();
    }
  });

  it("leaves no English landmark strings on screen when switched to isiXhosa", async () => {
    await i18n.changeLanguage("xh");
    renderHome();

    // Something Xhosa-specific should be visible -- proves the switch
    // actually took effect rather than silently failing.
    await waitFor(() => {
      expect(screen.getByText(/Thenga ngeNdidi/)).toBeInTheDocument();
    });

    for (const phrase of ENGLISH_LANDMARKS) {
      expect(screen.queryByText(phrase)).not.toBeInTheDocument();
    }
  });

  it("leaves no English landmark strings on screen when switched to Afrikaans", async () => {
    await i18n.changeLanguage("af");
    renderHome();

    await waitFor(() => {
      expect(screen.getByText(/Koop volgens Kategorie/)).toBeInTheDocument();
    });

    for (const phrase of ENGLISH_LANDMARKS) {
      expect(screen.queryByText(phrase)).not.toBeInTheDocument();
    }
  });
});
