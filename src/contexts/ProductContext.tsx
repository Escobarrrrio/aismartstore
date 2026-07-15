import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { Product } from "./CartContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ProductContextType {
  /** Only the currently loaded page of products (default 24). Never the full catalog. */
  products: Product[];
  loading: boolean;
  addProduct: (product: Omit<Product, "id" | "createdAt">) => Promise<void>;
  addProducts: (products: Omit<Product, "id" | "createdAt">[]) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  /** Returns a product by id. Fetches from DB if not in the in-memory page cache. */
  getProduct: (id: string) => Promise<Product | undefined>;
  refetch: () => Promise<void>;
}

const ProductContext = createContext<ProductContextType | undefined>(undefined);

type ProductRow = {
  id: string;
  name: string;
  description: string | null;
  price: number | string;
  category: string | null;
  brand?: string | null;
  sku?: string | null;
  images: string[] | null;
  in_stock: boolean;
  stock_quantity?: number | null;
  is_ai_product?: boolean | null;
  created_at?: string;
};

const mapRow = (p: ProductRow): Product => ({
  id: p.id,
  name: p.name,
  description: p.description || "",
  price: Number(p.price),
  category: p.category || "",
  brand: p.brand || undefined,
  sku: p.sku || undefined,
  images: p.images || [],
  inStock: p.in_stock,
  stockQuantity: typeof p.stock_quantity === "number" ? p.stock_quantity : undefined,
  isAiProduct: !!p.is_ai_product,
  createdAt: p.created_at || new Date().toISOString(),
});

// Simple id -> Product cache to avoid re-fetching for ProductDetail navigations.
const productCache = new Map<string, Product>();

export const ProductProvider = ({ children }: { children: ReactNode }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    // Load only the first page (24) of newest-first products for homepage / initial listings.
    // Full search / pagination happens in the Products page via the RPC.
    const { data, error } = await supabase.rpc("search_products", {
      search_query: "",
      sort_by: "newest",
      page_number: 0,
      page_size: 24,
      filter_audience: "residential",
    });

    if (error) {
      toast({ title: "Error loading products", description: error.message, variant: "destructive" });
      setProducts([]);
    } else {
      const mapped = ((data as ProductRow[]) || []).map(mapRow);
      mapped.forEach((p) => productCache.set(p.id, p));
      setProducts(mapped);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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
      productCache.delete(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
    }
  };

  const getProduct = useCallback(async (id: string): Promise<Product | undefined> => {
    if (!id) return undefined;
    const cached = productCache.get(id);
    if (cached) return cached;
    const { data, error } = await supabase
      .from("products")
      .select("id, name, description, price, category, brand, sku, images, in_stock, stock_quantity, is_ai_product, created_at")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return undefined;
    const mapped = mapRow(data as ProductRow);
    productCache.set(mapped.id, mapped);
    return mapped;
  }, []);

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
