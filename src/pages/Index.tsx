import { useProducts } from "@/contexts/ProductContext";
import ProductCard from "@/components/ProductCard";
import HeroSection from "@/components/HeroSection";
import { Package } from "lucide-react";

const Index = () => {
  const { products } = useProducts();

  return (
    <div className="flex flex-col min-h-screen">
      <HeroSection />

      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-display font-bold mb-3">
            Featured Products
          </h2>
          <p className="text-muted-foreground">Browse our latest collection</p>
        </div>

        {products.length === 0 ? (
          <div className="text-center py-20">
            <Package className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-muted-foreground text-lg">No products yet.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add products from the Admin panel to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Index;
