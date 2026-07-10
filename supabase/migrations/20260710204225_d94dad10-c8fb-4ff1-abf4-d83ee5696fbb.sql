
CREATE OR REPLACE FUNCTION public.deactivate_blocked_products_batch(batch_size INT DEFAULT 1000)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE affected INT;
BEGIN
  UPDATE public.products
  SET is_active = false
  WHERE ctid IN (
    SELECT p.ctid FROM public.products p
    JOIN public.image_blocklist b ON b.url = p.images[1]
    WHERE p.is_active
    LIMIT batch_size
  );
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
REVOKE ALL ON FUNCTION public.deactivate_blocked_products_batch(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_blocked_products_batch(INT) TO service_role;
