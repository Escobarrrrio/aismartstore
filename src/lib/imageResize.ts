// Downscales a photo in the browser before it is uploaded.
//
// The upload control this replaces rejected anything over 4MB and told the
// owner to "resize it first". That is a real constraint wearing the wrong
// clothes: shoppers on mobile data do pay for every byte of a 12MB photo, but
// the person who has the photo has no obvious way to shrink it and no reason to
// know that a product page needs a 1600px image rather than a 4000px one. The
// rejection is technically correct advice that stops the job getting done, and
// the job not getting done is why products still show placeholders.
//
// So: resize instead of refuse. The constraint is enforced more strictly than
// before -- every image comes out within budget, not just the ones that
// happened to arrive small -- while the owner does nothing.

/** Longest edge of the stored image. Product cards render at ~400px; the
 *  lightbox and retina displays are what the headroom is for. */
export const MAX_EDGE_PX = 1600;

/** JPEG quality. 0.85 is the point where further compression starts showing on
 *  product photography (gradients on matte plastic band first). */
const QUALITY = 0.85;

/** Anything at or under this is left byte-for-byte alone. */
const PASSTHROUGH_BYTES = 350 * 1024;

export interface ResizedImage {
  blob: Blob;
  /** Extension to store it under, which may differ from the input's. */
  ext: string;
  originalBytes: number;
  bytes: number;
}

/**
 * Returns a web-sized version of `file`, or the original when it is already
 * small enough and in a format browsers handle well.
 *
 * PNG is preserved only for small files. A large PNG of a photograph is a photo
 * in the wrong container -- re-encoding it to JPEG is typically a 90% saving
 * with no visible difference. PNGs *with transparency* would lose their cutout
 * background on that conversion, which matters for product shots on white, so
 * the alpha channel is sampled before deciding.
 */
export async function resizeForWeb(file: File): Promise<ResizedImage> {
  const originalBytes = file.size;
  const inferredExt = (file.name.split(".").pop() || "jpg").toLowerCase();

  if (originalBytes <= PASSTHROUGH_BYTES) {
    return { blob: file, ext: inferredExt, originalBytes, bytes: originalBytes };
  }

  const bitmap = await loadBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, ext: inferredExt, originalBytes, bytes: originalBytes };
    ctx.drawImage(bitmap, 0, 0, w, h);

    const keepAlpha = file.type === "image/png" && hasTransparency(ctx, w, h);
    const type = keepAlpha ? "image/png" : "image/jpeg";
    const ext = keepAlpha ? "png" : "jpg";

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, type === "image/jpeg" ? QUALITY : undefined),
    );
    // A re-encode that came out larger is a re-encode worth discarding. Happens
    // with already-optimised JPEGs small enough to skip the scale step.
    if (!blob || blob.size >= originalBytes) {
      return { blob: file, ext: inferredExt, originalBytes, bytes: originalBytes };
    }
    return { blob, ext, originalBytes, bytes: blob.size };
  } finally {
    // createImageBitmap allocates outside the JS heap; without this a folder of
    // forty photos holds forty decoded bitmaps until GC notices.
    if ("close" in bitmap) (bitmap as ImageBitmap).close();
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  return await createImageBitmap(file);
}

/**
 * Samples the alpha channel on a grid rather than reading every pixel.
 *
 * A full read of a 4000x3000 image is 48MB of Uint8ClampedArray per photo, on
 * the main thread, for a yes/no question. A 40x40 grid answers it: product
 * cutouts have transparent *corners and edges*, which a grid always lands on,
 * and the failure mode of a miss is a JPEG with a white background -- the same
 * thing every other product photo on the site already is.
 */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = Math.min(w - 1, Math.round((i / steps) * (w - 1)));
      const y = Math.min(h - 1, Math.round((j / steps) * (h - 1)));
      if (ctx.getImageData(x, y, 1, 1).data[3] < 250) return true;
    }
  }
  return false;
}

export const formatBytes = (n: number): string =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
