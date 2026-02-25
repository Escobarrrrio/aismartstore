import { useParams, useNavigate } from "react-router-dom";
import { useProducts } from "@/contexts/ProductContext";
import { useCart } from "@/contexts/CartContext";
import { ArrowLeft, ShoppingCart, Check } from "lucide-react";
import { useState } from "react";

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getProduct } = useProducts();
  const { addToCart } = useCart();
  const [selectedImage, setSelectedImage] = useState(0);
  const [added, setAdded] = useState(false);

  const product = getProduct(id || "");

  if (!product) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground text-lg">Product not found.</p>
        <button onClick={() => navigate("/")} className="mt-4 text-primary underline">
          Go back home
        </button>
      </div>
    );
  }

  const handleAddToCart = () => {
    addToCart(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <div className="container mx-auto px-4 py-10">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        {/* Images */}
        <div className="space-y-4">
          <div className="aspect-square rounded-lg overflow-hidden bg-muted border border-border/50">
            {product.images[selectedImage] ? (
              <img
                src={product.images[selectedImage]}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                No Image
              </div>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(i)}
                  className={`w-20 h-20 rounded-md overflow-hidden border-2 flex-shrink-0 transition-colors ${
                    i === selectedImage ? "border-primary" : "border-border/50"
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
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
            {product.category}
          </span>
          <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">{product.name}</h1>
          <p className="text-2xl font-bold gradient-brand-text mb-6">
            R{product.price.toFixed(2)}
          </p>
          <p className="text-muted-foreground leading-relaxed mb-8">{product.description}</p>

          <button
            onClick={handleAddToCart}
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-full gradient-brand text-primary-foreground font-semibold hover:opacity-90 transition-all shadow-elevated w-full md:w-auto"
          >
            {added ? (
              <>
                <Check className="h-5 w-5" /> Added!
              </>
            ) : (
              <>
                <ShoppingCart className="h-5 w-5" /> Add to Cart
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;
