import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Building2, CheckCircle2, XCircle, ShieldCheck, RefreshCw } from "lucide-react";

type Signup = {
  id: string;
  legal_entity_name: string;
  trading_name: string | null;
  registration_number: string;
  vat_number: string | null;
  entity_type: string;
  sector: string | null;
  website: string | null;
  work_email: string;
  work_email_domain: string;
  contact_full_name: string;
  contact_position: string | null;
  contact_phone: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  status: string;
  created_at: string;
};

const STATUS_TONES: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-700",
  verified: "bg-blue-500/10 text-blue-700",
  approved: "bg-emerald-500/10 text-emerald-700",
  rejected: "bg-red-500/10 text-red-700",
};

const BusinessSignupsModule = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const load = async () => {
    setLoading(true);
    let q = supabase.from("business_signups").select("*").order("created_at", { ascending: false }).limit(300);
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) toast({ title: "Load failed", description: error.message, variant: "destructive" });
    else setRows((data || []) as Signup[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from("business_signups")
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
    else { toast({ title: `Marked ${status}` }); load(); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="font-display font-extrabold text-xl">Business & Institution Signups</h2>
          <p className="text-xs text-muted-foreground">Bank-grade verified applications. Manually approve after checking CIPC / VAT records.</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {["all", "pending", "verified", "approved", "rejected"].map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize ${filter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
          >{s}</button>
        ))}
      </div>

      <div className="card-flat overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Reg / VAT</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-6"><div className="h-3 bg-muted rounded animate-pulse" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">No signups match.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t border-border/50 align-top hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-sm">{r.legal_entity_name}</p>
                    {r.trading_name && <p className="text-xs text-muted-foreground">t/a {r.trading_name}</p>}
                    <p className="text-[11px] text-muted-foreground mt-0.5">{r.city ? `${r.city}, ` : ""}{r.province || r.country}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-semibold">{r.contact_full_name}</p>
                    <p className="text-muted-foreground">{r.contact_position || "—"}</p>
                    <p className="text-muted-foreground">{r.work_email}</p>
                    {r.contact_phone && <p className="text-muted-foreground">{r.contact_phone}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p><span className="text-muted-foreground">Reg:</span> {r.registration_number}</p>
                    <p><span className="text-muted-foreground">VAT:</span> {r.vat_number || "—"}</p>
                    {r.website && <a className="text-secondary underline" href={r.website} target="_blank" rel="noreferrer noopener">{r.website}</a>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted font-semibold capitalize">
                      <ShieldCheck className="h-3 w-3" />{r.entity_type}
                    </span>
                    {r.sector && <p className="text-muted-foreground mt-1">{r.sector}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${STATUS_TONES[r.status] || "bg-muted"}`}>{r.status}</span>
                    <p className="text-[10px] text-muted-foreground mt-1">{new Date(r.created_at).toLocaleDateString()}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      {r.status !== "verified" && (
                        <button onClick={() => updateStatus(r.id, "verified")} className="p-1.5 rounded hover:bg-blue-500/10 text-blue-600" title="Mark verified">
                          <ShieldCheck className="h-4 w-4" />
                        </button>
                      )}
                      {r.status !== "approved" && (
                        <button onClick={() => updateStatus(r.id, "approved")} className="p-1.5 rounded hover:bg-emerald-500/10 text-emerald-600" title="Approve">
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      {r.status !== "rejected" && (
                        <button onClick={() => updateStatus(r.id, "rejected")} className="p-1.5 rounded hover:bg-red-500/10 text-red-600" title="Reject">
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BusinessSignupsModule;
