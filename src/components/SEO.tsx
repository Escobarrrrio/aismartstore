import { Helmet } from "react-helmet-async";
import { SUPPORTED_LANGUAGES } from "@/lib/i18n";

interface SEOProps {
  title: string;
  description: string;
  /** Path only, e.g. "/products" -- the origin is added automatically. */
  path?: string;
  image?: string;
  /** Arbitrary JSON-LD object(s) -- Product, BreadcrumbList, etc. */
  jsonLd?: object | object[];
  noindex?: boolean;
  /** Skip hreflang alternates -- use for pages with no real SEO value (cart, checkout, account). */
  skipHreflang?: boolean;
}

const SITE_NAME = "AI Smart Store";
const DEFAULT_IMAGE = "/og-image.png";

/**
 * Per-route SEO tags. The static <head> in index.html only covers the
 * homepage; every other route (especially /product/:id, which is what
 * Google actually needs to rank individual products) needs its own
 * title, description, canonical URL, and social preview image.
 *
 * hreflang note: this site's language switching is localStorage-based
 * (i18next), which Googlebot has no way to trigger -- a crawl always
 * sees whatever the default/detected language renders. Declaring
 * hreflang alternates that all point at the identical URL would be
 * incorrect per Google's own spec (each alternate must resolve to a
 * URL that actually serves that language) and likely ignored. Instead,
 * each language gets a real, distinct, crawlable URL via ?lang=, which
 * the i18next querystring detector picks up on load -- so the URLs
 * Google indexes genuinely do render in the declared language.
 */
const SEO = ({ title, description, path, image, jsonLd, noindex, skipHreflang }: SEOProps) => {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://aismartstore.lovable.app";
  const pagePath = path || (typeof window !== "undefined" ? window.location.pathname : "");
  const url = `${origin}${pagePath}`;
  const fullTitle = title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;
  const ogImage = image ? (image.startsWith("http") ? image : `${origin}${image}`) : `${origin}${DEFAULT_IMAGE}`;
  const jsonLdArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      {!noindex && !skipHreflang && (
        <>
          <link rel="alternate" hrefLang="x-default" href={url} />
          {SUPPORTED_LANGUAGES.map((l) => (
            <link key={l.code} rel="alternate" hrefLang={l.code} href={`${url}?lang=${l.code}`} />
          ))}
        </>
      )}

      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:type" content={path === "/" ? "website" : "product"} />
      <meta property="og:locale" content="en_ZA" />

      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {jsonLdArray.map((obj, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(obj)}
        </script>
      ))}
    </Helmet>
  );
};

export default SEO;
