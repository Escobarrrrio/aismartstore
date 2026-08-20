// Protects admin-curated photography from being overwritten by the
// distributor feed.
//
// The Photos module uploads to our own `product-images` storage bucket
// because the distributor either has no image for that SKU or supplies a
// bad one. Until now the next sync (every 15 minutes) upserted the
// distributor's `images` array straight over the top, so a photo the owner
// had just uploaded silently disappeared. Any URL that points at our own
// storage bucket is by definition ours, never Axiz's — that is the marker.

/** True when the URL was uploaded through the admin Photos module. */
export function isAdminImage(url: string): boolean {
  return url.includes("/storage/v1/object/public/product-images/");
}

export function hasAdminImages(images: string[] | null | undefined): boolean {
  return (images ?? []).some(isAdminImage);
}

/**
 * Merge the distributor's images with what is already stored, keeping every
 * admin upload and keeping it first (images[0] is the cover everywhere).
 * Distributor images are appended as extra gallery shots, de-duplicated.
 */
export function mergeAdminImages(
  distributor: string[],
  existing: string[] | null | undefined,
  maxImages = 6,
): string[] {
  const admin = (existing ?? []).filter(isAdminImage);
  if (admin.length === 0) return distributor;
  const out = [...admin];
  for (const url of distributor) {
    if (!out.includes(url)) out.push(url);
  }
  return out.slice(0, maxImages);
}
