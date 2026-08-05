import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isPublishable, partitionByGate } from "./gate.ts";

const row = (over: Partial<{ sku: string; price: number; images: string[]; _cost: number }> = {}) => ({
  sku: "SKU-1",
  price: 1200,
  images: ["https://cdn.example/1.jpg"],
  _cost: 1000,
  ...over,
});

const MIN = 250;

Deno.test("isPublishable: a normal product passes", () => {
  assertEquals(isPublishable(row(), MIN), true);
});

Deno.test("isPublishable: no distributor price is not a product", () => {
  // Axiz returns SKUs with price 0 for lines it does not currently quote.
  assertEquals(isPublishable(row({ _cost: 0 }), MIN), false);
});

Deno.test("isPublishable: no image is not a product a shopper will buy", () => {
  assertEquals(isPublishable(row({ images: [] }), MIN), false);
});

Deno.test("isPublishable: below the sellable floor is excluded", () => {
  assertEquals(isPublishable(row({ price: 249 }), MIN), false);
  // The floor is inclusive -- exactly at the boundary sells.
  assertEquals(isPublishable(row({ price: 250 }), MIN), true);
});

Deno.test("partitionByGate: keeps the sellable ones and names the rest", () => {
  const { store, deactivate } = partitionByGate(
    [
      row({ sku: "GOOD-1" }),
      row({ sku: "NOPRICE", _cost: 0 }),
      row({ sku: "GOOD-2" }),
      row({ sku: "NOIMAGE", images: [] }),
      row({ sku: "CHEAP", price: 10 }),
    ],
    MIN,
  );
  assertEquals(store.map((r) => r.sku), ["GOOD-1", "GOOD-2"]);
  assertEquals(deactivate, ["NOPRICE", "NOIMAGE", "CHEAP"]);
});

Deno.test("partitionByGate: failures are listed for deactivation, never for insert", () => {
  // This is the property that matters. `deactivate` is a list of SKUs, not
  // rows -- there is deliberately no way to hand it to an upsert and
  // accidentally reintroduce the 172,000 rows this exists to keep out.
  const { deactivate } = partitionByGate([row({ sku: "X", _cost: 0 })], MIN);
  assertEquals(typeof deactivate[0], "string");
});

Deno.test("partitionByGate: a catalogue of nothing but failures stores nothing", () => {
  const { store, deactivate } = partitionByGate(
    [row({ sku: "A", _cost: 0 }), row({ sku: "B", images: [] })],
    MIN,
  );
  assertEquals(store, []);
  assertEquals(deactivate.length, 2);
});

Deno.test("partitionByGate: an empty page is not an error", () => {
  assertEquals(partitionByGate([], MIN), { store: [], deactivate: [] });
});
