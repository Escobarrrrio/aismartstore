import { useCart } from "@/contexts/CartContext";
import { formatMoney } from "@/lib/currency";
import { useLocale } from "@/contexts/LocaleContext";
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, XCircle, Shield, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useShippingSettings } from "@/hooks/useShippingSettings";

const Checkout = () => {
  const { items, totalPrice, clearCart } = useCart();
  const { currency } = useLocale();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { getShippingFee } = useShippingSettings();
  const shippingFee = getShippingFee(totalPrice);
  const grandTotal = totalPrice + shippingFee;
  const [submitted, setSubmitted] = useState(false);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", address: "", city: "", postalCode: "",
  });

  useEffect(() => {
    const status = searchParams.get("status");
    if (status === "success") { clearCart(); setSubmitted(true); }
    else if (status === "failed") { setPaymentFailed(true); }
  }, [searchParams]);

  if (items.length === 0 && !submitted && !paymentFailed) {
    if (!searchParams.get("status")) { navigate("/cart"); return null; }
  }

  if (submitted) {
    return (
      <div className="container mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="w-20 h-20 rounded-full bg-[hsl(160,84%,39%)]/10 flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="h-10 w-10 text-[hsl(160,84%,39%)]" />
        </div>
        <h1 className="text-3xl font-display font-extrabold mb-3">{t("checkout.orderSuccessTitle")}</h1>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
          {t("checkout.orderSuccessDesc")}
        </p>
        <button onClick={() => navigate("/")} className="btn-primary px-8 py-3.5 text-sm shadow-elevated">
          {t("checkout.continueShopping")}
        </button>
      </div>
    );
  }

  if (paymentFailed) {
    return (
      <div className="container mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
          <XCircle className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-3xl font-display font-extrabold mb-3">{t("checkout.paymentFailedTitle")}</h1>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
          {t("checkout.paymentFailedDesc")}
        </p>
        <button onClick={() => { setPaymentFailed(false); navigate("/checkout"); }} className="btn-primary px-8 py-3.5 text-sm shadow-elevated">
          {t("checkout.tryAgain")}
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    try {
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          customer_name: form.name, customer_email: form.email, customer_phone: form.phone,
          address: form.address, city: form.city, postal_code: form.postalCode,
          total_amount: grandTotal, status: "pending",
        })
        .select().single();

      if (orderError || !order) throw new Error(orderError?.message || "Failed to create order");

      const orderItems = items.map(({ product, quantity }) => ({
        order_id: order.id, product_id: product.id, quantity, unit_price: product.price,
      }));
      await supabase.from("order_items").insert(orderItems);

      const baseUrl = window.location.origin;
      const { data: checkoutData, error: fnError } = await supabase.functions.invoke("create-yoco-checkout", {
        body: {
          orderId: order.id, amount: grandTotal, currency: "ZAR",
          successUrl: `${baseUrl}/checkout?status=success`,
          failureUrl: `${baseUrl}/checkout?status=failed`,
          cancelUrl: `${baseUrl}/cart`,
        },
      });

      if (fnError || !checkoutData?.redirectUrl) throw new Error(fnError?.message || "Payment gateway error.");
      await supabase.functions.invoke("notify-order", { body: { orderId: order.id } });
      window.location.href = checkoutData.redirectUrl;
    } catch (err: any) {
      toast({ title: t("checkout.errorTitle"), description: err.message, variant: "destructive" });
      setProcessing(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <h1 className="text-3xl font-display font-extrabold tracking-tight mb-8">{t("checkout.title")}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <form onSubmit={handleSubmit} className="space-y-5">
          <h2 className="font-display font-bold text-lg">{t("checkout.shippingDetails")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5">{t("checkout.fullName")}</label>
              <input name="name" value={form.name} onChange={handleChange} required className="input-premium" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5">{t("checkout.email")}</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} required className="input-premium" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">{t("checkout.phone")}</label>
            <input name="phone" value={form.phone} onChange={handleChange} required className="input-premium" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">{t("checkout.address")}</label>
            <textarea name="address" value={form.address} onChange={handleChange} required rows={2} className="input-premium resize-none" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5">{t("checkout.city")}</label>
              <input name="city" value={form.city} onChange={handleChange} required className="input-premium" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5">{t("checkout.postalCode")}</label>
              <input name="postalCode" value={form.postalCode} onChange={handleChange} required className="input-premium" />
            </div>
          </div>
          <button
            type="submit"
            disabled={processing}
            className="w-full btn-primary py-3.5 text-sm shadow-elevated disabled:opacity-50 mt-4"
          >
            <Lock className="h-4 w-4" />
            {processing ? t("checkout.processing") : t("checkout.payWith", { amount: formatMoney(grandTotal, currency) })}
          </button>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            {t("checkout.securePayment")}
          </div>
        </form>

        <div className="card-flat p-6 h-fit">
          <h2 className="font-display font-bold text-lg mb-4">{t("checkout.orderReview")}</h2>
          <div className="space-y-3">
            {items.map(({ product, quantity }) => (
              <div key={product.id} className="flex justify-between text-sm py-1">
                <span className="text-muted-foreground">{product.name} × {quantity}</span>
                <span className="font-medium">{formatMoney(product.price * quantity, currency)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border mt-4 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("cart.subtotal")}</span>
              <span className="font-medium">{formatMoney(totalPrice, currency)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("cart.shipping")}</span>
              <span className={shippingFee === 0 ? "text-[hsl(160,84%,39%)] font-semibold" : "font-medium"}>
                {shippingFee === 0 ? t("cart.free") : formatMoney(shippingFee, currency)}
              </span>
            </div>
            <div className="flex justify-between font-display font-extrabold text-xl pt-2 border-t border-border">
              <span>{t("checkout.total")}</span>
              <span>{formatMoney(grandTotal, currency)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
