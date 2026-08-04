import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Editorial photography for the story pages, set from Admin -> Photos.
 *
 * These live in `store_settings` rather than in the bundle because they are the
 * owner's own photographs of his own town, and he must be able to change them
 * without a developer, a deploy, or a build. The keys are on the public-read
 * whitelist (see 20260804_about_page_images.sql) -- they hold a public storage
 * URL and nothing else.
 *
 * Returns `undefined` while loading and `null` when unset, so a caller can tell
 * "no photo yet" from "not known yet" and avoid flashing the fallback panel on
 * every page load before the answer arrives.
 */
export type SiteImageKey = "about_hero_image" | "about_place_image";

export function useSiteImages(keys: SiteImageKey[]) {
  const [images, setImages] = useState<Partial<Record<SiteImageKey, string | null>> | undefined>();

  // Serialised so the effect keys on the contents rather than the array
  // identity -- callers pass a literal, which is a new array every render.
  const signature = keys.join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("store_settings")
        .select("key, value")
        .in("key", signature.split(","));
      if (cancelled) return;
      if (error) {
        // A missing photo must never take the page down with it. The fallback
        // panel is a deliberate design, not an error state, so a failed read
        // lands on it silently.
        setImages({});
        return;
      }
      const next: Partial<Record<SiteImageKey, string | null>> = {};
      for (const k of signature.split(",") as SiteImageKey[]) {
        const hit = (data ?? []).find((r) => r.key === k)?.value as string | undefined;
        next[k] = hit && hit.trim().length > 0 ? hit : null;
      }
      setImages(next);
    })();
    return () => { cancelled = true; };
  }, [signature]);

  return images;
}
