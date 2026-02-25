import { useProducts } from "@/contexts/ProductContext";
import ProductCard from "@/components/ProductCard";
import { Package } from "lucide-react";

const Products = () => {
  const { products } = useProducts();

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="text-3xl md:text-4xl font-display font-bold mb-2">All Products</h1>
      <p className="text-muted-foreground mb-8">Browse everything in store</p>

      {products.length === 0 ? (
        <div className="text-center py-20">
          <Package className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
          <p className="text-muted-foreground text-lg">No products available yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Products;
