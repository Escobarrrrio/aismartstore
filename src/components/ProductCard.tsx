import { Link } from "react-router-dom";
import { Product } from "@/contexts/CartContext";
import { useCart } from "@/contexts/CartContext";
import { ShoppingCart, Heart, Eye } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "@/contexts/LocaleContext";

interface ProductCardProps {
  product: Product;
  onQuickView?: (product: Product) => void;
}

const ProductCard = ({ product, onQuickView }: ProductCardProps) => {
  const { addToCart } = useCart();
  const { t } = useTranslation();
  const { formatPrice } = useLocale();
  const [wishlisted, setWishlisted] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart(product);
    setAddedToCart(true);
    setTimeout(() => setAddedToCart(false), 1500);
  };

  return (
    <div className="group card-premium overflow-hidden flex flex-col">
      <Link to={`/product/${product.id}`} className="block relative bg-muted aspect-[4/3] overflow-hidden">
        {product.images[0] ? (
          <img
            src={product.images[0]}
            alt={product.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
            <ShoppingCart className="h-10 w-10" />
          </div>
        )}

        {/* Overlay actions */}
        <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/5 transition-colors duration-300" />
        <div className="absolute top-3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWishlisted(!wishlisted); }}
            className={`w-9 h-9 rounded-full bg-background/90 backdrop-blur-sm flex items-center justify-center transition-colors shadow-md ${wishlisted ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <Heart className={`h-4 w-4 ${wishlisted ? 'fill-current' : ''}`} />
          </button>
          {onQuickView && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onQuickView(product); }}
              className="w-9 h-9 rounded-full bg-background/90 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-md"
            >
              <Eye className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Stock badge */}
        {product.inStock ? (
          <span className="absolute top-3 left-3 badge-success text-[10px]">{t("product.inStock")}</span>
        ) : (
          <span className="absolute top-3 left-3 badge-danger text-[10px]">{t("product.outOfStock")}</span>
        )}
      </Link>

      <div className="p-4 flex flex-col flex-1">
        {product.category && (
          <span className="text-[11px] text-primary font-semibold uppercase tracking-wider mb-1.5">
            {product.category}
          </span>
        )}
        <Link to={`/product/${product.id}`}>
          <h3 className="font-display font-bold text-sm leading-snug line-clamp-2 hover:text-primary transition-colors mb-1.5">
            {product.name}
          </h3>
        </Link>
        <p className="text-xs text-muted-foreground line-clamp-2 flex-1 leading-relaxed mb-3">
          {product.description}
        </p>
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50">
          <span className="font-display font-extrabold text-base sm:text-lg truncate">
            {formatPrice(product.price)}
          </span>
          <button
            onClick={handleAddToCart}
            disabled={!product.inStock}
            className={`h-10 px-3 sm:px-4 rounded-full text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-all duration-300 flex-shrink-0 ${
              addedToCart
                ? 'bg-[hsl(160,84%,39%)] text-white'
                : 'gradient-brand text-white hover:shadow-elevated hover:-translate-y-0.5'
            } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none`}
          >
            <ShoppingCart className="h-4 w-4" />
            <span>{addedToCart ? t("product.added") : t("product.add")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
