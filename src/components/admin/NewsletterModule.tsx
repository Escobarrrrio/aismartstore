import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, Send, Users, CheckCircle2, Clock } from "lucide-react";

interface Campaign {
  id: string;
  subject: string;
  body_html: string;
  category_filter: string | null;
  status: string;
  recipient_count: number | null;
  sent_at: string | null;
  created_at: string;
}

const CATEGORIES = [
  { value: "", label: "Everyone" },
  { value: "ai", label: "AI & Machine Learning" },
  { value: "networking", label: "Networking" },
  { value: "computing", label: "Computing" },
  { value: "software", label: "Software & Licenses" },
];

const NewsletterModule = () => {
  const { toast } = useToast();
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [form, setForm] = useState({ subject: "", body_html: "", category_filter: "" });
  const [sending, setSending] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { count } = await supabase
      .from("newsletter_subscribers")
      .select("id", { count: "exact", head: true })
      .is("unsubscribed_at", null);
    setSubscriberCount(count || 0);

    const { data } = await supabase
      .from("newsletter_campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    setCampaigns(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreateAndSend = async () => {
    if (!form.subject || !form.body_html) {
      toast({ title: "Subject and content are required", variant: "destructive" });
      return;
    }
    const { data: campaign, error } = await supabase
      .from("newsletter_campaigns")
      .insert({
        subject: form.subject,
        body_html: form.body_html,
        category_filter: form.category_filter || null,
      })
      .select()
      .single();

    if (error || !campaign) {
      toast({ title: "Couldn't create campaign", description: error?.message, variant: "destructive" });
      return;
    }

    setSending(campaign.id);
    const { data: result, error: sendError } = await supabase.functions.invoke("send-newsletter-campaign", {
      body: { campaign_id: campaign.id },
    });
    setSending(null);

    if (sendError) {
      toast({ title: "Send failed", description: sendError.message, variant: "destructive" });
    } else if (result?.status === "skipped") {
      toast({ title: "Resend not configured", description: "Add your Resend API key in Settings first.", variant: "destructive" });
    } else {
      toast({ title: "Campaign sent", description: `Delivered to ${result?.sent ?? 0} of ${result?.total ?? 0} subscribers.` });
      setForm({ subject: "", body_html: "", category_filter: "" });
      load();
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card-flat p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/[0.06] flex items-center justify-center text-primary">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-display font-extrabold">{subscriberCount}</p>
            <p className="text-xs text-muted-foreground">Active subscribers</p>
          </div>
        </div>
        <div className="card-flat p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-secondary/[0.06] flex items-center justify-center text-secondary">
            <Mail className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-display font-extrabold">{campaigns.filter((c) => c.status === "sent").length}</p>
            <p className="text-xs text-muted-foreground">Campaigns sent</p>
          </div>
        </div>
      </div>

      <div className="card-flat p-6">
        <h3 className="font-display font-bold text-sm mb-4">Compose Campaign</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5">Subject Line</label>
            <input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Be specific -- curiosity beats generic. e.g. 'The GPU restock you asked about'"
              className="input-premium"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Send To</label>
            <select
              value={form.category_filter}
              onChange={(e) => setForm({ ...form, category_filter: e.target.value })}
              className="input-premium"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1.5">
              Targeting a category sends only to subscribers who picked it -- relevant content outperforms a generic blast to everyone.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">Content (HTML)</label>
            <textarea
              value={form.body_html}
              onChange={(e) => setForm({ ...form, body_html: e.target.value })}
              rows={8}
              placeholder="<p>Your campaign content...</p>"
              className="input-premium resize-none font-mono text-xs"
            />
          </div>
          <button
            onClick={handleCreateAndSend}
            disabled={!!sending}
            className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> {sending ? "Sending..." : "Send Campaign"}
          </button>
        </div>
      </div>

      <div className="card-flat p-6">
        <h3 className="font-display font-bold text-sm mb-4">Campaign History</h3>
        {campaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campaigns sent yet.</p>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                <div>
                  <p className="text-sm font-medium">{c.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.category_filter ? CATEGORIES.find((cat) => cat.value === c.category_filter)?.label : "Everyone"}
                    {c.recipient_count != null && ` · ${c.recipient_count} recipients`}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1 text-xs font-medium ${c.status === "sent" ? "text-[hsl(160,84%,39%)]" : "text-muted-foreground"}`}>
                  {c.status === "sent" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default NewsletterModule;
