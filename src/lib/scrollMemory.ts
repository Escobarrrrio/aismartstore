// Remembering where a shopper was on a long page.
//
// The catalogue's filters, sort and page number all live in the URL, so going
// back already restores *what* was on screen. What it does not restore is
// where you were in it: you come back from a product and land at the top of
// page 4 having lost your place among sixty cards.
//
// The browser has native scroll restoration for exactly this, and in a
// single-page app it does not work. On a normal page load the document is its
// full height by the time the browser restores the offset. Here, going back
// renders an empty grid first and fetches the products after, so at the moment
// the browser tries to scroll to 4,200px the document is 900px tall, the scroll
// is clamped to the bottom of nothing, and by the time the cards arrive the
// moment has passed.
//
// So: record the offset ourselves against the history entry, and on the way
// back keep trying to apply it until the page is actually tall enough to hold
// it, or until it is clear the content is not coming.
//
// Pure functions here, no DOM, so the retry rules can be tested.

const PREFIX = "scroll:";

/** How long to keep trying before accepting the page will not get taller. */
export const RESTORE_TIMEOUT_MS = 2000;

/**
 * Whether `offset` can actually be applied to a document of this height.
 *
 * Scrolling to 4,200px in a 900px document silently lands at 0 and the
 * position is lost for good, so the attempt is worth deferring rather than
 * spending.
 */
export function canRestore(offset: number, documentHeight: number, viewportHeight: number): boolean {
  if (offset <= 0) return true;
  return documentHeight - viewportHeight >= offset;
}

/**
 * Whether to keep waiting for more content.
 *
 * Gives up on time rather than on attempts: a slow connection deserves the
 * same number of milliseconds as a fast one, not the same number of frames.
 */
export function shouldKeepTrying(elapsedMs: number, timeoutMs: number = RESTORE_TIMEOUT_MS): boolean {
  return elapsedMs < timeoutMs;
}

/**
 * The best offset available when time has run out.
 *
 * Clamped to what the document can actually take, so a page that came back
 * shorter than it was lands at its own bottom rather than at the top. Landing
 * near where you were beats landing nowhere near it.
 */
export function clampOffset(offset: number, documentHeight: number, viewportHeight: number): number {
  const max = Math.max(0, documentHeight - viewportHeight);
  return Math.max(0, Math.min(offset, max));
}

/**
 * Records an offset against a history entry.
 *
 * sessionStorage, not memory: a full page reload keeps the same history
 * entries, and losing the map on reload would silently stop restoring.
 * Failures are swallowed -- Safari's private mode throws on write, and no
 * scroll position is worth breaking navigation over.
 */
export function remember(key: string, offset: number, storage: Storage | undefined = safeSessionStorage()): void {
  if (!key || !storage) return;
  try {
    storage.setItem(PREFIX + key, String(Math.round(offset)));
  } catch {
    /* quota or private mode -- not worth an error */
  }
}

/** Reads a remembered offset, or null when there is none to apply. */
export function recall(key: string, storage: Storage | undefined = safeSessionStorage()): number | null {
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(PREFIX + key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function forget(key: string, storage: Storage | undefined = safeSessionStorage()): void {
  if (!key || !storage) return;
  try {
    storage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

function safeSessionStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}
