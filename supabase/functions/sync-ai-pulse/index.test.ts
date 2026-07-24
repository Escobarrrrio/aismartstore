import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stripCdata, parseRss2, parseArxivRss, matchesAiKeywords, AI_KEYWORDS } from "./index.ts";

// -------------------- stripCdata --------------------

Deno.test("stripCdata unwraps a CDATA-wrapped value and collapses whitespace", () => {
  assertEquals(stripCdata("<![CDATA[  Hello   World  ]]>"), "Hello World");
});

Deno.test("stripCdata passes through plain (non-CDATA) text unchanged aside from trimming", () => {
  assertEquals(stripCdata("  Plain title  "), "Plain title");
});

Deno.test("stripCdata returns undefined for undefined input", () => {
  assertEquals(stripCdata(undefined), undefined);
});

// -------------------- parseRss2 (MyBroadband / BusinessTech feeds) --------------------

const SAMPLE_RSS2 = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[New AI chip launches in South Africa]]></title>
    <link>https://mybroadband.co.za/news/ai-chip</link>
    <description><![CDATA[<p>A <b>local</b> AI chip story.</p>]]></description>
    <pubDate>Mon, 20 Jul 2026 08:00:00 +0200</pubDate>
  </item>
  <item>
    <title>Missing link item -- should be skipped</title>
    <description>No link, no pubDate</description>
  </item>
  <item>
    <title>Unrelated load-shedding update</title>
    <link>https://mybroadband.co.za/news/load-shedding</link>
    <description>Nothing about AI here.</description>
    <pubDate>Tue, 21 Jul 2026 09:00:00 +0200</pubDate>
  </item>
</channel></rss>`;

Deno.test("parseRss2 extracts well-formed items and strips HTML from the summary", () => {
  const items = parseRss2(SAMPLE_RSS2);
  assertEquals(items.length, 2);
  assertEquals(items[0].title, "New AI chip launches in South Africa");
  assertEquals(items[0].url, "https://mybroadband.co.za/news/ai-chip");
  assertEquals(items[0].summary, "A local AI chip story.");
  assertEquals(items[0].published_at, new Date("Mon, 20 Jul 2026 08:00:00 +0200").toISOString());
});

Deno.test("parseRss2 skips items missing a required field (link/title/pubDate)", () => {
  const items = parseRss2(SAMPLE_RSS2);
  assertEquals(items.some((i) => i.title === "Missing link item -- should be skipped"), false);
});

Deno.test("parseRss2 returns an empty array for XML with no <item> blocks", () => {
  assertEquals(parseRss2("<rss><channel></channel></rss>"), []);
});

Deno.test("parseRss2 does not throw on malformed/truncated XML", () => {
  const items = parseRss2("<rss><channel><item><title>Unterminated");
  assertEquals(items, []);
});

// -------------------- parseArxivRss --------------------

const SAMPLE_ARXIV = `<?xml version="1.0"?>
<feed>
  <entry>
    <id>https://arxiv.org/abs/2601.00001</id>
    <title>  A Study of   Neural Networks  </title>
    <summary>  This paper explores   neural nets in depth.  </summary>
    <published>2026-07-20T00:00:00Z</published>
  </entry>
  <entry>
    <title>Missing id -- should be skipped</title>
    <summary>No id, no published date</summary>
  </entry>
</feed>`;

Deno.test("parseArxivRss extracts entries and collapses internal whitespace", () => {
  const items = parseArxivRss(SAMPLE_ARXIV);
  assertEquals(items.length, 1);
  assertEquals(items[0].title, "A Study of Neural Networks");
  assertEquals(items[0].url, "https://arxiv.org/abs/2601.00001");
  assertEquals(items[0].summary, "This paper explores neural nets in depth.");
  assertEquals(items[0].published_at, "2026-07-20T00:00:00Z");
});

// -------------------- matchesAiKeywords --------------------

Deno.test("matchesAiKeywords matches on any configured keyword, case-insensitively", () => {
  assertEquals(matchesAiKeywords("OpenAI releases new GPT model"), true);
  assertEquals(matchesAiKeywords("A story about MACHINE LEARNING breakthroughs"), true);
  assertEquals(matchesAiKeywords("completely unrelated sports news"), false);
});

Deno.test("AI_KEYWORDS is non-empty and every entry is lowercase", () => {
  assertEquals(AI_KEYWORDS.length > 0, true);
  for (const kw of AI_KEYWORDS) assertEquals(kw, kw.toLowerCase());
});
