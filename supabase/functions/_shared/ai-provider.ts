// Resolves which LLM the AI features call.
//
// The OpenAI path was removed on 5 August 2026 at the owner's decision: it was
// a second paid provider standing behind a gateway that already works, on a
// store with no revenue yet. Nothing about it was broken -- it was an expense
// with no job.
//
// What remains is the platform gateway. `resolveAiProvider` returning null is a
// first-class, expected outcome, not an error: callers must degrade to "the
// assistant is unavailable" rather than throw, because that is exactly the
// state the store is in whenever no key is configured.
//
// NOTE FOR THE MIGRATION: this gateway belongs to the current host. After the
// move it stops resolving, and the AI features (shop assistant, admin agent,
// engine-room analyst) go quiet until a provider is configured again. Nothing
// else on the storefront depends on it -- catalogue, checkout, email and
// shipping are all independent.
export async function resolveAiProvider(
  _supabase: unknown,
): Promise<{ apiUrl: string; apiKey: string; model: string } | null> {
  const gatewayKey = Deno.env.get("LOVABLE_API_KEY");
  if (!gatewayKey) return null;

  return {
    apiUrl: "https://ai.gateway.lovable.dev/v1/chat/completions",
    apiKey: gatewayKey,
    model: "google/gemini-3-flash-preview",
  };
}
