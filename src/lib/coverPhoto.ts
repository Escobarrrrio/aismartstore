// Which photo a product leads with.
//
// `products.images[0]` is the cover: it is what the catalogue card shows, what
// the home page shows, what the newsletter shows, and what Google puts in a
// shopping result. Everything downstream reads position zero.
//
// Until now nothing chose it. The upload order did -- and the upload order is
// whatever the operating system's file dialog handed over, which for a folder
// of twenty-four photos is usually alphabetical by filename. That is how a
// product ends up leading with a close-up of a plug or a box corner while the
// good hero shot sits fourth.
//
// These are separated from the UI so the reordering rules can be tested
// without a browser, and so the same rules apply wherever they are used.

/**
 * Moves the photo at `index` to the front, keeping every other photo in its
 * existing relative order.
 *
 * Returns the original array (not a copy) when the move is a no-op, so callers
 * can skip a pointless database write with `if (next !== images)`.
 */
export function promoteToCover(images: string[], index: number): string[] {
  if (index <= 0 || index >= images.length) return images;
  return [images[index], ...images.slice(0, index), ...images.slice(index + 1)];
}

/**
 * Removes the photo at `index`.
 *
 * Deleting the cover promotes whatever was next, which is the behaviour that
 * needs no explanation. Deleting the last photo is allowed and yields an empty
 * array -- the caller decides what that means for the product's visibility,
 * because "this product now has no photo" is a merchandising decision, not an
 * array operation.
 */
export function removePhoto(images: string[], index: number): string[] {
  if (index < 0 || index >= images.length) return images;
  return [...images.slice(0, index), ...images.slice(index + 1)];
}

/**
 * True when a product would be publishable given these photos.
 *
 * Mirrors the catalogue gate: a product with no photo is hidden from the
 * storefront regardless of anything else about it.
 */
export function hasUsableCover(images: string[] | null | undefined): boolean {
  return Array.isArray(images) && images.length > 0 && typeof images[0] === "string" && images[0].trim() !== "";
}
