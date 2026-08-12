import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Check, Cpu, Globe, Server, Code, Loader2 } from "lucide-react";

// Keys must stay in step with the `allowed` whitelist inside the
// set_newsletter_interests SQL function -- anything else is discarded server-side.
const CATEGORIES = [
  { key: "ai", labelKey: "newsletter.topics.ai", icon: Cpu },
  { key: "networking", labelKey: "newsletter.topics.networking", icon: Globe },
  { key: "computing", labelKey: "newsletter.topics.computing", icon: Server },
  { key: "software", labelKey: "newsletter.topics.software", icon: Code },
] as const;

interface NewsletterSignupProps {
  source?: string;
  variant?: "footer" | "inline";
}

const NewsletterSignup = ({ source = "footer", variant = "footer" }: NewsletterSignupProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [subscriberCount, setSubscriberCount] = useState<number | null>(null);

  // Returned by our own INSERT. It is the proof of ownership that
  // set_newsletter_interests requires, so without it we must not pretend the
  // topic chips can be saved.
  const [subscriberId, setSubscriberId] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    // Anon cannot SELECT from newsletter_subscribers (emails are private);
    // use a security-definer RPC that only exposes the count.
    supabase.rpc("get_newsletter_subscriber_count").then(({ data }) => {
      const count = typeof data === "number" ? data : Number(data);
      if (Number.isFinite(count) && count >= 50) setSubscriberCount(count);
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // subscribe_to_newsletter, not a raw .from("newsletter_subscribers").insert().select():
    // this table has no SELECT policy for anon (only admins -- see the
    // subscriber-count comment above), and Postgres rolls back an entire
    // INSERT ... RETURNING statement, not just the RETURNING clause, when
    // the returned row fails a SELECT policy. Verified directly: every
    // real signup was leaving zero rows behind, not a hidden-but-captured
    // one -- the visitor was shown "Couldn't subscribe" and nothing was
    // saved. Same SECURITY DEFINER pattern as get_newsletter_subscriber_count
    // just above, applied to the write path this time.
    // `as never` on the RPC name: the generated types lag migrations
    // applied out of band, same pattern used elsewhere in this codebase.
    const { data, error } = await supabase.rpc("subscribe_to_newsletter" as never, {
      p_email: email,
      p_source: source,
    } as never);
    setSubmitting(false);

    if (error?.code === "23505") {
      // Already on the list. We have no subscriber id, so ownership can't be
      // proven and the topic chips are deliberately not offered rather than
      // shown as controls that silently do nothing.
      toast({ title: t("newsletter.alreadyTitle"), description: t("newsletter.alreadyBody") });
      setSubscribed(true);
      return;
    }

    const rows = data as unknown as { id: string }[] | null;
    const inserted = Array.isArray(rows) ? rows[0] : undefined;

    // Zero rows back (no error) means the BEFORE INSERT threat-gate trigger
    // quarantined this submission -- it returns NULL instead of NEW, so
    // nothing was written and the RPC has nothing to hand back.
    //
    // Shown as success on purpose. A bot that sees an error learns which
    // payloads trip the scorer and tunes against it -- the whole point of
    // quarantining rather than rejecting is that the sender is told nothing.
    // The submission is not lost: it sits in the Engine Room's quarantine,
    // where a real person misjudged by a regex can be found and released.
    if (!error && !inserted) {
      setSubscribed(true);
      return;
    }
    if (error || !inserted) {
      toast({ title: t("newsletter.errorTitle"), description: error?.message || "Please try again.", variant: "destructive" });
      return;
    }

    setSubscriberId(inserted.id);
    setSubscribed(true);
    // Welcome email is dispatched server-side by a DB trigger on insert.
  };

  const toggleCategory = async (key: string) => {
    if (!subscriberId) return;
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    const previous = selected;

    setSelected(next);
    setSavingKey(key);

    const { data, error } = await supabase.rpc("set_newsletter_interests", {
      _subscriber_id: subscriberId,
      _email: email,
      _categories: next,
    });
    setSavingKey(null);

    // Roll the chip back rather than leave it looking saved. The previous
    // version could not fail visibly at all, which is exactly how this went
    // unnoticed in production.
    if (error || data === false) {
      setSelected(previous);
      toast({
        title: t("newsletter.saveFailedTitle"),
        description: error?.message ?? t("newsletter.saveFailedBody"),
        variant: "destructive",
      });
      return;
    }
    setSavedAt(Date.now());
  };

  if (subscribed) {
    return (
      <div className={variant === "footer" ? "max-w-sm" : "max-w-md mx-auto text-center"}>
        <div className="flex items-center gap-2 text-sm font-display font-semibold text-background/90 mb-3">
          <Check className="h-4 w-4 text-[hsl(160,84%,39%)]" aria-hidden="true" />
          {subscriberId ? t("newsletter.confirmedMore") : t("newsletter.confirmed")}
        </div>

        {subscriberId && (
          <>
            <p id="newsletter-topics-label" className="text-xs text-background/75 mb-3">
              {t("newsletter.topicsPrompt")}
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="newsletter-topics-label">
              {CATEGORIES.map((c) => {
                const active = selected.includes(c.key);
                const saving = savingKey === c.key;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => toggleCategory(c.key)}
                    disabled={saving}
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors disabled:opacity-60 ${
                      active
                        ? "bg-primary border-primary text-white"
                        : "border-background/15 text-background/75 hover:border-background/30"
                    }`}
                  >
                    {saving
                      ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      : <c.icon className="h-3 w-3" aria-hidden="true" />}
                    {t(c.labelKey)}
                  </button>
                );
              })}
            </div>
            {/* Assertive so the confirmation is announced, since the only other
                signal is a colour change on the chip. */}
            <p className="mt-2 text-[11px] text-background/70 min-h-4" role="status" aria-live="polite">
              {savedAt ? t("newsletter.preferencesSaved") : ""}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={variant === "footer" ? "max-w-sm" : "max-w-md mx-auto text-center"}>
      <h5 className="font-display font-bold text-sm text-background/90 mb-1.5">{t("newsletter.heading")}</h5>
      <p className="text-xs text-background/75 mb-3 leading-relaxed">
        {t("newsletter.blurb")}
        {subscriberCount && (
          <span className="block mt-1 text-background/70">
            {t("newsletter.joinCount", { count: subscriberCount })}
          </span>
        )}
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-background/70" aria-hidden="true" />
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("newsletter.emailPlaceholder")}
            aria-label={t("newsletter.emailLabel")}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-background/[0.08] border border-background/20 text-background text-sm placeholder:text-background/70 focus:border-primary outline-none transition"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="px-4 py-2.5 rounded-lg gradient-brand text-white text-sm font-display font-semibold whitespace-nowrap disabled:opacity-50"
        >
          {submitting ? t("newsletter.subscribing") : t("newsletter.subscribe")}
        </button>
      </form>
    </div>
  );
};

export default NewsletterSignup;
