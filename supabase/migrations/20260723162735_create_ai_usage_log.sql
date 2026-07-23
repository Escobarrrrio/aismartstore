-- Real AI usage/cost tracking. CostUsageModule.tsx previously showed
-- entirely fabricated numbers (hardcoded token counts, spend, and a
-- "budget cap" with no enforcement anywhere in the codebase) -- this
-- table is what real usage actually gets logged to going forward.
--
-- estimated_cost_usd is only populated for providers with verifiable
-- public per-token pricing (OpenAI) -- left NULL for Lovable AI gateway
-- usage rather than inventing a rate we can't confirm, since the gateway's
-- markup isn't publicly documented.

CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL, -- e.g. 'admin-ai-agent', 'ai-chat'
  provider TEXT NOT NULL, -- 'openai' | 'lovable-gateway'
  model TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_usd NUMERIC(10,6),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view AI usage log"
  ON public.ai_usage_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS ai_usage_log_created_at_idx ON public.ai_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_source_idx ON public.ai_usage_log(source);

GRANT SELECT ON public.ai_usage_log TO authenticated;
GRANT ALL ON public.ai_usage_log TO service_role;
