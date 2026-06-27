import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SITE_URL = "https://aismartstore.lovable.app";

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: products } = await supabase
    .from("products")
    .select("id, updated_at")
    .eq("is_active", true);

  const staticUrls = [
    { loc: "/", priority: "1.0", changefreq: "daily" },
    { loc: "/products", priority: "0.9", changefreq: "daily" },
  ];

  const urls = [
    ...staticUrls.map(
      (u) => `  <url>
    <loc>${SITE_URL}${u.loc}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    ),
    ...(products || []).map(
      (p) => `  <url>
    <loc>${SITE_URL}/product/${escapeXml(p.id)}</loc>
    <lastmod>${new Date(p.updated_at).toISOString().split("T")[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
});
