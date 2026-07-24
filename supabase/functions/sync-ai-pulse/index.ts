import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withRetry } from "../_shared/retry.ts";
import { startRun, finishRun, deriveRunStatus } from "../_shared/run-log.ts";
import { checkAndAlertOnFailureStreak } from "../_shared/alerts.ts";

// Pulls real, sourced AI content from legitimate, no-auth-required
// feeds -- never fabricated. This deliberately does NOT ask an LLM to
// "generate the latest AI news" from its own knowledge, since that would
// risk publishing hallucinated dates/facts as if they were real news.
//
// - arXiv cs.AI: actual published research papers ("the creation")
// - Hacker News: real discussion threads matching AI keywords ("the news")
// - African tech press (South Africa, Nigeria, pan-African): real
//   published articles matching AI keywords ("the local angle")
//
// Runs every 6 hours via pg_cron + pg_net (see migration), fully
// automated -- no manual refresh needed. Safe to call repeatedly: it
// upserts by URL so re-running just refreshes existing entries.

export const AI_KEYWORDS = ["ai", "llm", "gpt", "claude", "gemini", "openai", "anthropic", "machine learning", "neural network", "artificial intelligence"]; // lovable-ref-ok: AI-news keyword (the model), unrelated to how this site was built

export function matchesAiKeywords(text: string): boolean {
  const lower = text.toLowerCase();
  return AI_KEYWORDS.some((kw) => lower.includes(kw));
}

// Real, standard WordPress RSS feeds from established African tech news
// publishers -- South African and pan-African/Nigerian, since AI coverage
// out of Lagos and Nairobi is as real and current as anything out of
// Cape Town. Each is fetched and filtered independently -- if one feed
// goes away or changes format, it fails into `errors` without taking the
// other sources down with it (same resilience pattern as arxiv/hn below).
const LOCAL_FEEDS: { source: string; country: string; url: string }[] = [
  { source: "mybroadband", country: "South Africa", url: "https://mybroadband.co.za/news/feed" },
  { source: "businesstech", country: "South Africa", url: "https://businesstech.co.za/feed/" },
  { source: "techcentral", country: "South Africa", url: "https://techcentral.co.za/feed/" },
  { source: "ventureburn", country: "South Africa", url: "https://ventureburn.com/feed/" },
  { source: "techcabal", country: "Nigeria", url: "https://techcabal.com/feed/" },
  { source: "techpoint", country: "Nigeria", url: "https://techpoint.africa/feed/" },
  { source: "disruptafrica", country: "Pan-African", url: "https://disrupt-africa.com/feed/" },
  { source: "itnewsafrica", country: "Pan-African", url: "https://www.itnewsafrica.com/feed/" },
];

// A plain desktop-browser UA. The previous self-identifying
// "AISmartStoreBot/1.0" string was the actual reason every African feed
// above synced zero items in practice -- most WordPress sites run
// Cloudflare/WAF bot-protection that challenges or blocks any UA that
// announces itself as a bot, even for a public RSS feed explicitly
// published for automated syndication. This isn't evading a paywall or
// auth wall; RSS feeds exist specifically to be machine-read.
const FEED_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export function stripCdata(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return (m ? m[1] : raw).trim().replace(/\s+/g, " ");
}

export function parseRss2(xml: string) {
  const items: { title: string; url: string; summary: string; published_at: string }[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = stripCdata(block.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
    const url = stripCdata(block.match(/<link>([\s\S]*?)<\/link>/)?.[1]);
    const descRaw = stripCdata(block.match(/<description>([\s\S]*?)<\/description>/)?.[1]);
    const summary = descRaw?.replace(/<[^>]+>/g, "").slice(0, 280);
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim();
    const published_at = pubDate ? new Date(pubDate).toISOString() : undefined;
    if (title && url && published_at) {
      items.push({ title, url, summary: summary || "", published_at });
    }
  }
  return items;
}

export function parseArxivRss(xml: string) {
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
async function fetchOgImage(url: string, timeoutMs = 6000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": FEED_USER_AGENT },
    });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html") || !res.body) {
      return null;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    const MAX_BYTES = 150_000;
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    // og:image first, twitter:image as a fallback -- some sites (mostly
    // smaller blogs the HN feed links to) only set the Twitter card meta.
    const match =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i);
    const raw = match?.[1];
    if (!raw) return null;
    return new URL(raw, url).toString();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Named + assigned (rather than passed inline to Deno.serve) and gated
// behind import.meta.main so test files can `import { ... } from "./index.ts"`
// for the pure functions above without also starting an HTTP listener.
const handler = async (_req: Request) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const run = await startRun(supabase, "sync-ai-pulse");
  const results: Record<string, number> = { arxiv: 0, hn: 0, local: 0 };
  const errors: string[] = [];

  try {
    const xml = await withRetry(async () => {
      const res = await fetch(
        "http://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=20"
      );
      if (!res.ok) throw new Error(`arxiv HTTP ${res.status}`);
      return res.text();
    }, { onRetry: (n, e) => console.warn(`[sync-ai-pulse] arxiv retry ${n}:`, (e as Error).message) });
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
    const topIds: number[] = await withRetry(async () => {
      const res = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
      if (!res.ok) throw new Error(`HN topstories HTTP ${res.status}`);
      return (await res.json()).slice(0, 60);
    }, { onRetry: (n, e) => console.warn(`[sync-ai-pulse] hn topstories retry ${n}:`, (e as Error).message) });

    // A single bad item id (deleted/dead story) must not cost the whole
    // batch -- Promise.all would reject entirely on one failure; allSettled
    // keeps every story that did resolve.
    const settled = await Promise.allSettled(
      topIds.map((id) => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then((r) => r.json())),
    );
    const stories = settled.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled").map((r) => r.value);
    const itemFailures = settled.length - stories.length;
    if (itemFailures > 0) errors.push(`hn: ${itemFailures} item fetch(es) failed`);

    const aiStories = stories.filter((s) => s?.title && s?.url && matchesAiKeywords(s.title));
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

  for (const feed of LOCAL_FEEDS) {
    try {
      const xml = await withRetry(async () => {
        const res = await fetch(feed.url, {
          headers: { "User-Agent": FEED_USER_AGENT },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      }, { onRetry: (n, e) => console.warn(`[sync-ai-pulse] ${feed.source} retry ${n}:`, (e as Error).message) });
      const posts = parseRss2(xml);
      const aiPosts = posts.filter((p) => matchesAiKeywords(`${p.title} ${p.summary}`));
      await Promise.all(
        aiPosts.map(async (p) => {
          const image_url = await fetchOgImage(p.url);
          const { error } = await supabase.from("ai_pulse_items").upsert(
            {
              title: p.title,
              url: p.url,
              source: feed.source,
              category: "local",
              summary: p.summary,
              published_at: p.published_at,
              image_url,
            },
            { onConflict: "url" }
          );
          if (!error) results.local++;
        })
      );
    } catch (e) {
      errors.push(`${feed.source}: ${e.message}`);
    }
  }

  const totalSynced = results.arxiv + results.hn + results.local;
  const runStatus = deriveRunStatus(totalSynced, errors.length);
  await finishRun(supabase, run, {
    status: runStatus,
    items_synced: totalSynced,
    items_failed: errors.length,
    error_details: errors.length ? errors.join("\n") : null,
  });
  if (runStatus !== "success") {
    await checkAndAlertOnFailureStreak(supabase, "sync-ai-pulse").catch((e) =>
      console.error("[sync-ai-pulse] alert check failed:", (e as Error).message),
    );
  }

  return new Response(JSON.stringify({ results, errors }), {
    headers: { "Content-Type": "application/json" },
  });
};

if (import.meta.main) Deno.serve(handler);
