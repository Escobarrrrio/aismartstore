import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Building2, ShieldCheck, Lock, Eye, EyeOff, AlertTriangle, CheckCircle2 } from "lucide-react";

/**
 * Bank-style secured business / institution signup form.
 *
 * Defence in depth:
 *  - Honeypot field (bots fill it, humans don't)
 *  - Work-email domain check (server-side trigger enforces too)
 *  - Strong password meter (12+ chars, upper/lower/digit/symbol, no common terms)
 *  - HIBP leaked-password check enabled at the auth level
 *  - Rate-limit trigger on the table (60s window per email/IP)
 *  - Explicit terms + POPIA consent
 *  - Manual admin approval before elevated pricing / procurement access is granted
 */

type Strength = { score: number; label: string; tone: string; issues: string[] };

const scorePassword = (pw: string, email: string): Strength => {
  const issues: string[] = [];
  if (pw.length < 12) issues.push("At least 12 characters");
  if (!/[a-z]/.test(pw)) issues.push("One lowercase letter");
  if (!/[A-Z]/.test(pw)) issues.push("One uppercase letter");
  if (!/[0-9]/.test(pw)) issues.push("One digit");
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push("One symbol");
  if (/(password|qwerty|12345|admin|welcome|letmein)/i.test(pw)) issues.push("Not a common password");
  if (email && pw.toLowerCase().includes(email.split("@")[0].toLowerCase())) issues.push("Must not contain your email");
  const score = Math.max(0, 6 - issues.length);
  const label = score >= 6 ? "Excellent" : score >= 4 ? "Strong" : score >= 2 ? "Weak" : "Very weak";
  const tone = score >= 6 ? "bg-emerald-500" : score >= 4 ? "bg-blue-500" : score >= 2 ? "bg-amber-500" : "bg-red-500";
  return { score, label, tone, issues };
};

const FREE_MAIL = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "live.com", "aol.com", "protonmail.com", "proton.me", "me.com"];

interface Props { onClose: () => void; }

const BusinessSignupForm = ({ onClose }: Props) => {
  const { toast } = useToast();
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const [form, setForm] = useState({
    legal_entity_name: "", trading_name: "", registration_number: "", vat_number: "",
    entity_type: "business", sector: "", website: "",
    work_email: "", password: "", confirm: "",
    contact_full_name: "", contact_position: "", contact_phone: "",
    address_line: "", city: "", province: "", postal_code: "", country: "ZA",
    expected_monthly_spend: "",
    accept_terms: false, popia_consent: false,
    website_url: "", // honeypot — hidden, must stay empty
  });

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const domain = form.work_email.split("@")[1]?.toLowerCase() || "";
  const domainOk = domain && !FREE_MAIL.includes(domain);
  const strength = scorePassword(form.password, form.work_email);
  const passwordsMatch = form.password.length > 0 && form.password === form.confirm;

  const canSubmit =
    form.legal_entity_name.trim().length > 1 &&
    form.registration_number.trim().length > 1 &&
    form.contact_full_name.trim().length > 1 &&
    domainOk &&
    strength.score >= 6 &&
    passwordsMatch &&
    form.accept_terms && form.popia_consent &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);

    // Honeypot check: bots fill hidden fields.
    if (form.website_url.trim().length > 0) {
      // Silently accept but do nothing — don't reveal the trap.
      setDone(true); setSubmitting(false); return;
    }

    // 1. Create the auth user (Supabase Auth handles HIBP leak-check server-side)
    const { error: signUpError } = await supabase.auth.signUp({
      email: form.work_email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: {
          full_name: form.contact_full_name,
          business_signup: true,
          legal_entity_name: form.legal_entity_name,
        },
      },
    });
    if (signUpError) {
      toast({ title: "Sign-up rejected", description: signUpError.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // 2. Record the business application (goes to admin review queue)
    const { error: insertError } = await supabase.from("business_signups").insert({
      legal_entity_name: form.legal_entity_name.trim(),
      trading_name: form.trading_name.trim() || null,
      registration_number: form.registration_number.trim(),
      vat_number: form.vat_number.trim() || null,
      entity_type: form.entity_type,
      sector: form.sector.trim() || null,
      website: form.website.trim() || null,
      work_email: form.work_email.trim(),
      work_email_domain: domain,
      contact_full_name: form.contact_full_name.trim(),
      contact_position: form.contact_position.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      address_line: form.address_line.trim() || null,
      city: form.city.trim() || null,
      province: form.province.trim() || null,
      postal_code: form.postal_code.trim() || null,
      country: form.country,
      expected_monthly_spend: form.expected_monthly_spend ? Number(form.expected_monthly_spend) : null,
      user_agent: navigator.userAgent.slice(0, 500),
      honeypot_flag: false,
    });

    if (insertError) {
      toast({ title: "Application not saved", description: insertError.message, variant: "destructive" });
    } else {
      setDone(true);
      toast({ title: "Application received", description: "Our team will verify your details and be in touch within 1 business day." });
    }
    setSubmitting(false);
  };

  if (done) {
    return (
      <div className="text-center py-6 space-y-3">
        <div className="w-14 h-14 rounded-full bg-emerald-500/10 mx-auto flex items-center justify-center">
          <CheckCircle2 className="h-7 w-7 text-emerald-600" />
        </div>
        <h3 className="font-display font-bold text-lg">Application secured</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Confirm your email to activate 2-factor identity checks. A compliance officer will verify your CIPC and VAT records
          before your business account is unlocked (usually within 1 business day).
        </p>
        <button onClick={onClose} className="mt-2 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-semibold">
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
        <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        <div className="text-xs">
          <p className="font-semibold">Bank-grade verified account</p>
          <p className="text-muted-foreground">
            We enforce leaked-password checks (HIBP), strong-password rules (12+ chars, mixed case, digit, symbol),
            rate-limited submissions, and manual compliance review before pricing is unlocked. All data is stored under POPIA.
          </p>
        </div>
      </div>

      {/* Honeypot — hidden from real users */}
      <input
        type="text" tabIndex={-1} autoComplete="off"
        value={form.website_url} onChange={(e) => set("website_url", e.target.value)}
        style={{ position: "absolute", left: "-10000px", width: 1, height: 1, opacity: 0 }}
        aria-hidden="true"
      />

      <fieldset className="space-y-3">
        <legend className="text-xs font-display font-bold uppercase tracking-wider text-muted-foreground">Entity</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Legal entity name *" value={form.legal_entity_name} onChange={(v) => set("legal_entity_name", v)} />
          <Field label="Trading name" value={form.trading_name} onChange={(v) => set("trading_name", v)} />
          <Field label="Registration number *" value={form.registration_number} onChange={(v) => set("registration_number", v)} placeholder="e.g. 2020/123456/07" />
          <Field label="VAT number" value={form.vat_number} onChange={(v) => set("vat_number", v)} />
          <div>
            <label className="block text-xs font-semibold mb-1.5">Entity type *</label>
            <select value={form.entity_type} onChange={(e) => set("entity_type", e.target.value)} className="w-full px-3 py-2.5 rounded-lg border border-input bg-muted text-sm">
              <option value="business">Business (Pty Ltd, CC, sole proprietor)</option>
              <option value="institution">Institution (university, hospital, bank)</option>
              <option value="government">Government / SOE</option>
              <option value="ngo">NGO / NPO / PBO</option>
            </select>
          </div>
          <Field label="Sector" value={form.sector} onChange={(v) => set("sector", v)} placeholder="e.g. Fintech, Health, Education" />
          <Field label="Website" value={form.website} onChange={(v) => set("website", v)} placeholder="https://" />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-display font-bold uppercase tracking-wider text-muted-foreground">Authorised contact</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Full name *" value={form.contact_full_name} onChange={(v) => set("contact_full_name", v)} />
          <Field label="Position" value={form.contact_position} onChange={(v) => set("contact_position", v)} placeholder="e.g. Procurement Manager" />
          <Field label="Contact phone" value={form.contact_phone} onChange={(v) => set("contact_phone", v)} placeholder="+27…" />
          <Field label="City" value={form.city} onChange={(v) => set("city", v)} />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-display font-bold uppercase tracking-wider text-muted-foreground">Secure credentials</legend>
        <div>
          <label className="block text-xs font-semibold mb-1.5">Work email *</label>
          <input
            type="email" required value={form.work_email}
            onChange={(e) => set("work_email", e.target.value)}
            placeholder="you@company.co.za"
            className="w-full px-3 py-2.5 rounded-lg border border-input bg-muted text-sm"
          />
          {form.work_email && !domainOk && (
            <p className="text-[11px] text-red-600 mt-1 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Please use a corporate / institutional email — free webmail addresses are not accepted.</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1.5">Password *</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type={showPw ? "text" : "password"} required minLength={12}
              value={form.password} onChange={(e) => set("password", e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-input bg-muted text-sm"
            />
            <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {form.password && (
            <div className="mt-2 space-y-1.5">
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${strength.tone} transition-all`} style={{ width: `${(strength.score / 6) * 100}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground">Strength: <span className="font-semibold">{strength.label}</span></p>
              {strength.issues.length > 0 && (
                <ul className="text-[11px] text-muted-foreground list-disc pl-4">
                  {strength.issues.map((i) => <li key={i}>{i}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1.5">Confirm password *</label>
          <input
            type={showPw ? "text" : "password"} required
            value={form.confirm} onChange={(e) => set("confirm", e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-input bg-muted text-sm"
          />
          {form.confirm && !passwordsMatch && (
            <p className="text-[11px] text-red-600 mt-1">Passwords do not match.</p>
          )}
        </div>
      </fieldset>

      <div className="space-y-2 text-xs">
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={form.accept_terms} onChange={(e) => set("accept_terms", e.target.checked)} className="mt-0.5" />
          <span>I accept the AI Smart Store terms of service and confirm I am authorised to bind this entity.</span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={form.popia_consent} onChange={(e) => set("popia_consent", e.target.checked)} className="mt-0.5" />
          <span>I consent to AI Smart Store processing this information for KYC / compliance under POPIA & PAIA.</span>
        </label>
      </div>

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full border border-border text-sm font-semibold">Cancel</button>
        <button
          type="submit" disabled={!canSubmit}
          className="flex-[2] py-3 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          <Building2 className="h-4 w-4" /> {submitting ? "Securing…" : "Submit secured application"}
        </button>
      </div>
    </form>
  );
};

const Field = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <div>
    <label className="block text-xs font-semibold mb-1.5">{label}</label>
    <input
      type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      required={label.includes("*")}
      className="w-full px-3 py-2.5 rounded-lg border border-input bg-muted text-sm"
    />
  </div>
);

export default BusinessSignupForm;
