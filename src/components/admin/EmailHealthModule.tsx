import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Mail, ShieldCheck } from "lucide-react";

type DomainCheck = {
  domain: string;
  spfRecord: string | null;
  dkimSelectorsFound: string[];
  dmarcRecord: string | null;
  dmarcPolicy: string | null;
  dmarcSource: "own" | "inherited" | null;
  parentDomain: string | null;
  healthy: boolean;
  issues: string[];
};

type EmailHealth = {
  fromAddress: string | null;
  domains: DomainCheck[];
  recentEmailFailures24h: number;
  unverifiedFromWarnings: Array<{ id: string; created_at: string; error_message: string | null }>;
};

const DomainCard = ({ d }: { d: DomainCheck }) => (
  <div className="bg-card border border-border rounded-xl p-4">
    <div className="flex items-center justify-between mb-3">
      <p className="font-mono text-sm font-semibold">{d.domain}</p>
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        d.healthy
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : "bg-red-50 text-red-700 border-red-200"
      }`}>
        {d.healthy ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
        {d.healthy ? "Healthy" : "Needs attention"}
      </span>
    </div>
    <div className="space-y-1.5 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">SPF</span>
        <span className={d.spfRecord ? "text-emerald-700" : "text-red-600"}>{d.spfRecord ? "Found" : "Missing"}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">DKIM</span>
        <span className={d.dkimSelectorsFound.length ? "text-emerald-700" : "text-red-600"}>
          {d.dkimSelectorsFound.length ? `Found (${d.dkimSelectorsFound.join(", ")})` : "Not found under common selectors"}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">DMARC</span>
        <span className={d.dmarcRecord ? (d.dmarcPolicy === "none" ? "text-amber-700" : "text-emerald-700") : "text-red-600"}>
          {d.dmarcRecord
            ? `p=${d.dmarcPolicy}${d.dmarcSource === "inherited" ? ` (inherited from ${d.parentDomain})` : ""}`
            : "Missing"}
        </span>
      </div>
    </div>
    {d.issues.length > 0 && (
      <ul className="mt-3 pt-3 border-t border-border space-y-1.5">
        {d.issues.map((issue, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
            {issue}
          </li>
        ))}
      </ul>
    )}
  </div>
);

const EmailHealthModule = () => {
  const [data, setData] = useState<EmailHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data: res, error } = await supabase.functions.invoke("email-health");
    if (error) setErr(error.message);
    else setData(res as EmailHealth);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="bg-card border border-border rounded-xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-display font-bold text-sm flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" />Email deliverability diagnostics</h3>
          <button onClick={load} className="px-3 py-1.5 rounded-lg border border-input bg-card text-xs font-display font-semibold flex items-center gap-1.5 hover:bg-muted">
            <RefreshCw className="h-3.5 w-3.5" /> Re-check
          </button>
        </div>
        <div className="p-5 space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Running live DNS checks…</p>
          ) : err ? (
            <p className="text-sm text-red-600">Diagnostics failed: {err}</p>
          ) : data ? (
            <>
              <p className="text-xs text-muted-foreground">
                Password reset / signup / magic-link emails always send via the auth domain below.
                Order confirmations, welcome emails, and newsletters send from{" "}
                <code className="font-mono">{data.fromAddress || "an unconfigured fallback -- set this in Settings"}</code>.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.domains.map((d) => <DomainCard key={d.domain} d={d} />)}
              </div>
              {!data.fromAddress && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  No "From Address" set in Admin → Settings → Resend. Order/welcome/newsletter emails are falling back
                  to an unverified shared address, which will land in spam. Verify a domain in your Resend dashboard,
                  then set the From Address there.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted rounded-xl p-3">
                  <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">Email failures (24h)</p>
                  <p className="text-lg font-display font-extrabold">{data.recentEmailFailures24h}</p>
                </div>
                <div className="bg-muted rounded-xl p-3">
                  <p className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-wider">Unverified-sender warnings (recent)</p>
                  <p className="text-lg font-display font-extrabold">{data.unverifiedFromWarnings.length}</p>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {data && data.unverifiedFromWarnings.length > 0 && (
        <div className="bg-card border border-border rounded-xl">
          <div className="px-5 py-4 border-b border-border flex items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <h3 className="font-display font-bold text-sm">Unverified From-address warnings</h3>
          </div>
          <div className="divide-y divide-border/50">
            {data.unverifiedFromWarnings.map((w) => (
              <div key={w.id} className="px-5 py-3 text-xs">
                <p className="text-muted-foreground">{new Date(w.created_at).toLocaleString()}</p>
                <p className="text-red-600 mt-0.5">{w.error_message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailHealthModule;
