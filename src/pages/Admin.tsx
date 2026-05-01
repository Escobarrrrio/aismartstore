import { useState, useEffect } from "react";
import { useProducts } from "@/contexts/ProductContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, ImagePlus, Upload, Package, ShoppingCart, Settings, LogOut, FileSpreadsheet } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import * as XLSX from "xlsx";

const Admin = () => {
  const { products, loading, addProduct, addProducts, deleteProduct } = useProducts();
  const [session, setSession] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  // Form state
  const [form, setForm] = useState({ name: "", description: "", price: "", category: "" });
  const [images, setImages] = useState<string[]>([]);

  // Settings state
  const [yocoPublicKey, setYocoPublicKey] = useState("");
  const [yocoSecretKey, setYocoSecretKey] = useState("");
  const [notificationEmail, setNotificationEmail] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  // Orders state
  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Excel upload
  const [excelPreview, setExcelPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setCheckingAuth(false);
      if (!session) navigate("/auth");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) navigate("/auth");
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (session) {
      loadSettings();
      loadOrders();
    }
  }, [session]);

  const loadSettings = async () => {
    const { data } = await supabase.from("store_settings").select("*");
    if (data) {
      data.forEach((s) => {
        if (s.key === "yoco_public_key") setYocoPublicKey(s.value);
        if (s.key === "yoco_secret_key") setYocoSecretKey(s.value);
        if (s.key === "notification_email") setNotificationEmail(s.value);
      });
    }
  };

  const loadOrders = async () => {
    setLoadingOrders(true);
    const { data } = await supabase
      .from("orders")
      .select("*, order_items(*, products(name))")
      .order("created_at", { ascending: false });
    setOrders(data || []);
    setLoadingOrders(false);
  };

  const saveSetting = async (key: string, value: string) => {
    const { data: existing } = await supabase.from("store_settings").select("id").eq("key", key).maybeSingle();
    if (existing) {
      await supabase.from("store_settings").update({ value }).eq("key", key);
    } else {
      await supabase.from("store_settings").insert({ key, value });
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    await Promise.all([
      saveSetting("yoco_public_key", yocoPublicKey),
      saveSetting("yoco_secret_key", yocoSecretKey),
      saveSetting("notification_email", notificationEmail),
    ]);
    toast({ title: "Settings saved", description: "Your API keys and notification settings have been updated." });
    setSavingSettings(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !session) return;
    for (const file of Array.from(files)) {
      const ext = file.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (!error) {
        const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
        setImages((prev) => [...prev, urlData.publicUrl]);
      } else {
        toast({ title: "Upload error", description: error.message, variant: "destructive" });
      }
    }
  };

  const removeImage = (index: number) => setImages((prev) => prev.filter((_, i) => i !== index));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.price) return;
    await addProduct({
      name: form.name,
      description: form.description,
      price: parseFloat(form.price),
      category: form.category,
      images,
      inStock: true,
    });
    setForm({ name: "", description: "", price: "", category: "" });
    setImages([]);
    toast({ title: "Product added!" });
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target?.result, { type: "binary" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(sheet);
      setExcelPreview(json);
    };
    reader.readAsBinaryString(file);
  };

  const handleImportExcel = async () => {
    if (excelPreview.length === 0) return;
    setImporting(true);
    const mapped = excelPreview.map((row) => ({
      name: String(row.name || row.Name || row.PRODUCT || row.product || "Unnamed"),
      description: String(row.description || row.Description || row.DESCRIPTION || ""),
      price: parseFloat(row.price || row.Price || row.PRICE || 0),
      category: String(row.category || row.Category || row.CATEGORY || ""),
      images: row.image || row.Image || row.IMAGE
        ? [String(row.image || row.Image || row.IMAGE)]
        : [],
      inStock: true,
    }));
    await addProducts(mapped);
    setExcelPreview([]);
    setImporting(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (checkingAuth || !session) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Control Centre</h1>
          <p className="text-muted-foreground text-sm">Manage your AI Smart Store</p>
        </div>
        <button onClick={handleSignOut} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <LogOut className="h-4 w-4" /> Sign Out
        </button>
      </div>

      <Tabs defaultValue="products" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="products" className="gap-2"><Package className="h-4 w-4" /> Products</TabsTrigger>
          <TabsTrigger value="import" className="gap-2"><FileSpreadsheet className="h-4 w-4" /> Import</TabsTrigger>
          <TabsTrigger value="orders" className="gap-2"><ShoppingCart className="h-4 w-4" /> Orders</TabsTrigger>
          <TabsTrigger value="settings" className="gap-2"><Settings className="h-4 w-4" /> Settings</TabsTrigger>
        </TabsList>

        {/* PRODUCTS TAB */}
        <TabsContent value="products">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-card rounded-lg border border-border/50 shadow-card p-6">
              <h2 className="font-display font-semibold text-lg mb-5">Add New Product</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">Product Name</label>
                  <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Wireless Earbuds" className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Description</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Product details..." rows={3} className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Price (ZAR)</label>
                    <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required placeholder="299.99" className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Category</label>
                    <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Electronics" className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Product Images</label>
                  <div className="flex flex-wrap gap-3 mb-3">
                    {images.map((img, i) => (
                      <div key={i} className="relative w-20 h-20 rounded-md overflow-hidden border border-border/50">
                        <img src={img} alt="" className="w-full h-full object-cover" />
                        <button type="button" onClick={() => removeImage(i)} className="absolute top-0.5 right-0.5 p-0.5 bg-destructive text-destructive-foreground rounded-full">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <label className="w-20 h-20 rounded-md border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-primary transition-colors">
                      <ImagePlus className="h-5 w-5 text-muted-foreground" />
                      <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                    </label>
                  </div>
                </div>
                <button type="submit" className="w-full px-6 py-3 rounded-full gradient-brand text-primary-foreground font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                  <Plus className="h-4 w-4" /> Add Product
                </button>
              </form>
            </div>

            <div>
              <h2 className="font-display font-semibold text-lg mb-4">Your Products ({products.length})</h2>
              {loading ? (
                <p className="text-muted-foreground text-sm">Loading products...</p>
              ) : products.length === 0 ? (
                <p className="text-muted-foreground text-sm">No products added yet.</p>
              ) : (
                <div className="space-y-3 max-h-[600px] overflow-y-auto">
                  {products.map((product) => (
                    <div key={product.id} className="flex items-center gap-4 p-4 bg-card rounded-lg border border-border/50 shadow-card">
                      <div className="w-14 h-14 rounded-md overflow-hidden bg-muted flex-shrink-0">
                        {product.images[0] ? (
                          <img src={product.images[0]} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">—</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm line-clamp-1">{product.name}</p>
                        <p className="text-xs text-muted-foreground">R{product.price.toFixed(2)} • {product.category || "Uncategorized"}</p>
                      </div>
                      <button onClick={() => deleteProduct(product.id)} className="p-2 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {/* IMPORT TAB */}
        <TabsContent value="import">
          <div className="bg-card rounded-lg border border-border/50 shadow-card p-6 max-w-2xl">
            <h2 className="font-display font-semibold text-lg mb-2">Bulk Import from Excel</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Upload an Excel file (.xlsx, .xls) with columns: <strong>Name, Description, Price, Category</strong> (and optionally <strong>Image</strong> for an image URL).
            </p>
            <label className="flex items-center justify-center gap-3 w-full py-8 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary transition-colors mb-4">
              <Upload className="h-6 w-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Click to upload Excel file</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" />
            </label>

            {excelPreview.length > 0 && (
              <div>
                <h3 className="font-semibold text-sm mb-2">Preview ({excelPreview.length} products found)</h3>
                <div className="max-h-64 overflow-auto border border-border rounded-lg mb-4">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        {Object.keys(excelPreview[0]).map((col) => (
                          <th key={col} className="px-3 py-2 text-left font-medium">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {excelPreview.slice(0, 20).map((row, i) => (
                        <tr key={i} className="border-t border-border/50">
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="px-3 py-1.5 truncate max-w-[200px]">{String(val)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-3">
                  <button onClick={handleImportExcel} disabled={importing} className="px-6 py-2.5 rounded-full gradient-brand text-primary-foreground font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                    {importing ? "Importing..." : `Import ${excelPreview.length} Products`}
                  </button>
                  <button onClick={() => setExcelPreview([])} className="px-6 py-2.5 rounded-full border border-border text-foreground hover:bg-muted transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ORDERS TAB */}
        <TabsContent value="orders">
          <div className="bg-card rounded-lg border border-border/50 shadow-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-semibold text-lg">Orders ({orders.length})</h2>
              <button onClick={loadOrders} className="text-sm text-primary hover:underline">Refresh</button>
            </div>
            {loadingOrders ? (
              <p className="text-muted-foreground text-sm">Loading orders...</p>
            ) : orders.length === 0 ? (
              <p className="text-muted-foreground text-sm">No orders yet.</p>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div key={order.id} className="border border-border/50 rounded-lg p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <div>
                        <p className="font-semibold">{order.customer_name}</p>
                        <p className="text-xs text-muted-foreground">{order.customer_email} • {order.customer_phone}</p>
                        <p className="text-xs text-muted-foreground mt-1">{order.address}, {order.city}, {order.postal_code}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold gradient-brand-text">R{Number(order.total_amount).toFixed(2)}</p>
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full mt-1 ${order.status === "paid" ? "bg-green-100 text-green-800" : order.status === "pending" ? "bg-yellow-100 text-yellow-800" : "bg-muted text-muted-foreground"}`}>
                          {order.status}
                        </span>
                        <p className="text-xs text-muted-foreground mt-1">{new Date(order.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                    {order.order_items && order.order_items.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/50">
                        {order.order_items.map((item: any) => (
                          <p key={item.id} className="text-xs text-muted-foreground">
                            {item.products?.name || "Product"} × {item.quantity} — R{Number(item.unit_price).toFixed(2)}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* SETTINGS TAB */}
        <TabsContent value="settings">
          <div className="bg-card rounded-lg border border-border/50 shadow-card p-6 max-w-xl">
            <h2 className="font-display font-semibold text-lg mb-5">Payment & Notifications</h2>
            <div className="space-y-5">
              <div>
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
                  Yoco Payment Gateway
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Yoco Public Key</label>
                    <input
                      type="text"
                      value={yocoPublicKey}
                      onChange={(e) => setYocoPublicKey(e.target.value)}
                      placeholder="pk_live_..."
                      className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition font-mono text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1.5">Yoco Secret Key</label>
                    <input
                      type="password"
                      value={yocoSecretKey}
                      onChange={(e) => setYocoSecretKey(e.target.value)}
                      placeholder="sk_live_..."
                      className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-secondary inline-block"></span>
                  Order Notifications
                </h3>
                <div>
                  <label className="block text-sm font-medium mb-1.5">Email for order notifications</label>
                  <input
                    type="email"
                    value={notificationEmail}
                    onChange={(e) => setNotificationEmail(e.target.value)}
                    placeholder="admin@example.com"
                    className="w-full px-4 py-2.5 rounded-lg border border-input bg-background text-foreground focus:ring-2 focus:ring-ring outline-none transition"
                  />
                </div>
              </div>

              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="w-full px-6 py-3 rounded-full gradient-brand text-primary-foreground font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {savingSettings ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Admin;
