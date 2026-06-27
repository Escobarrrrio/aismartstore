import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Landmark, Building2, HardHat, Mail, Phone } from "lucide-react";

interface QuoteRequest {
  id: string;
  organisation_name: string;
  entity_type: string;
  contact_name: string;
  email: string;
  phone: string | null;
  requirements: string;
  estimated_value: number | null;
  status: string;
  created_at: string;
}

const ENTITY_ICONS: Record<string, any> = { government: Landmark, private: Building2, contractor: HardHat, other: Building2 };

const QuotesModule = () => {
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.from("quote_requests").select("*").order("created_at", { ascending: false });
    setQuotes(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("quote_requests").update({ status }).eq("id", id);
    load();
  };

  if (loading) return <p className="text-sm text-muted-foreground">Loading...</p>;

  return (
    <div className="max-w-3xl space-y-3">
      {quotes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No quote requests yet.</p>
      ) : (
        quotes.map((q) => {
          const Icon = ENTITY_ICONS[q.entity_type] || Building2;
          return (
            <div key={q.id} className="card-flat p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/[0.06] flex items-center justify-center text-primary flex-shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-display font-bold text-sm">{q.organisation_name}</p>
                    <p className="text-xs text-muted-foreground">{q.contact_name} · {q.entity_type}</p>
                  </div>
                </div>
                <select
                  value={q.status}
                  onChange={(e) => updateStatus(q.id, e.target.value)}
                  className="text-xs px-2 py-1 rounded-md border border-border bg-card"
                >
                  <option value="new">New</option>
                  <option value="quoted">Quoted</option>
                  <option value="won">Won</option>
                  <option value="lost">Lost</option>
                </select>
              </div>
              <p className="text-sm text-muted-foreground mt-3">{q.requirements}</p>
              <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
                <a href={`mailto:${q.email}`} className="flex items-center gap-1 hover:text-primary"><Mail className="h-3 w-3" /> {q.email}</a>
                {q.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {q.phone}</span>}
                {q.estimated_value && <span>Est. R{q.estimated_value.toLocaleString()}</span>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default QuotesModule;
