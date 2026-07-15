import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";

export type FacetOption = { value: string; count: number };

interface FacetListProps {
  label: string;
  options: FacetOption[];
  selected: string;
  onSelect: (value: string) => void;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  searchable?: boolean;
  initialVisible?: number;
}

const fmt = (n: number) => n.toLocaleString("en-ZA").replace(/,/g, " ");

/**
 * Takealot / Amazon-style facet list.
 * Scrollable, searchable, with counts and a "Show more" control.
 * Single-select — clicking the active row clears it.
 */
const FacetList = ({
  label,
  options,
  selected,
  onSelect,
  loading,
  error,
  onRetry,
  searchable = true,
  initialVisible = 8,
}: FacetListProps) => {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.value.toLowerCase().includes(q));
  }, [options, query]);

  const visible = expanded ? filtered : filtered.slice(0, initialVisible);
  const hidden = Math.max(0, filtered.length - initialVisible);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </label>
        {selected && (
          <button
            type="button"
            onClick={() => onSelect("")}
            className="text-[11px] text-primary hover:underline font-medium"
          >
            Clear
          </button>
        )}
      </div>

      {loading && options.length === 0 ? (
        <div role="status" aria-label={`Loading ${label} options`} className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-6 w-full rounded bg-muted animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {searchable && options.length > initialVisible && (
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}`}
                className="w-full h-8 pl-8 pr-2 rounded-md border border-input bg-background text-xs outline-none focus:border-primary transition-colors"
                aria-label={`Search ${label.toLowerCase()}`}
              />
            </div>
          )}
          <ul className="space-y-0.5 max-h-64 overflow-y-auto -mx-1 px-1">
            {visible.map((o) => {
              const active = o.value === selected;
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => onSelect(active ? "" : o.value)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors ${
                      active
                        ? "bg-primary/10 text-primary font-semibold"
                        : "hover:bg-muted text-foreground"
                    }`}
                    aria-pressed={active}
                  >
                    <span
                      className={`h-4 w-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        active ? "border-primary bg-primary text-primary-foreground" : "border-input"
                      }`}
                      aria-hidden
                    >
                      {active && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate">{o.value}</span>
                    <span className={`text-[11px] tabular-nums ${active ? "text-primary" : "text-muted-foreground"}`}>
                      {fmt(o.count)}
                    </span>
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-2 py-3 text-xs text-muted-foreground">No matches</li>
            )}
          </ul>
          {!query && hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-xs font-semibold text-primary hover:underline"
            >
              {expanded ? "Show less" : `Show ${hidden} more`}
            </button>
          )}
          {error && options.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Filter options couldn’t load.{" "}
              {onRetry && (
                <button type="button" onClick={onRetry} className="underline hover:text-foreground">
                  Retry
                </button>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default FacetList;
