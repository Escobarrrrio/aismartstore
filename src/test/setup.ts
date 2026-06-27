import "@testing-library/jest-dom";
import "@/lib/i18n";
import i18n from "@/lib/i18n";

// Tests render components in isolation (not through main.tsx), so the
// i18next side-effect import there never runs. Without this, every t()
// call falls back to returning the raw key (e.g. "auth.signIn" instead
// of "Sign In"), which silently breaks any test asserting on real copy.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
