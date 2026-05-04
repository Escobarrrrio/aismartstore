import { Zap, Search, CheckCircle, XCircle, Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const AutomationsModule = () => {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEvents = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("automation_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setEvents(data || []);
    setLoading(false);
  };

  useEffect(() => { loadEvents(); }, []);

  const statusIcon = (status: string) => {
    if (status === "completed" || status === "success") return <CheckCircle className="h-4 w-4 text-[hsl(160,84%,39%)]" />;
    if (status === "failed" || status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-[hsl(38,92%,50%)]" />;
  };

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Make Pro and automation event history</p>

      <div className="card-flat overflow-hidden">
        <table className="w-full table-premium">
          <thead>
            <tr>
              {["Event Type", "Source", "Status", "Error", "Date"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((e: any) => (
              <tr key={e.id}>
                <td className="font-semibold">{e.event_type}</td>
                <td className="capitalize">{e.source}</td>
                <td>
                  <div className="flex items-center gap-2">
                    {statusIcon(e.status)}
                    <span className={e.status === "completed" || e.status === "success" ? "badge-success" : e.status === "failed" || e.status === "error" ? "badge-danger" : "badge-warning"}>
                      {e.status}
                    </span>
                  </div>
                </td>
                <td className="text-xs text-muted-foreground max-w-[200px] truncate">{e.error_message || "—"}</td>
                <td className="text-muted-foreground text-xs">{new Date(e.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">
                <Zap className="h-8 w-8 mx-auto mb-2 text-muted-foreground/30" />
                No automation events yet. Events will appear when Make Pro workflows are triggered.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const LoadingSkeleton = () => (
  <div className="space-y-4 animate-pulse">
    <div className="h-5 bg-muted rounded w-64" />
    <div className="card-flat overflow-hidden">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-border/50 last:border-none">
          <div className="flex-1 space-y-2"><div className="h-3.5 bg-muted rounded w-1/4" /></div>
        </div>
      ))}
    </div>
  </div>
);

export default AutomationsModule;
