import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractTrackingNumber } from "./index.ts";

Deno.test("extractTrackingNumber reads short_tracking_reference from a { shipments: [...] } body", () => {
  const body = { shipments: [{ short_tracking_reference: "TCG123456" }] };
  assertEquals(extractTrackingNumber(body), "TCG123456");
});

Deno.test("extractTrackingNumber falls back to tracking_reference when short_tracking_reference is absent", () => {
  const body = { shipments: [{ tracking_reference: "TCG999" }] };
  assertEquals(extractTrackingNumber(body), "TCG999");
});

Deno.test("extractTrackingNumber prefers short_tracking_reference over tracking_reference when both exist", () => {
  const body = { shipments: [{ short_tracking_reference: "SHORT1", tracking_reference: "LONG1" }] };
  assertEquals(extractTrackingNumber(body), "SHORT1");
});

Deno.test("extractTrackingNumber handles a bare array response body", () => {
  const body = [{ short_tracking_reference: "TCG777" }];
  assertEquals(extractTrackingNumber(body), "TCG777");
});

Deno.test("extractTrackingNumber handles shipments being a single object, not an array", () => {
  const body = { shipments: { short_tracking_reference: "TCG555" } };
  assertEquals(extractTrackingNumber(body), "TCG555");
});

Deno.test("extractTrackingNumber returns null when shipments is an empty array (no shipment yet)", () => {
  const body = { shipments: [] };
  assertEquals(extractTrackingNumber(body), null);
});

Deno.test("extractTrackingNumber returns null for a completely empty body", () => {
  assertEquals(extractTrackingNumber({}), null);
  assertEquals(extractTrackingNumber(null), null);
  assertEquals(extractTrackingNumber(undefined), null);
});

Deno.test("extractTrackingNumber coerces a numeric tracking reference to a string", () => {
  const body = { shipments: [{ short_tracking_reference: 123456 }] };
  assertEquals(extractTrackingNumber(body), "123456");
});
