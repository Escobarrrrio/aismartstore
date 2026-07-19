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

/**
 * Best-effort og:image scrape of the article's own page -- a real preview
 * image for that specific story, never a stock/fabricated placeholder.
 * Bounded read (stop at </head> or 100KB) and a hard timeout so one slow
 * or hostile site can't stall the whole sync. Returns null on any failure,
 * which the UI treats as "no image" rather than something broken.
 */
async function fetchOgImage(url: string, timeoutMs = 4000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AISmartStoreBot/1.0; +https://aismartstore.co.za)" },
    });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html") || !res.body) {
      return null;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    const MAX_BYTES = 100_000;
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const raw = match?.[1];
    if (!raw) return null;
    return new URL(raw, url).toString();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    await Promise.all(
      papers.map(async (p) => {
        const image_url = await fetchOgImage(p.url);
        const { error } = await supabase.from("ai_pulse_items").upsert(
          {
            title: p.title,
            url: p.url,
            source: "arxiv",
            category: "research",
            summary: p.summary,
            published_at: p.published_at,
            image_url,
          },
          { onConflict: "url" }
        );
        if (!error) results.arxiv++;
      })
    );
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
    const aiStories = stories.filter((s) => {
      if (!s?.title || !s?.url) return false;
      const lower = s.title.toLowerCase();
      return AI_KEYWORDS.some((kw) => lower.includes(kw));
    });
    await Promise.all(
      aiStories.map(async (s) => {
        const image_url = await fetchOgImage(s.url);
        const { error } = await supabase.from("ai_pulse_items").upsert(
          {
            title: s.title,
            url: s.url,
            source: "hn",
            category: "news",
            summary: `${s.score ?? 0} points, ${s.descendants ?? 0} comments on Hacker News`,
            published_at: new Date(s.time * 1000).toISOString(),
            image_url,
          },
          { onConflict: "url" }
        );
        if (!error) results.hn++;
      })
    );
  } catch (e) {
    errors.push(`hn: ${e.message}`);
  }

  return new Response(JSON.stringify({ results, errors }), {
    headers: { "Content-Type": "application/json" },
  });
});
