-- ===========================================================================
-- AI Pulse Weekly — the digest that turns readers into buyers
-- ===========================================================================
--
-- THE PROBLEM
-- -----------
-- newsletter_campaigns has 0 rows. Ever. Six people handed over their email
-- address and their interest categories and have received precisely nothing.
-- The email pipeline itself works -- email_send_log shows signup, recovery and
-- invite messages all reaching status 'sent' -- so nothing was broken. Nothing
-- was ever written to send.
--
-- WHY THIS IS SQL AND NOT AN EDGE FUNCTION
-- ----------------------------------------
-- The Lovable credit balance is 0 until the 10 August renewal, so no edge
-- function can be deployed. Everything here runs inside Postgres on pg_cron,
-- which costs nothing and needs no deploy. Same constraint that moved the
-- African feed ingestion into SQL, same answer.
--
-- WHAT IS AUTOMATED, PRECISELY
-- ----------------------------
-- The *composition* is fully automatic and weekly: the digest picks the week's
-- strongest African AI stories, pairs each with products we actually sell, and
-- writes a ready-to-send campaign.
--
-- The *send* is one click in Admin -> Newsletter. Not because automating it is
-- hard, but because send-newsletter-campaign requires an admin JWT and pg_net
-- can only present a service-role key. Once credits return, teaching that
-- function to also accept INTERNAL_CRON_SECRET (which is already in the project
-- secrets) makes it hands-off -- a ten-line change.
--
-- Honestly, a human glance before 6+ strangers get mail from your business is
-- not the worst default in the world.
--
-- THE HOOK
-- --------
-- A newsletter of headlines is a newsletter people unsubscribe from. Each story
-- is paired with real, in-stock, correctly-priced products chosen by the same
-- merchandising engine that ranks the home page -- so "South Africa's national
-- AI policy" arrives next to something the reader can actually buy, and every
-- link lands on a product page rather than a category dump.
--
-- To revert: SELECT cron.unschedule('ai-pulse-weekly-digest');
--            DROP FUNCTION public.build_ai_pulse_digest();
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Story -> shopping intent
-- ---------------------------------------------------------------------------
-- Maps what a story is about to the categories a reader might plausibly buy
-- from after reading it. Deliberately conservative: an unmatched story simply
-- carries no products rather than being paired with something irrelevant,
-- because a mismatched product recommendation reads as spam and costs more
-- trust than the click is worth.
CREATE OR REPLACE FUNCTION public.ai_pulse_story_categories(p_text text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $fn$
  SELECT CASE
    WHEN lower(coalesce(p_text,'')) ~ '\y(smart home|smart bulb|smart light|robot vacuum|doorbell|thermostat|home automation)\y'
      THEN ARRAY['Smart Home','Peripherals']
    WHEN lower(coalesce(p_text,'')) ~ '\y(wearable|smart ?watch|fitness|health|sleep|ring)\y'
      THEN ARRAY['Wearables','Health & Wellness']
    WHEN lower(coalesce(p_text,'')) ~ '\y(gpu|nvidia|chip|accelerator|compute|data ?cent(re|er)|training)\y'
      THEN ARRAY['GPUs & AI Accelerators','Storage','Memory']
    WHEN lower(coalesce(p_text,'')) ~ '\y(remote work|hybrid|productivity|meeting|video call|collaboration|copilot)\y'
      THEN ARRAY['Peripherals','Monitors & Displays']
    WHEN lower(coalesce(p_text,'')) ~ '\y(network|connectivity|broadband|fibre|fiber|5g|wi-?fi|spectrum|icasa)\y'
      THEN ARRAY['Networking']
    WHEN lower(coalesce(p_text,'')) ~ '\y(laptop|notebook|pc|device|hardware|upgrade)\y'
      THEN ARRAY['Laptops','Desktops & Workstations','Storage']
    WHEN lower(coalesce(p_text,'')) ~ '\y(security|cyber|breach|identity|privacy|popia)\y'
      THEN ARRAY['Networking','Storage']
    ELSE ARRAY[]::text[]
  END;
$fn$;

COMMENT ON FUNCTION public.ai_pulse_story_categories(text) IS
  'Maps a story headline to categories a reader might buy from. Returns empty rather than guessing -- an irrelevant product pairing costs more trust than the click is worth.';


-- ---------------------------------------------------------------------------
-- The digest builder
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_ai_pulse_digest(
  p_days integer DEFAULT 7,
  p_stories integer DEFAULT 5
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public AS $fn$
DECLARE
  v_site      text := 'https://aismartstore.co.za';
  v_story     record;
  v_prod      record;
  v_html      text := '';
  v_cards     text;
  v_subject   text;
  v_lead      text;
  v_count     int := 0;
  v_id        uuid;
BEGIN
  -- African stories first, then anything else that week. `category = 'local'`
  -- is the SQL-ingested African press; those are the differentiator nobody
  -- else in SA e-commerce is publishing.
  FOR v_story IN
    SELECT title, url, summary, source, category, published_at
      FROM public.ai_pulse_items
     WHERE published_at > now() - make_interval(days => p_days)
       AND title IS NOT NULL
     ORDER BY (category = 'local') DESC, published_at DESC
     LIMIT p_stories
  LOOP
    v_count := v_count + 1;
    IF v_lead IS NULL THEN v_lead := v_story.title; END IF;

    v_cards := '';
    -- Up to two products per story, ranked by the same engine that ranks the
    -- home page, restricted to things actually in stock so nobody clicks
    -- through to a backorder.
    FOR v_prod IN
      SELECT p.id, p.name, p.price, p.brand, p.images[1] AS image
        FROM public.products p
       WHERE p.is_active
         AND p.audience = 'residential'
         AND p.in_stock
         AND p.category = ANY (public.ai_pulse_story_categories(v_story.title || ' ' || coalesce(v_story.summary,'')))
         AND public.merch_is_home_eligible(p.category, p.name, p.price, p.images, p.is_ai_product)
       ORDER BY (public.score_home_product(
                   p.category, p.name, p.brand, p.price, p.in_stock,
                   p.stock_quantity, p.images, p.is_ai_product, 0)->>'score')::numeric DESC
       LIMIT 2
    LOOP
      v_cards := v_cards ||
        '<td style="padding:8px;vertical-align:top;width:50%">' ||
          '<a href="' || v_site || '/product/' || v_prod.id ||
             '?utm_source=newsletter&utm_medium=email&utm_campaign=ai_pulse_weekly" ' ||
             'style="text-decoration:none;color:#111">' ||
            '<img src="' || coalesce(v_prod.image,'') || '" width="120" height="120" ' ||
              'style="display:block;object-fit:contain;background:#fff;border:1px solid #eee;border-radius:8px" alt="">' ||
            '<div style="font-size:13px;font-weight:600;margin-top:8px;line-height:1.35">' ||
              left(coalesce(v_prod.name,''), 70) || '</div>' ||
            '<div style="font-size:14px;font-weight:800;margin-top:4px">R' ||
              to_char(round(v_prod.price), 'FM999G999') || '</div>' ||
          '</a>' ||
        '</td>';
    END LOOP;

    v_html := v_html ||
      '<div style="margin:0 0 28px 0;padding:0 0 24px 0;border-bottom:1px solid #eee">' ||
        CASE WHEN v_story.category = 'local'
             THEN '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#c2410c;font-weight:700;margin-bottom:6px">Africa</div>'
             ELSE '' END ||
        '<a href="' || v_story.url || '" style="font-size:17px;font-weight:700;color:#111;text-decoration:none;line-height:1.3">' ||
          v_story.title || '</a>' ||
        CASE WHEN coalesce(v_story.summary,'') <> ''
             THEN '<p style="font-size:14px;color:#555;line-height:1.55;margin:8px 0 0">' || v_story.summary || '</p>'
             ELSE '' END ||
        CASE WHEN v_cards <> ''
             THEN '<p style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#888;margin:18px 0 6px">Kit for this</p>'
                  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' || v_cards || '</tr></table>'
             ELSE '' END ||
      '</div>';
  END LOOP;

  IF v_count = 0 THEN
    RAISE NOTICE 'build_ai_pulse_digest: no stories in the last % days, nothing drafted', p_days;
    RETURN NULL;
  END IF;

  -- The subject line is the week's lead headline, truncated on a word boundary.
  -- Real headlines out-open "Newsletter #14" every time, and these are already
  -- written by working journalists.
  v_subject := 'AI Pulse: ' || left(v_lead, 60) || CASE WHEN length(v_lead) > 60 THEN '…' ELSE '' END;

  INSERT INTO public.newsletter_campaigns (subject, preview_text, body_html, status)
  VALUES (
    v_subject,
    left(coalesce(v_lead,'This week in African AI'), 120),
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">'
      || '<div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#888;font-weight:700">AI Smart Store</div>'
      || '<h1 style="font-size:24px;margin:6px 0 4px">AI Pulse Weekly</h1>'
      || '<p style="font-size:13px;color:#777;margin:0 0 28px">'
      || 'The AI stories that actually matter in South Africa — and the kit behind them.</p>'
      || v_html
      || '<p style="font-size:12px;color:#999;margin-top:28px">You are receiving this because you subscribed at aismartstore.co.za.</p>'
      || '</div>',
    'draft'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $fn$;

COMMENT ON FUNCTION public.build_ai_pulse_digest(integer, integer) IS
  'Composes a weekly AI Pulse campaign: African stories first, each paired with in-stock products chosen by the merchandising engine. Leaves it in draft for an admin to send.';

REVOKE ALL ON FUNCTION public.build_ai_pulse_digest(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.build_ai_pulse_digest(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_pulse_story_categories(text) TO authenticated, service_role;


-- Monday 06:00 SAST (04:00 UTC) -- drafted before the week starts, so it is
-- ready and waiting rather than something to remember on a Friday afternoon.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai-pulse-weekly-digest') THEN
    PERFORM cron.schedule('ai-pulse-weekly-digest', '0 4 * * 1',
      $cron$ SELECT public.build_ai_pulse_digest(); $cron$);
  END IF;
END $do$;
