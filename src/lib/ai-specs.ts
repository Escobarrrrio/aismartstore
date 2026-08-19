/**
 * "AI-ready" translated into human outcomes.
 *
 * "AI" on a spec sheet is meaningless to a shopper — what matters is whether
 * the machine can actually run the work they have in mind. The database
 * derives three hard numbers per product (`ai_npu_tops`, `ai_gpu_model`,
 * `ai_ram_gb`) plus a list of use-case keys (`ai_use_cases`); this module is
 * the single place that turns those into plain-language copy.
 *
 * Nothing here invents capability: if the distributor's product name doesn't
 * carry the spec, the field is null and the UI simply omits that row rather
 * than guessing.
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
  /** Badge text — an outcome, never a spec. */
  label: string;
  /** One-line justification shown under the badge on the product page. */
  blurb: string;
  /** Tailwind token classes, semantic only. */
  tone: string;
}

const USE_CASES: Record<AiUseCaseKey, UseCaseMeta> = {
  copilot_plus: {
    label: "Copilot+ ready",
    blurb: "Its neural engine clears the 40 TOPS bar Microsoft requires for on-device Copilot+ features.",
    tone: "bg-primary/10 text-primary border-primary/20",
  },
  video_rendering: {
    label: "Great for video rendering",
    blurb: "A discrete graphics chip does the export work, so 4K timelines scrub and render without stalling.",
    tone: "bg-accent/10 text-accent-foreground border-accent/30",
  },
  image_generation: {
    label: "Runs local image generation",
    blurb: "Enough dedicated graphics memory to run Stable Diffusion-class models on the machine itself.",
    tone: "bg-accent/10 text-accent-foreground border-accent/30",
  },
  data_science: {
    label: "Ideal for data science",
    blurb: "Large working memory keeps big dataframes, notebooks and models in RAM instead of swapping to disk.",
    tone: "bg-secondary text-secondary-foreground border-border",
  },
  student_essentials: {
    label: "Student essentials",
    blurb: "Sized and priced for coursework, research and video calls — not for rendering farms.",
    tone: "bg-muted text-foreground border-border",
  },
  all_day_battery_ai: {
    label: "All-day AI on battery",
    blurb: "AI work runs on the low-power neural engine rather than a thirsty graphics card.",
    tone: "bg-primary/10 text-primary border-primary/20",
  },
};

export const useCaseMeta = (key: string): UseCaseMeta | null =>
  (USE_CASES as Record<string, UseCaseMeta>)[key] ?? null;

export interface AiHighlight {
  /** The hard spec, kept visible so engineers can still verify the claim. */
  spec: string;
  /** What that spec lets the owner actually do. */
  outcome: string;
}

/** Hard specs paired with the outcome they buy. Empty when nothing is known. */
export const buildAiHighlights = (fields: AiSpecFields): AiHighlight[] => {
  const out: AiHighlight[] = [];

  if (fields.ai_npu_tops != null) {
    const tops = Number(fields.ai_npu_tops);
    out.push({
      spec: `NPU: ${tops} TOPS`,
      outcome:
        tops >= 40
          ? "Meets Copilot+ requirements — live captions, translation and image cleanup run on-device."
          : "Handles background blur, noise removal and everyday assistant features without touching the cloud.",
    });
  }

  if (fields.ai_gpu_model) {
    out.push({
      spec: `GPU: ${fields.ai_gpu_model}`,
      outcome: "Optimised for local image generation, video export and model fine-tuning.",
    });
  }

  if (fields.ai_ram_gb != null) {
    const ram = Number(fields.ai_ram_gb);
    out.push({
      spec: `Memory: ${ram}GB`,
      outcome:
        ram >= 32
          ? "Room for large datasets and multiple models loaded at once."
          : ram >= 16
            ? "Comfortable for dozens of tabs, an IDE and a local assistant at the same time."
            : "Suited to browsing, documents, study work and video calls.",
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
