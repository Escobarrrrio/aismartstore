import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail, Building2, User, Home as HomeIcon, IdCard, Phone } from "lucide-react";
import Logo from "@/components/Logo";
import { useTranslation } from "react-i18next";
import SEO from "@/components/SEO";

type AccountType = "residential" | "business";

// SA ID validation: exactly 13 digits. The database also enforces uniqueness
// across all profiles regardless of customer_type, so someone can't hold both
// a residential and a business account under the same ID number.
const isValidSaId = (id: string) => /^\d{13}$/.test(id.trim());

// Detect the "one account per person" unique constraint violations coming back
// from Postgres so we can show a friendly, actionable message instead of a
// raw error like `duplicate key value violates unique constraint ...`.
const isUniqueConstraint = (err: unknown): { field: string } | null => {
  const msg =
    typeof err === "object" && err && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : String(err ?? "");
  const lower = msg.toLowerCase();
  if (!lower.includes("duplicate") && !lower.includes("unique")) return null;
  if (lower.includes("id_number")) return { field: "ID number" };
  if (lower.includes("phone")) return { field: "phone number" };
  if (lower.includes("vat")) return { field: "VAT number" };
  return { field: "detail" };
};

const Auth = () => {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [accountType, setAccountType] = useState<AccountType | null>(null);

  // Shared fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Signup-only fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [vatNotRegistered, setVatNotRegistered] = useState(false);

  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  const resetSignupFields = () => {
    setName(""); setPhone(""); setIdNumber("");
    setCompanyName(""); setVatNumber(""); setVatNotRegistered(false);
  };

  const handleSignIn = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast({ title: t("auth.loginFailedTitle"), description: error.message, variant: "destructive" });
    } else {
      toast({ title: t("auth.welcomeBackToast"), description: t("auth.signedInToast") });
      navigate("/");
    }
  };

  const handleForgot = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      toast({ title: t("auth.errorTitle"), description: error.message, variant: "destructive" });
    } else {
      toast({ title: t("auth.checkEmailTitle"), description: t("auth.resetEmailSent") });
      setMode("signin");
    }
  };

  const handleSignUp = async () => {
    if (!accountType) {
      toast({
        title: "Choose an account type",
        description: "Please select Residential or Business / Government to continue.",
        variant: "destructive",
      });
      return;
    }
    if (!isValidSaId(idNumber)) {
      toast({
        title: "Invalid South African ID number",
        description: "Your SA ID number must be exactly 13 digits.",
        variant: "destructive",
      });
      return;
    }
    if (!name.trim() || !phone.trim()) {
      toast({
        title: "Missing details",
        description: "Full name and phone number are required.",
        variant: "destructive",
      });
      return;
    }
    if (accountType === "business") {
      if (!companyName.trim()) {
        toast({
          title: "Company name required",
          description: "Business and government accounts must provide the registered entity name.",
          variant: "destructive",
        });
        return;
      }
      if (!vatNotRegistered && !vatNumber.trim()) {
        toast({
          title: "VAT number required",
          description: "Enter your VAT number, or tick 'not yet registered' if applicable.",
          variant: "destructive",
        });
        return;
      }
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth`,
        data: {
          full_name: name.trim(),
          customer_type: accountType,
        },
      },
    });
    if (error) {
      toast({ title: t("auth.signUpFailedTitle"), description: error.message, variant: "destructive" });
      return;
    }

    // Populate profile fields not covered by the auth trigger. The DB has
    // unique constraints on id_number, phone and vat_number that span every
    // profile — surface those as a friendly "one account per person" message.
    const userId = data.user?.id;
    if (userId) {
      const profilePayload: Record<string, unknown> = {
        customer_type: accountType,
        name: name.trim(),
        phone: phone.trim(),
        id_number: idNumber.trim(),
      };
      if (accountType === "business") {
        profilePayload.company_name = companyName.trim();
        profilePayload.vat_number = vatNotRegistered ? null : vatNumber.trim();
      }
      const { error: profileErr } = await supabase
        .from("profiles")
        .update(profilePayload)
        .eq("user_id", userId);
      if (profileErr) {
        const dup = isUniqueConstraint(profileErr);
        if (dup) {
          toast({
            title: "Account already exists",
            description: `This ${dup.field} is already registered to an account. Each person or business may only hold one account. Please log in instead, or contact support if you believe this is an error.`,
            variant: "destructive",
          });
          // Roll back the auth session so they aren't left half-signed-up.
          await supabase.auth.signOut();
          return;
        }
        toast({
          title: "Signup partially completed",
          description: profileErr.message,
          variant: "destructive",
        });
        return;
      }
    }

    toast({ title: t("auth.checkEmailTitle"), description: t("auth.confirmEmailSent") });
    setMode("signin");
    resetSignupFields();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "forgot") await handleForgot();
      else if (mode === "signin") await handleSignIn();
      else await handleSignUp();
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "forgot" ? t("auth.resetPassword")
      : mode === "signin" ? t("auth.welcomeBack")
      : accountType === null ? "Create your account"
      : accountType === "residential" ? "Create a residential account"
      : "Register a business or government entity";

  return (
    <div
      className="min-h-[80vh] flex items-center justify-center px-4 py-10"
      style={{ background: "linear-gradient(135deg, hsl(var(--muted)), hsl(270 30% 95%))" }}
    >
      <SEO title={title} description="Sign in or register with AI Smart Store." noindex />
      <div className={`w-full ${mode === "signup" && accountType === "business" ? "max-w-2xl" : "max-w-md"} bg-card rounded-2xl border border-border shadow-elevated p-8`}>
        <div className="flex justify-center mb-7">
          <Logo size={48} asLink={false} />
        </div>

        <h2 className="font-display font-extrabold text-2xl text-center mb-1">{title}</h2>
        <p className="text-muted-foreground text-sm text-center mb-6">
          {mode === "forgot"
            ? t("auth.resetHint")
            : mode === "signin"
            ? t("auth.signInHint")
            : accountType === null
            ? "Pick the account type that describes you. This can't be changed later without contacting support."
            : accountType === "residential"
            ? "For households, students and personal shoppers."
            : "For companies, government departments, NGOs and institutions."}
        </p>

        {/* Sign in / Sign up tabs */}
        {mode !== "forgot" && (
          <div className="flex bg-muted rounded-lg p-0.5 mb-6">
            <button
              type="button"
              onClick={() => { setMode("signin"); setAccountType(null); }}
              className={`flex-1 py-2 rounded-md font-display font-semibold text-sm transition-all ${mode === "signin" ? "bg-card text-foreground shadow-card" : "text-muted-foreground"}`}
            >
              {t("auth.signIn")}
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`flex-1 py-2 rounded-md font-display font-semibold text-sm transition-all ${mode === "signup" ? "bg-card text-foreground shadow-card" : "text-muted-foreground"}`}
            >
              {t("auth.signUp")}
            </button>
          </div>
        )}

        {/* Account type gate — no default, no skip */}
        {mode === "signup" && accountType === null && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setAccountType("residential")}
              className="w-full flex items-start gap-4 p-5 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/[0.03] transition text-left"
            >
              <HomeIcon className="h-8 w-8 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-display font-bold text-base">Residential</p>
                <p className="text-xs text-muted-foreground mt-1">
                  I'm shopping for my home, family, or personal use. Curated AI, computing and creator gear priced for households.
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setAccountType("business")}
              className="w-full flex items-start gap-4 p-5 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/[0.03] transition text-left"
            >
              <Building2 className="h-8 w-8 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-display font-bold text-base">Business / Government</p>
                <p className="text-xs text-muted-foreground mt-1">
                  I'm procuring for a company, government department, NGO or institution. Unlocks the enterprise catalogue, net-terms and the compliance pack.
                </p>
              </div>
            </button>
            <p className="text-[11px] text-muted-foreground pt-2 text-center">
              Each South African ID number and phone number may only be linked to one account.
            </p>
          </div>
        )}

        {/* Actual form */}
        {(mode === "signin" || mode === "forgot" || (mode === "signup" && accountType !== null)) && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && accountType && (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted text-xs">
                <span>
                  Signing up as{" "}
                  <span className="font-semibold text-foreground">
                    {accountType === "residential" ? "Residential" : "Business / Government"}
                  </span>
                </span>
                <button type="button" onClick={() => setAccountType(null)} className="text-primary font-semibold hover:underline">
                  Change
                </button>
              </div>
            )}

            {mode === "signup" && (
              <>
                <FieldWithIcon icon={User} label="Full name" value={name} onChange={setName} placeholder="Jane Doe" required />
                {accountType === "business" && (
                  <>
                    <FieldWithIcon icon={Building2} label="Registered company / entity name" value={companyName} onChange={setCompanyName} placeholder="Acme (Pty) Ltd" required />
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">VAT number</label>
                      <input
                        type="text"
                        value={vatNumber}
                        onChange={(e) => setVatNumber(e.target.value)}
                        disabled={vatNotRegistered}
                        placeholder="4XXXXXXXXX"
                        className="w-full px-4 py-2.5 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card focus:ring-2 focus:ring-secondary/10 outline-none transition text-sm disabled:opacity-50"
                      />
                      <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vatNotRegistered}
                          onChange={(e) => setVatNotRegistered(e.target.checked)}
                          className="accent-primary"
                        />
                        Not yet registered for VAT
                      </label>
                    </div>
                  </>
                )}
                <FieldWithIcon icon={Phone} label="Phone number" value={phone} onChange={setPhone} placeholder="+27 82 123 4567" type="tel" required />
                <FieldWithIcon icon={IdCard} label="South African ID number (13 digits)" value={idNumber} onChange={(v) => setIdNumber(v.replace(/\D/g, "").slice(0, 13))} placeholder="0000000000000" required />
              </>
            )}

            <FieldWithIcon icon={Mail} label={t("auth.email")} value={email} onChange={setEmail} placeholder="you@example.com" type="email" required />

            {mode !== "forgot" && (
              <FieldWithIcon icon={Lock} label={t("auth.password")} value={password} onChange={setPassword} placeholder="••••••••" type="password" required minLength={6} />
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
            >
              {loading
                ? t("auth.pleaseWait")
                : mode === "forgot"
                ? t("auth.sendResetLink")
                : mode === "signin"
                ? t("auth.signIn")
                : t("auth.createAccount")}
            </button>
          </form>
        )}

        {mode === "signin" && (
          <p className="text-center text-xs text-muted-foreground mt-3">
            <button type="button" onClick={() => setMode("forgot")} className="text-secondary font-semibold hover:underline">
              {t("auth.forgotPassword")}
            </button>
          </p>
        )}

        {mode === "forgot" && (
          <p className="text-center text-xs text-muted-foreground mt-5">
            <button type="button" onClick={() => setMode("signin")} className="text-secondary font-semibold hover:underline">
              {t("auth.backToSignIn")}
            </button>
          </p>
        )}
      </div>
    </div>
  );
};

// Small helper to keep the form JSX flat & consistent.
const FieldWithIcon = ({
  icon: Icon, label, value, onChange, placeholder, type = "text", required, minLength,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  minLength?: number;
}) => (
  <div>
    <label className="block text-xs font-semibold mb-1.5">{label}</label>
    <div className="relative">
      <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card focus:ring-2 focus:ring-secondary/10 outline-none transition text-sm"
      />
    </div>
  </div>
);

export default Auth;
