import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail } from "lucide-react";
import Logo from "@/components/Logo";
import { useTranslation } from "react-i18next";

const Auth = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [isForgot, setIsForgot] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isForgot) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast({ title: t("auth.errorTitle"), description: error.message, variant: "destructive" });
      } else {
        toast({ title: t("auth.checkEmailTitle"), description: t("auth.resetEmailSent") });
        setIsForgot(false);
      }
      setLoading(false);
      return;
    }

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast({ title: t("auth.loginFailedTitle"), description: error.message, variant: "destructive" });
      } else {
        toast({ title: t("auth.welcomeBackToast"), description: t("auth.signedInToast") });
        navigate("/admin");
      }
    } else {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth` },
      });
      if (error) {
        toast({ title: t("auth.signUpFailedTitle"), description: error.message, variant: "destructive" });
      } else {
        toast({ title: t("auth.checkEmailTitle"), description: t("auth.confirmEmailSent") });
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4" style={{ background: "linear-gradient(135deg, hsl(var(--muted)), hsl(270 30% 95%))" }}>
      <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-elevated p-8">
        {/* Logo */}
        <div className="flex justify-center mb-7">
          <Logo size={48} asLink={false} />
        </div>

        <h2 className="font-display font-extrabold text-2xl text-center mb-1">
          {isForgot ? t("auth.resetPassword") : isLogin ? t("auth.welcomeBack") : t("auth.createAccount")}
        </h2>
        <p className="text-muted-foreground text-sm text-center mb-7">
          {isForgot
            ? t("auth.resetHint")
            : isLogin
            ? t("auth.signInHint")
            : t("auth.signUpHint")}
        </p>

        {/* Tabs - hide when forgot */}
        {!isForgot && (
          <div className="flex bg-muted rounded-lg p-0.5 mb-6">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2 rounded-md font-display font-semibold text-sm transition-all ${isLogin ? "bg-card text-foreground shadow-card" : "text-muted-foreground"}`}
            >
              {t("auth.signIn")}
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2 rounded-md font-display font-semibold text-sm transition-all ${!isLogin ? "bg-card text-foreground shadow-card" : "text-muted-foreground"}`}
            >
              {t("auth.signUp")}
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5">{t("auth.email")}</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card focus:ring-2 focus:ring-secondary/10 outline-none transition text-sm"
              />
            </div>
          </div>
          {!isForgot && (
            <div>
              <label className="block text-xs font-semibold mb-1.5">{t("auth.password")}</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-input bg-muted text-foreground focus:border-secondary focus:bg-card focus:ring-2 focus:ring-secondary/10 outline-none transition text-sm"
                />
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {loading ? t("auth.pleaseWait") : isForgot ? t("auth.sendResetLink") : isLogin ? t("auth.signIn") : t("auth.createAccount")}
          </button>
        </form>

        {/* Forgot password link */}
        {isLogin && !isForgot && (
          <p className="text-center text-xs text-muted-foreground mt-3">
            <button onClick={() => setIsForgot(true)} className="text-secondary font-semibold hover:underline">
              {t("auth.forgotPassword")}
            </button>
          </p>
        )}

        {isForgot ? (
          <p className="text-center text-xs text-muted-foreground mt-5">
            <button onClick={() => setIsForgot(false)} className="text-secondary font-semibold hover:underline">
              {t("auth.backToSignIn")}
            </button>
          </p>
        ) : (
          <p className="text-center text-xs text-muted-foreground mt-5">
            {isLogin ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
            <button onClick={() => setIsLogin(!isLogin)} className="text-secondary font-semibold hover:underline">
              {isLogin ? t("auth.signUpAction") : t("auth.signInAction")}
            </button>
          </p>
        )}
      </div>
    </div>
  );
};

export default Auth;
