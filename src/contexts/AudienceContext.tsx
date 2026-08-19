import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";

/**
 * Shopping mode = which half of the ontology the visitor is browsing.
 *
 * The catalogue is distributor-fed and overwhelmingly enterprise (servers,
 * seat licensing, care packs, Aruba networking). Asking a household shopper
 * to filter that out themselves is how B2B gear bleeds into a B2C feed, so
 * the mode is chosen once at entry and then applied as a hard query filter
 * (`products.audience`) everywhere the catalogue is read.
 *
 * `null` means "not chosen yet" -> the entry gate shows.
 */
export type ShoppingMode = "residential" | "business";

const STORAGE_KEY = "ais.shopping_mode";

interface AudienceContextType {
  /** Chosen mode, or null when the visitor has not picked one yet. */
  mode: ShoppingMode | null;
  /** False until localStorage has been read, so the gate never flashes. */
  ready: boolean;
  setMode: (mode: ShoppingMode) => void;
  /** Re-opens the entry gate (used by the "switch portal" links). */
  clearMode: () => void;
}

const AudienceContext = createContext<AudienceContextType | undefined>(undefined);

const read = (): ShoppingMode | null => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "residential" || v === "business" ? v : null;
  } catch {
    return null;
  }
};

export const AudienceProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setModeState] = useState<ShoppingMode | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setModeState(read());
    setReady(true);
  }, []);

  const setMode = useCallback((next: ShoppingMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode -- the in-memory value still holds for this session */
    }
    setModeState(next);
  }, []);

  const clearMode = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setModeState(null);
  }, []);

  return (
    <AudienceContext.Provider value={{ mode, ready, setMode, clearMode }}>
      {children}
    </AudienceContext.Provider>
  );
};

export const useAudience = () => {
  const ctx = useContext(AudienceContext);
  if (!ctx) throw new Error("useAudience must be used within AudienceProvider");
  return ctx;
};
