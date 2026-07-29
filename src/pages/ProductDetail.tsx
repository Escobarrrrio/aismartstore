import { useParams, useNavigate, Link } from "react-router-dom";
import { useLocale } from "@/contexts/LocaleContext";
import { useProducts } from "@/contexts/ProductContext";
import { useCart } from "@/contexts/CartContext";
import type { Product } from "@/contexts/CartContext";
import { useWishlist } from "@/contexts/WishlistContext";
import SEO from "@/components/SEO";
import { supabase } from "@/integrations/supabase/client";
import ImageLightbox from "@/components/ImageLightbox";
import {
  ArrowLeft, ShoppingCart, Check, Truck, Shield, RotateCcw, MapPin,
  Star, ChevronLeft, ChevronRight, Package, MessageCircle, Minus, Plus, Heart,
  Maximize2
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const DEFAULT_DISPATCH_CITY = "Gqeberha";

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { products, getProduct } = useProducts();
  const { addToCart } = useCart();
  const { isWishlisted, toggleWishlist } = useWishlist();
  const { formatPrice } = useLocale();
  const { t } = useTranslation();
  const [selectedImage, setSelectedImage] = useState(0);
  const [added, setAdded] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [product, setProduct] = useState<Product | undefined>(undefined);
  const [resolved, setResolved] = useState(false);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [dispatchCity, setDispatchCity] = useState(DEFAULT_DISPATCH_CITY);

  useEffect(() => {
    supabase.from("store_settings").select("value").eq("key", "dispatch_city").maybeSingle()
      .then(({ data }) => { if (data?.value) setDispatchCity(data.value); });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setResolved(false);
    setFailedImages({});
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
        <Package className="h-14 w-14 text-muted-foreground/60 mx-auto mb-4 animate-pulse" />
        <p className="text-muted-foreground">{t("productDetail.home")}…</p>
      </div>
    );
  }



  if (!product) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <SEO title={t("productDetail.notFoundTitle")} description={t("productDetail.notFoundDesc")} noindex />
        <Package className="h-16 w-16 text-muted-foreground/60 mx-auto mb-4" />
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
        ogType="product"
        image={product.images[0]}
        jsonLd={[
          {
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
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: "https://aismartstore.co.za/" },
              { "@type": "ListItem", position: 2, name: "Products", item: "https://aismartstore.co.za/products" },
              ...(product.category
                ? [{ "@type": "ListItem", position: 3, name: product.category, item: `https://aismartstore.co.za/products?category=${encodeURIComponent(product.category)}` }]
                : []),
              { "@type": "ListItem", position: product.category ? 4 : 3, name: product.name, item: `https://aismartstore.co.za/product/${product.id}` },
            ],
          },
        ]}
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
            <div className="relative aspect-square rounded-2xl overflow-hidden bg-white border border-border">
              {product.images[selectedImage] && !failedImages[selectedImage] ? (
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  aria-label={t("productDetail.enlargeImage")}
                  className="group h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {/* object-contain, not object-cover: cover was cropping the
                      edges off every product shot -- on a wide rack photo you
                      were seeing the middle third of the product only. */}
                  <img
                    src={product.images[selectedImage]}
                    alt={product.name}
                    className="w-full h-full object-contain p-4 transition-transform duration-300 group-hover:scale-[1.03]"
                    onError={() => setFailedImages((f) => ({ ...f, [selectedImage]: true }))}
                  />
                  <span className="absolute bottom-3 right-3 rounded-full bg-foreground/75 text-background text-[11px] font-semibold px-2.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Maximize2 className="h-3 w-3 inline mr-1" aria-hidden="true" />
                    {t("productDetail.clickToEnlarge")}
                  </span>
                </button>
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground/60">
                  <Package className="h-20 w-20" />
                </div>
              )}
              {product.isAiProduct && (
                <span className="absolute top-3 left-3 gradient-brand text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-md tracking-wide pointer-events-none">
                  AI
                </span>
              )}

              {/* Sideways navigation on the main image itself, so browsing the
                  other photos doesn't depend on hitting a 20px thumbnail. */}
              {product.images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setSelectedImage((i) => (i - 1 + product.images.length) % product.images.length)}
                    aria-label={t("productDetail.previousImage")}
                    className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded-full bg-background/85 border border-border shadow-sm hover:bg-background transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedImage((i) => (i + 1) % product.images.length)}
                    aria-label={t("productDetail.nextImage")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded-full bg-background/85 border border-border shadow-sm hover:bg-background transition-colors"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </>
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
                    {img && !failedImages[i] ? (
                      <img
                        src={img}
                        alt=""
                        className="w-full h-full object-contain bg-white p-1"
                        onError={() => setFailedImages((f) => ({ ...f, [i]: true }))}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground/60">
                        <Package className="h-6 w-6" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            <ImageLightbox
              images={product.images}
              index={selectedImage}
              onIndexChange={setSelectedImage}
              open={lightboxOpen}
              onClose={() => setLightboxOpen(false)}
              alt={product.name}
              failed={failedImages}
              onImageError={(i) => setFailedImages((f) => ({ ...f, [i]: true }))}
            />
          </div>

          {/* Details */}
          <div className="flex flex-col">
            {product.category && (
              <Link to="/products" className="text-xs font-semibold text-primary uppercase tracking-wider mb-2 hover:underline">
                {product.category}
              </Link>
            )}
            <h1 className="text-2xl md:text-3xl font-display font-extrabold tracking-tight mb-3">
              {product.name}
            </h1>

            {(product.brand || product.sku) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mb-4">
                {product.brand && (
                  <span><span className="font-semibold text-foreground">Brand:</span> {product.brand}</span>
                )}
                {product.sku && (
                  <span><span className="font-semibold text-foreground">Product code:</span> {product.sku}</span>
                )}
              </div>
            )}

            <div className="flex items-baseline gap-3 mb-6">
              <span className="text-3xl font-display font-extrabold">
                {formatPrice(product.price)}
              </span>
              <span className={`text-sm font-semibold ${product.inStock ? 'text-[hsl(160,84%,39%)]' : 'text-destructive'}`}>
                {product.inStock
                  ? (typeof product.stockQuantity === "number"
                      ? `${t("productDetail.inStock")} (${product.stockQuantity} available)`
                      : t("productDetail.inStock"))
                  : t("productDetail.outOfStock")}
              </span>
            </div>

            {product.description &&
              product.description.trim().toLowerCase() !== product.name.trim().toLowerCase() && (
              <p className="text-muted-foreground leading-relaxed mb-8">{product.description}</p>
            )}

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
              <button
                onClick={() => toggleWishlist(product.id)}
                aria-label={isWishlisted(product.id) ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
                aria-pressed={isWishlisted(product.id)}
                className={`flex items-center justify-center h-[52px] w-[52px] sm:w-auto sm:px-5 rounded-xl border transition-colors ${
                  isWishlisted(product.id)
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "border-border hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <Heart className={`h-5 w-5 ${isWishlisted(product.id) ? "fill-current" : ""}`} />
              </button>
            </div>

            {/* Reassurance */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { icon: Truck, label: t("productDetail.freeDelivery") },
                { icon: Shield, label: t("productDetail.secureCheckout") },
                { icon: RotateCcw, label: t("productDetail.easyReturns") },
                { icon: MapPin, label: t("productDetail.dispatchedFrom", { city: dispatchCity }) },
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
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/60">
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
