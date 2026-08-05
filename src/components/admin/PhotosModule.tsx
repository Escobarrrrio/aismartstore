// Admin -> Photos.
//
// WHY THIS IS ITS OWN SCREEN
// --------------------------
// The Products table already had an upload control. It sat inside a row's edit
// mode, in a list of 88,000 rows, behind a search. Everything needed to put a
// photo on a product was present and working, and the photos still did not go
// up -- because the path was: search the product, click edit, find the small
// icon, choose one file, save, repeat. Six times. For someone who has the
// photos sitting in a folder on their desktop, that is not a feature, it is an
// obstacle course, and the obstacle course won for three weeks.
//
// This screen inverts it. It asks one question -- which products have no real
// photo -- and offers one action: hand over the folder. The browser can pass a
// whole directory tree (`webkitdirectory`), each file carrying the folder it
// came from, and those folder names are already product names because that is
// how a person naturally organises photos. So the matching is done for them,
// shown for review, and applied in one click.
//
// The fallback path (one product, choose files) stays, because folder upload
// needs a Chromium-family browser and because sometimes you only have one photo
// to add.

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Images, FolderUp, Loader2, Check, AlertTriangle, X, RefreshCw, Upload, Search,
} from "lucide-react";
import { matchFolders, folderOf, orderPhotos, MATCH_THRESHOLD, type ProductLike } from "@/lib/photoMatch";
import CoverPhotoPicker from "./CoverPhotoPicker";
import ProductPicker from "./ProductPicker";
import { resizeForWeb, formatBytes } from "@/lib/imageResize";

interface ProductRow extends ProductLike {
  images: string[] | null;
  stock_status: string | null;
  price: number | null;
  is_active: boolean | null;
}

/** The two photographic frames on /about. Keys match the store_settings rows
 *  added in 20260804080000_about_page_images.sql. */
type StoryKey = "about_hero_image" | "about_place_image";

const STORY_SLOTS: Array<{ key: StoryKey; title: string; hint: string }> = [
  {
    key: "about_hero_image",
    title: "The founder",
    hint: "Opens the Our Story page. A photograph of you — at the desk, in the workshop, wherever is true.",
  },
  {
    key: "about_place_image",
    title: "Gelvandale",
    hint: "Runs beside the section about home. Your own photograph of the neighbourhood, not stock photography.",
  },
];

/**
 * Every image extension worth accepting from a folder of product photos.
 *
 * Checked in addition to the MIME type, never instead of it, because Windows
 * reports an empty `type` for anything its registry does not recognise -- HEIC
 * and HEIF straight off an iPhone being the everyday case. Filtering on MIME
 * alone silently discarded those files before they were ever counted, so a
 * folder of twenty iPhone photos looked like an empty folder and the owner was
 * told "nothing in there was a photo" about photos that were plainly there.
 */
const PHOTO_EXTENSIONS = new Set([
  "jpg", "jpeg", "jpe", "jfif", "png", "webp", "gif", "bmp",
  "heic", "heif", "avif", "tif", "tiff",
]);

/** True for anything we should treat as a product photo. */
const isPhoto = (f: File): boolean => {
  if (f.type.startsWith("image/")) return true;
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  return PHOTO_EXTENSIONS.has(ext);
};

/**
 * Ceiling on how many images one product carries.
 *
 * A folder can legitimately hold two dozen shots of the same bulb. The product
 * page shows a handful; the rest are weight in every query that selects
 * `images`, on a database already close to its tier limit. Newest first, so an
 * upload always wins over what was there before.
 */
const MAX_IMAGES_PER_PRODUCT = 8;

/** A product with no usable photo: no images at all, or only the placeholder. */
const needsPhoto = (p: { images: string[] | null }) => {
  const first = p.images?.[0];
  return !first || first.includes("placeholder");
};

/**
 * What to keep from a product's existing images when a new photo is uploaded.
 *
 * Drops the placeholder, and drops inline `data:` images -- the low-resolution
 * base64 thumbnails (7-27KB) that were pasted into the catalogue early on and
 * are precisely the "old photos" this screen exists to replace. Keeping them
 * would leave the new upload sitting in front of the very image the owner
 * asked to be rid of, still carried in every row of the database.
 *
 * Real hosted URLs are kept: a product legitimately has several angles, and a
 * new photo should join them rather than silently delete work.
 */
const keepableImages = (images: string[] | null | undefined): string[] =>
  (images ?? []).filter((u) => !u.includes("placeholder") && !u.startsWith("data:"));

interface StagedFolder {
  folder: string;
  files: File[];
  productId: string | null;
  score: number;
  alternatives: Array<{ productId: string; score: number }>;
  state: "pending" | "uploading" | "done" | "error";
  message?: string;
}

const PhotosModule = () => {
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [staged, setStaged] = useState<StagedFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [story, setStory] = useState<Partial<Record<StoryKey, string>>>({});
  /** Product whose photo grid is open, for choosing which one leads. */
  const [coverFor, setCoverFor] = useState<ProductRow | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // `webkitdirectory` is not in React's typed attribute set, and setting it via
  // JSX props emits a DOM warning. Setting the real attributes on the node is
  // both the supported way and the one that degrades quietly on browsers that
  // do not implement it (the input stays an ordinary multi-file picker).
  useEffect(() => {
    const el = folderInput.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
  }, []);

  const load = async () => {
    setLoading(true);

    // Fetched page by page, because PostgREST silently caps every response at
    // 1,000 rows no matter what `.limit()` says.
    //
    // This is the bug that made the whole screen look broken. With 3,488 active
    // products, a single request returned only the first 1,000 by name -- so
    // the browser's idea of "the catalogue" stopped somewhere in the G's.
    // Govee sits at index 847 and matched perfectly; LIFX (3,113), Nanoleaf
    // (3,212), Oura (3,220), SwitchBot (3,447) and Withings (3,486) were never
    // in the list to be matched against, and the screen reported "no confident
    // match" -- which is true, and completely misleading, because the products
    // were not absent from the catalogue, only from the page we had asked for.
    //
    // One folder out of five worked, and the one that worked was the only one
    // alphabetically early enough to survive the cap.
    // A product with no photo is, by the catalogue's own rules, deactivated --
    // and a product with no photo is exactly the one you are here to upload a
    // photo for. Loading only `is_active = true` therefore excluded precisely
    // the products this screen exists to fix.
    //
    // That is why the Roborock Saros folder reported "no confident match" while
    // the other five matched: the product is in the catalogue
    // ("Roborock Saros 20 Ultimate AI Robot Vacuum Cleaner and Mop", R35,098.83,
    // zero images) but it was never in the list to match against, and it could
    // not be reached from the manual picker either.
    //
    // `or(...)` widens the load to include deactivated products that are only
    // deactivated for want of a photograph. It deliberately does NOT pull in
    // the ~172,000 rows with no price -- those are distributor noise, not
    // products, and loading them would put this screen back where it started.
    const PAGE = 1000;
    const all: ProductRow[] = [];
    let from = 0;
    let failed: string | null = null;

    for (;;) {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, brand, sku, images, stock_status, price, is_active")
        .or("is_active.eq.true,and(is_active.eq.false,images.is.null)")
        .gt("price", 0)
        .order("name")
        .range(from, from + PAGE - 1);

      if (error) { failed = error.message; break; }
      const page = (data ?? []) as ProductRow[];
      all.push(...page);
      // A short page is the last page. Guarded on the page size rather than a
      // total count so it terminates even if rows are added mid-fetch.
      if (page.length < PAGE) break;
      from += PAGE;
      // Belt and braces: never loop forever on a server that ignores range.
      if (from > 100_000) break;
    }

    if (failed) {
      toast({ title: "Could not load products", description: failed, variant: "destructive" });
      setProducts([]);
    } else {
      setProducts(all);
    }

    const { data: settings } = await supabase
      .from("store_settings")
      .select("key, value")
      .in("key", STORY_SLOTS.map((s) => s.key));
    const next: Partial<Record<StoryKey, string>> = {};
    for (const row of settings ?? []) {
      const v = row.value as string | null;
      if (v && v.trim()) next[row.key as StoryKey] = v;
    }
    setStory(next);

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const missing = useMemo(() => products.filter(needsPhoto), [products]);

  // Empty search lists the products with no photo at all -- the common case,
  // and the reason to open this screen. A search searches EVERY active
  // product, not just those.
  //
  // The distinction is the whole bug this fixes. Restricting the list to
  // products missing a photo also hid the manual "Add photo" button for the
  // three products whose photo the owner most wanted to replace (Govee, Oura,
  // SwitchBot -- all of which already carry an old image). So when folder
  // matching did not work for him, the fallback path could not reach those
  // products either, and there was no way in at all.
  const visibleMissing = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return missing.slice(0, 60);
    return products
      .filter((p) => p.name.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q))
      .slice(0, 60);
  }, [missing, products, search]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /** Group the dropped tree by folder, then match those folders to products. */
  const handleFolderPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const groups = new Map<string, File[]>();
    for (const f of files) {
      if (!isPhoto(f)) continue;  // .DS_Store, thumbs.db, stray PDFs
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
      const folder = folderOf(rel) || "(loose files)";
      const list = groups.get(folder) ?? [];
      list.push(f);
      groups.set(folder, list);
    }

    if (groups.size === 0) {
      toast({
        title: "No images in that folder",
        description: "Nothing in there was a photo. Pick the folder that has the JPGs or PNGs in it.",
        variant: "destructive",
      });
      return;
    }

    // Matched against every active product, not just the ones with no photo.
    //
    // The first version restricted matching to products missing a photo, on
    // the theory that a folder named "Govee" should not be able to silently
    // overwrite a distributor photo that already looked fine. In production
    // that theory was wrong in the case that actually mattered: three of the
    // owner's own manually-sourced products (Govee, Oura, SwitchBot) already
    // carried an old placeholder-style photo he wanted replaced, and this
    // screen refused to even offer them as a match -- with no visible reason
    // why, which read as the tool being broken rather than being cautious.
    //
    // Silently blocking a replacement and silently allowing one are both
    // wrong. The fix is neither: match against everything, and mark clearly,
    // per row, when accepting a match means replacing a photo that already
    // exists (see `replacesExisting` below) -- an informed decision the owner
    // makes by looking at the review table, not a restriction the tool makes
    // for him without saying so.
    if (products.length === 0) {
      toast({
        title: "Still loading the catalogue",
        description: "Give it a second and try Choose Folder again — matching against zero products is why every folder just showed \"no match\".",
        variant: "destructive",
      });
      return;
    }
    const matches = matchFolders([...groups.keys()], products);
    setStaged(
      matches.map((m) => {
        const files = groups.get(m.folder) ?? [];
        const ordered = orderPhotos(files.map((f) => f.name));
        return {
          folder: m.folder,
          files: ordered.map((n) => files.find((f) => f.name === n)!).filter(Boolean),
          productId: m.productId,
          score: m.score,
          alternatives: m.alternatives,
          state: "pending" as const,
        };
      }),
    );
    // Lets the same folder be picked twice in a row after a correction.
    e.target.value = "";
  };

  const uploadOne = async (file: File): Promise<string> => {
    const { blob, ext } = await resizeForWeb(file);
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from("product-images")
      .upload(path, blob, { contentType: blob.type || file.type, upsert: false });
    if (error) throw new Error(error.message);
    return supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl;
  };

  const applyStaged = async () => {
    const ready = staged.filter((s) => s.productId && s.state !== "done");
    if (ready.length === 0) return;
    setBusy(true);

    let totalLive = 0;
    let totalSkipped = 0;
    /** Products that were hidden for having no photo and are now on the storefront. */
    let reactivated = 0;

    for (const group of ready) {
      setStaged((prev) => prev.map((s) => (s.folder === group.folder ? { ...s, state: "uploading" } : s)));

      // Each file is attempted independently. A single unreadable photo used to
      // throw and take its whole folder down with it -- twenty-three good
      // photos discarded because the twenty-fourth was a screenshot the browser
      // could not decode. Partial success is the honest outcome and is reported
      // as one.
      const urls: string[] = [];
      const failures: string[] = [];
      for (const file of group.files) {
        try {
          urls.push(await uploadOne(file));
        } catch (err) {
          console.error("[photos] upload failed", file.name, err);
          failures.push(`${file.name}: ${err instanceof Error ? err.message : "failed"}`);
        }
      }

      if (urls.length === 0) {
        setStaged((prev) =>
          prev.map((s) =>
            s.folder === group.folder
              ? {
                  ...s,
                  state: "error",
                  message: failures[0] ?? "No photo in this folder could be uploaded.",
                }
              : s,
          ),
        );
        continue;
      }

      try {
        // The placeholder is dropped rather than kept: while it occupies
        // position one the product stays hidden from the home page, which is
        // the entire reason for uploading.
        const target = byId.get(group.productId!);
        const existing = keepableImages(target?.images);

        // Uploading a photo to a product that was hidden *for having no photo*
        // has to put it back on the storefront, or the upload achieved nothing
        // visible and the screen has lied about "live". The gate it failed is
        // the one just satisfied.
        const wasHidden = target?.is_active === false;
        const patch = {
          images: [...urls, ...existing].slice(0, MAX_IMAGES_PER_PRODUCT),
          ...(wasHidden ? { is_active: true } : {}),
        };

        const { error } = await supabase
          .from("products")
          .update(patch)
          .eq("id", group.productId!);
        if (error) throw new Error(error.message);

        if (wasHidden) reactivated += 1;
        totalLive += urls.length;
        totalSkipped += failures.length;
        setStaged((prev) =>
          prev.map((s) =>
            s.folder === group.folder
              ? {
                  ...s,
                  state: "done",
                  message:
                    `${urls.length} photo${urls.length === 1 ? "" : "s"} live` +
                    (byId.get(group.productId!)?.is_active === false ? " · product put back on the storefront" : "") +
                    (failures.length ? ` · ${failures.length} could not be read and were skipped` : ""),
                }
              : s,
          ),
        );
      } catch (err) {
        setStaged((prev) =>
          prev.map((s) =>
            s.folder === group.folder
              ? { ...s, state: "error", message: err instanceof Error ? err.message : "Upload failed" }
              : s,
          ),
        );
      }
    }

    setBusy(false);
    await load();
    toast({
      title: totalLive > 0 ? "Photos applied" : "Nothing uploaded",
      description: totalLive > 0
        ? `${totalLive} photo${totalLive === 1 ? "" : "s"} live${totalSkipped ? `, ${totalSkipped} skipped` : ""}` +
          (reactivated ? `. ${reactivated} product${reactivated === 1 ? " was" : "s were"} hidden for having no photo and ${reactivated === 1 ? "is" : "are"} now on the storefront.` : ". Refresh the storefront to see them.")
        : "Every photo failed — the reason is shown on each folder above.",
      variant: totalLive > 0 ? undefined : "destructive",
    });
  };

  /** Single-product upload, for the one-off case and non-Chromium browsers. */
  const uploadForProduct = async (productId: string, fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter(isPhoto);
    if (files.length === 0) {
      toast({
        title: "Nothing to upload",
        description: "None of the selected files looked like a photo.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    // Same per-file tolerance as the folder path: one unreadable photo must not
    // discard the ones either side of it.
    const urls: string[] = [];
    const failures: string[] = [];
    for (const f of files) {
      try {
        urls.push(await uploadOne(f));
      } catch (err) {
        console.error("[photos] upload failed", f.name, err);
        failures.push(`${f.name}: ${err instanceof Error ? err.message : "failed"}`);
      }
    }

    try {
      if (urls.length === 0) throw new Error(failures[0] ?? "Upload failed");
      const existing = keepableImages(byId.get(productId)?.images);
      const { error } = await supabase
        .from("products")
        .update({ images: [...urls, ...existing].slice(0, MAX_IMAGES_PER_PRODUCT) })
        .eq("id", productId);
      if (error) throw new Error(error.message);
      toast({
        title: "Photo added",
        description:
          `${urls.length} image${urls.length === 1 ? "" : "s"} uploaded` +
          (failures.length ? `, ${failures.length} skipped.` : "."),
      });
      await load();
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const uploadStoryPhoto = async (key: StoryKey, file: File | undefined) => {
    if (!file || !isPhoto(file)) return;
    setBusy(true);
    try {
      const url = await uploadOne(file);
      const { error } = await supabase.from("store_settings").upsert(
        { key, value: url },
        { onConflict: "key" },
      );
      if (error) throw new Error(error.message);
      setStory((prev) => ({ ...prev, [key]: url }));
      toast({ title: "Story photo updated", description: "It is live on the Our Story page now." });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const stagedBytes = staged.reduce((n, s) => n + s.files.reduce((m, f) => m + f.size, 0), 0);
  const matchedCount = staged.filter((s) => s.productId).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display font-extrabold text-2xl flex items-center gap-2">
            <Images className="h-5 w-5" /> Photos
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {loading ? "Checking the catalogue…" : (
              <>
                <strong className="text-foreground">{missing.length}</strong> live product
                {missing.length === 1 ? "" : "s"} {missing.length === 1 ? "has" : "have"} no real photo.
              </>
            )}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading || busy}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {/* Folder drop */}
      <section className="rounded-2xl border-2 border-dashed border-border bg-card p-6">
        <div className="flex flex-col items-center text-center gap-3">
          <FolderUp className="h-8 w-8 text-muted-foreground" />
          <h3 className="font-display font-bold text-lg">Upload the whole folder at once</h3>
          <p className="text-sm text-muted-foreground max-w-xl">
            Choose your <code className="px-1 rounded bg-muted text-xs">ai_products</code> folder — the one
            holding a sub-folder per product. Every photo inside is matched to its product by the folder
            name, resized for the web, and you get to check the matches before anything goes live.
          </p>
          <label
            className={`inline-flex items-center gap-2 rounded-full bg-foreground text-background px-5 py-2.5 text-sm font-semibold ${
              loading ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-foreground/90"
            }`}
          >
            <FolderUp className="h-4 w-4" /> {loading ? "Loading catalogue…" : "Choose folder"}
            {/* Disabled while the product list is still loading. Picking a
                folder before it arrives matches every real folder against zero
                candidates -- every match comes back "no confident match", which
                reads exactly like the tool being broken rather than like a
                page that had not finished loading yet. */}
            <input
              ref={folderInput}
              type="file"
              multiple
              /* No `accept` filter here, deliberately. Combined with
                 webkitdirectory, `accept="image/*"` makes the browser hide
                 files whose MIME type it does not recognise -- which on Windows
                 includes HEIC/HEIF straight off an iPhone. The files never
                 reach onChange at all, so no amount of filtering in our code
                 can recover them. isPhoto() does the filtering instead, where
                 it can also fall back to the file extension. */
              disabled={loading}
              onChange={handleFolderPick}
              className="hidden"
            />
          </label>
          <p className="text-[11px] text-muted-foreground">
            Folder selection needs Chrome or Edge. On other browsers this picks individual files instead —
            use the per-product buttons below.
          </p>
        </div>
      </section>

      {/* Review the matches */}
      {staged.length > 0 && (
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-wrap">
            <div>
              <h3 className="font-display font-bold">Check the matches</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {matchedCount} of {staged.length} folders matched · {formatBytes(stagedBytes)} to upload
                {stagedBytes > 6 * 1024 * 1024 && " (large photos are shrunk automatically)"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setStaged([])}
                disabled={busy}
                className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={applyStaged}
                disabled={busy || matchedCount === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-foreground text-background px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Put {matchedCount} live
              </button>
            </div>
          </div>

          <ul className="divide-y divide-border">
            {staged.map((s) => (
              <li key={s.folder} className="px-5 py-4 flex items-start gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{s.folder}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.files.length} photo{s.files.length === 1 ? "" : "s"}
                    {s.score > 0 && ` · ${Math.round(s.score * 100)}% name match`}
                  </p>
                  {s.message && (
                    <p className={`text-xs mt-1 ${s.state === "error" ? "text-red-600" : "text-emerald-700"}`}>
                      {s.message}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 min-w-[280px]">
                  {s.state === "done" ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 font-medium">
                      <Check className="h-4 w-4" /> Done
                    </span>
                  ) : (
                    /* Searchable, because the native select this replaced
                       listed all 3,488 products with no way to filter. The
                       options were all present -- finding one meant scrolling
                       three and a half thousand entries, so the manual
                       override existed and could not be used. */
                    <ProductPicker
                      products={products}
                      value={s.productId}
                      disabled={busy}
                      onChange={(productId) =>
                        setStaged((prev) =>
                          prev.map((x) => (x.folder === s.folder ? { ...x, productId } : x)),
                        )
                      }
                    />
                  )}
                  {s.state === "uploading" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {s.state === "error" && <AlertTriangle className="h-4 w-4 text-red-600" />}
                </div>

                {/* An unmatched folder is the case most likely to end in a photo
                    on the wrong product, so it says so plainly rather than
                    leaving an empty select to be scrolled past. */}
                {!s.productId && s.state === "pending" && (
                  <p className="w-full text-xs text-amber-700 inline-flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    No confident match{s.alternatives.length > 0 && s.alternatives[0].score >= MATCH_THRESHOLD * 0.6
                      ? ` — closest was "${byId.get(s.alternatives[0].productId)?.name ?? "?"}"`
                      : ""}. Pick the product yourself, or skip it.
                  </p>
                )}

                {/* Replacing a photo that already exists is allowed, and now
                    said out loud rather than done -- or refused -- silently.
                    The three products this matters for most (Govee, Oura,
                    SwitchBot) already carry a real photo the owner wants gone;
                    hiding that this action removes it would just move the
                    surprise from "why won't it match" to "where did my old
                    photo go". */}
                {s.productId && s.state === "pending" && byId.get(s.productId) && !needsPhoto(byId.get(s.productId)!) && (
                  <p className="w-full text-xs text-blue-700 inline-flex items-center gap-1.5">
                    <Images className="h-3.5 w-3.5" />
                    Replaces the existing photo on "{byId.get(s.productId)!.name}".
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Our Story photography */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold">Our Story photographs</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            The two frames on the <code className="px-1 rounded bg-muted">/about</code> page. Until a real
            photograph is set, each frame shows a designed plate — never an empty box — so the page is
            always presentable.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-5 p-5">
          {STORY_SLOTS.map(({ key, title, hint }) => (
            <div key={key} className="rounded-xl border border-border overflow-hidden flex flex-col">
              <div className="aspect-[3/2] bg-muted relative">
                {story[key] ? (
                  <img src={story[key]} alt={title} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground px-4 text-center">
                    No photograph set
                  </div>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col gap-3">
                <div>
                  <p className="font-semibold text-sm">{title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{hint}</p>
                </div>
                <label className="mt-auto inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold cursor-pointer hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" /> {story[key] ? "Replace photograph" : "Add photograph"}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(e) => { uploadStoryPhoto(key, e.target.files?.[0]); e.target.value = ""; }}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Products still waiting */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border flex-wrap">
          <div>
            <h3 className="font-display font-bold">
              {search.trim() ? "Search results" : "Products with no photo"}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {search.trim()
                ? "Searching every live product — including ones that already have a photo you want replaced."
                : "Search to reach any product, including ones whose existing photo you want to replace."}
            </p>
          </div>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search any product by name or brand"
              className="rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm w-64"
            />
          </div>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">Loading…</p>
        ) : visibleMissing.length === 0 ? (
          <p className="px-5 py-8 text-sm text-muted-foreground inline-flex items-center gap-2">
            <Check className="h-4 w-4 text-emerald-600" />
            {missing.length === 0 ? "Every live product has a photo." : "Nothing matches that filter."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visibleMissing.map((p) => (
              <li key={p.id} className="px-5 py-3 flex items-center gap-4 justify-between">
                <div className="min-w-0 flex items-center gap-3">
                  {/* The product's current photo, thumbnail-sized. Without it
                      this list gives no way to tell whether a product already
                      has an image -- which is precisely the question being
                      answered when the job is replacing an old one. */}
                  {/* Clickable when there is more than one photo: this is the
                      only route to choosing which one leads. `images[0]` is
                      what the catalogue card, the home page, the newsletter and
                      Google all show, and until now the file dialog's ordering
                      picked it. */}
                  {(p.images?.length ?? 0) > 1 ? (
                    <button
                      type="button"
                      onClick={() => setCoverFor(p)}
                      title={`Choose which of ${p.images!.length} photos leads`}
                      aria-label={`Choose the cover photo for ${p.name}`}
                      className="relative h-10 w-10 shrink-0 rounded border border-border bg-white overflow-hidden grid place-items-center
                                 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <img src={p.images![0]} alt="" className="h-full w-full object-contain" />
                      <span className="absolute bottom-0 inset-x-0 bg-foreground/70 text-background text-[9px] font-bold leading-tight py-px">
                        {p.images!.length}
                      </span>
                    </button>
                  ) : (
                    <div className="h-10 w-10 shrink-0 rounded border border-border bg-white overflow-hidden grid place-items-center">
                      {needsPhoto(p) ? (
                        <Images className="h-4 w-4 text-muted-foreground/50" />
                      ) : (
                        <img src={p.images![0]} alt="" className="h-full w-full object-contain" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[p.brand, p.sku, p.stock_status?.replace(/_/g, " ")].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <label className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" /> {needsPhoto(p) ? "Add photo" : "Replace photo"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={busy}
                    onChange={(e) => { uploadForProduct(p.id, e.target.files); e.target.value = ""; }}
                    className="hidden"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}

        {missing.length > visibleMissing.length && (
          <p className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
            Showing {visibleMissing.length} of {missing.length}. Use the filter to reach the rest.
          </p>
        )}
      </section>

      {coverFor && (
        <CoverPhotoPicker
          productId={coverFor.id}
          productName={coverFor.name}
          images={coverFor.images ?? []}
          onClose={() => setCoverFor(null)}
          onChanged={(images) => {
            setProducts((prev) => prev.map((x) => (x.id === coverFor.id ? { ...x, images } : x)));
            setCoverFor((c) => (c ? { ...c, images } : c));
          }}
        />
      )}
    </div>
  );
};

export default PhotosModule;
