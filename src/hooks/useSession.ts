import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Current auth session, or `undefined` while it is still being resolved.
 *
 * The three-state return matters: gating on `!session` before the initial
 * `getSession()` resolves would bounce an already-signed-in buyer to the
 * login page on every hard refresh.
 */
export const useSession = () => {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (!cancelled) setSession(s);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSession(data.session);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return session;
};

export default useSession;
