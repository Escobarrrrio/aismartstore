import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Check, Cpu, Globe, Server, Code } from "lucide-react";

const CATEGORIES = [
  { key: "ai", label: "AI & Machine Learning", icon: Cpu },
  { key: "networking", label: "Networking", icon: Globe },
  { key: "computing", label: "Computing", icon: Server },
  { key: "software", label: "Software & Licenses", icon: Code },
];

interface NewsletterSignupProps {
  source?: string;
  variant?: "footer" | "inline";
}

const NewsletterSignup = ({ source = "footer", variant = "footer" }: NewsletterSignupProps) => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("newsletter_subscribers")
      .select("id", { count: "exact", head: true })
      .then(({ count }) => {
        if (count && count >= 50) setSubscriberCount(count);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.from("newsletter_subscribers").insert({ email, source });
    setSubmitting(false);
    if (error) {
      if (error.code === "23505") {
        toast({ title: "Already subscribed", description: "That email's already on the list." });
        setSubscribed(true);
        return;
      }
      toast({ title: "Something went wrong", description: error.message, variant: "destructive" });
      return;
    }
    setSubscribed(true);
    supabase.functions.invoke("send-welcome-email", { body: { email, categories: [] } });
  };

  const toggleCategory = async (key: string) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    setSelected(next);
    await supabase.from("newsletter_subscribers").update({ interested_categories: next }).eq("email", email);
  };

  if (subscribed) {
    return (
      <div className={variant === "footer" ? "max-w-sm" : "max-w-md mx-auto text-center"}>
        <div className="flex items-center gap-2 text-sm font-display font-semibold text-background/90 mb-3">
          <Check className="h-4 w-4 text-[hsl(160,84%,39%)]" /> You're in. One more thing —
        </div>
        <p className="text-xs text-background/40 mb-3">
          What should we tell you about first? (optional, takes 5 seconds)
        </p>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => toggleCategory(c.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                selected.includes(c.key)
                  ? "bg-primary border-primary text-white"
                  : "border-background/15 text-background/50 hover:border-background/30"
              }`}
            >
              <c.icon className="h-3 w-3" /> {c.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={variant === "footer" ? "max-w-sm" : "max-w-md mx-auto text-center"}>
      <h5 className="font-display font-bold text-sm text-background/90 mb-1.5">Be first to know</h5>
      <p className="text-xs text-background/40 mb-3 leading-relaxed">
        New AI hardware drops, price changes, and early access to limited stock — before they hit the catalogue page.
        {subscriberCount && (
          <span className="block mt-1 text-background/30">Join {subscriberCount.toLocaleString()} subscribers.</span>
        )}
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-background/30" />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-background/[0.06] border border-background/10 text-background text-sm placeholder:text-background/30 focus:border-primary/50 outline-none transition"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2.5 rounded-lg gradient-brand text-white text-sm font-display font-semibold whitespace-nowrap disabled:opacity-50"
        >
          {submitting ? "..." : "Subscribe"}
        </button>
      </form>
    </div>
  );
};

export default NewsletterSignup;
