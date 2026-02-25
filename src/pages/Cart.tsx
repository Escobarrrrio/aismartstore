import { useCart } from "@/contexts/CartContext";
import { Link } from "react-router-dom";
import { Trash2, Plus, Minus, ShoppingBag, ArrowRight } from "lucide-react";

const Cart = () => {
  const { items, removeFromCart, updateQuantity, totalPrice, clearCart } = useCart();

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <ShoppingBag className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
        <h2 className="text-2xl font-display font-bold mb-2">Your cart is empty</h2>
        <p className="text-muted-foreground mb-6">Start adding some products!</p>
        <Link
          to="/products"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full gradient-brand text-primary-foreground font-semibold"
        >
          Browse Products <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold mb-8">Shopping Cart</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          {items.map(({ product, quantity }) => (
            <div
              key={product.id}
              className="flex gap-4 p-4 bg-card rounded-lg border border-border/50 shadow-card"
            >
              <div className="w-20 h-20 rounded-md overflow-hidden bg-muted flex-shrink-0">
                {product.images[0] ? (
                  <img src={product.images[0]} alt={product.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                    No img
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <Link to={`/product/${product.id}`} className="font-semibold line-clamp-1 hover:text-primary transition-colors">
                  {product.name}
                </Link>
                <p className="text-sm text-muted-foreground">R{product.price.toFixed(2)}</p>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => updateQuantity(product.id, quantity - 1)}
                    className="p-1 rounded border border-border hover:bg-accent transition-colors"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="text-sm font-medium w-8 text-center">{quantity}</span>
                  <button
                    onClick={() => updateQuantity(product.id, quantity + 1)}
                    className="p-1 rounded border border-border hover:bg-accent transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <div className="flex flex-col items-end justify-between">
                <button
                  onClick={() => removeFromCart(product.id)}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <span className="font-bold text-sm">R{(product.price * quantity).toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="bg-card rounded-lg border border-border/50 shadow-card p-6 h-fit sticky top-24">
          <h3 className="font-display font-semibold text-lg mb-4">Order Summary</h3>
          <div className="flex justify-between mb-2 text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>R{totalPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between mb-4 text-sm">
            <span className="text-muted-foreground">Shipping</span>
            <span className="text-muted-foreground">Calculated at checkout</span>
          </div>
          <div className="border-t border-border/50 pt-4 mb-6">
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span className="gradient-brand-text">R{totalPrice.toFixed(2)}</span>
            </div>
          </div>
          <Link
            to="/checkout"
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full gradient-brand text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
          >
            Proceed to Checkout
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Cart;
