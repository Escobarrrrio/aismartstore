import { useParams, useNavigate, Link } from "react-router-dom";
import { useLocale } from "@/contexts/LocaleContext";
import { useProducts } from "@/contexts/ProductContext";
import { useCart } from "@/contexts/CartContext";
import type { Product } from "@/contexts/CartContext";
import SEO from "@/components/SEO";
import {
  ArrowLeft, ShoppingCart, Check, Truck, Shield, RotateCcw,
  Star, ChevronRight, Package, MessageCircle, Minus, Plus
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { products, getProduct } = useProducts();
  const { addToCart } = useCart();
  const { formatPrice } = useLocale();
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState(0);
  const [added, setAdded] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [product, setProduct] = useState<Product | undefined>(undefined);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResolved(false);
    getProduct(id || "").then((p) => {
      if (!cancelled) {
        setProduct(p);
        setResolved(true);
        setSelectedImage(0);
      }
    });
    return () => { cancelled = true; };
  }, [id, getProduct]);

  // Related products (from currently loaded page)
  const related = product
    ? products.filter((p) => p.category === product.category && p.id !== product.id).slice(0, 4)
    : [];

  if (!resolved) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <Package className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4 animate-pulse" />
        <p className="text-muted-foreground">{t("productDetail.home")}…</p>
      </div>
    );
  }



  if (!product) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <SEO title={t("productDetail.notFoundTitle")} description={t("productDetail.notFoundDesc")} noindex />
        <Package className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="font-display font-bold text-2xl mb-2">{t("productDetail.notFoundTitle")}</h1>
        <p className="text-muted-foreground mb-6">{t("productDetail.notFoundDesc")}</p>
        <button onClick={() => navigate("/products")} className="btn-primary px-6 py-3 text-sm">
          <ArrowLeft className="h-4 w-4" /> {t("productDetail.backToProducts")}
        </button>
      </div>
    );
  }

  const handleAddToCart = () => {
    addToCart(product, quantity);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className="min-h-screen">
      <SEO
        title={product.name}
        description={product.description || `${product.name} — available now at AI Smart Store. ${product.inStock ? "In stock" : "Currently out of stock"}, with secure checkout and SA-wide delivery.`}
        path={`/product/${product.id}`}
        image={product.images[0]}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.name,
          description: product.description,
          image: product.images,
          category: product.category || undefined,
          offers: {
            "@type": "Offer",
            priceCurrency: "ZAR",
            price: product.price,
            availability: product.inStock
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
            url: `${window.location.origin}/product/${product.id}`,
          },
        }}
      />
      {/* Breadcrumb */}
      <div className="bg-muted/50 border-b border-border">
        <div className="container mx-auto px-4 py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition-colors">{t("productDetail.home")}</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link to="/products" className="hover:text-foreground transition-colors">{t("productDetail.products")}</Link>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="text-foreground font-medium truncate max-w-[200px]">{product.name}</span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
          {/* Images */}
          <div className="space-y-4">
            <div className="aspect-square rounded-2xl overflow-hidden bg-muted border border-border">
              {product.images[selectedImage] ? (
                <img
                  src={product.images[selectedImage]}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                  <Package className="h-20 w-20" />
                </div>
              )}
            </div>
            {product.images.length > 1 && (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {product.images.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedImage(i)}
                    className={`w-20 h-20 rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all ${
                      i === selectedImage ? "border-primary shadow-md" : "border-border hover:border-muted-foreground/30"
                    }`}
                  >
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col">
            {product.category && (
              <Link to="/products" className="text-xs font-semibold text-primary uppercase tracking-wider mb-2 hover:underline">
                {product.category}
              </Link>
            )}
            <h1 className="text-2xl md:text-3xl font-display font-extrabold tracking-tight mb-4">
              {product.name}
            </h1>

            <div className="flex items-baseline gap-3 mb-6">
              <span className="text-3xl font-display font-extrabold">
                {formatPrice(product.price)}
              </span>
              <span className={`text-sm font-semibold ${product.inStock ? 'text-[hsl(160,84%,39%)]' : 'text-destructive'}`}>
                {product.inStock ? t("productDetail.inStock") : t("productDetail.outOfStock")}
              </span>
            </div>

            <p className="text-muted-foreground leading-relaxed mb-8">{product.description}</p>

            {/* Quantity + Add to Cart */}
            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <div className="flex items-center border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="px-4 py-3 hover:bg-muted transition-colors"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="px-5 py-3 text-sm font-semibold min-w-[60px] text-center border-x border-border">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="px-4 py-3 hover:bg-muted transition-colors"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button
                onClick={handleAddToCart}
                disabled={!product.inStock}
                className="flex-1 btn-primary px-8 py-3.5 text-sm font-semibold shadow-elevated disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                {added ? (
                  <><Check className="h-5 w-5" /> {t("productDetail.addedToCart")}</>
                ) : (
                  <><ShoppingCart className="h-5 w-5" /> {t("productDetail.addToCart")}</>
                )}
              </button>
            </div>

            {/* Reassurance */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: Truck, label: t("productDetail.freeDelivery") },
                { icon: Shield, label: t("productDetail.secureCheckout") },
                { icon: RotateCcw, label: t("productDetail.easyReturns") },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-2.5 p-3 rounded-xl bg-muted/50 border border-border/50">
                  <item.icon className="h-4 w-4 text-primary flex-shrink-0" />
                  <span className="text-xs font-medium">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Specifications placeholder */}
        <div className="mt-16 border-t border-border pt-12">
          <h2 className="font-display font-bold text-xl mb-6">{t("productDetail.specifications")}</h2>
          <div className="card-flat p-6">
            <p className="text-sm text-muted-foreground">
              {t("productDetail.specPlaceholder")}
            </p>
          </div>
        </div>

        {/* Related products */}
        {related.length > 0 && (
          <div className="mt-16 border-t border-border pt-12">
            <div className="flex items-center justify-between mb-8">
              <h2 className="font-display font-bold text-xl">{t("productDetail.relatedProducts")}</h2>
              <Link to="/products" className="text-sm text-primary font-semibold hover:underline flex items-center gap-1">
                {t("productDetail.viewAll")} <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {related.map((p) => (
                <Link
                  key={p.id}
                  to={`/product/${p.id}`}
                  className="card-premium overflow-hidden group"
                >
                  <div className="aspect-[4/3] bg-muted overflow-hidden">
                    {p.images[0] ? (
                      <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                        <Package className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-display font-bold text-sm line-clamp-1 group-hover:text-primary transition-colors">{p.name}</h3>
                    <p className="text-sm font-display font-extrabold mt-1">{formatPrice(p.price)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductDetail;
