-- handle_new_user() previously only wrote (user_id, email, name) on signup --
-- every other signup field (phone, customer_type, id_number, company_name,
-- vat_number) was written by a separate client-side `.from("profiles").update()`
-- call immediately after signUp(). That call relied on an active session to
-- authenticate as the `authenticated` role (the only role either UPDATE
-- policy on profiles applies to). Since enabling "Confirm email required"
-- earlier tonight, signUp() no longer returns a session until the email is
-- confirmed -- so that follow-up call now runs as `anon`, which has no
-- matching UPDATE policy at all, and every new signup fails with
-- "permission denied for table profiles" before ever reaching the phone
-- verification step.
--
-- Fix: write everything in the same INSERT the trigger already does, from
-- signUp()'s own `options.data` metadata (which GoTrue accepts and persists
-- regardless of confirmation state -- no session or RLS involved at all).
-- src/pages/Auth.tsx updated to pass these fields through signUp() instead
-- of a separate post-signup update.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, name, phone, customer_type, id_number, company_name, vat_number)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'phone',
    COALESCE(NEW.raw_user_meta_data->>'customer_type', 'residential'),
    NEW.raw_user_meta_data->>'id_number',
    NEW.raw_user_meta_data->>'company_name',
    NEW.raw_user_meta_data->>'vat_number'
  );
  RETURN NEW;
END;
$function$;
