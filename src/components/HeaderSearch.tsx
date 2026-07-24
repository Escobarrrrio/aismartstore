import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatMoney } from "@/lib/currency";
import { useTranslation } from "react-i18next";
import { trackEvent } from "@/lib/analytics";

interface Suggestion {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  total_count?: number;
}

interface Props {
  className?: string;
  autoFocus?: boolean;
  onClose?: () => void;
  fullWidth?: boolean;
}

const HeaderSearch = ({ className = "", autoFocus, onClose, fullWidth }: Props) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setTotalCount(0);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      // Product-code (SKU) fast-path: if the query looks like a distributor
      // code (alphanumeric with a digit, no spaces, ≥3 chars) we hit the sku
      // column directly in parallel with the full-text search. Results are
      // merged so pasting a code always finds the SKU even if it's not in
      // the tsvector index. This is what makes tender/procurement flows
      // reliable.
      const looksLikeSku = /^[A-Za-z0-9._\-\/]{3,}$/.test(q) && /\d/.test(q);
      const [rpcRes, skuRes] = await Promise.all([
        supabase.rpc("search_products", {
          search_query: q,
          sort_by: "relevance",
          page_number: 0,
          page_size: 5,
          filter_audience: "residential",
        }),
        looksLikeSku
          ? supabase
              .from("products")
              .select("id, name, price, images, sku")
              .eq("is_active", true)
              .eq("audience", "residential")
              .ilike("sku", `%${q}%`)
              .limit(5)
          : Promise.resolve({ data: [], error: null } as any),
      ]);
      setLoading(false);
      if (rpcRes.error && skuRes.error) {
        setResults([]);
        setTotalCount(0);
        return;
      }
      const rpcRows = (rpcRes.data as any[]) || [];
      const skuRows = (skuRes.data as any[]) || [];
      const seen = new Set<string>();
      const merged: Suggestion[] = [];
      // SKU exact hits first so a pasted product code jumps to the top.
      for (const r of skuRows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push({ id: r.id, name: r.name, price: Number(r.price), images: r.images });
      }
      for (const r of rpcRows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        merged.push({ id: r.id, name: r.name, price: Number(r.price), images: r.images });
      }
      setResults(merged.slice(0, 6));
      const total = rpcRows[0]?.total_count ? Number(rpcRows[0].total_count) : merged.length;
      setTotalCount(total);
      trackEvent({
        name: "product_list_returned",
        audience: "residential",
        surface: "header_search",
        count: merged.length,
        total,
        query: q,
      });
      setOpen(true);
      setHighlight(-1);
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const goToAll = useCallback(() => {
    if (!query.trim()) return;
    navigate(`/products?q=${encodeURIComponent(query.trim())}`);
    setOpen(false);
    onClose?.();
  }, [query, navigate, onClose]);

  const selectProduct = (id: string) => {
    navigate(`/product/${id}`);
    setOpen(false);
    setQuery("");
    onClose?.();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      onClose?.();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(results.length, h + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(-1, h - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= 0 && highlight < results.length) {
        selectProduct(results[highlight].id);
      } else {
        goToAll();
      }
    }
  };

  return (
    <div ref={containerRef} className={`relative ${fullWidth ? "w-full" : ""} ${className}`}>
      <div className="flex items-center gap-2 bg-muted rounded-xl px-3.5 py-2 border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-all">
        <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => query && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("nav.search")}
          className={`bg-transparent border-none outline-none text-sm text-foreground placeholder:text-muted-foreground min-w-0 ${fullWidth ? "w-full" : "w-32 lg:w-40"}`}
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 mt-2 bg-background border border-border rounded-xl shadow-xl z-[100] overflow-hidden min-w-[280px]">
          {loading && results.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No matches for "{query}"</div>
          ) : (
            <>
              <ul className="max-h-[60vh] overflow-y-auto">
                {results.map((r, i) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => selectProduct(r.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        highlight === i ? "bg-muted" : "hover:bg-muted/60"
                      }`}
                    >
                      <div className="w-10 h-10 rounded-lg bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center">
                        {r.images && r.images[0] ? (
                          <img src={r.images[0]} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                        <p className="text-xs text-muted-foreground">{formatMoney(r.price, "ZAR")}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={goToAll}
                onMouseEnter={() => setHighlight(results.length)}
                className={`w-full px-4 py-3 text-sm font-semibold text-primary border-t border-border transition-colors ${
                  highlight === results.length ? "bg-primary/[0.06]" : "hover:bg-primary/[0.04]"
                }`}
              >
                View all {totalCount.toLocaleString("en-ZA")} results →
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default HeaderSearch;
