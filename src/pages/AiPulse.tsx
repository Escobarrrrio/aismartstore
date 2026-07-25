import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import SEO from "@/components/SEO";
import {
  FlaskConical,
  Newspaper,
  Radio,
  ExternalLink,
  Search,
  AlertTriangle,
  RotateCw,
  X,
  Clock,
} from "lucide-react";

interface PulseItem {
  id: string;
  title: string;
  url: string;
  source: string;
  category: string;
  summary: string | null;
  published_at: string | null;
  image_url: string | null;
}

const PAGE_SIZE = 30;

const SOURCE_LABELS: Record<string, string> = {
  arxiv: "arXiv",
  hn: "Hacker News",
  mybroadband: "MyBroadband",
  businesstech: "BusinessTech",
  techcentral: "TechCentral",
  ventureburn: "Ventureburn",
  techcabal: "TechCabal",
  techpoint: "Techpoint Africa",
  disruptafrica: "Disrupt Africa",
  itnewsafrica: "IT News Africa",
};

// Purely cosmetic context for the "Africa" category cards -- which country
// desk each publisher writes from. Not stored in the DB (it's a static
// property of the source, not per-article data); this is the single
// source of truth for it.
const SOURCE_COUNTRY: Record<string, string> = {
  mybroadband: "South Africa",
  businesstech: "South Africa",
  techcentral: "South Africa",
  ventureburn: "South Africa",
  techcabal: "Nigeria",
  techpoint: "Nigeria",
  disruptafrica: "Pan-African",
  itnewsafrica: "Pan-African",
};

const CATEGORY_META: Record<string, { label: string; short: string; icon: typeof FlaskConical; accent: string }> = {
  research: { label: "Research", short: "RESEARCH", icon: FlaskConical, accent: "hsl(var(--secondary))" },
  news: { label: "News", short: "NEWS", icon: Newspaper, accent: "hsl(var(--primary))" },
  // Darker than the site's --success token (160 84% 39%, ~2.6:1 on white --
  // fine as a badge fill but not as standalone text/icon color) so it
  // clears WCAG AA on its own here.
  local: { label: "Africa", short: "AFRICA", icon: Radio, accent: "hsl(160 84% 28%)" },
};

// Common English words to exclude from the trending-keyword extraction --
// without this, "the", "for", "with" would dominate every run since
// they're frequent in headlines regardless of subject.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was",
  "were", "be", "been", "at", "by", "from", "as", "it", "its", "this", "that", "new", "how", "why",
  "what", "into", "your", "you", "we", "will", "can", "not", "no", "than", "more", "most", "up",
  "out", "about", "after", "over", "just", "now", "says", "show", "hn", "ai",
]);

function timeAgo(iso: string | null, now: number): string {
  if (!iso) return "";
  const diffMs = now - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

/** Rough reading time from real content length -- never a fabricated
 *  number, just word-count-at-200wpm over the title + summary we actually
 *  have on file for this item. */
function readingTime(title: string, summary: string | null): string {
  const words = (title.length + (summary?.length ?? 0)) / 5;
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

function extractTrending(items: PulseItem[], limit = 8): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const words = item.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
    const seen = new Set<string>();
    for (const w of words) {
      if (seen.has(w)) continue; // count each word once per headline, not once per occurrence
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

// Text stays on the theme's high-contrast foreground token rather than the
// raw accent hue, which doesn't reliably clear WCAG AA's 4.5:1 for text
// this small against a light background either. The accent color still
// carries the category coding via the icon (icons only need 3:1) and the
// background tint.
const CategoryTag = ({ category, className = "" }: { category: string; className?: string }) => {
  const meta = CATEGORY_META[category] ?? CATEGORY_META.news;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-display font-bold tracking-wide shrink-0 text-foreground ${className}`}
      style={{ backgroundColor: `color-mix(in srgb, ${meta.accent} 18%, transparent)` }}
    >
      <Icon className="h-3 w-3" style={{ color: meta.accent }} /> {meta.short}
    </span>
  );
};

/** Real per-story preview image scraped from the article's own page at
 *  sync time -- never a stock photo. Falls back to a plain, solid
 *  category-accented "no photo on file" block (not a rainbow gradient,
 *  not a fake image) when none was found, or if it 404s by the time a
 *  visitor loads the page. */
const PulseThumb = ({ src, alt, category, sourceLabel, className }: { src: string | null; alt: string; category: string; sourceLabel: string; className: string }) => {
  const [failed, setFailed] = useState(false);
  const meta = CATEGORY_META[category] ?? CATEGORY_META.news;
  const Icon = meta.icon;
  if (!src || failed) {
    return (
      <div
        className={`${className} flex flex-col items-center justify-center gap-1.5 bg-muted relative overflow-hidden`}
      >
        <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundColor: meta.accent }} />
        <Icon className="h-6 w-6 relative" style={{ color: meta.accent }} />
        <span className="text-[10px] font-display font-bold uppercase tracking-widest text-muted-foreground relative">{sourceLabel}</span>
      </div>
    );
  }
  return (
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={`${className} object-top`} />
  );
};

const AiPulse = () => {
  const [items, setItems] = useState<PulseItem[]>([]);
  const [filter, setFilter] = useState<"all" | "research" | "news" | "local">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errored, setErrored] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [counts, setCounts] = useState<{ research: number; news: number; local: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);

  // Ticks the masthead clock and every relative "Xm ago" timestamp on the
  // page -- a real live clock, not a static render-time snapshot.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchPage = (offset: number) =>
    supabase
      .from("ai_pulse_items")
      .select("*")
      .order("published_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

  const load = async () => {
    setLoading(true);
    setErrored(false);
    const [itemsRes, researchRes, newsRes, localRes] = await Promise.all([
      fetchPage(0),
      supabase.from("ai_pulse_items").select("id", { count: "exact", head: true }).eq("category", "research"),
      supabase.from("ai_pulse_items").select("id", { count: "exact", head: true }).eq("category", "news"),
      supabase.from("ai_pulse_items").select("id", { count: "exact", head: true }).eq("category", "local"),
    ]);
    if (itemsRes.error) {
      setErrored(true);
      setItems([]);
    } else {
      setItems(itemsRes.data || []);
      setHasMore((itemsRes.data?.length || 0) === PAGE_SIZE);
    }
    setCounts({ research: researchRes.count ?? 0, news: newsRes.count ?? 0, local: localRes.count ?? 0 });
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1/2/3/4 jump between category filters, "/" jumps to search -- same
  // convention as most real newsroom/reader products (Gmail, Superhuman,
  // HN itself). Ignored while typing in a field so it never hijacks input.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (typing) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "1") setFilter("all");
      else if (e.key === "2") setFilter("research");
      else if (e.key === "3") setFilter("news");
      else if (e.key === "4") setFilter("local");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    const { data, error } = await fetchPage(items.length);
    if (!error && data) {
      setItems((prev) => [...prev, ...data]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  };

  const filtered = useMemo(() => {
    let list = filter === "all" ? items : items.filter((i) => i.category === filter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (i) => i.title.toLowerCase().includes(q) || i.summary?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, filter, query]);

  const trending = useMemo(() => extractTrending(items), [items]);
  const ticker = useMemo(() => items.slice(0, 10), [items]);

  const isBrowsingDefault = filter === "all" && !query.trim();
  const featured = isBrowsingDefault ? filtered[0] : null;
  const gridItems = featured ? filtered.slice(1) : filtered;

  const totalCount = (counts?.research ?? 0) + (counts?.news ?? 0) + (counts?.local ?? 0);
  const freshest = items[0]?.published_at ?? null;

  const clockStr = new Date(now).toLocaleTimeString("en-ZA", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = new Date(now).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SEO
        title="AI Pulse"
        description="The AI Pulse wire -- real research papers and news from arXiv, Hacker News and African tech press, updated automatically. Nothing fabricated."
        path="/ai-pulse"
        ogType="article"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "AI Pulse — AI research & news",
          description: "Automatically curated AI research papers and news articles.",
          url: "https://aismartstore.co.za/ai-pulse",
          hasPart: filtered.slice(0, 20).map((i) => ({
            "@type": "Article",
            headline: i.title,
            url: i.url,
            datePublished: i.published_at || undefined,
            articleSection: i.category,
            publisher: { "@type": "Organization", name: SOURCE_LABELS[i.source] ?? i.source },
          })),
        }}
      />

      {/* Masthead */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-2.5 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
            </span>
            <span className="uppercase tracking-widest font-semibold text-foreground/80">Live wire</span>
            <span className="hidden sm:inline">· synced every 6h{freshest ? ` · last item ${timeAgo(freshest, now)}` : ""}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden md:inline">{dateStr}</span>
            <span className="tabular-nums" aria-label="Current time">{clockStr}</span>
          </div>
        </div>

        <div className="gradient-subtle">
        <div className="container mx-auto px-4 py-8 md:py-10 border-t border-border/60">
          <h1 className="text-4xl md:text-6xl font-display font-black tracking-tight mb-3 gradient-brand-text inline-block">AI Pulse</h1>
          <p className="text-muted-foreground max-w-2xl mb-6">
            Research papers, product news and the African tech desk — pulled straight from the source,
            every six hours. Real bylines, real timestamps, nothing generated.
          </p>

          {!loading && counts && (
            <div className="flex items-center gap-6 text-sm border-t border-border/60 pt-5 flex-wrap">
              <div>
                <div className="font-display font-extrabold text-lg tabular-nums">{totalCount.toLocaleString("en-ZA")}</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Tracked</div>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <div className="font-display font-extrabold text-lg tabular-nums" style={{ color: CATEGORY_META.research.accent }}>
                  {counts.research.toLocaleString("en-ZA")}
                </div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Research</div>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <div className="font-display font-extrabold text-lg tabular-nums" style={{ color: CATEGORY_META.news.accent }}>
                  {counts.news.toLocaleString("en-ZA")}
                </div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">News</div>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <div className="font-display font-extrabold text-lg tabular-nums" style={{ color: CATEGORY_META.local.accent }}>
                  {counts.local.toLocaleString("en-ZA")}
                </div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Africa</div>
              </div>
            </div>
          )}
        </div>
        </div>
      </header>

      {/* Breaking ticker -- the freshest headlines, auto-scrolling, real data */}
      {ticker.length > 0 && (
        <div className="border-b border-border bg-muted/30 overflow-hidden group" role="marquee" aria-label="Latest headlines">
          <div className="flex items-stretch">
            <span className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 gradient-brand text-white text-[11px] font-display font-bold uppercase tracking-widest z-10">
              Latest
            </span>
            <div className="overflow-hidden flex-1">
              <div className="flex items-center gap-10 py-2.5 pl-6 whitespace-nowrap animate-ticker group-hover:[animation-play-state:paused] motion-reduce:animate-none motion-reduce:overflow-x-auto">
                {[...ticker, ...ticker].map((item, i) => (
                  <a
                    key={`${item.id}-${i}`}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-foreground/80 hover:text-primary transition-colors inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                  >
                    <span className="font-mono text-muted-foreground">{timeAgo(item.published_at, now)}</span>
                    {item.title}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 py-8">
        {/* Trending keywords -- computed live from the headlines actually on screen */}
        {trending.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-6 pb-6 border-b border-border/60">
            <span className="text-[11px] font-display font-bold uppercase tracking-widest text-muted-foreground shrink-0">Trending</span>
            {trending.map(({ word, count }) => (
              <button
                key={word}
                type="button"
                onClick={() => setQuery(word)}
                className="px-2.5 py-1 rounded-full border border-border text-xs font-medium text-foreground/80 hover:border-primary hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {word} <span className="text-muted-foreground">({count})</span>
              </button>
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8 items-stretch sm:items-center sm:justify-between">
          <div className="flex gap-2 justify-center sm:justify-start" aria-label="Filter AI Pulse by category">
            {([
              { key: "all", label: "All" },
              { key: "research", label: "Research" },
              { key: "news", label: "News" },
              { key: "local", label: "Africa" },
            ] as const).map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`px-4 py-2 rounded-full text-sm font-display font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  filter === f.key ? "gradient-brand text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search headlines and papers…"
              aria-label="Search AI Pulse"
              className="w-full pl-10 pr-16 py-2.5 rounded-full border border-input bg-muted/60 text-foreground text-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary focus:bg-background placeholder:text-muted-foreground"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="absolute right-3.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded border border-border bg-background text-[10px] font-mono text-muted-foreground pointer-events-none">
                /
              </kbd>
            )}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="card-flat p-5 h-36 animate-pulse bg-muted/50" />
            ))}
          </div>
        ) : errored ? (
          <div className="text-center py-16">
            <AlertTriangle className="h-10 w-10 text-muted-foreground/60 mx-auto mb-4" />
            <p className="font-display font-semibold mb-1">Couldn't load AI Pulse right now</p>
            <p className="text-sm text-muted-foreground mb-5">Something went wrong fetching the latest research and news.</p>
            <button onClick={load} className="btn-secondary px-5 py-2.5 text-sm font-semibold mx-auto">
              <RotateCw className="h-4 w-4" /> Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground font-display font-semibold">
              {query.trim()
                ? `No results for "${query.trim()}"`
                : items.length === 0
                ? "Nothing here yet — the first sync runs shortly."
                : `No ${filter} items yet.`}
            </p>
          </div>
        ) : (
          <>
            {featured && (
              <a
                href={featured.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative block border border-border overflow-hidden mb-6 hover:border-foreground/30 transition-colors"
              >
                <div className="relative flex flex-col md:flex-row">
                  <div className="md:w-2/5 shrink-0 bg-muted">
                    <PulseThumb
                      src={featured.image_url}
                      alt={featured.title}
                      category={featured.category}
                      sourceLabel={SOURCE_LABELS[featured.source] ?? featured.source}
                      className="w-full h-48 md:h-full object-cover"
                    />
                  </div>
                  <div className="p-6 md:p-8 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="inline-flex items-center px-2 py-0.5 gradient-brand text-white text-[10px] font-display font-bold tracking-widest">
                        LATEST
                      </span>
                      <CategoryTag category={featured.category} />
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {SOURCE_LABELS[featured.source] ?? featured.source}
                        {SOURCE_COUNTRY[featured.source] ? ` · ${SOURCE_COUNTRY[featured.source]}` : ""} · {timeAgo(featured.published_at, now)}
                      </span>
                    </div>
                    <h2 className="font-display font-extrabold text-xl md:text-2xl leading-snug mb-2 group-hover:text-primary transition-colors">
                      {featured.title}
                    </h2>
                    {featured.summary && (
                      <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl line-clamp-3">
                        {featured.summary}
                      </p>
                    )}
                    <span className="inline-flex items-center gap-1.5 text-sm text-primary mt-4 font-semibold">
                      Read the full {featured.category === "research" ? "paper" : "story"} <ExternalLink className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              </a>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {gridItems.map((item) => {
                const meta = CATEGORY_META[item.category] ?? CATEGORY_META.news;
                return (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border border-border overflow-hidden hover:border-foreground/30 transition-colors group flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ borderLeftWidth: "3px", borderLeftColor: meta.accent }}
                  >
                    <div className="bg-muted">
                      <PulseThumb
                        src={item.image_url}
                        alt={item.title}
                        category={item.category}
                        sourceLabel={SOURCE_LABELS[item.source] ?? item.source}
                        className="w-full h-36 object-cover"
                      />
                    </div>
                    <div className="p-5 flex flex-col flex-1">
                      <div className="flex items-center gap-2 mb-2.5">
                        <CategoryTag category={item.category} />
                      </div>
                      <h3 className="font-display font-bold text-sm leading-snug mb-1.5 group-hover:text-primary transition-colors line-clamp-2">
                        {item.title}
                      </h3>
                      {item.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{item.summary}</p>
                      )}
                      <div className="mt-auto flex items-center justify-between gap-2 pt-3 border-t border-border/60">
                        <span className="text-[11px] text-muted-foreground font-mono truncate">
                          {SOURCE_LABELS[item.source] ?? item.source}
                          {SOURCE_COUNTRY[item.source] ? ` · ${SOURCE_COUNTRY[item.source]}` : ""} · {timeAgo(item.published_at, now)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                          <Clock className="h-3 w-3" /> {readingTime(item.title, item.summary)}
                        </span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>

            {hasMore && isBrowsingDefault && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="btn-secondary px-6 py-3 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </>
        )}

        <p className="text-center text-[11px] text-muted-foreground mt-12 max-w-lg mx-auto">
          Sourced automatically from arXiv (cs.AI), Hacker News, and South African and pan-African tech
          press. Nothing on this page is AI-generated or fabricated — every headline links to its
          original source.
        </p>
      </div>
    </div>
  );
};

export default AiPulse;
