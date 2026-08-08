import { useCallback, useEffect, useState } from "react";
import { BarChart3, Users, Eye, Globe2, Monitor, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface Row { visitors: number }
interface SourceRow extends Row { source: string }
interface PageRow extends Row { path: string }
interface DeviceRow extends Row { device_type: string }
interface CountryRow extends Row { country: string }
interface CityRow extends Row { city: string }

interface Overview {
  since: string;
  until: string;
  generated_at: string;
  total_visitors: number;
  total_pageviews: number;
  sources: SourceRow[];
  pages: PageRow[];
  devices: DeviceRow[];
  countries: CountryRow[];
  cities: CityRow[];
}

const RANGES = [
  { label: "Today", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
] as const;

const StatCard = ({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) => (
  <div className="card-flat p-5">
    <div className="w-10 h-10 rounded-xl bg-primary/[0.08] text-primary flex items-center justify-center mb-3">{icon}</div>
    <p className="font-display font-extrabold text-2xl tracking-tight">{value}</p>
    <p className="text-xs text-muted-foreground mt-1">{label}</p>
  </div>
);

/** A "Source"/"Page"/"Country" table: a two-column list ranked by visitors,
 *  each row's bar sized relative to the top row -- same visual language as
 *  the breakdown Lovable's own dashboard showed, rebuilt on our own,
 *  first-party data so it keeps working after that project goes stale. */
const BreakdownTable = <T extends Row>({
  title, icon, rows, labelKey, labelFormat,
}: {
  title: string;
  icon: React.ReactNode;
  rows: T[];
  labelKey: keyof T;
  labelFormat?: (v: string) => string;
}) => {
  const max = rows.length ? Math.max(...rows.map((r) => r.visitors)) : 0;
  return (
    <div className="card-flat overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h3 className="font-display font-bold text-sm">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">No data for this range yet.</p>
      ) : (
        <div className="divide-y divide-border/50">
          {rows.map((r, i) => {
            const label = String(r[labelKey]);
            const pct = max > 0 ? Math.round((r.visitors / max) * 100) : 0;
            return (
              <div key={`${label}-${i}`} className="relative px-5 py-2.5">
                <div
                  className="absolute inset-y-0 left-0 bg-primary/[0.06]"
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
                <div className="relative flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{labelFormat ? labelFormat(label) : label}</span>
                  <span className="font-display font-bold text-muted-foreground flex-shrink-0">{r.visitors}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const AnalyticsModule = () => {
  const { toast } = useToast();
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (days: number) => {
    setLoading(true);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data: result, error } = await supabase.rpc("admin_analytics_overview", {
      p_since: since,
      p_until: new Date().toISOString(),
    });
    setLoading(false);
    if (error) {
      toast({ title: "Couldn't load analytics", description: error.message, variant: "destructive" });
      return;
    }
    setData(result as unknown as Overview);
  }, [toast]);

  useEffect(() => { load(rangeDays); }, [rangeDays, load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border p-1 bg-card">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRangeDays(r.days)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                rangeDays === r.days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => load(rangeDays)}
          className="text-xs text-primary font-semibold hover:underline flex items-center gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Visitors" value={data?.total_visitors ?? "—"} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Pageviews" value={data?.total_pageviews ?? "—"} icon={<Eye className="h-5 w-5" />} />
        <StatCard
          label="Pages / visitor"
          value={data && data.total_visitors > 0 ? (data.total_pageviews / data.total_visitors).toFixed(1) : "—"}
          icon={<BarChart3 className="h-5 w-5" />}
        />
        <StatCard label="Countries reached" value={data?.countries.length ?? "—"} icon={<Globe2 className="h-5 w-5" />} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <BreakdownTable title="Source" icon={<Globe2 className="h-4 w-4" />} rows={data?.sources ?? []} labelKey="source" />
        <BreakdownTable title="Page" icon={<Eye className="h-4 w-4" />} rows={data?.pages ?? []} labelKey="path" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <BreakdownTable
          title="Device"
          icon={<Monitor className="h-4 w-4" />}
          rows={data?.devices ?? []}
          labelKey="device_type"
          labelFormat={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
        />
        <BreakdownTable title="Country" icon={<Globe2 className="h-4 w-4" />} rows={data?.countries ?? []} labelKey="country" />
      </div>

      <BreakdownTable title="City" icon={<Globe2 className="h-4 w-4" />} rows={data?.cities ?? []} labelKey="city" />

      <p className="text-[11px] text-muted-foreground">
        First-party analytics, tracked directly by this site (no third-party vendor) and only after a visitor
        accepts the cookie-consent banner. Country is best-effort and may read "Unknown" for some visits.
      </p>
    </div>
  );
};

export default AnalyticsModule;
