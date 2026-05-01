import { useCart } from "@/contexts/CartContext";
import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const Checkout = () => {
  const { items, totalPrice, clearCart } = useCart();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const [submitted, setSubmitted] = useState(false);
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postalCode: "",
  });

  // Check for returning from Yoco payment
  useEffect(() => {
    const status = searchParams.get("status");
    if (status === "success") {
      clearCart();
      setSubmitted(true);
    } else if (status === "failed") {
      setPaymentFailed(true);
    }
  }, [searchParams]);

  if (items.length === 0 && !submitted && !paymentFailed) {
    if (!searchParams.get("status")) {
      navigate("/cart");
      return null;
    }
  }

  if (submitted) {
    return (
      <div className="container mx-auto px-4 py-20 text-center animate-fade-in">
        <CheckCircle className="h-20 w-20 text-primary mx-auto mb-6" />
        <h1 className="text-3xl font-display font-bold mb-3">Order Placed & Paid!</h1>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
          Thank you for your purchase. We'll process your order and ship it to you shortly.
        </p>
        <button onClick={() => navigate("/")} className="px-8 py-3 rounded-full gradient-brand text-primary-foreground font-semibold">
          Continue Shopping
        </button>
      </div>
    );
  }

  if (paymentFailed) {
    return (
      <div className="container mx-auto px-4 py-20 text-center animate-fade-in">
        <XCircle className="h-20 w-20 text-destructive mx-auto mb-6" />
        <h1 className="text-3xl font-display font-bold mb-3">Payment Failed</h1>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
          Your payment was not completed. Please try again or use a different payment method.
        </p>
        <button onClick={() => { setPaymentFailed(false); navigate("/checkout"); }} className="px-8 py-3 rounded-full gradient-brand text-primary-foreground font-semibold">
          Try Again
        </button>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);

    try {
      // Create order in database
      const { data: order, error: orderError } = await supabase
        .from("orders")
        .insert({
          customer_name: form.name,
          customer_email: form.email,
          customer_phone: form.phone,
          address: form.address,
          city: form.city,
          postal_code: form.postalCode,
          total_amount: totalPrice,
          status: "pending",
        })
        .select()
        .single();

      if (orderError || !order) {
        throw new Error(orderError?.message || "Failed to create order");
      }

      // Create order items
      const orderItems = items.map(({ product, quantity }) => ({
        order_id: order.id,
        product_id: product.id,
        quantity,
        unit_price: product.price,
      }));

      await supabase.from("order_items").insert(orderItems);

      // Create Yoco checkout
      const baseUrl = window.location.origin;
      const { data: checkoutData, error: fnError } = await supabase.functions.invoke("create-yoco-checkout", {
        body: {
          orderId: order.id,
          amount: totalPrice,
          currency: "ZAR",
          successUrl: `${baseUrl}/checkout?status=success`,
          failureUrl: `${baseUrl}/checkout?status=failed`,
          cancelUrl: `${baseUrl}/cart`,
        },
      });

      if (fnError || !checkoutData?.redirectUrl) {
        throw new Error(fnError?.message || "Payment gateway error. Please check Yoco settings in admin.");
      }

      // Trigger order notification
      await supabase.functions.invoke("notify-order", {
        body: { orderId: order.id },
      });

      // Redirect to Yoco payment page
      window.location.href = checkoutData.redirectUrl;
    } catch (err: any) {
      toast({ title: "Checkout error", description: err.message, variant: "destructive" });
      setProcessing(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold mb-8">Checkout</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <form onSubmit={handleSubmit} className="space-y-5">
          <h2 className="font-display font-semibold text-lg">Shipping Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Full Name</label>
              <input name="name" value={form.name} onChange={handleChange} required className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} required className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Phone</label>
            <input name="phone" value={form.phone} onChange={handleChange} required className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Address</label>
            <textarea name="address" value={form.address} onChange={handleChange} required rows={2} className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition resize-none" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">City</label>
              <input name="city" value={form.city} onChange={handleChange} required className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Postal Code</label>
              <input name="postalCode" value={form.postalCode} onChange={handleChange} required className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition" />
            </div>
          </div>
          <button
            type="submit"
            disabled={processing}
            className="w-full px-8 py-3.5 rounded-full gradient-brand text-primary-foreground font-semibold hover:opacity-90 transition-opacity shadow-elevated mt-4 disabled:opacity-50"
          >
            {processing ? "Processing..." : `Pay R${totalPrice.toFixed(2)} with Yoco`}
          </button>
          <p className="text-xs text-muted-foreground text-center">Secure payment powered by Yoco</p>
        </form>

        <div className="bg-card rounded-lg border border-border/50 shadow-card p-6 h-fit">
          <h2 className="font-display font-semibold text-lg mb-4">Order Review</h2>
          <div className="space-y-3">
            {items.map(({ product, quantity }) => (
              <div key={product.id} className="flex justify-between text-sm">
                <span>{product.name} × {quantity}</span>
                <span className="font-medium">R{(product.price * quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border/50 mt-4 pt-4">
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span className="gradient-brand-text">R{totalPrice.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
