import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X, Package } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Full-screen product image viewer.
 *
 * Built on a portal rather than the shadcn Dialog because this needs to fill the
 * viewport edge to edge and own its own swipe handling; the Dialog's padded,
 * centred panel fights both. Focus trapping, Escape, scroll lock and focus
 * restore are therefore implemented here explicitly.
 *
 * Navigation is deliberately redundant — arrows, keyboard, touch swipe and
 * thumbnails — because "click the picture to see it bigger, then move sideways
 * through the rest" has to work the same on a phone and on a desktop.
 */

interface ImageLightboxProps {
  images: string[];
  index: number;
  onIndexChange: (index: number) => void;
  open: boolean;
  onClose: () => void;
  alt: string;
  /** Indices whose URL already failed to load in the parent gallery. */
  failed?: Record<number, boolean>;
  onImageError?: (index: number) => void;
}

/** Ignore lazy drags; only a deliberate horizontal flick should change image. */
const SWIPE_THRESHOLD_PX = 50;

const ImageLightbox = ({
  images, index, onIndexChange, open, onClose, alt, failed = {}, onImageError,
}: ImageLightboxProps) => {
  const { t } = useTranslation();
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const count = images.length;
  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      setZoomed(false);
      onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  // Escape / arrow handling lives on document so it works no matter which
  // element inside the overlay happens to hold focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, go, onClose]);

  // Lock background scroll, and put focus somewhere useful on open. Padding
  // compensates for the removed scrollbar so the page doesn't visibly shift.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement;
    const { overflow, paddingRight } = document.body.style;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    const focusTimer = setTimeout(() => closeRef.current?.focus(), 0);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      const el = restoreFocusRef.current;
      if (el instanceof HTMLElement) el.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => { if (!open) setZoomed(false); }, [open]);

  if (!open || count === 0) return null;

  const src = images[index];
  const isBroken = !src || failed[index];

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    // Vertical intent (scrolling/dismissing) must not flip the image.
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
    go(dx < 0 ? 1 : -1);
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("productDetail.galleryLabel", { name: alt })}
      className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-sm animate-in fade-in duration-150"
      // Clicking the backdrop closes; clicks on the controls/image stop there.
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white/90" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm tabular-nums" aria-live="polite">
          {count > 1 ? `${index + 1} / ${count}` : ""}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="h-11 w-11 flex items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div
        className="relative flex-1 flex items-center justify-center overflow-hidden px-2 sm:px-14"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onClick={(e) => e.stopPropagation()}
      >
        {isBroken ? (
          <div className="flex flex-col items-center gap-3 text-white/50">
            <Package className="h-20 w-20" aria-hidden="true" />
            <span className="text-sm">{t("productDetail.imageUnavailable")}</span>
          </div>
        ) : (
          <img
            src={src}
            alt={t("productDetail.imageOf", { name: alt, index: index + 1, total: count })}
            onError={() => onImageError?.(index)}
            onClick={() => setZoomed((z) => !z)}
            className={`max-h-full max-w-full select-none transition-transform duration-200 ${
              zoomed ? "scale-150 cursor-zoom-out" : "object-contain cursor-zoom-in"
            }`}
            draggable={false}
          />
        )}

        {count > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t("productDetail.previousImage")}
              className="absolute left-1 sm:left-3 top-1/2 -translate-y-1/2 h-12 w-12 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t("productDetail.nextImage")}
              className="absolute right-1 sm:right-3 top-1/2 -translate-y-1/2 h-12 w-12 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <ChevronRight className="h-6 w-6" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <div
          className="flex gap-2 overflow-x-auto px-4 py-4 justify-start sm:justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((img, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setZoomed(false); onIndexChange(i); }}
              aria-label={t("productDetail.goToImage", { index: i + 1 })}
              aria-current={i === index}
              className={`h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border-2 bg-white transition-all ${
                i === index ? "border-white" : "border-white/25 opacity-60 hover:opacity-100"
              }`}
            >
              {img && !failed[i] ? (
                <img src={img} alt="" className="h-full w-full object-contain p-1" loading="lazy" />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-muted">
                  <Package className="h-5 w-5 text-muted-foreground/60" aria-hidden="true" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
};

export default ImageLightbox;
