
-- 1) Move pg_trgm out of the public schema so its C functions stop tripping the
--    "search_path mutable" and GraphQL-exposure linters. Indexes reference the
--    operator class by OID, so they survive the schema move.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm' AND n.nspname='public') THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;
END $$;

-- search_products calls similarity() / % operator -- add extensions to its search_path.
ALTER FUNCTION public.search_products(text,text,text,boolean,boolean,numeric,numeric,text,integer,integer)
  SET search_path = public, extensions, pg_temp;

-- 2) Revoke EXECUTE on internal SECURITY DEFINER functions from anon/authenticated/PUBLIC.
--    Keep has_role (used by RLS) and get_product_admin_view (admin RPC with in-function role check).
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb)                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint)                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch()                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake()                          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deactivate_blocked_products_batch(integer)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_image_blocklist()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_order_changes()                         FROM PUBLIC, anon, authenticated;

-- 3) Hide internal-only tables from the GraphQL/PostgREST surface for anon and authenticated.
REVOKE SELECT ON public.image_blocklist      FROM anon, authenticated;
REVOKE SELECT ON public.profile_admin_notes  FROM anon, authenticated;
