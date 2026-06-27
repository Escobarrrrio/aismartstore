import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Checks whether the currently signed-in user holds the 'admin' app role.
 * Distinct from being merely authenticated -- the products/orders/settings
 * RLS policies key off this same role server-side (see has_role() and the
 * 20260626221500_security_lockdown.sql migration), so this hook keeps the
 * UI consistent with what the database will actually allow.
 */
export function useIsAdmin(session: any) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session?.user?.id) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setIsAdmin(!error && !!data);
      });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  return isAdmin; // null = still checking, false = not admin, true = admin
}
