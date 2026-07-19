CREATE OR REPLACE FUNCTION public.backfill_audience_batch(batch_size integer DEFAULT 3000, price_cap numeric DEFAULT 15000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE affected int;
BEGIN
  WITH batch AS (
    SELECT id, CASE WHEN price <= price_cap THEN 'residential' ELSE 'business' END AS new_aud
    FROM public.products
    WHERE is_active = true
      AND (audience IS DISTINCT FROM CASE WHEN price <= price_cap THEN 'residential' ELSE 'business' END)
    LIMIT batch_size
  )
  UPDATE public.products p SET audience = batch.new_aud
  FROM batch WHERE p.id = batch.id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$function$;