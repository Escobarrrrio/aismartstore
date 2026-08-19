
CREATE OR REPLACE FUNCTION public.derive_ai_specs(p_name text, p_price numeric, p_category text)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  n text := coalesce(p_name, '');
  m text[];
  npu numeric;
  gpu text;
  ram integer;
  cases text[] := ARRAY[]::text[];
  is_compute boolean;
BEGIN
  is_compute := coalesce(p_category, '') ~* '(laptop|notebook|desktop|workstation|computing|all-in-one)'
                OR n ~* '(laptop|notebook|thinkpad|latitude|ideapad|vivobook|zenbook|macbook|elitebook|probook|pavilion|inspiron|workstation|all-in-one)';

  m := regexp_match(n, '([0-9]+(?:\.[0-9]+)?)\s*TOPS', 'i');
  IF m IS NOT NULL THEN
    npu := m[1]::numeric;
  ELSIF n ~* 'Snapdragon X (Elite|Plus)' THEN npu := 45;
  ELSIF n ~* 'Core Ultra [0-9]{1}\s?2[0-9]{2}V' THEN npu := 47;
  ELSIF n ~* 'Ryzen AI (9|7|5)' THEN npu := 50;
  ELSIF n ~* 'Core Ultra' THEN npu := 11;
  ELSIF n ~* 'Ryzen [0-9] (7040|8040|8[0-9]{3})' THEN npu := 16;
  END IF;

  m := regexp_match(n, '((?:RTX|GTX)\s?[0-9]{3,4}\s?(?:Ti|Super|Ada)?|Radeon\s?RX\s?[0-9]{3,4}[A-Z]*|Arc\s?[AB][0-9]{3})', 'i');
  IF m IS NOT NULL THEN gpu := regexp_replace(btrim(m[1]), '\s+', ' ', 'g'); END IF;

  m := regexp_match(n, '/\s*([0-9]{1,3})\s?GB\s*/', 'i');
  IF m IS NULL THEN m := regexp_match(n, '([0-9]{1,3})\s?GB\s+(?:DDR[0-9]|RAM|Memory|LPDDR[0-9])', 'i'); END IF;
  IF m IS NOT NULL THEN ram := m[1]::integer; END IF;

  IF is_compute THEN
    IF npu IS NOT NULL AND npu >= 40 THEN cases := cases || ARRAY['copilot_plus']; END IF;
    IF gpu IS NOT NULL THEN cases := cases || ARRAY['video_rendering', 'image_generation']; END IF;
    IF coalesce(ram, 0) >= 32 OR (gpu IS NOT NULL AND coalesce(ram, 0) >= 16) THEN cases := cases || ARRAY['data_science']; END IF;
    IF coalesce(ram, 0) BETWEEN 8 AND 16 AND coalesce(p_price, 0) BETWEEN 1 AND 20000 THEN cases := cases || ARRAY['student_essentials']; END IF;
    IF npu IS NOT NULL AND gpu IS NULL AND coalesce(ram, 0) >= 16 THEN cases := cases || ARRAY['all_day_battery_ai']; END IF;
  END IF;

  RETURN jsonb_build_object('npu', npu, 'gpu', gpu, 'ram', ram, 'cases', to_jsonb(cases));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.derive_ai_specs(text, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.derive_ai_specs(text, numeric, text) TO authenticated, anon, service_role;
