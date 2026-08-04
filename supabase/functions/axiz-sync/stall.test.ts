import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveStall, parseCursor, STALL_LIMIT, type StallState } from "./stall.ts";

// The incident this exists to prevent, replayed. On 3 August the sync deferred
// on cursor "0:1" every fifteen minutes for twenty-two hours, syncing nothing
// and reporting the healthy-looking status "deferred" each time.
Deno.test("stall: a repeated deferral eventually steps over the page", () => {
  let stall: StallState | null = null;
  let cursor = "0:1";
  const skips: string[] = [];

  for (let run = 1; run <= STALL_LIMIT; run++) {
    const d = resolveStall({
      cursorBefore: cursor,
      cursorAfter: cursor,   // no progress: the page never loaded
      deferred: true,
      itemsSynced: 0,
      stall,
    });
    stall = d.stall;
    cursor = d.cursor;
    if (d.skipped) skips.push(d.cursor);
  }

  assertEquals(skips.length, 1, "exactly one skip after the limit is reached");
  assertEquals(cursor, "0:2", "advanced past the page it could not read");
  assertEquals(stall, null, "counter cleared once the skip is taken");
});

Deno.test("stall: stays patient below the limit", () => {
  const d = resolveStall({
    cursorBefore: "0:1", cursorAfter: "0:1", deferred: true, itemsSynced: 0, stall: null,
  });
  assertEquals(d.skipped, false);
  assertEquals(d.cursor, "0:1", "cursor preserved so the page is retried");
  assertEquals(d.stall, { cursor: "0:1", count: 1 });
});

Deno.test("stall: a deferral that still wrote rows is not a stall", () => {
  // The 10:00 run on 3 August: page 0 synced 1000 items, then page 1 timed
  // out. Real progress was made, so nothing should count against the page.
  const d = resolveStall({
    cursorBefore: "0:0", cursorAfter: "0:1", deferred: true, itemsSynced: 1000,
    stall: { cursor: "0:0", count: 2 },
  });
  assertEquals(d.skipped, false);
  assertEquals(d.stall, null, "progress clears the counter");
  assertEquals(d.cursor, "0:1");
});

Deno.test("stall: counter resets when the failing cursor changes", () => {
  // Two runs failed at 0:1, then the sync moved on and later stalled at 0:9.
  // Carrying the old count forward would skip 0:9 on its first failure.
  const d = resolveStall({
    cursorBefore: "0:9", cursorAfter: "0:9", deferred: true, itemsSynced: 0,
    stall: { cursor: "0:1", count: 2 },
  });
  assertEquals(d.stall, { cursor: "0:9", count: 1 });
  assertEquals(d.skipped, false);
});

Deno.test("stall: a healthy run clears any counter", () => {
  const d = resolveStall({
    cursorBefore: "0:4", cursorAfter: "0:8", deferred: false, itemsSynced: 4000,
    stall: { cursor: "0:4", count: 2 },
  });
  assertEquals(d.stall, null);
  assertEquals(d.cursor, "0:8");
  assertEquals(d.note, null, "nothing worth telling an operator about");
});

Deno.test("stall: completing the catalogue is never mistaken for a stall", () => {
  // catalog_complete resets the cursor to 0:0. If the previous cursor also
  // happened to be 0:0 -- a single-page catalogue -- the equality check alone
  // would read that as no progress.
  const d = resolveStall({
    cursorBefore: "0:0", cursorAfter: "0:0", deferred: false, itemsSynced: 4057, stall: null,
  });
  assertEquals(d.skipped, false);
  assertEquals(d.stall, null);
});

Deno.test("parseCursor: tolerates rubbish rather than throwing", () => {
  assertEquals(parseCursor("0:1"), [0, 1]);
  assertEquals(parseCursor("14:72"), [14, 72]);
  assertEquals(parseCursor(""), [0, 0]);
  assertEquals(parseCursor("nonsense"), [0, 0]);
});
