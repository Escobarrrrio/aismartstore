
-- 1) Pin search_path on the deactivate_blocked_products procedure
ALTER PROCEDURE public.deactivate_blocked_products() SET search_path = public, pg_temp;

-- 2) Hide the pg_graphql schema from anon and authenticated. This app talks to
--    PostgREST (supabase.from / .rpc), never GraphQL, so revoking USAGE closes
--    the "discoverable in GraphQL schema" surface without affecting any code.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphql') THEN
    REVOKE USAGE ON SCHEMA graphql FROM anon, authenticated;
    REVOKE ALL ON ALL TABLES    IN SCHEMA graphql FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA graphql FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA graphql FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'graphql_public') THEN
    REVOKE USAGE ON SCHEMA graphql_public FROM anon, authenticated;
    REVOKE ALL ON ALL TABLES    IN SCHEMA graphql_public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA graphql_public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA graphql_public FROM anon, authenticated;
  END IF;
END $$;
