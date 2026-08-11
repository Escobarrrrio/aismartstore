import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Mail, ShieldCheck, Copy, Check } from "lucide-react";

type ResendDnsRecord = {
  record: string;
  name: string;
  type: string;
  ttl: string;
  status: string;
  value: string;
  priority?: number;
};

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
  resendRecords: ResendDnsRecord[] | null;
};

type EmailHealth = {
  fromAddress: string | null;
  domains: DomainCheck[];
  recentEmailFailures24h: number;
  unverifiedFromWarnings: Array<{ id: string; created_at: string; error_message: string | null }>;
};

/** A DNS record's value copied straight from Resend's own API -- exactly
 *  what the domain needs, so fixing this is paste-into-Cloudflare, not
 *  hunt-through-a-dashboard. Click-to-copy since these values are long
 *  and typo-prone (DKIM values especially, often 200+ characters). */
const CopyableValue = ({ value }: { value: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="w-full flex items-start gap-1.5 text-left rounded-md bg-muted/60 hover:bg-muted px-2 py-1.5 font-mono text-[10px] break-all"
      title="Click to copy"
    >
      <span className="flex-1 break-all">{value}</span>
      {copied ? <Check className="h-3 w-3 text-emerald-600 shrink-0 mt-0.5" /> : <Copy className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />}
    </button>
  );
};

const ResendRecordsPanel = ({ records }: { records: ResendDnsRecord[] }) => (
  <div className="mt-3 pt-3 border-t border-border space-y-2.5">
    <p className="text-[11px] font-semibold text-muted-foreground">
      Exact records Resend expects for this domain — add these in Cloudflare DNS:
    </p>
    {records.map((r, i) => (
      <div key={i} className="rounded-lg border border-border p-2.5 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold">{r.record} ({r.type})</span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
            r.status === "verified"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          }`}>
            {r.status === "verified" ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
            {r.status}
          </span>
        </div>
        <div className="grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1 text-[10px]">
          <span className="text-muted-foreground pt-1.5">Name</span>
          <CopyableValue value={r.name} />
          <span className="text-muted-foreground pt-1.5">Value</span>
          <CopyableValue value={r.value} />
        </div>
      </div>
    ))}
  </div>
);

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
    {d.resendRecords && d.resendRecords.length > 0 && <ResendRecordsPanel records={d.resendRecords} />}
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
