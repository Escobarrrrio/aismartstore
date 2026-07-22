// Resolves which LLM provider/key to call: an admin-configured OpenAI key
// takes priority, falling back to the Lovable AI gateway. Shared so ai-chat
// and admin-ai-agent don't each maintain their own copy of this logic.
export async function resolveAiProvider(supabase: any): Promise<
  { apiUrl: string; apiKey: string; model: string } | null
> {
  const { data: openaiSetting } = await supabase
    .from("store_settings")
    .select("value")
    .eq("key", "openai_api_key")
    .maybeSingle();

  const openaiKey = openaiSetting?.value;
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");

  if (openaiKey) {
    return { apiUrl: "https://api.openai.com/v1/chat/completions", apiKey: openaiKey, model: "gpt-4o-mini" };
  }
  if (lovableKey) {
    return { apiUrl: "https://ai.gateway.lovable.dev/v1/chat/completions", apiKey: lovableKey, model: "google/gemini-3-flash-preview" };
  }
  return null;
}
