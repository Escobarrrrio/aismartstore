import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapShowcaseRow, fetchShowcase } from "@/lib/home-showcase";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const row = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "SwitchBot Hub Mini",
  description: "Universal smart remote",
  price: "1129.05",
  category: "Smart Home",
  brand: "SwitchBot",
  sku: "GW-T-Switchbot",
  images: ["https://example.invalid/a.jpg"],
  in_stock: true,
  stock_quantity: 4,
  is_ai_product: true,
  created_at: "2026-07-01T00:00:00Z",
  score: "90.10",
  reasons: ["In stock, can ship on the next dispatch"],
  ...over,
});

describe("mapShowcaseRow", () => {
  it("converts the RPC row into the Product shape the cards expect", () => {
    const p = mapShowcaseRow(row());
    expect(p.id).toBe("11111111-1111-1111-1111-111111111111");
    // Postgres numerics arrive as strings over PostgREST; a string price would
    // silently break every price format and total in the cart.
    expect(p.price).toBe(1129.05);
    expect(typeof p.price).toBe("number");
    expect(p.inStock).toBe(true);
    expect(p.stockQuantity).toBe(4);
    expect(p.isAiProduct).toBe(true);
    expect(p.merchScore).toBe(90.1);
    expect(p.merchReasons).toEqual(["In stock, can ship on the next dispatch"]);
  });

  it("survives every nullable column being null", () => {
    const p = mapShowcaseRow(row({
      description: null, category: null, brand: null, sku: null,
      images: null, in_stock: null, stock_quantity: null,
      is_ai_product: null, created_at: null, score: null, reasons: null,
    }));
    expect(p.description).toBe("");
    expect(p.category).toBe("");
    expect(p.brand).toBeUndefined();
    expect(p.images).toEqual([]);
    expect(p.inStock).toBe(false);
    expect(p.stockQuantity).toBeUndefined();
    expect(p.merchScore).toBeUndefined();
    expect(p.merchReasons).toEqual([]);
    expect(Date.parse(p.createdAt)).not.toBeNaN();
  });

  it("drops non-string entries from reasons rather than rendering junk", () => {
    const p = mapShowcaseRow(row({ reasons: ["good", 7, null, { a: 1 }, "also good"] }));
    expect(p.merchReasons).toEqual(["good", "also good"]);
  });
});

describe("fetchShowcase", () => {
  // Braces matter: mockReset() returns the mock, and a hook that returns a
  // function has that function invoked as teardown -- which re-runs the
  // throwing implementation after the test and fails it with the error the
  // test just proved was handled.
  beforeEach(() => { rpc.mockReset(); });

  it("requests the slot and limit it was given", async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    const out = await fetchShowcase("ai_picks", 6);
    expect(rpc).toHaveBeenCalledWith("get_home_showcase", { p_slot: "ai_picks", p_limit: 6 });
    expect(out).toHaveLength(1);
  });

  // Every branch below must return [] rather than throw, because Index.tsx
  // treats an empty result as "fall back to the old query". A rejection here
  // would take the whole home page down instead.
  it("returns empty when the RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(fetchShowcase("featured")).resolves.toEqual([]);
  });

  // mockImplementation, not mockRejectedValue: the latter builds the rejected
  // promise up front, which vitest reports as an unhandled rejection before
  // fetchShowcase ever gets to catch it.
  it("returns empty when the RPC rejects", async () => {
    rpc.mockImplementation(() => Promise.reject(new Error("network down")));
    await expect(fetchShowcase("featured")).resolves.toEqual([]);
  });

  it("returns empty when the client throws synchronously", async () => {
    rpc.mockImplementation(() => { throw new Error("client not initialised"); });
    await expect(fetchShowcase("featured")).resolves.toEqual([]);
  });

  it("returns empty when the payload is not an array", async () => {
    rpc.mockResolvedValue({ data: { unexpected: true }, error: null });
    await expect(fetchShowcase("featured")).resolves.toEqual([]);
  });

  it("skips rows that lost their image since the last refresh", async () => {
    rpc.mockResolvedValue({
      data: [
        row({ id: "a", images: [] }),
        row({ id: "b", images: null }),
        row({ id: "c", images: [""] }),
        row({ id: "d" }),
      ],
      error: null,
    });
    const out = await fetchShowcase("featured");
    expect(out.map((p) => p.id)).toEqual(["d"]);
  });

  it("preserves the server's ranking order", async () => {
    rpc.mockResolvedValue({
      data: [row({ id: "first" }), row({ id: "second" }), row({ id: "third" })],
      error: null,
    });
    const out = await fetchShowcase("ai_picks");
    expect(out.map((p) => p.id)).toEqual(["first", "second", "third"]);
  });
});
