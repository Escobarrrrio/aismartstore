-- ===========================================================================
-- Take TRUNCATE away from anon and authenticated, everywhere
-- ===========================================================================
--
-- Found while granting privileges for the Engine Room tables, and it is not
-- limited to those.
--
-- THE PROBLEM
-- -----------
-- This database's default privileges grant every newly created table in the
-- `public` schema the full privilege set to both `anon` and `authenticated`:
-- SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES.
--
-- For six of those seven, row-level security narrows it back down, which is why
-- the store behaves correctly and why nobody noticed. RLS is doing an enormous
-- amount of quiet work here.
--
-- **TRUNCATE is the exception. It is not subject to row-level security at all.**
-- A role holding TRUNCATE empties the table regardless of how restrictive its
-- policies are. Across 43 tables, `anon` held it on `orders`, `payment_events`,
-- `order_audit_log`, `compliance_access_log`, `user_roles`, `profiles` and
-- `products`, among others.
--
-- HOW BAD, HONESTLY
-- -----------------
-- Latent rather than live. PostgREST never issues TRUNCATE, so there is no path
-- from the public API to this today, and there is no evidence it was ever
-- reachable. It is a privilege that should not have existed, sitting one
-- unrelated mistake away from mattering -- a future function, a direct
-- connection, an extension that runs SQL on a caller's behalf.
--
-- It also made a promise elsewhere in this codebase untrue. The security_events
-- table is documented as an audit log nobody can edit or delete, "because an
-- audit log an admin session can edit is a diary that the person under
-- investigation is holding". That was accurate about DELETE and wrong about
-- TRUNCATE, and the log an attacker most wants gone is precisely the one
-- recording what they did.
--
-- WHAT THIS CHANGES, AND WHAT IT DELIBERATELY DOES NOT
-- ----------------------------------------------------
-- Revoked: TRUNCATE, TRIGGER, REFERENCES. None of these is used by the
-- application. TRIGGER and REFERENCES let a role attach triggers and foreign
-- keys to a table -- schema-level powers that a browser session has no business
-- holding either, and they came from the same default.
--
-- Untouched: SELECT, INSERT, UPDATE, DELETE. Those are what the storefront
-- actually runs on, and RLS governs them correctly. Revoking them here to look
-- thorough would take the site down.
--
-- The ALTER DEFAULT PRIVILEGES at the end is the part that makes this stick.
-- Without it the next `CREATE TABLE` reintroduces the whole problem and this
-- migration becomes a thing somebody has to remember to re-run.
-- ===========================================================================

DO $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I.%I FROM anon, authenticated',
                   r.schemaname, r.tablename);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Revoked TRUNCATE/TRIGGER/REFERENCES from anon and authenticated on % tables', n;
END $$;

-- Views carry the grant too, but TRUNCATE on a view is not an operation
-- Postgres will perform -- it is a recorded privilege with nothing behind it.
-- Cleared anyway so an audit of this schema returns nothing rather than two
-- rows somebody then has to reason about.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, viewname FROM pg_views WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I.%I FROM anon, authenticated',
                   r.schemaname, r.viewname);
  END LOOP;
END $$;

-- The durable half. Default privileges are recorded per granting role, and
-- every table in this schema is owned by `postgres`, so that is the role whose
-- defaults need changing.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
