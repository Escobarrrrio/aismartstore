import DOMPurify from "dompurify";

// Product descriptions arrive as raw HTML from the Axiz distributor feed
// (axiz-sync writes item.productDescription straight through). That content is
// third-party and must never reach the DOM unsanitised -- the site's CSP is
// currently report-only, so it would not catch an injected script.

const ALLOWED_TAGS = [
  "p", "br", "b", "strong", "i", "em", "u", "sub", "sup",
  "ul", "ol", "li", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td", "span", "div",
];

export function sanitizeProductHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    // No attributes at all: strips style/onclick/href and anything else that
    // could carry script or exfiltrate a click, while keeping the formatting.
    ALLOWED_ATTR: [],
  });
}

// Plain-text form for places that must not contain markup: meta descriptions,
// JSON-LD, og: tags. Renders entities so "&amp;" doesn't leak into search results.
export function stripHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
  const el = document.createElement("textarea");
  el.innerHTML = clean;
  return el.value.replace(/\s+/g, " ").trim();
}
