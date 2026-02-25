import { useState } from "react";
import { useProducts } from "@/contexts/ProductContext";
import { Trash2, Plus, ImagePlus } from "lucide-react";

const Admin = () => {
  const { products, addProduct, deleteProduct } = useProducts();
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    category: "",
  });
  const [images, setImages] = useState<string[]>([]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setImages((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.price) return;

    addProduct({
      name: form.name,
      description: form.description,
      price: parseFloat(form.price),
      category: form.category,
      images,
      inStock: true,
    });

    setForm({ name: "", description: "", price: "", category: "" });
    setImages([]);
  };

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="text-3xl font-display font-bold mb-2">Admin Panel</h1>
      <p className="text-muted-foreground mb-8">Add and manage your products</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Add product form */}
        <div className="bg-card rounded-lg border border-border/50 shadow-card p-6">
          <h2 className="font-display font-semibold text-lg mb-5">Add New Product</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Product Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="e.g. Wireless Earbuds"
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Product details..."
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Price (ZAR)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  required
                  placeholder="299.99"
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="e.g. Electronics"
                  className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition"
                />
              </div>
            </div>

            {/* Image upload */}
            <div>
              <label className="block text-sm font-medium mb-1.5">Product Images</label>
              <div className="flex flex-wrap gap-3 mb-3">
                {images.map((img, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden border border-border/50">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute top-0.5 right-0.5 p-0.5 bg-destructive text-destructive-foreground rounded-full"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <label className="w-20 h-20 rounded-md border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary transition-colors">
                  <ImagePlus className="h-5 w-5 text-muted-foreground" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <button
              type="submit"
              className="w-full px-6 py-3 rounded-full gradient-brand text-primary-foreground font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <Plus className="h-4 w-4" /> Add Product
            </button>
          </form>
        </div>

        {/* Product list */}
        <div>
          <h2 className="font-display font-semibold text-lg mb-4">
            Your Products ({products.length})
          </h2>
          {products.length === 0 ? (
            <p className="text-muted-foreground text-sm">No products added yet.</p>
          ) : (
            <div className="space-y-3">
              {products.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center gap-4 p-4 bg-card rounded-lg border border-border/50 shadow-card"
                >
                  <div className="w-14 h-14 rounded-md overflow-hidden bg-muted flex-shrink-0">
                    {product.images[0] ? (
                      <img src={product.images[0]} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                        —
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm line-clamp-1">{product.name}</p>
                    <p className="text-xs text-muted-foreground">R{product.price.toFixed(2)}</p>
                  </div>
                  <button
                    onClick={() => deleteProduct(product.id)}
                    className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
