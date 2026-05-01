import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Product } from "./CartContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ProductContextType {
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, "id" | "createdAt">) => Promise<void>;
  addProducts: (products: Omit<Product, "id" | "createdAt">[]) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  getProduct: (id: string) => Product | undefined;
  refetch: () => Promise<void>;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

export const ProductProvider = ({ children }: { children: ReactNode }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchProducts = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error loading products", description: error.message, variant: "destructive" });
    } else {
      setProducts(
        (data || []).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description || "",
          price: Number(p.price),
          category: p.category || "",
          images: p.images || [],
          inStock: p.in_stock,
          createdAt: p.created_at,
        }))
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const addProduct = async (product: Omit<Product, "id" | "createdAt">) => {
    const { error } = await supabase.from("products").insert({
      name: product.name,
      description: product.description,
      price: product.price,
      category: product.category,
      images: product.images,
      in_stock: product.inStock,
    });
    if (error) {
      toast({ title: "Error adding product", description: error.message, variant: "destructive" });
    } else {
      await fetchProducts();
    }
  };

  const addProducts = async (items: Omit<Product, "id" | "createdAt">[]) => {
    const rows = items.map((p) => ({
      name: p.name,
      description: p.description,
      price: p.price,
      category: p.category,
      images: p.images,
      in_stock: p.inStock,
    }));
    const { error } = await supabase.from("products").insert(rows);
    if (error) {
      toast({ title: "Error importing products", description: error.message, variant: "destructive" });
    } else {
      await fetchProducts();
      toast({ title: "Products imported", description: `${items.length} products added successfully.` });
    }
  };

  const deleteProduct = async (id: string) => {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      toast({ title: "Error deleting product", description: error.message, variant: "destructive" });
    } else {
      setProducts((prev) => prev.filter((p) => p.id !== id));
    }
  };

  const getProduct = (id: string) => products.find((p) => p.id === id);

  return (
    <ProductContext.Provider value={{ products, loading, addProduct, addProducts, deleteProduct, getProduct, refetch: fetchProducts }}>
      {children}
    </ProductContext.Provider>
  );
};

export const useProducts = () => {
  const ctx = useContext(ProductContext);
  if (!ctx) throw new Error("useProducts must be used within ProductProvider");
  return ctx;
};
