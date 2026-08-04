-- The newsletter that was never sent.
--
-- `build_ai_pulse_digest()` ran every morning at 03:30, selected the day's
-- stories, rendered the HTML, inserted a campaign with status 'draft' -- and
-- stopped. Nothing downstream sent it. Six campaigns accumulated over six days
-- and not one subscriber received anything.
--
-- It was worse than idle. The function also writes the chosen stories into
-- `newsletter_story_sends`, which is how it avoids repeating a story in a
-- later digest. So each morning it consumed the day's best stories to build an
-- email nobody would read, and those stories could never appear again. Six
-- days of content was spent into drafts.
--
-- The missing half is dispatch. It lives here rather than inside
-- build_ai_pulse_digest() so that "compose" and "send" stay separable: an
-- operator can still build a draft, look at it, and send it by hand from
-- Admin -> Newsletter.

-- 1. Case-insensitive subscriber identity -------------------------------------
--
-- Two rows existed for the same person, differing only in the capitalisation
-- of the local part, because the signup form takes free text and nothing
-- normalised it. Two rows means two identical emails on every campaign, and to
-- the person receiving them that is not a database quirk, it is a shop that
-- spams. Deduplicated here, then made impossible by index.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lower(btrim(email))
           -- Keep the richest row, then the earliest -- a later duplicate that
           -- actually chose interests is more useful than an empty first
           -- attempt, and preserving the original subscribe date would misstate
           -- consent for a row we are discarding anyway.
           ORDER BY coalesce(array_length(interested_categories, 1), 0) DESC,
                    subscribed_at ASC
         ) AS rn
  FROM public.newsletter_subscribers
)
DELETE FROM public.newsletter_subscribers s
USING ranked r
WHERE s.id = r.id AND r.rn > 1;

UPDATE public.newsletter_subscribers
SET email = lower(btrim(email))
WHERE email <> lower(btrim(email));

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscribers_email_lower_key
  ON public.newsletter_subscribers (lower(email));

-- 2. Dispatch -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dispatch_ai_pulse_digest()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_campaign uuid;
  v_secret   text;
  v_url      text;
BEGIN
  v_campaign := public.build_ai_pulse_digest();

  -- A quiet news day drafts nothing, and that is a designed outcome rather
  -- than a failure: six subscribers forgive silence, they do not forgive a
  -- padded digest. Nothing to send, nothing to report.
  IF v_campaign IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'internal_cron_secret';

  IF v_secret IS NULL THEN
    -- Loud, because the symptom otherwise is silence -- exactly the failure
    -- being fixed here. The draft survives and can be sent by hand.
    INSERT INTO public.automation_events (source, event_type, status, error_message, payload)
    VALUES ('ai-pulse-digest', 'digest.dispatch_blocked', 'error',
            'internal_cron_secret missing from vault; digest drafted but not sent.',
            jsonb_build_object('campaign_id', v_campaign));
    RETURN v_campaign;
  END IF;

  SELECT 'https://' || (SELECT value FROM public.store_settings WHERE key = 'supabase_project_ref')
         || '.supabase.co/functions/v1/send-newsletter-campaign'
    INTO v_url;
  IF v_url IS NULL OR v_url LIKE 'https://.%' THEN
    v_url := 'https://xwiqubcilptxzvdigsmp.supabase.co/functions/v1/send-newsletter-campaign';
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object('campaign_id', v_campaign)
  );

  -- net.http_post only queues the request; the HTTP result lands in
  -- net._http_response, not here. So this records that dispatch was attempted,
  -- and send-newsletter-campaign records what actually happened to the mail.
  -- The campaign's own status is the source of truth for delivery.
  INSERT INTO public.automation_events (source, event_type, status, payload)
  VALUES ('ai-pulse-digest', 'digest.dispatched', 'success',
          jsonb_build_object('campaign_id', v_campaign));

  RETURN v_campaign;
END;
$fn$;

REVOKE ALL ON FUNCTION public.dispatch_ai_pulse_digest() FROM PUBLIC, anon, authenticated;

-- 3. Point the schedule at dispatch rather than compose ------------------------
SELECT cron.schedule(
  'ai-pulse-daily-digest',
  '30 3 * * *',
  $cron$ SELECT public.dispatch_ai_pulse_digest(); $cron$
);

-- 4. Retire the six drafts nobody received -------------------------------------
--
-- Not sent. Their newest story is a day old and their oldest is from 30 July;
-- mailing six digests at once to make up for lost time is how a small list
-- gets marked as spam and how the sending domain's reputation is spent. They
-- are marked 'cancelled' rather than deleted so the record of what happened
-- survives, and their body_html remains if any is worth resending by hand.
UPDATE public.newsletter_campaigns
SET status = 'cancelled'
WHERE status = 'draft'
  AND created_at < date_trunc('day', now());
