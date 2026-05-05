import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Package, Upload, Download, Edit2, Eye, EyeOff, AlertTriangle, Search,
  RefreshCw, Copy, Clock, CheckCircle, DollarSign, Percent
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const ProductOpsModule = () => {
  const { toast } = useToast();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [bulkAction, setBulkAction] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from("products").select("*").order("created_at", { ascending: false });
    setProducts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = products.filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()));

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const executeBulkAction = async () => {
    if (!bulkAction || selected.size === 0) return;
    setShowConfirm(bulkAction);
  };

  const confirmBulkAction = async () => {
    const ids = Array.from(selected);
    if (bulkAction === "publish") {
      for (const id of ids) await supabase.from("products").update({ is_active: true }).eq("id", id);
    } else if (bulkAction === "unpublish") {
      for (const id of ids) await supabase.from("products").update({ is_active: false }).eq("id", id);
    }
    toast({ title: "Bulk action completed", description: `${ids.length} products updated.` });
    setSelected(new Set());
    setBulkAction("");
    setShowConfirm(null);
    load();
  };

  const exportProducts = () => {
    const csv = ["Name,Price,Stock,Category,Brand,Status"].concat(
      products.map(p => `"${p.name}",${p.price},${p.stock_quantity},"${p.category || ""}","${p.brand || ""}",${p.is_active ? "Active" : "Inactive"}`)
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products_export.csv";
    a.click();
    toast({ title: "Export Complete", description: "Products exported to CSV." });
  };

  const duplicates = products.filter((p, i) => products.findIndex(q => q.name === p.name) !== i);
  const stale = products.filter(p => {
    if (!p.last_synced_at) return false;
    return Date.now() - new Date(p.last_synced_at).getTime() > 7 * 86400000;
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3"><Package className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{products.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Total Products</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center mb-3"><Copy className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{duplicates.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Potential Duplicates</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-600 flex items-center justify-center mb-3"><Clock className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{stale.length}</p>
          <p className="text-xs text-muted-foreground mt-1">Stale Products</p>
        </div>
        <div className="card-flat p-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center mb-3"><CheckCircle className="h-5 w-5" /></div>
          <p className="font-display font-extrabold text-2xl">{products.filter(p => p.is_active).length}</p>
          <p className="text-xs text-muted-foreground mt-1">Active Products</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products..." className="w-full pl-9 pr-4 py-2 rounded-lg border border-input bg-card text-sm focus:border-primary outline-none transition" />
        </div>
        <select value={bulkAction} onChange={(e) => setBulkAction(e.target.value)} className="px-3 py-2 rounded-lg border border-input bg-card text-sm">
          <option value="">Bulk Action</option>
          <option value="publish">Publish</option>
          <option value="unpublish">Unpublish</option>
        </select>
        <button onClick={executeBulkAction} disabled={!bulkAction || selected.size === 0} className="px-3 py-2 rounded-lg border border-border text-sm font-semibold disabled:opacity-30">
          Apply ({selected.size})
        </button>
        <button onClick={exportProducts} className="px-3 py-2 rounded-lg border border-border text-sm font-semibold flex items-center gap-1.5 ml-auto" title="Export all products to CSV">
          <Download className="h-3.5 w-3.5" /> Export
        </button>
      </div>

      {/* Table */}
      <div className="card-flat overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead><tr className="bg-muted/50 border-b border-border">
              <th className="w-10 px-4 py-2.5"><input type="checkbox" onChange={() => { if (selected.size === filtered.length) setSelected(new Set()); else setSelected(new Set(filtered.map(p => p.id))); }} className="rounded accent-primary" /></th>
              {["Product", "Source", "Price", "Stock", "Status", "Sync"].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No products found</td></tr>
              ) : filtered.slice(0, 50).map(p => (
                <tr key={p.id} className={`border-b border-border/50 transition-colors ${selected.has(p.id) ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                  <td className="px-4 py-2.5"><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)} className="rounded accent-primary" /></td>
                  <td className="px-4 py-2.5">
                    <p className="text-sm font-semibold truncate max-w-[200px]">{p.name}</p>
                    <p className="text-[10px] text-muted-foreground">{p.brand || "No brand"}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.axiz_product_id ? "Axiz" : "Manual"}</td>
                  <td className="px-4 py-2.5 text-sm font-display font-bold">R{Number(p.price).toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-sm">{p.stock_quantity ?? 0}</td>
                  <td className="px-4 py-2.5">
                    {p.is_active ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-200"><Eye className="h-3 w-3" />Active</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground border border-border"><EyeOff className="h-3 w-3" />Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[10px] text-muted-foreground">{p.last_synced_at ? new Date(p.last_synced_at).toLocaleDateString() : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-foreground/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowConfirm(null)}>
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-lg mb-2">Confirm Bulk Action</h3>
            <p className="text-sm text-muted-foreground mb-6">Apply "{bulkAction}" to {selected.size} products?</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowConfirm(null)} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold">Cancel</button>
              <button onClick={confirmBulkAction} className="px-4 py-2 rounded-lg gradient-brand text-white text-sm font-semibold">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductOpsModule;
