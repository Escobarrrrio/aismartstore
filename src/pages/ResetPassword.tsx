import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Lock, Wand2 } from "lucide-react";
import Logo from "@/components/Logo";
import PasswordToggleButton from "@/components/PasswordToggleButton";
import { generateStrongPassword, estimatePasswordStrength } from "@/lib/password";
import { useTranslation } from "react-i18next";
import SEO from "@/components/SEO";

const STRENGTH_COLORS = ["bg-destructive", "bg-destructive", "bg-amber-500", "bg-lime-500", "bg-emerald-500"];

const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isRecovery, setIsRecovery] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes("type=recovery")) {
      setIsRecovery(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: t("resetPassword.mismatchTitle"), variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      toast({ title: t("resetPassword.errorTitle"), description: error.message, variant: "destructive" });
    } else {
      toast({ title: t("resetPassword.successTitle"), description: t("resetPassword.successDesc") });
      navigate("/auth");
    }
    setLoading(false);
  };

  if (!isRecovery) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <SEO title={t("resetPassword.title")} description="Reset your password." noindex />
        <div className="text-center">
          <p className="text-muted-foreground">{t("resetPassword.invalidLink")}</p>
          <button onClick={() => navigate("/auth")} className="mt-4 text-secondary font-semibold hover:underline">
            {t("resetPassword.backToSignIn")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4" style={{ background: "linear-gradient(135deg, hsl(var(--muted)), hsl(270 30% 95%))" }}>
      <SEO title={t("resetPassword.title")} description="Reset your password." noindex />
      <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-elevated p-8">
        <div className="flex justify-center mb-7">
          <Logo size={48} asLink={false} />
        </div>

        <h2 className="font-display font-extrabold text-2xl text-center mb-1">{t("resetPassword.title")}</h2>
        <p className="text-muted-foreground text-sm text-center mb-7">{t("resetPassword.subtitle")}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold">{t("resetPassword.newPassword")}</label>
              <button
                type="button"
                onClick={() => { setPassword(generateStrongPassword()); setShowPassword(true); }}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-secondary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <Wand2 className="h-3 w-3" /> Generate strong password
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card focus:ring-2 focus:ring-secondary/10 outline-none transition text-sm"
              />
              <PasswordToggleButton visible={showPassword} onToggle={() => setShowPassword((v) => !v)} />
            </div>
            {password && (() => {
              const { score, label } = estimatePasswordStrength(password);
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
            })()}
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5">{t("resetPassword.confirmPassword")}</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                placeholder="••••••••"
                className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card focus:ring-2 focus:ring-secondary/10 outline-none transition text-sm"
              />
              <PasswordToggleButton visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((v) => !v)} />
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {loading ? t("resetPassword.pleaseWait") : t("resetPassword.updatePassword")}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
