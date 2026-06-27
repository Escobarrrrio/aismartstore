import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import SEO from "@/components/SEO";
import { FlaskConical, Newspaper, ExternalLink, Sparkles } from "lucide-react";

interface PulseItem {
  id: string;
  title: string;
  url: string;
  source: string;
  category: string;
  summary: string | null;
  published_at: string | null;
}

const AiPulse = () => {
  const [items, setItems] = useState<PulseItem[]>([]);
  const [filter, setFilter] = useState<"all" | "research" | "news">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("ai_pulse_items")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(60)
      .then(({ data }) => {
        setItems(data || []);
        setLoading(false);
      });
  }, []);

  const filtered = filter === "all" ? items : items.filter((i) => i.category === filter);

  return (
    <div className="min-h-screen">
      <SEO
        title="AI Pulse"
        description="The latest in artificial intelligence -- real research papers and news, updated automatically. From the announcement to the creation."
        path="/ai-pulse"
      />

      <div className="bg-muted/50 border-b border-border">
        <div className="container mx-auto px-4 py-12 md:py-16 text-center max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-display font-semibold mb-5">
            <Sparkles className="h-3.5 w-3.5" /> Updated automatically every 6 hours
          </span>
          <h1 className="text-3xl md:text-4xl font-display font-extrabold tracking-tight mb-3">
            AI <span className="gradient-brand-text">Pulse</span>
          </h1>
          <p className="text-muted-foreground">
            The latest in artificial intelligence — from the newsroom to the research lab.
            Real papers, real discussions, no fabricated headlines.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <div className="flex gap-2 mb-8 justify-center">
          {[
            { key: "all", label: "All" },
            { key: "research", label: "Research" },
            { key: "news", label: "News" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as any)}
              className={`px-4 py-2 rounded-full text-sm font-display font-semibold transition-colors ${
                filter === f.key ? "gradient-brand text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card-flat p-5 h-32 animate-pulse bg-muted/50" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground font-display font-semibold">
              Nothing here yet — the first sync runs shortly.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="card-flat p-5 hover:shadow-elevated transition-shadow group"
              >
                <div className="flex items-center gap-2 mb-2.5">
                  {item.category === "research" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/10 text-secondary text-[10px] font-display font-bold">
                      <FlaskConical className="h-3 w-3" /> RESEARCH
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-display font-bold">
                      <Newspaper className="h-3 w-3" /> NEWS
                    </span>
                  )}
                  {item.published_at && (
                    <span className="text-[11px] text-muted-foreground">
                      {new Date(item.published_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                    </span>
                  )}
                </div>
                <h3 className="font-display font-bold text-sm leading-snug mb-1.5 group-hover:text-primary transition-colors line-clamp-2">
                  {item.title}
                </h3>
                {item.summary && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>
                )}
                <span className="inline-flex items-center gap-1 text-[11px] text-primary mt-3 font-medium">
                  Read more <ExternalLink className="h-3 w-3" />
                </span>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AiPulse;
