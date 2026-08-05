-- Replace the Command Centre's invented numbers with real ones.
--
-- Nineteen metric cards in Admin -> Command Centre were string literals:
--
--   Threat Level "Low"        Risk Score "Low"          Uptime "99.9%"
--   API Health "100%"         Blocked IPs "0"           Error Rate "0%"
--   Today's Spend "R0.00"     Abuse Alerts "0"          Queue Depth "0"
--   Active Sessions "1"       Failed Logins (24h) "0"   Anomalies "0"
--   ...
--
-- Not defaults awaiting data. Constants. The security tiles would have read
-- "Risk Score: Low, Blocked IPs: 0, Abuse Alerts: 0" in the middle of an
-- active attack, and the spend tiles would have read R0.00 through a runaway
-- bill -- which is precisely when someone looks at them.
--
-- A dashboard that cannot be wrong is not a dashboard, it is wallpaper, and
-- wallpaper that looks like instrumentation is worse than a blank panel
-- because it is trusted.
--
-- Everything below comes from a table that is actually written to. Anything
-- that could not be sourced honestly -- uptime, active sessions, API health,
-- error rate -- is deleted from the screen rather than invented, because
-- "we do not measure that" is a true statement and "99.9%" is not.

CREATE OR REPLACE FUNCTION public.admin_command_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v jsonb;
BEGIN
  -- SECURITY DEFINER, so the admin check is the whole gate. Without it this
  -- would hand spend and threat posture to any authenticated customer.
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),

    -- Security -----------------------------------------------------------
    'blocked_now', (
      SELECT count(*) FROM public.threat_blocks WHERE expires_at > now()
    ),
    'quarantined_open', (
      SELECT count(*) FROM public.threat_quarantine WHERE NOT released
    ),
    'quarantined_24h', (
      SELECT count(*) FROM public.threat_quarantine WHERE created_at > now() - interval '24 hours'
    ),
    'security_events_24h', (
      SELECT count(*) FROM public.security_events WHERE created_at > now() - interval '24 hours'
    ),
    'security_events_critical_24h', (
      SELECT count(*) FROM public.security_events
       WHERE created_at > now() - interval '24 hours' AND severity IN ('high', 'critical')
    ),

    -- Spend --------------------------------------------------------------
    -- spend_ledger's timestamp column is `occurred_at`, not `created_at`.
    -- Day boundaries in Africa/Johannesburg, matching spend_guard -- a UTC
    -- "today" would reset the figure at 2am local and read low all evening.
    'spend_today_zar', coalesce((
      SELECT round(sum(cost_zar), 2) FROM public.spend_ledger
       WHERE occurred_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg')
                            AT TIME ZONE 'Africa/Johannesburg'
    ), 0),
    'spend_month_zar', coalesce((
      SELECT round(sum(cost_zar), 2) FROM public.spend_ledger
       WHERE occurred_at >= date_trunc('month', now() AT TIME ZONE 'Africa/Johannesburg')
                            AT TIME ZONE 'Africa/Johannesburg'
    ), 0),
    'monthly_cap_zar', coalesce((
      SELECT sum(monthly_cap_zar) FROM public.spend_caps WHERE enabled
    ), 0),
    'caps_hit_24h', (
      SELECT count(*) FROM public.security_events
       WHERE kind = 'spend_cap_hit' AND created_at > now() - interval '24 hours'
    ),

    -- Operations ---------------------------------------------------------
    'failed_jobs_24h', (
      SELECT count(*) FROM public.sync_logs
       WHERE status IN ('error', 'partial') AND created_at > now() - interval '24 hours'
    ),
    'last_sync_at', (
      SELECT max(created_at) FROM public.sync_logs WHERE status = 'success'
    ),
    'open_tickets', (
      SELECT count(*) FROM public.support_tickets WHERE status = 'open'
    ),
    -- order_status is a nullable enum on this table and `status` is the text
    -- column actually written by checkout, so both are consulted rather than
    -- assuming which one is authoritative.
    'pending_orders', (
      SELECT count(*) FROM public.orders
       WHERE coalesce(order_status::text, status) IN ('pending', 'processing')
    ),
    'orders_24h', (
      SELECT count(*) FROM public.orders WHERE created_at > now() - interval '24 hours'
    ),

    -- Catalogue ----------------------------------------------------------
    'products_live', (
      SELECT count(*) FROM public.products WHERE is_active
    ),
    'products_in_stock', (
      SELECT count(*) FROM public.products WHERE is_active AND in_stock
    ),
    'products_stale_7d', (
      SELECT count(*) FROM public.products
       WHERE is_active AND (last_synced_at IS NULL OR last_synced_at < now() - interval '7 days')
    ),
    'products_below_cost', (
      SELECT count(*) FROM public.products p
        JOIN public.product_costs c ON c.product_id = p.id
       WHERE p.is_active AND c.cost_price IS NOT NULL AND p.price < c.cost_price
    )
  ) INTO v;

  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.admin_command_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_command_metrics() TO authenticated;
