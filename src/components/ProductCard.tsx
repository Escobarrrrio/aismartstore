import { Link } from "react-router-dom";
import { Product } from "@/contexts/CartContext";
import { useCart } from "@/contexts/CartContext";
import { useWishlist } from "@/contexts/WishlistContext";
import { ShoppingCart, Heart, Sparkles, Truck, Check, Rocket, PackageCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "@/contexts/LocaleContext";
import { estimateDelivery } from "@/lib/delivery";

interface ProductCardProps {
  product: Product;
  onQuickView?: (product: Product) => void;
}

const RESIDENTIAL_MAX = 15000;

const ProductCard = ({ product }: ProductCardProps) => {
  const { addToCart } = useCart();
  const { isWishlisted, toggleWishlist } = useWishlist();
  const { t } = useTranslation();
  const { formatPrice } = useLocale();
  const wishlisted = isWishlisted(product.id);
  const [addedToCart, setAddedToCart] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = Boolean(product.images?.[0]) && !imgFailed;

  // Dispatch date only -- see the status badge below for why arrival is not
  // quoted until a destination province is known.
  const dispatchLabel = useMemo(() => {
    const { dispatchOn } = estimateDelivery({ inStock: product.inStock });
    return new Intl.DateTimeFormat("en-ZA", {
      weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
    }).format(dispatchOn);
  }, [product.inStock]);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart(product);
    setAddedToCart(true);
    setTimeout(() => setAddedToCart(false), 1500);
  };

  return (
    <article
      data-testid="product-card"
      data-product-id={product.id}
      data-product-category={product.category ?? ''}
      /* Raw ZAR price, for tests. The visible price goes through formatPrice,
         which switches currency symbol and separators across 13 locales, so
         parsing "R1 129,05" back out of the DOM would couple assertions to
         whichever locale the run happened to pick. */
      data-product-price={product.price}
      className="group relative flex flex-col overflow-hidden rounded-2xl bg-card border border-border/60 hover:border-border transition-all duration-300 hover:shadow-[0_20px_50px_-20px_hsl(var(--foreground)/0.18)] hover:-translate-y-0.5"
    >
      {/* Image */}
      <Link
        to={`/product/${product.id}`}
        className="relative block aspect-square overflow-hidden bg-white"
      >
        {/*
          object-contain, never object-cover: these are distributor product
          shots on white, and cropping one is worse than letterboxing it.
          Padding is deliberately small -- much of this catalogue is wide
          rack/array photography, which at p-6 on a ~250px card rendered as a
          sliver adrift in whitespace.
        */}
        {hasImage ? (
          <img
            src={product.images[0]}
            alt={`${product.name}${product.brand ? ` by ${product.brand}` : ""}${product.category ? ` — ${product.category}` : ""}`}
            width={800}
            height={800}
            className="absolute inset-0 h-full w-full object-contain p-3 sm:p-4 transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
            decoding="async"
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            role="img"
            aria-label={`${product.name} — image unavailable`}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted/40 via-background to-muted/30 text-muted-foreground p-6"
          >
            <PackageCheck className="h-10 w-10 opacity-40" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-center line-clamp-2">
              {product.brand || product.category || "Product"}
            </span>
          </div>
        )}


        {/* Top-left chip stack */}
        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {product.isAiProduct && (
            <span className="inline-flex items-center gap-1 rounded-full bg-foreground text-background text-[10px] font-bold px-2.5 py-1 tracking-wide shadow-sm">
              <Sparkles className="h-3 w-3" />
              AI READY
            </span>
          )}
        </div>

        {/* Wishlist */}
        <button
          type="button"
          aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          aria-pressed={wishlisted}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleWishlist(product.id); }}
          className={`absolute top-3 right-3 h-9 w-9 rounded-full bg-background/95 backdrop-blur-sm flex items-center justify-center shadow-sm transition-all ${
            wishlisted ? "text-destructive" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Heart className={`h-4 w-4 ${wishlisted ? "fill-current" : ""}`} />
        </button>
      </Link>

      {/* Content */}
      <div className="flex flex-1 flex-col p-4">
        {/* Brand · Category meta */}
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          {product.brand && <span className="text-foreground">{product.brand}</span>}
          {product.brand && product.category && <span className="opacity-40">·</span>}
          {product.category && <span className="truncate">{product.category}</span>}
        </div>

        {/* Title */}
        <Link to={`/product/${product.id}`} className="mb-2">
          <h3 className="font-display font-semibold text-[15px] leading-snug line-clamp-2 hover:text-primary transition-colors min-h-[2.6em]">
            {product.name}
          </h3>
        </Link>

        {/* Live status badge — one line, not a stack: what it is + when it ships */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {/* Promise only what's destination-independent here: the dispatch date
              is ours to control, whereas an arrival date depends on a province we
              don't know until checkout. Quoting metro transit to an unknown
              address is exactly how a delivery promise gets broken. */}
          {product.inStock ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              {t("delivery.inStockDispatch", { date: dispatchLabel })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold px-2 py-0.5">
              <Truck className="h-3 w-3" />
              {t("delivery.backorderDispatch", { date: dispatchLabel })}
            </span>
          )}
          {product.price > 0 && product.price <= RESIDENTIAL_MAX && (
            <span className="inline-flex items-center gap-1 rounded-full gradient-brand text-white text-[10px] font-bold px-2 py-0.5 shadow-sm">
              <Rocket className="h-3 w-3" />
              Smart Pick
            </span>
          )}
          {product.price > RESIDENTIAL_MAX && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold px-2 py-0.5">
              <PackageCheck className="h-3 w-3" />
              Enterprise
            </span>
          )}
        </div>

        <div className="flex-1" />

        {/* Price + CTA */}
        <div className="flex flex-col gap-3 pt-3 border-t border-border/60">
          <div className="flex flex-col min-w-0">
            <span className="font-display font-extrabold text-lg leading-none truncate">
              {formatPrice(product.price)}
            </span>
            <span className="text-[10px] text-muted-foreground mt-1">VAT incl.</span>
          </div>
          <button
            onClick={handleAddToCart}
            aria-label={`Add ${product.name} to cart`}
            className={`h-10 w-full rounded-full text-sm font-semibold flex items-center justify-center gap-1.5 px-4 transition-all ${
              addedToCart
                ? "bg-emerald-600 text-white"
                : "bg-foreground text-background hover:bg-foreground/90 hover:shadow-md"
            }`}
          >
            {addedToCart ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
            <span>{addedToCart ? t("product.added") : t("product.add")}</span>
          </button>
        </div>
      </div>
    </article>
  );
};

export default ProductCard;
