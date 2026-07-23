import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface WishlistContextType {
  /** True once the initial session check + (if signed in) wishlist fetch have resolved. */
  ready: boolean;
  /** False once we know there's no signed-in session. */
  signedIn: boolean;
  isWishlisted: (productId: string) => boolean;
  toggleWishlist: (productId: string) => Promise<void>;
  wishlistCount: number;
}

const WishlistContext = createContext<WishlistContextType | undefined>(undefined);

export const WishlistProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<any>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [wishlistLoaded, setWishlistLoaded] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => { setSession(s); setSessionChecked(true); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setSessionChecked(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sessionChecked) return;
    if (!session) { setWishlistIds(new Set()); setWishlistLoaded(true); return; }
    let cancelled = false;
    setWishlistLoaded(false);
    supabase.from("wishlists").select("product_id").eq("user_id", session.user.id).then(({ data, error }) => {
      if (cancelled) return;
      if (!error) setWishlistIds(new Set((data || []).map((r: any) => r.product_id)));
      setWishlistLoaded(true);
    });
    return () => { cancelled = true; };
  }, [session, sessionChecked]);

  const isWishlisted = useCallback((productId: string) => wishlistIds.has(productId), [wishlistIds]);

  const toggleWishlist = useCallback(async (productId: string) => {
    if (!session) {
      toast({ title: "Sign in to save items", description: "Create a free account to keep a wishlist across visits." });
      return;
    }
    const wasIn = wishlistIds.has(productId);

    setWishlistIds((prev) => {
      const next = new Set(prev);
      if (wasIn) next.delete(productId); else next.add(productId);
      return next;
    });

    const rollback = () => setWishlistIds((prev) => {
      const next = new Set(prev);
      if (wasIn) next.add(productId); else next.delete(productId);
      return next;
    });

    if (wasIn) {
      const { error } = await supabase.from("wishlists").delete().eq("user_id", session.user.id).eq("product_id", productId);
      if (error) { rollback(); toast({ title: "Couldn't remove item", description: error.message, variant: "destructive" }); }
    } else {
      const { error } = await supabase.from("wishlists").insert({ user_id: session.user.id, product_id: productId });
      if (error) { rollback(); toast({ title: "Couldn't save item", description: error.message, variant: "destructive" }); }
    }
  }, [session, wishlistIds, toast]);

  return (
    <WishlistContext.Provider
      value={{
        ready: sessionChecked && wishlistLoaded,
        signedIn: !!session,
        isWishlisted,
        toggleWishlist,
        wishlistCount: wishlistIds.size,
      }}
    >
      {children}
    </WishlistContext.Provider>
  );
};

export const useWishlist = () => {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within WishlistProvider");
  return ctx;
};
