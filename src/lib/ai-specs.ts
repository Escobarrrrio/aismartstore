/**
 * "AI-ready" translated into human outcomes.
 *
 * "AI" on a spec sheet is meaningless to a shopper — what matters is whether
 * the machine can actually run the work they have in mind. The database
 * derives three hard numbers per product (`ai_npu_tops`, `ai_gpu_model`,
 * `ai_ram_gb`) plus a list of use-case keys (`ai_use_cases`); this module is
 * the single place that turns those into i18n keys.
 *
 * Nothing here invents capability: if the distributor's product name doesn't
 * carry the spec, the field is null and the UI simply omits that row rather
 * than guessing. Copy lives in the locale files (`aiSpecs.*`) so both the
 * residential and business portals render in the shopper's language.
 */

export type AiUseCaseKey =
  | "copilot_plus"
  | "video_rendering"
  | "image_generation"
  | "data_science"
  | "student_essentials"
  | "all_day_battery_ai";

export interface AiSpecFields {
  ai_npu_tops: number | null;
  ai_gpu_model: string | null;
  ai_ram_gb: number | null;
  ai_use_cases: string[] | null;
}

export interface UseCaseMeta {
  key: AiUseCaseKey;
  /** Badge text — an outcome, never a spec. */
  labelKey: string;
  /** One-line justification shown under the badge. */
  blurbKey: string;
  /** Longer "what does this actually mean?" tooltip body. */
  tooltipKey: string;
  /** Tailwind token classes, semantic only. */
  tone: string;
}

const meta = (key: AiUseCaseKey, tone: string): UseCaseMeta => ({
  key,
  labelKey: `aiSpecs.useCase.${key}.label`,
  blurbKey: `aiSpecs.useCase.${key}.blurb`,
  tooltipKey: `aiSpecs.useCase.${key}.tooltip`,
  tone,
});

const USE_CASES: Record<AiUseCaseKey, UseCaseMeta> = {
  copilot_plus: meta("copilot_plus", "bg-primary/10 text-primary border-primary/20"),
  video_rendering: meta("video_rendering", "bg-accent/10 text-accent-foreground border-accent/30"),
  image_generation: meta("image_generation", "bg-accent/10 text-accent-foreground border-accent/30"),
  data_science: meta("data_science", "bg-secondary text-secondary-foreground border-border"),
  student_essentials: meta("student_essentials", "bg-muted text-foreground border-border"),
  all_day_battery_ai: meta("all_day_battery_ai", "bg-primary/10 text-primary border-primary/20"),
};

export const useCaseMeta = (key: string): UseCaseMeta | null =>
  (USE_CASES as Record<string, UseCaseMeta>)[key] ?? null;

export type AiMetricId = "npu" | "gpu" | "ram";

export interface AiHighlight {
  id: AiMetricId;
  /** The hard spec value, kept visible so buyers can verify the claim. */
  value: string;
  /** i18n key: what that spec lets the owner actually do. */
  outcomeKey: string;
  /** i18n key: plain-language explanation of the metric itself. */
  tooltipKey: string;
}

/** Hard specs paired with the outcome they buy. Empty when nothing is known. */
export const buildAiHighlights = (fields: AiSpecFields): AiHighlight[] => {
  const out: AiHighlight[] = [];

  if (fields.ai_npu_tops != null) {
    const tops = Number(fields.ai_npu_tops);
    out.push({
      id: "npu",
      value: `${tops} TOPS`,
      outcomeKey: tops >= 40 ? "aiSpecs.metric.npu.outcomeHigh" : "aiSpecs.metric.npu.outcomeBase",
      tooltipKey: "aiSpecs.metric.npu.tooltip",
    });
  }

  if (fields.ai_gpu_model) {
    out.push({
      id: "gpu",
      value: fields.ai_gpu_model,
      outcomeKey: "aiSpecs.metric.gpu.outcome",
      tooltipKey: "aiSpecs.metric.gpu.tooltip",
    });
  }

  if (fields.ai_ram_gb != null) {
    const ram = Number(fields.ai_ram_gb);
    out.push({
      id: "ram",
      value: `${ram}GB`,
      outcomeKey:
        ram >= 32
          ? "aiSpecs.metric.ram.outcomeHigh"
          : ram >= 16
            ? "aiSpecs.metric.ram.outcomeMid"
            : "aiSpecs.metric.ram.outcomeBase",
      tooltipKey: "aiSpecs.metric.ram.tooltip",
    });
  }

  return out;
};

/** The single strongest badge, for tight spaces like a product card. */
export const primaryUseCase = (cases: string[] | null | undefined): UseCaseMeta | null => {
  const order: AiUseCaseKey[] = [
    "copilot_plus",
    "video_rendering",
    "data_science",
    "image_generation",
    "all_day_battery_ai",
    "student_essentials",
  ];
  if (!cases?.length) return null;
  for (const key of order) if (cases.includes(key)) return USE_CASES[key];
  return useCaseMeta(cases[0]);
};
