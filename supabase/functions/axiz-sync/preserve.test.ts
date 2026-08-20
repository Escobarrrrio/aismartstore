import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasAdminImages, isAdminImage, mergeAdminImages } from "./preserve.ts";

const ADMIN = "https://xyz.supabase.co/storage/v1/object/public/product-images/abc.jpg";
const DIST = "https://cdn.goaxiz.co.za/1.jpg";

Deno.test("isAdminImage recognises our own bucket only", () => {
  assertEquals(isAdminImage(ADMIN), true);
  assertEquals(isAdminImage(DIST), false);
});

Deno.test("hasAdminImages tolerates null", () => {
  assertEquals(hasAdminImages(null), false);
  assertEquals(hasAdminImages([DIST]), false);
  assertEquals(hasAdminImages([DIST, ADMIN]), true);
});

Deno.test("mergeAdminImages keeps the admin photo as cover", () => {
  assertEquals(mergeAdminImages([DIST], [ADMIN]), [ADMIN, DIST]);
});

Deno.test("mergeAdminImages leaves untouched products alone", () => {
  assertEquals(mergeAdminImages([DIST], [DIST]), [DIST]);
  assertEquals(mergeAdminImages([DIST], null), [DIST]);
});

Deno.test("mergeAdminImages de-duplicates and caps", () => {
  const dist = ["a", "b", "c", "d", "e", "f", "g"];
  assertEquals(mergeAdminImages(dist, [ADMIN]).length, 6);
  assertEquals(mergeAdminImages([ADMIN, DIST], [ADMIN]), [ADMIN, DIST]);
});
