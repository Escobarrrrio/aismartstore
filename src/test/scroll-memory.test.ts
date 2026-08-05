import { describe, it, expect, beforeEach } from "vitest";
import {
  canRestore, shouldKeepTrying, clampOffset, remember, recall, forget, RESTORE_TIMEOUT_MS,
} from "@/lib/scrollMemory";

/** Minimal in-memory Storage, so the tests do not depend on a real browser. */
const makeStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  } as Storage;
};

describe("canRestore", () => {
  it("is true once the page is tall enough to hold the offset", () => {
    // 4200 needs 4200 + viewport of document.
    expect(canRestore(4200, 5000, 800)).toBe(true);
  });

  it("is FALSE while the page is still short", () => {
    // This is the whole bug: going back renders an empty grid, so at this
    // instant scrolling to 4200 would clamp to ~100 and the position is gone.
    expect(canRestore(4200, 900, 800)).toBe(false);
  });

  it("is true at the exact boundary", () => {
    expect(canRestore(4200, 5000, 800)).toBe(true);
    expect(canRestore(4201, 5000, 800)).toBe(false);
  });

  it("is always true for the top of the page", () => {
    expect(canRestore(0, 0, 800)).toBe(true);
  });
});

describe("shouldKeepTrying", () => {
  it("keeps waiting inside the window", () => {
    expect(shouldKeepTrying(0)).toBe(true);
    expect(shouldKeepTrying(RESTORE_TIMEOUT_MS - 1)).toBe(true);
  });

  it("gives up at the deadline", () => {
    expect(shouldKeepTrying(RESTORE_TIMEOUT_MS)).toBe(false);
    expect(shouldKeepTrying(RESTORE_TIMEOUT_MS + 5000)).toBe(false);
  });

  it("gives up on time, not on attempt count", () => {
    // A slow connection deserves the same milliseconds as a fast one, not the
    // same number of frames.
    expect(shouldKeepTrying(100, 2000)).toBe(true);
    expect(shouldKeepTrying(2500, 2000)).toBe(false);
  });
});

describe("clampOffset", () => {
  it("returns the offset when it fits", () => {
    expect(clampOffset(4200, 5000, 800)).toBe(4200);
  });

  it("lands at the bottom when the page came back shorter", () => {
    // Near where you were beats nowhere near it.
    expect(clampOffset(4200, 2000, 800)).toBe(1200);
  });

  it("never returns a negative offset", () => {
    expect(clampOffset(500, 300, 800)).toBe(0);
  });
});

describe("remember / recall / forget", () => {
  let storage: Storage;
  beforeEach(() => { storage = makeStorage(); });

  it("round-trips an offset for a history key", () => {
    remember("abc123", 4200, storage);
    expect(recall("abc123", storage)).toBe(4200);
  });

  it("keeps separate positions per history entry", () => {
    // Two visits to /products at different scroll depths must not overwrite
    // each other, or going back twice lands in the wrong place.
    remember("entry-1", 100, storage);
    remember("entry-2", 4200, storage);
    expect(recall("entry-1", storage)).toBe(100);
    expect(recall("entry-2", storage)).toBe(4200);
  });

  it("rounds to whole pixels", () => {
    remember("k", 4200.7, storage);
    expect(recall("k", storage)).toBe(4201);
  });

  it("returns null for a page never visited", () => {
    expect(recall("never-seen", storage)).toBeNull();
  });

  it("returns null rather than NaN for corrupted values", () => {
    storage.setItem("scroll:k", "not a number");
    expect(recall("k", storage)).toBeNull();
  });

  it("ignores an empty key instead of writing a stray entry", () => {
    remember("", 500, storage);
    expect(storage.length).toBe(0);
    expect(recall("", storage)).toBeNull();
  });

  it("forgets on request", () => {
    remember("k", 300, storage);
    forget("k", storage);
    expect(recall("k", storage)).toBeNull();
  });

  it("survives storage that throws, without throwing itself", () => {
    // Safari private mode throws on setItem. No scroll position is worth
    // breaking navigation over.
    const hostile = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    } as unknown as Storage;
    expect(() => remember("k", 100, hostile)).not.toThrow();
    expect(() => forget("k", hostile)).not.toThrow();
    expect(recall("k", hostile)).toBeNull();
  });
});
