import { supabase } from "@/integrations/supabase/client";

/**
 * Thin wrapper for admin-only RPC calls that are not yet reflected in the
 * generated Supabase types. Keeps the call sites type-clean and makes it easy
 * to migrate back to typed `supabase.rpc(...)` once the types are refreshed.
 */
export const adminRpc = async <T = unknown>(
  fn: string,
  params?: Record<string, unknown>
): Promise<{ data: T | null; error: { message: string } | null }> => {
  // Must stay a method call on the client: `supabase.rpc` detached from its
  // receiver throws "Cannot read properties of undefined (reading 'rest')".
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: T | null; error: { message: string } | null }>;
  return rpc(fn, params ?? {});
};
