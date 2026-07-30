/**
 * Deterministic cover art for AI Pulse stories that have no photograph.
 *
 * 919 of 1 200 stored stories have no `image_url`, and many never will: arXiv
 * abstract pages, GitHub repos, PDFs and plain-text posts simply do not publish
 * an og:image. Rendering all of them with one flat grey tile made the feed look
 * broken even though nothing was.
 *
 * So instead of a placeholder, each story gets its own generated cover, derived
 * from a hash of its URL. Same story, same cover, forever -- no flicker between
 * renders, no random palette on every page load, and nothing to store.
 *
 * Generated geometry rather than stock photography is also the only honest
 * option: we do not own press imagery for someone else's article, and dressing
 * a story in an unrelated photo would misrepresent it.
 */

export interface CoverArt {
  /** CSS gradient for the tile background. */
  background: string;
  /** Ink colour for the icon and label, contrast-checked against `background`. */
  ink: string;
  /** Which decorative motif to draw. */
  motif: "grid" | "rays" | "dots" | "waves" | "arcs";
  /** Rotation applied to the motif, in degrees. */
  angle: number;
}

/**
 * FNV-1a. Chosen over a naive `charCodeAt` sum because ordering matters here:
 * two stories whose titles are anagrams (or share a prefix, which URLs from the
 * same publisher very often do) must not land on the same cover.
 */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Math.imul keeps the multiply in 32-bit space; a plain `*` overflows into
    // a float and silently collapses the low bits that make the hash spread.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Palettes are keyed to the story's category so the feed still reads as
 * organised at a glance -- research is cool/violet, local African stories are
 * warm, news is neutral-blue -- while the specific pairing inside a category
 * varies per story.
 */
const PALETTES: Record<string, { from: string; to: string; ink: string }[]> = {
  research: [
    { from: "#312e81", to: "#6d28d9", ink: "#ede9fe" },
    { from: "#1e1b4b", to: "#4338ca", ink: "#e0e7ff" },
    { from: "#4c1d95", to: "#7c3aed", ink: "#f5f3ff" },
  ],
  news: [
    { from: "#0f172a", to: "#1d4ed8", ink: "#dbeafe" },
    { from: "#082f49", to: "#0369a1", ink: "#e0f2fe" },
    { from: "#111827", to: "#334155", ink: "#e2e8f0" },
  ],
  local: [
    { from: "#7c2d12", to: "#ea580c", ink: "#ffedd5" },
    { from: "#713f12", to: "#ca8a04", ink: "#fef9c3" },
    { from: "#831843", to: "#be185d", ink: "#fce7f3" },
  ],
};

const MOTIFS: CoverArt["motif"][] = ["grid", "rays", "dots", "waves", "arcs"];

export function coverArt(seed: string, category: string): CoverArt {
  const h = hashString(seed || "ai-pulse");
  const palette = PALETTES[category] ?? PALETTES.news;
  const { from, to, ink } = palette[h % palette.length];
  // Independent bit ranges per property, so motif and angle do not move in
  // lockstep with the palette choice.
  const motif = MOTIFS[(h >>> 8) % MOTIFS.length];
  const angle = ((h >>> 16) % 8) * 45;
  return {
    background: `linear-gradient(${135 + ((h >>> 4) % 4) * 15}deg, ${from} 0%, ${to} 100%)`,
    ink,
    motif,
    angle,
  };
}

/**
 * The motif as an inline SVG data URI, used as a second background layer.
 * Kept as a data URI rather than a component so it composes with the gradient
 * in one `background` declaration and costs no extra DOM nodes in a grid that
 * can render 60 tiles.
 */
export function motifDataUri(art: CoverArt): string {
  const stroke = encodeURIComponent(art.ink);
  const body = {
    grid: `<path d="M0 20h80M0 40h80M0 60h80M20 0v80M40 0v80M60 0v80" stroke="${art.ink}" stroke-width="1" fill="none"/>`,
    rays: `<path d="M40 40L0 0M40 40L80 0M40 40L0 80M40 40L80 80M40 40L40 0M40 40L40 80" stroke="${art.ink}" stroke-width="1.5" fill="none"/>`,
    dots: `<g fill="${art.ink}"><circle cx="20" cy="20" r="3"/><circle cx="60" cy="20" r="3"/><circle cx="20" cy="60" r="3"/><circle cx="60" cy="60" r="3"/><circle cx="40" cy="40" r="4.5"/></g>`,
    waves: `<path d="M0 25q20 -15 40 0t40 0M0 55q20 -15 40 0t40 0" stroke="${art.ink}" stroke-width="1.5" fill="none"/>`,
    arcs: `<g stroke="${art.ink}" stroke-width="1.5" fill="none"><circle cx="40" cy="40" r="12"/><circle cx="40" cy="40" r="24"/><circle cx="40" cy="40" r="36"/></g>`,
  }[art.motif];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><g transform="rotate(${art.angle} 40 40)">${body}</g></svg>`;
  // encodeURIComponent rather than btoa: the palette strings are ASCII, but
  // btoa throws on any non-Latin-1 character and this must never throw inside
  // a render path.
  void stroke;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
