import { useCart } from "@/contexts/CartContext";
import { formatMoney } from "@/lib/currency";
import { useLocale } from "@/contexts/LocaleContext";
import { Link } from "react-router-dom";
import { Trash2, Plus, Minus, ShoppingBag, ArrowRight, Shield, Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
import SEO from "@/components/SEO";
import { useShippingSettings } from "@/hooks/useShippingSettings";

const Cart = () => {
  const { items, removeFromCart, updateQuantity, totalPrice, clearCart } = useCart();
  const { currency } = useLocale();
  const { t } = useTranslation();
  const { freeThreshold, getShippingFee } = useShippingSettings();
  const shippingFee = getShippingFee(totalPrice);
  const grandTotal = totalPrice + shippingFee;

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <SEO title={t("cart.shoppingCart")} description="Your shopping cart at AI Smart Store." noindex />
        <ShoppingBag className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
        <h2 className="text-2xl font-display font-bold mb-2">{t("cart.emptyTitle")}</h2>
        <p className="text-muted-foreground mb-6">{t("cart.emptyHint")}</p>
        <Link to="/products" className="btn-primary px-7 py-3.5 text-sm shadow-elevated">
          {t("cart.browseProducts")} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <SEO title={t("cart.shoppingCart")} description="Your shopping cart at AI Smart Store." noindex />
      <h1 className="text-3xl font-display font-extrabold tracking-tight mb-8">{t("cart.shoppingCart")}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-3">
          {items.map(({ product, quantity }) => (
            <div key={product.id} className="card-flat flex gap-4 p-4">
              <div className="w-20 h-20 rounded-xl overflow-hidden bg-muted flex-shrink-0">
                {product.images[0] ? (
                  <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                    <ShoppingBag className="h-6 w-6" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <Link to={`/product/${product.id}`} className="font-display font-bold text-sm line-clamp-1 hover:text-primary transition-colors">
                  {product.name}
                </Link>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {formatMoney(product.price, currency)}
                </p>
                <div className="flex items-center gap-1 mt-2">
                  <button
                    onClick={() => updateQuantity(product.id, quantity - 1)}
                    className="w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="text-sm font-semibold w-10 text-center">{quantity}</span>
                  <button
                    onClick={() => updateQuantity(product.id, quantity + 1)}
                    className="w-8 h-8 rounded-lg border border-border flex items-center justify-center hover:bg-muted transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-end justify-between">
                <button
                  onClick={() => removeFromCart(product.id)}
                  className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/[0.06] transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <span className="font-display font-bold text-sm">
                  {formatMoney(product.price * quantity, currency)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="card-flat p-6 h-fit sticky top-24 space-y-4">
          <h3 className="font-display font-bold text-lg">{t("cart.orderSummary")}</h3>
          {shippingFee > 0 && (
            <div className="bg-primary/[0.06] border border-primary/10 rounded-xl px-3.5 py-2.5 text-xs font-medium text-primary">
              {t("cart.freeShippingHint", { amount: formatMoney(freeThreshold - totalPrice, currency) })}
            </div>
          )}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("cart.subtotal")}</span>
              <span className="font-medium">{formatMoney(totalPrice, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("cart.shipping")}</span>
              <span className={shippingFee === 0 ? "text-[hsl(160,84%,39%)] font-semibold" : "font-medium"}>
                {shippingFee === 0 ? t("cart.free") : formatMoney(shippingFee, currency)}
              </span>
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <div className="flex justify-between font-display font-extrabold text-xl">
              <span>{t("cart.total")}</span>
              <span>{formatMoney(grandTotal, currency)}</span>
            </div>
          </div>
          <Link to="/checkout" className="btn-primary w-full py-3.5 text-sm shadow-elevated">
            {t("cart.proceedToCheckout")}
          </Link>
          <div className="flex items-center justify-center gap-4 pt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> {t("cart.secure")}</span>
            <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> {t("cart.freeOver")}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;
