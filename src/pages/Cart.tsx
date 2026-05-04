import { useCart } from "@/contexts/CartContext";
import { Link } from "react-router-dom";
import { Trash2, Plus, Minus, ShoppingBag, ArrowRight, Shield, Truck } from "lucide-react";

const Cart = () => {
  const { items, removeFromCart, updateQuantity, totalPrice, clearCart } = useCart();

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <ShoppingBag className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
        <h2 className="text-2xl font-display font-bold mb-2">Your cart is empty</h2>
        <p className="text-muted-foreground mb-6">Start adding some products!</p>
        <Link to="/products" className="btn-primary px-7 py-3.5 text-sm shadow-elevated">
          Browse Products <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 md:py-12">
      <h1 className="text-3xl font-display font-extrabold tracking-tight mb-8">Shopping Cart</h1>

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
                  R{product.price.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
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
                  R{(product.price * quantity).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="card-flat p-6 h-fit sticky top-24 space-y-4">
          <h3 className="font-display font-bold text-lg">Order Summary</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium">R{totalPrice.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Shipping</span>
              <span className="text-muted-foreground text-xs">Calculated at checkout</span>
            </div>
          </div>
          <div className="border-t border-border pt-4">
            <div className="flex justify-between font-display font-extrabold text-xl">
              <span>Total</span>
              <span>R{totalPrice.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
          <Link to="/checkout" className="btn-primary w-full py-3.5 text-sm shadow-elevated">
            Proceed to Checkout
          </Link>
          <div className="flex items-center justify-center gap-4 pt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Shield className="h-3.5 w-3.5" /> Secure</span>
            <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" /> Free over R500</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cart;
