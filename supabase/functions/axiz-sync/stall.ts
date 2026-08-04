// Breaking the sync out of a cursor it cannot get past.
//
// WHAT HAPPENED
// -------------
// On 3 August the catalogue sync stopped dead for twenty-two hours. Page 1 of
// market 14 began timing out; the run deferred, leaving the cursor on that
// page so the work would resume there -- which is correct for a transient
// outage. It then resumed there every fifteen minutes, timed out again, and
// deferred again, eighty-eight times, syncing nothing.
//
// Nothing raised its hand. `deferred` is a designed, healthy state meaning
// "the distributor blinked, we will pick this up shortly", so the run log
// looked normal and the failure-streak alerting -- which watches for `error`
// -- had nothing to react to. The only outward symptom was a stock-anomaly
// email repeating hourly with a delta of zero, which read as a stock problem
// rather than a sync problem.
//
// The store's stock figures were frozen the whole time.
//
// THE RULE
// --------
// Deferring is right the first time and wrong the fifth. Preserving a cursor
// is a bet that the condition is temporary; after a few identical failures the
// evidence says it is not, and continuing to bet costs the entire catalogue to
// protect one page of it.
//
// So: defer, defer, defer -- then step over the page and carry on. One page of
// roughly a thousand SKUs goes stale until the next full pass reaches it
// again, which is a far smaller loss than every SKU going stale indefinitely.
// The skip is recorded as a real failure, not a note, because a page the sync
// cannot read is a genuine problem even though the workaround is automatic.

export interface StallState {
  /** The cursor that has been failing. */
  cursor: string;
  /** How many consecutive runs have deferred on it without progress. */
  count: number;
}

export interface StallDecision {
  /** Cursor to persist for the next run. */
  cursor: string;
  /** Stall state to persist, or null to clear it. */
  stall: StallState | null;
  /** True when this decision stepped over a page that would not load. */
  skipped: boolean;
  /** Operator-facing explanation, present only when something notable happened. */
  note: string | null;
}

/**
 * Consecutive no-progress deferrals tolerated before stepping over the page.
 *
 * Three is deliberate: at a fifteen-minute schedule it is forty-five minutes of
 * patience, which comfortably covers the distributor restarts and short
 * outages that deferral was designed for, while capping the damage from a
 * genuinely unreadable page at under an hour rather than a day.
 */
export const STALL_LIMIT = 3;

/** "0:1" -> [0, 1]; anything unparseable reads as the start of the catalogue. */
export function parseCursor(cursor: string): [number, number] {
  const [m, p] = String(cursor ?? "").split(":").map((n) => Number(n));
  return [Number.isFinite(m) ? m : 0, Number.isFinite(p) ? p : 0];
}

/**
 * Decide what cursor the next run should start from.
 *
 * `cursorAfter` is what the run would normally persist. When it equals
 * `cursorBefore` and the run deferred, no forward progress was made and the
 * stall counter advances.
 */
export function resolveStall(args: {
  cursorBefore: string;
  cursorAfter: string;
  deferred: boolean;
  itemsSynced: number;
  stall: StallState | null;
}): StallDecision {
  const { cursorBefore, cursorAfter, deferred, itemsSynced, stall } = args;

  // Any forward movement, or any row actually written, clears the counter.
  // Counting across unrelated cursors would eventually trip a skip on a page
  // that had never failed.
  const madeProgress = cursorAfter !== cursorBefore || itemsSynced > 0;
  if (!deferred || madeProgress) {
    return { cursor: cursorAfter, stall: null, skipped: false, note: null };
  }

  const count = (stall && stall.cursor === cursorBefore ? stall.count : 0) + 1;

  if (count < STALL_LIMIT) {
    return {
      cursor: cursorAfter,
      stall: { cursor: cursorBefore, count },
      skipped: false,
      note: `no progress at cursor ${cursorBefore} (${count} of ${STALL_LIMIT} before skipping)`,
    };
  }

  // Step over the page. Only the page index advances: the market is almost
  // certainly fine, and moving to the next market would abandon everything
  // after this page rather than the page itself.
  const [m, p] = parseCursor(cursorBefore);
  const nextCursor = `${m}:${p + 1}`;
  return {
    cursor: nextCursor,
    stall: null,
    skipped: true,
    note:
      `SKIPPED cursor ${cursorBefore} after ${count} consecutive failed runs; ` +
      `advanced to ${nextCursor}. Those SKUs keep their previous data until the next full pass.`,
  };
}
