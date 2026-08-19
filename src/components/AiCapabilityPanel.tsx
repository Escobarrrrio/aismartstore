import { useEffect, useState } from "react";
import { Cpu, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { buildAiHighlights, useCaseMeta, type AiSpecFields } from "@/lib/ai-specs";

/**
 * "What can this machine actually do?" panel.
 *
 * Shoppers don't buy TOPS, they buy outcomes. The hard number stays on screen
 * (an engineer can still verify the claim) but it is always paired with the
 * work it unlocks. Renders nothing when the product carries no derived AI
 * specs, so accessories and enterprise gear are unaffected.
 */
const AiCapabilityPanel = ({ productId }: { productId: string }) => {
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
  const badges = (fields.ai_use_cases ?? []).map(useCaseMeta).filter(Boolean);

  if (highlights.length === 0 && badges.length === 0) return null;

  return (
    <section
      data-testid="ai-capability-panel"
      className="mt-10 card-flat p-6"
      aria-labelledby="ai-capability-title"
    >
      <div className="flex items-center gap-2 mb-1">
        <Cpu className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 id="ai-capability-title" className="font-display font-bold text-base">
          What this machine can actually do
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-5">
        Specs translated into real work — measured from the manufacturer's published hardware, not marketing.
      </p>

      {badges.length > 0 && (
        <ul className="flex flex-wrap gap-2 mb-6">
          {badges.map((b) => (
            <li
              key={b!.label}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${b!.tone}`}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {b!.label}
            </li>
          ))}
        </ul>
      )}

      {highlights.length > 0 && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {highlights.map((h) => (
            <div key={h.spec} className="rounded-xl border border-border/70 p-4">
              <dt className="font-display font-bold text-sm">{h.spec}</dt>
              <dd className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{h.outcome}</dd>
            </div>
          ))}
        </dl>
      )}

      {badges.length > 0 && (
        <ul className="mt-5 space-y-1.5">
          {badges.map((b) => (
            <li key={`${b!.label}-why`} className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{b!.label}:</span> {b!.blurb}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default AiCapabilityPanel;
