import { supabase } from "@/integrations/supabase/client";

/**
 * Thin wrapper for admin-only RPC calls that are not yet reflected in the
 * generated Supabase types. Keeps the call sites type-clean and makes it easy
 * to migrate back to typed `supabase.rpc(...)` once the types are refreshed.
 */
export const adminRpc = async <T = unknown>(
  fn: string,
  params?: Record<string, unknown>
): Promise<{ data: T | null; error: Error | null }> => {
  const { data, error } = await (supabase.rpc as (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: T | null; error: Error | null }>)(fn, params ?? {});
  return { data, error };
};
