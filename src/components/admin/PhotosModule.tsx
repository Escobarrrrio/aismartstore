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

/** A product with no usable photo: no images at all, or only the placeholder. */
const needsPhoto = (p: { images: string[] | null }) => {
  const first = p.images?.[0];
  return !first || first.includes("placeholder");
};

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
    // Only products a shopper could actually reach. A photo on a deactivated
    // row helps nobody, and including them would bury the six that matter in
    // several thousand that do not.
    const { data, error } = await supabase
      .from("products")
      .select("id, name, brand, sku, images, stock_status, price, is_active")
      .eq("is_active", true)
      .order("name")
      .limit(4000);
    if (error) {
      toast({ title: "Could not load products", description: error.message, variant: "destructive" });
      setProducts([]);
    } else {
      setProducts((data ?? []) as ProductRow[]);
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

  const visibleMissing = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return missing.slice(0, 60);
    return missing
      .filter((p) => p.name.toLowerCase().includes(q) || (p.brand ?? "").toLowerCase().includes(q))
      .slice(0, 60);
  }, [missing, search]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  /** Group the dropped tree by folder, then match those folders to products. */
  const handleFolderPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const groups = new Map<string, File[]>();
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;  // .DS_Store, thumbs.db, stray PDFs
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

    for (const group of ready) {
      setStaged((prev) => prev.map((s) => (s.folder === group.folder ? { ...s, state: "uploading" } : s)));
      try {
        const urls: string[] = [];
        for (const file of group.files) urls.push(await uploadOne(file));

        // The placeholder is dropped rather than kept: while it occupies
        // position one the product stays hidden from the home page, which is
        // the entire reason for uploading.
        const existing = (byId.get(group.productId!)?.images ?? []).filter((u) => !u.includes("placeholder"));
        const { error } = await supabase
          .from("products")
          .update({ images: [...urls, ...existing] })
          .eq("id", group.productId!);
        if (error) throw new Error(error.message);

        setStaged((prev) =>
          prev.map((s) =>
            s.folder === group.folder
              ? { ...s, state: "done", message: `${urls.length} photo${urls.length === 1 ? "" : "s"} live` }
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
    toast({ title: "Photos applied", description: "Refresh the storefront to see them." });
  };

  /** Single-product upload, for the one-off case and non-Chromium browsers. */
  const uploadForProduct = async (productId: string, fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of files) urls.push(await uploadOne(f));
      const existing = (byId.get(productId)?.images ?? []).filter((u) => !u.includes("placeholder"));
      const { error } = await supabase.from("products").update({ images: [...urls, ...existing] }).eq("id", productId);
      if (error) throw new Error(error.message);
      toast({ title: "Photo added", description: `${urls.length} image${urls.length === 1 ? "" : "s"} uploaded.` });
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
    if (!file || !file.type.startsWith("image/")) return;
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
              accept="image/*"
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
                    <select
                      value={s.productId ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        setStaged((prev) =>
                          prev.map((x) =>
                            x.folder === s.folder ? { ...x, productId: e.target.value || null } : x,
                          ),
                        )
                      }
                      className="flex-1 rounded-lg border border-border bg-background px-2 py-2 text-sm"
                    >
                      <option value="">— skip this folder —</option>
                      {/* Every active product, not just ones missing a photo --
                          this dropdown is the manual-override path, and it must
                          be able to do the thing this screen exists for:
                          replace a photo the owner has already flagged as
                          wrong, not only fill a gap. */}
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
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
          <h3 className="font-display font-bold">Products with no photo</h3>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name or brand"
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
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[p.brand, p.sku, p.stock_status?.replace(/_/g, " ")].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <label className="shrink-0 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" /> Add photo
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
    </div>
  );
};

export default PhotosModule;
