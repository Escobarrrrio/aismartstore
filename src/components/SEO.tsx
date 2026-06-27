import { Helmet } from "react-helmet-async";

interface SEOProps {
  title: string;
  description: string;
  /** Path only, e.g. "/products" -- the origin is added automatically. */
  path?: string;
  image?: string;
  /** Arbitrary JSON-LD object(s) -- Product, BreadcrumbList, etc. */
  jsonLd?: object | object[];
  noindex?: boolean;
}

const SITE_NAME = "AI Smart Store";
const DEFAULT_IMAGE = "/og-image.png";

/**
 * Per-route SEO tags. The static <head> in index.html only covers the
 * homepage; every other route (especially /product/:id, which is what
 * Google actually needs to rank individual products) needs its own
 * title, description, canonical URL, and social preview image.
 */
const SEO = ({ title, description, path, image, jsonLd, noindex }: SEOProps) => {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://aismartstore.lovable.app";
  const url = `${origin}${path || (typeof window !== "undefined" ? window.location.pathname : "")}`;
  const fullTitle = title === SITE_NAME ? title : `${title} | ${SITE_NAME}`;
  const ogImage = image ? (image.startsWith("http") ? image : `${origin}${image}`) : `${origin}${DEFAULT_IMAGE}`;
  const jsonLdArray = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      {noindex && <meta name="robots" content="noindex,nofollow" />}

      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:type" content={path === "/" ? "website" : "product"} />

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
