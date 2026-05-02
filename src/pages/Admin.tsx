import { useState, useEffect } from "react";
import { useProducts } from "@/contexts/ProductContext";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2, Plus, ImagePlus, Upload, Package, ShoppingCart, Settings, LogOut,
  FileSpreadsheet, LayoutDashboard, Key, Bot, Link2, BarChart3
} from "lucide-react";
import * as XLSX from "xlsx";

type AdminTab = "dashboard" | "products" | "import" | "orders" | "settings";

const Admin = () => {
  const { products, loading, addProduct, addProducts, deleteProduct } = useProducts();
  const [session, setSession] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");
  const navigate = useNavigate();
  const { toast } = useToast();

  // Form state
  const [form, setForm] = useState({ name: "", description: "", price: "", category: "" });
  const [images, setImages] = useState<string[]>([]);

  // Settings state
  const [settingsMap, setSettingsMap] = useState<Record<string, string>>({});
  const [savingSettings, setSavingSettings] = useState(false);

  // Orders state
  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Excel
  const [excelPreview, setExcelPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

  // Sidebar mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setCheckingAuth(false);
      if (!session) navigate("/auth");
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setCheckingAuth(false);
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
      const map: Record<string, string> = {};
      data.forEach((s) => { map[s.key] = s.value; });
      setSettingsMap(map);
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

  const updateSetting = (key: string, value: string) => {
    setSettingsMap((prev) => ({ ...prev, [key]: value }));
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    const keys = [
      "yoco_public_key", "yoco_secret_key", "notification_email",
      "openai_api_key", "make_webhook_url", "axiz_api_key", "axiz_markup_pct"
    ];
    await Promise.all(keys.map((k) => saveSetting(k, settingsMap[k] || "")));
    toast({ title: "Settings saved", description: "All API keys and configuration have been updated." });
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
      images: row.image || row.Image || row.IMAGE ? [String(row.image || row.Image || row.IMAGE)] : [],
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

  const totalRevenue = orders.reduce((s, o) => s + Number(o.total_amount), 0);
  const paidOrders = orders.filter((o) => o.status === "paid").length;

  const tabs: { id: AdminTab; label: string; icon: React.ReactNode }[] = [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: "products", label: "Products", icon: <Package className="h-4 w-4" /> },
    { id: "import", label: "Import", icon: <FileSpreadsheet className="h-4 w-4" /> },
    { id: "orders", label: "Orders", icon: <ShoppingCart className="h-4 w-4" /> },
    { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
  ];

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      pending: "bg-amber-100 text-amber-800",
      paid: "bg-emerald-100 text-emerald-800",
      shipped: "bg-blue-100 text-blue-800",
      cancelled: "bg-red-100 text-red-800",
    };
    return map[status] || "bg-muted text-muted-foreground";
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-foreground/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 bottom-0 w-60 bg-foreground z-50 flex flex-col transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:sticky lg:top-0 lg:h-screen`}>
        <div className="flex items-center gap-2 px-4 py-5 border-b border-white/[0.07]">
          <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center text-white font-bold text-xs">S</div>
          <span className="font-display font-extrabold text-sm gradient-brand-text">Control Centre</span>
        </div>
        <nav className="flex-1 py-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-display font-medium border-l-[3px] transition-all ${
                activeTab === tab.id
                  ? "bg-secondary/20 text-white border-l-secondary"
                  : "text-white/40 border-l-transparent hover:bg-white/5 hover:text-white/80"
              }`}
            >
              <span className={activeTab === tab.id ? "text-primary" : "text-white/30"}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-white/[0.07]">
          <button onClick={handleSignOut} className="flex items-center gap-2 text-white/40 text-sm hover:text-white transition-colors font-display">
            <LogOut className="h-4 w-4" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 bg-muted min-h-screen">
        {/* Top bar */}
        <div className="sticky top-0 z-30 bg-card border-b border-border px-4 lg:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 text-foreground">
              <LayoutDashboard className="h-5 w-5" />
            </button>
            <h1 className="font-display font-extrabold text-lg flex items-center gap-2">
              {tabs.find((t) => t.id === activeTab)?.icon}
              {tabs.find((t) => t.id === activeTab)?.label}
            </h1>
          </div>
          <span className="text-xs text-muted-foreground font-display">{session?.user?.email}</span>
        </div>

        <div className="p-4 lg:p-6">
          {/* DASHBOARD */}
          {activeTab === "dashboard" && (
            <div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {[
                  { label: "Products", value: products.length, icon: <Package className="h-5 w-5" /> },
                  { label: "Orders", value: orders.length, icon: <ShoppingCart className="h-5 w-5" /> },
                  { label: "Paid", value: paidOrders, icon: <BarChart3 className="h-5 w-5" /> },
                  { label: "Revenue", value: `R${totalRevenue.toFixed(0)}`, icon: <BarChart3 className="h-5 w-5" /> },
                ].map((card, i) => (
                  <div key={i} className="bg-card border border-border rounded-xl p-5 relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[3px] gradient-brand" />
                    <div className="w-11 h-11 rounded-lg bg-secondary/10 flex items-center justify-center text-secondary mb-3">
                      {card.icon}
                    </div>
                    <strong className="font-display font-extrabold text-2xl block">{card.value}</strong>
                    <span className="text-xs text-muted-foreground">{card.label}</span>
                  </div>
                ))}
              </div>

              {/* Recent orders */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                  <h3 className="font-display font-bold text-sm">Recent Orders</h3>
                  <button onClick={loadOrders} className="text-xs text-secondary font-semibold hover:underline">Refresh</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[500px]">
                    <thead>
                      <tr className="bg-muted">
                        <th className="text-left px-4 py-2 text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wide">Customer</th>
                        <th className="text-left px-4 py-2 text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wide">Amount</th>
                        <th className="text-left px-4 py-2 text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                        <th className="text-left px-4 py-2 text-[11px] font-display font-semibold text-muted-foreground uppercase tracking-wide">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.slice(0, 10).map((order) => (
                        <tr key={order.id} className="border-b border-border last:border-none hover:bg-secondary/[0.03]">
                          <td className="px-4 py-3 text-sm">{order.customer_name}</td>
                          <td className="px-4 py-3 text-sm font-display font-bold">R{Number(order.total_amount).toFixed(2)}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-display font-bold ${statusBadge(order.status)}`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(order.created_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                      {orders.length === 0 && (
                        <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">No orders yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* PRODUCTS */}
          {activeTab === "products" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-display font-bold text-sm mb-4 pb-3 border-b border-border flex items-center gap-2">
                  <Plus className="h-4 w-4 text-secondary" /> Add New Product
                </h3>
                <form onSubmit={handleSubmit} className="space-y-3.5">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Product Name</label>
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. NVIDIA RTX 4090" className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Description</label>
                    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Product details..." rows={3} className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm resize-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">Price (ZAR)</label>
                      <input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required placeholder="299.99" className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">Category</label>
                      <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. GPUs" className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Product Images</label>
                    <div className="flex flex-wrap gap-3 mb-3">
                      {images.map((img, i) => (
                        <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border">
                          <img src={img} alt="" className="w-full h-full object-cover" />
                          <button type="button" onClick={() => removeImage(i)} className="absolute top-1 right-1 p-0.5 bg-foreground/70 text-white rounded-full hover:bg-destructive transition-colors">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      <label className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex items-center justify-center cursor-pointer hover:border-secondary transition-colors bg-muted">
                        <ImagePlus className="h-5 w-5 text-secondary" />
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                      </label>
                    </div>
                  </div>
                  <button type="submit" className="w-full py-2.5 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                    <Plus className="h-4 w-4" /> Add Product
                  </button>
                </form>
              </div>

              {/* Product list */}
              <div>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-border">
                    <h3 className="font-display font-bold text-sm">Your Products ({products.length})</h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[400px]">
                      <thead>
                        <tr className="bg-muted">
                          <th className="text-left px-4 py-2 text-[11px] font-display font-semibold text-muted-foreground uppercase">Image</th>
                          <th className="text-left px-4 py-2 text-[11px] font-display font-semibold text-muted-foreground uppercase">Name</th>
                          <th className="text-left px-4 py-2 text-[11px] font-display font-semibold text-muted-foreground uppercase">Price</th>
                          <th className="text-left px-4 py-2 text-[11px] font-display font-semibold text-muted-foreground uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading ? (
                          <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">Loading...</td></tr>
                        ) : products.length === 0 ? (
                          <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-muted-foreground">No products yet.</td></tr>
                        ) : (
                          products.map((product) => (
                            <tr key={product.id} className="border-b border-border last:border-none hover:bg-secondary/[0.03]">
                              <td className="px-4 py-2">
                                {product.images[0] ? (
                                  <img src={product.images[0]} alt="" className="w-10 h-10 rounded-md object-cover border border-border" />
                                ) : (
                                  <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground">—</div>
                                )}
                              </td>
                              <td className="px-4 py-2 text-sm font-semibold">{product.name}</td>
                              <td className="px-4 py-2 text-sm font-display font-bold">R{product.price.toFixed(2)}</td>
                              <td className="px-4 py-2">
                                <button onClick={() => deleteProduct(product.id)} className="px-2 py-1 rounded-md bg-destructive/10 text-destructive text-xs font-semibold hover:bg-destructive hover:text-white transition-colors">
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* IMPORT */}
          {activeTab === "import" && (
            <div className="bg-card border border-border rounded-xl p-6 max-w-2xl">
              <h3 className="font-display font-bold text-sm mb-1 flex items-center gap-2">
                <Upload className="h-4 w-4 text-secondary" /> Bulk Import from Excel
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Upload an Excel file with columns: <strong>Name, Description, Price, Category</strong> (optionally <strong>Image</strong>).
              </p>
              <label className="flex flex-col items-center justify-center w-full py-10 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-secondary transition-colors bg-muted mb-4">
                <Upload className="h-8 w-8 text-secondary mb-2" />
                <p className="text-sm text-muted-foreground">Drop file or <strong className="text-secondary">browse</strong></p>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" />
              </label>

              {excelPreview.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2">Preview ({excelPreview.length} products found)</h4>
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
                          <tr key={i} className="border-t border-border">
                            {Object.values(row).map((val, j) => (
                              <td key={j} className="px-3 py-1.5 truncate max-w-[200px]">{String(val)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={handleImportExcel} disabled={importing} className="px-5 py-2 rounded-full gradient-brand text-white font-display font-bold text-sm disabled:opacity-50">
                      {importing ? "Importing..." : `Import ${excelPreview.length} Products`}
                    </button>
                    <button onClick={() => setExcelPreview([])} className="px-5 py-2 rounded-full border border-border text-foreground font-display font-semibold text-sm hover:bg-muted transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ORDERS */}
          {activeTab === "orders" && (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <h3 className="font-display font-bold text-sm">All Orders ({orders.length})</h3>
                <button onClick={loadOrders} className="text-xs text-secondary font-semibold hover:underline">Refresh</button>
              </div>
              {loadingOrders ? (
                <p className="p-6 text-sm text-muted-foreground">Loading orders...</p>
              ) : orders.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No orders yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {orders.map((order) => (
                    <div key={order.id} className="p-4 hover:bg-secondary/[0.03]">
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                        <div>
                          <p className="font-semibold text-sm">{order.customer_name}</p>
                          <p className="text-xs text-muted-foreground">{order.customer_email} • {order.customer_phone}</p>
                          <p className="text-xs text-muted-foreground">{order.address}, {order.city}, {order.postal_code}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-display font-bold gradient-brand-text">R{Number(order.total_amount).toFixed(2)}</p>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-display font-bold mt-1 ${statusBadge(order.status)}`}>
                            {order.status}
                          </span>
                          <p className="text-xs text-muted-foreground mt-1">{new Date(order.created_at).toLocaleString()}</p>
                        </div>
                      </div>
                      {order.order_items?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border">
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
          )}

          {/* SETTINGS */}
          {activeTab === "settings" && (
            <div className="max-w-2xl space-y-6">
              {/* Yoco */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-display font-bold text-sm mb-4 pb-3 border-b border-border flex items-center gap-2">
                  <Key className="h-4 w-4 text-secondary" /> Yoco Payment Gateway
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Public Key</label>
                    <input type="text" value={settingsMap.yoco_public_key || ""} onChange={(e) => updateSetting("yoco_public_key", e.target.value)} placeholder="pk_live_..." className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Secret Key</label>
                    <input type="password" value={settingsMap.yoco_secret_key || ""} onChange={(e) => updateSetting("yoco_secret_key", e.target.value)} placeholder="sk_live_..." className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm font-mono" />
                  </div>
                </div>
              </div>

              {/* OpenAI */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-display font-bold text-sm mb-4 pb-3 border-b border-border flex items-center gap-2">
                  <Bot className="h-4 w-4 text-secondary" /> OpenAI — Customer Service AI
                </h3>
                <p className="text-xs text-muted-foreground mb-3">Powers the AI chatbot for product help, order support, and sales assistance.</p>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">OpenAI API Key</label>
                  <input type="password" value={settingsMap.openai_api_key || ""} onChange={(e) => updateSetting("openai_api_key", e.target.value)} placeholder="sk-..." className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm font-mono" />
                </div>
              </div>

              {/* Make Pro */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-display font-bold text-sm mb-4 pb-3 border-b border-border flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-secondary" /> Make Pro — Automation
                </h3>
                <p className="text-xs text-muted-foreground mb-3">Connect Make.com webhooks for order automation, notifications, and workflows.</p>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Make Webhook URL</label>
                  <input type="text" value={settingsMap.make_webhook_url || ""} onChange={(e) => updateSetting("make_webhook_url", e.target.value)} placeholder="https://hook.eu1.make.com/..." className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm font-mono" />
                </div>
              </div>

              {/* Axiz */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-display font-bold text-sm mb-4 pb-3 border-b border-border flex items-center gap-2">
                  <Package className="h-4 w-4 text-secondary" /> Axiz Distributor — Product Feed
                </h3>
                <p className="text-xs text-muted-foreground mb-3">Connect to Axiz South Africa's product API. Products are imported with automatic markup.</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Axiz API Key</label>
                    <input type="password" value={settingsMap.axiz_api_key || ""} onChange={(e) => updateSetting("axiz_api_key", e.target.value)} placeholder="Your Axiz API key..." className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5">Markup Percentage</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={settingsMap.axiz_markup_pct || "26"}
                        onChange={(e) => updateSetting("axiz_markup_pct", e.target.value)}
                        className="flex-1 accent-secondary"
                      />
                      <span className="font-display font-extrabold text-xl gradient-brand-text min-w-[50px] text-right">
                        {settingsMap.axiz_markup_pct || "26"}%
                      </span>
                    </div>
                    <div className="bg-muted border border-border rounded-lg p-3 mt-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Axiz cost price</span>
                        <span>R1,000.00</span>
                      </div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Your markup ({settingsMap.axiz_markup_pct || "26"}%)</span>
                        <span className="text-emerald-600">+R{(1000 * (parseInt(settingsMap.axiz_markup_pct || "26") / 100)).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-display font-bold border-t border-border mt-2 pt-2">
                        <span>Selling price</span>
                        <span>R{(1000 * (1 + parseInt(settingsMap.axiz_markup_pct || "26") / 100)).toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Notifications */}
              <div className="bg-card border border-border rounded-xl p-6">
                <h3 className="font-display font-bold text-sm mb-4 pb-3 border-b border-border flex items-center gap-2">
                  <Settings className="h-4 w-4 text-secondary" /> Notifications
                </h3>
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Order notification email</label>
                  <input type="email" value={settingsMap.notification_email || ""} onChange={(e) => updateSetting("notification_email", e.target.value)} placeholder="admin@example.com" className="w-full px-3 py-2 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card outline-none transition text-sm" />
                </div>
              </div>

              <button
                onClick={handleSaveSettings}
                disabled={savingSettings}
                className="w-full py-3 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {savingSettings ? "Saving..." : "Save All Settings"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
