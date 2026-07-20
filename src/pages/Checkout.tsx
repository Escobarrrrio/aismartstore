import { useCart } from "@/contexts/CartContext";
import { useLocale } from "@/contexts/LocaleContext";
import { useExchangeRates } from "@/hooks/useExchangeRates";
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, XCircle, Shield, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { useShippingSettings, SA_PROVINCES } from "@/hooks/useShippingSettings";
import SEO from "@/components/SEO";
import { captureCheckoutError, capturePaymentError, captureOrderError } from "@/lib/sentry";

const Checkout = () => {
  const { items, totalPrice, clearCart } = useCart();
  const { currency, formatPrice } = useLocale();
  const { convert } = useExchangeRates();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { getShippingFee } = useShippingSettings();
  const [form, setForm] = useState({
    name: "", email: "", phone: "", address: "", city: "", province: "Eastern Cape", postalCode: "",
  });
  // Rough parcel-weight estimate: 1kg per item until products carry a real
  // weight column. Good enough for the sub-5kg tier which covers almost
  // everything we sell today.
  const estimatedWeightKg = items.reduce((s, i) => s + i.quantity, 0);
  const shippingFee = getShippingFee(totalPrice, {
    province: form.province,
    weightKg: estimatedWeightKg,
  });
  const grandTotal = totalPrice + shippingFee;
  const [submitted, setSubmitted] = useState(false);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const MAX_RETRIES = 3;
  const [capturingPaypal, setCapturingPaypal] = useState(searchParams.get("status") === "paypal_return");
  const failedOrderId = searchParams.get("orderId");
  const [userId, setUserId] = useState<string | null>(null);

  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user?.id ?? null);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const status = searchParams.get("status");
    const paypalToken = searchParams.get("token"); // PayPal appends this to the return_url automatically
    const pendingOrderId = searchParams.get("orderId");

    if (status === "success") {
      clearCart();
      setSubmitted(true);
    } else if (status === "failed") {
      setPaymentFailed(true);
    } else if (status === "paypal_return" && paypalToken && pendingOrderId) {
      // Customer approved on PayPal's page -- now actually capture the
      // payment. Landing on this URL alone does NOT mean money moved yet.
      supabase.functions
        .invoke("capture-paypal-order", { body: { paypalOrderId: paypalToken, orderId: pendingOrderId } })
        .then(({ data, error }) => {
          setCapturingPaypal(false);
          if (error || data?.status !== "completed") {
            capturePaymentError(error || new Error("PayPal capture did not complete"), {
              provider: "paypal", orderId: pendingOrderId, paypalToken, status: data?.status,
            });
            setPaymentFailed(true);
          } else {
            clearCart();
            setSubmitted(true);
          }
        });
    }
  }, [searchParams]);

  if (items.length === 0 && !submitted && !paymentFailed && !capturingPaypal) {
    if (!searchParams.get("status")) { navigate("/cart"); return null; }
  }

  // RLS on `orders` requires user_id = auth.uid(), so checkout only works when
  // signed in. Bounce guests to /auth and come straight back afterwards.
  if (authChecked && !userId && !submitted && !paymentFailed && !capturingPaypal) {
    navigate(`/auth?redirect=${encodeURIComponent("/checkout")}`);
    return null;
  }


  if (capturingPaypal) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <SEO title={t("checkout.processing")} description="Confirming your payment." noindex />
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-muted-foreground font-display font-semibold">{t("checkout.processing")}</p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="container mx-auto px-4 py-20 text-center animate-fade-in">
        <SEO title={t("checkout.orderSuccessTitle")} description="Order confirmed at AI Smart Store." noindex />
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

  const retryPayment = async () => {
    if (!failedOrderId || retryCount >= MAX_RETRIES) return;
    setRetrying(true);
    try {
      const baseUrl = window.location.origin;
      const { data, error } = await supabase.functions.invoke("create-yoco-checkout", {
        body: {
          orderId: failedOrderId,
          amount: grandTotal,
          currency: "ZAR",
          successUrl: `${baseUrl}/checkout?status=success`,
          failureUrl: `${baseUrl}/checkout?status=failed&orderId=${failedOrderId}`,
          cancelUrl: `${baseUrl}/cart`,
        },
      });
      if (error || !data?.redirectUrl) {
        const errorBody = error && "context" in error
          ? await (error as any).context?.json?.().catch(() => null)
          : data;
        if (errorBody?.priceChanged) {
          toast({
            title: "Your order total changed",
            description: `The price is now ${formatPrice(errorBody.newTotal)} (was ${formatPrice(errorBody.previousTotal)}). Please review your order and pay again.`,
            variant: "destructive",
          });
          setRetrying(false);
          return;
        }
        throw new Error(errorBody?.error || error?.message || "Retry failed");
      }
      setRetryCount((c) => c + 1);
      window.location.href = data.redirectUrl;
    } catch (err: any) {
      capturePaymentError(err, { provider: "yoco", flow: "retry", orderId: failedOrderId, attempt: retryCount + 1 });
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
      setRetrying(false);
    }
  };

  if (paymentFailed) {
    const canRetry = failedOrderId && retryCount < MAX_RETRIES;
    return (
      <div className="container mx-auto px-4 py-20 text-center animate-fade-in">
        <SEO title={t("checkout.paymentFailedTitle")} description="Payment status at AI Smart Store." noindex />
        <div className="w-20 h-20 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-6">
          <XCircle className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-3xl font-display font-extrabold mb-3">{t("checkout.paymentFailedTitle")}</h1>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
          {t("checkout.paymentFailedDesc")}
        </p>
        {retryCount > 0 && (
          <p className="text-xs text-muted-foreground mb-4">Attempt {retryCount + 1} of {MAX_RETRIES + 1}</p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {canRetry && (
            <button onClick={retryPayment} disabled={retrying} className="btn-primary px-8 py-3.5 text-sm shadow-elevated disabled:opacity-50">
              {retrying ? t("checkout.processing") : "Retry payment now"}
            </button>
          )}
          <button onClick={() => { setPaymentFailed(false); navigate("/checkout"); }} className="px-8 py-3.5 text-sm rounded-full border border-border font-display font-semibold hover:bg-muted transition-colors">
            {t("checkout.tryAgain")}
          </button>
        </div>
        {!canRetry && failedOrderId && (
          <p className="text-xs text-muted-foreground mt-6 max-w-md mx-auto">
            Maximum retries reached. Please contact support with reference #{failedOrderId.slice(0, 8)}.
          </p>
        )}
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);
    try {
      if (!userId) throw new Error("Please sign in to complete your order.");
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          user_id: userId,
          customer_name: form.name, customer_email: form.email, customer_phone: form.phone,
          address: form.address, city: form.city, province: form.province, postal_code: form.postalCode,
          total_amount: grandTotal, status: "pending",
        })
        .select().single();

      if (orderError || !order) {
        captureOrderError(orderError || new Error("Order insert returned no row"), {
          stage: "orders.insert", email: form.email, total: grandTotal,
        });
        throw new Error(orderError?.message || "Failed to create order");
      }

      const orderItems = items.map(({ product, quantity }) => ({
        order_id: order.id, product_id: product.id, quantity, unit_price: product.price,
      }));
      const { error: itemsError } = await supabase.from("order_items").insert(orderItems);
      if (itemsError) {
        captureOrderError(itemsError, { stage: "order_items.insert", orderId: order.id, itemCount: orderItems.length });
        throw new Error(itemsError.message);
      }

      const baseUrl = window.location.origin;
      const isInternational = currency !== "ZAR";
      const chargeAmount = isInternational ? convert(grandTotal, currency) : grandTotal;

      const { data: checkoutData, error: fnError } = await supabase.functions.invoke(
        isInternational ? "create-paypal-order" : "create-yoco-checkout",
        {
          body: isInternational
            ? {
                orderId: order.id, amount: chargeAmount, currency,
                description: `AI Smart Store Order #${order.id.slice(0, 8)}`,
                successUrl: `${baseUrl}/checkout?status=paypal_return&orderId=${order.id}`,
                cancelUrl: `${baseUrl}/cart`,
              }
            : {
                orderId: order.id, amount: chargeAmount, currency: "ZAR",
                successUrl: `${baseUrl}/checkout?status=success`,
                failureUrl: `${baseUrl}/checkout?status=failed&orderId=${order.id}`,
                cancelUrl: `${baseUrl}/cart`,
              },
        }
      );

      if (fnError || !checkoutData?.redirectUrl) {
        // supabase-js only puts the parsed JSON body in `data` on success --
        // on a non-2xx response it's on error.context instead, which is
        // where our structured price-changed/diagnostic payloads live.
        const errorBody = fnError && "context" in fnError
          ? await (fnError as any).context?.json?.().catch(() => null)
          : checkoutData;

        if (errorBody?.priceChanged) {
          toast({
            title: "Your order total changed",
            description: `The price is now ${formatPrice(errorBody.newTotal)} (was ${formatPrice(errorBody.previousTotal)}). Please review your order and pay again.`,
            variant: "destructive",
          });
          setProcessing(false);
          return;
        }

        capturePaymentError(fnError || new Error(errorBody?.error || "No redirect URL from gateway"), {
          provider: isInternational ? "paypal" : "yoco", orderId: order.id, amount: chargeAmount, currency,
        });
        throw new Error(errorBody?.error || fnError?.message || "Payment gateway error.");
      }
      if (!isInternational) {
        // Yoco confirms via redirect status. PayPal confirms via the
        // capture step on return instead (see the paypal_return handler
        // above), which is where notify-order fires for PayPal orders.
        const { error: notifyError } = await supabase.functions.invoke("notify-order", { body: { orderId: order.id } });
        if (notifyError) captureOrderError(notifyError, { stage: "notify-order", orderId: order.id });
      }
      window.location.href = checkoutData.redirectUrl;
    } catch (err: any) {
      captureCheckoutError(err, { email: form.email, total: grandTotal, currency });
      toast({ title: t("checkout.errorTitle"), description: err.message, variant: "destructive" });
      setProcessing(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <SEO title={t("checkout.title")} description="Secure checkout at AI Smart Store." noindex />
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5">{t("checkout.city")}</label>
              <input name="city" value={form.city} onChange={handleChange} required className="input-premium" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5">Province</label>
              <select name="province" value={form.province} onChange={handleChange} required className="input-premium">
                {SA_PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1.5">{t("checkout.postalCode")}</label>
              <input name="postalCode" value={form.postalCode} onChange={handleChange} required className="input-premium" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-1">
            Shipping is calculated from our Gqeberha (NMBM) warehouse using a benchmark zone × weight rate table. Weight above 5&nbsp;kg is an estimate.
          </p>
          <button
            type="submit"
            disabled={processing}
            className="w-full btn-primary py-3.5 text-sm shadow-elevated disabled:opacity-50 mt-4"
          >
            <Lock className="h-4 w-4" />
            {processing ? t("checkout.processing") : t("checkout.payWith", { amount: formatPrice(grandTotal), gateway: currency === "ZAR" ? "Yoco" : "PayPal" })}
          </button>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Shield className="h-3.5 w-3.5" />
            {t("checkout.securePayment", { gateway: currency === "ZAR" ? "Yoco" : "PayPal" })}
          </div>
        </form>

        <div className="card-flat p-6 h-fit">
          <h2 className="font-display font-bold text-lg mb-4">{t("checkout.orderReview")}</h2>
          <div className="space-y-3">
            {items.map(({ product, quantity }) => (
              <div key={product.id} className="flex justify-between text-sm py-1">
                <span className="text-muted-foreground">{product.name} × {quantity}</span>
                <span className="font-medium">{formatPrice(product.price * quantity)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border mt-4 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("cart.subtotal")}</span>
              <span className="font-medium">{formatPrice(totalPrice)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("cart.shipping")}</span>
              <span className="font-medium">{formatPrice(shippingFee)}</span>
            </div>
            <div className="flex justify-between font-display font-extrabold text-xl pt-2 border-t border-border">
              <span>{t("checkout.total")}</span>
              <span>{formatPrice(grandTotal)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
