import { Link } from "react-router-dom";
import { Product } from "@/contexts/CartContext";
import { useCart } from "@/contexts/CartContext";
import { Plus } from "lucide-react";

interface ProductCardProps {
  product: Product;
}

const ProductCard = ({ product }: ProductCardProps) => {
  const { addToCart } = useCart();

  return (
    <div className="group bg-card border border-border rounded-xl overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-elevated flex flex-col">
      <Link to={`/product/${product.id}`} className="block relative bg-muted h-48 overflow-hidden">
        {product.images[0] ? (
          <img
            src={product.images[0]}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-400"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
            No Image
          </div>
        )}
        {product.inStock && (
          <span className="absolute top-2 left-2 gradient-brand text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
            In Stock
          </span>
        )}
      </Link>

      <div className="p-3.5 flex flex-col flex-1">
        {product.category && (
          <span className="text-[11px] text-secondary font-semibold uppercase tracking-wide mb-1">
            {product.category}
          </span>
        )}
        <Link to={`/product/${product.id}`}>
          <h3 className="font-display font-bold text-sm text-foreground leading-snug line-clamp-1 hover:text-primary transition-colors">
            {product.name}
          </h3>
        </Link>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-1 flex-1 leading-relaxed">
          {product.description}
        </p>
        <div className="flex items-center justify-between mt-3">
          <span className="font-display font-extrabold text-base text-foreground">
            R{product.price.toFixed(2)}
          </span>
          <button
            onClick={() => addToCart(product)}
            className="w-9 h-9 rounded-full gradient-brand text-white flex items-center justify-center hover:scale-110 hover:shadow-elevated transition-all duration-200"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
