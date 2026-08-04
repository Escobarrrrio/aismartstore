// Matches a folder of product photos to the products they belong to.
//
// WHY THIS EXISTS
// ---------------
// The photos for the manually-sourced products live on the owner's laptop, in
// one folder per product ("ai_products/LIFX Color A19 Bulb/…"). Getting them
// onto the site meant finding each product in a table of 88,000 rows, opening
// its edit row, and uploading — six times, and only after knowing the edit row
// had an upload control at all. That is why the products still had placeholders
// weeks after the photos existed.
//
// A browser can hand us the whole folder tree at once (`webkitdirectory`), and
// each file arrives carrying its `webkitRelativePath`. The parent folder name
// is therefore a label the owner already wrote, by hand, for exactly this
// purpose. This module turns those labels back into product ids.
//
// It is deliberately a pure function over strings: no File objects, no network,
// no Supabase. The matching is the part that can be wrong in ways nobody
// notices until a photo of a ring is showing on a light bulb, so it is the part
// that gets unit tests.

export interface ProductLike {
  id: string;
  name: string;
  brand?: string | null;
  sku?: string | null;
}

export interface FolderMatch {
  folder: string;
  /** Best product for this folder, or null when nothing scored high enough. */
  productId: string | null;
  /** Dice coefficient of the winning pair, 0-1. */
  score: number;
  /** Next-best candidates, so the review table can offer a one-click correction. */
  alternatives: Array<{ productId: string; score: number }>;
}

/**
 * Below this, a suggestion is worse than no suggestion.
 *
 * A wrong photo on a live product page is more damaging than a missing one: a
 * missing photo reads as "not photographed yet", a wrong one reads as "this
 * shop does not know what it is selling". So the threshold sits high enough
 * that near-misses come back unmatched and wait for a human, rather than being
 * quietly assigned.
 */
export const MATCH_THRESHOLD = 0.34;

const STOPWORDS = new Set([
  "the", "and", "with", "for", "a", "an", "of", "in", "by",
  // Retail packaging noise that appears on nearly every folder and product
  // name, so it carries no signal but inflates every score if left in.
  "new", "official", "genuine", "original", "pack", "set",
]);

/** Lowercase, strip punctuation, split "7-Panel" into "7" and "panel". */
export function tokenize(input: string): string[] {
  return String(input ?? "")
    .toLowerCase()
    // Insert a break between a digit and a letter so "a19" stays whole but
    // "7panel" and "7-panel" both become "7" + "panel".
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    // Crude singularisation. "Panels" and "Panel" must agree, and a real
    // stemmer is a dependency and a behaviour change for a five-line problem.
    // Guarded on length so "gps" and "os" survive intact.
    .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t));
}

/** Sørensen–Dice over token sets: 2·|A∩B| / (|A|+|B|). */
export function similarity(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/**
 * Score one folder name against one product.
 *
 * Dice alone under-rates the real cases: a folder called "SwitchBot" is a
 * perfect, unambiguous label for "SwitchBot Hub Mini", but scores only 0.5
 * because the product name carries two extra words the owner did not bother to
 * type. Containment is the signal that matters when a human names a folder --
 * they write the distinguishing part and drop the rest -- so a folder whose
 * tokens are entirely contained in the product name is treated as a strong
 * match regardless of how much extra the product name carries.
 */
export function scorePair(folder: string, product: ProductLike): number {
  const dice = similarity(folder, product.name);

  const folderTokens = tokenize(folder);
  const nameTokens = new Set(tokenize(product.name));
  const contained = folderTokens.length > 0 && folderTokens.every((t) => nameTokens.has(t));

  // Containment is only trustworthy when the folder said something specific.
  //
  // A single common word is contained in half the catalogue: "Smart" sits
  // inside three of these product names and "Ring" inside one, and the first
  // version of this scored both at 0.82 -- a confident match, on a word that
  // identifies nothing. The unit tests caught it, which is the whole reason the
  // scoring lives in a pure module.
  //
  // Two or more words is enough on its own. One word is enough only when it is
  // the brand, because that is the case this rule exists for: a folder called
  // "SwitchBot" holding photos of the SwitchBot Hub Mini.
  const brandTokens = new Set(tokenize(product.brand ?? ""));
  const specific = folderTokens.length >= 2 || (folderTokens.length === 1 && brandTokens.has(folderTokens[0]));
  const containment = contained && specific ? 0.82 : 0;

  // The SKU is the one identifier that cannot coincide. If the owner named a
  // folder after it, that is not a guess, it is an answer.
  const sku = (product.sku ?? "").trim();
  const skuHit = sku.length >= 4 && similarity(folder, sku) >= 0.6 ? 0.95 : 0;

  // A folder named with a single generic word cannot identify a product, and
  // Dice alone will happily say otherwise: "Smart" against "Withings Smart Body
  // Analyzer" is 2·1/(1+4) = 0.4, over the threshold, on a word that appears in
  // three of these six names. Damping rather than zeroing keeps the pairing
  // visible as a suggestion in the review table -- where a human can accept it
  // -- without it ever being applied unattended.
  const generic = folderTokens.length === 1 && containment === 0 && skuHit === 0;
  const base = generic ? dice * 0.5 : dice;

  return Math.max(base, containment, skuHit);
}

/**
 * Assign folders to products, one product per folder and one folder per
 * product.
 *
 * Greedy over the globally-sorted pair list rather than best-match-per-folder:
 * with two similar products ("Nanoleaf Elements 7-Panel Kit" and a future
 * "Nanoleaf Elements 4-Panel Kit"), per-folder greed can hand both folders to
 * whichever product one of them likes marginally more, leaving the other
 * unmatched and the first holding two sets of photos. Sorting all pairs first
 * means the most confident assignment is always made before the ones that
 * depend on it.
 */
export function matchFolders(folders: string[], products: ProductLike[]): FolderMatch[] {
  const pairs: Array<{ folder: string; productId: string; score: number }> = [];
  for (const folder of folders) {
    for (const p of products) {
      const score = scorePair(folder, p);
      if (score > 0) pairs.push({ folder, productId: p.id, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const takenFolders = new Set<string>();
  const takenProducts = new Set<string>();
  const winners = new Map<string, { productId: string; score: number }>();

  for (const pair of pairs) {
    if (pair.score < MATCH_THRESHOLD) break;
    if (takenFolders.has(pair.folder) || takenProducts.has(pair.productId)) continue;
    winners.set(pair.folder, { productId: pair.productId, score: pair.score });
    takenFolders.add(pair.folder);
    takenProducts.add(pair.productId);
  }

  return folders.map((folder) => {
    const won = winners.get(folder);
    const alternatives = pairs
      .filter((p) => p.folder === folder && p.productId !== won?.productId)
      .slice(0, 4)
      .map(({ productId, score }) => ({ productId, score }));
    return {
      folder,
      productId: won?.productId ?? null,
      score: won?.score ?? 0,
      alternatives,
    };
  });
}

/**
 * The folder a file sits in, from a `webkitRelativePath`.
 *
 * "ai_products/LIFX Color A19 Bulb/front.jpg" -> "LIFX Color A19 Bulb".
 * A file dropped without a folder (plain multi-select) returns "", which the
 * caller treats as "needs manual assignment" rather than guessing.
 */
export function folderOf(relativePath: string): string {
  const parts = String(relativePath ?? "").split("/").filter(Boolean);
  // Last part is the filename; the one before it is the folder that names the
  // product. Anything above that is the container the owner selected.
  return parts.length >= 2 ? parts[parts.length - 2] : "";
}

/** Photos before other files, then by filename, so "1.jpg"/"front.jpg" leads. */
export function orderPhotos(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
}
