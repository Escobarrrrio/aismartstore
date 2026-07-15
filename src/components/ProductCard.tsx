import { Link } from "react-router-dom";
import { Product } from "@/contexts/CartContext";
import { useCart } from "@/contexts/CartContext";
import { ShoppingCart, Heart, Sparkles, Truck, ShieldCheck, Check, Zap, Home, PackageCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "@/contexts/LocaleContext";

interface ProductCardProps {
  product: Product;
  onQuickView?: (product: Product) => void;
}

const FREE_SHIPPING_THRESHOLD = 1000;
const RESIDENTIAL_MAX = 15000;
const SHIPS_FAST_MIN_STOCK = 5;

const ProductCard = ({ product }: ProductCardProps) => {
  const { addToCart } = useCart();
  const { t } = useTranslation();
  const { formatPrice } = useLocale();
  const [wishlisted, setWishlisted] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  // Hide entire card if we have no valid image — the listing must feel curated.
  if (!product.images?.[0] || imgFailed) {
    return (
      <img
        src={product.images?.[0] || ""}
        alt=""
        aria-hidden
        className="hidden"
        onError={() => setImgFailed(true)}
      />
    );
  }

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart(product);
    setAddedToCart(true);
    setTimeout(() => setAddedToCart(false), 1500);
  };

  const freeShipping = product.price >= FREE_SHIPPING_THRESHOLD;

  return (
    <article data-testid="product-card" data-product-id={product.id} data-product-category={product.category ?? ''} className="group relative flex flex-col overflow-hidden rounded-2xl bg-card border border-border/60 hover:border-border transition-all duration-300 hover:shadow-[0_20px_50px_-20px_hsl(var(--foreground)/0.18)] hover:-translate-y-0.5">
      {/* Image */}
      <Link
        to={`/product/${product.id}`}
        className="relative block aspect-square overflow-hidden bg-white"
      >
        <img
          src={product.images[0]}
          alt={`${product.name}${product.brand ? ` by ${product.brand}` : ""}${product.category ? ` — ${product.category}` : ""}`}
          width={800}
          height={800}
          className="absolute inset-0 h-full w-full object-contain p-6 transition-transform duration-500 group-hover:scale-[1.04]"
          loading="lazy"
          decoding="async"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          onError={() => setImgFailed(true)}
        />

        {/* Top-left chip stack */}
        <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {product.isAiProduct && (
            <span className="inline-flex items-center gap-1 rounded-full bg-foreground text-background text-[10px] font-bold px-2.5 py-1 tracking-wide shadow-sm">
              <Sparkles className="h-3 w-3" />
              AI READY
            </span>
          )}
          {freeShipping && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5">
              <Truck className="h-3 w-3" />
              Free delivery
            </span>
          )}
        </div>

        {/* Wishlist */}
        <button
          type="button"
          aria-label="Add to wishlist"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWishlisted(!wishlisted); }}
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

        {/* Live status badges */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {product.inStock && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold px-2 py-0.5">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              In Stock
            </span>
          )}
          {product.inStock && (typeof product.stockQuantity !== "number" || product.stockQuantity >= SHIPS_FAST_MIN_STOCK) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-semibold px-2 py-0.5">
              <Zap className="h-3 w-3" />
              Ships Fast · {
                typeof product.stockQuantity !== "number"
                  ? "2–4 days"
                  : product.stockQuantity >= 20
                    ? "1–2 days"
                    : "2–3 days"
              }
            </span>
          )}
          {product.inStock && typeof product.stockQuantity === "number" && product.stockQuantity > 0 && product.stockQuantity < SHIPS_FAST_MIN_STOCK && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold px-2 py-0.5">
              <Zap className="h-3 w-3" />
              Ships in 3–5 days
            </span>
          )}
          {product.price > 0 && product.price <= RESIDENTIAL_MAX && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200 text-[10px] font-semibold px-2 py-0.5">
              <Home className="h-3 w-3" />
              Under R15k
            </span>
          )}
          {product.price > RESIDENTIAL_MAX && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold px-2 py-0.5">
              <PackageCheck className="h-3 w-3" />
              Enterprise
            </span>
          )}
        </div>

        {/* Trust line */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-3">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-emerald-600" />
            Genuine
          </span>
          <span className="inline-flex items-center gap-1">
            <Truck className="h-3 w-3" />
            Ships from ZA
          </span>
        </div>

        <div className="flex-1" />

        {/* Price + CTA */}
        <div className="flex items-end justify-between gap-2 pt-3 border-t border-border/60">
          <div className="flex flex-col min-w-0">
            <span className="font-display font-extrabold text-lg leading-none truncate">
              {formatPrice(product.price)}
            </span>
            <span className="text-[10px] text-muted-foreground mt-1">VAT incl.</span>
          </div>
          <button
            onClick={handleAddToCart}
            aria-label={`Add ${product.name} to cart`}
            className={`h-10 rounded-full text-sm font-semibold flex items-center gap-1.5 px-4 transition-all flex-shrink-0 ${
              addedToCart
                ? "bg-emerald-600 text-white"
                : "bg-foreground text-background hover:bg-foreground/90 hover:shadow-md"
            }`}
          >
            {addedToCart ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
            <span className="hidden sm:inline">{addedToCart ? t("product.added") : t("product.add")}</span>
          </button>
        </div>
      </div>
    </article>
  );
};

export default ProductCard;
