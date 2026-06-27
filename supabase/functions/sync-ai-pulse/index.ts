import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Pulls real, sourced AI content from two legitimate, no-auth-required
// feeds -- never fabricated. This deliberately does NOT ask an LLM to
// "generate the latest AI news" from its own knowledge, since that would
// risk publishing hallucinated dates/facts as if they were real news.
//
// - arXiv cs.AI: actual published research papers ("the creation")
// - Hacker News: real discussion threads matching AI keywords ("the news")
//
// Runs every 6 hours via pg_cron + pg_net (see migration), fully
// automated -- no manual refresh needed. Safe to call repeatedly: it
// upserts by URL so re-running just refreshes existing entries.

const AI_KEYWORDS = ["ai", "llm", "gpt", "claude", "gemini", "openai", "anthropic", "machine learning", "neural network", "artificial intelligence"];

function parseArxivRss(xml: string) {
  const items: { title: string; url: string; summary: string; published_at: string }[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const block = m[1];
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim().replace(/\s+/g, " ");
    const url = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim();
    const summary = block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim().replace(/\s+/g, " ").slice(0, 280);
    const published = block.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim();
    if (title && url && published) {
      items.push({ title, url, summary: summary || "", published_at: published });
    }
  }
  return items;
}

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: Record<string, number> = { arxiv: 0, hn: 0 };
  const errors: string[] = [];

  try {
    const arxivRes = await fetch(
      "http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=20"
    );
    const xml = await arxivRes.text();
    const papers = parseArxivRss(xml);
    for (const p of papers) {
      const { error } = await supabase.from("ai_pulse_items").upsert(
        {
          title: p.title,
          url: p.url,
          source: "arxiv",
          category: "research",
          summary: p.summary,
          published_at: p.published_at,
        },
        { onConflict: "url" }
      );
      if (!error) results.arxiv++;
    }
  } catch (e) {
    errors.push(`arxiv: ${e.message}`);
  }

  try {
    const topIdsRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    const topIds: number[] = (await topIdsRes.json()).slice(0, 60);
    const stories = await Promise.all(
      topIds.map((id) =>
        fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((r) => r.json())
      )
    );
    for (const s of stories) {
      if (!s?.title || !s?.url) continue;
      const lower = s.title.toLowerCase();
      if (!AI_KEYWORDS.some((kw) => lower.includes(kw))) continue;
      const { error } = await supabase.from("ai_pulse_items").upsert(
        {
          title: s.title,
          url: s.url,
          source: "hn",
          category: "news",
          summary: `${s.score ?? 0} points, ${s.descendants ?? 0} comments on Hacker News`,
          published_at: new Date(s.time * 1000).toISOString(),
        },
        { onConflict: "url" }
      );
      if (!error) results.hn++;
    }
  } catch (e) {
    errors.push(`hn: ${e.message}`);
  }

  return new Response(JSON.stringify({ results, errors }), {
    headers: { "Content-Type": "application/json" },
  });
});
