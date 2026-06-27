import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// One-click unsubscribe -- no login required. This deliberately runs
// as a service-role edge function rather than a client-side RLS write,
// so the only thing a request can ever do is set unsubscribed_at on the
// matching email; it can't be abused to modify any other field.

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const email = url.searchParams.get("email");

  if (!email) {
    return new Response("Missing email parameter", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  await supabase
    .from("newsletter_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("email", email);

  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
    <body style="font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f8fb;">
      <div style="text-align:center;">
        <h2 style="color:#1a1a2e;">You've been unsubscribed</h2>
        <p style="color:#888;">${email} will no longer receive emails from AI Smart Store.</p>
        <a href="https://aismartstore.lovable.app" style="color:#06b6d4;">Return to the store</a>
      </div>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } }
  );
});
