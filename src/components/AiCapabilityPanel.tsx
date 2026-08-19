import { useEffect, useState } from "react";
import { Cpu, Sparkles, HelpCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { buildAiHighlights, useCaseMeta, type AiSpecFields, type UseCaseMeta } from "@/lib/ai-specs";

/**
 * "What can this machine actually do?" panel.
 *
 * Shoppers don't buy TOPS, they buy outcomes. The hard number stays on screen
 * (an engineer can still verify the claim) but it is always paired with the
 * work it unlocks, and every metric carries a tooltip explaining the unit in
 * plain language — "45 TOPS" means nothing without "trillions of AI operations
 * per second; 40+ is Microsoft's Copilot+ bar". Renders nothing when the
 * product carries no derived AI specs, so accessories are unaffected.
 */
const AiCapabilityPanel = ({ productId }: { productId: string }) => {
  const { t } = useTranslation();
  const [fields, setFields] = useState<AiSpecFields | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!productId) return;
    supabase
      .from("products")
      .select("ai_npu_tops, ai_gpu_model, ai_ram_gb, ai_use_cases")
      .eq("id", productId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setFields((data as unknown as AiSpecFields) ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (!fields) return null;

  const highlights = buildAiHighlights(fields);
  const badges = (fields.ai_use_cases ?? [])
    .map(useCaseMeta)
    .filter((b): b is UseCaseMeta => Boolean(b));

  if (highlights.length === 0 && badges.length === 0) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <section
        data-testid="ai-capability-panel"
        className="mt-10 card-flat p-6"
        aria-labelledby="ai-capability-title"
      >
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 id="ai-capability-title" className="font-display font-bold text-base">
            {t("aiSpecs.panelTitle")}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-5">{t("aiSpecs.panelSubtitle")}</p>

        {badges.length > 0 && (
          <ul className="flex flex-wrap gap-2 mb-6">
            {badges.map((b) => (
              <li key={b.key}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${b.tone}`}
                    >
                      <Sparkles className="h-3 w-3" aria-hidden="true" />
                      {t(b.labelKey)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[16rem] text-xs">{t(b.tooltipKey)}</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}

        {highlights.length > 0 && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {highlights.map((h) => (
              <div key={h.id} className="rounded-xl border border-border/70 p-4">
                <dt className="font-display font-bold text-sm flex items-center gap-1.5">
                  <span>
                    {t(`aiSpecs.metric.${h.id}.label`)}: {h.value}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t("aiSpecs.explainMetric", { metric: t(`aiSpecs.metric.${h.id}.label`) })}
                      >
                        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[16rem] text-xs">{t(h.tooltipKey)}</TooltipContent>
                  </Tooltip>
                </dt>
                <dd className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{t(h.outcomeKey)}</dd>
              </div>
            ))}
          </dl>
        )}

        {badges.length > 0 && (
          <ul className="mt-5 space-y-1.5">
            {badges.map((b) => (
              <li key={`${b.key}-why`} className="text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{t(b.labelKey)}:</span> {t(b.blurbKey)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </TooltipProvider>
  );
};

export default AiCapabilityPanel;
