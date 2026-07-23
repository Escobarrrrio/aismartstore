import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// SECURITY: unsubscribe requires a per-recipient token so no one can
// mass-unsubscribe others just by knowing their email address.
// Backwards-compatible: legacy links (?email=) using the token stored
// on newsletter_subscribers.unsubscribe_token are still honoured.

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const legacyEmail = url.searchParams.get("email");

  if (!token && !legacyEmail) {
    return new Response("Missing token", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let email: string | null = null;

  if (token) {
    // Primary path: opaque token from email_unsubscribe_tokens.
    const { data: row } = await supabase
      .from("email_unsubscribe_tokens")
      .select("email, used_at")
      .eq("token", token)
      .maybeSingle();
    if (row) {
      email = row.email;
      if (!row.used_at) {
        await supabase
          .from("email_unsubscribe_tokens")
          .update({ used_at: new Date().toISOString() })
          .eq("token", token);
      }
    } else {
      // Fallback: uuid token stored inline on subscribers.
      const { data: sub } = await supabase
        .from("newsletter_subscribers")
        .select("email")
        .eq("unsubscribe_token", token)
        .maybeSingle();
      if (sub) email = sub.email;
    }
  }

  if (!email) {
    return new Response(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;">
        <h2>Invalid or expired unsubscribe link</h2>
        <p>Please use the unsubscribe link from a recent email, or contact support.</p>
      </body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  await supabase
    .from("newsletter_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("email", email);

  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
    <body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f8fb;">
      <div style="text-align:center;">
        <h2 style="color:#1a1a2e;">You've been unsubscribed</h2>
        <p style="color:#888;">${email.replace(/[<>&"']/g, "")} will no longer receive emails from AI Smart Store.</p>
        <a href="https://aismartstore.co.za" style="color:#06b6d4;">Return to the store</a>
      </div>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
});
