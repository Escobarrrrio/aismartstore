import { useMemo, useRef, useState, useEffect } from "react";
import { Search, X, Check, ChevronDown } from "lucide-react";

export interface PickableProduct {
  id: string;
  name: string;
  brand?: string | null;
  sku?: string | null;
  is_active?: boolean | null;
  images?: string[] | null;
}

interface Props {
  products: PickableProduct[];
  value: string | null;
  onChange: (productId: string | null) => void;
  disabled?: boolean;
  /** Shown when nothing is chosen. */
  placeholder?: string;
}

/**
 * Choosing a product out of thousands.
 *
 * This replaces a native `<select>` that listed every product in the catalogue.
 * It was not broken -- the options were all there -- it was unusable: finding
 * "Roborock Saros 20 Ultimate" meant scrolling three and a half thousand
 * entries in an unsearchable dropdown, so in practice the manual override
 * existed and could not be used, which is the same as not having one.
 *
 * Type to filter. Matches on name, brand and SKU, because the thing you
 * remember about a product is not reliably its full title.
 */
const ProductPicker = ({ products, value, onChange, disabled, placeholder = "Pick the product…" }: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => products.find((p) => p.id === value) ?? null, [products, value]);

  // Capped, because rendering three thousand list items on every keystroke
  // janks the whole screen. Anyone who has not found it in fifty is better
  // served by typing another word than by scrolling further.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? products.filter((p) =>
          `${p.name} ${p.brand ?? ""} ${p.sku ?? ""}`.toLowerCase().includes(q),
        )
      : products;
    return pool.slice(0, 50);
  }, [products, query]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative flex-1 min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-left min-h-[40px] disabled:opacity-50 hover:border-foreground/40"
      >
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? selected.name : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {selected && !disabled && (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear the selected product"
          className="absolute right-8 top-1/2 -translate-y-1/2 grid place-items-center h-6 w-6 rounded-full hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-xl border border-border bg-background shadow-lg overflow-hidden">
          <div className="relative border-b border-border">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, brand or SKU"
              className="w-full bg-transparent pl-9 pr-3 py-2.5 text-sm outline-none"
            />
          </div>

          <ul role="listbox" className="max-h-72 overflow-y-auto">
            <li>
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
              >
                — skip this folder —
              </button>
            </li>

            {matches.length === 0 ? (
              <li className="px-3 py-6 text-sm text-muted-foreground text-center">
                Nothing matches “{query}”.
              </li>
            ) : (
              matches.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={p.id === value}
                    onClick={() => { onChange(p.id); setOpen(false); }}
                    className="w-full text-left px-3 py-2 hover:bg-muted flex items-center gap-2"
                  >
                    {p.id === value ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm truncate">{p.name}</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {[p.brand, p.sku].filter(Boolean).join(" · ")}
                        {/* Says so plainly, because uploading here puts it back
                            on the storefront and that should not be a surprise. */}
                        {p.is_active === false && " · hidden until it has a photo"}
                      </span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>

          {query.trim() === "" && products.length > matches.length && (
            <p className="px-3 py-2 text-xs text-muted-foreground border-t border-border">
              Showing {matches.length} of {products.length.toLocaleString("en-ZA")} — type to search the rest.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductPicker;
