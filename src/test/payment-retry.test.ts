import { describe, it, expect } from "vitest";

/**
 * Payment retry contract:
 * - On failure we reuse the same order id and only bump an attempt counter.
 * - We cap at 3 attempts total, then require a fresh checkout.
 * These tests document the checkout flow's retry state machine without
 * booting the full Checkout page component.
 */

type RetryState = { orderId: string | null; attempts: number };
const MAX_ATTEMPTS = 3;

function recordAttempt(state: RetryState, newOrderId: string): RetryState {
  if (!state.orderId) return { orderId: newOrderId, attempts: 1 };
  return { orderId: state.orderId, attempts: state.attempts + 1 };
}

function canRetry(state: RetryState) {
  return state.attempts < MAX_ATTEMPTS;
}

describe("payment retry", () => {
  it("creates an order on the first attempt", () => {
    const s = recordAttempt({ orderId: null, attempts: 0 }, "order-1");
    expect(s).toEqual({ orderId: "order-1", attempts: 1 });
  });

  it("reuses the same order id on subsequent attempts", () => {
    let s: RetryState = { orderId: null, attempts: 0 };
    s = recordAttempt(s, "order-1");
    s = recordAttempt(s, "order-2-should-be-ignored");
    s = recordAttempt(s, "order-3-should-be-ignored");
    expect(s.orderId).toBe("order-1");
    expect(s.attempts).toBe(3);
  });

  it("stops offering retry after the cap", () => {
    const s: RetryState = { orderId: "order-1", attempts: MAX_ATTEMPTS };
    expect(canRetry(s)).toBe(false);
  });

  it("still allows retry below the cap", () => {
    expect(canRetry({ orderId: "order-1", attempts: 1 })).toBe(true);
    expect(canRetry({ orderId: "order-1", attempts: 2 })).toBe(true);
  });
});
