import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail, Building2, User, Home as HomeIcon, IdCard, Wand2, MessageCircle } from "lucide-react";
import { isValidPhoneNumber, type CountryCode } from "libphonenumber-js";
import Logo from "@/components/Logo";
import PasswordToggleButton from "@/components/PasswordToggleButton";
import PhoneInput, { detectDefaultCountry, toE164 } from "@/components/PhoneInput";
import { generateStrongPassword, estimatePasswordStrength } from "@/lib/password";
import { useTranslation } from "react-i18next";
import SEO from "@/components/SEO";

// Google's official four-color "G" mark. Not in lucide-react (icons only,
// no brand logos), so inlined here as the standard SVG paths Google
// publishes for this exact purpose.
const GoogleGlyph = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.9-2.26 5.36-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.94 23.94 0 0 0 0 24c0 3.87.92 7.53 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.82l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.97 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

type AccountType = "residential" | "business";

// WhatsApp Business fallback for phone verification when SMS isn't
// available (non-+27 numbers -- see the otpNotSaNumber gate). wa.me wants
// digits only, no "+".
const WHATSAPP_BUSINESS_NUMBER = "27630939881";

// SA ID validation: exactly 13 digits. The database also enforces uniqueness
// across all profiles regardless of customer_type, so someone can't hold both
// a residential and a business account under the same ID number.
export const isValidSaId = (id: string) => /^\d{13}$/.test(id.trim());

// SA VAT number: SARS assigns 10 digits starting with a 4.
// (Ref: SARS VAT101 registration.) We accept spaces/dashes in the raw input
// but validate the stripped digits.
export const isValidVat = (vat: string) => /^4\d{9}$/.test(vat.replace(/[\s-]/g, ""));

// Detect the "one account per person" unique constraint violations coming back
// from Postgres so we can show a friendly, actionable message instead of a
// raw error like `duplicate key value violates unique constraint ...`.
export const isUniqueConstraint = (err: unknown): { field: string } | null => {
  const msg =
    typeof err === "object" && err && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : String(err ?? "");
  const lower = msg.toLowerCase();
  if (!lower.includes("duplicate") && !lower.includes("unique") && !lower.includes("23505")) return null;
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
  // `phone` holds the national-format number as typed; the country selector
  // is tracked separately so it works for any country, not just SA -- see
  // PhoneInput/toE164 for the conversion to a storable E.164 string.
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(() => detectDefaultCountry());
  const [idNumber, setIdNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [vatNumber, setVatNumber] = useState("");
  const [vatNotRegistered, setVatNotRegistered] = useState(false);

  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [googleLoading, setGoogleLoading] = useState(false);
  // Set once a Google sign-in lands and their profile has no confirmed
  // audience yet (a brand-new OAuth signup, or one that never finished this
  // step). Manual email/password signups already enforce "no default, no
  // skip" for account type -- this extends the same rule to OAuth, since
  // profiles.customer_type otherwise silently defaults to 'individual'.
  const [oauthAccountTypeGate, setOauthAccountTypeGate] = useState(false);
  // Two-step OAuth completion: pick account type, then supply the phone
  // number manual signup already requires. Google never gives us a phone,
  // and orders/couriers need one to reach the customer, so this closes the
  // gap where a Google sign-up could otherwise finish with phone = NULL.
  const [oauthType, setOauthType] = useState<AccountType | null>(null);
  const [oauthPhone, setOauthPhone] = useState("");
  const [oauthPhoneCountry, setOauthPhoneCountry] = useState<CountryCode>(() => detectDefaultCountry());
  const [oauthPhoneError, setOauthPhoneError] = useState("");

  // Mandatory phone verification (Telnyx SMS OTP) -- the last step of both
  // signup paths before the account is usable. `otpGate` tracks which flow
  // to resume once the code is accepted; `otpAfterVerifySession` only
  // matters for the signup path, where it decides whether the final state
  // is "signed in" or "check your email" (see handleSignUp).
  const [otpGate, setOtpGate] = useState<"signup" | "oauth" | null>(null);
  const [otpUserId, setOtpUserId] = useState("");
  const [otpPhoneE164, setOtpPhoneE164] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpAfterVerifySession, setOtpAfterVerifySession] = useState(false);
  // SMS OTP is SA-only (+27) to protect the Telnyx promo balance -- other
  // numbers land on a fallback screen instead of ever hitting Telnyx.
  const [otpNotSaNumber, setOtpNotSaNumber] = useState(false);
  // Mirrors the server-side 60s cooldown in send-phone-otp so the resend
  // button can't be spammed client-side either; ticks down once a second.
  const [otpResendCooldown, setOtpResendCooldown] = useState(0);
  useEffect(() => {
    if (otpResendCooldown <= 0) return;
    const id = setInterval(() => setOtpResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [otpResendCooldown]);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { t } = useTranslation();

  // Safe redirect target — only allow internal same-origin paths so this can't
  // be abused as an open redirect. Falls back to "/" when missing/invalid.
  const rawRedirect = searchParams.get("redirect");
  const redirectTo = rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
    ? rawRedirect
    : "/";

  const resetSignupFields = () => {
    setName(""); setPhone(""); setIdNumber("");
    setCompanyName(""); setVatNumber(""); setVatNotRegistered(false);
  };

  const handleSignIn = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Supabase blocks sign-in with this exact message when the account's
      // email hasn't been confirmed yet -- rather than leaving the person
      // stuck (their original confirmation link may have expired, or never
      // arrived), fire a fresh one immediately so "resend" isn't a dead end
      // buried behind a support request.
      if (error.message === "Email not confirmed") {
        await supabase.auth.resend({ type: "signup", email });
        toast({
          title: "Confirm your email to sign in",
          description: `We've sent a fresh confirmation link to ${email}. Please check your inbox (and spam folder).`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("auth.loginFailedTitle"), description: error.message, variant: "destructive" });
    } else {
      toast({ title: t("auth.welcomeBackToast"), description: t("auth.signedInToast") });
      navigate(redirectTo);
    }
  };

  // Only reacts to Google sign-ins (checked via app_metadata.provider) so
  // the existing, already-tested email/password flows above are completely
  // untouched by this.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== "SIGNED_IN") return;
      const provider = session?.user?.app_metadata?.provider;
      if (provider !== "google" || !session?.user?.id) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("customer_type")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (profile?.customer_type === "residential" || profile?.customer_type === "business") {
        toast({ title: t("auth.welcomeBackToast"), description: t("auth.signedInToast") });
        navigate(redirectTo);
      } else {
        setOauthAccountTypeGate(true);
      }
    });
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth${rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? `?redirect=${encodeURIComponent(rawRedirect)}` : ""}`,
      },
    });
    if (error) {
      toast({ title: t("auth.loginFailedTitle"), description: error.message, variant: "destructive" });
      setGoogleLoading(false);
    }
    // On success the browser navigates away to Google, so no further local
    // state update is needed here.
  };

  const handleOauthPhoneSubmit = async () => {
    if (!oauthType) return;
    if (!oauthPhone.trim()) {
      setOauthPhoneError("Phone number is required.");
      return;
    }
    const oauthE164 = toE164(oauthPhoneCountry, oauthPhone);
    if (!oauthE164) {
      setOauthPhoneError("Enter a valid, complete phone number.");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;
    setLoading(true);
    const { error } = await supabase
      .from("profiles")
      .update({ customer_type: oauthType, phone: oauthE164 })
      .eq("user_id", userId);
    setLoading(false);
    if (error) {
      const dup = isUniqueConstraint(error);
      if (dup) {
        toast({
          title: "Account already exists",
          description: `This ${dup.field} is already registered to an account. Each person may only hold one account. Please log in instead, or contact support if you believe this is an error.`,
          variant: "destructive",
        });
        await supabase.auth.signOut();
        setOauthAccountTypeGate(false);
        setOauthType(null);
        setOauthPhone("");
        return;
      }
      toast({ title: t("auth.errorTitle"), description: error.message, variant: "destructive" });
      return;
    }
    await startPhoneVerification(userId, oauthE164, "oauth");
  };

  /** Sends a fresh SMS OTP for `phoneE164` and opens the code-entry gate --
   *  unless the number isn't South African, in which case Telnyx is never
   *  called at all and the email-fallback screen opens instead (protects
   *  the Telnyx promo balance from international SMS pricing).
   *  `context` decides what completeOtpGate does once this step clears. */
  const startPhoneVerification = async (userId: string, phoneE164: string, context: "signup" | "oauth") => {
    setOtpUserId(userId);
    setOtpPhoneE164(phoneE164);
    setOtpCode("");
    setOtpError("");

    if (!phoneE164.startsWith("+27")) {
      setOtpNotSaNumber(true);
      setOtpGate(context);
      return;
    }
    setOtpNotSaNumber(false);

    setOtpSending(true);
    const { data, error } = await supabase.functions.invoke("send-phone-otp", { body: { user_id: userId, phone: phoneE164 } });
    setOtpSending(false);
    if (error) {
      const retryAfterSecs = (data as { retryAfterSecs?: number } | null)?.retryAfterSecs;
      toast({
        title: "Couldn't send verification code",
        description: retryAfterSecs
          ? `Please wait ${retryAfterSecs}s before requesting another code.`
          : "Please check the number and try again, or contact support if this keeps happening.",
        variant: "destructive",
      });
      if (retryAfterSecs) setOtpResendCooldown(retryAfterSecs);
      return;
    }
    setOtpResendCooldown(60);
    setOtpGate(context);
  };

  /** Shared completion for both signup paths, whether the phone was
   *  actually SMS-verified or waved through via the SA-only fallback. */
  const completeOtpGate = () => {
    const finishedGate = otpGate;
    setOtpGate(null);
    setOtpNotSaNumber(false);
    setOtpCode("");

    if (finishedGate === "oauth") {
      setOauthAccountTypeGate(false);
      setOauthType(null);
      setOauthPhone("");
      toast({ title: t("auth.welcomeBackToast"), description: t("auth.signedInToast") });
      navigate(redirectTo);
    } else if (finishedGate === "signup") {
      resetSignupFields();
      if (otpAfterVerifySession) {
        toast({ title: t("auth.welcomeBackToast"), description: t("auth.signedInToast") });
        navigate(redirectTo);
      } else {
        toast({ title: t("auth.checkEmailTitle"), description: t("auth.confirmEmailSent") });
        setMode("signin");
      }
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode.trim()) {
      setOtpError("Enter the code you received by SMS.");
      return;
    }
    setOtpVerifying(true);
    const { data, error } = await supabase.functions.invoke("verify-phone-otp", {
      body: { user_id: otpUserId, phone: otpPhoneE164, code: otpCode.trim() },
    });
    setOtpVerifying(false);
    if (error || !(data as { success?: boolean } | null)?.success) {
      setOtpError("That code is incorrect or has expired. Request a new one and try again.");
      return;
    }
    completeOtpGate();
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
    setFieldErrors({});
    if (!accountType) {
      toast({
        title: "Choose an account type",
        description: "Please select Residential or Business / Government to continue.",
        variant: "destructive",
      });
      return;
    }

    // Field-level validation — each error is attached to the specific input
    // so users see exactly what to fix, without needing to read a toast.
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Full name is required.";
    if (!phone.trim()) errs.phone = "Phone number is required.";
    else if (!isValidPhoneNumber(phone, phoneCountry)) errs.phone = "Enter a valid, complete phone number.";
    if (accountType === "business") {
      // A South African ID number is sensitive personal information --
      // reserved for entities of private or public interest (business,
      // government, NGO, institutional accounts), where identifying the
      // accountable individual behind the account is warranted. Not
      // collected from ordinary residential shoppers at all.
      if (!idNumber.trim()) errs.idNumber = "SA ID number is required.";
      else if (!isValidSaId(idNumber)) errs.idNumber = `ID number must be exactly 13 digits (you entered ${idNumber.trim().length}).`;
      if (!companyName.trim()) errs.companyName = "Registered company / entity name is required.";
      if (!vatNotRegistered) {
        if (!vatNumber.trim()) errs.vatNumber = "Enter your VAT number, or tick 'not yet registered'.";
        else if (!isValidVat(vatNumber)) errs.vatNumber = "SA VAT numbers are 10 digits starting with 4 (e.g. 4123456789).";
      }
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      toast({
        title: "Please fix the highlighted fields",
        description: "Some details need attention before we can create your account.",
        variant: "destructive",
      });
      return;
    }

    // Everything the signup form collects goes into signUp()'s own metadata
    // rather than a separate post-signup `.from("profiles").update()` --
    // handle_new_user() (a SECURITY DEFINER trigger) writes it straight into
    // profiles from here, which works with or without an active session.
    // That matters because signUp() no longer returns one immediately when
    // "Confirm email required" is on: a follow-up client-side update would
    // run as the `anon` role, which has no UPDATE policy on profiles at all.
    const phoneE164 = toE164(phoneCountry, phone) ?? phone.trim();
    const metadata: Record<string, unknown> = {
      full_name: name.trim(),
      customer_type: accountType,
      phone: phoneE164,
    };
    if (accountType === "business") {
      // ID number is only ever collected for business/government accounts
      // -- sending an empty string for residential signups (rather than
      // omitting the key) would store "" instead of NULL, which would
      // then falsely collide under the id_number uniqueness constraint
      // the moment a second residential shopper also left it blank.
      metadata.id_number = idNumber.trim();
      metadata.company_name = companyName.trim();
      metadata.vat_number = vatNotRegistered ? null : vatNumber.trim();
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth${rawRedirect && rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? `?redirect=${encodeURIComponent(rawRedirect)}` : ""}`,
        data: metadata,
      },
    });
    if (error) {
      // The id_number/phone/vat_number uniqueness constraints live on
      // profiles, which handle_new_user() writes to inside the same
      // transaction as the auth.users insert -- a violation there surfaces
      // here as signUp()'s own error instead of a separate follow-up call.
      const dup = isUniqueConstraint(error);
      if (dup) {
        toast({
          title: "Account already exists",
          description: `This ${dup.field} is already registered to an account. Each person or business may only hold one account. Please log in instead, or contact support if you believe this is an error.`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: t("auth.signUpFailedTitle"), description: error.message, variant: "destructive" });
      return;
    }

    const userId = data.user?.id;
    if (!userId) return;

    // Whether email confirmation is actually required is a Supabase Auth
    // project setting, not something this form controls -- signUp() returns
    // a live session immediately when it's off, and null when a confirm
    // link was sent first. Stashed here so handleVerifyOtp can reflect
    // whichever is really true once the phone step (below) also clears.
    setOtpAfterVerifySession(!!data.session);
    await startPhoneVerification(userId, phoneE164, "signup");
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

  // Mandatory phone verification -- the last step of both signup paths.
  // Takes priority over the OAuth account-type gate below since it only
  // ever opens once that gate (or manual signup) has already run.
  if (otpGate) {
    return (
      <div
        className="min-h-[80vh] flex items-center justify-center px-4 py-10"
        style={{ background: "linear-gradient(135deg, hsl(var(--muted)), hsl(270 30% 95%))" }}
      >
        <SEO title="Verify your phone" description="One last step to finish creating your account." noindex />
        <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-elevated p-8">
          <div className="flex justify-center mb-7">
            <Logo size={48} asLink={false} />
          </div>
          {otpNotSaNumber ? (
            <>
              <h2 className="font-display font-extrabold text-2xl text-center mb-1">SMS verification unavailable</h2>
              <p className="text-muted-foreground text-sm text-center mb-6">
                SMS verification is currently restricted to South African (+27) numbers. Please verify your
                account via email instead — we'll email you a confirmation link the moment you continue.
              </p>
              <button
                type="button"
                onClick={completeOtpGate}
                data-testid="otp-fallback-continue"
                className="w-full py-3 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity"
              >
                Continue with email verification
              </button>
              <a
                href={`https://wa.me/${WHATSAPP_BUSINESS_NUMBER}?text=${encodeURIComponent(
                  `Hi, I'd like to verify my phone number for my AI Smart Store account.\nPhone: ${otpPhoneE164}${email ? `\nAccount email: ${email}` : ""}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="otp-fallback-whatsapp"
                className="mt-3 w-full py-3 rounded-full border border-border text-sm font-display font-semibold flex items-center justify-center gap-2 hover:bg-muted transition-colors"
              >
                <MessageCircle className="h-4 w-4" /> Verify via WhatsApp instead
              </a>
            </>
          ) : (
            <>
              <h2 className="font-display font-extrabold text-2xl text-center mb-1">Verify your phone</h2>
              <p className="text-muted-foreground text-sm text-center mb-6">
                We sent a 6-digit code by SMS to <span className="font-semibold text-foreground">{otpPhoneE164}</span>.
                Enter it below to finish creating your account.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); handleVerifyOtp(); }} className="space-y-4" data-testid="phone-otp-gate">
                <div>
                  <label className="block text-xs font-semibold mb-1.5">Verification code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={otpCode}
                    onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 8)); setOtpError(""); }}
                    placeholder="123456"
                    autoFocus
                    aria-invalid={!!otpError}
                    data-testid="phone-otp-code"
                    className={`w-full px-4 py-3 rounded-lg border bg-muted text-foreground text-center text-2xl font-display font-bold tracking-[0.3em] focus:bg-card focus:ring-2 outline-none transition ${
                      otpError
                        ? "border-destructive focus:border-destructive focus:ring-destructive/20"
                        : "border-input focus:border-secondary focus:ring-secondary/10"
                    }`}
                  />
                  {otpError && <p role="alert" className="text-[11px] text-destructive mt-1">{otpError}</p>}
                </div>
                <button
                  type="submit"
                  disabled={otpVerifying}
                  className="w-full py-3 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {otpVerifying ? t("auth.pleaseWait") : "Verify and continue"}
                </button>
                <button
                  type="button"
                  disabled={otpSending || otpResendCooldown > 0}
                  onClick={() => startPhoneVerification(otpUserId, otpPhoneE164, otpGate)}
                  className="w-full text-center text-xs text-muted-foreground hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {otpSending
                    ? "Sending…"
                    : otpResendCooldown > 0
                    ? `Resend code in ${otpResendCooldown}s`
                    : "Didn't get it? Resend code"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    );
  }

  // Signed in via Google, but their account has no confirmed audience yet --
  // same "no default, no skip" gate manual signup enforces, applied once.
  if (oauthAccountTypeGate) {
    return (
      <div
        className="min-h-[80vh] flex items-center justify-center px-4 py-10"
        style={{ background: "linear-gradient(135deg, hsl(var(--muted)), hsl(270 30% 95%))" }}
      >
        <SEO title="Choose your account type" description="One last step to finish signing in." noindex />
        <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-elevated p-8">
          <div className="flex justify-center mb-7">
            <Logo size={48} asLink={false} />
          </div>
          <h2 className="font-display font-extrabold text-2xl text-center mb-1">One last step</h2>
          <p className="text-muted-foreground text-sm text-center mb-6">
            {oauthType === null
              ? "Pick the account type that describes you. This can't be changed later without contacting support."
              : "We need a phone number to reach you about your orders."}
          </p>
          {oauthType === null ? (
            <div className="space-y-3" data-testid="oauth-account-type-gate">
              <button
                type="button"
                disabled={loading}
                onClick={() => setOauthType("residential")}
                className="w-full flex items-start gap-4 p-5 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/[0.03] transition text-left disabled:opacity-50"
              >
                <HomeIcon className="h-8 w-8 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-display font-bold text-base">Residential</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    I'm shopping for my home, family, or personal use.
                  </p>
                </div>
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => setOauthType("business")}
                className="w-full flex items-start gap-4 p-5 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/[0.03] transition text-left disabled:opacity-50"
              >
                <Building2 className="h-8 w-8 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-display font-bold text-base">Business / Government</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    I'm procuring for a company, government department, NGO or institution.
                  </p>
                </div>
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); handleOauthPhoneSubmit(); }}
              className="space-y-4"
              data-testid="oauth-phone-gate"
            >
              <PhoneInput
                country={oauthPhoneCountry}
                onCountryChange={setOauthPhoneCountry}
                nationalNumber={oauthPhone}
                onNationalNumberChange={(v) => { setOauthPhone(v); setOauthPhoneError(""); }}
                error={oauthPhoneError}
                testId="oauth-phone"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {loading ? t("auth.pleaseWait") : "Continue"}
              </button>
              <button
                type="button"
                onClick={() => { setOauthType(null); setOauthPhone(""); setOauthPhoneError(""); }}
                className="w-full text-center text-xs text-muted-foreground hover:underline"
              >
                Change account type
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

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

        {/* Google sign-in — same button for both sign in and sign up; Google
            tells us which one it actually is. */}
        {mode !== "forgot" && (
          <>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/60 transition-colors text-sm font-semibold disabled:opacity-50 mb-4"
            >
              <GoogleGlyph className="h-4 w-4" />
              {googleLoading ? "Redirecting…" : "Continue with Google"}
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

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
          <div className="space-y-3" data-testid="account-type-gate">
            <button
              type="button"
              data-testid="account-type-residential"
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
              data-testid="account-type-business"
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
                <FieldWithIcon icon={User} label="Full name" value={name} onChange={setName} placeholder="Jane Doe" required error={fieldErrors.name} testId="signup-name" />
                {accountType === "business" && (
                  <>
                    <FieldWithIcon icon={Building2} label="Registered company / entity name" value={companyName} onChange={setCompanyName} placeholder="Acme (Pty) Ltd" required error={fieldErrors.companyName} testId="signup-company" />
                    <div>
                      <label className="block text-xs font-semibold mb-1.5">VAT number</label>
                      <input
                        type="text"
                        value={vatNumber}
                        onChange={(e) => setVatNumber(e.target.value)}
                        disabled={vatNotRegistered}
                        placeholder="4XXXXXXXXX"
                        aria-invalid={!!fieldErrors.vatNumber}
                        data-testid="signup-vat"
                        className={`w-full px-4 py-2.5 rounded-lg border bg-muted text-foreground focus:bg-card focus:ring-2 outline-none transition text-sm disabled:opacity-50 ${
                          fieldErrors.vatNumber
                            ? "border-destructive focus:border-destructive focus:ring-destructive/20"
                            : "border-input focus:border-secondary focus:ring-secondary/10"
                        }`}
                      />
                      {fieldErrors.vatNumber && (
                        <p role="alert" className="text-[11px] text-destructive mt-1">{fieldErrors.vatNumber}</p>
                      )}
                      <label className="flex items-center gap-2 mt-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vatNotRegistered}
                          onChange={(e) => { setVatNotRegistered(e.target.checked); if (e.target.checked) setFieldErrors((p) => ({ ...p, vatNumber: "" })); }}
                          className="accent-primary"
                        />
                        Not yet registered for VAT
                      </label>
                    </div>
                    <FieldWithIcon icon={IdCard} label="South African ID number (13 digits)" value={idNumber} onChange={(v) => setIdNumber(v.replace(/\D/g, "").slice(0, 13))} placeholder="0000000000000" required error={fieldErrors.idNumber} testId="signup-id" />
                    {idNumber.length > 0 && idNumber.length < 13 && !fieldErrors.idNumber && (
                      <p className="text-[11px] text-muted-foreground -mt-2">{13 - idNumber.length} more digit{13 - idNumber.length === 1 ? "" : "s"} to go.</p>
                    )}
                  </>
                )}
                <PhoneInput
                  country={phoneCountry}
                  onCountryChange={setPhoneCountry}
                  nationalNumber={phone}
                  onNationalNumberChange={setPhone}
                  error={fieldErrors.phone}
                  testId="signup-phone"
                />
              </>
            )}

            <FieldWithIcon icon={Mail} label={t("auth.email")} value={email} onChange={setEmail} placeholder="you@example.com" type="email" required />

            {mode !== "forgot" && (
              <div>
                <FieldWithIcon
                  icon={Lock}
                  label={t("auth.password")}
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  type="password"
                  required
                  minLength={6}
                  onGenerate={mode === "signup" ? () => setPassword(generateStrongPassword()) : undefined}
                />
                {mode === "signup" && password && <PasswordStrengthMeter password={password} />}
              </div>
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
  icon: Icon, label, value, onChange, placeholder, type = "text", required, minLength, error, testId, onGenerate,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  error?: string;
  testId?: string;
  /** When set, renders a "generate" button (password fields only) that fills
   *  the field with a strong random value -- most people don't have a good
   *  one memorized on the spot, and typing your own weak one is the default. */
  onGenerate?: () => void;
}) => {
  const isPassword = type === "password";
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-semibold">{label}</label>
        {onGenerate && (
          <button
            type="button"
            onClick={() => { onGenerate(); setVisible(true); }}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-secondary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            <Wand2 className="h-3 w-3" /> Generate strong password
          </button>
        )}
      </div>
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type={isPassword ? (visible ? "text" : "password") : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          minLength={minLength}
          placeholder={placeholder}
          aria-invalid={!!error}
          data-testid={testId}
          className={`w-full pl-10 py-2.5 rounded-lg border bg-muted text-foreground focus:bg-card focus:ring-2 outline-none transition text-sm ${
            isPassword ? "pr-10" : "pr-4"
          } ${
            error
              ? "border-destructive focus:border-destructive focus:ring-destructive/20"
              : "border-input focus:border-secondary focus:ring-secondary/10"
          }`}
        />
        {isPassword && <PasswordToggleButton visible={visible} onToggle={() => setVisible((v) => !v)} />}
      </div>
      {error && <p role="alert" className="text-[11px] text-destructive mt-1">{error}</p>}
    </div>
  );
};

const STRENGTH_COLORS = ["bg-destructive", "bg-destructive", "bg-amber-500", "bg-lime-500", "bg-emerald-500"];

const PasswordStrengthMeter = ({ password }: { password: string }) => {
  const { score, label } = useMemo(() => estimatePasswordStrength(password), [password]);
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? STRENGTH_COLORS[score] : "bg-muted"}`} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
};

export default Auth;
