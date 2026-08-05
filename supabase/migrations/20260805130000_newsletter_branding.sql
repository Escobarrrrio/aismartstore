-- Make the AI Pulse digest look like it came from a real company.
--
-- Three problems with the first one that actually reached an inbox:
--
--  1. THE SUBJECT LINE SHOWED RAW HTML. "AI Pulse: Nigeria&#8217;s 90,000km
--     fibre project" -- because feed titles arrive carrying HTML entities and
--     the subject header of an email is plain text, not HTML. The body rendered
--     the same title correctly, which is why this survived review: the entity
--     was only visible in the one place nobody had looked.
--
--  2. NO LOGO. Every other company in that inbox showed a mark; this showed a
--     grey circle with initials. On a store nobody has bought from yet, the
--     logo is not decoration -- it is most of the credibility the email has.
--
--  3. NO BRAND. Grey headings and a black serif hairline, on a store whose
--     whole identity is a cyan-to-magenta gradient.

-- Decodes the HTML entities that actually appear in RSS titles.
--
-- Deliberately not a general-purpose HTML decoder: this handles the numeric
-- and named entities feeds really produce for punctuation, and leaves anything
-- else alone. A subject line is plain text, so anything left encoded here is
-- visible to the reader -- which is exactly the bug being fixed.
CREATE OR REPLACE FUNCTION public.decode_html_entities(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE WHEN p_text IS NULL THEN NULL ELSE
    -- &amp; is unescaped LAST. Doing it first would turn "&amp;#8217;" into
    -- "&#8217;" and then into an apostrophe, silently changing text that was
    -- correctly double-escaped to begin with.
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(p_text, '&#8217;', ''''),
                          '&#8216;', ''''),
                        '&#8220;', '"'),
                      '&#8221;', '"'),
                    '&#8211;', '-'),
                  '&#8212;', '—'),
                '&#8230;', '…'),
              '&rsquo;', ''''),
            '&lsquo;', ''''),
          '&ldquo;', '"'),
        '&rdquo;', '"'),
      '&nbsp;', ' '),
    '&amp;', '&')
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.build_ai_pulse_digest(
  p_stories integer DEFAULT 5,
  p_min_stories integer DEFAULT 3,
  p_min_score numeric DEFAULT 55,
  p_max_per_source integer DEFAULT 2
)
RETURNS uuid
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_site  text := 'https://aismartstore.co.za';
  -- Served from /public, so the filename is stable forever. An asset imported
  -- through the bundler gets a content hash in its name and changes on every
  -- rebuild, which would silently break the logo in every email already sent.
  v_logo  text := 'https://aismartstore.co.za/logo.png';
  v_story record; v_prod record;
  v_html text := ''; v_cards text;
  v_lead text; v_count int := 0; v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR v_story IN
    SELECT * FROM (
      SELECT c.*,
             row_number() OVER (PARTITION BY c.source ORDER BY c.score DESC, c.published_at DESC) AS src_rank
        FROM public.ai_pulse_digest_candidates c
       WHERE c.score >= p_min_score
    ) r
    WHERE r.src_rank <= p_max_per_source
    ORDER BY r.score DESC, r.published_at DESC
    LIMIT p_stories
  LOOP
    v_count := v_count + 1;
    v_ids := v_ids || v_story.id;
    IF v_lead IS NULL THEN v_lead := public.decode_html_entities(v_story.title); END IF;

    v_cards := '';
    FOR v_prod IN
      SELECT p.id, p.name, p.price, p.images[1] AS image
        FROM public.products p
       WHERE p.is_active AND p.audience = 'residential' AND p.in_stock
         AND p.category = ANY (public.ai_pulse_story_categories(v_story.title || ' ' || coalesce(v_story.summary,'')))
         AND public.merch_is_home_eligible(p.category, p.name, p.price, p.images, p.is_ai_product)
       ORDER BY (public.score_home_product(p.category, p.name, p.brand, p.price, p.in_stock,
                   p.stock_quantity, p.images, p.is_ai_product, 0)->>'score')::numeric DESC
       LIMIT 2
    LOOP
      v_cards := v_cards ||
        '<td style="padding:8px;vertical-align:top;width:50%">' ||
          '<a href="' || v_site || '/product/' || v_prod.id ||
             '?utm_source=newsletter&utm_medium=email&utm_campaign=ai_pulse_daily" style="text-decoration:none;color:#111">' ||
            '<img src="' || coalesce(v_prod.image,'') || '" width="120" height="120" style="display:block;object-fit:contain;background:#fff;border:1px solid #eee;border-radius:10px" alt="">' ||
            '<div style="font-size:13px;font-weight:600;margin-top:8px;line-height:1.35;color:#111">' || left(coalesce(v_prod.name,''),70) || '</div>' ||
            '<div style="font-size:15px;font-weight:800;margin-top:4px;color:#7c3aed">R' || to_char(round(v_prod.price),'FM999G999') || '</div>' ||
          '</a></td>';
    END LOOP;

    v_html := v_html ||
      '<div style="margin:0 0 26px;padding:0 0 24px;border-bottom:1px solid #ececf1">' ||
        CASE WHEN v_story.country IS NOT NULL
             THEN '<div style="display:inline-block;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;' ||
                  'color:#fff;background:linear-gradient(135deg,#06b6d4,#7c3aed);padding:4px 10px;border-radius:999px;margin-bottom:10px">'
                  || v_story.country || '</div>'
             ELSE '' END ||
        '<a href="' || v_story.url || '" style="display:block;font-size:18px;font-weight:800;color:#12121a;text-decoration:none;line-height:1.32">'
          || v_story.title || '</a>' ||
        CASE WHEN coalesce(v_story.summary,'') <> ''
             THEN '<p style="font-size:14px;color:#55555f;line-height:1.6;margin:9px 0 0">' || v_story.summary || '</p>' ELSE '' END ||
        CASE WHEN v_cards <> ''
             THEN '<p style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#9b9baa;font-weight:700;margin:20px 0 6px">Kit for this</p>'
                  || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' || v_cards || '</tr></table>'
             ELSE '' END ||
      '</div>';
  END LOOP;

  IF v_count < p_min_stories THEN
    RAISE NOTICE 'build_ai_pulse_digest: only % qualifying unsent stories (need %), nothing drafted', v_count, p_min_stories;
    RETURN NULL;
  END IF;

  INSERT INTO public.newsletter_campaigns (subject, preview_text, body_html, status)
  VALUES (
    -- Decoded, because a subject line is plain text. This is the fix for
    -- "Nigeria&#8217;s" appearing verbatim in the inbox.
    'AI Pulse: ' || left(v_lead, 60) || CASE WHEN length(v_lead) > 60 THEN '...' ELSE '' END,
    left(v_lead, 120),
      '<div style="background:#f6f6f9;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,Helvetica,Arial,sans-serif">'
      || '<div style="max-width:640px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(18,18,26,.08)">'
      -- Brand bar: the gradient the whole site is built on, with the real mark.
      || '<div style="background:linear-gradient(135deg,#06b6d4 0%,#7c3aed 50%,#d946ef 100%);padding:22px 28px">'
        || '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
          || '<td style="vertical-align:middle;padding-right:10px">'
            || '<img src="' || v_logo || '" width="34" height="34" alt="AI Smart Store"'
            || ' style="display:block;width:34px;height:34px;object-fit:contain">'
          || '</td>'
          || '<td style="vertical-align:middle">'
            || '<div style="font-size:17px;font-weight:800;color:#fff;letter-spacing:-.01em">AI Smart Store</div>'
          || '</td>'
        || '</tr></table>'
      || '</div>'
      || '<div style="padding:28px">'
        || '<h1 style="font-size:26px;margin:0 0 6px;color:#12121a;letter-spacing:-.02em">AI Pulse</h1>'
        || '<p style="font-size:13px;color:#77778a;margin:0 0 26px">The AI stories that actually matter in South Africa — and the kit behind them.</p>'
        || v_html
        || '<a href="' || v_site || '/products?utm_source=newsletter&utm_medium=email&utm_campaign=ai_pulse_daily"'
        || ' style="display:inline-block;background:linear-gradient(135deg,#06b6d4,#7c3aed);color:#fff;font-weight:700;'
        || 'font-size:14px;text-decoration:none;padding:13px 26px;border-radius:999px;margin-top:6px">Shop the catalogue</a>'
      || '</div>'
      || '<div style="padding:18px 28px;background:#fafafc;border-top:1px solid #ececf1">'
        || '<p style="font-size:11px;color:#9b9baa;margin:0;line-height:1.6">'
        || 'You are receiving this because you subscribed at aismartstore.co.za.<br>'
        || 'AI Smart Store · Gqeberha, Eastern Cape · Proudly South African</p>'
      || '</div>'
      || '</div></div>',
    'draft'
  ) RETURNING id INTO v_id;

  INSERT INTO public.newsletter_story_sends (item_id, campaign_id)
  SELECT unnest(v_ids), v_id
  ON CONFLICT (item_id) DO NOTHING;

  RETURN v_id;
END $function$;
