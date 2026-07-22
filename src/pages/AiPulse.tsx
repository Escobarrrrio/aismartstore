import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import SEO from "@/components/SEO";
import {
  FlaskConical,
  Newspaper,
  ExternalLink,
  Search,
  TrendingUp,
  AlertTriangle,
  RotateCw,
  X,
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
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

const CategoryBadge = ({ category }: { category: string }) =>
  category === "research" ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-[10px] font-display font-bold shrink-0">
      <FlaskConical className="h-3 w-3" /> RESEARCH
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-display font-bold shrink-0">
      <Newspaper className="h-3 w-3" /> NEWS
    </span>
  );

/** Real per-story preview image scraped from the article's own page at
 *  sync time -- never a stock photo. Falls back to a themed gradient
 *  card (not a blank gap) if no image was found at sync time, or if it
 *  404s by the time a visitor loads the page. */
const PulseThumb = ({ src, alt, category, className }: { src: string | null; alt: string; category: string; className: string }) => {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    const Icon = category === "research" ? FlaskConical : Newspaper;
    return (
      <div className={`${className} flex items-center justify-center gradient-brand`}>
        <Icon className="h-8 w-8 text-white/70" />
      </div>
    );
  }
  return (
    <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} className={className} />
  );
};

const AiPulse = () => {
  const [items, setItems] = useState<PulseItem[]>([]);
  const [filter, setFilter] = useState<"all" | "research" | "news">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errored, setErrored] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [counts, setCounts] = useState<{ research: number; news: number } | null>(null);

  const fetchPage = (offset: number) =>
    supabase
      .from("ai_pulse_items")
      .select("*")
      .order("published_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

  const load = async () => {
    setLoading(true);
    setErrored(false);
    const [itemsRes, researchRes, newsRes] = await Promise.all([
      fetchPage(0),
      supabase.from("ai_pulse_items").select("id", { count: "exact", head: true }).eq("category", "research"),
      supabase.from("ai_pulse_items").select("id", { count: "exact", head: true }).eq("category", "news"),
    ]);
    if (itemsRes.error) {
      setErrored(true);
      setItems([]);
    } else {
      setItems(itemsRes.data || []);
      setHasMore((itemsRes.data?.length || 0) === PAGE_SIZE);
    }
    setCounts({ research: researchRes.count ?? 0, news: newsRes.count ?? 0 });
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const isBrowsingDefault = filter === "all" && !query.trim();
  const featured = isBrowsingDefault ? filtered[0] : null;
  const gridItems = featured ? filtered.slice(1) : filtered;

  const totalCount = (counts?.research ?? 0) + (counts?.news ?? 0);
  const freshest = items[0]?.published_at ?? null;

  return (
    <div className="min-h-screen">
      <SEO
        title="AI Pulse"
        description="The latest in artificial intelligence -- real research papers and news, updated automatically. From the announcement to the creation."
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

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] via-transparent to-secondary/[0.05]" />
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-bl from-primary/[0.08] to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-gradient-to-tr from-secondary/[0.06] to-transparent rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none" />

        <div className="container mx-auto px-4 py-12 md:py-16 text-center max-w-2xl relative">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-display font-semibold mb-5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
            </span>
            Live &middot; synced every 6 hours{freshest ? ` · updated ${timeAgo(freshest)}` : ""}
          </span>
          <h1 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-3">
            AI <span className="gradient-brand-text">Pulse</span>
          </h1>
          <p className="text-muted-foreground mb-7">
            The latest in artificial intelligence — from the newsroom to the research lab.
            Real papers, real discussions, no fabricated headlines.
          </p>

          {!loading && counts && (
            <div className="flex items-center justify-center gap-6 text-sm">
              <div>
                <div className="font-display font-extrabold text-lg">{totalCount.toLocaleString("en-ZA")}</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Tracked</div>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <div className="font-display font-extrabold text-lg text-secondary">{counts.research.toLocaleString("en-ZA")}</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Research</div>
              </div>
              <div className="w-px h-8 bg-border" />
              <div>
                <div className="font-display font-extrabold text-lg text-primary">{counts.news.toLocaleString("en-ZA")}</div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">News</div>
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="container mx-auto px-4 py-10">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8 items-stretch sm:items-center sm:justify-between">
          <div className="flex gap-2 justify-center sm:justify-start" aria-label="Filter AI Pulse by category">
            {([
              { key: "all", label: "All" },
              { key: "research", label: "Research" },
              { key: "news", label: "News" },
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

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search headlines and papers…"
              aria-label="Search AI Pulse"
              className="input-premium pl-10 pr-9 py-2.5 text-sm"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
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
            <AlertTriangle className="h-10 w-10 text-muted-foreground/40 mx-auto mb-4" />
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
                className="group relative block card-flat overflow-hidden mb-6 hover:shadow-elevated transition-shadow"
              >
                <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-primary/[0.07] to-transparent rounded-full blur-3xl -translate-y-1/3 translate-x-1/4 pointer-events-none" />
                <div className="relative flex flex-col md:flex-row">
                  <div className="md:w-2/5 shrink-0 bg-muted">
                    <PulseThumb
                      src={featured.image_url}
                      alt={featured.title}
                      category={featured.category}
                      className="w-full h-48 md:h-full object-cover"
                    />
                  </div>
                  <div className="p-6 md:p-8 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-foreground text-background text-[10px] font-display font-bold tracking-wide">
                        <TrendingUp className="h-3 w-3" /> LATEST
                      </span>
                      <CategoryBadge category={featured.category} />
                      <span className="text-[11px] text-muted-foreground">
                        {SOURCE_LABELS[featured.source] ?? featured.source} · {timeAgo(featured.published_at)}
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
              {gridItems.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="card-flat overflow-hidden hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-200 group flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="bg-muted">
                    <PulseThumb src={item.image_url} alt={item.title} category={item.category} className="w-full h-36 object-cover" />
                  </div>
                  <div className="p-5 flex flex-col flex-1">
                    <div className="flex items-center gap-2 mb-2.5">
                      <CategoryBadge category={item.category} />
                    </div>
                    <h3 className="font-display font-bold text-sm leading-snug mb-1.5 group-hover:text-primary transition-colors line-clamp-2">
                      {item.title}
                    </h3>
                    {item.summary && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{item.summary}</p>
                    )}
                    <div className="mt-auto flex items-center justify-between pt-3 border-t border-border/60">
                      <span className="text-[11px] text-muted-foreground">
                        {SOURCE_LABELS[item.source] ?? item.source} · {timeAgo(item.published_at)}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                </a>
              ))}
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
          Sourced automatically from arXiv (cs.AI) and Hacker News — real papers and real discussions only.
          Nothing on this page is AI-generated or fabricated.
        </p>
      </div>
    </div>
  );
};

export default AiPulse;
