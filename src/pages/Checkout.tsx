import { useCart } from "@/contexts/CartContext";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle } from "lucide-react";

const Checkout = () => {
  const { items, totalPrice, clearCart } = useCart();
  const navigate = useNavigate();
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    postalCode: "",
  });

  if (items.length === 0 && !submitted) {
    navigate("/cart");
    return null;
  }

  if (submitted) {
    return (
      <div className="container mx-auto px-4 py-20 text-center animate-fade-in">
        <CheckCircle className="h-20 w-20 text-primary mx-auto mb-6" />
        <h1 className="text-3xl font-display font-bold mb-3">Order Placed!</h1>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
          Thank you for your order. We'll process it shortly and send you a confirmation email.
        </p>
        <button
          onClick={() => navigate("/")}
          className="px-8 py-3 rounded-full gradient-brand text-primary-foreground font-semibold"
        >
          Continue Shopping
        </button>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // For now, just simulate order placement
    clearCart();
    setSubmitted(true);
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
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                required
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Phone</label>
            <input
              name="phone"
              value={form.phone}
              onChange={handleChange}
              required
              className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Address</label>
            <textarea
              name="address"
              value={form.address}
              onChange={handleChange}
              required
              rows={2}
              className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">City</label>
              <input
                name="city"
                value={form.city}
                onChange={handleChange}
                required
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Postal Code</label>
              <input
                name="postalCode"
                value={form.postalCode}
                onChange={handleChange}
                required
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full px-8 py-3.5 rounded-full gradient-brand text-primary-foreground font-semibold hover:opacity-90 transition-opacity shadow-elevated mt-4"
          >
            Place Order — R{totalPrice.toFixed(2)}
          </button>
        </form>

        {/* Order review */}
        <div className="bg-card rounded-lg border border-border/50 shadow-card p-6 h-fit">
          <h2 className="font-display font-semibold text-lg mb-4">Order Review</h2>
          <div className="space-y-3">
            {items.map(({ product, quantity }) => (
              <div key={product.id} className="flex justify-between text-sm">
                <span>
                  {product.name} × {quantity}
                </span>
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
