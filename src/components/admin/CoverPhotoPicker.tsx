import { useState } from "react";
import { Star, Trash2, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { promoteToCover, removePhoto } from "@/lib/coverPhoto";

interface Props {
  productId: string;
  productName: string;
  images: string[];
  onClose: () => void;
  /** Called after a successful write so the parent can refresh its list. */
  onChanged: (images: string[]) => void;
}

/**
 * Chooses which of a product's photos leads.
 *
 * `images[0]` is the cover everywhere -- catalogue card, home page, newsletter,
 * Google shopping result. Before this, nothing chose it: the file dialog's
 * ordering did, which is why a product with twenty-four good photos can lead
 * with a shot of the plug.
 *
 * Deliberately not drag-and-drop. Dragging is fiddly on a touch screen, needs a
 * library, and answers a question nobody asked -- the ordering of photos three
 * through eight does not matter. One tap on the photo that should be first is
 * the whole job.
 */
const CoverPhotoPicker = ({ productId, productName, images, onClose, onChanged }: Props) => {
  const { toast } = useToast();
  const [current, setCurrent] = useState<string[]>(images);
  const [busy, setBusy] = useState(false);
  const [broken, setBroken] = useState<Record<number, boolean>>({});

  const write = async (next: string[], what: string) => {
    setBusy(true);
    const { error } = await supabase.from("products").update({ images: next }).eq("id", productId);
    setBusy(false);

    if (error) {
      toast({ title: `Could not ${what}`, description: error.message, variant: "destructive" });
      return;
    }
    setCurrent(next);
    setBroken({});
    onChanged(next);
  };

  const choose = async (index: number) => {
    const next = promoteToCover(current, index);
    // Identity check: promoteToCover hands back the same array when the photo
    // is already first, so tapping the cover costs nothing.
    if (next === current) return;
    await write(next, "set the cover photo");
  };

  const drop = async (index: number) => {
    const next = removePhoto(current, index);
    if (next === current) return;
    await write(next, "remove the photo");
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-foreground/50 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Photos for ${productName}`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-2xl bg-background border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-4 sm:px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{productName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tap a photo to make it the one shoppers see first.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 grid place-items-center h-9 w-9 rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {current.length === 0 ? (
          <p className="px-5 py-10 text-sm text-muted-foreground text-center">
            This product has no photos yet. Upload some and they will appear here.
          </p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 p-4 sm:p-5">
            {current.map((url, i) => (
              <li key={`${url}-${i}`} className="relative">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => choose(i)}
                  aria-label={i === 0 ? "Current cover photo" : `Make photo ${i + 1} the cover`}
                  aria-pressed={i === 0}
                  className={`group relative block w-full aspect-square rounded-xl overflow-hidden bg-white border-2 transition
                    ${i === 0 ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-foreground/40"}
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60`}
                >
                  {broken[i] ? (
                    <span className="grid h-full w-full place-items-center text-[11px] text-muted-foreground px-2 text-center">
                      Image will not load
                    </span>
                  ) : (
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-contain p-2"
                      onError={() => setBroken((b) => ({ ...b, [i]: true }))}
                    />
                  )}

                  {i === 0 && (
                    <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5">
                      <Star className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                      Cover
                    </span>
                  )}
                </button>

                {/* Delete is a separate control, not a mode. It sits outside the
                    choose-cover button so a mis-tap picks a cover rather than
                    destroying a photo -- the recoverable mistake, not the
                    permanent one. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => drop(i)}
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute -top-1.5 -right-1.5 grid place-items-center h-7 w-7 rounded-full bg-background border border-border
                             text-muted-foreground hover:text-destructive hover:border-destructive shadow-sm
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {busy ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
              </span>
            ) : (
              `${current.length} photo${current.length === 1 ? "" : "s"} · changes save immediately`
            )}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted min-h-[40px]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default CoverPhotoPicker;
