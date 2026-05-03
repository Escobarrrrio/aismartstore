import { useState } from "react";
import { Upload } from "lucide-react";
import { useProducts } from "@/contexts/ProductContext";
import * as XLSX from "xlsx";

const ImportModule = () => {
  const { addProducts } = useProducts();
  const [excelPreview, setExcelPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);

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

  const handleImport = async () => {
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

  return (
    <div className="max-w-2xl">
      <div className="bg-card border border-border rounded-xl p-6">
        <h3 className="font-display font-bold text-sm mb-1 flex items-center gap-2">
          <Upload className="h-4 w-4 text-primary" /> Bulk Import from Excel / CSV
        </h3>
        <p className="text-[11px] text-muted-foreground mb-4">
          Upload a file with columns: <strong>Name, Description, Price, Category</strong> (optionally <strong>Image</strong>).
        </p>
        <label className="flex flex-col items-center justify-center w-full py-10 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-primary transition-colors bg-muted mb-4">
          <Upload className="h-8 w-8 text-primary mb-2" />
          <p className="text-sm text-muted-foreground">Drop file or <strong className="text-primary">browse</strong></p>
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
              <button onClick={handleImport} disabled={importing} className="px-5 py-2 rounded-full gradient-brand text-white font-display font-bold text-sm disabled:opacity-50">
                {importing ? "Importing..." : `Import ${excelPreview.length} Products`}
              </button>
              <button onClick={() => setExcelPreview([])} className="px-5 py-2 rounded-full border border-border text-foreground font-display font-semibold text-sm hover:bg-muted transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportModule;
