import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Lock, Mail } from "lucide-react";
import logo from "@/assets/logo.png";

const Auth = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (isLogin) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast({ title: "Login failed", description: error.message, variant: "destructive" });
      } else {
        navigate("/admin");
      }
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        toast({ title: "Sign up failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Check your email", description: "We sent you a confirmation link to verify your account." });
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4" style={{ background: "linear-gradient(135deg, hsl(var(--muted)), hsl(270 30% 95%))" }}>
      <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-elevated p-8">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-7">
          <img src={logo} alt="AI Smart Store" className="h-12 w-12 object-contain" />
          <span className="font-display font-extrabold text-xl gradient-brand-text">Smart Store</span>
        </div>

        <h2 className="font-display font-extrabold text-2xl text-center mb-1">
          {isLogin ? "Welcome Back" : "Create Account"}
        </h2>
        <p className="text-muted-foreground text-sm text-center mb-7">
          {isLogin ? "Sign in to access the admin control centre" : "Register to manage your store"}
        </p>

        {/* Tabs */}
        <div className="flex bg-muted rounded-lg p-0.5 mb-6">
          <button
            onClick={() => setIsLogin(true)}
            className={`flex-1 py-2 rounded-md font-display font-semibold text-sm transition-all ${isLogin ? "bg-card text-foreground shadow-card" : "text-muted-foreground"}`}
          >
            Sign In
          </button>
          <button
            onClick={() => setIsLogin(false)}
            className={`flex-1 py-2 rounded-md font-display font-semibold text-sm transition-all ${!isLogin ? "bg-card text-foreground shadow-card" : "text-muted-foreground"}`}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5">Email</label>
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
          <div>
            <label className="block text-xs font-semibold mb-1.5">Password</label>
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
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-full gradient-brand text-white font-display font-bold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
          >
            {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-5">
          {isLogin ? "Don't have an account?" : "Already have an account?"}{" "}
          <button onClick={() => setIsLogin(!isLogin)} className="text-secondary font-semibold hover:underline">
            {isLogin ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Auth;
