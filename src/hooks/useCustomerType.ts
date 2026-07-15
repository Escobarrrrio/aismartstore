import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CustomerType = "residential" | "business" | null;

/**
 * Resolves the signed-in user's `profiles.customer_type`.
 *
 * Return states:
 *   - undefined  → still checking (no session decision yet)
 *   - null       → signed out OR profile has no customer_type set
 *   - "residential" | "business" → confirmed audience
 *
 * Used by AudienceGuard to prevent residential shoppers from viewing the
 * business/government portal (and vice versa) via direct URL access.
 */
export function useCustomerType(): CustomerType | undefined {
  const [type, setType] = useState<CustomerType | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    const load = async (userId: string | null) => {
      if (!userId) {
        if (!cancelled) setType(null);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("customer_type")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      const val = (data?.customer_type as CustomerType) ?? null;
      setType(val === "residential" || val === "business" ? val : null);
    };

    supabase.auth.getSession().then(({ data }) => load(data.session?.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      load(session?.user?.id ?? null);
    });

    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  return type;
}
