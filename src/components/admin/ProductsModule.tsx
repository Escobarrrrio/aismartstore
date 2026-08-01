import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Trash2, Plus, ImagePlus, Search, Filter, Edit2, Check, X, Package } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// Product photos are shown at ~600px; anything past this is bytes nobody sees.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

interface ProductsModuleProps {
  products: any[];
  onReload: () => void;
}

const stockBadge = (p: any) => {
  if (p.stock_status === "out_of_stock" || (!p.in_stock && p.stock_quantity === 0))
    return { label: "Out of Stock", cls: "bg-red-50 text-red-700 border-red-200" };
  if (p.stock_status === "low_stock" || (p.stock_quantity > 0 && p.stock_quantity <= 5))
    return { label: "Low Stock", cls: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: "In Stock", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
};

const ProductsModule = ({ products, onReload }: ProductsModuleProps) => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [editImages, setEditImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", description: "", price: "", category: "", brand: "", stockQuantity: "", isAiProduct: false });
  const [images, setImages] = useState<string[]>([]);

  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

  const filtered = products.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.brand || "").toLowerCase().includes(search.toLowerCase());
    const matchCat = !categoryFilter || p.category === categoryFilter;
    const matchStock = !stockFilter || stockBadge(p).label.toLowerCase().includes(stockFilter.toLowerCase());
    return matchSearch && matchCat && matchStock;
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} products?`)) return;
    for (const id of selected) {
      await supabase.from("products").delete().eq("id", id);
    }
    setSelected(new Set());
    onReload();
    toast({ title: `${selected.size} products deleted` });
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setEditForm({ name: p.name, price: p.price, stock_quantity: p.stock_quantity ?? 0, category: p.category || "", brand: p.brand || "" });
    // Images were the one field the edit form did not carry, so there was no
    // way to replace a placeholder photo on an existing product -- only to
    // delete it and add it again from scratch, losing its id, its order history
    // and its supplier metadata.
    setEditImages(Array.isArray(p.images) ? p.images : []);
  };

  const handleEditImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      // The bucket has no size limit of its own, and a photo straight off a
      // phone is routinely 8-12MB. Uploading one would work and then be served
      // at full size to every shopper on mobile data -- an invisible tax on the
      // slowest connections, paid on the page we most want to load fast.
      if (file.size > MAX_IMAGE_BYTES) {
        toast({
          title: "That image is too large",
          description: `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB. Please resize it under ${MAX_IMAGE_BYTES / 1024 / 1024}MB first — shoppers on mobile data pay for every byte.`,
          variant: "destructive",
        });
        continue;
      }
      const ext = file.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (error) {
        toast({ title: "Upload failed", description: error.message, variant: "destructive" });
        continue;
      }
      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
      // Replaces rather than appends when the only existing image is the
      // placeholder: leaving it in position 1 would keep the product hidden
      // from the home page, which is the whole reason for uploading.
      setEditImages((prev) => {
        const cleaned = prev.filter((u) => !u.includes("placeholder"));
        return [...cleaned, urlData.publicUrl];
      });
    }
    setUploading(false);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await supabase.from("products").update({
      name: editForm.name,
      price: parseFloat(editForm.price),
      stock_quantity: parseInt(editForm.stock_quantity),
      category: editForm.category,
      brand: editForm.brand,
      images: editImages,
    }).eq("id", editingId);
    setEditingId(null);
    onReload();
    toast({ title: "Product updated" });
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (!error) {
        const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
        setImages((prev) => [...prev, urlData.publicUrl]);
      }
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseInt(addForm.stockQuantity) || 0;
    await supabase.from("products").insert({
      name: addForm.name,
      description: addForm.description,
      price: parseFloat(addForm.price),
      category: addForm.category,
      brand: addForm.brand,
      images,
      stock_quantity: qty,
      in_stock: qty > 0,
      stock_status: qty > 0 ? "in_stock" : "out_of_stock",
      is_active: true,
      is_ai_product: addForm.isAiProduct,
      // Defaults to 'business' at the DB level, which hides it from the
      // residential storefront -- explicit here so anything added through
      // this form actually shows up, matching the CSV-import fix earlier.
      audience: "residential",
    });
    setAddForm({ name: "", description: "", price: "", category: "", brand: "", stockQuantity: "", isAiProduct: false });
    setImages([]);
    setShowAdd(false);
    onReload();
    toast({ title: "Product added!" });
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products..."
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-card text-sm focus:border-primary outline-none transition"
          />
        </div>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-input bg-card text-sm focus:border-primary outline-none">
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-input bg-card text-sm focus:border-primary outline-none">
          <option value="">All Stock</option>
          <option value="in stock">In Stock</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
        </select>
        {selected.size > 0 && (
          <button onClick={handleBulkDelete} className="px-3 py-2 rounded-lg bg-destructive text-white text-sm font-display font-semibold flex items-center gap-1.5">
            <Trash2 className="h-3.5 w-3.5" /> Delete ({selected.size})
          </button>
        )}
        <button onClick={() => setShowAdd(!showAdd)} className="px-4 py-2 rounded-lg gradient-brand text-white text-sm font-display font-semibold flex items-center gap-1.5 ml-auto">
          <Plus className="h-4 w-4" /> Add Product
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-top-2 duration-200">
          <h3 className="font-display font-bold text-sm mb-4 flex items-center gap-2"><Plus className="h-4 w-4 text-primary" /> New Product</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} required placeholder="Product name" className="px-3 py-2 rounded-lg border border-input bg-muted text-sm focus:border-primary outline-none" />
            <input value={addForm.brand} onChange={(e) => setAddForm({ ...addForm, brand: e.target.value })} placeholder="Brand" className="px-3 py-2 rounded-lg border border-input bg-muted text-sm focus:border-primary outline-none" />
            <input type="number" step="0.01" min="0" value={addForm.price} onChange={(e) => setAddForm({ ...addForm, price: e.target.value })} required placeholder="Price (ZAR)" className="px-3 py-2 rounded-lg border border-input bg-muted text-sm focus:border-primary outline-none" />
            <input value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })} placeholder="Category" className="px-3 py-2 rounded-lg border border-input bg-muted text-sm focus:border-primary outline-none" />
            <input type="number" min="0" value={addForm.stockQuantity} onChange={(e) => setAddForm({ ...addForm, stockQuantity: e.target.value })} placeholder="Stock quantity" className="px-3 py-2 rounded-lg border border-input bg-muted text-sm focus:border-primary outline-none" />
            <label className="flex items-center gap-2 px-3 py-2 text-sm">
              <input type="checkbox" checked={addForm.isAiProduct} onChange={(e) => setAddForm({ ...addForm, isAiProduct: e.target.checked })} className="rounded accent-primary" />
              Show in AI Picks
            </label>
            <textarea value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} placeholder="Description" rows={2} className="md:col-span-2 px-3 py-2 rounded-lg border border-input bg-muted text-sm focus:border-primary outline-none resize-none" />
            <div className="md:col-span-2 flex items-center gap-3">
              <div className="flex gap-2">
                {images.map((img, i) => (
                  <div key={i} className="w-12 h-12 rounded-md overflow-hidden border border-border relative">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))} className="absolute top-0 right-0 bg-foreground/60 text-white p-0.5 rounded-bl"><X className="h-2.5 w-2.5" /></button>
                  </div>
                ))}
                <label className="w-12 h-12 rounded-md border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary transition-colors">
                  <ImagePlus className="h-4 w-4 text-primary" />
                  <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                </label>
              </div>
              <div className="ml-auto flex gap-2">
                <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border border-border text-sm font-display font-semibold hover:bg-muted transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 rounded-lg gradient-brand text-white text-sm font-display font-semibold">Save</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="w-10 px-4 py-2.5">
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} className="rounded accent-primary" />
                </th>
                {["Product", "Brand", "Category", "Price", "Margin", "Stock", "Status", ""].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-muted-foreground">No products found.</td></tr>
              ) : (
                filtered.map((p) => {
                  const badge = stockBadge(p);
                  const isEditing = editingId === p.id;
                  return (
                    <tr key={p.id} className={`border-b border-border/50 last:border-none transition-colors ${selected.has(p.id) ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                      <td className="px-4 py-2.5">
                        <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="rounded accent-primary" />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          {p.images?.[0] ? (
                            <img src={p.images[0]} alt="" className="w-9 h-9 rounded-md object-cover border border-border" />
                          ) : (
                            <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center"><Package className="h-4 w-4 text-muted-foreground" /></div>
                          )}
                          {isEditing ? (
                            <div className="flex flex-col gap-1.5">
                              <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="px-2 py-1 rounded border border-primary bg-card text-sm w-36" />
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {editImages.map((img, i) => (
                                  <div key={i} className="relative w-9 h-9 rounded border border-border overflow-hidden bg-muted">
                                    <img src={img} alt="" className="w-full h-full object-cover" />
                                    <button
                                      type="button"
                                      aria-label="Remove image"
                                      onClick={() => setEditImages((prev) => prev.filter((_, j) => j !== i))}
                                      className="absolute top-0 right-0 bg-foreground/70 text-white p-0.5 rounded-bl"
                                    >
                                      <X className="h-2.5 w-2.5" />
                                    </button>
                                  </div>
                                ))}
                                <label className={`w-9 h-9 rounded border-2 border-dashed flex items-center justify-center transition-colors ${
                                  uploading ? "border-border opacity-50 cursor-wait" : "border-border cursor-pointer hover:border-primary"
                                }`} title="Upload a photo from this computer">
                                  <ImagePlus className="h-3.5 w-3.5 text-primary" />
                                  <input type="file" accept="image/*" multiple disabled={uploading}
                                         onChange={handleEditImageUpload} className="hidden" />
                                </label>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <p className="text-sm font-semibold truncate max-w-[200px]">{p.name}</p>
                              {p.last_synced_at && <p className="text-[10px] text-muted-foreground">Synced {new Date(p.last_synced_at).toLocaleDateString()}</p>}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">
                        {isEditing ? <input value={editForm.brand} onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })} className="px-2 py-1 rounded border border-primary bg-card text-sm w-24" /> : (p.brand || "—")}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">
                        {isEditing ? <input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className="px-2 py-1 rounded border border-primary bg-card text-sm w-24" /> : (p.category || "—")}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-display font-bold">
                        {isEditing ? <input type="number" value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} className="px-2 py-1 rounded border border-primary bg-card text-sm w-20" /> : `R${Number(p.price).toFixed(2)}`}
                      </td>
                      <td className="px-4 py-2.5 text-sm">
                        {typeof p.margin_percentage === "number" ? (
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${
                            p.margin_percentage >= 25
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : p.margin_percentage >= 10
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-red-50 text-red-700 border-red-200"
                          }`}>
                            {p.margin_percentage.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-sm">
                        {isEditing ? <input type="number" value={editForm.stock_quantity} onChange={(e) => setEditForm({ ...editForm, stock_quantity: e.target.value })} className="px-2 py-1 rounded border border-primary bg-card text-sm w-16" /> : (p.stock_quantity ?? 0)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-display font-bold border ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? (
                          <div className="flex gap-1">
                            <button onClick={saveEdit} className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100"><Check className="h-3.5 w-3.5" /></button>
                            <button onClick={() => setEditingId(null)} className="p-1.5 rounded-md bg-red-50 text-red-600 hover:bg-red-100"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        ) : (
                          <div className="flex gap-1">
                            <button onClick={() => startEdit(p)} className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"><Edit2 className="h-3.5 w-3.5" /></button>
                            <button onClick={async () => { await supabase.from("products").delete().eq("id", p.id); onReload(); }} className="p-1.5 rounded-md hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{filtered.length} of {products.length} products</span>
        </div>
      </div>
    </div>
  );
};

export default ProductsModule;
